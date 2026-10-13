/**
 * §5.13 (T-6)(V) 37-11 — **받기는 main 의 네트워크로**: 사용자가 [받기]를 누를 때만, Electron 네트워크(`net.fetch` — 시스템 프록시를
 * 따른다)로 파일 하나를 받는다. https 만 받고, 크기 상한을 넘으면 받는 도중에 끊는다. 쓰기는 서버 몫이 원자적으로 한다.
 * 백그라운드 다운로드·자동 갱신은 없다 — 이 함수는 사람이 누른 그 한 번만 돈다.
 */
import { net } from 'electron';

/** 받는 상한(서버의 `LIB_DOWNLOAD_MAX_BYTES` 와 같은 값 — 앱 몫끼리 한 값). */
const MAX_BYTES = 24 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

export interface DownloadResult {
  readonly bytes: ArrayBuffer;
  readonly contentType: string;
  readonly finalUrl: string;
}

export async function downloadLibrary(payload: unknown): Promise<DownloadResult> {
  const raw = (payload as { url?: unknown } | null)?.url;
  if (typeof raw !== 'string') throw new Error('url required');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('invalid url'); }
  if (url.protocol !== 'https:') throw new Error('Only https:// addresses can be downloaded.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await net.fetch(url.toString(), { redirect: 'follow', signal: controller.signal });
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) throw new Error('The file is larger than the download limit.');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('The response has no body.');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { controller.abort(); throw new Error('The file is larger than the download limit.'); }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.byteLength; }
    return { bytes: out.buffer, contentType: res.headers.get('content-type') ?? '', finalUrl: res.url || url.toString() };
  } finally {
    clearTimeout(timer);
  }
}
