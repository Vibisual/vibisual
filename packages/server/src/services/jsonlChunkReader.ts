/**
 * jsonlChunkReader.ts — §3.2.4 G축. JSONL 을 **고정 청크로 흘려 읽는다.**
 *
 * **왜**: 종전 읽기 경로는 전부 "구간 전체를 한 번에"였다 —
 * `fs.readFileSync(path,'utf8')`(3곳) 또는 `Buffer.allocUnsafe(구간 전체)`(2곳).
 * 26MB 짜리 트랜스크립트 하나를 훑으면 버퍼 26MB + `toString()` 문자열(UTF-16 이라 최대 52MB)
 * + `split('\n')` 조각 배열이 한꺼번에 잡혀 **피크가 파일 크기의 4~5배**였다. 이 피크가 반복되며
 * V8 old space 가 3GB 까지 자랐다(실측 2026-08-14).
 *
 * 청크로 끊어 읽으면 같은 줄을 같은 순서로 **딱 한 번씩** 먹이므로 결과는 전량 읽기와
 * 바이트 단위로 동일하고, 피크만 `JSONL_SCAN_CHUNK_BYTES` 상수가 된다.
 *
 * ⚠ **UTF-8 경계**: 청크를 그대로 `toString('utf8')` 하면 멀티바이트 문자가 경계에서 깨진다.
 *   그래서 **마지막 개행까지만** 디코드하고 남은 바이트는 `Buffer` 로 들고 다음 청크에 이어 붙인다.
 *   개행(`0x0A`)은 ASCII 라 UTF-8 멀티바이트 시퀀스의 일부가 될 수 없으므로 이 경계는 안전하다.
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

/**
 * `[start, end)` 를 청크로 읽으며 **완결된 줄만** `onLine` 에 먹인다.
 *
 * 빈 줄(`''`)은 먹이지 않는다 — 종전 경로들이 전부 `if (!line) continue` 로 걸러 왔으므로
 * 여기서 거르는 편이 호출부마다 반복하는 것보다 낫고, 동작도 같다.
 */
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

/**
 * **뒤에서 `maxLines` 줄이 시작하는 바이트 오프셋**을 찾는다(그만큼 없으면 0).
 *
 * **왜**: 소비자가 "마지막 N줄"만 쓰는데도 읽기 경로가 파일을 통째로 읽고 전 줄을 파싱해 왔다
 * (`streamBufferStore.loadBuffer` 가 정확히 그랬다 — 2.5MB 파일을 읽어 마지막 2,000줄만 남김).
 * 여기서 시작점을 먼저 집으면 `scanFileLines` 가 **꼬리만** 읽으므로, 비용이 파일 크기가 아니라
 * 실제로 쓰는 줄 수에 비례한다.
 *
 * 뒤에서부터 청크를 읽어 개행(`0x0A`)을 센다. **파일 맨 끝 개행은 세지 않는다** — 그건 마지막 줄을
 * 닫는 것이지 새 줄을 여는 경계가 아니다(이걸 세면 결과가 한 줄씩 밀린다).
 */
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

/**
 * **마지막 `maxLines` 줄만** 청크로 읽어 먹인다 — 전량 읽기 뒤 `slice(-N)` 하던 경로 대체용.
 *
 * 시작점이 항상 개행 바로 뒤라 첫 줄이 반쪽으로 잘리지 않는다. 파일이 개행 없이 끝났으면
 * `scanWholeFileLines` 와 같은 규약으로 그 마지막 줄도 먹인다.
 */
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
 * 파일 전체를 청크로 훑으며 완결된 줄을 먹인다 — `fs.readFileSync(p,'utf8').split('\n')` 대체용.
 *
 * 파일이 개행 없이 끝났으면 그 마지막 줄도 먹인다(전량 읽기와 결과를 맞추기 위함 —
 * `split('\n')` 은 마지막 조각을 그대로 내놓는다).
 */
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
