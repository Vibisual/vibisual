/** §5.3 #9-2 — 에이전트가 띄운 프로세스 보호의 판정(순수, 서버 `processGuard.ts` 와 시험이 공용). OS 차이는 들어오는 값에만 있다 — `process.platform` ❌. */
import type { ProcessGuardNotice, ProcessGuardNoticeReason } from './types.js';
import {
  MEMORY_PRESSURE_FLOOR_MIN_BYTES,
  MEMORY_PRESSURE_FLOOR_RATIO,
  PRESSURE_ROOT_VICTIM_MIN_BYTES,
  PRESSURE_VICTIM_MIN_BYTES,
  PROCESS_GUARD_NOTICE_TAG,
  PROCESS_MEMORY_CAP_FLOOR_BYTES,
} from './constants.js';

/**
 * 프로세스 하나의 상한(바이트). `percent` 가 0 이하면 `null` = 상한 없음.
 * 실메모리를 못 읽었으면 하한(`PROCESS_MEMORY_CAP_FLOOR_BYTES`)을 쓴다 — 모르는 기계에서도 폭주는 막는다.
 */
export function resolveProcessMemoryCap(totalPhysBytes: number, percent: number): number | null {
  if (!Number.isFinite(percent) || percent <= 0) return null;
  if (!Number.isFinite(totalPhysBytes) || totalPhysBytes <= 0) return PROCESS_MEMORY_CAP_FLOOR_BYTES;
  const share = Math.floor((totalPhysBytes * Math.min(100, percent)) / 100);
  return Math.max(PROCESS_MEMORY_CAP_FLOOR_BYTES, share);
}

/** 압박 바닥(바이트) — 여유가 이 아래면 압박이다. 전체를 모르면 하한만 쓴다. */
export function memoryPressureFloor(totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return MEMORY_PRESSURE_FLOOR_MIN_BYTES;
  return Math.max(MEMORY_PRESSURE_FLOOR_MIN_BYTES, Math.floor(totalBytes * MEMORY_PRESSURE_FLOOR_RATIO));
}

/**
 * 시스템 여유 한 벌. OS 마다 **다른 값을 같은 모양으로** 담는다 —
 * Windows 는 커밋(한도·여유), Linux 는 실메모리(`MemAvailable`), macOS 는 여유 백분율을 바이트로 환산한 것.
 */
export interface SystemMemoryReading {
  totalBytes: number;
  availBytes: number;
}

/** 압박인가. 값을 못 읽었으면 `false` — **모른다 ≠ 바닥**이라 아무것도 끊지 않는다. */
export function isUnderMemoryPressure(reading: SystemMemoryReading | null): boolean {
  if (!reading) return false;
  if (!Number.isFinite(reading.totalBytes) || reading.totalBytes <= 0) return false;
  if (!Number.isFinite(reading.availBytes) || reading.availBytes < 0) return false;
  return reading.availBytes < memoryPressureFloor(reading.totalBytes);
}

/** 감시가 보는 프로세스 한 개. */
export interface GuardedProcess {
  pid: number;
  /** 사적 커밋(Windows) 또는 RSS(mac/Linux). 못 읽으면 `null` — 그 프로세스는 판정에서 빠진다. */
  memBytes: number | null;
  /** 에이전트 본체(우리가 직접 띄운 자식)인가. */
  isRoot: boolean;
  /** 어느 묶음(본체 pid)에 속하나. */
  rootPid: number;
}

/**
 * 압박 때 끊을 **하나** — 본체가 아닌 것 중 가장 큰 것(1GiB 이상). 그런 것이 없으면 아주 큰 본체(8GiB 이상).
 * 둘 다 없으면 `null` — 작은 것을 끊어 봐야 여유가 돌아오지 않고, 세션만 잃는다.
 */
export function pickPressureVictim<T extends GuardedProcess>(procs: readonly T[]): T | null {
  const largest = (pick: (p: T) => boolean, min: number): T | null => {
    let best: T | null = null;
    for (const p of procs) {
      if (!pick(p) || p.memBytes === null || p.memBytes < min) continue;
      if (!best || p.memBytes > (best.memBytes ?? 0)) best = p;
    }
    return best;
  };
  return largest((p) => !p.isRoot, PRESSURE_VICTIM_MIN_BYTES)
    ?? largest((p) => p.isRoot, PRESSURE_ROOT_VICTIM_MIN_BYTES);
}

/** 상한을 넘은 것들 — 감시가 상한을 맡는 자리(mac/Linux · 묶기 실패한 Windows)에서만 쓴다. */
export function overCapProcesses<T extends GuardedProcess>(procs: readonly T[], capBytes: number | null): T[] {
  if (capBytes === null) return [];
  return procs.filter((p) => p.memBytes !== null && p.memBytes > capBytes);
}

// ─── 묶음 API 가 없는 자리의 소속 판정 (mac/Linux · 묶기 실패한 Windows) ───

/** 목록 한 줄 — POSIX `ps -A -o pid=,ppid=,pgid=,rss=,args=` 또는 Windows 대체 목록. */
export interface ProcessSnapshotRow {
  pid: number;
  ppid: number;
  /** 프로세스 그룹(POSIX). Windows 대체 목록에는 없다. */
  pgid?: number;
  memBytes: number | null;
  /** 전체 명령줄(개행은 공백으로 접힌 상태). 못 읽으면 빈 문자열. */
  command: string;
}

/** 살아 있을 때 본 자손 — 부모가 먼저 죽어도 이것으로 찾는다. pid 재사용은 명령줄로 거른다. */
export interface RememberedDescendant {
  pid: number;
  command: string;
}

/**
 * 본체 `rootPid` 묶음의 프로세스(본체 포함, `isRoot`): ① 부모를 따라 내려간 자손 ② 본체 그룹(`pgid === rootPid`, detached 리더)
 * ③ 기억한 자손(명령줄 같을 때) ④ ①~③ 중 그룹 리더의 그룹 — 없으면 `setsid` 셸이 죽은 뒤 그 손자를 못 찾는다.
 * `rootAlive = false` 면 ③ 에서만 — 본체·그룹 번호는 이미 남의 것일 수 있다(POSIX 는 빈 그룹 번호를 새 pid 로 준다).
 * 살아 있는 동안 매 틱 그룹 구성원까지 기억하므로 놓치는 것은 그 사이 새로 생긴 것뿐이다.
 */
export function membersOfRoot(
  rows: readonly ProcessSnapshotRow[],
  rootPid: number,
  remembered: readonly RememberedDescendant[] = [],
  rootAlive = true,
): ProcessSnapshotRow[] {
  const byPid = new Map<number, ProcessSnapshotRow>();
  const byParent = new Map<number, ProcessSnapshotRow[]>();
  for (const r of rows) {
    byPid.set(r.pid, r);
    const list = byParent.get(r.ppid);
    if (list) list.push(r);
    else byParent.set(r.ppid, [r]);
  }
  const picked = new Map<number, ProcessSnapshotRow>();
  const queue: number[] = [];
  const take = (r: ProcessSnapshotRow): void => {
    if (picked.has(r.pid)) return;
    picked.set(r.pid, r);
    queue.push(r.pid);
  };

  const root = rootAlive ? byPid.get(rootPid) : undefined;
  if (root) take(root);
  if (rootAlive) for (const r of rows) if (r.pgid !== undefined && r.pgid === rootPid) take(r);
  for (const m of remembered) {
    const r = byPid.get(m.pid);
    if (r && r.command === m.command) take(r);
  }
  // 부모 사슬과 그룹 리더 관계를 닫힐 때까지 넓힌다.
  const leaders = new Set<number>();
  for (let i = 0; i < queue.length; i += 1) {
    const pid = queue[i];
    if (pid === undefined) break;
    const self = picked.get(pid);
    if (self && self.pgid === self.pid) leaders.add(pid);
    for (const child of byParent.get(pid) ?? []) take(child);
    if (leaders.has(pid)) {
      for (const r of rows) if (r.pgid === pid) take(r);
    }
  }
  return [...picked.values()];
}

/** 실행본 이름(경로·따옴표를 뗀 마지막 조각) — 알림에 싣는 이름. */
export function imageNameOf(command: string): string {
  const s = command.trim();
  const first = s.startsWith('"') ? s.slice(1, Math.max(1, s.indexOf('"', 1))) : s.split(/\s+/)[0] ?? '';
  const parts = first.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

// ─── 알림 한 줄 ───

const NOTICE_REASONS: ReadonlySet<string> = new Set<ProcessGuardNoticeReason>(['cap', 'pressure', 'session-end', 'task-killed']);
const NUMERIC_FIELDS = ['pid', 'memBytes', 'capBytes', 'availBytes', 'count'] as const;

/** 스트림에 남길 줄. 머리 `[process-guard]` 는 칩 패턴 밖이라 모든 밀도에서 보인다. */
export function formatProcessGuardNotice(notice: ProcessGuardNotice): string {
  return `${PROCESS_GUARD_NOTICE_TAG} ${JSON.stringify(notice)}`;
}

/** 그 줄을 다시 사실로. 모양이 다르면 `null`(임의 본문을 알림으로 오인하지 않는다). */
export function parseProcessGuardNotice(content: string): ProcessGuardNotice | null {
  const t = content.trim();
  if (!t.startsWith(`${PROCESS_GUARD_NOTICE_TAG} `)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(t.slice(PROCESS_GUARD_NOTICE_TAG.length + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const reason = obj['reason'];
  const enforcedBy = obj['enforcedBy'];
  if (typeof reason !== 'string' || !NOTICE_REASONS.has(reason)) return null;
  if (enforcedBy !== 'kernel' && enforcedBy !== 'watchdog') return null;
  const notice: ProcessGuardNotice = { reason: reason as ProcessGuardNoticeReason, enforcedBy };
  if (typeof obj['image'] === 'string' && obj['image'] !== '') notice.image = obj['image'];
  for (const key of NUMERIC_FIELDS) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) notice[key] = v;
  }
  return notice;
}
