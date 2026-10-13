/**
 * §5.3 #9-2 — **에이전트가 띄운 프로세스는 손자까지 우리가 책임진다.**
 *
 * 2026-10-12 19:11 앱이 메모리 부족으로 꺼졌다. 우리 에이전트 둘이 돌린 grep 두 개가 커밋 97GB 를 먹었고,
 * 그중 하나는 Claude Code 가 작업을 `[killed]` 로 적은 뒤에도 고아로 5시간을 살았다. Windows 에서 상류는
 * `bash.exe` 만 끊고(anthropics/claude-code#76353 — #62659·#66151 은 not planned), Node 기본 묶음은 직계
 * 자식만 묶는다(libuv 전역 Job 의 `SILENT_BREAKAWAY_OK`). 그래서 세 겹을 여기서 진다.
 *
 *  (A) 묶음 — Windows 는 자식마다 Job Object(`KILL_ON_JOB_CLOSE` + 프로세스당 메모리 상한). 바인딩은
 *      desktop main 의 koffi 라 **주입**받는다(`setProcessContainmentBackend` — server 는 desktop 을 모른다).
 *      mac/Linux 는 종전 detached 그룹 그대로이고, 그룹을 빠져나간 자손은 본 대로 기억한다.
 *  (B) 상한·감시 — `PROCESS_GUARD_TICK_MS` 마다 **우리 묶음 안만** 잰다. 상한은 Windows 에선 커널이,
 *      그 밖에선 이 감시가 지킨다. 시스템 여유가 바닥나면 가장 큰 것 하나를 끊는다.
 *  (C) 정리 — 본체가 내려가면 유예 뒤 남은 것을 전부 끊는다(그렇게 해도 되는 자식만 — `reapOnExit`).
 *
 * 판정은 shared `processGuardPolicy.ts` 의 순수 함수이고, 여기는 그 판정을 실제 프로세스에 잇는 자리다.
 * 플랫폼은 생성자에서 한 번 받는다 — 시험이 세 OS 를 다 고정한다(멀티플랫폼 규칙).
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import {
  DEFAULT_PROCESS_GUARD_SETTINGS,
  PROCESS_GUARD_FALLBACK_TICK_MS,
  PROCESS_GUARD_TICK_MS,
  SESSION_END_REAP_GRACE_MS,
  SESSION_KEYED_MAP_MAX,
  capSetSize,
  imageNameOf,
  isUnderMemoryPressure,
  membersOfRoot,
  overCapProcesses,
  pickPressureVictim,
  resolveProcessMemoryCap,
  type GuardedProcess,
  type ProcessGuardNotice,
  type ProcessGuardSettings,
  type ProcessSnapshotRow,
  type RememberedDescendant,
  type SystemMemoryReading,
} from '@vibisual/shared';
import { logger } from '../logger.js';

// ─── 바깥과 맞닿는 모양 ───

/** 알림을 남길 세션. 주인을 모르는 자식(실행 런처·스크립트 선반)은 `null` — 진단 로그에만 남는다. */
export interface ProcessGuardOwner {
  parentAgentId: string;
  subAgentId: string;
}

/** 무엇이 띄운 자식인가 — 진단 로그의 이름표. */
export type ProcessGuardRootKind = 'claude' | 'codex' | 'pty' | 'shelf';

export interface ProcessGuardAdoptOptions {
  /**
   * 본체가 내려가면 남은 자손을 끊어도 되는가.
   *
   * claude 상주 자식·CMD 터미널·스크립트 선반은 **참** — 그 자식이 끝났다는 것이 곧 그 세션이 끝났다는 뜻이다.
   * 코덱스·claude 일회성 실행은 **거짓** — 턴마다 새 프로세스라, 끊으면 에이전트가 띄운 개발 서버가 매 턴
   * 꺼진다. 그 자리는 상한·압박 감시만 받는다.
   */
  reapOnExit: boolean;
}

export interface ContainmentLimits {
  /** 프로세스 하나의 커밋 상한(바이트). `null` = 상한 없음. */
  memoryCapBytes: number | null;
  /** 묶음 핸들이 닫힐 때 남은 프로세스를 커널이 끊을지. */
  killOnClose: boolean;
}

export type ContainmentEvent =
  /** 그 프로세스의 할당을 커널이 상한에서 거부했다(Windows `JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT`). */
  | { kind: 'memory-limit'; pid: number }
  /** 묶음 안에 아무것도 남지 않았다(`JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO`). */
  | { kind: 'empty' };

/** 묶음 하나. */
export interface ContainmentHandle {
  /** 지금 묶음 안의 pid 전부(부모가 죽은 고아 포함). 못 읽으면 `null`. */
  members(): number[] | null;
  /** 쌓인 통지를 비우며 꺼낸다. 비우지 않으면 커널 큐에 쌓이므로 틱마다 부른다. */
  drain(): ContainmentEvent[];
  /** 상한·닫힘 동작을 바꾼다 — 설정이 바뀌면 이미 떠 있는 묶음에도 싣는다. */
  setLimits(limits: ContainmentLimits): boolean;
  /** 남은 것을 전부 끊는다. 끊기 직전 묶음 안에 있던 수를 돌려준다. */
  terminate(): number;
  /** 핸들을 닫는다. 닫힘 동작은 마지막으로 실은 `killOnClose` 를 따른다. */
  close(): void;
}

/** Windows Job Object 백엔드 — desktop main 이 koffi 로 짓고 주입한다. */
export interface ContainmentBackend {
  /** 새 묶음을 만들어 pid 를 넣는다. 실패하면 `null` — 그 자식은 감시로 내려간다. */
  contain(pid: number, limits: ContainmentLimits): ContainmentHandle | null;
  /** 커밋 한도·여유(바이트). 사고는 실메모리가 아니라 커밋이 바닥나서 났다. 못 읽으면 `null`. */
  commitMemory(): SystemMemoryReading | null;
  /** 한 프로세스의 사적 커밋(바이트). 못 읽으면 `null`. */
  processMemory(pid: number): number | null;
  /** 실행본 이름(알림용). 못 읽으면 `null`. */
  processImage(pid: number): string | null;
  /** 그 프로세스 하나만 끊는다(트리 아님 — "그것만 멈춘다"). */
  killProcess(pid: number): boolean;
}

/** 목록 한 벌 — Windows 대체 경로는 같은 호출에서 커밋 여유도 함께 읽는다. */
export interface ProcessSnapshot {
  rows: ProcessSnapshotRow[];
  commit?: SystemMemoryReading | null;
}

export type ProcessGuardNoticeSink = (owner: ProcessGuardOwner | null, notice: ProcessGuardNotice) => void;

/** 시험이 갈아 끼우는 자리 — 기본값은 실제 OS 를 부른다. */
export interface ProcessGuardDeps {
  platform?: NodeJS.Platform;
  totalPhysBytes?: () => number;
  snapshot?: (platform: NodeJS.Platform) => Promise<ProcessSnapshot | null>;
  /** 묶음 백엔드가 없을 때의 시스템 여유(mac/Linux). */
  systemMemory?: (platform: NodeJS.Platform) => Promise<SystemMemoryReading | null>;
  /** 묶음 백엔드가 없을 때 프로세스 하나만 끊는다. */
  killPid?: (pid: number, platform: NodeJS.Platform) => void;
  now?: () => number;
  /** 거짓이면 타이머를 걸지 않는다(시험이 `tick()` 을 직접 부른다). */
  autoStart?: boolean;
}

// ─── 기본 OS 접점 ───

/** 목록이 너무 오래 걸리면 "모른다"로 친다 — 그때는 아무것도 끊지 않는다. */
const SNAPSHOT_TIMEOUT_MS = 10_000;
/** PowerShell 목록은 명령줄까지 실어 커질 수 있다. */
const SNAPSHOT_MAX_BUFFER = 32 * 1024 * 1024;

/** mac/Linux 공통 키워드만 쓴다(`args` 가 마지막이어야 공백이 든 명령줄이 통째로 남는다). */
export function posixSnapshotCommand(): { file: string; args: string[] } {
  return { file: 'ps', args: ['-A', '-o', 'pid=,ppid=,pgid=,rss=,args='] };
}

/** `pid ppid pgid rss(KB) args...` 한 줄씩. */
export function parsePosixSnapshot(text: string): ProcessSnapshotRow[] {
  const rows: ProcessSnapshotRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const rssKb = Number.parseInt(m[4] ?? '', 10);
    rows.push({
      pid: Number.parseInt(m[1] ?? '', 10),
      ppid: Number.parseInt(m[2] ?? '', 10),
      pgid: Number.parseInt(m[3] ?? '', 10),
      memBytes: Number.isFinite(rssKb) ? rssKb * 1024 : null,
      command: (m[5] ?? '').trim(),
    });
  }
  return rows;
}

/**
 * Windows 대체 목록(묶음 바인딩이 없을 때). 첫 줄 `MEM\t한도KB\t여유KB` 에 커밋을, 이어 `pid\tppid\t사적커밋\t명령줄`.
 * 무거운 조회라 `PROCESS_GUARD_FALLBACK_TICK_MS` 로 늦춘다.
 */
export function windowsSnapshotCommand(): { file: string; args: string[] } {
  return {
    file: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command',
      "$o = Get-CimInstance Win32_OperatingSystem; \"MEM`t$($o.TotalVirtualMemorySize)`t$($o.FreeVirtualMemory)\"; "
      + "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.PrivatePageCount)`t$($_.CommandLine -replace '[\\r\\n\\t]+',' ')\" }"],
  };
}

export function parseWindowsSnapshot(text: string): ProcessSnapshot {
  const rows: ProcessSnapshotRow[] = [];
  let commit: SystemMemoryReading | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts[0] === 'MEM') {
      const totalKb = Number.parseInt(parts[1] ?? '', 10);
      const freeKb = Number.parseInt(parts[2] ?? '', 10);
      if (Number.isFinite(totalKb) && Number.isFinite(freeKb)) commit = { totalBytes: totalKb * 1024, availBytes: freeKb * 1024 };
      continue;
    }
    if (parts.length < 4) continue;
    const pid = Number.parseInt(parts[0] ?? '', 10);
    const ppid = Number.parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    const priv = Number.parseInt(parts[2] ?? '', 10);
    rows.push({ pid, ppid, memBytes: Number.isFinite(priv) ? priv : null, command: parts.slice(3).join('\t').trim() });
  }
  return { rows, commit };
}

/** macOS `kern.memorystatus_level`(여유 백분율)를 바이트로. 못 읽으면 `null`(모른다 ≠ 바닥). */
export function parseMacMemoryLevel(text: string, totalBytes: number): SystemMemoryReading | null {
  const pct = Number.parseInt(text.trim(), 10);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100 || !(totalBytes > 0)) return null;
  return { totalBytes, availBytes: Math.floor((totalBytes * pct) / 100) };
}

/**
 * 짧은 조회(`ps`·`sysctl`·PowerShell 목록)를 돌린다. **그룹 스폰(`processGroupSpawnOptions`)을 일부러 안 붙인다** —
 * 몇 초 안에 끝나는 일회성 조회라 손자를 만들지 않고, 시간 초과는 `execFile` 의 `timeout` 이 끊는다.
 * 실행본은 세 OS 의 기본 위치(`/bin/ps`·`/usr/sbin/sysctl`·System32)에 있어 Finder 로 띄운 mac 앱의 최소 PATH 로도 닿는다.
 */
function runFile(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { windowsHide: true, timeout: SNAPSHOT_TIMEOUT_MS, maxBuffer: SNAPSHOT_MAX_BUFFER, encoding: 'utf8' },
        (err, stdout) => resolve(err ? null : String(stdout)));
    } catch {
      resolve(null);
    }
  });
}

async function defaultSnapshot(platform: NodeJS.Platform): Promise<ProcessSnapshot | null> {
  const { file, args } = platform === 'win32' ? windowsSnapshotCommand() : posixSnapshotCommand();
  const out = await runFile(file, args);
  if (!out) return null;
  const snap = platform === 'win32' ? parseWindowsSnapshot(out) : { rows: parsePosixSnapshot(out) };
  return snap.rows.length > 0 ? snap : null;
}

async function defaultSystemMemory(platform: NodeJS.Platform): Promise<SystemMemoryReading | null> {
  const totalBytes = os.totalmem();
  if (platform === 'linux') return { totalBytes, availBytes: os.freemem() }; // libuv 가 MemAvailable 을 읽는다
  if (platform === 'darwin') {
    // macOS 의 os.freemem() 은 캐시를 빼고 세어 늘 바닥이다 — 그 값으로는 압박을 판정할 수 없다.
    const out = await runFile('sysctl', ['-n', 'kern.memorystatus_level']);
    return out === null ? null : parseMacMemoryLevel(out, totalBytes);
  }
  return null; // Windows 는 커밋을 본다 — 백엔드 또는 대체 목록이 싣는다.
}

function defaultKillPid(pid: number, platform: NodeJS.Platform): void {
  if (platform === 'win32') {
    try {
      const tk = spawn('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true });
      tk.on('error', () => { /* 이미 끝났거나 taskkill 이 없다 — 원하던 결과이거나 손쓸 수 없다 */ });
    } catch { /* ignore */ }
    return;
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* 이미 끝났다 */ }
}

function unrefTimer(t: { unref?: () => unknown }): void {
  if (typeof t.unref === 'function') t.unref();
}

// ─── 본체 ───

interface GuardRoot {
  pid: number;
  kind: ProcessGuardRootKind;
  owner: ProcessGuardOwner | null;
  reapOnExit: boolean;
  /** Windows 묶음. 없으면(mac/Linux · 묶기 실패) 목록으로 소속을 판정한다. */
  handle: ContainmentHandle | null;
  /** 묶음이 없을 때 — 살아 있을 때 본 자손(pid → 명령줄). 부모가 먼저 죽어도 이것으로 찾는다. */
  remembered: Map<number, string>;
  exited: boolean;
  reapTimer: ReturnType<typeof setTimeout> | null;
}

/** 감시가 한 틱에 모은 것 — 상한·압박 판정의 재료. */
interface TickProcess extends GuardedProcess {
  command?: string;
  /** 커널이 상한을 지키는가(Windows 묶음 안). 아니면 감시가 지킨다. */
  kernelCapped: boolean;
}

export class ProcessGuard {
  private settings: ProcessGuardSettings = { ...DEFAULT_PROCESS_GUARD_SETTINGS };
  private backend: ContainmentBackend | null = null;
  private readonly roots = new Map<number, GuardRoot>();
  /** 같은 사실은 한 번만 알린다(`사유:pid`). */
  private readonly noticed = new Set<string>();
  private sink: ProcessGuardNoticeSink | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private timerPeriod = 0;
  private ticking = false;
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;
  /** 압박인데 우리 것 중에 끊을 것이 없을 때 — 한 번만 적고, 압박이 풀리면 다시 적을 수 있게. */
  private pressureNotOursLogged = false;
  /** 목록 뜨기가 실패하는 동안 한 번만 적는다 — 안 적으면 감시가 **조용히** 아무것도 안 하는 상태가 된다. */
  private snapshotFailLogged = false;
  private readonly platform: NodeJS.Platform;
  private readonly totalPhysBytes: () => number;
  private readonly snapshot: (platform: NodeJS.Platform) => Promise<ProcessSnapshot | null>;
  private readonly systemMemory: (platform: NodeJS.Platform) => Promise<SystemMemoryReading | null>;
  private readonly killPid: (pid: number, platform: NodeJS.Platform) => void;
  private readonly now: () => number;
  private readonly autoStart: boolean;

  constructor(deps: ProcessGuardDeps = {}) {
    this.platform = deps.platform ?? process.platform;
    this.totalPhysBytes = deps.totalPhysBytes ?? (() => os.totalmem());
    this.snapshot = deps.snapshot ?? defaultSnapshot;
    this.systemMemory = deps.systemMemory ?? defaultSystemMemory;
    this.killPid = deps.killPid ?? defaultKillPid;
    this.now = deps.now ?? Date.now;
    this.autoStart = deps.autoStart ?? true;
  }

  // ── 설정·주입 ──

  setNoticeSink(sink: ProcessGuardNoticeSink | null): void {
    this.sink = sink;
  }

  getSettings(): ProcessGuardSettings {
    return { ...this.settings };
  }

  /** 끄면 묶음을 풀고(아무것도 끊지 않고) 감시를 멈춘다 — 이 기능이 생기기 전과 같은 동작. */
  setSettings(next: ProcessGuardSettings): void {
    this.settings = { ...next };
    if (!next.enabled) {
      for (const root of [...this.roots.values()]) this.releaseHandle(root);
      this.stopTimer();
      return;
    }
    for (const root of this.roots.values()) {
      if (root.handle) root.handle.setLimits(this.limitsFor(root));
      else if (!root.exited) root.handle = this.containSafely(root);
    }
    this.retime();
  }

  /** Windows 묶음 바인딩. 주입 전에 등록된 자식은 지금 소급해 넣는다(그 사이 생긴 손자는 감시가 받친다). */
  setBackend(backend: ContainmentBackend | null): void {
    this.backend = backend;
    if (backend && this.settings.enabled) {
      for (const root of this.roots.values()) {
        if (!root.handle && !root.exited) root.handle = this.containSafely(root);
      }
    }
    this.retime();
  }

  isReapEnabled(): boolean {
    return this.settings.enabled && this.settings.reapOnSessionEnd;
  }

  // ── 등록 ──

  /** 우리가 띄운 오래 사는 자식을 등록한다. 본체가 끝나면 `rootExited(pid)` 를 불러야 한다. */
  adopt(pid: number | undefined | null, owner: ProcessGuardOwner | null, kind: ProcessGuardRootKind, options: ProcessGuardAdoptOptions): void {
    if (pid == null || !Number.isInteger(pid) || pid <= 0) return;
    const existing = this.roots.get(pid);
    if (existing) {
      if (!existing.exited) return; // 같은 자식을 두 번 등록했다
      // 번호가 다시 쓰였다. 앞 것이 묶음이면 그 묶음만 지금 정리한다(묶음 밖에는 닿지 않는다). 묶음이 없으면
      //   정리하지 않고 놓는다 — 그룹 번호(pgid)로 고르면 같은 번호를 쓰는 **새** 자식의 그룹이 걸린다.
      if (existing.reapTimer) clearTimeout(existing.reapTimer);
      if (existing.handle && existing.reapOnExit && this.isReapEnabled()) void this.reap(existing);
      else this.releaseHandle(existing);
      this.roots.delete(pid);
    }
    const root: GuardRoot = {
      pid, kind, owner, reapOnExit: options.reapOnExit,
      handle: null, remembered: new Map(), exited: false, reapTimer: null,
    };
    this.roots.set(pid, root);
    if (this.settings.enabled && this.backend) root.handle = this.containSafely(root);
    this.retime();
  }

  /** `ChildProcess` 용 — 등록과 종료 배선을 한 번에. */
  guardChild(child: ChildProcess, owner: ProcessGuardOwner | null, kind: ProcessGuardRootKind, options: ProcessGuardAdoptOptions): void {
    const pid = child.pid;
    if (pid == null) return;
    this.adopt(pid, owner, kind, options);
    child.once('exit', () => this.rootExited(pid));
  }

  /** 본체가 내려갔다 — 정리해도 되는 자식이면 유예 뒤 남은 것을 끊는다(§5.3 #9-2 (C-2)). */
  rootExited(pid: number): void {
    const root = this.roots.get(pid);
    if (!root || root.exited) return;
    root.exited = true;
    if (!this.settings.enabled) {
      this.releaseHandle(root);
      return;
    }
    if (!this.isReapEnabled() || !root.reapOnExit) {
      // 끊지 않는 자리 — 묶음은 남은 것이 다 끝날 때까지 들고 있다(상한은 계속 커널이 지킨다).
      return;
    }
    root.reapTimer = setTimeout(() => { void this.reap(root); }, SESSION_END_REAP_GRACE_MS);
    unrefTimer(root.reapTimer);
  }

  /** §5.3 #9-2 (C-1) — 하니스가 끊었다고 적은 작업의 남은 프로세스를 거뒀다. */
  reportTaskReaped(owner: ProcessGuardOwner | null, count: number): void {
    if (count > 0) this.emit(owner, { reason: 'task-killed', enforcedBy: 'watchdog', count });
  }

  // ── 감시 한 틱 ──

  async tick(): Promise<void> {
    if (this.ticking || !this.settings.enabled || this.roots.size === 0) return;
    this.ticking = true;
    try {
      const procs: TickProcess[] = [];
      this.collectContained(procs);
      const snap = await this.collectLoose(procs);
      this.enforceWatchdogCap(procs);
      if (this.settings.pressureKill) await this.relievePressure(procs, snap);
    } catch (err) {
      logger.warn(`[process-guard] tick failed — nothing killed this round: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  /** ① Windows 묶음 — 통지를 비우고 구성원을 잰다. */
  private collectContained(out: TickProcess[]): void {
    for (const root of [...this.roots.values()]) {
      const handle = root.handle;
      if (!handle) continue;
      let empty = false;
      for (const ev of handle.drain()) {
        if (ev.kind === 'memory-limit') this.noticeKernelCap(root, ev.pid);
        else empty = true;
      }
      if (empty && root.exited) {
        // 다 끝났다 — 들고 있을 이유가 없다.
        this.releaseHandle(root);
        continue;
      }
      const pids = handle.members();
      if (!pids) continue;
      for (const pid of pids) {
        out.push({
          pid,
          memBytes: this.backend?.processMemory(pid) ?? null,
          isRoot: pid === root.pid && !root.exited,
          rootPid: root.pid,
          kernelCapped: this.limitsFor(root).memoryCapBytes !== null,
        });
      }
    }
  }

  /** ② 묶음이 없는 자식 — 목록을 떠서 소속을 판정한다. 뜬 목록을 돌려준다(커밋 여유를 실었을 수 있다). */
  private async collectLoose(out: TickProcess[]): Promise<ProcessSnapshot | null> {
    const loose = [...this.roots.values()].filter((r) => !r.handle);
    if (loose.length === 0) return null;
    const period = this.platform === 'win32' ? PROCESS_GUARD_FALLBACK_TICK_MS : PROCESS_GUARD_TICK_MS;
    if (this.now() - this.lastSnapshotAt < period) return null;
    this.lastSnapshotAt = this.now();
    const snap = await this.snapshot(this.platform);
    if (!snap) {
      // 모른다 — 아무것도 끊지 않는다. 다만 그 사실은 남긴다(이 자리의 실패는 화면에 아무 흔적이 없다).
      if (!this.snapshotFailLogged) {
        this.snapshotFailLogged = true;
        logger.warn(`[process-guard] could not list processes on ${this.platform} — the watchdog is idle until the list works again`);
      }
      return null;
    }
    this.snapshotFailLogged = false;
    for (const root of loose) {
      const remembered: RememberedDescendant[] = [...root.remembered].map(([pid, command]) => ({ pid, command }));
      const members = membersOfRoot(snap.rows, root.pid, remembered, !root.exited);
      // 기억은 지금 살아 있는 것으로 새로 쓴다 — 끝난 것은 잊어야 번호 재사용에 속지 않는다.
      root.remembered = new Map(members.filter((m) => m.pid !== root.pid).map((m) => [m.pid, m.command]));
      if (root.exited && members.length === 0) {
        this.roots.delete(root.pid); // 정리하지 않는 자리에서 남은 것이 다 끝났다
        continue;
      }
      for (const m of members) {
        out.push({
          pid: m.pid, memBytes: m.memBytes, isRoot: m.pid === root.pid && !root.exited,
          rootPid: root.pid, command: m.command, kernelCapped: false,
        });
      }
    }
    return snap;
  }

  /** ③ 상한 — 커널이 지키지 않는 자리(mac/Linux · 묶기 실패한 Windows)만. */
  private enforceWatchdogCap(procs: readonly TickProcess[]): void {
    const cap = resolveProcessMemoryCap(this.totalPhysBytes(), this.settings.memoryCapPercent);
    const loose = procs.filter((p) => !p.kernelCapped);
    for (const p of overCapProcesses(loose, cap)) {
      this.killOne(p, { reason: 'cap', enforcedBy: 'watchdog', ...(cap !== null ? { capBytes: cap } : {}) });
    }
  }

  /** ④ 압박 — 여유가 바닥이면 우리 것 중 가장 큰 하나만 끊는다. 다음 틱에 다시 잰다. */
  private async relievePressure(procs: readonly TickProcess[], snap: ProcessSnapshot | null): Promise<void> {
    const reading = this.platform === 'win32'
      ? (this.backend?.commitMemory() ?? snap?.commit ?? null)
      : await this.systemMemory(this.platform);
    if (!isUnderMemoryPressure(reading)) {
      this.pressureNotOursLogged = false;
      return;
    }
    const victim = pickPressureVictim(procs);
    if (!victim) {
      if (!this.pressureNotOursLogged) {
        this.pressureNotOursLogged = true;
        logger.warn(`[process-guard] memory pressure (avail ${reading?.availBytes ?? '?'} of ${reading?.totalBytes ?? '?'} bytes) but nothing large is ours — leaving other processes alone`);
      }
      return;
    }
    this.killOne(victim, { reason: 'pressure', enforcedBy: 'watchdog', ...(reading ? { availBytes: reading.availBytes } : {}) });
  }

  // ── 끊기·정리 ──

  private killOne(p: TickProcess, base: ProcessGuardNotice): void {
    const key = `${base.reason}:${p.pid}`;
    if (this.noticed.has(key)) return; // 이미 끊었다(목록에 늦게 남은 그림자)
    const root = this.roots.get(p.rootPid);
    const image = this.backend?.processImage(p.pid) ?? (p.command ? imageNameOf(p.command) : '');
    if (root?.handle && this.backend) this.backend.killProcess(p.pid);
    else this.killPid(p.pid, this.platform);
    logger.warn(`[process-guard] stopped pid=${p.pid} (${image || '?'}) reason=${base.reason} mem=${p.memBytes ?? '?'} root=${p.rootPid}`);
    this.emit(root?.owner ?? null, {
      ...base,
      pid: p.pid,
      ...(image ? { image } : {}),
      ...(p.memBytes !== null ? { memBytes: p.memBytes } : {}),
    }, key);
  }

  private noticeKernelCap(root: GuardRoot, pid: number): void {
    const key = `kernel:${pid}`;
    if (this.noticed.has(key)) return;
    const cap = this.limitsFor(root).memoryCapBytes;
    const image = this.backend?.processImage(pid) ?? '';
    logger.warn(`[process-guard] kernel refused allocation at the cap pid=${pid} (${image || '?'}) root=${root.pid}`);
    this.emit(root.owner, {
      reason: 'cap', enforcedBy: 'kernel', pid,
      ...(image ? { image } : {}),
      ...(cap !== null ? { capBytes: cap } : {}),
    }, key);
  }

  /** 본체가 내려간 뒤 남은 것을 전부 끊는다. */
  private async reap(root: GuardRoot): Promise<void> {
    root.reapTimer = null;
    let count = 0;
    if (root.handle) {
      count = root.handle.terminate();
      this.releaseHandle(root);
    } else {
      const snap = await this.snapshot(this.platform);
      if (snap) {
        const remembered = [...root.remembered].map(([pid, command]) => ({ pid, command }));
        for (const m of membersOfRoot(snap.rows, root.pid, remembered, false)) {
          this.killPid(m.pid, this.platform);
          count += 1;
        }
      }
      if (this.roots.get(root.pid) === root) this.roots.delete(root.pid);
    }
    if (count > 0) {
      logger.info(`[process-guard] session ended — stopped ${count} leftover process(es) of ${root.kind} root=${root.pid}`);
      this.emit(root.owner, { reason: 'session-end', enforcedBy: 'watchdog', count });
    }
  }

  // ── 묶음 ──

  private limitsFor(root: GuardRoot): ContainmentLimits {
    return {
      memoryCapBytes: resolveProcessMemoryCap(this.totalPhysBytes(), this.settings.memoryCapPercent),
      killOnClose: this.isReapEnabled() && root.reapOnExit,
    };
  }

  private containSafely(root: GuardRoot): ContainmentHandle | null {
    if (!this.backend) return null;
    try {
      const handle = this.backend.contain(root.pid, this.limitsFor(root));
      if (!handle) logger.warn(`[process-guard] could not contain ${root.kind} pid=${root.pid} — falling back to the watchdog`);
      return handle;
    } catch (err) {
      logger.warn(`[process-guard] contain threw for pid=${root.pid}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** 아무것도 끊지 않고 묶음을 놓는다(닫기 전에 닫힘 동작을 끈다). 끝난 본체면 기록도 지운다. */
  private releaseHandle(root: GuardRoot): void {
    if (root.handle) {
      try { root.handle.setLimits({ memoryCapBytes: null, killOnClose: false }); } catch { /* 닫기는 계속한다 */ }
      try { root.handle.close(); } catch { /* ignore */ }
      root.handle = null;
    }
    if (root.reapTimer) { clearTimeout(root.reapTimer); root.reapTimer = null; }
    if (root.exited && this.roots.get(root.pid) === root) this.roots.delete(root.pid);
  }

  // ── 알림 ──

  private emit(owner: ProcessGuardOwner | null, notice: ProcessGuardNotice, dedupeKey?: string): void {
    if (dedupeKey) {
      this.noticed.add(dedupeKey);
      capSetSize(this.noticed, SESSION_KEYED_MAP_MAX);
    }
    try {
      this.sink?.(owner, notice);
    } catch (err) {
      logger.warn(`[process-guard] notice sink failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── 타이머 ──

  private retime(): void {
    if (!this.autoStart || !this.settings.enabled) return;
    const period = this.backend || this.platform !== 'win32' ? PROCESS_GUARD_TICK_MS : PROCESS_GUARD_FALLBACK_TICK_MS;
    if (this.timer && this.timerPeriod === period) return;
    this.stopTimer();
    this.timerPeriod = period;
    this.timer = setInterval(() => { void this.tick(); }, period);
    unrefTimer(this.timer);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.timerPeriod = 0;
  }

  /** 시험·진단 — 지금 등록된 본체 수와 묶인 수. */
  stats(): { roots: number; contained: number } {
    let contained = 0;
    for (const r of this.roots.values()) if (r.handle) contained += 1;
    return { roots: this.roots.size, contained };
  }

  /** 앱 종료 — 타이머만 멈춘다(묶음 핸들은 프로세스와 함께 닫히고, 닫힘 동작은 커널이 따른다). */
  shutdown(): void {
    this.stopTimer();
  }
}

/** 앱 전역 하나 — 스폰 자리(subAgentManager·codexRunner·터미널·선반)가 같은 감시에 등록한다. */
export const processGuard = new ProcessGuard();

/** desktop main 이 koffi 로 지은 Windows 묶음 바인딩을 넣는다. `runServer()` 앞에 불러야 부팅 때 되살아나는 세션도 덮는다. */
export function setProcessContainmentBackend(backend: ContainmentBackend | null): void {
  processGuard.setBackend(backend);
}
