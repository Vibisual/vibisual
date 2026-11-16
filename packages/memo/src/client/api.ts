import { MEMO } from '../config.js';

export class MemoAPIError extends Error { constructor(readonly code: string, readonly detail: Readonly<Record<string, unknown>> = {}) { super(code); } }
export class MemoAPI {
  /** `locate` 는 호스트가 미디어 주소를 응답을 통째로 싣지 않는 스트리밍 주소로 바꾸는 자리다. */
  constructor(readonly project: string, private readonly locate: (path: string) => string = path => path) {}
  url(path: string, query: Record<string, string> = {}): string {
    return `${MEMO.api}${path}?${new URLSearchParams({ project: this.project, ...query })}`;
  }
  private async send<T>(url: string, init: RequestInit): Promise<T> {
    try {
      const response = await fetch(url, init);
      const result = await response.json() as T & { error?: string };
      if (!response.ok) throw new MemoAPIError(result.error ?? 'save-failed', result);
      return result;
    } catch (error) { if (error instanceof MemoAPIError) throw error; throw new MemoAPIError('connection-failed'); }
  }
  request<T>(path: string, method = 'GET', body?: unknown, query?: Record<string, string>): Promise<T> {
    return this.send<T>(this.url(path, query), { method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body as object, project: this.project }) }) });
  }
  /** 조각 하나를 보내고 서버가 지금까지 받은 바이트 수를 받는다. */
  async putChunk(uploadId: string, bytes: Blob, query: Record<string, string>): Promise<number> {
    const result = await this.send<{ received?: number }>(this.url(`/uploads/${uploadId}`, query),
      { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    return result.received ?? 0;
  }
  /** 그림·영상 요소가 직접 읽는 주소. 구간 요청으로 필요한 만큼만 받는다. */
  media(noteId: string, assetId: string, variant?: 'thumb'): string {
    return this.locate(this.url('/media', { note: noteId, asset: assetId, ...(variant ? { variant } : {}) }));
  }
  async download(url: string, filename: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) { const value = await response.json() as { error?: string }; throw new MemoAPIError(value.error ?? 'export-failed'); }
      const blob = await response.blob(); const made = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = made; anchor.download = filename; anchor.click();
      setTimeout(() => URL.revokeObjectURL(made), 30_000);
    } catch (error) { if (error instanceof MemoAPIError) throw error; throw new MemoAPIError('export-failed'); }
  }
}
export function requestId(): string { return `req-${crypto.randomUUID()}`; }
export function errorCode(error: unknown): string { return error instanceof MemoAPIError ? error.code : 'save-failed'; }
