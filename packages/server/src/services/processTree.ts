import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../logger.js';

/**
 * 프로세스 트리 종료 유틸 (§ Windows 고아 프로세스 누수 대응).
 *
 * 배경 — Node 는 Windows 에서 프로세스 "트리"를 직접 죽이지 못한다. `child.kill('SIGTERM'|'SIGKILL')`
 * 은 **직접 자식 1개**에만 신호를 보내므로, 그 자식이 다시 스폰한 손자(claude 가 띄우는 node worker·
 * MCP 서버 등)는 고아로 남아 계속 살아있다. 앱을 여러 번 쓰거나 중간에 팅기면 "Claude Code" 프로세스가
 * 작업관리자에 십수 개씩 누적된다.
 *
 * 해법(웹 조사 결론):
 *   1) 정상 종료: `taskkill /PID <pid> /T /F` 로 트리 전체를 강제 종료(pnpm·tree-kill 등이 쓰는 방식).
 *      → {@link killTree}, {@link terminateChildTree}.
 *   2) 크래시(부모가 신호 없이 먼저 죽음): VS Code/Chromium 은 Windows Job Object(KILL_ON_JOB_CLOSE)로
 *      자식이 부모보다 오래 못 살게 한다. 순수 Node 로는 네이티브 애드온이 필요 → 그 대안으로 스폰한
 *      PID 를 파일에 기록해 두고 **다음 부팅 때** 살아남은 고아를 회수한다.
 *      → {@link registerSpawnedPid}/{@link unregisterSpawnedPid}/{@link reapOrphanedPidsFromPreviousRun}.
 */

const IS_WIN = process.platform === 'win32';

/**
 * POSIX 에서 자식을 **프로세스 그룹 리더**로 띄우기 위한 spawn 옵션 조각.
 *
 * 왜 필요한가 — {@link killTree} 의 POSIX 경로는 `process.kill(-pid)` 로 **프로세스 그룹**을 죽인다.
 * 그런데 그룹 킬이 성립하려면 자식이 `detached: true` 로 떠서 스스로 그룹 리더(setsid/setpgid)여야 한다.
 * 그렇지 않으면 자식은 우리 서버와 같은 그룹에 속하고, `-pid` 는 "그런 그룹 없음"(ESRCH)으로 **항상**
 * 실패해 단일 pid 킬로 강등된다 → claude 가 띄운 MCP 서버·node worker(손자)가 조용히 살아남는다.
 * mac/linux 에서 "종료했는데 프로세스가 남는다"의 근본 원인이었고, 예외도 로그도 안 남아 오래 안 보였다
 * (CMD 경로만 멀쩡했던 이유는 node-pty 가 내부적으로 `setsid` 를 하기 때문 — 우연이지 설계가 아니다).
 *
 * Windows 에서는 켜지 않는다 — `detached: true` 가 새 콘솔 창을 띄울 수 있고, Windows 의 트리 종료는
 * 애초에 `taskkill /T` 라 프로세스 그룹이 필요 없다.
 *
 * ⚠ 이 옵션에 `child.unref()` 를 딸려 보내지 말 것. unref 하면 부모가 자식을 기다리지 않게 되어
 *   exit 수집·종료 순서가 달라진다. 여기서 필요한 건 "그룹 형성" 하나뿐이다.
 * ⚠ stdio 와 직교한다 — `['pipe','pipe','pipe']` 로 stdin 프롬프트를 주입하는 경로도 그대로 동작한다.
 *
 * @param platform 테스트에서 win/mac/linux 세 경우를 다 고정하기 위한 주입점. 기본값은 현재 플랫폼.
 */
export function processGroupSpawnOptions(
  platform: NodeJS.Platform = process.platform,
): { detached?: true } {
  return platform === 'win32' ? {} : { detached: true };
}

const APP_HOME_DIR = path.join(
  (process.env['VIBISUAL_HOME'] && process.env['VIBISUAL_HOME'].trim()) || os.homedir(),
  '.vibisual',
);
const PID_REGISTRY_FILE = path.join(APP_HOME_DIR, 'spawned-pids.json');

/**
 * PID 로 지정한 프로세스와 **그 하위 트리 전체**를 강제 종료한다.
 * Windows: `taskkill /T /F`. POSIX: 프로세스 그룹(-pid) 시도 후 실패하면 단일 pid.
 *
 * @param platform 멀티플랫폼 규칙 — 분기를 개발기 한 대에서 셋 다 시험하기 위한 주입점.
 */
export function killTree(pid: number | undefined | null, platform: NodeJS.Platform = process.platform): void {
  if (pid == null || pid <= 0) return;
  if (platform === 'win32') {
    try {
      const tk = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
      tk.on('error', () => { /* taskkill 부재/이미 종료 — 무시 */ });
    } catch { /* ignore */ }
  } else {
    // `-pid` = 프로세스 그룹 킬. **{@link processGroupSpawnOptions} 로 detached 스폰한 자식에서만**
    //   성립한다 — 그게 아니면 ESRCH 로 떨어져 단일 pid 폴백이 되고 손자(MCP 서버·worker)가 남는다.
    //   즉 이 폴백은 "안전망"이지 정상 경로가 아니다. 스폰 쪽에서 detached 를 빼면 여기가 조용히 무력화된다.
    try { process.kill(-pid, 'SIGKILL'); } catch {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
    }
  }
}

/** 그룹 리더가 이미 죽은 뒤 **그룹에만** 신호를 보낸다 — 단일 pid 폴백 없음(재활용된 번호를 건드리지 않게). */
function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false; // 그룹 없음(detached 로 안 떴거나 이미 전부 끝남)
  }
}

export interface TerminateChildTreeOptions {
  /** 정중한 종료를 기다리는 시간(POSIX) · taskkill 이 실패했을 때 직접 자식을 끊기까지의 시간(Windows). */
  graceMs?: number;
  /** 멀티플랫폼 규칙 — 분기를 개발기 한 대에서 셋 다 시험하기 위한 주입점. */
  platform?: NodeJS.Platform;
  /** 트리 강제 종료 — 테스트가 가짜 pid 로 남의 프로세스를 죽이지 않게 갈아 끼운다. */
  killTree?: (pid: number) => void;
  /** POSIX 그룹 신호 — 위와 같은 이유의 주입점. 그룹이 있었으면 true. */
  signalGroup?: (pid: number, signal: NodeJS.Signals) => boolean;
}

/**
 * 자식 프로세스와 **그 손자 트리**를 내린다. `stdin` 을 먼저 닫는다 — 재사용 경로는 그걸 보고 "내려가는
 * 중인 자식"을 알아본다(`isChildStdinWritable`).
 *
 * - **Windows**: 부모가 살아 있는 **지금** `taskkill /T /F` 로 트리째 끊는다. Windows 에는 신호가 없어
 *   `child.kill('SIGTERM')` 도 직접 자식만 즉사시킨다 — 그 순간 손자(MCP 서버·배경 셸)는 부모를 잃어
 *   `/T` 가 더는 찾지 못하고, 우리 stdout 파이프를 쥔 채 살아남아 `close` 를 한참 붙잡았다(종전엔
 *   트리 종료 타이머가 `exit` 에 지워져 **한 번도 돌지 않았다**). 정중한 종료의 이점은 Windows 에선
 *   애초에 없었다. taskkill 자체가 실패하면 `graceMs` 뒤 직접 자식만이라도 끊는다.
 * - **POSIX**: 그룹 전체에 SIGTERM(claude 가 JSONL 을 flush 할 시간), `graceMs` 뒤 남은 것을 SIGKILL.
 *   리더가 먼저 끝났어도 그룹에 남은 손자는 거둔다 — 종전엔 리더의 `exit` 가 타이머를 지워 그 손자가
 *   파이프를 쥔 채 남았다. 그룹이 없으면(detached 아님) 리더에게만 SIGTERM 하는 종전 동작.
 */
export function terminateChildTree(child: ChildProcess, options: TerminateChildTreeOptions = {}): void {
  const graceMs = options.graceMs ?? 1500;
  const platform = options.platform ?? process.platform;
  const kill = options.killTree ?? ((p: number) => killTree(p, platform));
  const signalGroup = options.signalGroup ?? signalProcessGroup;
  const pid = child.pid;
  const alive = (): boolean => child.exitCode === null && child.signalCode === null;
  try { child.stdin?.end(); } catch { /* ignore */ }

  if (platform === 'win32') {
    if (pid == null) {
      try { child.kill(); } catch { /* already dead */ }
      return;
    }
    kill(pid);
    const timer = setTimeout(() => {
      if (alive()) { try { child.kill(); } catch { /* already dead */ } }
    }, graceMs);
    if (typeof timer.unref === 'function') timer.unref();
    child.once('exit', () => clearTimeout(timer));
    return;
  }

  const grouped = pid != null && signalGroup(pid, 'SIGTERM');
  if (!grouped) {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  }
  if (pid == null) return;
  const timer = setTimeout(() => {
    if (alive()) kill(pid);
    // 리더는 끝났지만 그룹에 남은 손자 — 그룹에만 보낸다(리더 번호는 이미 재활용됐을 수 있다).
    else if (grouped) signalGroup(pid, 'SIGKILL');
  }, graceMs);
  if (typeof timer.unref === 'function') timer.unref();
}

/** `exit` 뒤 `close` 를 기다리는 기본 여유 — 코덱스 경로(`codexRunner`)와 같은 값. */
export const EXIT_CLOSE_GRACE_MS = 2000;

/**
 * 본체가 `exit` 했는데 `graceMs` 안에 `close` 가 안 오면 **우리 쪽 파이프 끝을 닫아 `close` 를 오게 한다.**
 *
 * Node 의 `close` 는 stdio 가 전부 닫혀야 온다. 트리 종료가 손자를 놓치면(Windows 에서 사슬이 끊긴 고아,
 * 부모와 다른 그룹으로 빠져나간 POSIX 자손) 그 손자가 쥔 파이프 때문에 `close` 가 몇 분씩 안 온다 — 그동안
 * 그 세션은 끝난 턴을 "도는 중"으로 붙들고, 새 명령은 그 뒤에 줄을 선다. 본체가 끝났으면 더 올 출력은
 * 여유 안에 다 흘러들었다고 보고, 남은 쓰기 끝은 그 손자의 사정으로 돌린다.
 *
 * `close` 핸들러에 마감을 거는 모든 자식에 붙인다(코덱스는 자기 수명 관리에 같은 규칙이 있다).
 */
export function forceCloseAfterExit(child: ChildProcess, graceMs = EXIT_CLOSE_GRACE_MS): void {
  let closed = false;
  child.once('close', () => { closed = true; });
  child.once('exit', () => {
    if (closed) return;
    const timer = setTimeout(() => {
      if (closed) return;
      try { child.stdout?.destroy(); } catch { /* ignore */ }
      try { child.stderr?.destroy(); } catch { /* ignore */ }
      try { child.stdin?.destroy(); } catch { /* ignore */ }
    }, graceMs);
    if (typeof timer.unref === 'function') timer.unref();
    child.once('close', () => clearTimeout(timer));
  });
}

// ─── 크래시 대비 PID 레지스트리 (부팅 시 고아 회수) ───

/** 이번 런에서 우리가 스폰해 아직 살아있는 PID 들(단일 인스턴스 가정 — requestSingleInstanceLock). */
const live = new Set<number>();

function readPidRegistry(): number[] {
  try {
    const arr = JSON.parse(fs.readFileSync(PID_REGISTRY_FILE, 'utf8'));
    if (Array.isArray(arr)) return arr.filter((n): n is number => typeof n === 'number' && n > 0);
  } catch { /* 없음/손상 = 빈 목록 */ }
  return [];
}

function writePidRegistry(pids: number[]): void {
  try {
    fs.mkdirSync(APP_HOME_DIR, { recursive: true });
    fs.writeFileSync(PID_REGISTRY_FILE, JSON.stringify([...new Set(pids)]), 'utf8');
  } catch (err) { logger.debug?.('[processTree] writePidRegistry failed', err); }
}

/** claude 자식을 스폰한 직후 호출 — 다음 부팅의 고아 회수 후보로 기록. */
export function registerSpawnedPid(pid: number | undefined | null): void {
  if (pid == null || pid <= 0) return;
  live.add(pid);
  writePidRegistry([...live]);
}

/** 자식이 정상 종료(exit)했을 때 호출 — 회수 후보에서 제거. */
export function unregisterSpawnedPid(pid: number | undefined | null): void {
  if (pid == null || pid <= 0) return;
  if (live.delete(pid)) writePidRegistry([...live]);
}

/**
 * 주어진 PID 가 우리가 회수해도 되는 claude/node 프로세스인지 확인.
 * OS 가 PID 를 재활용해 **다른** 프로세스가 그 번호를 쓰는 경우를 걸러내기 위한 이미지명 가드.
 */
function isReapableClaudeProcess(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (IS_WIN) {
      execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) { resolve(false); return; }
        const lower = stdout.toLowerCase();
        // 우리가 스폰하는 이미지 = claude.exe / node.exe. 그 외면 재활용된 PID 로 보고 건드리지 않는다.
        resolve(lower.includes('claude') || lower.includes('node.exe'));
      });
    } else {
      execFile('ps', ['-p', String(pid), '-o', 'comm='], (err, stdout) => {
        if (err || !stdout) { resolve(false); return; }
        const c = stdout.toLowerCase();
        resolve(c.includes('claude') || c.includes('node'));
      });
    }
  });
}

/**
 * 서버 부팅 직후 1회 호출. 지난 런이 정상 종료했다면 레지스트리가 비어있고, **크래시로 팅겼다면**
 * 그때 살아있던 claude 트리 PID 들이 남아있다 → 이미지명 검증 후 트리 강제 종료로 회수한다.
 */
export async function reapOrphanedPidsFromPreviousRun(): Promise<void> {
  const prev = readPidRegistry();
  // 이번 런 시작 = 파일을 현재(빈) 상태로 리셋. 아래 스폰들이 다시 채운다.
  writePidRegistry([...live]);
  if (prev.length === 0) return;
  let reaped = 0;
  for (const pid of prev) {
    if (live.has(pid)) continue;
    try {
      if (await isReapableClaudeProcess(pid)) { killTree(pid); reaped++; }
    } catch { /* ignore */ }
  }
  if (reaped > 0) {
    logger.info(`[processTree] reaped ${reaped} orphaned claude process tree(s) from previous run`);
  }
}
