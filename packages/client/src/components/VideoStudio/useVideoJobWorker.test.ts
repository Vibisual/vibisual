import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyDoc, type VideoDoc } from '@vibisual/video';
import { useVideoJobWorker } from './useVideoJobWorker.js';
import type { VideoJob } from './videoApi.js';
import type { RenderOutcome } from './useVideoRenderer.js';

const mocks = vi.hoisted(() => ({ claim: vi.fn(), complete: vi.fn(), completeStill: vi.fn(), read: vi.fn(), report: vi.fn(), render: vi.fn(), still: vi.fn(), progress: vi.fn(), status: vi.fn(), download: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { id?: string }): string => options?.id ? `${key}:${options.id}` : key }) }));
vi.mock('./videoApi.js', () => ({ claimJob: mocks.claim, completeRenderJob: mocks.complete, completeStillJob: mocks.completeStill, readDoc: mocks.read, reportJob: mocks.report }));
vi.mock('./useVideoRenderer.js', () => ({ useVideoRenderer: (project: string, doc: VideoDoc | null) => ({
  render: (options: unknown) => mocks.render(project, doc, options), still: (at: number) => mocks.still(project, doc, at),
}) }));
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const pending = { current: 0 };
let view: ReactTestRenderer | undefined;
const doc = createEmptyDoc('queued-doc', 'Queued document', 100);
const outcome: RenderOutcome = { bytes: new Uint8Array([1, 2, 3]), hasAudio: true, selection: null, warnings: [], container: 'mp4' };
const job = (kind: VideoJob['kind'] = 'render'): VideoJob => ({ id: 'job', kind, projectPath: 'A', docId: doc.id, status: 'running', progress: 0, t: 2.5 });
function Harness({ project }: { project: string }) { useVideoJobWorker(project, pending, mocks.progress, mocks.status, mocks.download); return null; }
function mount(): void { act(() => { view = create(createElement(Harness, { project: 'A' })); }); }
async function tick(): Promise<void> { await act(async () => { await vi.advanceTimersByTimeAsync(1200); }); }
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); pending.current = 0;
  mocks.claim.mockReset().mockResolvedValue(null); mocks.read.mockReset().mockResolvedValue({ doc }); mocks.report.mockReset().mockResolvedValue(undefined);
  mocks.complete.mockReset().mockResolvedValue(undefined);
  mocks.completeStill.mockReset().mockResolvedValue(undefined);
  mocks.render.mockReset().mockResolvedValue(outcome); mocks.still.mockReset().mockResolvedValue('data:image/png;base64,STILL');
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:result');
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('studio job worker', () => {
  it('renders the claimed document and serializes claims through render completion', async () => {
    const render = deferred<RenderOutcome>(); mocks.render.mockReturnValueOnce(render.promise); mocks.claim.mockResolvedValueOnce(job()); mount();
    await tick(); expect(mocks.claim).toHaveBeenCalledWith('A'); expect(mocks.read).toHaveBeenCalledWith('A', 'queued-doc');
    expect(mocks.render.mock.calls[0]?.slice(0, 2)).toEqual(['A', doc]); expect(pending.current).toBe(1);
    await tick(); await tick(); expect(mocks.claim).toHaveBeenCalledTimes(1);
    await act(async () => { render.resolve(outcome); });
    expect(mocks.complete).toHaveBeenLastCalledWith('job', outcome.bytes, '');
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.download).toHaveBeenCalledWith({ url: 'blob:result', name: 'Queued document.mp4', docId: 'queued-doc' }); expect(pending.current).toBe(0);
    await tick(); expect(mocks.claim).toHaveBeenCalledTimes(2);
  });

  it('renders still jobs at their requested time without exporting a video', async () => {
    mocks.claim.mockResolvedValueOnce(job('still')); mount(); await tick();
    expect(mocks.still).toHaveBeenCalledWith('A', doc, 2.5);
    expect(mocks.completeStill).toHaveBeenCalledWith('job', 'data:image/png;base64,STILL');
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled(); expect(mocks.complete).not.toHaveBeenCalled(); expect(mocks.download).not.toHaveBeenCalled(); expect(pending.current).toBe(0);
  });

  it('waits for outstanding progress reports before sending the terminal report', async () => {
    const progress = deferred<void>(); const render = deferred<RenderOutcome>();
    mocks.report.mockImplementation((_id: string, patch: { status: string }) => patch.status === 'running' ? progress.promise : Promise.resolve());
    mocks.render.mockReturnValueOnce(render.promise); mocks.claim.mockResolvedValueOnce(job()); mount(); await tick();
    const options = mocks.render.mock.calls[0]?.[2] as { onProgress: (value: { frame: number; totalFrames: number }) => void };
    await act(async () => { options.onProgress({ frame: 1, totalFrames: 2 }); render.resolve(outcome); });
    expect(mocks.report.mock.calls.map(call => call[1].status)).toEqual(['running']); expect(pending.current).toBe(1);
    expect(mocks.complete).not.toHaveBeenCalled();
    await act(async () => { progress.resolve(); });
    expect(mocks.complete).toHaveBeenCalledWith('job', outcome.bytes, '');
    expect(mocks.report.mock.invocationCallOrder[0]).toBeLessThan(mocks.complete.mock.invocationCallOrder[0]!);
    expect(pending.current).toBe(0);
  });

  it('requeues a job claimed after unmount without opening its document', async () => {
    const claim = deferred<VideoJob | null>(); mocks.claim.mockReturnValueOnce(claim.promise); mount(); await tick();
    act(() => view?.unmount()); view = undefined;
    await act(async () => { claim.resolve(job()); });
    expect(mocks.report).toHaveBeenCalledWith('job', { status: 'queued' }); expect(mocks.read).not.toHaveBeenCalled(); expect(pending.current).toBe(0);
  });

  it('requeues work when its document load finishes after changing projects', async () => {
    const read = deferred<{ doc: VideoDoc }>(); mocks.read.mockReturnValueOnce(read.promise); mocks.claim.mockResolvedValueOnce(job()); mount(); await tick();
    act(() => view?.update(createElement(Harness, { project: 'B' })));
    await act(async () => { read.resolve({ doc }); });
    expect(mocks.report).toHaveBeenCalledWith('job', { status: 'queued' }); expect(mocks.render).not.toHaveBeenCalled();
    await tick(); expect(mocks.claim).toHaveBeenLastCalledWith('B');
  });

  it.each(['unmount', 'switch'] as const)('does not download or update another view after %s during completion report', async action => {
    const report = deferred<void>(); mocks.complete.mockReturnValueOnce(report.promise); mocks.claim.mockResolvedValueOnce(job()); mount(); await tick();
    expect(mocks.complete).toHaveBeenCalledWith('job', outcome.bytes, '');
    if (action === 'unmount') { act(() => view?.unmount()); view = undefined; }
    else act(() => view?.update(createElement(Harness, { project: 'B' })));
    mocks.status.mockClear(); mocks.progress.mockClear();
    await act(async () => { report.resolve(); });
    expect(mocks.download).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.progress).not.toHaveBeenCalled(); expect(pending.current).toBe(0);
  });

  it('aborts and reports an in-flight render once on unmount', async () => {
    const render = deferred<RenderOutcome>(); mocks.render.mockReturnValueOnce(render.promise); mocks.claim.mockResolvedValueOnce(job()); mount(); await tick();
    const options = mocks.render.mock.calls[0]?.[2] as { signal: AbortSignal };
    act(() => view?.unmount()); view = undefined; expect(options.signal.aborted).toBe(true);
    await act(async () => { render.reject(new Error('aborted')); });
    expect(mocks.report).toHaveBeenLastCalledWith('job', { status: 'error', error: 'Error: aborted' });
    expect(mocks.download).not.toHaveBeenCalled(); expect(pending.current).toBe(0);
  });

  it('keeps audio and renderer fallback warnings in both the saved job and the visible status', async () => {
    mocks.render.mockResolvedValueOnce({ ...outcome, hasAudio: false, selection: { chosen: 'canvas2d', downgraded: true, skipped: [] }, warnings: ['Source warning'] });
    mocks.claim.mockResolvedValueOnce(job()); mount(); await tick();
    const note = 'Source warning · panel.videoStudio.noAudio · panel.videoStudio.downgraded:canvas2d';
    expect(mocks.complete).toHaveBeenLastCalledWith('job', outcome.bytes, note);
    expect(mocks.status).toHaveBeenLastCalledWith(note);
  });

  it('passes large video bytes unchanged through the binary completion API', async () => {
    const bytes = new Uint8Array(256 * 1024).fill(173);
    mocks.render.mockResolvedValueOnce({ ...outcome, bytes }); mocks.claim.mockResolvedValueOnce(job()); mount(); await tick();
    expect(mocks.complete.mock.calls[0]?.[1]).toBe(bytes);
    expect(mocks.report).not.toHaveBeenCalled(); expect(mocks.download).toHaveBeenCalledOnce();
  });

  it('reports binary upload failure without offering an unsaved result for download', async () => {
    mocks.complete.mockRejectedValueOnce(new Error('Upload failed')); mocks.claim.mockResolvedValueOnce(job()); mount(); await tick();
    expect(mocks.report).toHaveBeenLastCalledWith('job', { status: 'error', error: 'Error: Upload failed' });
    expect(mocks.download).not.toHaveBeenCalled(); expect(mocks.status).toHaveBeenLastCalledWith('Error: Upload failed');
    expect(pending.current).toBe(0);
  });

  it('uses the binary completion API for large still images and reports upload errors', async () => {
    const image = `data:image/png;base64,${'A'.repeat(256 * 1024)}`;
    mocks.still.mockResolvedValueOnce(image); mocks.completeStill.mockRejectedValueOnce(new Error('Still upload failed'));
    mocks.claim.mockResolvedValueOnce(job('still')); mount(); await tick();
    expect(mocks.completeStill).toHaveBeenCalledWith('job', image);
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith('job', { status: 'error', error: 'Error: Still upload failed' });
    expect(pending.current).toBe(0);
  });
});
