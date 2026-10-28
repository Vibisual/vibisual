import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { creationStableJson, type CreationCandidateSummary, type CreationDocSummary, type CreationListFailure } from '@vibisual/shared';
import { creationErrorCode } from '../Creation/creationErrors.js';
import { useCreationHead } from '../Creation/useCreationHead.js';
import { IMAGE_LIMITS, imageLockedPaths, isImageDocument, newImageDocument, type ImageDocument } from '../Creation/imageSource.js';
import {
  acceptImageCandidate, cleanupImageCandidates, commitImageDoc, createImageDoc, discardImageCandidate, imageCandidateSummaries, listImageDocs,
  readImageCandidate, readImageDoc, rebaseImageCandidate, restoreImageDoc, retainedImageLinks, type ImageCandidate, type ImageSourceDoc,
} from './imageApi.js';
import { CreationApiError } from '../Creation/creationApi.js';

/** The draft and the stored source are compared as canonical JSON — once per change, not once per render. */
function sameImage(a: ImageDocument, b: ImageDocument): boolean {
  return a === b || creationStableJson(a) === creationStableJson(b);
}

/**
 * §5.13 (R-9)(R-10) — one Vibimage window's editable document. Polls only the head (revision + candidate stamp); the full source/list is read on a change.
 * Edits with the same `coalesce` key are one undo step until `endEdit`. A save that only moved inline pictures to the blob store adopts the stored payload (stays clean).
 */
export function useImageDocument(root: string, initialId: string) {
  const [doc, setDoc] = useState<ImageSourceDoc | null>(null);
  const [draft, setDraft] = useState<ImageDocument>(newImageDocument);
  const [title, setTitle] = useState('');
  const [docs, setDocs] = useState<CreationDocSummary[]>([]);
  const [failedDocs, setFailedDocs] = useState<CreationListFailure[]>([]);
  const [candidates, setCandidates] = useState<CreationCandidateSummary[]>([]);
  const [remote, setRemote] = useState<ImageSourceDoc | null>(null);
  const [past, setPast] = useState<ImageDocument[]>([]);
  const [future, setFuture] = useState<ImageDocument[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef({ doc, draft, title }); current.current = { doc, draft, title };
  const flight = useRef(false);
  const coalesce = useRef<string | null>(null);
  const createIntents = useRef<Record<string, { signature: string; requestId: string }>>({});
  const scope = useRef(root);
  if (scope.current !== root) { scope.current = root; flight.current = false; }
  const dirty = useMemo(() => !sameImage(doc?.payload ?? newImageDocument(), draft) || (doc?.title ?? '') !== title, [doc, draft, title]);
  const isDirty = (): boolean => {
    const value = current.current;
    return !sameImage(value.doc?.payload ?? newImageDocument(), value.draft) || (value.doc?.title ?? '') !== value.title;
  };

  const adopt = useCallback((next: ImageSourceDoc): void => {
    const switched = current.current.doc?.id !== next.id;
    setDoc(next); setDraft(next.payload); setTitle(next.title); setPast([]); setFuture([]); setRemote(null); setError('');
    if (switched) setCandidates([]);
    coalesce.current = null;
    current.current = { doc: next, draft: next.payload, title: next.title };
    setDocs((list) => [next, ...list.filter((item) => item.id !== next.id)]);
  }, []);
  const fail = useCallback((failure: unknown): void => {
    setError(creationErrorCode(failure));
    if (failure instanceof CreationApiError && failure.current && 'payload' in failure.current && isImageDocument(failure.current.payload)) {
      setRemote({ ...failure.current, payload: failure.current.payload });
    }
  }, []);
  const receive = useCallback((next: ImageSourceDoc): void => {
    const value = current.current;
    // External mutations never select a document. A delayed response belongs to its original tab/project.
    if (scope.current !== root || value.doc?.id !== next.id || next.revision <= value.doc.revision) return;
    if (isDirty()) setRemote(next); else adopt(next);
  }, [root, adopt]);
  const open = useCallback(async (id: string): Promise<void> => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setCandidates([]);
    try { const next = await readImageDoc(root, id); if (scope.current === root) adopt(next); }
    catch (failure) { if (scope.current === root) fail(failure); }
    finally { if (scope.current === root) { flight.current = false; setBusy(false); } }
  }, [root, adopt, fail]);
  const refreshDocs = useCallback(async (): Promise<void> => {
    if (!root) return;
    try {
      const listed = await listImageDocs(root);
      if (scope.current === root) { setDocs(listed.docs); setFailedDocs(listed.failed); }
    } catch (failure) { if (scope.current === root) fail(failure); }
  }, [root, fail]);
  useEffect(() => {
    setDoc(null); setDraft(newImageDocument()); setTitle(''); setCandidates([]); setRemote(null); setPast([]); setFuture([]);
    setDocs([]); setFailedDocs([]); setError(''); setBusy(false);
    coalesce.current = null;
    void refreshDocs();
    if (initialId) void open(initialId);
  }, [root, initialId, open, refreshDocs]);

  /** One user edit. Calls sharing `key` (typing in one field, one colour drag) fold into one undo step. */
  const change = useCallback((next: ImageDocument, key?: string): void => {
    if (!isImageDocument(next) || sameImage(next, current.current.draft)) return;
    const previous = current.current.draft;
    const folded = key !== undefined && coalesce.current === key;
    if (!folded) setPast((p) => [...p.slice(-(IMAGE_LIMITS.history - 1)), previous]);
    setFuture([]); setDraft(next);
    coalesce.current = key ?? null;
    current.current = { ...current.current, draft: next }; setError('');
  }, []);
  const endEdit = useCallback((): void => { coalesce.current = null; }, []);

  const save = useCallback(async (request?: string, selectedIds: string[] = []): Promise<ImageSourceDoc | null> => {
    if (flight.current || !root) return null;
    if (remote) { setError('revision-conflict'); return null; }
    const before = current.current;
    if (before.doc && request === undefined && !isDirty()) return before.doc;
    flight.current = true; setBusy(true); setError(''); coalesce.current = null;
    const parameters = { ...before.doc?.parameters, ...(request !== undefined ? {
      imageRequest: request, imageSelection: selectedIds, imageRequestRevision: (before.doc?.revision ?? 0) + 1,
    } : {}) };
    const extras = { lockedPaths: imageLockedPaths(before.draft), parameters };
    const signature = creationStableJson([root, before.title, before.draft, extras]);
    if (!before.doc && createIntents.current.save?.signature !== signature) createIntents.current.save = { signature, requestId: crypto.randomUUID() };
    try {
      const next = before.doc ? await commitImageDoc(root, before.doc, {
        title: before.title, payload: JSON.parse(JSON.stringify(before.draft)), links: retainedImageLinks(before.doc.links, before.draft),
        lockedPaths: imageLockedPaths(before.draft), parameters,
      }) : await createImageDoc(root, before.title, before.draft, { ...extras, requestId: createIntents.current.save!.requestId });
      if (scope.current !== root) return null;
      delete createIntents.current.save;
      // Nothing changed while saving: take the stored payload (pictures now referenced, not inline) as the draft.
      const untouched = current.current.draft === before.draft && current.current.title === before.title;
      setDoc(next);
      if (untouched) { setDraft(next.payload); current.current = { doc: next, draft: next.payload, title: next.title }; }
      else current.current = { ...current.current, doc: next };
      setDocs((list) => [next, ...list.filter((item) => item.id !== next.id)]);
      // A replayed create that someone already edited is a newer source, not ours to overwrite silently.
      const replayChanged = !before.doc && (next.title !== before.title || next.revision > 1);
      setRemote(replayChanged ? next : null);
      if (replayChanged) { setError('revision-conflict'); return null; }
      return next;
    } catch (failure) { if (scope.current === root) fail(failure); return null; }
    finally { if (scope.current === root) { flight.current = false; setBusy(false); } }
  }, [root, fail, remote]);

  const history = useCallback(async (redo: boolean): Promise<void> => {
    if (flight.current) return;
    coalesce.current = null;
    const stack = redo ? future : past;
    const next = stack[stack.length - 1];
    if (next) {
      const previous = current.current.draft;
      if (redo) { setFuture(stack.slice(0, -1)); setPast((p) => [...p, previous]); }
      else { setPast(stack.slice(0, -1)); setFuture((p) => [...p, previous]); }
      setDraft(next); current.current = { ...current.current, draft: next }; return;
    }
    if (!doc || busy || dirty) return;
    flight.current = true; setBusy(true);
    try { const next = await restoreImageDoc(root, doc, redo ? 'redo' : 'undo'); if (scope.current === root) receive(next); }
    catch (failure) { if (scope.current === root) fail(failure); }
    finally { if (scope.current === root) { flight.current = false; setBusy(false); } }
  }, [doc, root, busy, dirty, future, past, receive, fail]);

  // Only the head is polled; the source and the candidate list are read when it says something changed.
  const head = useCreationHead(root, doc?.id);
  const docId = doc?.id;
  useEffect(() => {
    if (!head || !docId || head.id !== docId || flight.current) return;
    const known = current.current.doc;
    if (known && head.revision > known.revision) void readImageDoc(root, docId).then(receive).catch(() => undefined);
  }, [head?.revision, docId, root, receive]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshCandidates = useCallback(async (): Promise<void> => {
    if (!docId) return;
    try {
      const list = await imageCandidateSummaries(root, docId);
      if (scope.current === root && current.current.doc?.id === docId) setCandidates(list);
    } catch { /* The next stamp change retries; explicit actions report errors. */ }
  }, [root, docId]);
  useEffect(() => { if (head && head.id === docId) void refreshCandidates(); }, [head?.candidateStamp, docId, refreshCandidates]); // eslint-disable-line react-hooks/exhaustive-deps

  const readCandidate = useCallback((candidateId: string): Promise<ImageCandidate> => {
    if (!docId) return Promise.reject(new Error('image-source-invalid'));
    return readImageCandidate(root, docId, candidateId);
  }, [root, docId]);
  /** Resolves true only when the candidate became the source (the review stays open on failure). */
  const accept = useCallback(async (candidate: Pick<CreationCandidateSummary, 'id' | 'baseRevision'>): Promise<boolean> => {
    if (!doc || dirty || busy || flight.current || candidate.baseRevision !== doc.revision) return false;
    flight.current = true; setBusy(true);
    try {
      const next = await acceptImageCandidate(root, doc, candidate.id);
      if (scope.current === root) { receive(next); setCandidates((list) => list.filter((c) => c.id !== candidate.id)); }
      return true;
    } catch (failure) { if (scope.current === root) fail(failure); return false; }
    finally { if (scope.current === root) { flight.current = false; setBusy(false); } }
  }, [doc, dirty, busy, root, receive, fail]);
  const withSource = useCallback(async (action: (id: string) => Promise<unknown>): Promise<boolean> => {
    if (!docId) return false;
    try { await action(docId); await refreshCandidates(); return true; } catch (failure) { fail(failure); return false; }
  }, [docId, refreshCandidates, fail]);
  const discard = useCallback((candidateId: string) => withSource((id) => discardImageCandidate(root, id, candidateId)), [root, withSource]);
  const cleanup = useCallback((scopeName: 'stale' | 'all') => withSource((id) => cleanupImageCandidates(root, id, scopeName)), [root, withSource]);
  /** Moves a stale candidate onto the current revision; the new candidate's id is returned. */
  const rebase = useCallback(async (candidateId: string): Promise<string | null> => {
    if (!doc) return null;
    try { const moved = await rebaseImageCandidate(root, doc, candidateId); await refreshCandidates(); return moved.id; }
    catch (failure) { fail(failure); return null; }
  }, [doc, root, refreshCandidates, fail]);

  const copy = useCallback(async (): Promise<void> => {
    if (flight.current) return;
    flight.current = true; setBusy(true);
    const before = current.current;
    const extras = {
      links: retainedImageLinks(before.doc?.links ?? [], before.draft), lockedPaths: imageLockedPaths(before.draft), parameters: before.doc?.parameters ?? {},
    };
    const signature = creationStableJson([root, before.title, before.draft, extras]);
    if (createIntents.current.copy?.signature !== signature) createIntents.current.copy = { signature, requestId: crypto.randomUUID() };
    try {
      const next = await createImageDoc(root, before.title, before.draft, { ...extras, requestId: createIntents.current.copy!.requestId });
      if (scope.current === root) { delete createIntents.current.copy; adopt(next); }
    } catch (failure) { if (scope.current === root) fail(failure); }
    finally { if (scope.current === root) { flight.current = false; setBusy(false); } }
  }, [root, adopt, fail]);

  return {
    doc, draft, title, setTitle, docs, failedDocs, candidates, remote, busy, error, dirty, change, endEdit, open, save, accept, discard, cleanup,
    rebase, readCandidate, copy, adopt, receive, refreshDocs, setError,
    useRemote: () => { if (remote) adopt(remote); },
    fresh: () => {
      createIntents.current = {}; coalesce.current = null;
      setDoc(null); setDraft(newImageDocument()); setTitle(''); setPast([]); setFuture([]); setCandidates([]); setRemote(null);
    },
    undo: () => history(false), redo: () => history(true),
    canUndo: past.length > 0 || (!dirty && !!doc?.canUndo), canRedo: future.length > 0 || (!dirty && !!doc?.canRedo),
  };
}
