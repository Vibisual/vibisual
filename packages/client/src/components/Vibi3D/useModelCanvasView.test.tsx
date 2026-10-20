import { createElement, type RefObject } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, Vector3 } from 'three';
import { APP_CANVAS_FACE, type CreationDoc } from '@vibisual/shared';
import type { LiveModel, LiveModelLoad, LiveView, OrbitAngles } from './modelCanvasLive.js';
import { useModelCanvasView } from './useModelCanvasView.js';

const mocks = vi.hoisted(() => ({ source: vi.fn(), file: vi.fn(), view: vi.fn() }));
vi.mock('./modelCanvasLive.js', () => ({ loadLiveModelSource: mocks.source, loadLiveModel: mocks.file, createLiveView: mocks.view, homeAngles: () => ({ yaw: 45, pitch: 25 }) }));
const host: RefObject<HTMLDivElement> = { current: { appendChild: vi.fn() } as unknown as HTMLDivElement };
function doc(revision: number, id = 'doc'): CreationDoc {
  return { schemaVersion: 1, id, appId: 'vibi3d', revision, title: id, payload: { revision }, parameters: {}, lockedPaths: [], links: [], createdAt: 1, updatedAt: revision, label: '', author: 'agent' };
}
function model(): LiveModel { return { object: new Group(), center: new Vector3(), radius: 1, dispose: vi.fn() }; }
const views: LiveView[] = [];
let seen: ReturnType<typeof useModelCanvasView>;
function Probe({ document = null, enabled = true, file = '', version = 0 }: { document?: CreationDoc | null; enabled?: boolean; file?: string; version?: number }): null {
  seen = useModelCanvasView({ projectId: 'project', file, version, document, workRef: document?.id, enabled, host, width: 200, height: 100 });
  return null;
}
let component: ReactTestRenderer | undefined;
const render = async (props: Parameters<typeof Probe>[0]): Promise<void> => {
  await act(async () => {
    if (component) component.update(createElement(Probe, props)); else component = create(createElement(Probe, props));
    await vi.dynamicImportSettled();
  });
};
beforeEach(() => {
  vi.useFakeTimers(); views.length = 0;
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  mocks.source.mockReset(); mocks.file.mockReset(); mocks.view.mockReset();
  mocks.source.mockImplementation(async () => ({ ok: true, model: model() }));
  mocks.file.mockImplementation(async () => ({ ok: true, model: model() }));
  mocks.view.mockImplementation((_model: LiveModel, _w: number, _h: number, _ratio: number, angles: OrbitAngles): LiveView => {
    const url = `blob:stage-${views.length + 1}`;
    const view: LiveView = {
      canvas: { remove: vi.fn() } as unknown as HTMLCanvasElement,
      setSize: vi.fn(), orbit: (yaw, pitch) => { angles.yaw += yaw; angles.pitch += pitch; },
      home: () => { angles.yaw = 45; angles.pitch = 25; }, render: vi.fn(), snapshot: vi.fn(async () => url), dispose: vi.fn(),
    };
    views.push(view); return view;
  });
});
afterEach(() => { act(() => component?.unmount()); component = undefined; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('canvas scene ownership', () => {
  it('bakes a ref-only document, returns the WebGL context immediately, and does not read an output file', async () => {
    await render({ document: doc(1) });
    expect(mocks.source).toHaveBeenCalledWith('project', { revision: 1 }, 'doc');
    expect(mocks.file).not.toHaveBeenCalled();
    expect(seen).toMatchObject({ phase: 'still', snapshot: 'blob:stage-1', shownDocument: { revision: 1 } });
    expect(views[0]!.dispose).toHaveBeenCalledOnce();
  });

  it('keeps the previous image and user orbit until the next committed stage is ready', async () => {
    await render({ document: doc(1) });
    await act(async () => { seen.beginDrag(0, 0); await vi.dynamicImportSettled(); });
    act(() => { seen.moveDrag(20, 10); seen.endDrag(); });
    const angles = mocks.view.mock.calls[1]![4] as OrbitAngles;
    const yaw = angles.yaw;
    const second = model();
    let finish!: (result: LiveModelLoad) => void;
    mocks.source.mockReturnValueOnce(new Promise<LiveModelLoad>((resolve) => { finish = resolve; }));
    await render({ document: doc(2) });
    expect(seen.snapshot).toBe('blob:stage-1');
    expect(seen.shownDocument?.revision).toBe(1);
    expect(seen.phase).toBe('loading');
    await act(async () => { finish({ ok: true, model: second }); });
    expect(seen.shownDocument?.revision).toBe(2);
    expect(seen.snapshot).toBe('blob:stage-3');
    expect(mocks.view.mock.calls[2]![4]).toBe(angles);
    expect(angles.yaw).toBe(yaw);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:stage-1');
  });

  it('disposes late loads from an obsolete revision without ever presenting them', async () => {
    let finish!: (result: LiveModelLoad) => void;
    const obsolete = model();
    mocks.source.mockReturnValueOnce(new Promise<LiveModelLoad>((resolve) => { finish = resolve; }));
    await render({ document: doc(1) });
    await render({ document: doc(2) });
    await act(async () => { finish({ ok: true, model: obsolete }); });
    expect(obsolete.dispose).toHaveBeenCalledOnce();
    expect(seen.shownDocument?.revision).toBe(2);
    expect(mocks.view).toHaveBeenCalledTimes(1);
  });

  it('shows an empty document as waiting, keeps good snapshots on failure and recovers on a new stage', async () => {
    await render({ document: doc(1) });
    mocks.source.mockResolvedValueOnce({ ok: false, reason: 'failed' });
    await render({ document: doc(2) });
    expect(seen).toMatchObject({ phase: 'failed', snapshot: 'blob:stage-1' });
    await render({ document: doc(3) });
    expect(seen.phase).toBe('still');
    mocks.source.mockResolvedValueOnce({ ok: false, reason: 'empty' });
    await render({ document: doc(4) });
    expect(seen).toMatchObject({ phase: 'empty', snapshot: null, shownDocument: null });
  });

  it('bakes the empty editor stage instead of replacing it with an icon', async () => {
    mocks.source.mockResolvedValueOnce({ ok: true, model: { ...model(), empty: true } });
    await render({ document: doc(1) });
    expect(seen).toMatchObject({ phase: 'empty', snapshot: 'blob:stage-1', shownDocument: { revision: 1 } });
    expect(views[0]!.dispose).toHaveBeenCalledOnce();
  });

  it('legacy files remain lazy and a new version re-reads the same file', async () => {
    await render({ file: 'model.glb', version: 1 });
    expect(mocks.file).not.toHaveBeenCalled();
    await act(async () => { seen.beginDrag(0, 0); await vi.dynamicImportSettled(); seen.endDrag(); });
    expect(mocks.file).toHaveBeenCalledWith('project', 'model.glb');
    await act(async () => { await vi.advanceTimersByTimeAsync(APP_CANVAS_FACE.liveIdleMs); });
    expect(seen.phase).toBe('still');
    await render({ file: 'model.glb', version: 2 });
    expect(seen.snapshot).toBeNull();
    await act(async () => { seen.beginDrag(0, 0); await vi.dynamicImportSettled(); });
    expect(mocks.file).toHaveBeenCalledTimes(2);
  });

  it('releases a late snapshot URL after unmount and keeps hidden faces from allocating WebGL', async () => {
    await render({ document: doc(1), enabled: false });
    expect(mocks.source).not.toHaveBeenCalled();
    let finish!: (url: string | null) => void;
    mocks.view.mockImplementationOnce((): LiveView => ({
      canvas: { remove: vi.fn() } as unknown as HTMLCanvasElement, setSize: vi.fn(), orbit: vi.fn(), home: vi.fn(), render: vi.fn(), dispose: vi.fn(),
      snapshot: () => new Promise<string | null>((resolve) => { finish = resolve; }),
    }));
    await render({ document: doc(1) });
    act(() => component!.unmount()); component = undefined;
    await act(async () => { finish('blob:late'); });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late');
  });
});
