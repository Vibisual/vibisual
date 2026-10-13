import type { ContainmentEvent, ContainmentLimits } from '@vibisual/server';

// §5.3 #9-2 (A) — Windows Job Object 의 **구조체 배치와 메시지 해석**(순수). koffi 바인딩(`winJobObject.ts`)과
// 떼어 둔 이유는 시험이다 — 이 파일은 네이티브 모듈을 싣지 않아 세 OS 의 시험기에서 오프셋을 그대로 고정한다.
// 오프셋은 2026-10-12 실측(같은 값으로 묶음·상한·통지가 동작함을 확인)과 winJobObject.test.ts 가 함께 지킨다.

// ─── 구조체 배치(x64) — 버퍼로 직접 채운다 ───

/** JOBOBJECT_EXTENDED_LIMIT_INFORMATION = BASIC(64) + IO_COUNTERS(48) + SIZE_T×4. */
export const EXT_LIMIT_SIZE = 144;
/** BasicLimitInformation.LimitFlags (PerProcessUserTimeLimit·PerJobUserTimeLimit 8바이트씩 뒤). */
export const EXT_LIMIT_FLAGS_OFFSET = 16;
/** ProcessMemoryLimit (BASIC 64 + IO 48). */
export const EXT_PROCESS_MEMORY_LIMIT_OFFSET = 112;
/** PeakProcessMemoryUsed. */
export const EXT_PEAK_PROCESS_MEMORY_OFFSET = 128;

export const JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x0000_0100;
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x0000_2000;

export const JOB_INFO_BASIC_PROCESS_ID_LIST = 3;
export const JOB_INFO_ASSOCIATE_COMPLETION_PORT = 7;
export const JOB_INFO_EXTENDED_LIMIT = 9;
/** JOBOBJECT_ASSOCIATE_COMPLETION_PORT = PVOID CompletionKey + HANDLE CompletionPort. */
export const PORT_INFO_SIZE = 16;

export const JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO = 4;
export const JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT = 9;

export const PROCESS_TERMINATE = 0x0001;
export const PROCESS_VM_READ = 0x0010;
export const PROCESS_SET_QUOTA = 0x0100;
export const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

/** 묶음 하나에서 한 번에 읽는 pid 수 — 넘치면 앞의 것만(감시는 다음 틱에 다시 읽는다). */
export const PID_LIST_CAPACITY = 1024;
/** 한 번 비울 때 꺼낼 통지 상한 — Claude Code 는 시작할 때 짧은 자식을 수십 개 띄운다(실측 10초에 ~100). */
export const DRAIN_MAX = 10_000;
/** 강제 종료 시 남기는 종료 코드. */
export const TERMINATE_EXIT_CODE = 1;
/** MEMORYSTATUSEX — dwLength·dwMemoryLoad 뒤에 DWORDLONG 7개. */
export const MEMORYSTATUSEX_SIZE = 64;
export const MEMSTAT_TOTAL_PAGEFILE_OFFSET = 24; // 커밋 한도
export const MEMSTAT_AVAIL_PAGEFILE_OFFSET = 32; // 커밋 여유
/** PROCESS_MEMORY_COUNTERS_EX — PrivateUsage 가 마지막 SIZE_T. */
export const PROCESS_MEMORY_COUNTERS_EX_SIZE = 80;
export const PMC_PRIVATE_USAGE_OFFSET = 72;
/** QueryFullProcessImageNameW 버퍼(UTF-16 글자 수). */
export const IMAGE_NAME_CHARS = 1024;

/** 순수 — 확장 한도 구조체를 채운다. 상한이 없으면 PROCESS_MEMORY 깃발을 끄고 값을 0 으로 둔다. */
export function encodeExtendedLimits(limits: ContainmentLimits): Buffer {
  const buf = Buffer.alloc(EXT_LIMIT_SIZE);
  let flags = 0;
  if (limits.killOnClose) flags |= JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (limits.memoryCapBytes !== null && Number.isFinite(limits.memoryCapBytes) && limits.memoryCapBytes > 0) {
    flags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY;
    buf.writeBigUInt64LE(BigInt(Math.floor(limits.memoryCapBytes)), EXT_PROCESS_MEMORY_LIMIT_OFFSET);
  }
  buf.writeUInt32LE(flags, EXT_LIMIT_FLAGS_OFFSET);
  return buf;
}

/** 순수 — JOBOBJECT_BASIC_PROCESS_ID_LIST(DWORD 2개 뒤에 ULONG_PTR 배열)를 읽는다. */
export function decodeProcessIdList(buf: Buffer): number[] {
  if (buf.length < 8) return [];
  const listed = buf.readUInt32LE(4);
  const room = Math.floor((buf.length - 8) / 8);
  const n = Math.min(listed, room);
  const ids: number[] = [];
  for (let i = 0; i < n; i += 1) ids.push(Number(buf.readBigUInt64LE(8 + 8 * i)));
  return ids;
}

/** 순수 — 통지 포트의 메시지 하나(바이트 수 칸 = 메시지 종류, overlapped 칸 = pid)를 우리 이벤트로. */
export function decodeJobMessage(message: number, pid: number): ContainmentEvent | null {
  if (message === JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT) return { kind: 'memory-limit', pid };
  if (message === JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO) return { kind: 'empty' };
  return null; // 새 프로세스·종료 같은 나머지는 감시가 쓰지 않는다
}

/** 경로의 마지막 조각(`C:\…\grep.exe` → `grep.exe`). */
export function baseNameOf(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

