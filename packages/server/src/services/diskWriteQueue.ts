/**
 * diskWriteQueue.ts — §9 "디스크 쓰기는 워커 스레드로".
 *
 * **왜**: 체크포인트 저장의 마지막 구간은 백업 회전과 원자적 쓰기(`open`→`write`→`fsync`→
 * `rename`→디렉토리 `fsync`)라는 **동기 디스크 I/O** 다. 서버 코어가 Electron 메인 프로세스와
 * 한 몸이라(§3.7) 그 시간이 그대로 UI 정지다 — 열린 탭 7개 기준 한 번의 저장이 최대 21벌의
 * fsync 를 메인 스레드에서 치렀다.
 *
 * **무엇을 하나**: 직렬화가 끝난 **문자열**을 워커 스레드에 넘기고 메인은 즉시 돌아온다.
 * 문자열 전달은 구조화 클론이라 해도 사실상 memcpy 라, 넘기는 비용이 fsync 대기보다 훨씬 싸다.
 *
 * **§3.7 과 어긋나지 않는다**: §3.7 이 금지한 것은 **child 프로세스 spawn**(별도 프로세스·별도
 * 수명·따로 죽는 서버)이다. `worker_threads` 는 같은 프로세스 안의 스레드라 프로세스 모델·수명
 * 공유·"소켓 없음"이 전부 그대로다. 워커는 메인이 죽으면 같이 죽는다.
 *
 * **정확성 규약 (§3.2.1 내구성 우선)**
 *  1. 워커는 **"무엇을 쓸지" 판단하지 않는다.** 통째-0 가드·shrink guard·묘비·죽은 워크트리
 *     판정은 전부 메인에 남는다. 워커는 "받은 것을 안전하게 쓴다"만 한다.
 *  2. **한 번에 한 건**(in-flight 1) + FIFO. 같은 파일의 두 저장이 순서를 바꿔 앉지 않는다.
 *  3. 메인은 기록이 확인될 때까지 payload 를 들고 있다가, 종료 시 남은 것을 **동기로 직접 쓴다**.
 *  4. 워커가 없거나(테스트·미가동) 큐가 가득 차면 **조용히 동기 쓰기로 되돌아간다** —
 *     워커는 성능 경로일 뿐 정확성 경로가 아니다.
 *
 * ⚠ **읽기 전에는 반드시 flush** — 큐에 남은 쓰기가 있는 상태에서 같은 파일을 읽으면 옛 내용을
 *   본다. 체크포인트 읽기 경로(부팅 hydrate·탭 재hydrate)는 `flushPendingDiskWritesSync()` 를
 *   먼저 부른다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { logger } from '../logger.js';

/** 큐에 쌓아 둘 수 있는 최대 건수 — 넘으면 호출자가 동기로 쓴다(메모리 상한). */
const MAX_QUEUED_JOBS = 64;
/** 큐가 들고 있을 수 있는 최대 바이트(문자열 길이 합) — 넘으면 동기 폴백. */
const MAX_QUEUED_BYTES = 64 * 1024 * 1024;

interface WriteJob {
  id: number;
  filePath: string;
  data: string;
}

/**
 * 워커 소스. **파일이 아니라 문자열**로 띄운다 — electron-vite 번들·asar 패키징에서 별도 청크
 * 경로를 해석할 필요가 없어 배포 형태와 무관하게 항상 같은 방식으로 동작한다.
 *
 * ⚠ 이 안의 쓰기 절차는 `writeFileAtomicSyncRaw()` 와 **바이트 단위로 같은 순서**여야 한다
 *   (tmp 쓰기 → fsync → rename → 디렉토리 fsync). 한쪽만 고치면 내구성 보장이 갈라진다.
 *   `diskWriteQueue.test.ts` 가 두 경로의 결과 동일성을 고정한다.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const stop = new Int32Array(workerData.stop);

parentPort.on('message', (job) => {
  // 임시 파일 이름에 job id 를 넣는다 — 종료 시 메인이 같은 파일을 동기로 쓰더라도
  // '<file>.tmp' 하나를 두 스레드가 동시에 열어 Windows 에서 EPERM 이 나는 일이 없다.
  const tmp = job.filePath + '.w' + job.id + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, job.data, 'utf8');
      try { fs.fsyncSync(fd); } catch (e) { /* 일부 FS 는 fsync 미지원 — best effort */ }
    } finally {
      fs.closeSync(fd);
    }
    // 종료 flush 가 시작됐으면 rename(=커밋) 하지 않는다. 메인이 같은 내용을 동기로 마무리한다.
    if (Atomics.load(stop, 0) === 1) {
      try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
      parentPort.postMessage({ id: job.id, ok: false, aborted: true });
      return;
    }
    fs.renameSync(tmp, job.filePath);
    try {
      const dfd = fs.openSync(path.dirname(job.filePath), 'r');
      try { fs.fsyncSync(dfd); } catch (e) { /* Windows 등은 디렉토리 fsync 미지원 */ }
      finally { fs.closeSync(dfd); }
    } catch (e) { /* rename 자체는 이미 완료 */ }
    parentPort.postMessage({ id: job.id, ok: true });
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (e) { /* noop */ }
    parentPort.postMessage({ id: job.id, ok: false, error: String((err && err.message) || err) });
  }
});
`;

let worker: Worker | null = null;
let enabled = false;
let stopFlag: Int32Array | null = null;
let nextJobId = 1;

/** 아직 디스크 도달이 확인되지 않은 작업들(도착 순서 유지 — Map 은 삽입 순서를 보존한다). */
const pending = new Map<number, WriteJob>();
let pendingBytes = 0;
let inFlightId: number | null = null;

const stats = { queued: 0, written: 0, failed: 0, syncFallback: 0, flushedSync: 0 };

/**
 * 원자적 쓰기의 **유일한 동기 구현**. `statePersistence.atomicWriteFileSync`(가드 담당)와
 * 이 큐의 폴백·종료 flush 가 모두 이 함수를 쓴다 — 절차가 두 벌로 갈라지지 않게 한다.
 *
 * @param tmpSuffix 임시 파일 접미사. 워커와 동시에 같은 파일을 쓸 수 있는 종료 flush 는
 *                  다른 접미사를 써서 tmp 이름 충돌을 피한다.
 */
export function writeFileAtomicSyncRaw(filePath: string, data: string, tmpSuffix = '.tmp'): void {
  const tmp = `${filePath}${tmpSuffix}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, data, 'utf8');
    try { fs.fsyncSync(fd); } catch { /* 일부 FS 는 fsync 미지원 — best effort */ }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  // 디렉토리 엔트리(rename 메타데이터)도 디스크 도달 강제 — 전원 손실 시 옛 파일 부활 방지.
  try {
    const dfd = fs.openSync(path.dirname(filePath), 'r');
    try { fs.fsyncSync(dfd); } catch { /* Windows 등은 디렉토리 fsync 미지원 */ }
    finally { fs.closeSync(dfd); }
  } catch { /* 디렉토리 open 실패해도 rename 자체는 이미 완료 */ }
}

/** 다음 작업 하나를 워커에 보낸다(in-flight 는 항상 1건 — 같은 파일의 순서 보장). */
function pump(): void {
  if (!worker || inFlightId !== null) return;
  const next = pending.values().next();
  if (next.done) return;
  inFlightId = next.value.id;
  worker.postMessage(next.value);
}

function handleResult(msg: { id: number; ok: boolean; error?: string; aborted?: boolean }): void {
  const job = pending.get(msg.id);
  if (job) {
    if (msg.ok) {
      pending.delete(msg.id);
      pendingBytes -= job.data.length;
      stats.written += 1;
    } else if (msg.aborted) {
      // 종료 flush 가 가져간다 — pending 에 그대로 둔다.
      stats.failed += 0;
    } else {
      // 워커 쪽 실패는 메인에서 동기로 한 번 더 시도한다(마지막 방어선).
      stats.failed += 1;
      logger.warn(`diskWriteQueue: worker write failed for ${path.basename(job.filePath)} (${msg.error ?? 'unknown'}) — retrying synchronously`);
      try {
        writeFileAtomicSyncRaw(job.filePath, job.data, '.retry.tmp');
        stats.written += 1;
      } catch (err) {
        logger.error(`diskWriteQueue: synchronous retry also failed for ${job.filePath}`, err);
      }
      pending.delete(msg.id);
      pendingBytes -= job.data.length;
    }
  }
  if (inFlightId === msg.id) inFlightId = null;
  pump();
}

/**
 * 워커를 띄운다. **`runServer()` 만 호출한다** — 테스트·도구 경로는 켜지 않아 동기 쓰기 그대로다
 * (파일을 쓴 직후 읽어 검사하는 테스트가 워커 때문에 흔들리지 않게).
 * 이미 켜져 있으면 no-op.
 */
export function enableAsyncDiskWrites(): void {
  if (enabled) return;
  try {
    const stop = new SharedArrayBuffer(4);
    stopFlag = new Int32Array(stop);
    const w = new Worker(WORKER_SOURCE, { eval: true, workerData: { stop } });
    w.unref(); // 워커 하나 때문에 프로세스 종료가 미뤄지지 않게(종료 flush 는 우리가 동기로 한다)
    w.on('message', (msg: { id: number; ok: boolean; error?: string; aborted?: boolean }) => handleResult(msg));
    w.on('error', (err) => {
      logger.warn(`diskWriteQueue: worker error (${err.message}) — falling back to synchronous writes`);
      enabled = false;
      worker = null;
      inFlightId = null;
      flushPendingDiskWritesSync();
    });
    w.on('exit', (code) => {
      if (!enabled) return;
      logger.warn(`diskWriteQueue: worker exited (code=${code}) — falling back to synchronous writes`);
      enabled = false;
      worker = null;
      inFlightId = null;
      flushPendingDiskWritesSync();
    });
    worker = w;
    enabled = true;
    logger.info('diskWriteQueue: async disk writes enabled (worker thread)');
  } catch (err) {
    enabled = false;
    worker = null;
    stopFlag = null;
    logger.warn(`diskWriteQueue: failed to start worker (${err instanceof Error ? err.message : String(err)}) — synchronous writes stay in effect`);
  }
}

export function isAsyncDiskWriteEnabled(): boolean {
  return enabled && worker !== null;
}

/**
 * 원자적 쓰기를 워커에 맡긴다.
 *
 * @returns `true` 면 큐가 받았다(호출자는 더 할 일이 없다). `false` 면 **호출자가 동기로 써야 한다** —
 *          워커 미가동·큐 포화·디렉토리 부재(가드가 메인에 있으므로 만들지 않는다) 등.
 */
export function queueAtomicWrite(filePath: string, data: string): boolean {
  if (!isAsyncDiskWriteEnabled()) return false;
  // 디렉토리 생성은 §3.2/§3.71 가드(죽은 워크트리 되살리기 방지)가 걸린 메인의 몫이다.
  // 여기서 만들지 않으므로, 아직 없으면 동기 경로로 돌려보낸다.
  if (!fs.existsSync(path.dirname(filePath))) return false;
  if (pending.size >= MAX_QUEUED_JOBS || pendingBytes + data.length > MAX_QUEUED_BYTES) {
    stats.syncFallback += 1;
    return false;
  }
  const job: WriteJob = { id: nextJobId++, filePath, data };
  pending.set(job.id, job);
  pendingBytes += data.length;
  stats.queued += 1;
  pump();
  return true;
}

/**
 * 아직 기록되지 않은 작업을 **동기로** 마무리한다(§3.2.1 내구성 — `process 'exit'` 는 동기만 허용).
 *
 * 먼저 정지 깃발을 세워 워커가 진행 중인 건을 **커밋(rename)하지 않게** 한 뒤, 남은 것을 도착
 * 순서대로 직접 쓴다. 같은 파일에 여러 건이 남아 있어도 순서가 보존되므로 마지막 내용이 남는다.
 *
 * @returns 동기로 마무리한 건수
 */
export function flushPendingDiskWritesSync(): number {
  if (stopFlag) Atomics.store(stopFlag, 0, 1);
  if (pending.size === 0) {
    if (stopFlag) Atomics.store(stopFlag, 0, 0);
    return 0;
  }
  let done = 0;
  for (const job of [...pending.values()]) {
    try {
      writeFileAtomicSyncRaw(job.filePath, job.data, '.flush.tmp');
      done += 1;
    } catch (err) {
      logger.error(`diskWriteQueue: flush write failed for ${job.filePath}`, err);
    }
    pending.delete(job.id);
    pendingBytes -= job.data.length;
  }
  inFlightId = null;
  stats.flushedSync += done;
  // 정지 깃발을 되돌린다 — 읽기 직전 flush 처럼 앱이 계속 도는 상황에서도 다음 작업이 정상 커밋된다.
  if (stopFlag) Atomics.store(stopFlag, 0, 0);
  pump();
  return done;
}

/** 종료 경로(graceful): 워커를 정리한다. 남은 작업은 동기로 마무리한 뒤 내린다. */
export function shutdownDiskWriteQueue(): void {
  flushPendingDiskWritesSync();
  const w = worker;
  enabled = false;
  worker = null;
  if (w) void w.terminate();
}

/** §3.2.4 H축 — 진단용 카운터(표시 전용). */
export function getDiskWriteQueueStats(): {
  enabled: boolean;
  pending: number;
  pendingBytes: number;
  queued: number;
  written: number;
  failed: number;
  syncFallback: number;
  flushedSync: number;
} {
  return {
    enabled: isAsyncDiskWriteEnabled(),
    pending: pending.size,
    pendingBytes,
    ...stats,
  };
}
