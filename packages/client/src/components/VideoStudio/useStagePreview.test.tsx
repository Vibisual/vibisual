import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';
import type { MediaProvider } from '@vibisual/video/render';
import { useStagePreview } from './useStagePreview.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), seek: vi.fn<(at: number) => Promise<void>>() }));
vi.mock('@vibisual/video/render', () => ({
  HtmlSceneStage: class {
    element = { style: {} };
    seek = vi.fn((at: number) => mocks.seek(at));
    setDoc = vi.fn();
    dispose = vi.fn();
    playingFlag = false;
    play = vi.fn(() => { this.playingFlag = true; });
    stopPlay = vi.fn(() => { this.playingFlag = false; });
    get playing(): boolean { return this.playingFlag; }
    constructor(options: unknown) { mocks.create(this, options); }
  },
}));
vi.mock('./compositionUrl.js', () => ({ makeCompositionSrc: () => () => null }));

type Props = Parameters<typeof useStagePreview>[0];
interface FakeStage { seek: ReturnType<typeof vi.fn>; setDoc: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; stopPlay: ReturnType<typeof vi.fn> }
let handle: ReturnType<typeof useStagePreview>;
let view: ReactTestRenderer | undefined;
function Harness(props: Props): null { handle = useStagePreview(props); return null; }
function document(id = 'first'): VideoDoc { return createEmptyDoc(id, 'Preview', 1); }
function props(): Props {
  return { enabled: true, project: 'project', doc: document(), media: {} as MediaProvider,
    host: { current: { clientWidth: 400, clientHeight: 300 } as HTMLDivElement }, onEvent: vi.fn() };
}
function stage(index: number): FakeStage { return mocks.create.mock.calls[index]![0] as FakeStage; }
function mount(value: Props): void { view = create(createElement(Harness, value)); }
function update(value: Props): void { view!.update(createElement(Harness, value)); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => { mocks.create.mockClear(); mocks.seek.mockReset().mockResolvedValue(undefined); });
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('stage preview lifecycle', () => {
  it.each(['document', 'project'] as const)('starts at zero after a %s boundary instead of loading the previous position', async boundary => {
    const value = props();
    await act(async () => mount(value));
    await act(async () => { await handle.seek(8); });
    expect(stage(0).seek.mock.calls).toEqual([[0], [8]]);
    await act(async () => update({ ...value, ...(boundary === 'document' ? { doc: document('second') } : { project: 'other-project' }) }));
    expect(stage(0).dispose).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(stage(1).seek.mock.calls).toEqual([[0]]);
    expect(handle.ready).toBe(true);
  });

  it('restores the same document at its previous position after releasing the hidden stage', async () => {
    const value = props();
    await act(async () => mount(value));
    await act(async () => { await handle.seek(8); });
    await act(async () => update({ ...value, enabled: false }));
    expect(stage(0).dispose).toHaveBeenCalledOnce();
    expect(handle.ready).toBe(false);
    await act(async () => update(value));
    expect(stage(1).seek.mock.calls).toEqual([[8]]);
    expect(handle.ready).toBe(true);
  });

  it('returns false for a failed first frame and retries the same frame on the next request', async () => {
    const initial = deferred<void>();
    mocks.seek.mockReturnValueOnce(initial.promise);
    const value = props();
    await act(async () => mount(value));
    expect(handle.ready).toBe(false);
    let requested!: Promise<boolean>;
    await act(async () => { requested = handle.seek(0); });
    await act(async () => { initial.reject(new Error('composition failed')); });
    await expect(requested).resolves.toBe(false);
    expect(handle.ready).toBe(false);
    expect(value.onEvent).toHaveBeenCalledExactlyOnceWith('', { kind: 'error', message: 'composition failed' });
    let retried: boolean | undefined;
    await act(async () => { retried = await handle.seek(0); });
    expect(retried).toBe(true);
    expect(handle.ready).toBe(true);
    expect(stage(0).seek.mock.calls).toEqual([[0], [0]]);
  });

  it('does not let an old stage finish the new document readiness', async () => {
    const old = deferred<void>();
    const current = deferred<void>();
    mocks.seek.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const value = props();
    await act(async () => mount(value));
    await act(async () => update({ ...value, doc: document('second') }));
    await act(async () => old.resolve());
    expect(handle.ready).toBe(false);
    expect(value.onEvent).not.toHaveBeenCalled();
    await act(async () => current.resolve());
    expect(handle.ready).toBe(true);
  });
});

describe('§5.13 (Z) 41-2 재생 박자를 무대에 맞춘다', () => {
  it('처음엔 기준을 걸고, 그 직선에서 반 프레임 안이면 다시 보내지 않으며, 넘으면 새 기준을 보낸다', async () => {
    await act(async () => mount(props()));
    act(() => handle.syncPlay({ t: 1, perfMs: 1000 }));
    expect(stage(0).play).toHaveBeenCalledExactlyOnceWith({ t: 1, perfMs: 1000 });
    act(() => handle.syncPlay({ t: 1.5, perfMs: 1500 }));
    act(() => handle.syncPlay({ t: 1.6 + 0.4 / 30, perfMs: 1600 }));
    expect(stage(0).play).toHaveBeenCalledTimes(1);
    act(() => handle.syncPlay({ t: 1.7 + 0.6 / 30, perfMs: 1700 }));
    expect(stage(0).play).toHaveBeenCalledTimes(2);
    // 반복으로 처음으로 돌아갔다.
    act(() => handle.syncPlay({ t: 0, perfMs: 1800 }));
    expect(stage(0).play).toHaveBeenLastCalledWith({ t: 0, perfMs: 1800 });
  });

  it('재생이 끝나면(null) 무대의 재생을 끝내고 그 자리를 정확한 한 장으로 다시 그린다', async () => {
    await act(async () => mount(props()));
    await act(async () => { await handle.seek(3); });
    act(() => handle.syncPlay({ t: 3, perfMs: 0 }));
    stage(0).seek.mockClear();
    await act(async () => { handle.syncPlay(null); });
    expect(stage(0).stopPlay).toHaveBeenCalledOnce();
    expect(stage(0).seek).toHaveBeenLastCalledWith(3);
    // 재생 중이 아니면 null 은 아무 일도 하지 않는다.
    stage(0).seek.mockClear();
    await act(async () => { handle.syncPlay(null); });
    expect(stage(0).stopPlay).toHaveBeenCalledOnce();
    expect(stage(0).seek).not.toHaveBeenCalled();
  });

  it('무대를 새로 세우면(문서가 바뀌면) 다음 박자에 기준을 다시 건다', async () => {
    const value = props();
    await act(async () => mount(value));
    act(() => handle.syncPlay({ t: 1, perfMs: 1000 }));
    await act(async () => update({ ...value, doc: document('second') }));
    act(() => handle.syncPlay({ t: 1.1, perfMs: 1100 }));
    expect(stage(1).play).toHaveBeenCalledExactlyOnceWith({ t: 1.1, perfMs: 1100 });
  });

  it('첫 그림을 못 낸 장면 자리(가벼운 판)를 알리고 계측에도 넘긴다', async () => {
    const cold = vi.fn();
    await act(async () => mount({ ...props(), perf: { cold } }));
    const options = mocks.create.mock.calls[0]![1] as { onCold: (value: boolean) => void };
    await act(async () => { options.onCold(true); });
    expect(handle.cold).toBe(true);
    expect(cold).toHaveBeenLastCalledWith(true);
    await act(async () => { options.onCold(false); });
    expect(handle.cold).toBe(false);
  });
});
