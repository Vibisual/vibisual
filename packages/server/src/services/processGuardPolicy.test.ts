/** §5.3 #9-2 — 자손 보호 판정(shared `processGuardPolicy.ts`) 고정. 폭주를 못 끊으면 앱이 꺼지고 엉뚱한 것을 끊으면 정당한 작업이 죽는다 — 2026-10-12 사고 실측 숫자와 "걸리면 안 된다" 쪽을 함께 쓴다. */
import { describe, it, expect } from 'vitest';
import {
  MEMORY_PRESSURE_FLOOR_MIN_BYTES,
  PRESSURE_ROOT_VICTIM_MIN_BYTES,
  PRESSURE_VICTIM_MIN_BYTES,
  PROCESS_GUARD_NOTICE_TAG,
  PROCESS_MEMORY_CAP_FLOOR_BYTES,
  formatProcessGuardNotice,
  imageNameOf,
  isUnderMemoryPressure,
  memoryPressureFloor,
  membersOfRoot,
  overCapProcesses,
  parseProcessGuardNotice,
  parseSystemSubtype,
  pickPressureVictim,
  resolveProcessMemoryCap,
  type GuardedProcess,
  type ProcessSnapshotRow,
} from '@vibisual/shared';

const GiB = 1024 ** 3;

describe('resolveProcessMemoryCap — 프로세스 하나의 상한', () => {
  it('is the share of RAM, but never below the floor (large builds must still fit)', () => {
    expect(resolveProcessMemoryCap(64 * GiB, 50)).toBe(32 * GiB); // 사고 기계
    expect(resolveProcessMemoryCap(16 * GiB, 50)).toBe(PROCESS_MEMORY_CAP_FLOOR_BYTES);
    expect(resolveProcessMemoryCap(8 * GiB, 10)).toBe(PROCESS_MEMORY_CAP_FLOOR_BYTES);
  });

  it('0 or below means no cap at all', () => {
    expect(resolveProcessMemoryCap(64 * GiB, 0)).toBeNull();
    expect(resolveProcessMemoryCap(64 * GiB, -5)).toBeNull();
    expect(resolveProcessMemoryCap(64 * GiB, Number.NaN)).toBeNull();
  });

  it('still guards an unknown machine with the floor, and clamps above 100%', () => {
    expect(resolveProcessMemoryCap(0, 50)).toBe(PROCESS_MEMORY_CAP_FLOOR_BYTES);
    expect(resolveProcessMemoryCap(64 * GiB, 250)).toBe(64 * GiB);
  });
});

describe('isUnderMemoryPressure — 시스템 압박', () => {
  it('fires on the incident numbers (commit limit 171.54 GB, 256 MB left)', () => {
    expect(isUnderMemoryPressure({ totalBytes: 171_542_917_120, availBytes: 171_542_917_120 - 171_287_130_112 })).toBe(true);
  });

  it('stays quiet with normal headroom, and on unknown readings (unknown ≠ empty)', () => {
    expect(isUnderMemoryPressure({ totalBytes: 171_542_917_120, availBytes: 80 * GiB })).toBe(false);
    expect(isUnderMemoryPressure(null)).toBe(false);
    expect(isUnderMemoryPressure({ totalBytes: 0, availBytes: 0 })).toBe(false);
    expect(isUnderMemoryPressure({ totalBytes: 64 * GiB, availBytes: Number.NaN })).toBe(false);
  });

  it('uses 5% of the total, but at least the minimum', () => {
    expect(memoryPressureFloor(171_542_917_120)).toBe(Math.floor(171_542_917_120 * 0.05));
    expect(memoryPressureFloor(16 * GiB)).toBe(MEMORY_PRESSURE_FLOOR_MIN_BYTES);
    expect(memoryPressureFloor(Number.NaN)).toBe(MEMORY_PRESSURE_FLOOR_MIN_BYTES);
  });
});

const proc = (pid: number, gib: number | null, isRoot = false, rootPid = 1): GuardedProcess => ({
  pid, memBytes: gib === null ? null : gib * GiB, isRoot, rootPid,
});

describe('pickPressureVictim — 압박 때 끊을 하나', () => {
  it('takes the largest non-root process (the incident: grep over its claude)', () => {
    const claude = proc(100, 0.4, true);
    const grepA = proc(46168, 49);
    const grepB = proc(45884, 47.8);
    expect(pickPressureVictim([claude, grepB, grepA])).toBe(grepA); // 같은 객체를 돌려준다
  });

  it('ignores small processes — killing them would not bring memory back', () => {
    expect(pickPressureVictim([proc(1, 0.5), proc(2, 0.9), proc(3, null)])).toBeNull();
    expect(pickPressureVictim([proc(1, PRESSURE_VICTIM_MIN_BYTES / GiB)])?.pid).toBe(1);
  });

  it('touches an agent root only when it is itself huge, and only if no child qualifies', () => {
    expect(pickPressureVictim([proc(10, 6, true)])).toBeNull();
    expect(pickPressureVictim([proc(10, PRESSURE_ROOT_VICTIM_MIN_BYTES / GiB, true)])?.pid).toBe(10);
    expect(pickPressureVictim([proc(10, 20, true), proc(11, 2)])?.pid).toBe(11);
  });
});

describe('overCapProcesses — 감시가 상한을 맡는 자리', () => {
  it('returns only what is over the cap, never on unknown memory, nothing without a cap', () => {
    const over = proc(1, 40);
    expect(overCapProcesses([over, proc(2, 10), proc(3, null)], 32 * GiB)).toEqual([over]);
    expect(overCapProcesses([over], null)).toEqual([]);
  });
});

const row = (pid: number, ppid: number, pgid: number | undefined, command: string, mem = 1024): ProcessSnapshotRow => ({
  pid, ppid, ...(pgid !== undefined ? { pgid } : {}), memBytes: mem, command,
});

describe('membersOfRoot — 묶음 API 가 없는 자리의 소속', () => {
  const ROOT = 500;
  const rows: ProcessSnapshotRow[] = [
    row(1, 0, 1, '/sbin/launchd'),
    row(400, 1, 400, '/Applications/Vibisual.app/Contents/MacOS/Vibisual'), // 앱 자신
    row(ROOT, 400, ROOT, 'claude --input-format stream-json'),
    row(501, ROOT, ROOT, 'bash -c npm test'), // ① 부모 사슬
    row(502, 1, ROOT, 'node worker.js'), // ② 부모는 죽었지만 그룹이 남았다
    row(600, 1, 600, 'bash -c "grep -o .{0,3000}x activity.json"'), // ③ setsid 셸 — 기억해 둔 것
    row(601, 600, 600, 'grep -o .{0,3000}x activity.json'), // ④ 기억한 리더의 그룹
    row(700, 1, 700, 'UnrealEditor.exe'), // 남의 것
  ];

  it('collects the parent chain, the root group, remembered orphans and their groups', () => {
    const got = membersOfRoot(rows, ROOT, [{ pid: 600, command: 'bash -c "grep -o .{0,3000}x activity.json"' }]).map((r) => r.pid).sort((a, b) => a - b);
    expect(got).toEqual([ROOT, 501, 502, 600, 601]);
  });

  it('never takes the app, launchd or a stranger', () => {
    const got = membersOfRoot(rows, ROOT, []).map((r) => r.pid);
    expect(got).not.toContain(400);
    expect(got).not.toContain(1);
    expect(got).not.toContain(700);
  });

  it('drops a remembered pid whose command changed (the number was reused)', () => {
    const got = membersOfRoot(rows, ROOT, [{ pid: 700, command: 'grep something' }]).map((r) => r.pid);
    expect(got).not.toContain(700);
  });

  it('after the root died, starts only from what was remembered — the root number may belong to a stranger now', () => {
    const reused: ProcessSnapshotRow[] = [
      row(ROOT, 1, ROOT, 'some-other-program --daemon'), // 같은 번호, 남의 것
      row(800, ROOT, ROOT, 'some-other-child'),
      row(600, 1, 600, 'bash -c "grep -o .{0,3000}x activity.json"'),
      row(601, 600, 600, 'grep -o .{0,3000}x activity.json'),
    ];
    const got = membersOfRoot(reused, ROOT, [{ pid: 600, command: 'bash -c "grep -o .{0,3000}x activity.json"' }], false)
      .map((r) => r.pid).sort((a, b) => a - b);
    expect(got).toEqual([600, 601]);
  });

  it('works on Windows fallback rows (no pgid) through the parent chain only', () => {
    const win: ProcessSnapshotRow[] = [
      row(ROOT, 9, undefined, '"C:\\…\\claude.exe" --input-format stream-json'),
      row(510, ROOT, undefined, '"C:\\Program Files\\Git\\bin\\bash.exe" -c ...'),
      row(511, 510, undefined, '"C:\\Program Files\\Git\\usr\\bin\\grep.exe" -o ...'),
    ];
    expect(membersOfRoot(win, ROOT, []).map((r) => r.pid).sort((a, b) => a - b)).toEqual([ROOT, 510, 511]);
  });
});

describe('imageNameOf', () => {
  it('keeps only the program name', () => {
    expect(imageNameOf('"C:\\Program Files\\Git\\usr\\bin\\grep.exe" -o ".\\{0,3000\\}x"')).toBe('grep.exe');
    expect(imageNameOf('/usr/bin/grep -o x file')).toBe('grep');
    expect(imageNameOf('node')).toBe('node');
    expect(imageNameOf('')).toBe('');
  });
});

describe('notice line — 세션 스트림의 한 줄', () => {
  const notice = { reason: 'pressure' as const, enforcedBy: 'watchdog' as const, image: 'grep.exe', pid: 46168, memBytes: 49 * GiB, availBytes: 256 * 1024 ** 2 };

  it('round-trips the facts', () => {
    expect(parseProcessGuardNotice(formatProcessGuardNotice(notice))).toEqual(notice);
  });

  it('is NOT a system chip — standard/compact density hide chips, and this line must stay visible', () => {
    const line = formatProcessGuardNotice(notice);
    expect(line.startsWith(PROCESS_GUARD_NOTICE_TAG)).toBe(true);
    expect(parseSystemSubtype(line)).toBeNull();
  });

  it('rejects anything that is not exactly our line', () => {
    expect(parseProcessGuardNotice('[permission] ALLOW — you pressed Allow on Bash')).toBeNull();
    expect(parseProcessGuardNotice('[process_guard] {"reason":"cap","enforcedBy":"kernel"}')).toBeNull();
    expect(parseProcessGuardNotice(`${PROCESS_GUARD_NOTICE_TAG} not-json`)).toBeNull();
    expect(parseProcessGuardNotice(`${PROCESS_GUARD_NOTICE_TAG} {"reason":"boom","enforcedBy":"kernel"}`)).toBeNull();
    expect(parseProcessGuardNotice(`${PROCESS_GUARD_NOTICE_TAG} {"reason":"cap","enforcedBy":"someone"}`)).toBeNull();
  });

  it('drops malformed numbers instead of showing them', () => {
    const parsed = parseProcessGuardNotice(`${PROCESS_GUARD_NOTICE_TAG} {"reason":"session-end","enforcedBy":"watchdog","count":-3,"pid":"x"}`);
    expect(parsed).toEqual({ reason: 'session-end', enforcedBy: 'watchdog' });
  });
});
