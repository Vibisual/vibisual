import type { ServerResponse } from 'node:http';

interface InjectedResponse {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  rawPayload: Buffer;
}

/** Preserve binary captures. `payload` is a decoded string and corrupts JPEG/PNG bytes. */
export function forwardLoopbackResponse(res: ServerResponse, injected: InjectedResponse): void {
  res.statusCode = injected.statusCode;
  for (const name of ['content-type', 'cache-control', 'x-vibi3d-revision']) {
    const value = injected.headers[name];
    if (value !== undefined) res.setHeader(name, value);
  }
  res.end(injected.rawPayload);
}
