import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawOp } from '@vibisual/video/render';
import { newImageDocument, newImageLayer } from '../Creation/imageSource.js';
import { VideoMediaProvider, type ModelFrameRenderer } from './videoMediaProvider.js';

const mocks = vi.hoisted(() => ({ load: vi.fn(), bitmap: vi.fn() }));
vi.mock('./videoModelScene.js', () => ({ loadVideoModel: mocks.load }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function modelProvider(open = vi.fn(async () => new Blob(['model']))) {
  const frames = { draw: vi.fn(() => ({})), dispose: vi.fn() };
  const provider = new VideoMediaProvider({
    assets: { model: { id: 'model', kind: 'model', source: { kind: 'file', path: 'model.glb' } } },
    loader: { open }, frames: frames as unknown as ModelFrameRenderer,
  });
  const op = { kind: 'model', itemId: 'item', resolved: { item: { assetId: 'model' } } } as DrawOp;
  return { provider, frames, op, open };
}
function imageProvider() {
  const doc = newImageDocument();
  doc.layers = [0, 1, 2].map(index => ({ ...newImageLayer(doc, 'shape', `Layer ${index}`), id: `layer-${index}` }));
  const provider = new VideoMediaProvider({
    assets: { image: { id: 'image', kind: 'image', source: { kind: 'file', path: 'image.vibimage' } } },
    loader: { open: async () => new Blob([JSON.stringify(doc)]) },
  });
  const op = { kind: 'image', resolved: { item: { assetId: 'image', props: { layerMotion: { 'layer-0': { preset: 'fade' } } } } } } as unknown as DrawOp;
  return { provider, op };
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.load.mockReset(); mocks.bitmap.mockReset();
  vi.stubGlobal('Image', class { src = ''; decode = async () => undefined; });
  vi.stubGlobal('createImageBitmap', mocks.bitmap);
});
afterEach(() => vi.unstubAllGlobals());

describe('VideoMediaProvider lifetime', () => {
  it('does not recreate a renderer when a cached model resumes after close', async () => {
    const model = { dispose: vi.fn(), seek: vi.fn(), pick: vi.fn() };
    mocks.load.mockResolvedValue(model);
    const { provider, frames, op } = modelProvider();
    await provider.getModelFrame(op);
    frames.draw.mockClear();
    const pending = provider.getModelFrame(op);
    provider.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(frames.draw).not.toHaveBeenCalled();
    expect(model.dispose).toHaveBeenCalledOnce();
    provider.dispose();
    expect(frames.dispose).toHaveBeenCalledOnce();
  });

  it('does not parse model bytes delivered after close', async () => {
    const bytes = deferred<Blob>();
    const { provider, op, open } = modelProvider(vi.fn(() => bytes.promise));
    const pending = provider.getModelFrame(op);
    const signal = (open.mock.calls[0] as unknown as [unknown, AbortSignal])[1];
    provider.dispose();
    expect(signal.aborted).toBe(true);
    bytes.resolve(new Blob(['late model']));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(await provider.getImage('model')).toBeNull();
    expect(await provider.measure('model')).toBeNull();
    expect(await provider.pickModel(op, 0, 0)).toBeNull();
    expect(open).toHaveBeenCalledOnce();
  });

  it('closes already decoded layer bitmaps when a later layer fails', async () => {
    const base = { close: vi.fn() }; const layer = { close: vi.fn() };
    mocks.bitmap.mockResolvedValueOnce(base).mockResolvedValueOnce(layer).mockRejectedValueOnce(new Error('bad layer'));
    const { provider, op } = imageProvider();
    await expect(provider.getItemFrame(op)).rejects.toThrow('bad layer');
    expect(layer.close).toHaveBeenCalledOnce();
    provider.dispose();
    await Promise.resolve();
    expect(base.close).toHaveBeenCalledOnce();
    expect(layer.close).toHaveBeenCalledOnce();
  });

  it('releases partial layers on close and stops decoding the remaining layers', async () => {
    const base = { close: vi.fn() }; const first = { close: vi.fn() }; const late = { close: vi.fn() };
    const pendingBitmap = deferred<typeof late>();
    mocks.bitmap.mockResolvedValueOnce(base).mockResolvedValueOnce(first).mockReturnValueOnce(pendingBitmap.promise);
    const { provider, op } = imageProvider();
    const pending = provider.getItemFrame(op);
    await vi.waitFor(() => expect(mocks.bitmap).toHaveBeenCalledTimes(3));
    provider.dispose();
    await Promise.resolve();
    expect(first.close).toHaveBeenCalledOnce();
    expect(base.close).toHaveBeenCalledOnce();
    pendingBitmap.resolve(late);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(late.close).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
    expect(mocks.bitmap).toHaveBeenCalledTimes(3);
  });
});
