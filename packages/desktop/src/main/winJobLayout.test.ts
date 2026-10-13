/**
 * §5.3 #9-2 (A) — Windows Job Object 구조체 배치를 고정한다.
 *
 * 이 값들은 2026-10-12 실측에서 **같은 오프셋으로** 묶음이 Claude Code 의 손자까지 잡고, 300MB 상한에서
 * 사고 grep 이 `Memory exhausted` 로 끝나고, 통지 포트로 `PROCESS_MEMORY_LIMIT` 가 오는 것을 확인한 값이다.
 * 한 바이트라도 밀리면 커널은 오류 없이 **다른 칸**을 읽는다 — 상한이 0 이 되거나 닫힘 동작이 사라져도
 * 아무 말이 없다. 그래서 이 파일은 숫자를 그대로 못 박는다(네이티브 모듈 없이 세 OS 시험기에서 돈다).
 */
import { describe, it, expect } from 'vitest';
import {
  EXT_LIMIT_SIZE,
  EXT_LIMIT_FLAGS_OFFSET,
  EXT_PROCESS_MEMORY_LIMIT_OFFSET,
  EXT_PEAK_PROCESS_MEMORY_OFFSET,
  JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
  JOB_OBJECT_LIMIT_PROCESS_MEMORY,
  JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO,
  JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT,
  MEMORYSTATUSEX_SIZE,
  MEMSTAT_AVAIL_PAGEFILE_OFFSET,
  MEMSTAT_TOTAL_PAGEFILE_OFFSET,
  PMC_PRIVATE_USAGE_OFFSET,
  PROCESS_MEMORY_COUNTERS_EX_SIZE,
  baseNameOf,
  decodeJobMessage,
  decodeProcessIdList,
  encodeExtendedLimits,
} from './winJobLayout.js';

const GiB = 1024 ** 3;

describe('§5.3 #9-2 Windows Job Object layout', () => {
  it('fixes the x64 sizes and offsets that were measured to work', () => {
    expect(EXT_LIMIT_SIZE).toBe(144); // BASIC 64 + IO_COUNTERS 48 + SIZE_T × 4
    expect(EXT_LIMIT_FLAGS_OFFSET).toBe(16);
    expect(EXT_PROCESS_MEMORY_LIMIT_OFFSET).toBe(112);
    expect(EXT_PEAK_PROCESS_MEMORY_OFFSET).toBe(128);
    expect(MEMORYSTATUSEX_SIZE).toBe(64);
    expect(MEMSTAT_TOTAL_PAGEFILE_OFFSET).toBe(24);
    expect(MEMSTAT_AVAIL_PAGEFILE_OFFSET).toBe(32);
    expect(PROCESS_MEMORY_COUNTERS_EX_SIZE).toBe(80);
    expect(PMC_PRIVATE_USAGE_OFFSET).toBe(72);
    expect(JOB_OBJECT_LIMIT_PROCESS_MEMORY).toBe(0x100);
    expect(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE).toBe(0x2000);
  });

  it('writes kill-on-close and the per-process cap into the right fields', () => {
    const buf = encodeExtendedLimits({ memoryCapBytes: 32 * GiB, killOnClose: true });
    expect(buf.length).toBe(EXT_LIMIT_SIZE);
    expect(buf.readUInt32LE(EXT_LIMIT_FLAGS_OFFSET)).toBe(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_PROCESS_MEMORY);
    expect(buf.readBigUInt64LE(EXT_PROCESS_MEMORY_LIMIT_OFFSET)).toBe(BigInt(32 * GiB));
  });

  it('turns the memory flag off — and leaves the value at 0 — when there is no cap', () => {
    for (const memoryCapBytes of [null, 0, -1, Number.NaN]) {
      const buf = encodeExtendedLimits({ memoryCapBytes, killOnClose: false });
      expect(buf.readUInt32LE(EXT_LIMIT_FLAGS_OFFSET)).toBe(0);
      expect(buf.readBigUInt64LE(EXT_PROCESS_MEMORY_LIMIT_OFFSET)).toBe(0n);
    }
  });

  it('keeps kill-on-close independent of the cap (codex roots: cap without kill)', () => {
    const buf = encodeExtendedLimits({ memoryCapBytes: 16 * GiB, killOnClose: false });
    expect(buf.readUInt32LE(EXT_LIMIT_FLAGS_OFFSET)).toBe(JOB_OBJECT_LIMIT_PROCESS_MEMORY);
  });

  it('reads the pid list and never reads past the buffer', () => {
    const buf = Buffer.alloc(8 + 8 * 3);
    buf.writeUInt32LE(5, 0); // assigned
    buf.writeUInt32LE(3, 4); // listed
    [41832, 20700, 7].forEach((pid, i) => buf.writeBigUInt64LE(BigInt(pid), 8 + 8 * i));
    expect(decodeProcessIdList(buf)).toEqual([41832, 20700, 7]);

    const lying = Buffer.alloc(8 + 8 * 2);
    lying.writeUInt32LE(99, 4); // claims more than fits
    expect(decodeProcessIdList(lying)).toHaveLength(2);
    expect(decodeProcessIdList(Buffer.alloc(4))).toEqual([]);
  });

  it('maps only the two port messages the guard uses', () => {
    expect(decodeJobMessage(JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT, 45964)).toEqual({ kind: 'memory-limit', pid: 45964 });
    expect(decodeJobMessage(JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO, 0)).toEqual({ kind: 'empty' });
    // NEW_PROCESS(6)·EXIT_PROCESS(7) — Claude Code 는 시작할 때 수십 개를 띄운다. 감시는 쓰지 않는다.
    expect(decodeJobMessage(6, 123)).toBeNull();
    expect(decodeJobMessage(7, 123)).toBeNull();
  });

  it('takes the last path piece for either separator', () => {
    expect(baseNameOf('C:\\Program Files\\Git\\usr\\bin\\grep.exe')).toBe('grep.exe');
    expect(baseNameOf('C:/Program Files/Git/usr/bin/grep.exe')).toBe('grep.exe');
    expect(baseNameOf('grep.exe')).toBe('grep.exe');
  });
});
