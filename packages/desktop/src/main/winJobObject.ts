import koffi from 'koffi';
import { recordDiagnostic, type ContainmentBackend, type ContainmentEvent, type ContainmentHandle, type ContainmentLimits } from '@vibisual/server';
import {
  EXT_LIMIT_SIZE, PORT_INFO_SIZE, JOB_INFO_ASSOCIATE_COMPLETION_PORT, JOB_INFO_BASIC_PROCESS_ID_LIST, JOB_INFO_EXTENDED_LIMIT,
  PROCESS_TERMINATE, PROCESS_VM_READ, PROCESS_SET_QUOTA, PROCESS_QUERY_LIMITED_INFORMATION,
  PID_LIST_CAPACITY, DRAIN_MAX, TERMINATE_EXIT_CODE, MEMORYSTATUSEX_SIZE, MEMSTAT_TOTAL_PAGEFILE_OFFSET,
  MEMSTAT_AVAIL_PAGEFILE_OFFSET, PROCESS_MEMORY_COUNTERS_EX_SIZE, PMC_PRIVATE_USAGE_OFFSET, IMAGE_NAME_CHARS,
  encodeExtendedLimits, decodeProcessIdList, decodeJobMessage, baseNameOf,
} from './winJobLayout.js';

// §5.3 #9-2 (A) — Windows Job Object 백엔드(koffi · kernel32, main 전용). 에이전트 자식마다 묶음을 만들어 스폰 직후 넣으면 손자까지 든다 —
// libuv 기본 묶음은 `SILENT_BREAKAWAY_OK` 라 직계만 묶고, Claude Code 도 같은 깃발로 bash 를 놓는다.
// 실측(2026-10-12, Claude Code 2.1.296): Bash 도구의 자손 전부 묶음 안·정상 동작, KILL_ON_JOB_CLOSE 2초 안 트리 소멸, grep 300MB 상한 0.1초에 종료 + 통지.
// 바인딩 실패는 `null` — 서버 감시가 받친다.

// ─── kernel32 바인딩(지연 로드, 1회) ───

interface Kernel32 {
  CreateJobObjectW: (attrs: null, name: null) => unknown;
  SetInfoBuf: (job: unknown, cls: number, info: Buffer, len: number) => number;
  SetInfoPort: (job: unknown, cls: number, info: { CompletionKey: null; CompletionPort: unknown }, len: number) => number;
  AssignProcessToJobObject: (job: unknown, proc: unknown) => number;
  QueryInformationJobObject: (job: unknown, cls: number, info: Buffer, len: number, retLen: null) => number;
  TerminateJobObject: (job: unknown, exitCode: number) => number;
  OpenProcess: (access: number, inherit: number, pid: number) => unknown;
  CloseHandle: (h: unknown) => number;
  TerminateProcess: (h: unknown, exitCode: number) => number;
  CreateIoCompletionPort: (file: number, existing: null, key: number, threads: number) => unknown;
  GetQueuedCompletionStatus: (port: unknown, bytes: Buffer, key: Buffer, ov: Buffer, ms: number) => number;
  GlobalMemoryStatusEx: (buf: Buffer) => number;
  K32GetProcessMemoryInfo: (h: unknown, buf: Buffer, cb: number) => number;
  QueryFullProcessImageNameW: (h: unknown, flags: number, buf: Buffer, size: Buffer) => number;
}

let kernel32: Kernel32 | null | undefined;

function loadKernel32(): Kernel32 | null {
  if (kernel32 !== undefined) return kernel32;
  try {
    const lib = koffi.load('kernel32.dll');
    const portInfo = koffi.struct('VIB_JOBOBJECT_ASSOCIATE_COMPLETION_PORT', { CompletionKey: 'void*', CompletionPort: 'void*' });
    kernel32 = {
      CreateJobObjectW: lib.func('void* __stdcall CreateJobObjectW(void* attrs, void* name)') as Kernel32['CreateJobObjectW'],
      SetInfoBuf: lib.func('SetInformationJobObject', 'int', ['void*', 'int', 'void*', 'uint32']) as Kernel32['SetInfoBuf'],
      SetInfoPort: lib.func('SetInformationJobObject', 'int', ['void*', 'int', koffi.pointer(portInfo), 'uint32']) as Kernel32['SetInfoPort'],
      AssignProcessToJobObject: lib.func('int __stdcall AssignProcessToJobObject(void* job, void* proc)') as Kernel32['AssignProcessToJobObject'],
      QueryInformationJobObject: lib.func('int __stdcall QueryInformationJobObject(void* job, int cls, void* info, uint32 len, void* retLen)') as Kernel32['QueryInformationJobObject'],
      TerminateJobObject: lib.func('int __stdcall TerminateJobObject(void* job, uint32 exitCode)') as Kernel32['TerminateJobObject'],
      OpenProcess: lib.func('void* __stdcall OpenProcess(uint32 access, int inherit, uint32 pid)') as Kernel32['OpenProcess'],
      CloseHandle: lib.func('int __stdcall CloseHandle(void* h)') as Kernel32['CloseHandle'],
      TerminateProcess: lib.func('int __stdcall TerminateProcess(void* h, uint32 exitCode)') as Kernel32['TerminateProcess'],
      CreateIoCompletionPort: lib.func('void* __stdcall CreateIoCompletionPort(intptr_t file, void* existing, uintptr_t key, uint32 threads)') as Kernel32['CreateIoCompletionPort'],
      GetQueuedCompletionStatus: lib.func('int __stdcall GetQueuedCompletionStatus(void* port, void* bytes, void* key, void* ov, uint32 ms)') as Kernel32['GetQueuedCompletionStatus'],
      GlobalMemoryStatusEx: lib.func('int __stdcall GlobalMemoryStatusEx(void* buf)') as Kernel32['GlobalMemoryStatusEx'],
      K32GetProcessMemoryInfo: lib.func('int __stdcall K32GetProcessMemoryInfo(void* h, void* buf, uint32 cb)') as Kernel32['K32GetProcessMemoryInfo'],
      QueryFullProcessImageNameW: lib.func('int __stdcall QueryFullProcessImageNameW(void* h, uint32 flags, void* buf, void* size)') as Kernel32['QueryFullProcessImageNameW'],
    };
  } catch (err) {
    recordDiagnostic('main', 'warn', `process guard: kernel32 bind failed — the watchdog takes over: ${err instanceof Error ? err.message : String(err)}`);
    kernel32 = null;
  }
  return kernel32;
}

/** pid 하나를 열어 `use` 를 부르고 닫는다. 못 열면 `null`. */
function withProcess<T>(api: Kernel32, pid: number, access: number, use: (h: unknown) => T): T | null {
  const h = api.OpenProcess(access, 0, pid);
  if (!h) return null;
  try {
    return use(h);
  } finally {
    api.CloseHandle(h);
  }
}

// ─── 묶음 하나 ───

class WinJobHandle implements ContainmentHandle {
  private job: unknown;
  private port: unknown;

  constructor(private readonly api: Kernel32, job: unknown, port: unknown) {
    this.job = job;
    this.port = port;
  }

  members(): number[] | null {
    if (!this.job) return null;
    const buf = Buffer.alloc(8 + 8 * PID_LIST_CAPACITY);
    // 자리가 모자라면 실패(ERROR_MORE_DATA)하면서도 채울 수 있는 만큼은 채운다 — 읽은 만큼 쓴다.
    this.api.QueryInformationJobObject(this.job, JOB_INFO_BASIC_PROCESS_ID_LIST, buf, buf.length, null);
    return decodeProcessIdList(buf);
  }

  drain(): ContainmentEvent[] {
    if (!this.port) return [];
    const out: ContainmentEvent[] = [];
    const bytes = Buffer.alloc(4);
    const key = Buffer.alloc(8);
    const ov = Buffer.alloc(8);
    for (let i = 0; i < DRAIN_MAX; i += 1) {
      if (!this.api.GetQueuedCompletionStatus(this.port, bytes, key, ov, 0)) break;
      const ev = decodeJobMessage(bytes.readUInt32LE(0), Number(ov.readBigUInt64LE(0)));
      if (ev) out.push(ev);
    }
    return out;
  }

  setLimits(limits: ContainmentLimits): boolean {
    if (!this.job) return false;
    return this.api.SetInfoBuf(this.job, JOB_INFO_EXTENDED_LIMIT, encodeExtendedLimits(limits), EXT_LIMIT_SIZE) !== 0;
  }

  terminate(): number {
    if (!this.job) return 0;
    const before = this.members()?.length ?? 0;
    this.api.TerminateJobObject(this.job, TERMINATE_EXIT_CODE);
    return before;
  }

  close(): void {
    if (this.job) this.api.CloseHandle(this.job);
    if (this.port) this.api.CloseHandle(this.port);
    this.job = null;
    this.port = null;
  }
}

// ─── 백엔드 ───

class WinJobBackend implements ContainmentBackend {
  constructor(private readonly api: Kernel32) {}

  contain(pid: number, limits: ContainmentLimits): ContainmentHandle | null {
    const api = this.api;
    const job = api.CreateJobObjectW(null, null);
    if (!job) return null;
    if (!api.SetInfoBuf(job, JOB_INFO_EXTENDED_LIMIT, encodeExtendedLimits(limits), EXT_LIMIT_SIZE)) {
      api.CloseHandle(job);
      return null;
    }
    // 통지 포트 — 없어도 묶음은 동작한다(상한 통지만 못 받는다).
    let port: unknown = api.CreateIoCompletionPort(-1, null, 0, 1);
    if (port && !api.SetInfoPort(job, JOB_INFO_ASSOCIATE_COMPLETION_PORT, { CompletionKey: null, CompletionPort: port }, PORT_INFO_SIZE)) {
      api.CloseHandle(port);
      port = null;
    }
    const assigned = withProcess(api, pid, PROCESS_SET_QUOTA | PROCESS_TERMINATE, (h) => api.AssignProcessToJobObject(job, h) !== 0);
    if (!assigned) {
      if (port) api.CloseHandle(port);
      api.CloseHandle(job);
      return null;
    }
    return new WinJobHandle(api, job, port);
  }

  commitMemory(): { totalBytes: number; availBytes: number } | null {
    const buf = Buffer.alloc(MEMORYSTATUSEX_SIZE);
    buf.writeUInt32LE(MEMORYSTATUSEX_SIZE, 0);
    if (!this.api.GlobalMemoryStatusEx(buf)) return null;
    return {
      totalBytes: Number(buf.readBigUInt64LE(MEMSTAT_TOTAL_PAGEFILE_OFFSET)),
      availBytes: Number(buf.readBigUInt64LE(MEMSTAT_AVAIL_PAGEFILE_OFFSET)),
    };
  }

  processMemory(pid: number): number | null {
    return withProcess(this.api, pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, (h) => {
      const buf = Buffer.alloc(PROCESS_MEMORY_COUNTERS_EX_SIZE);
      buf.writeUInt32LE(PROCESS_MEMORY_COUNTERS_EX_SIZE, 0);
      return this.api.K32GetProcessMemoryInfo(h, buf, PROCESS_MEMORY_COUNTERS_EX_SIZE)
        ? Number(buf.readBigUInt64LE(PMC_PRIVATE_USAGE_OFFSET))
        : null;
    });
  }

  processImage(pid: number): string | null {
    return withProcess(this.api, pid, PROCESS_QUERY_LIMITED_INFORMATION, (h) => {
      const buf = Buffer.alloc(IMAGE_NAME_CHARS * 2);
      const size = Buffer.alloc(4);
      size.writeUInt32LE(IMAGE_NAME_CHARS, 0);
      if (!this.api.QueryFullProcessImageNameW(h, 0, buf, size)) return null;
      return baseNameOf(buf.toString('utf16le', 0, size.readUInt32LE(0) * 2)) || null;
    });
  }

  killProcess(pid: number): boolean {
    return withProcess(this.api, pid, PROCESS_TERMINATE, (h) => this.api.TerminateProcess(h, TERMINATE_EXIT_CODE) !== 0) ?? false;
  }
}

/** Windows 에서만 백엔드를 짓는다. 다른 OS·바인딩 실패는 `null` — 서버가 detached 그룹 + 감시로 받친다. */
export function createWindowsJobBackend(platform: NodeJS.Platform): ContainmentBackend | null {
  if (platform !== 'win32') return null;
  const api = loadKernel32();
  return api ? new WinJobBackend(api) : null;
}
