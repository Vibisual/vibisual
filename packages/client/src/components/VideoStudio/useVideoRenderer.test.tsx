import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';
import { useVideoRenderer, type RendererHandle } from './useVideoRenderer.js';

const mocks = vi.hoisted(() => ({
  backend: vi.fn(), provider: vi.fn(), draw: vi.fn<(id: string, at: number) => Promise<void>>(),
}));
vi.mock('@vibisual/video/render', async importOriginal => ({
  ...await importOriginal<typeof import('@vibisual/video/render')>(),
  Canvas2DBackend: class {
    canvas: { docId: string };
    init = vi.fn(async () => undefined);
    dispose = vi.fn();
    drawFrame: (at: number) => Promise<void>;
    constructor(options: { doc: VideoDoc }) {
      this.canvas = { docId: options.doc.id };
      this.drawFrame = (at: number) => mocks.draw(options.doc.id, at);
      mocks.backend(this);
    }
  },
}));
vi.mock('./videoMediaProvider.js', () => ({
  VideoMediaProvider: class {
    dispose = vi.fn();
    // §5.13 (Y) 40-6 — 공급자는 프로젝트당 하나라 소재 목록을 갈아 끼운다. 40-3 — 프레임 방식·화면 배율·놓친 프레임 수.
    setAssets = vi.fn((): string[] => []);
    setFrameMode = vi.fn();
    setDisplayScale = vi.fn();
    droppedFrameCount = vi.fn(() => 0);
    constructor() { mocks.provider(this); }
  },
}));
vi.mock('../../i18n/index.js', () => ({ default: { t: (key: string) => key } }));
vi.mock('./videoApi.js', () => ({ assetUrl: (project: string, path: string) => `${project}/${path}` }));
vi.mock('./compositionUrl.js', () => ({ makeCompositionSrc: () => () => null, compositionAssetSrc: () => null }));

interface Props { doc: VideoDoc; previewActive?: boolean }
let handle: RendererHandle;
let view: ReactTestRenderer | undefined;
function Harness({ doc, previewActive = true }: Props): null { handle = useVideoRenderer('project', doc, { previewActive }); return null; }
function mount(props: Props): void { view = create(createElement(Harness, props)); }
function update(props: Props): void { view!.update(createElement(Harness, props)); }
function canvas() {
  const drawImage = vi.fn();
  return { drawImage, element: { width: 400, height: 300, getContext: () => ({ drawImage }) } as unknown as HTMLCanvasElement };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { mocks.backend.mockClear(); mocks.provider.mockClear(); mocks.draw.mockReset().mockResolvedValue(undefined); });
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('preview renderer scope', () => {
  it('draws a new document while the old scope is still waiting, without presenting the late old frame', async () => {
    const old = deferred<void>();
    mocks.draw.mockImplementation(async id => { if (id === 'old') await old.promise; });
    const oldDoc = createEmptyDoc('old', 'Old', 1);
    const nextDoc = { ...oldDoc, id: 'new' };
    const target = canvas();
    await act(async () => mount({ doc: oldDoc }));
    let oldDraw!: Promise<void>;
    await act(async () => { oldDraw = handle.drawPreview(target.element, 0); });
    expect(mocks.draw).toHaveBeenCalledWith('old', 0);
    await act(async () => update({ doc: nextDoc }));
    let nextFinished = false;
    let nextDraw!: Promise<void>;
    await act(async () => { nextDraw = handle.drawPreview(target.element, 0).then(() => { nextFinished = true; }); });
    expect(nextFinished).toBe(true);
    expect(mocks.draw).toHaveBeenCalledWith('new', 0);
    expect(mocks.provider).toHaveBeenCalledOnce(); // Same assets retain the provider, so its disposal cannot unblock the old draw.
    expect(target.drawImage).toHaveBeenCalledExactlyOnceWith({ docId: 'new' }, 0, 0, 400, 300);
    await act(async () => { old.resolve(); await Promise.all([oldDraw, nextDraw]); });
    expect(target.drawImage).toHaveBeenCalledOnce();
  });

  it('releases the preview provider and suppresses an in-flight frame while inactive', async () => {
    const pending = deferred<void>();
    mocks.draw.mockReturnValueOnce(pending.promise);
    const doc = createEmptyDoc('doc', 'Preview', 1);
    const target = canvas();
    await act(async () => mount({ doc }));
    let draw!: Promise<void>;
    await act(async () => { draw = handle.drawPreview(target.element, 0); });
    const provider = mocks.provider.mock.calls[0]![0] as { dispose: ReturnType<typeof vi.fn> };
    await act(async () => update({ doc, previewActive: false }));
    expect(provider.dispose).toHaveBeenCalledOnce();
    expect(handle.media).toBeNull();
    await act(async () => { pending.resolve(); await draw; });
    expect(target.drawImage).not.toHaveBeenCalled();
    await act(async () => update({ doc, previewActive: true }));
    expect(mocks.provider).toHaveBeenCalledTimes(2);
    await act(async () => { await handle.drawPreview(target.element, 0); });
    expect(target.drawImage).toHaveBeenCalledOnce();
  });
});
