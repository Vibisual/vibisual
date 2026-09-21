import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { probeVerificationBrowser, VERIFICATION_BROWSER_PROBE } from './verificationBrowserProbe';

const fixtures: Server[] = [];
async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<{ url: string; server: Server }> {
  const server = createServer(handler); fixtures.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  return { url: `http://127.0.0.1:${address.port}`, server };
}
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
});

describe('real browser connection probe using local HTTP fixtures', () => {
  it('uses GET without cookies, accepts a live target, and does not read its streaming body', async () => {
    let method: string | undefined, cookie: string | undefined;
    const { url } = await fixture((request, response) => {
      method = request.method; cookie = request.headers.cookie;
      response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'private=do-not-reuse' });
      response.write('<html><script>this_is_never_executed()</script>');
      // Intentionally never end: a readiness check must finish on response headers.
    });
    await expect(probeVerificationBrowser(url, { timeoutMs: 1000 })).resolves.toBeUndefined();
    await expect(probeVerificationBrowser(url, { timeoutMs: 1000 })).resolves.toBeUndefined();
    expect(method).toBe('GET'); expect(cookie).toBeUndefined();
  });
  it.each([401, 404, 500])('rejects HTTP %s instead of displaying ready', async status => {
    const { url } = await fixture((_request, response) => { response.writeHead(status); response.end('Unavailable'); });
    await expect(probeVerificationBrowser(url)).rejects.toThrow(`HTTP ${status}`);
  });
  it('reports an offline target', async () => {
    const { url, server } = await fixture((_request, response) => response.end('ok'));
    await new Promise<void>(resolve => server.close(() => resolve()));
    await expect(probeVerificationBrowser(url)).rejects.toThrow('Cannot connect');
  });
  it('follows a same-origin relative redirect without forwarding Set-Cookie', async () => {
    let cookie: string | undefined, requests = 0;
    const { url } = await fixture((request, response) => {
      requests++; cookie = request.headers.cookie;
      if (request.url === '/') { response.writeHead(302, { location: '/app', 'set-cookie': 'secret=app-cookie' }); response.end(); }
      else response.end('Ready');
    });
    await expect(probeVerificationBrowser(url)).resolves.toBeUndefined(); expect(requests).toBe(2); expect(cookie).toBeUndefined();
  });
  it('rejects an external origin redirect before even requesting the other local fixture', async () => {
    let foreignRequests = 0;
    const foreign = await fixture((_request, response) => { foreignRequests++; response.end('Foreign'); });
    const { url } = await fixture((_request, response) => { response.writeHead(302, { location: foreign.url }); response.end(); });
    await expect(probeVerificationBrowser(url)).rejects.toThrow('origin'); expect(foreignRequests).toBe(0);
  });
  it('bounds redirects and connections that never return headers', async () => {
    let requests = 0;
    const loop = await fixture((_request, response) => { requests++; response.writeHead(302, { location: '/' }); response.end(); });
    await expect(probeVerificationBrowser(loop.url)).rejects.toThrow('too many'); expect(requests).toBe(VERIFICATION_BROWSER_PROBE.maxRedirects + 1);
    const stalled = await fixture(() => undefined);
    await expect(probeVerificationBrowser(stalled.url, { timeoutMs: 60 })).rejects.toThrow('timed out');
  });
});
