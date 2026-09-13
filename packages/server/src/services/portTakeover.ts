/**
 * §7.11 포트 인계 — **포트 인계(takeover)**: 에이전트가 띄워 놓은 서버의 기동 명령을 OS 프로세스
 * 테이블에서 직접 읽어, Vibisual 이 그 서버를 넘겨받는다.
 *
 * 왜 필요한가 — v3.85 는 에이전트 신고/루프백 감지로 알게 된 서버에 `reportedOnly` ServerEntry 를
 * 만들었다. 명령을 모르니 Restart/Start 가 영구 disabled 였고, 사용자 체감은 "내가 띄운 것도 아닌데
 * 껐다 켜지도 못한다" 였다. 하지만 **살아 있는 프로세스는 자기 기동 명령을 들고 있다** — 포트 →
 * PID → 명령줄까지 이으면 그 서버는 우리가 다시 띄울 수 있는 서버가 된다.
 *
 * 언제 읽는가 — **프로세스가 살아 있는 동안**이어야 한다. 신고 시점·Stop 직전·Restart 요청 시
 * 세 자리에서 시도한다(죽은 뒤에는 OS 에도 남지 않는다).
 *
 * 보안 — 읽어 온 명령은 `respawn` 의 "서버가 탐지한 dev 명령" 계약 안에 있다(사용자 자유입력 ❌).
 * 인계 대상은 **이미 이 기기에서 그 포트로 돌고 있던 프로세스**이므로, 재실행은 새 권한을 만들지
 * 않는다. 대신 우리 자신(Vibisual)·부모 프로세스는 인계하지 않는다(자기 자신을 죽이고 다시 띄우는
 * 사고 차단).
 *
 * 멀티플랫폼 — 조회 계획(`buildTakeoverProbes`)이 `platform` 을 **인자로 받는다**. 실기가 없는
 * Windows 개발기에서도 mac/linux 분기를 단위 테스트로 확인할 수 있어야 하기 때문이다
 * (docs/rules/multiplatform.md).
 */
import { exec } from 'node:child_process';
import fs from 'node:fs';
import { logger } from '../logger.js';
import { findPortOwnerPids, isVibisualOwnPort } from './processChecker.js';

/** 프로세스 정보 조회 1회당 상한. 넘으면 "못 읽었다"로 보고 다음 후보로 넘어간다. */
const PROBE_TIMEOUT_MS = 4000;

/** 인계 결과. `command` 는 셸 한 줄로 다시 띄울 수 있는 형태다. */
export interface PortTakeover {
  command: string;
  /** 그 프로세스가 실제로 돌던 작업 폴더. 알아낼 수 없는 플랫폼(Windows)에서는 undefined. */
  cwd?: string;
  pid: number;
  /** 어느 수단으로 읽었나 — 로그·진단용(`/proc` · `ps` · `Get-CimInstance` …). */
  via: string;
}

/**
 * PID 하나의 기동 명령·작업 폴더를 알아내기 위한 조회 계획 1건.
 *
 * - `file`  — 파일을 그대로 읽는다(리눅스 `/proc/<pid>/cmdline`: 인자가 NUL 로 갈려 있어 **무손실**).
 * - `link`  — 심볼릭 링크를 읽는다(리눅스 `/proc/<pid>/cwd`).
 * - `exec`  — 외부 명령 한 줄을 돌려 stdout 을 파싱한다.
 */
export type TakeoverProbe =
  | { kind: 'file'; path: string; field: 'command'; parse: 'proc-cmdline' }
  | { kind: 'link'; path: string; field: 'cwd' }
  | { kind: 'exec'; command: string; field: 'command' | 'cwd'; parse: 'ps-args' | 'win-cmdline' | 'lsof-cwd' };

/**
 * 플랫폼별 조회 계획. 위에 있는 것부터 시도하고, 값을 얻으면 그 항목(`field`)은 더 묻지 않는다.
 *
 * - **linux**: `/proc` 이 커널이 주는 진실이라 1순위(무손실 argv + 실제 cwd). 없으면 `ps` 로 내려간다.
 * - **darwin**: `/proc` 이 없다. `ps -o args=` 로 명령줄, `lsof -d cwd` 로 작업 폴더.
 * - **win32**: `Get-CimInstance Win32_Process` 의 `CommandLine` 이 원본 명령줄 그대로다.
 *   cwd 는 Win32 에 공개 API 가 없어(PEB 읽기 필요) **포기하고 호출자 폴백**(세션 cwd)에 맡긴다.
 *
 * @param platform `process.platform` 값. 인자로 받는 이유는 세 OS 를 한 기기에서 테스트하기 위함.
 */
export function buildTakeoverProbes(platform: NodeJS.Platform, pid: number): TakeoverProbe[] {
  if (!Number.isInteger(pid) || pid <= 0) return [];
  if (platform === 'win32') {
    return [
      {
        kind: 'exec',
        // -NoProfile: 사용자 프로필 로드로 인한 지연·오염 차단. 필터의 PID 는 정수 검증을 마쳤다.
        command:
          `powershell -NoProfile -NonInteractive -Command ` +
          `"(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
        field: 'command',
        parse: 'win-cmdline',
      },
    ];
  }
  const probes: TakeoverProbe[] = [];
  if (platform === 'linux') {
    probes.push({ kind: 'file', path: `/proc/${pid}/cmdline`, field: 'command', parse: 'proc-cmdline' });
    probes.push({ kind: 'link', path: `/proc/${pid}/cwd`, field: 'cwd' });
  }
  probes.push({ kind: 'exec', command: `ps -ww -o args= -p ${pid}`, field: 'command', parse: 'ps-args' });
  probes.push({ kind: 'exec', command: `lsof -a -d cwd -p ${pid} -F n`, field: 'cwd', parse: 'lsof-cwd' });
  return probes;
}

// ─── 순수 파서 (플랫폼 무관하게 단위 테스트 가능) ───

/**
 * 리눅스 `/proc/<pid>/cmdline` → argv. 인자가 NUL 로 갈려 있어 공백이 든 인자도 손실 없이 복원된다.
 * 끝의 빈 조각은 버린다(마지막 인자 뒤에도 NUL 이 하나 붙는다).
 */
export function parseProcCmdline(raw: string): string[] {
  return raw.split('\x00').filter((s) => s.length > 0);
}

/**
 * `ps -o args=` 출력 → 명령줄 한 줄. 여러 줄이 와도 첫 비어 있지 않은 줄만 쓴다.
 * ⚠ `ps` 는 argv 를 공백으로 이어 붙여 주므로 공백이 든 인자는 이 시점에 이미 뭉개져 있다 —
 * 그래서 리눅스에서는 `/proc/<pid>/cmdline` 을 먼저 본다.
 */
export function parsePsArgs(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return null;
}

/** PowerShell `Get-CimInstance … .CommandLine` 출력 → 명령줄 한 줄. */
export function parseWinCommandLine(stdout: string): string | null {
  const t = stdout.replace(/\r/g, '').trim();
  if (!t) return null;
  // 여러 줄로 접혀 오면(아주 긴 명령줄) 줄바꿈을 공백으로 되돌린다.
  return t.split('\n').map((l) => l.trim()).filter(Boolean).join(' ') || null;
}

/** `lsof -F n` 출력의 `n<path>` 줄 → 작업 폴더. */
export function parseLsofCwd(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('n') && line.length > 1) return line.slice(1).trim() || null;
  }
  return null;
}

/**
 * argv → 셸 한 줄. `respawn` 이 `shell: true` 로 돌리므로, 공백·메타문자가 든 인자는 반드시 감싼다.
 * (감싸지 않으면 `node /My Project/server.js` 가 인자 두 개로 갈려 서버가 즉시 죽는다.)
 */
export function shellJoinArgv(argv: string[], platform: NodeJS.Platform): string {
  const safe = /^[A-Za-z0-9_@%+=:,./-]+$/;
  return argv
    .map((a) => {
      if (a.length > 0 && safe.test(a)) return a;
      if (platform === 'win32') return `"${a.replace(/"/g, '\\"')}"`;
      return `'${a.replace(/'/g, `'\\''`)}'`;
    })
    .join(' ');
}

/**
 * 인계해선 안 되는 명령인가. 빈 문자열·커널 스레드(`[kworker/0:1]`)처럼 다시 띄울 수 없는 것을 거른다.
 */
export function isUnusableTakeoverCommand(command: string): boolean {
  const t = command.trim();
  if (t.length === 0) return true;
  if (/^\[.*\]$/.test(t)) return true; // 리눅스 커널 스레드
  return false;
}

// ─── 조회 실행 ───

function runProbeExec(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    exec(command, { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      // `ps`/`lsof` 는 "그런 PID 없음"을 exit 1 로 알린다 — stdout 이 있으면 그대로 쓴다.
      resolve(String(stdout ?? '') || (err ? null : ''));
    });
  });
}

/**
 * PID 하나에서 기동 명령·작업 폴더를 읽어 낸다.
 * @param platform 세 OS 를 한 기기에서 테스트하기 위해 인자로 받는다.
 */
export async function readProcessStart(
  pid: number,
  platform: NodeJS.Platform,
): Promise<{ command: string; cwd?: string; via: string } | null> {
  let command: string | null = null;
  let cwd: string | null = null;
  let via = '';

  for (const probe of buildTakeoverProbes(platform, pid)) {
    if (probe.field === 'command' && command) continue;
    if (probe.field === 'cwd' && cwd) continue;

    if (probe.kind === 'file') {
      try {
        const argv = parseProcCmdline(fs.readFileSync(probe.path, 'utf8'));
        if (argv.length > 0) { command = shellJoinArgv(argv, platform); via = '/proc/cmdline'; }
      } catch { /* 남의 프로세스 = EACCES, 이미 죽음 = ENOENT — 다음 후보로 */ }
      continue;
    }
    if (probe.kind === 'link') {
      try { cwd = fs.readlinkSync(probe.path) || null; } catch { /* 다음 후보로 */ }
      continue;
    }
    const out = await runProbeExec(probe.command);
    if (out == null) continue;
    if (probe.parse === 'ps-args') { const v = parsePsArgs(out); if (v) { command = v; via ||= 'ps'; } }
    else if (probe.parse === 'win-cmdline') { const v = parseWinCommandLine(out); if (v) { command = v; via ||= 'Get-CimInstance'; } }
    else if (probe.parse === 'lsof-cwd') { cwd = parseLsofCwd(out); }
  }

  if (!command || isUnusableTakeoverCommand(command)) return null;
  return { command, ...(cwd ? { cwd } : {}), via: via || 'unknown' };
}

/**
 * 포트를 LISTEN 중인 프로세스에서 기동 명령을 읽어 **인계 가능한 형태**로 돌려준다.
 *
 * 실패(=null)의 사유는 셋 중 하나이며 모두 정상 경로다 — ① 그 포트에 아무도 없다(서버가 이미 죽었다)
 * ② 점유자를 볼 도구가 없다 ③ 남의 계정 소유라 명령줄을 읽을 권한이 없다. 호출자는 이때 종전처럼
 * "재시작 불가"로 남기면 된다(kill 은 하지 않는다 — 되살릴 수 없는 서버를 죽이면 사용자 손해다).
 *
 * @param platform 기본값은 실제 플랫폼. 테스트가 세 OS 를 모두 지나갈 수 있도록 인자로 열어 둔다.
 */
export async function takeoverPortCommand(
  port: number,
  platform: NodeJS.Platform = process.platform,
): Promise<PortTakeover | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  // 우리 자신의 포트(앱 서버·훅 리스너·프리뷰 프록시)는 인계 대상이 아니다.
  if (isVibisualOwnPort(port)) return null;

  const lookup = await findPortOwnerPids(port);
  const targets = lookup.pids.filter((pid) => pid !== process.pid && pid !== process.ppid);
  if (targets.length === 0) return null;

  for (const pid of targets) {
    const start = await readProcessStart(pid, platform);
    if (!start) continue;
    logger.info(`takeover(port ${port}): pid=${pid} via=${start.via} cmd="${start.command.slice(0, 100)}"`);
    return { command: start.command, ...(start.cwd ? { cwd: start.cwd } : {}), pid, via: start.via };
  }
  logger.warn(`takeover(port ${port}): found pid(s) ${targets.join(', ')} but could not read the start command`);
  return null;
}
