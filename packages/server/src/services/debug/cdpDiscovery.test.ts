import { afterEach, describe, expect, it } from 'vitest';
import { fetchInspectorWebSocketUrl } from './cdpClient.js';
import { inspectorFixture } from './cdpTestFixture.js';

const fixtures: Awaited<ReturnType<typeof inspectorFixture>>[] = [];
async function fixture(options: Parameters<typeof inspectorFixture>[0] = {}) {
  const value = await inspectorFixture(options);
  fixtures.push(value);
  return value;
}
afterEach(async () => { await Promise.all(fixtures.splice(0).map((f) => f.close())); });

describe('CDP inspector discovery boundary', () => {
  it('reads a valid inspector listing', async () => {
    const f = await fixture();
    await expect(fetchInspectorWebSocketUrl(f.port)).resolves.toBe(`ws://127.0.0.1:${f.port}/inspector`);
  });

  it.each(['null', '{}', '[]', 'invalid JSON', '[null, 7, {}]'])(
    'treats an invalid listing as unavailable: %s', async (body) => {
      const f = await fixture({ respond: (_req, res) => res.end(body) });
      await expect(fetchInspectorWebSocketUrl(f.port)).resolves.toBeNull();
    },
  );

  it('skips invalid rows while finding a valid target', async () => {
    const f = await fixture({ respond: (_req, res) => {
      res.end('[null,7,{"webSocketDebuggerUrl":"ws://127.0.0.1:1/debug"}]');
    } });
    await expect(fetchInspectorWebSocketUrl(f.port)).resolves.toBe('ws://127.0.0.1:1/debug');
  });

  it('bounds the actual UTF-8 bytes rather than the character count', async () => {
    const f = await fixture({ respond: (_req, res) => {
      res.end(JSON.stringify([{ webSocketDebuggerUrl: 'ws://localhost/debug', title: '한'.repeat(90_000) }]));
    } });
    await expect(fetchInspectorWebSocketUrl(f.port)).resolves.toBeNull();
  });

  it('settles when the response is truncated after its headers', async () => {
    const f = await fixture({ respond: (_req, res) => {
      res.writeHead(200, { 'Content-Length': '1000' });
      res.write('[{"webSocketDebuggerUrl":');
      setImmediate(() => res.destroy());
    } });
    await expect(fetchInspectorWebSocketUrl(f.port)).resolves.toBeNull();
  });

  it('handles response failure while rejecting a non-200 result', async () => {
    const f = await fixture({ respond: (_req, res) => {
      res.writeHead(503, { 'Content-Length': '1000' });
      res.write('unavailable');
      setImmediate(() => res.destroy());
    } });
    await expect(fetchInspectorWebSocketUrl(f.port)).resolves.toBeNull();
  });

  it('closes a trickling error response instead of retaining a socket after discovery settles', async () => {
    let closed!: () => void;
    const disconnected = new Promise<boolean>((resolve) => { closed = () => resolve(true); });
    const f = await fixture({ respond: (_req, res) => {
      res.writeHead(503);
      res.write('unavailable');
      const trickle = setInterval(() => res.write(' '), 10);
      res.on('close', () => { clearInterval(trickle); closed(); });
    } });
    await expect(fetchInspectorWebSocketUrl(f.port, 70)).resolves.toBeNull();
    const released = await Promise.race([
      disconnected,
      new Promise<boolean>((resolve) => { const timer = setTimeout(() => resolve(false), 300); timer.unref(); }),
    ]);
    expect(released).toBe(true);
  });

  it('has a wall-clock deadline even when response data keeps trickling', async () => {
    const f = await fixture({ respond: (_req, res) => {
      res.writeHead(200);
      res.write('[');
      const trickle = setInterval(() => res.write(' '), 10);
      res.on('close', () => clearInterval(trickle));
    } });
    const outcome = await Promise.race([
      fetchInspectorWebSocketUrl(f.port, 70),
      new Promise<string>((resolve) => { const t = setTimeout(() => resolve('still pending'), 1000); t.unref(); }),
    ]);
    expect(outcome).toBeNull();
  });

  it('settles a discovery request that is explicitly aborted', async () => {
    const f = await fixture({ respond: () => { /* intentionally pending */ } });
    const controller = new AbortController();
    const pending = fetchInspectorWebSocketUrl(f.port, 3000, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeNull();
  });
});
