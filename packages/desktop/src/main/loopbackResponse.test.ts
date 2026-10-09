import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { inject } from 'light-my-request';
import { forwardLoopbackResponse } from './loopbackResponse';

const picture = Buffer.from([255, 216, 255, 224, 0, 16, 128, 192, 193, 255, 217]);
let server: Server;
let base: string;
beforeEach(async () => {
  server = createServer((req, res) => {
    void inject((_input, inner) => {
      if (req.url === '/image') {
        inner.setHeader('content-type', 'image/jpeg');
        inner.setHeader('cache-control', 'no-store');
        inner.setHeader('x-vibi3d-revision', '4');
        inner.end(picture);
      } else {
        inner.statusCode = 409;
        inner.setHeader('content-type', 'application/json; charset=utf-8');
        inner.end(JSON.stringify({ ok: false, error: '장면 변경' }));
      }
    }, { method: 'GET', url: req.url ?? '/' }).then((injected) => forwardLoopbackResponse(res, injected));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); });

describe('authenticated loopback response bytes', () => {
  it('delivers every captured image byte unchanged and preserves freshness headers', async () => {
    const response = await fetch(`${base}/image`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-vibi3d-revision')).toBe('4');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(picture);
  });
  it('retains existing JSON error status and UTF-8 text behavior', async () => {
    const response = await fetch(`${base}/error`);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: '장면 변경' });
  });
  it('uses the binary forwarder on the actual hook listener response path', () => {
    const main = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(main).toContain('forwardLoopbackResponse(res, injected)');
    expect(main).not.toContain('res.end(injected.payload)');
  });
});
