import { createElement, useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationDoc, CreationHead } from '@vibisual/shared';
import { useModelCanvasDocument, useModelCanvasVisible } from './useModelCanvasDocument.js';

const mocks = vi.hoisted(() => ({ read: vi.fn(), head: null as CreationHead | null }));
vi.mock('./modelSource.js', () => ({ readModelDocument: mocks.read }));
vi.mock('../Creation/useCreationHead.js', () => ({ CREATION_HEAD_POLL_MS: 2_000, useCreationHead: () => mocks.head }));
function doc(id: string, revision: number): CreationDoc {
  return { schemaVersion: 1, id, appId: 'vibi3d', revision, title: id, payload: {}, parameters: {}, lockedPaths: [], links: [], createdAt: 1, updatedAt: revision, label: '', author: 'agent' };
}
function head(revision: number, candidateStamp = 0): CreationHead {
  return { id: 'doc', appId: 'vibi3d', revision, updatedAt: revision, candidateStamp, pendingCandidates: candidateStamp };
}
let seen: ReturnType<typeof useModelCanvasDocument>;
function Probe({ workRef, enabled = true }: { workRef?: string; enabled?: boolean }): null {
  seen = useModelCanvasDocument('project', workRef, enabled);
  return null;
}
let view: ReactTestRenderer | undefined;
beforeEach(() => { vi.useFakeTimers(); mocks.read.mockReset(); mocks.head = null; });
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('committed source in a canvas face', () => {
  it('does not read a source for a legacy file; reads a ref-only source and only changed revisions', async () => {
    await act(async () => { view = create(createElement(Probe)); });
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.head = head(1); mocks.read.mockResolvedValue(doc('doc', 1));
    await act(async () => { view!.update(createElement(Probe, { workRef: 'doc' })); });
    expect(seen.document?.revision).toBe(1);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.head = head(1, 5);
    await act(async () => { view!.update(createElement(Probe, { workRef: 'doc' })); });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.head = head(2, 5); mocks.read.mockResolvedValue(doc('doc', 2));
    await act(async () => { view!.update(createElement(Probe, { workRef: 'doc' })); });
    expect(seen.document?.revision).toBe(2);
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it('drops an old source reply after switching to another document', async () => {
    let finish!: (value: CreationDoc) => void;
    mocks.read.mockReturnValueOnce(new Promise<CreationDoc>((resolve) => { finish = resolve; })).mockResolvedValue(doc('new', 4));
    await act(async () => { view = create(createElement(Probe, { workRef: 'old' })); });
    await act(async () => { view!.update(createElement(Probe, { workRef: 'new' })); });
    await act(async () => { finish(doc('old', 9)); });
    expect(seen.document?.id).toBe('new');
    expect(seen.document?.revision).toBe(4);
  });

  it('keeps the previous scene after a temporary error, retries, and stops reading when hidden', async () => {
    mocks.head = head(1); mocks.read.mockResolvedValue(doc('doc', 1));
    await act(async () => { view = create(createElement(Probe, { workRef: 'doc' })); });
    mocks.head = head(2); mocks.read.mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(doc('doc', 2));
    await act(async () => { view!.update(createElement(Probe, { workRef: 'doc' })); });
    expect(seen).toMatchObject({ failed: true, loading: false, document: { revision: 1 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(seen).toMatchObject({ failed: false, document: { revision: 2 } });
    await act(async () => { view!.update(createElement(Probe, { workRef: 'doc', enabled: false })); });
    mocks.head = head(3);
    const reads = mocks.read.mock.calls.length;
    await act(async () => { view!.update(createElement(Probe, { workRef: 'doc', enabled: false })); await vi.advanceTimersByTimeAsync(5_000); });
    expect(mocks.read).toHaveBeenCalledTimes(reads);
  });

  it('treats offscreen and hidden windows as invisible and disconnects the observer', async () => {
    let observerCallback!: (entries: { isIntersecting: boolean }[]) => void;
    let visibilityCallback!: () => void;
    const disconnect = vi.fn();
    const page = { visibilityState: 'visible', addEventListener: (_: string, callback: () => void): void => { visibilityCallback = callback; }, removeEventListener: vi.fn() };
    vi.stubGlobal('document', page);
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof observerCallback) { observerCallback = callback; }
      observe(): void { /* DOM is supplied by the host in production. */ }
      disconnect = disconnect;
    });
    let visible = false;
    function VisibleProbe(): null { visible = useModelCanvasVisible(useRef<HTMLDivElement>(null)); return null; }
    await act(async () => { view = create(createElement(VisibleProbe)); });
    expect(visible).toBe(false);
    act(() => observerCallback([{ isIntersecting: true }])); expect(visible).toBe(true);
    page.visibilityState = 'hidden'; act(visibilityCallback); expect(visible).toBe(false);
    act(() => view!.unmount()); view = undefined;
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
