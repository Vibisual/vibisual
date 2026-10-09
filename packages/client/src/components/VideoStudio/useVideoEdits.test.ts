import { createElement, useEffect, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPatch, createEmptyDoc, type VideoDoc, type VideoDocOp } from '@vibisual/video';
import { useVideoEdits } from './useVideoEdits.js';
import { VersionConflictError } from './videoApi.js';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), read: vi.fn(), setDoc: vi.fn(), status: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string): string => key }) }));
vi.mock('./videoApi.js', () => ({ patchDoc: mocks.patch, readDoc: mocks.read, VersionConflictError: class extends Error {} }));
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
let view: ReactTestRenderer | undefined;
let edits: ReturnType<typeof useVideoEdits>;
let displayed: VideoDoc;
let server: VideoDoc;
const pending = { current: 0 };
function Harness({ project, incoming }: { project: string; incoming: VideoDoc }) {
  const [doc, setDoc] = useState(incoming);
  useEffect(() => setDoc(incoming), [incoming]);
  displayed = doc;
  edits = useVideoEdits(project, doc, value => { mocks.setDoc(value); setDoc(value); }, mocks.status, pending);
  return null;
}
function mount(): void { act(() => { view = create(createElement(Harness, { project: 'A', incoming: server })); }); }
function update(project: string, incoming: VideoDoc): void { act(() => view?.update(createElement(Harness, { project, incoming }))); }
const rename = (title: string): VideoDocOp[] => [{ op: 'setDoc', patch: { title } }];
beforeEach(() => {
  vi.clearAllMocks(); pending.current = 0; server = createEmptyDoc('doc', 'Original', 100);
  mocks.patch.mockReset().mockImplementation(async (_project: string, _id: string, baseVersion: number, ops: VideoDocOp[]) => {
    const result = applyPatch(server, { baseVersion, ops }, 200);
    if (!result.ok) throw new Error(JSON.stringify(result));
    server = result.doc; return { doc: server };
  });
  mocks.read.mockReset().mockImplementation(async () => ({ doc: server }));
});
afterEach(() => { act(() => view?.unmount()); view = undefined; });

describe('acknowledged edit history', () => {
  it('serializes rapid edits and sends undo/redo with the newest server version', async () => {
    const response = deferred<{ doc: VideoDoc }>(); mocks.patch.mockReturnValueOnce(response.promise); mount();
    let first!: Promise<boolean>;
    act(() => { first = edits.applyOps(rename('First')); });
    expect(edits.busy).toBe(true); expect(pending.current).toBe(1); expect(edits.canUndo).toBe(false);
    expect(await edits.applyOps(rename('Too soon'))).toBe(false);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    server = { ...server, version: 2, title: 'First' };
    await act(async () => { response.resolve({ doc: server }); expect(await first).toBe(true); });
    expect(displayed.title).toBe('First'); expect(edits.canUndo).toBe(true); expect(pending.current).toBe(0);
    await act(async () => edits.undo());
    expect(displayed).toMatchObject({ title: 'Original', version: 3 }); expect(edits.canRedo).toBe(true);
    await act(async () => edits.redo());
    expect(displayed).toMatchObject({ title: 'First', version: 4 });
    expect(mocks.patch.mock.calls.map(call => call[2])).toEqual([1, 2, 3]);
  });

  it('keeps failures out of history and clears the redo branch after a new edit', async () => {
    mount(); mocks.patch.mockRejectedValueOnce(new Error('offline'));
    await act(async () => { expect(await edits.applyOps(rename('Lost'))).toBe(false); });
    expect(edits.canUndo).toBe(false); expect(displayed.title).toBe('Original'); expect(pending.current).toBe(0);
    expect(mocks.status).toHaveBeenLastCalledWith('Error: offline');
    await act(async () => { await edits.applyOps(rename('First')); });
    await act(async () => edits.undo());
    await act(async () => { await edits.applyOps(rename('Branch')); });
    expect(edits.canRedo).toBe(false); expect(displayed.title).toBe('Branch');
  });

  it('reloads conflicts, invalidates history, and uses the refreshed version on the next edit', async () => {
    mount(); await act(async () => { await edits.applyOps(rename('Local')); });
    server = { ...server, version: 8, title: 'Agent edit' };
    mocks.patch.mockRejectedValueOnce(new VersionConflictError());
    await act(async () => { expect(await edits.applyOps(rename('Stale'))).toBe(false); });
    expect(displayed).toMatchObject({ version: 8, title: 'Agent edit' });
    expect(edits.canUndo).toBe(false); expect(edits.canRedo).toBe(false);
    expect(mocks.status).toHaveBeenLastCalledWith('panel.videoStudio.reloaded');
    await act(async () => { await edits.applyOps(rename('After reload')); });
    expect(mocks.patch.mock.lastCall?.[2]).toBe(8);
  });

  it('clears local history when an external version of the same document arrives', async () => {
    mount(); await act(async () => { await edits.applyOps(rename('Local')); });
    expect(edits.canUndo).toBe(true);
    server = { ...server, version: 9, title: 'External' }; update('A', server);
    expect(edits.canUndo).toBe(false); expect(edits.canRedo).toBe(false);
    const calls = mocks.patch.mock.calls.length;
    await act(async () => edits.undo());
    expect(mocks.patch).toHaveBeenCalledTimes(calls); expect(displayed.title).toBe('External');
  });

  it('ignores a late successful patch after switching project/document', async () => {
    const response = deferred<{ doc: VideoDoc }>(); mocks.patch.mockReturnValueOnce(response.promise); mount();
    let request!: Promise<boolean>; act(() => { request = edits.applyOps(rename('Old')); });
    update('B', createEmptyDoc('other', 'Other project', 100));
    await act(async () => { response.resolve({ doc: { ...server, title: 'Old', version: 2 } }); expect(await request).toBe(false); });
    expect(displayed.title).toBe('Other project'); expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(edits.canUndo).toBe(false); expect(pending.current).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('ignores conflict reload %s after switching away and back', async outcome => {
    const reload = deferred<{ doc: VideoDoc }>(); mocks.patch.mockRejectedValueOnce(new VersionConflictError());
    mocks.read.mockReturnValueOnce(reload.promise); mount();
    let request!: Promise<boolean>; await act(async () => { request = edits.applyOps(rename('Old')); });
    update('B', createEmptyDoc('other', 'Other', 100)); update('A', { ...server, title: 'Reopened' });
    await act(async () => {
      if (outcome === 'resolve') reload.resolve({ doc: { ...server, title: 'Stale reload', version: 8 } });
      else reload.reject(new Error('Old reload failed'));
      await request;
    });
    expect(displayed.title).toBe('Reopened'); expect(mocks.setDoc).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
    expect(pending.current).toBe(0);
  });

  it('does not publish an acknowledgement after unmounting', async () => {
    const response = deferred<{ doc: VideoDoc }>(); mocks.patch.mockReturnValueOnce(response.promise); mount();
    let request!: Promise<boolean>; act(() => { request = edits.applyOps(rename('Late')); });
    act(() => view?.unmount()); view = undefined;
    response.resolve({ doc: { ...server, title: 'Late', version: 2 } }); await request;
    expect(mocks.setDoc).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled(); expect(pending.current).toBe(0);
  });
});
