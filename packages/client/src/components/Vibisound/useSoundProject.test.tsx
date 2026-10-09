import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAudioDoc } from '@vibisual/audio';
import { SOUND_UI } from './soundConfig.js';
import { SoundApiError, type SoundEnvelope } from './soundApi.js';
import { useSoundProject } from './useSoundProject.js';

const api = vi.hoisted(() => ({ list: vi.fn(), read: vi.fn(), create: vi.fn(), mutate: vi.fn(), import: vi.fn(), measure: vi.fn() }));
vi.mock('./soundApi.js', async () => ({
  ...await vi.importActual<typeof import('./soundApi.js')>('./soundApi.js'),
  listSoundDocs: api.list, readSoundDoc: api.read, createSoundDoc: api.create, mutateSoundDoc: api.mutate, importSoundAsset: api.import,
}));
vi.mock('./soundImport.js', () => ({ measureSoundImport: api.measure }));
vi.mock('react-i18next', () => {
  const t = (key: string): string => key;
  return { useTranslation: () => ({ t }) };
});

let view: ReactTestRenderer | undefined;
let handle: ReturnType<typeof useSoundProject>;
function Probe({ project, reference }: { project: string; reference: string }): null {
  handle = useSoundProject(project, reference, ''); return null;
}
function envelope(id = 'doc', version = 1): SoundEnvelope {
  return { doc: { ...createEmptyAudioDoc(id, id, 1000), version }, canUndo: version > 1, canRedo: false, history: [] };
}
function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function render(project = '/one', reference = 'doc'): Promise<void> {
  await act(async () => {
    const element = <Probe project={project} reference={reference} />;
    if (view) view.update(element); else view = create(element);
  });
}
async function poll(): Promise<void> { await act(async () => { vi.advanceTimersByTime(SOUND_UI.pollMs); }); }
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.stubGlobal('window', { setInterval, clearInterval });
  for (const mock of Object.values(api)) mock.mockReset();
  api.list.mockResolvedValue([]); api.read.mockResolvedValue(envelope()); api.measure.mockResolvedValue(1);
});
afterEach(async () => {
  await act(async () => { view?.unmount(); }); view = undefined;
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('audio document request ownership', () => {
  it('ignores an older in-flight poll after a newer human edit completes', async () => {
    await render(); const oldPoll = pending<SoundEnvelope>();
    api.read.mockReturnValueOnce(oldPoll.promise);
    await poll();
    api.mutate.mockResolvedValueOnce(envelope('doc', 3));
    await act(async () => { await handle.patch([{ op: 'setDoc', patch: { title: 'Human' } }]); });
    await act(async () => oldPoll.resolve(envelope('doc', 2)));
    expect(handle.doc?.version).toBe(3);
    expect(handle.notice).toBe('');
  });

  it('accepts newer agent edits and avoids overlapping polling requests', async () => {
    await render(); const response = pending<SoundEnvelope>();
    api.read.mockReturnValueOnce(response.promise);
    await poll(); await poll();
    expect(api.read).toHaveBeenCalledTimes(2);
    await act(async () => response.resolve(envelope('doc', 4)));
    expect(handle.doc?.version).toBe(4);
    expect(handle.notice).toBe('panel.vibisound.workbench.updated');
  });

  it('ignores a previous document poll after another document is opened', async () => {
    await render(); const old = pending<SoundEnvelope>(); api.read.mockReturnValueOnce(old.promise);
    await poll(); api.read.mockResolvedValueOnce(envelope('second', 1));
    await act(async () => { await handle.open('second'); });
    await act(async () => old.resolve(envelope('doc', 100)));
    expect(handle.doc?.id).toBe('second');
    expect(handle.doc?.version).toBe(1);
  });

  it('does not attach a late previous-document poll failure to the newly opened document', async () => {
    await render(); const old = pending<SoundEnvelope>(); api.read.mockReturnValueOnce(old.promise);
    await poll(); api.read.mockResolvedValueOnce(envelope('second'));
    await act(async () => { await handle.open('second'); });
    await act(async () => old.reject(new Error('Old document is unavailable')));
    expect(handle.doc?.id).toBe('second');
    expect(handle.error).toBe('');
  });

  it('ignores a previous project load even when both projects use the same document id', async () => {
    const old = pending<SoundEnvelope>(); api.read.mockReturnValueOnce(old.promise);
    await render('/old');
    const fresh = envelope('doc', 2); fresh.doc = { ...fresh.doc, title: 'New project' };
    api.read.mockResolvedValueOnce(fresh);
    await render('/new');
    await act(async () => old.resolve(envelope('doc', 100)));
    expect(handle.doc).toMatchObject({ title: 'New project', version: 2 });
    expect(handle.busy).toBe(false);
  });

  it('refreshes a 409 conflict without retrying or overwriting the newer human state', async () => {
    await render(); api.mutate.mockRejectedValueOnce(new SoundApiError(409, 'version-conflict', 'Read again'));
    api.read.mockResolvedValueOnce(envelope('doc', 5));
    await act(async () => { await handle.patch([{ op: 'setDoc', patch: { title: 'Stale draft' } }]); });
    expect(api.mutate).toHaveBeenCalledTimes(1);
    expect(handle.doc?.version).toBe(5);
    expect(handle.error).toBe('panel.vibisound.workbench.conflict');
    expect(handle.busy).toBe(false);
  });

  it('blocks a stale number-field version before sending its edit', async () => {
    api.read.mockResolvedValue(envelope('doc', 5)); await render();
    await act(async () => { await handle.patch([{ op: 'setDoc', patch: { title: 'Old' } }], 4); });
    expect(api.mutate).not.toHaveBeenCalled();
    expect(handle.error).toBe('panel.vibisound.workbench.conflict');
  });

  it('does not leak a conflict refresh error after switching projects', async () => {
    await render('/old'); const refresh = pending<SoundEnvelope>();
    api.mutate.mockRejectedValueOnce(new SoundApiError(409, 'version-conflict', 'Read again'));
    api.read.mockReturnValueOnce(refresh.promise);
    await act(async () => { void handle.patch([{ op: 'setDoc', patch: { title: 'Old request' } }]); });
    api.read.mockResolvedValueOnce(envelope('new-doc', 1));
    await render('/new', 'new-doc');
    await act(async () => refresh.resolve(envelope('doc', 9)));
    expect(handle.doc?.id).toBe('new-doc');
    expect(handle.error).toBe('');
    expect(handle.busy).toBe(false);
  });

  it('preserves successful earlier imports when a later file fails', async () => {
    await render();
    api.import.mockResolvedValueOnce({ id: 'source', name: 'one.wav', path: 'one.wav', duration: 1, sampleRate: 8000, channels: 1 })
      .mockRejectedValueOnce(new Error('Second file cannot be decoded'));
    api.mutate.mockResolvedValueOnce(envelope('doc', 2));
    await act(async () => { await handle.importFiles(['one.wav', 'two.wav']); });
    expect(handle.doc?.version).toBe(2);
    expect(handle.error).toBe('Second file cannot be decoded');
    expect(api.mutate).toHaveBeenCalledTimes(1);
    expect(handle.busy).toBe(false);
  });

  it('uses measured decoded duration for the new clip while preserving original asset metadata', async () => {
    await render();
    const asset = { id: 'source', name: 'gapless.mp3', path: '.vibisual/audio/assets/gapless.mp3', duration: 3, sampleRate: 44100, channels: 1 };
    api.import.mockResolvedValueOnce(asset);
    api.measure.mockResolvedValueOnce(2.95);
    api.mutate.mockResolvedValueOnce(envelope('doc', 2));
    await act(async () => { await handle.importFiles(['gapless.mp3']); });
    expect(api.measure).toHaveBeenCalledExactlyOnceWith('/one', asset);
    expect(api.mutate.mock.calls[0]?.[3]).toEqual(expect.arrayContaining([
      { op: 'setAsset', asset },
      expect.objectContaining({ op: 'addClip', clip: expect.objectContaining({ assetId: 'source', sourceStart: 0, duration: 2.95 }) }),
    ]));
    expect(asset.duration).toBe(3);
    expect(handle.doc?.version).toBe(2);
  });

  it('does not commit a late source measurement after switching projects', async () => {
    await render('/old');
    const measurement = pending<number>();
    api.import.mockResolvedValueOnce({ id: 'source', name: 'old.mp3', path: 'old.mp3', duration: 3, sampleRate: 44100, channels: 1 });
    api.measure.mockReturnValueOnce(measurement.promise);
    await act(async () => { void handle.importFiles(['old.mp3']); });
    expect(api.measure).toHaveBeenCalledOnce();
    api.read.mockResolvedValueOnce(envelope('new-doc', 4));
    await render('/new', 'new-doc');
    await act(async () => measurement.resolve(2.95));
    expect(api.mutate).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(handle.doc).toMatchObject({ id: 'new-doc', version: 4 });
    expect(handle.error).toBe('');
    expect(handle.busy).toBe(false);
  });
});
