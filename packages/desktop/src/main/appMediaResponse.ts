// SCENARIO.md §5.13 (Y) 40-1 — 내부 앱 **미디어 파일을 흘려 보낸다**(vibproxy 미디어 갈래). 앱 이름을 모른다.
//
// 종전에는 소재 바이트도 다른 요청처럼 `inject` 로 응답 전체를 메모리에 모은 뒤 IPC 로 실었다. 그 과정에서 바이너리를 한 번
// UTF-8 문자열로 바꾸고(164MB 에 메인 1.5초) base64 로 또 바꿨으며, 끝이 열린 구간(`bytes=N-`)을 끊어도 나머지가 다 건너왔다
// (실사 하나를 열 때마다 파일 전체). 이제 이 갈래는 Express 를 거치지 않는다 — 앱 서버 몫이 "어느 파일인가"만 답하면
// (경로 검사는 그쪽 규칙), 여기서 파일을 조각으로 **당겨** 읽는 `ReadableStream` 을 만든다. 받는 쪽이 끊으면 그 자리에서 파일
// 손잡이를 닫는다(실측: 300KB 만 읽고 끊으면 1MB 조각 셋에서 멈춤). HEAD 는 열지 않고 답한다.
//
// 범위 해석·형식·지문은 shared 순수 함수(`parseByteRange` · `mediaContentType` · `mediaEtag`) — 시험은 `appMediaResponse.test.ts`.

import fs from 'node:fs';
import { APP_MEDIA_STREAM_CHUNK_BYTES, mediaContentType, mediaEtag, parseByteRange } from '@vibisual/shared';

/** 흘려 보내기가 끝났을 때(다 보냈거나 끊겼거나) — 계측용. */
export interface MediaStreamDone {
  readonly bytes: number;
  readonly ms: number;
  readonly cancelled: boolean;
}

export interface MediaRequestLike {
  readonly method: string;
  readonly headers: { get(name: string): string | null };
}

/** SVG 도 그림으로만 읽힌다(문서로 열려도 스크립트·바깥 요청이 돌지 않게) — 앱의 `/asset` 과 같은 머리. */
const MEDIA_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; sandbox",
  'Cache-Control': 'no-cache',
};

/**
 * 파일 하나를 응답으로. `chunkBytes` 는 시험이 작게 줄 때만 쓴다. 파일을 못 열면 404(경로 검사는 이미 끝났으니 사라졌다는 뜻).
 * `contentType` 은 형식을 다른 표로 정하는 갈래가 준다 — 코어 미디어 창구는 그 라우트와 같은 표(`workspaceMediaMime`)를 쓴다
 * (주는 길마다 형식이 갈리면 같은 파일이 패키지 앱에서만 다르게 읽힌다). 없으면 이 갈래의 표.
 */
export async function appMediaResponse(
  filePath: string,
  request: MediaRequestLike,
  onDone?: (info: MediaStreamDone) => void,
  chunkBytes: number = APP_MEDIA_STREAM_CHUNK_BYTES,
  contentType: string = mediaContentType(filePath),
): Promise<Response> {
  const startedAt = performance.now();
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return new Response('not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });
  }
  if (!stat.isFile()) return new Response('not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });
  const size = stat.size;
  const base: Record<string, string> = {
    ...MEDIA_SECURITY_HEADERS,
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    ETag: mediaEtag(size, stat.mtimeMs),
    'Last-Modified': stat.mtime.toUTCString(),
  };
  const range = parseByteRange(request.headers.get('range'), size);
  if (range.kind === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  }
  const start = range.kind === 'range' ? range.start : 0;
  const end = range.kind === 'range' ? range.end : size - 1;
  const length = size === 0 ? 0 : end - start + 1;
  const headers: Record<string, string> = { ...base, 'Content-Length': String(length) };
  if (range.kind === 'range') headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  const status = range.kind === 'range' ? 206 : 200;
  if (request.method === 'HEAD' || length === 0) {
    onDone?.({ bytes: 0, ms: performance.now() - startedAt, cancelled: false });
    return new Response(null, { status, headers });
  }

  const handle = await fs.promises.open(filePath, 'r');
  let position = start;
  let sent = 0;
  let closed = false;
  const finish = async (cancelled: boolean): Promise<void> => {
    if (closed) return;
    closed = true;
    try { await handle.close(); } catch { /* 이미 닫혔다 */ }
    onDone?.({ bytes: sent, ms: performance.now() - startedAt, cancelled });
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const want = Math.min(Math.max(1, chunkBytes), end + 1 - position);
      if (want <= 0) {
        await finish(false);
        controller.close();
        return;
      }
      try {
        const buffer = Buffer.allocUnsafe(want);
        const { bytesRead } = await handle.read(buffer, 0, want, position);
        if (bytesRead === 0) {
          // 보내는 사이 파일이 줄었다 — 있는 데까지만 보내고 닫는다(받는 쪽이 길이 불일치로 안다).
          await finish(false);
          controller.close();
          return;
        }
        position += bytesRead;
        sent += bytesRead;
        controller.enqueue(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
        if (position > end) {
          await finish(false);
          controller.close();
        }
      } catch (error) {
        await finish(true);
        controller.error(error);
      }
    },
    async cancel() {
      await finish(true);
    },
  }, { highWaterMark: 1 });
  return new Response(body, { status, headers });
}
