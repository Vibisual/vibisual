/**
 * §7.11 포트 인계 — 에이전트가 띄운 서버의 기동 명령을 OS 프로세스 테이블(포트 → PID → 명령줄)에서 읽어 넘겨받는다. 명령을 모르면 Restart/Start 를 못 한다.
 * 프로세스가 살아 있을 때만 읽힌다 — 신고 시점·Stop 직전·Restart 요청 때 시도한다.
 * 보안: 읽은 명령은 `respawn` 의 "탐지한 dev 명령" 계약 안이다(이미 이 기기에서 돌던 프로세스라 새 권한이 아니다). 우리 자신·부모 프로세스는 인계하지 않는다.
 */
import { exec } from 'node:child_process';
import fs from 'node:fs';
import { logger } from '../logger.js';
import { findPortListeners, isVibisualOwnPort, listenerPids, reachableListeners } from './processChecker.js';

/**
 * 조회 1회당 상한. 넘으면 "못 읽었다"로 다음 후보로 간다. 잘리면 그 서버가 "재시작 불가"로 남으므로 넉넉히 준다.
 * Windows 는 조회마다 PowerShell + WMI 라 바쁜 기기에선 기동만으로 4초를 넘긴다(2026-09-13 windows-latest 실측).
 * @param platform 테스트용 주입점(멀티플랫폼 규칙).
 */
export function takeoverProbeTimeoutMs(platform: NodeJS.Platform): number {
  return platform === 'win32' ? 15_000 : 4_000;
}

/** 인계 결과. `command` 는 셸 한 줄로 다시 띄울 수 있는 형태다. */
export interface PortTakeover {
  command: string;
  /** 그 프로세스가 실제로 돌던 작업 폴더. 알아낼 수 없는 플랫폼(Windows)에서는 undefined. */
  cwd?: string;
  pid: number;
  /** 어느 수단으로 읽었나 — 로그·진단용(`/proc` · `ps` · `Get-CimInstance` …). */
  via: string;
}

/** PID 하나의 기동 명령·작업 폴더 조회 계획 — `file`(`/proc/<pid>/cmdline`, NUL 구분이라 무손실) · `link`(`/proc/<pid>/cwd`) · `exec`(외부 명령 stdout 파싱). */
export type TakeoverProbe =
  | { kind: 'file'; path: string; field: 'command'; parse: 'proc-cmdline' }
  | { kind: 'link'; path: string; field: 'cwd' }
  | { kind: 'exec'; command: string; field: 'command' | 'cwd'; parse: 'ps-args' | 'win-cmdline' | 'lsof-cwd' };

/**
 * 플랫폼별 조회 계획(위부터, 값을 얻은 `field` 는 더 안 묻는다). linux: `/proc` → `ps` · darwin: `ps -o args=` + `lsof -d cwd`
 * win32: `Get-CimInstance Win32_Process` 의 `CommandLine`, cwd 는 공개 API 가 없어(PEB) 호출자 폴백(세션 cwd).
 * @param platform 테스트용 주입점.
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

/** `ps -o args=` → 첫 비어 있지 않은 줄. `ps` 는 argv 를 공백으로 이어 붙여 공백 든 인자가 뭉개진다 — 그래서 리눅스는 `/proc/<pid>/cmdline` 을 먼저 본다. */
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

function runProbeExec(command: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    exec(command, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
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
    const out = await runProbeExec(probe.command, takeoverProbeTimeoutMs(platform));
    if (out == null) continue;
    if (probe.parse === 'ps-args') { const v = parsePsArgs(out); if (v) { command = v; via ||= 'ps'; } }
    else if (probe.parse === 'win-cmdline') { const v = parseWinCommandLine(out); if (v) { command = v; via ||= 'Get-CimInstance'; } }
    else if (probe.parse === 'lsof-cwd') { cwd = parseLsofCwd(out); }
  }

  if (!command || isUnusableTakeoverCommand(command)) return null;
  return { command, ...(cwd ? { cwd } : {}), via: via || 'unknown' };
}

/**
 * LISTEN 프로세스의 기동 명령을 인계 가능한 형태로. null(빈 포트·도구 없음·권한 없음)은 정상 경로 — "재시작 불가"로 남기고 kill 하지 않는다.
 * §7.11 — `host` 가 닿는 리스너에서만 읽는다(한 포트 두 주인 — 안 가르면 Restart 가 남의 명령을 우리 폴더에서 돌린다).
 * @param platform 테스트용 주입점(기본 = 실제 플랫폼).
 * @param host 그 서버를 부르는 주소의 호스트(`localhost` · `127.0.0.1` · `::1`). 비우면 포트 전체.
 */
export async function takeoverPortCommand(
  port: number,
  platform: NodeJS.Platform = process.platform,
  host?: string,
): Promise<PortTakeover | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  // 우리 자신의 포트(앱 서버·훅 리스너·프리뷰 프록시)는 인계 대상이 아니다.
  if (isVibisualOwnPort(port)) return null;

  const lookup = await findPortListeners(port, platform);
  const scoped = host !== undefined ? reachableListeners(lookup.listeners, host) : lookup.listeners;
  const targets = listenerPids(scoped).filter((pid) => pid !== process.pid && pid !== process.ppid);
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
