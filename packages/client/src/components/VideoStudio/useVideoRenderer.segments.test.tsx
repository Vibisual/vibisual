import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VideoDoc } from '@vibisual/video';
import type { SegmentStore } from '@vibisual/video/render';
import { useVideoRenderer, type RendererHandle } from './useVideoRenderer.js';

/** §5.13 (E-5) — 렌더 길이 구간 캐시로 가는 경우와 한 인코더 렌더로 내려가는 경우. */

const mocks = vi.hoisted(() => ({
  renderDoc: vi.fn(), segmented: vi.fn(), canHash: vi.fn(() => true), backends: [] as { id: string; ratio: number }[],
}));
vi.mock('@vibisual/video/render', async (importOriginal) => {
  const original = await importOriginal<typeof import('@vibisual/video/render')>();
  class Unavailable {
    constructor(readonly id: string) {}
    probe = async () => ({ id: this.id, available: false, reason: 'test' });
    dispose = (): void => undefined;
  }
  return {
    ...original,
    HtmlSceneStage: class { dispose = (): void => undefined; },
    HtmlInCanvasBackend: class extends Unavailable { constructor() { super('html-in-canvas'); } },
    PooledCaptureBackend: class extends Unavailable { constructor() { super('offscreen-capture'); } },
    Canvas2DBackend: class {
      readonly id = 'canvas2d';
      ratio = 1;
      constructor() { mocks.backends.push(this); }
      probe = async () => ({ id: this.id, available: true });
      captureRatio = (): number => this.ratio;
      dispose = (): void => undefined;
    },
    renderDoc: mocks.renderDoc,
    renderDocSegmented: mocks.segmented,
    canHashSegments: mocks.canHash,
  };
});
vi.mock('./studioMedia.js', () => ({ createStudioMedia: () => ({ dispose: (): void => undefined, setAssets: (): string[] => [] }), studioAudioLoader: () => null }));
vi.mock('../../i18n/index.js', () => ({ default: { t: (key: string) => key } }));
vi.mock('./videoApi.js', () => ({ assetUrl: (project: string, path: string) => `${project}/${path}` }));
vi.mock('./compositionUrl.js', () => ({ makeCompositionSrc: () => () => null, compositionAssetSrc: () => null }));

const doc: VideoDoc = {
  schemaVersion: 1, id: 'd', title: 't', version: 1, size: { width: 320, height: 180 }, fps: 30,
  tracks: [{ id: 'v', kind: 'visual', items: [{ id: 'a', kind: 'text', at: 0, duration: 4, props: { text: 'hi' } }] }],
  assets: {}, createdAt: 0, updatedAt: 0,
};
const RESULT = { bytes: null, size: 10, frames: 120, reusedFrames: 0, durationSec: 4, codecs: { video: 'avc', audio: null }, container: 'mp4' };
const store: SegmentStore = { env: async () => ({ files: {}, shared: '' }), has: async () => new Set(), get: async () => null, put: async () => undefined };

let handle: RendererHandle;
let view: ReactTestRenderer | undefined;
function Harness(): null { handle = useVideoRenderer('project', doc, { previewActive: false }); return null; }
beforeEach(() => {
  // 시험 환경(Node)에는 창이 없다 — 오프스크린 다리는 "앱 통로 없음"으로 물러난다.
  vi.stubGlobal('window', {});
  // Node 20 에는 전역 navigator 가 없다 — 판마다 같은 값으로 세운다.
  vi.stubGlobal('navigator', { userAgent: 'test-agent', hardwareConcurrency: 4 });
  mocks.backends.length = 0;
  mocks.renderDoc.mockReset().mockResolvedValue(RESULT);
  mocks.segmented.mockReset().mockResolvedValue({ ...RESULT, reusedFrames: 60, segments: { total: 2, reused: 1 } });
  mocks.canHash.mockReset().mockReturnValue(true);
  act(() => { view = create(createElement(Harness)); });
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });

describe('render — 구간 캐시로 가는 길', () => {
  it('구간 저장소를 받으면 구간 길로 굽고 재사용 수를 돌려준다', async () => {
    const outcome = await handle.render({ segments: store });
    expect(mocks.segmented).toHaveBeenCalledOnce();
    expect(mocks.renderDoc).not.toHaveBeenCalled();
    const options = mocks.segmented.mock.calls[0]![0] as { store: SegmentStore; engine: string; backend: { id: string }; doc: VideoDoc };
    expect(options.store).toBe(store);
    expect(options.engine).toBe('test-agent');
    expect(options.backend.id).toBe('canvas2d');
    expect(options.doc).toBe(doc);
    expect(outcome.segments).toEqual({ total: 2, reused: 1 });
    expect(outcome.warnings).toEqual([]);
  });

  it('구간 저장소가 없으면 종전 한 인코더 렌더다', async () => {
    const outcome = await handle.render({});
    expect(mocks.renderDoc).toHaveBeenCalledOnce();
    expect(mocks.segmented).not.toHaveBeenCalled();
    expect(outcome.segments).toBeUndefined();
  });

  it('해시를 쓸 수 없는 문맥이면 저장소가 있어도 한 인코더 렌더다', async () => {
    mocks.canHash.mockReturnValue(false);
    await handle.render({ segments: store });
    expect(mocks.renderDoc).toHaveBeenCalledOnce();
    expect(mocks.segmented).not.toHaveBeenCalled();
  });

  it('소리만 내보내기는 구간 길을 타지 않는다', async () => {
    await expect(handle.render({ segments: store, audioOnly: true })).rejects.toThrow('panel.videoStudio.export.noSoundToExport');
    expect(mocks.segmented).not.toHaveBeenCalled();
    expect(mocks.renderDoc).not.toHaveBeenCalled();
  });

  it('낮은 해상도로 찍힌 구간은 보관하지 말라고 알린다', async () => {
    await handle.render({ segments: store });
    const options = mocks.segmented.mock.calls[0]![0] as { canStore: () => boolean };
    expect(options.canStore()).toBe(true);
    mocks.backends[0]!.ratio = 0.5;
    expect(options.canStore()).toBe(false);
  });
});

describe('render — 구간을 이을 수 없을 때', () => {
  it('올린 결과를 버리고 새 백엔드로 처음부터 한 인코더로 굽고, 그 사실을 알린다', async () => {
    const { SegmentJoinError } = await import('@vibisual/video/render');
    mocks.segmented.mockRejectedValueOnce(new SegmentJoinError('decoder'));
    const order: string[] = [];
    const sink = { write: vi.fn(async () => undefined), reset: vi.fn(async () => { order.push('reset'); }) };
    mocks.renderDoc.mockImplementationOnce(async () => { order.push('renderDoc'); return RESULT; });
    const outcome = await handle.render({ segments: store, sink });
    expect(order).toEqual(['reset', 'renderDoc']);
    expect(mocks.backends).toHaveLength(2);
    const again = mocks.renderDoc.mock.calls[0]![0] as { backend: unknown; sink: unknown };
    expect(again.backend).toBe(mocks.backends[1]);
    expect(again.sink).toBe(sink);
    expect(outcome.warnings).toEqual(['panel.videoStudio.segmentsFallback']);
    expect(outcome.segments).toBeUndefined();
  });

  it('받는 곳이 메모리면 버릴 것 없이 다시 굽는다', async () => {
    const { SegmentJoinError } = await import('@vibisual/video/render');
    mocks.segmented.mockRejectedValueOnce(new SegmentJoinError('keyframe'));
    const outcome = await handle.render({ segments: store });
    expect(mocks.renderDoc).toHaveBeenCalledOnce();
    expect(outcome.warnings).toEqual(['panel.videoStudio.segmentsFallback']);
  });

  it('버릴 길이 없는 받는 곳이면 다시 굽지 않고 그대로 실패한다(반쯤 쓴 결과 위에 덧쓰지 않는다)', async () => {
    const { SegmentJoinError } = await import('@vibisual/video/render');
    mocks.segmented.mockRejectedValueOnce(new SegmentJoinError('decoder'));
    await expect(handle.render({ segments: store, sink: { write: async () => undefined } })).rejects.toBeInstanceOf(SegmentJoinError);
    expect(mocks.renderDoc).not.toHaveBeenCalled();
  });

  it('다른 오류(중단 등)는 다시 굽지 않는다', async () => {
    mocks.segmented.mockRejectedValueOnce(new Error('boom'));
    const sink = { write: vi.fn(async () => undefined), reset: vi.fn(async () => undefined) };
    await expect(handle.render({ segments: store, sink })).rejects.toThrow('boom');
    expect(sink.reset).not.toHaveBeenCalled();
    expect(mocks.renderDoc).not.toHaveBeenCalled();
  });
});
