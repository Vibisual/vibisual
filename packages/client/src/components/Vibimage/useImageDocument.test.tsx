import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationCandidateSummary, CreationHead } from '@vibisual/shared';
import { useImageDocument } from './useImageDocument.js';
import { newImageDocument, newImageLayer, patchImageLayer } from './imageDocument.js';
import type { ImageSourceDoc } from './imageApi.js';
import { CreationApiError } from '../Creation/creationApi.js';

const api = vi.hoisted(() => ({
  read: vi.fn(), list: vi.fn(), commit: vi.fn(), summaries: vi.fn(), create: vi.fn(), head: vi.fn(),
  accept: vi.fn(), discard: vi.fn(), cleanup: vi.fn(), rebase: vi.fn(), restore: vi.fn(),
}));
vi.mock('./imageApi.js', async (original) => ({
  ...await original<object>(), readImageDoc: api.read, listImageDocs: api.list, commitImageDoc: api.commit, imageCandidateSummaries: api.summaries,
  createImageDoc: api.create, acceptImageCandidate: api.accept, discardImageCandidate: api.discard, cleanupImageCandidates: api.cleanup,
  rebaseImageCandidate: api.rebase, restoreImageDoc: api.restore,
}));
vi.mock('../Creation/creationApi.js', async (original) => ({ ...await original<object>(), readCreationHead: api.head }));
let state: ReturnType<typeof useImageDocument>; let renderer: ReactTestRenderer | undefined; let source: ImageSourceDoc;
function Harness() { state = useImageDocument('/project', 'source'); return null; }
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
const head = (revision: number, candidateStamp = 0): CreationHead => ({ id: 'source', appId: 'vibimage', revision, updatedAt: revision, candidateStamp, pendingCandidates: 0 });
const summary = (id: string, baseRevision = 2): CreationCandidateSummary => ({ id, baseRevision, label: id, input: '', createdAt: 3, status: 'pending' });
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks();
  const payload = newImageDocument(); payload.layers = [{ ...newImageLayer(payload, 'text', 'Title'), id: 'title' }];
  source = { schemaVersion: 1, id: 'source', appId: 'vibimage', title: 'Poster', revision: 2, payload, parameters: { imageRequest: 'Keep this request' }, lockedPaths: [],
    links: [{ id: 'link', sourceId: 'model', sourceRevision: 1, role: 'image-layer', targets: ['title'] }], createdAt: 1, updatedAt: 2, label: '', author: 'user' };
  api.read.mockResolvedValue(source); api.list.mockResolvedValue({ docs: [source], failed: [] }); api.summaries.mockResolvedValue([]);
  api.head.mockResolvedValue(head(2));
  await act(async () => { renderer = create(<Harness />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); });
describe('image revisions, local transactions and recovery', () => {
  it('restores saved source connections and does not regenerate an unchanged save', async () => {
    expect(state.doc?.links).toEqual(source.links);
    let saved: ImageSourceDoc | null = null;
    await act(async () => { saved = await state.save(); });
    expect(saved).toEqual(source); expect(api.commit).not.toHaveBeenCalled();
  });
  it('undoes and redoes complete edits without losing the previous snapshot', async () => {
    const changed = patchImageLayer(source.payload, 'title', { text: 'Human edit', x: 250 });
    act(() => state.change(changed));
    await act(async () => { await state.undo(); }); expect(state.draft).toEqual(source.payload);
    await act(async () => { await state.redo(); }); expect(state.draft).toEqual(changed);
  });
  it('(9) typing in one field or dragging one colour is a single undo step until the edit ends', async () => {
    act(() => state.change(patchImageLayer(source.payload, 'title', { text: 'H' }), 'title:text'));
    act(() => state.change(patchImageLayer(state.draft, 'title', { text: 'He' }), 'title:text'));
    act(() => state.change(patchImageLayer(state.draft, 'title', { text: 'Hey' }), 'title:text'));
    act(() => state.endEdit());
    act(() => state.change(patchImageLayer(state.draft, 'title', { fill: '#111111' }), 'title:fill'));
    act(() => state.change(patchImageLayer(state.draft, 'title', { fill: '#222222' }), 'title:fill'));
    await act(async () => { await state.undo(); });
    expect(state.draft.layers[0]).toMatchObject({ text: 'Hey', fill: source.payload.layers[0]!.fill });
    await act(async () => { await state.undo(); });
    expect(state.draft).toEqual(source.payload);
  });
  it('keeps a human edit that arrives during an in-flight save and retains its newer dirty state', async () => {
    const pending = deferred<ImageSourceDoc>(); api.commit.mockReturnValue(pending.promise);
    const first = patchImageLayer(source.payload, 'title', { text: 'First' }); act(() => state.change(first));
    let request!: Promise<ImageSourceDoc | null>; act(() => { request = state.save(); });
    const latest = patchImageLayer(first, 'title', { text: 'Latest human' }); act(() => state.change(latest));
    await act(async () => { pending.resolve({ ...source, revision: 3, payload: first }); await request; });
    expect(state.doc?.revision).toBe(3); expect(state.draft).toEqual(latest); expect(state.dirty).toBe(true);
  });
  it('preserves the request and draft when a save conflicts with a newer revision', async () => {
    const human = patchImageLayer(source.payload, 'title', { text: 'Human' }); act(() => state.change(human));
    api.commit.mockRejectedValue(new CreationApiError('revision-conflict', 409, { ...source, revision: 3 }));
    await act(async () => { await state.save('Keep this request', ['title']); });
    expect(state.draft).toEqual(human); expect(state.error).toBe('revision-conflict');
    expect(state.remote?.revision).toBe(3);
  });
  it('(10) polls only the head: the full source is read again only when its revision moved', async () => {
    expect(api.read).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(api.head.mock.calls.length).toBeGreaterThan(1);
    expect(api.read).toHaveBeenCalledTimes(1);
    api.head.mockResolvedValue(head(3)); api.read.mockResolvedValue({ ...source, revision: 3 });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(state.doc?.revision).toBe(3);
  });
  it('(10) reads the candidate list only when the candidate stamp moved', async () => {
    const before = api.summaries.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(api.summaries.mock.calls.length).toBe(before);
    api.summaries.mockResolvedValue([summary('c1')]); api.head.mockResolvedValue(head(2, 1));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(api.summaries.mock.calls.length).toBe(before + 1);
    expect(state.candidates.map((item) => item.id)).toEqual(['c1']);
  });
  it('(12) discards, cleans up and rebases proposals, then reads the list again', async () => {
    api.discard.mockResolvedValue({}); api.cleanup.mockResolvedValue(2); api.rebase.mockResolvedValue({ ...summary('moved'), rebasedFrom: 'old' });
    await act(async () => { expect(await state.discard('c1')).toBe(true); });
    expect(api.discard).toHaveBeenCalledWith('/project', 'source', 'c1');
    await act(async () => { expect(await state.cleanup('stale')).toBe(true); });
    expect(api.cleanup).toHaveBeenCalledWith('/project', 'source', 'stale');
    await act(async () => { expect(await state.rebase('old')).toBe('moved'); });
    expect(api.summaries.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it('a failed accept keeps the review open (false) and shows the reason', async () => {
    api.accept.mockRejectedValue(new CreationApiError('candidate-conflict', 409));
    let accepted = true;
    await act(async () => { accepted = await state.accept(summary('c1')); });
    expect(accepted).toBe(false); expect(state.error).toBe('candidate-conflict');
  });
  it('does not regress to an older response after a successful save', async () => {
    act(() => state.change(patchImageLayer(source.payload, 'title', { text: 'New' })));
    api.commit.mockResolvedValue({ ...source, revision: 3, payload: state.draft });
    await act(async () => { await state.save(); });
    act(() => state.receive(source));
    expect(state.doc?.revision).toBe(3); expect(state.draft.layers[0]?.text).toBe('New');
  });
  it('ignores a delayed linked-source update after opening a different image, and drops the old candidates at once', async () => {
    const receiveA = state.receive;
    api.summaries.mockResolvedValue([summary('c1')]); api.head.mockResolvedValue(head(2, 1));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(state.candidates).toHaveLength(1);
    const other = { ...source, id: 'other', revision: 1, title: 'Other image' };
    api.read.mockResolvedValue(other);
    await act(async () => { await state.open('other'); });
    expect(state.candidates).toEqual([]);
    const human = patchImageLayer(other.payload, 'title', { text: 'Other human edit' });
    act(() => state.change(human));
    act(() => receiveA({ ...source, revision: 3 }));
    expect(state.doc?.id).toBe('other'); expect(state.draft).toEqual(human); expect(state.canUndo).toBe(true);
  });
  it('reuses the initial create request after a lost response, but assigns a new identity after edits', async () => {
    act(() => state.fresh()); api.create.mockRejectedValue(new CreationApiError('request-failed', 0));
    await act(async () => { await state.save(); });
    await act(async () => { await state.save(); });
    expect(api.create.mock.calls[0]![3].requestId).toBe(api.create.mock.calls[1]![3].requestId);
    act(() => state.change({ ...state.draft, background: '#334455' }));
    await act(async () => { await state.save(); });
    expect(api.create.mock.calls[2]![3].requestId).not.toBe(api.create.mock.calls[1]![3].requestId);
  });
});
