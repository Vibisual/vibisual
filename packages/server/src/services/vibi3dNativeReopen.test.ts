import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VIBI3D_NATIVE_HELPER } from './vibi3dNativeKit.js';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-reopen-')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); fs.rmSync(root, { recursive: true, force: true }); });
async function helper(): Promise<{ reopenDocument(auth: object, project: string, doc: string, run: string, timeout?: number): Promise<unknown> }> {
  const file = path.join(root, 'helper.mjs'); fs.writeFileSync(file, VIBI3D_NATIVE_HELPER);
  return import(/* @vite-ignore */ pathToFileURL(file).href);
}
const auth = { base: 'http://127.0.0.1:1234', token: 'private-token' };

it('waits past acknowledgement and wrong-document sessions, then returns human edits without replaying', async () => {
  const native = await helper(); vi.useFakeTimers();
  const snapshot = { sessionId: 'new-session', document: { id: 'same-doc', revision: 4, dirty: true, humanDirty: true } };
  const replies = [{ ok: true }, { session: null },
    { session: { online: true, snapshot: { ...snapshot, document: { id: 'different-doc' } } } },
    { session: { online: true, snapshot }, run: { id: 'saved-run', stages: [{ id: 'assembly' }] } }];
  const fetcher = vi.fn(async () => new Response(JSON.stringify(replies.shift()))); vi.stubGlobal('fetch', fetcher);
  const pending = native.reopenDocument(auth, '/project space', 'same-doc', 'saved-run');
  await vi.advanceTimersByTimeAsync(1100);
  await expect(pending).resolves.toMatchObject({ ready: true, sessionId: 'new-session', snapshot, run: { id: 'saved-run' } });
  expect(fetcher.mock.calls).toHaveLength(4);
  const requests = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(requests[0]![1].method).toBe('POST');
  expect(requests.slice(1).every(([url, init]) => url.endsWith('/same-doc/session?projectId=%2Fproject%20space') && init.method === 'GET')).toBe(true);
});

it('fails explicitly when reopening never produces an online renderer', async () => {
  const native = await helper(); vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, session: null }))));
  const pending = expect(native.reopenDocument(auth, '/project', 'same-doc', 'saved-run', 1000)).rejects.toThrow('viewer-not-ready');
  await vi.advanceTimersByTimeAsync(1000); await pending;
  expect(vi.getTimerCount()).toBe(0);
});
