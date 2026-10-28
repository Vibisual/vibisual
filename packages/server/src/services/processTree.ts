import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../logger.js';

/**
 * 트리 종료 유틸. Windows 의 `child.kill()` 은 직접 자식만 죽여 손자(worker·MCP 서버)가 고아로 남는다 — 정상 종료는 `taskkill /T /F`({@link killTree}·{@link terminateChildTree}), 크래시는 Job Object(§5.3 #9-2, `processGuard.ts`).
 * 묶기가 없는 자리(mac/Linux·바인딩 실패)는 PID 를 기록해 다음 부팅 때 회수한다({@link reapOrphanedPidsFromPreviousRun}).
 */

const IS_WIN = process.platform === 'win32';

/**
 * POSIX 에서 자식을 프로세스 그룹 리더로 띄우는 spawn 옵션. {@link killTree} 의 `-pid` 그룹 킬은 `detached: true` 리더여야 성립하고, 아니면 ESRCH → 단일 pid 킬로 손자(MCP·worker)가 조용히 남는다(CMD 경로는 node-pty 의 `setsid` 덕에 우연히 된다).
 * Windows 에선 켜지 않는다(새 콘솔 창, 트리 종료는 `taskkill /T`). `child.unref()` 를 딸려 보내지 마라 — exit 수집·종료 순서가 바뀐다. stdio 와는 직교한다.
 * @param platform 테스트용 주입점(기본 = 현재 플랫폼).
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
 * PID 와 하위 트리를 강제 종료(Windows `taskkill /T /F`, POSIX 그룹 → 실패하면 단일 pid).
 * @param platform 테스트용 주입점(멀티플랫폼 규칙).
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
 * 자식과 손자 트리를 내린다. `stdin` 을 먼저 닫는다(재사용 경로가 `isChildStdinWritable` 로 "내려가는 중"을 안다).
 * Windows: 부모가 살아 있을 때 바로 `taskkill /T /F` — `child.kill` 은 직접 자식만 죽여 손자가 `/T` 에 안 잡히고 파이프를 쥔 채 `close` 를 붙든다. 실패하면 `graceMs` 뒤 직접 자식만.
 * POSIX: 그룹에 SIGTERM(claude 의 JSONL flush 시간) → `graceMs` 뒤 SIGKILL. 리더가 먼저 끝나도 그룹 손자는 거둔다(타이머를 리더 `exit` 로 지우지 마라). 그룹이 없으면 리더에게만 SIGTERM.
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
 * 본체 `exit` 뒤 `graceMs` 안에 `close` 가 없으면 우리 파이프 끝을 닫는다 — 놓친 손자가 파이프를 쥐면 `close` 가 몇 분씩 안 와 세션이 "도는 중"으로 남고 새 명령이 밀린다.
 * `close` 에 마감을 거는 모든 자식에 붙인다(코덱스는 자기 수명 관리에 같은 규칙이 있다).
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
