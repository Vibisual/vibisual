import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoDoc, VideoDocOp } from '@vibisual/video';
import { patchDoc, readDoc, VersionConflictError } from './videoApi.js';
import { buildRestoreOps } from './videoEditor.js';
import { withCaptionTimingOps } from './videoTimelineEdit.js';

const HISTORY_LIMIT = 80;

/** Only server-acknowledged edits enter history; a conflict never overwrites an agent's work. */
export function useVideoEdits(project: string, doc: VideoDoc | null, setDoc: (doc: VideoDoc) => void,
  setStatus: (message: string) => void, pending: MutableRefObject<number>) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const state = useRef({ past: [] as VideoDoc[], future: [] as VideoDoc[], busy: false, generation: 0 });
  const mounted = useRef(true);
  const current = useRef({ project, doc });
  const input = useRef({ project, doc });
  const accepted = useRef({ project, id: doc?.id, version: doc?.version });
  // Internal state rerenders must not replace the latest server acknowledgement with stale props.
  if (input.current.project !== project || input.current.doc !== doc) {
    input.current = { project, doc }; current.current = { project, doc };
  }
  const reset = useCallback((): void => {
    state.current.past = []; state.current.future = []; state.current.generation += 1;
    setCounts({ undo: 0, redo: 0 });
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; state.current.generation += 1; };
  }, []);
  useEffect(() => {
    if (accepted.current.project !== project || accepted.current.id !== doc?.id || accepted.current.version !== doc?.version) reset();
    accepted.current = { project, id: doc?.id, version: doc?.version };
  }, [project, doc?.id, doc?.version, reset]);

  const commit = useCallback(async (ops: readonly VideoDocOp[], action: 'edit' | 'undo' | 'redo' = 'edit'): Promise<boolean> => {
    const before = current.current.doc;
    const scope = current.current.project;
    const history = state.current;
    if (!before || !ops.length || history.busy) return false;
    const generation = history.generation;
    const isCurrent = (expectedGeneration: number): boolean => mounted.current && current.current.project === scope &&
      current.current.doc?.id === before.id && current.current.doc.version === before.version && history.generation === expectedGeneration;
    history.busy = true; setBusy(true); pending.current += 1;
    try {
      const result = await patchDoc(scope, before.id, before.version,
        action === 'edit' ? withCaptionTimingOps(before, ops) : ops);
      if (!isCurrent(generation)) return false;
      if (action === 'undo') { history.past.pop(); history.future.push(before); }
      else if (action === 'redo') { history.future.pop(); history.past.push(before); }
      else { history.past.push(before); history.future = []; }
      if (history.past.length > HISTORY_LIMIT) history.past.shift();
      current.current.doc = result.doc;
      accepted.current = { project: scope, id: result.doc.id, version: result.doc.version };
      setDoc(result.doc);
      setCounts({ undo: history.past.length, redo: history.future.length });
      setStatus('');
      return true;
    } catch (error) {
      if (!isCurrent(generation)) return false;
      if (error instanceof VersionConflictError) {
        reset();
        const recoveryGeneration = history.generation;
        try {
          const fresh = await readDoc(scope, before.id);
          if (!isCurrent(recoveryGeneration)) return false;
          current.current.doc = fresh.doc;
          accepted.current = { project: scope, id: fresh.doc.id, version: fresh.doc.version };
          setDoc(fresh.doc);
        } catch (reloadError) { if (isCurrent(recoveryGeneration)) setStatus(String(reloadError)); return false; }
        setStatus(t('panel.videoStudio.reloaded'));
      } else setStatus(String(error));
      return false;
    } finally { history.busy = false; if (mounted.current) setBusy(false); pending.current -= 1; }
  }, [pending, reset, setDoc, setStatus, t]);

  const undo = useCallback(async (): Promise<void> => {
    const target = state.current.past.at(-1);
    if (target && current.current.doc) await commit(buildRestoreOps(current.current.doc, target), 'undo');
  }, [commit]);
  const redo = useCallback(async (): Promise<void> => {
    const target = state.current.future.at(-1);
    if (target && current.current.doc) await commit(buildRestoreOps(current.current.doc, target), 'redo');
  }, [commit]);
  return { applyOps: commit, undo, redo, reset, busy, canUndo: counts.undo > 0, canRedo: counts.redo > 0 };
}
