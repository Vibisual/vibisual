import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAudioDoc } from '@vibisual/audio';
import type { mountAudioRoutes } from '@vibisual/audio/server';
import { createSoundDoc, importSoundAsset, listSoundDocs, mutateSoundDoc, readSoundDoc, soundAssetUrl, SoundApiError } from './soundApi.js';

// This fixture is checked against the actual server service response, not a second invented API schema.
type ServerEnvelope = ReturnType<ReturnType<typeof mountAudioRoutes>['get']>;
const envelope = {
  ok: true, doc: createEmptyAudioDoc('doc-one', 'Mix', 1000), canUndo: true, canRedo: false,
  history: [{ requestId: 'edit-one', action: 'patch', actor: 'human', version: 1, at: 1000 }],
} satisfies ServerEnvelope;
const asset = { id: 'asset', path: '.vibisual/audio/assets/source.wav', name: 'source.wav', duration: 1, sampleRate: 8000, channels: 1 };
const fetchMock = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('Vibisound client/server API contract', () => {
  it('unwraps the real list response and preserves document history and undo flags', async () => {
    const docs = [{ id: 'doc-one', title: 'Mix', version: 1, updatedAt: 1000, duration: 0 }];
    fetchMock.mockResolvedValueOnce(json({ ok: true, docs })).mockResolvedValueOnce(json(envelope));
    expect(await listSoundDocs('/project & one')).toEqual(docs);
    expect(await readSoundDoc('/project & one', 'doc-one')).toEqual(envelope);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/app/vibisound/docs?project=%2Fproject%20%26%20one',
      '/api/app/vibisound/doc/doc-one?project=%2Fproject%20%26%20one',
    ]);
  });

  it('creates a stable source document with the server project/title/id fields', async () => {
    fetchMock.mockResolvedValueOnce(json(envelope));
    expect(await createSoundDoc('/project', 'Original title', 'file-stable')).toEqual(envelope);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/app/vibisound/docs');
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ project: '/project', title: 'Original title', id: 'file-stable' });
  });

  it('retries a lost edit response with the identical request id and payload', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Connection lost after commit'))
      .mockResolvedValueOnce(json({ ...envelope, replayed: true, appliedVersion: 1 }));
    await mutateSoundDoc('/project', envelope.doc, 'patch', [{ op: 'setDoc', patch: { title: 'Human change' } }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual(fetchMock.mock.calls[1]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      project: '/project', baseVersion: 1, actor: 'human', requestId: expect.any(String),
      ops: [{ op: 'setDoc', patch: { title: 'Human change' } }],
    });
  });

  it('surfaces the actual server conflict code/message and never retries a rejected edit', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: 'version-conflict', message: 'Read the latest audio project before editing.', currentVersion: 3 }, 409));
    await expect(mutateSoundDoc('/project', envelope.doc, 'undo')).rejects.toMatchObject({
      status: 409, code: 'version-conflict', message: 'Read the latest audio project before editing.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives separate explicit edits different request ids and uses the history routes', async () => {
    fetchMock.mockImplementation(async () => json(envelope));
    await mutateSoundDoc('/project', envelope.doc, 'undo');
    await mutateSoundDoc('/project', envelope.doc, 'redo');
    const payloads = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { requestId: string; baseVersion: number });
    expect(payloads[0]?.requestId).not.toBe(payloads[1]?.requestId);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/app/vibisound/doc/doc-one/undo', '/api/app/vibisound/doc/doc-one/redo']);
  });

  it('imports registered paths and uploads browser files using the binary body expected by Express/IPC', async () => {
    fetchMock.mockImplementation(async () => json({ ok: true, asset }));
    expect(await importSoundAsset('/project', 'music/source.wav')).toEqual(asset);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ project: '/project', path: 'music/source.wav' });
    const file = new File([Uint8Array.from([1, 2, 3])], 'my song.wav', { type: 'audio/wav' });
    expect(await importSoundAsset('/project', file)).toEqual(asset);
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe('/api/app/vibisound/assets?project=%2Fproject&name=my%20song.wav');
    expect(init).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' } });
    expect(init?.body).toBeInstanceOf(Blob);
    expect([...(new Uint8Array(await (init?.body as Blob).arrayBuffer()))]).toEqual([1, 2, 3]);
    expect(soundAssetUrl('/project & one', asset.path)).toBe('/api/app/vibisound/asset?project=%2Fproject%20%26%20one&path=.vibisual%2Faudio%2Fassets%2Fsource.wav');
  });

  it('returns structured HTTP errors from import failures', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: false, error: 'asset-too-large', message: 'Audio imports are limited to 128 MiB.' }, 413));
    await expect(importSoundAsset('/project', 'large.wav')).rejects.toBeInstanceOf(SoundApiError);
  });
});
