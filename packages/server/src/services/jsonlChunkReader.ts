/**
 * §3.2.4 G축 — JSONL 을 고정 청크로 읽는다(통째로 읽으면 피크가 파일의 4~5배 — 실측 2026-08-14 V8 old space 3GB). 결과는 전량 읽기와 같다.
 * ⚠ **마지막 개행까지만** 디코드하고 남은 바이트는 다음 청크에 잇는다 — `0x0A` 는 멀티바이트 시퀀스에 끼지 않는다.
 */
import fs from 'node:fs';
import { JSONL_SCAN_CHUNK_BYTES } from '@vibisual/shared';

export interface ChunkScanResult {
  /**
   * 완결된 줄까지 먹인 다음 시작 오프셋. 개행이 하나도 없었으면 `start` 그대로다
   * (= 아직 줄이 완결되지 않았으니 커밋하지 않는다).
   */
  nextOffset: number;
  /** 마지막 개행 뒤에 남은 미완결 꼬리. 호출자가 결과에만 반영하고 누적엔 커밋하지 않는 규약. */
  pendingTail: string;
}

/**
 * 줄 소비자. `false` 를 돌려주면 **거기서 읽기를 멈춘다**(첫 user 메시지만 찾는 제목 스캔처럼
 * 조기 종료가 의미 있는 경로용 — 없으면 첫 줄에서 찾고도 26MB 를 끝까지 읽는다).
 */
export type LineConsumer = (line: string) => void | boolean;

/** `[start, end)` 의 **완결된 줄만** 먹인다. 빈 줄은 거른다. */
export function scanFileLines(
  filePath: string,
  start: number,
  end: number,
  onLine: LineConsumer,
  chunkBytes: number = JSONL_SCAN_CHUNK_BYTES,
): ChunkScanResult {
  const total = end - start;
  if (total <= 0) return { nextOffset: start, pendingTail: '' };

  const step = chunkBytes > 0 ? chunkBytes : JSONL_SCAN_CHUNK_BYTES;
  let fd: number | null = null;
  // 개행이 없어 아직 디코드하지 못한 바이트. 다음 청크 앞에 이어 붙인다.
  let carry: Buffer = Buffer.alloc(0);
  // 마지막으로 줄을 완결한 지점(파일 절대 오프셋 + 1). 개행을 한 번도 못 만나면 start 그대로.
  let committed = start;
  let cursor = start;

  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(Math.min(step, total));

    while (cursor < end) {
      const want = Math.min(buf.length, end - cursor);
      const read = fs.readSync(fd, buf, 0, want, cursor);
      if (read <= 0) break;
      cursor += read;

      // carry + 이번 청크에서 **마지막 개행까지만** 디코드한다.
      const view = carry.length > 0 ? Buffer.concat([carry, buf.subarray(0, read)]) : buf.subarray(0, read);
      const lastNewline = view.lastIndexOf(0x0a);
      if (lastNewline < 0) {
        // 이 청크 안에 개행이 없다 — 통째로 다음으로 넘긴다(한 줄이 청크보다 긴 경우).
        carry = Buffer.from(view);
        continue;
      }

      const text = view.subarray(0, lastNewline).toString('utf8');
      let stopped = false;
      for (const line of text.split('\n')) {
        if (line === '') continue;
        if (onLine(line) === false) { stopped = true; break; }
      }
      // 남은 꼬리는 다음 청크로. `Buffer.from` 으로 복사해야 `buf` 재사용에 오염되지 않는다.
      carry = lastNewline + 1 < view.length ? Buffer.from(view.subarray(lastNewline + 1)) : Buffer.alloc(0);
      committed = cursor - carry.length;
      if (stopped) return { nextOffset: committed, pendingTail: '' };
    }

    return { nextOffset: committed, pendingTail: carry.length > 0 ? carry.toString('utf8') : '' };
  } catch {
    // 읽기 실패는 "아직 못 읽었다"로 되돌린다 — 다음 호출에서 같은 지점부터 다시 시도한다.
    return { nextOffset: committed, pendingTail: '' };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* 무시 */ }
    }
  }
}

/** 뒤에서 `maxLines` 줄이 시작하는 오프셋(모자라면 0) — 꼬리만 읽어 비용이 쓰는 줄 수에 비례한다. **맨 끝 개행은 세지 않는다**(세면 한 줄씩 밀린다). */
export function findTailLineOffset(
  filePath: string,
  maxLines: number,
  chunkBytes: number = JSONL_SCAN_CHUNK_BYTES,
): number {
  if (maxLines <= 0) return 0;
  let fd: number | null = null;
  try {
    const size = fs.statSync(filePath).size;
    if (size === 0) return 0;
    const step = chunkBytes > 0 ? chunkBytes : JSONL_SCAN_CHUNK_BYTES;
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(Math.min(step, size));
    let end = size; // 아직 안 본 구간의 끝(배타)
    let seen = 0;   // 뒤에서부터 센 줄 경계 수
    while (end > 0) {
      const from = Math.max(0, end - buf.length);
      const want = end - from;
      // 부분 읽기 대비 — 요청한 만큼 채운 뒤에 훑는다(안 채우면 그 구간을 영영 못 본다).
      let got = 0;
      while (got < want) {
        const n = fs.readSync(fd, buf, got, want - got, from + got);
        if (n <= 0) break;
        got += n;
      }
      if (got <= 0) break;
      for (let i = got - 1; i >= 0; i--) {
        if (buf[i] !== 0x0a) continue;
        const abs = from + i;
        if (abs === size - 1) continue; // 맨 끝 개행 = 마지막 줄의 종결자
        seen += 1;
        if (seen === maxLines) return abs + 1;
      }
      end = from;
    }
    return 0; // 줄이 maxLines 이하 — 처음부터 읽으면 된다
  } catch {
    return 0;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* 무시 */ }
    }
  }
}

/** **마지막 `maxLines` 줄만** 먹인다(= 전량 + `slice(-N)`). 시작점이 개행 뒤라 첫 줄이 반쪽이 안 되고, 개행 없는 마지막 줄도 먹인다. */
export function scanTailLines(
  filePath: string,
  maxLines: number,
  onLine: LineConsumer,
  chunkBytes: number = JSONL_SCAN_CHUNK_BYTES,
): void {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return;
  }
  if (size === 0) return;
  const start = findTailLineOffset(filePath, maxLines, chunkBytes);
  const { pendingTail } = scanFileLines(filePath, start, size, onLine, chunkBytes);
  if (pendingTail !== '') onLine(pendingTail);
}

/**
 * **뒤에서 앞으로** 먹인다(`false` 면 멈춤) — `loadEventsBefore` 의 비용이 "기준 줄까지 거리 + N줄"이 된다. 개행에서 먼저 갈라 줄 단위로 디코드한다(경계 안전). 빈 줄 ❌.
 * 반환: 소비자가 멈췄으면 `true`.
 */
export function scanLinesBackward(
  filePath: string,
  onLine: LineConsumer,
  chunkBytes: number = JSONL_SCAN_CHUNK_BYTES,
): boolean {
  let fd: number | null = null;
  try {
    const size = fs.statSync(filePath).size;
    if (size === 0) return false;
    const step = chunkBytes > 0 ? chunkBytes : JSONL_SCAN_CHUNK_BYTES;
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(Math.min(step, size));
    let end = size; // 아직 안 본 구간의 끝(배타)
    // 뒤 청크의 첫 개행 앞 바이트 — 이 청크에서 시작한 줄의 뒷부분이다. 이 청크 뒤에 이어 붙인다.
    let carry: Buffer = Buffer.alloc(0);
    while (end > 0) {
      const from = Math.max(0, end - buf.length);
      const want = end - from;
      let got = 0;
      while (got < want) {
        const n = fs.readSync(fd, buf, got, want - got, from + got);
        if (n <= 0) break;
        got += n;
      }
      if (got < want) break; // 파일이 읽는 도중 줄었다 — 반쪽 줄을 먹이느니 여기서 멈춘다.
      const view = carry.length > 0 ? Buffer.concat([buf.subarray(0, got), carry]) : buf.subarray(0, got);
      let lineEnd = view.length;
      for (let i = view.length - 1; i >= 0; i--) {
        if (view[i] !== 0x0a) continue;
        if (i + 1 < lineEnd && onLine(view.subarray(i + 1, lineEnd).toString('utf8')) === false) return true;
        lineEnd = i;
      }
      // `Buffer.from` 으로 복사해야 다음 읽기가 `buf` 를 덮어써도 오염되지 않는다.
      carry = lineEnd > 0 ? Buffer.from(view.subarray(0, lineEnd)) : Buffer.alloc(0);
      end = from;
    }
    // 파일 첫 줄(앞에 개행이 없다).
    if (end === 0 && carry.length > 0 && onLine(carry.toString('utf8')) === false) return true;
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* 무시 */ }
    }
  }
}

/** 전체를 청크로 훑는다(= `readFileSync(...).split('\n')`). 개행 없는 마지막 줄도 먹인다(`split` 이 내놓는다). */
export function scanWholeFileLines(
  filePath: string,
  onLine: LineConsumer,
  chunkBytes: number = JSONL_SCAN_CHUNK_BYTES,
): void {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return;
  }
  const { pendingTail } = scanFileLines(filePath, 0, size, onLine, chunkBytes);
  if (pendingTail !== '') onLine(pendingTail);
}
