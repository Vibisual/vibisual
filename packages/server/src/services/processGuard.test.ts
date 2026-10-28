/**
 * §5.3 #9-2 — 감시가 판정을 실제 프로세스에 잇는 방식(가짜 백엔드·목록만). ① 묶음엔 상한, 정리 가능한 자식에만 닫힘 ② 압박 땐 가장 큰 하나, 자식 먼저
 * ③ 본체가 끝나면 유예 뒤 정리(턴마다 내려가는 코덱스 자식 제외) ④ 목록 실패면 안 끊는다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DEFAULT_PROCESS_GUARD_SETTINGS, PROCESS_GUARD_TICK_MS, SESSION_END_REAP_GRACE_MS, type ProcessGuardNotice, type ProcessSnapshotRow, type SystemMemoryReading } from '@vibisual/shared';
import {
  ProcessGuard,
  parseMacMemoryLevel,
  parsePosixSnapshot,
  parseWindowsSnapshot,
  type ContainmentBackend,
  type ContainmentEvent,
  type ContainmentHandle,
  type ContainmentLimits,
  type ProcessGuardOwner,
  type ProcessSnapshot,
} from './processGuard.js';

const GiB = 1024 ** 3;
const OWNER: ProcessGuardOwner = { parentAgentId: 'agent-1', subAgentId: 'sub-1' };

class FakeHandle implements ContainmentHandle {
  pids: number[];
  events: ContainmentEvent[] = [];
  limits: ContainmentLimits;
  terminated = false;
  closed = false;

  constructor(root: number, limits: ContainmentLimits) {
    this.pids = [root];
    this.limits = limits;
  }

  members(): number[] | null { return this.closed ? null : [...this.pids]; }
  drain(): ContainmentEvent[] { const out = this.events; this.events = []; return out; }
  setLimits(limits: ContainmentLimits): boolean { this.limits = limits; return true; }
  terminate(): number { const n = this.pids.length; this.pids = []; this.terminated = true; return n; }
  close(): void { this.closed = true; }
}

function makeBackend() {
  const handles = new Map<number, FakeHandle>();
  const mem = new Map<number, number>();
  const killed: number[] = [];
  let commit: SystemMemoryReading | null = { totalBytes: 160 * GiB, availBytes: 80 * GiB };
  const backend: ContainmentBackend = {
    contain: (pid, limits) => { const h = new FakeHandle(pid, limits); handles.set(pid, h); return h; },
    commitMemory: () => commit,
    processMemory: (pid) => mem.get(pid) ?? null,
    processImage: (pid) => (pid === 46168 ? 'grep.exe' : null),
    killProcess: (pid) => {
      killed.push(pid);
      for (const h of handles.values()) h.pids = h.pids.filter((p) => p !== pid);
      return true;
    },
  };
  return { backend, handles, mem, killed, setCommit: (c: SystemMemoryReading | null): void => { commit = c; } };
}

interface PosixWorld {
  rows: ProcessSnapshotRow[] | null;
  system: SystemMemoryReading | null;
  killed: number[];
  clock: number;
}

function makeGuard(platform: NodeJS.Platform, world?: PosixWorld) {
  const notices: { owner: ProcessGuardOwner | null; notice: ProcessGuardNotice }[] = [];
  const guard = new ProcessGuard({
    platform,
    autoStart: false,
    totalPhysBytes: () => 64 * GiB,
    ...(world
      ? {
          snapshot: async (): Promise<ProcessSnapshot | null> => (world.rows ? { rows: world.rows } : null),
          systemMemory: async (): Promise<SystemMemoryReading | null> => world.system,
          killPid: (pid: number): void => { world.killed.push(pid); },
          now: () => world.clock,
        }
      : {}),
  });
  guard.setNoticeSink((owner, notice) => notices.push({ owner, notice }));
  return { guard, notices };
}

afterEach(() => { vi.useRealTimers(); });

describe('Windows — Job Object', () => {
  it('contains each child with the cap, and kill-on-close only where reaping is allowed', () => {
    const b = makeBackend();
    const { guard } = makeGuard('win32');
    guard.setBackend(b.backend);
    guard.adopt(100, OWNER, 'claude', { reapOnExit: true });
    guard.adopt(200, OWNER, 'codex', { reapOnExit: false });
    expect(b.handles.get(100)?.limits).toEqual({ memoryCapBytes: 32 * GiB, killOnClose: true });
    expect(b.handles.get(200)?.limits).toEqual({ memoryCapBytes: 32 * GiB, killOnClose: false });
  });

  it('contains children registered before the binding arrived (boot order)', () => {
    const b = makeBackend();
    const { guard } = makeGuard('win32');
    guard.adopt(100, OWNER, 'claude', { reapOnExit: true });
    expect(guard.stats()).toEqual({ roots: 1, contained: 0 });
    guard.setBackend(b.backend);
    expect(b.handles.has(100)).toBe(true);
    expect(guard.stats()).toEqual({ roots: 1, contained: 1 });
  });

  it('reports a kernel cap hit once, with the image name, to the owning session', async () => {
    const b = makeBackend();
    const { guard, notices } = makeGuard('win32');
    guard.setBackend(b.backend);
    guard.adopt(100, OWNER, 'claude', { reapOnExit: true });
    b.handles.get(100)!.events.push({ kind: 'memory-limit', pid: 46168 });
    await guard.tick();
    b.handles.get(100)!.events.push({ kind: 'memory-limit', pid: 46168 });
    await guard.tick();
    expect(notices).toEqual([{ owner: OWNER, notice: { reason: 'cap', enforcedBy: 'kernel', pid: 46168, image: 'grep.exe', capBytes: 32 * GiB } }]);
  });

  it('under commit pressure stops the largest child, one per tick — never the agent first', async () => {
    const b = makeBackend();
    const { guard, notices } = makeGuard('win32');
    guard.setBackend(b.backend);
    guard.adopt(100, OWNER, 'claude', { reapOnExit: true });
    b.handles.get(100)!.pids = [100, 46168, 45884];
    b.mem.set(100, 0.4 * GiB).set(46168, 49 * GiB).set(45884, 47.8 * GiB);
    b.setCommit({ totalBytes: 171_542_917_120, availBytes: 255_786_008 }); // 2026-10-12 19:11:23
    await guard.tick();
    expect(b.killed).toEqual([46168]);
    expect(notices[0]?.notice).toMatchObject({ reason: 'pressure', enforcedBy: 'watchdog', pid: 46168, image: 'grep.exe', availBytes: 255_786_008 });
    await guard.tick();
    expect(b.killed).toEqual([46168, 45884]);
  });

  it('does nothing with normal headroom, and nothing when pressure-kill is off', async () => {
    const b = makeBackend();
    const { guard } = makeGuard('win32');
    guard.setBackend(b.backend);
    guard.adopt(100, OWNER, 'claude', { reapOnExit: true });
    b.handles.get(100)!.pids = [100, 46168];
    b.mem.set(46168, 49 * GiB);
    await guard.tick();
    expect(b.killed).toEqual([]);
    guard.setSettings({ ...DEFAULT_PROCESS_GUARD_SETTINGS, pressureKill: false });
    b.setCommit({ totalBytes: 171 * GiB, availBytes: 0.2 * GiB });
    await guard.tick();
    expect(b.killed).toEqual([]);
  });

  it('when the root exits, waits the grace and then stops what it left behind', async () => {
    vi.useFakeTimers();
    const b = makeBackend();
    const { guard, notices } = makeGuard('win32');
    guard.setBackend(b.backend);
    guard.adopt(100, OWNER, 'claude', { reapOnExit: true });
    const h = b.handles.get(100)!;
    h.pids = [46168]; // 본체는 이미 내려갔고 고아 grep 만 남았다
    guard.rootExited(100);
    expect(h.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(SESSION_END_REAP_GRACE_MS);
    expect(h.terminated).toBe(true);
    expect(h.closed).toBe(true);
    expect(notices.map((n) => n.notice)).toEqual([{ reason: 'session-end', enforcedBy: 'watchdog', count: 1 }]);
    expect(guard.stats().roots).toBe(0);
  });

  it('codex roots are not reaped — kept and watched until the job is empty', async () => {
    vi.useFakeTimers();
    const b = makeBackend();
    const { guard } = makeGuard('win32');
    guard.setBackend(b.backend);
    guard.adopt(200, OWNER, 'codex', { reapOnExit: false });
    const h = b.handles.get(200)!;
    h.pids = [777]; // 턴이 끝나고 에이전트가 띄운 개발 서버만 남았다
    guard.rootExited(200);
    await vi.advanceTimersByTimeAsync(SESSION_END_REAP_GRACE_MS * 2);
    expect(h.terminated).toBe(false);
    b.mem.set(777, 3 * GiB);
    b.setCommit({ totalBytes: 160 * GiB, availBytes: 0.5 * GiB });
    await guard.tick(); // 끊지는 않아도 감시는 계속된다
    expect(b.killed).toEqual([777]);
    h.events.push({ kind: 'empty' });
    await guard.tick();
    expect(h.closed).toBe(true);
    expect(guard.stats().roots).toBe(0);
  });

  it('turning the guard off releases every job without killing anything', () => {
    const b = makeBackend();
    const { guard } = makeGuard('win32');
    guard.setBackend(b.backend);
    guard.adopt(100, OWNER, 'claude', { reapOnExit: true });
    const h = b.handles.get(100)!;
    guard.setSettings({ ...DEFAULT_PROCESS_GUARD_SETTINGS, enabled: false });
    expect(h.limits).toEqual({ memoryCapBytes: null, killOnClose: false });
    expect(h.closed).toBe(true);
    expect(h.terminated).toBe(false);
  });

  it('new settings reach jobs that are already running', () => {
    const b = makeBackend();
    const { guard } = makeGuard('win32');
    guard.setBackend(b.backend);
    guard.adopt(100, OWNER, 'claude', { reapOnExit: true });
    guard.setSettings({ ...DEFAULT_PROCESS_GUARD_SETTINGS, memoryCapPercent: 0, reapOnSessionEnd: false });
    expect(b.handles.get(100)?.limits).toEqual({ memoryCapBytes: null, killOnClose: false });
  });

  it('with clean-up off, an exited root keeps its leftovers alive', async () => {
    vi.useFakeTimers();
    const b = makeBackend();
    const { guard } = makeGuard('win32');
    guard.setSettings({ ...DEFAULT_PROCESS_GUARD_SETTINGS, reapOnSessionEnd: false });
    guard.setBackend(b.backend);
    guard.adopt(100, OWNER, 'claude', { reapOnExit: true });
    guard.rootExited(100);
    await vi.advanceTimersByTimeAsync(SESSION_END_REAP_GRACE_MS * 2);
    expect(b.handles.get(100)?.terminated).toBe(false);
  });
});

describe('mac/Linux — process groups + memory', () => {
  const ROOT = 500;
  const world = (): PosixWorld => ({ rows: [], system: { totalBytes: 64 * GiB, availBytes: 40 * GiB }, killed: [], clock: 1_000_000 });
  const r = (pid: number, ppid: number, pgid: number, command: string, gib = 0.1): ProcessSnapshotRow => ({ pid, ppid, pgid, memBytes: gib * GiB, command });

  it('stops a child over the cap — there is no kernel cap off Windows — and names it', async () => {
    const w = world();
    const { guard, notices } = makeGuard('linux', w);
    guard.adopt(ROOT, OWNER, 'claude', { reapOnExit: true });
    w.rows = [r(ROOT, 400, ROOT, 'claude --input-format stream-json'), r(501, ROOT, ROOT, '/usr/bin/grep -o .{0,3000}x activity.json', 40)];
    await guard.tick();
    expect(w.killed).toEqual([501]);
    expect(notices[0]).toEqual({ owner: OWNER, notice: { reason: 'cap', enforcedBy: 'watchdog', capBytes: 32 * GiB, pid: 501, image: 'grep', memBytes: 40 * GiB } });
  });

  it('remembers descendants, so an orphan is still ours after its parent shell dies', async () => {
    const w = world();
    const { guard } = makeGuard('linux', w);
    guard.adopt(ROOT, OWNER, 'claude', { reapOnExit: true });
    w.rows = [r(ROOT, 400, ROOT, 'claude'), r(600, ROOT, 600, 'bash -c grep'), r(601, 600, 600, 'grep -o x')];
    await guard.tick();
    expect(w.killed).toEqual([]);
    // 셸(600)이 죽었다 — grep 은 init 밑으로 갔고 자기 그룹(600)에 남았다.
    w.rows = [r(ROOT, 400, ROOT, 'claude'), r(601, 1, 600, 'grep -o x', 40)];
    w.clock += PROCESS_GUARD_TICK_MS;
    await guard.tick();
    expect(w.killed).toEqual([601]);
  });

  it('after the root exits, stops remembered leftovers — not a stranger that reused the root number', async () => {
    vi.useFakeTimers();
    const w = world();
    const { guard, notices } = makeGuard('linux', w);
    guard.adopt(ROOT, OWNER, 'claude', { reapOnExit: true });
    w.rows = [r(ROOT, 400, ROOT, 'claude'), r(600, ROOT, 600, 'bash -c grep'), r(601, 600, 600, 'grep -o x')];
    await guard.tick();
    guard.rootExited(ROOT);
    w.rows = [r(ROOT, 1, ROOT, 'some-other-daemon'), r(601, 1, 600, 'grep -o x')];
    await vi.advanceTimersByTimeAsync(SESSION_END_REAP_GRACE_MS);
    expect(w.killed).toEqual([601]);
    expect(notices.map((n) => n.notice)).toEqual([{ reason: 'session-end', enforcedBy: 'watchdog', count: 1 }]);
  });

  it('a failed process list kills nothing — unknown is not empty', async () => {
    const w = world();
    const { guard } = makeGuard('linux', w);
    guard.adopt(ROOT, OWNER, 'claude', { reapOnExit: true });
    w.rows = null;
    w.system = { totalBytes: 64 * GiB, availBytes: 0.1 * GiB };
    await guard.tick();
    expect(w.killed).toEqual([]);
  });

  it('under system pressure stops the largest child only', async () => {
    const w = world();
    const { guard, notices } = makeGuard('darwin', w);
    guard.adopt(ROOT, OWNER, 'claude', { reapOnExit: true });
    w.system = { totalBytes: 16 * GiB, availBytes: 0.5 * GiB };
    w.rows = [r(ROOT, 400, ROOT, 'claude', 0.3), r(501, ROOT, ROOT, 'node build.js', 3), r(502, ROOT, ROOT, 'python x.py', 1.5)];
    await guard.tick();
    expect(w.killed).toEqual([501]);
    expect(notices[0]?.notice).toMatchObject({ reason: 'pressure', pid: 501, availBytes: 0.5 * GiB });
  });

  it('notices from a child without an owner still reach the sink (diagnostics only downstream)', async () => {
    const w = world();
    const { guard, notices } = makeGuard('linux', w);
    guard.adopt(ROOT, null, 'shelf', { reapOnExit: true });
    w.rows = [r(ROOT, 400, ROOT, 'sh -c ./build.sh'), r(501, ROOT, ROOT, 'node leak.js', 40)];
    await guard.tick();
    expect(notices[0]?.owner).toBeNull();
  });
});

describe('OS readers', () => {
  it('parses POSIX ps rows (pid ppid pgid rss args) and skips the rest', () => {
    const rows = parsePosixSnapshot('  500   400   500  12345 claude --input-format stream-json\ngarbage\n  1 0 1 8 /sbin/launchd\n');
    expect(rows).toEqual([
      { pid: 500, ppid: 400, pgid: 500, memBytes: 12345 * 1024, command: 'claude --input-format stream-json' },
      { pid: 1, ppid: 0, pgid: 1, memBytes: 8 * 1024, command: '/sbin/launchd' },
    ]);
  });

  it('parses the Windows fallback list with its commit line', () => {
    const snap = parseWindowsSnapshot('MEM\t167522380\t19700000\r\n100\t9\t1048576\t"C:\\x\\claude.exe" -p\r\nbad line\r\n');
    expect(snap.commit).toEqual({ totalBytes: 167522380 * 1024, availBytes: 19700000 * 1024 });
    expect(snap.rows).toEqual([{ pid: 100, ppid: 9, memBytes: 1048576, command: '"C:\\x\\claude.exe" -p' }]);
  });

  it('reads the macOS free percentage, and refuses junk', () => {
    expect(parseMacMemoryLevel('63\n', 16 * GiB)).toEqual({ totalBytes: 16 * GiB, availBytes: Math.floor(16 * GiB * 0.63) });
    expect(parseMacMemoryLevel('', 16 * GiB)).toBeNull();
    expect(parseMacMemoryLevel('140', 16 * GiB)).toBeNull();
    expect(parseMacMemoryLevel('50', 0)).toBeNull();
  });
});
