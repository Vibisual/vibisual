import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexAppServerRpc, CodexAppServerRpcError } from './codexAppServerRpc.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
function fixture() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const callbacks = { onActivity: vi.fn(), onNotification: vi.fn(), onRequest: vi.fn(), onFailure: vi.fn() };
  const rpc = new CodexAppServerRpc(child as unknown as ChildProcess, { requestTimeoutMs: 20, maxLineChars: 128, ...callbacks });
  return { child, rpc, ...callbacks };
}

describe('native Codex JSONL RPC', () => {
  it('preserves split UTF-8 text and routes notification, request and response independently', async () => {
    const { child, rpc, onNotification, onRequest, onActivity } = fixture();
    const request = rpc.request('test', {});
    const notification = Buffer.from(JSON.stringify({ method: 'notice', params: { text: '한글' } }) + '\n');
    const split = notification.indexOf(Buffer.from('한')) + 1;
    child.stdout.write(notification.subarray(0, split)); child.stdout.write(notification.subarray(split));
    child.stdout.write('{"id":"server-id","method":"approval","params":{}}\n{"id":1,"result":{"ok":true}}\n');
    expect(await request).toEqual({ ok: true });
    expect(onNotification).toHaveBeenCalledWith('notice', { text: '한글' });
    expect(onRequest).toHaveBeenCalledWith('server-id', 'approval', {}); expect(onActivity).toHaveBeenCalledTimes(3);
    rpc.dispose();
  });

  it('distinguishes an explicit server rejection from an unknown timeout', async () => {
    const { child, rpc } = fixture();
    const rejected = rpc.request('steer', {}); const expected = expect(rejected).rejects.toBeInstanceOf(CodexAppServerRpcError);
    child.stdout.write('{"id":1,"error":{"code":-32600,"message":"not active"}}\n'); await expected;
    const unknown = rpc.request('steer', {}); const timeout = expect(unknown).rejects.toThrow('delivery is unknown');
    await vi.advanceTimersByTimeAsync(21); await timeout; rpc.dispose();
  });

  it('bounds both unterminated and newline-terminated oversized lines', () => {
    for (const suffix of ['', '\n']) {
      const { child, rpc, onFailure } = fixture();
      child.stdout.write('x'.repeat(129) + suffix);
      expect(onFailure).toHaveBeenCalledOnce(); rpc.dispose();
    }
  });

  it('observes malformed output and stderr as activity without interpreting them as completion', () => {
    const { child, rpc, onActivity, onNotification, onFailure } = fixture();
    child.stdout.write('not-json\nnull\n'); child.stderr.write('diagnostic');
    expect(onActivity).toHaveBeenCalledTimes(2); expect(onNotification).not.toHaveBeenCalled(); expect(onFailure).not.toHaveBeenCalled(); rpc.dispose();
  });

  it('rejects pending requests on disposal and consumes late pipe errors', async () => {
    const { child, rpc, onFailure } = fixture();
    const pending = rpc.request('test', {}); const rejected = expect(pending).rejects.toThrow('connection closed');
    rpc.dispose(); await rejected;
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.emit('error', new Error('late EPIPE'));
    expect(onFailure).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
