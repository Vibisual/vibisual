import { useEffect, useState, type RefObject } from 'react';
import type { CreationDoc } from '@vibisual/shared';
import { CREATION_HEAD_POLL_MS, useCreationHead } from '../Creation/useCreationHead.js';
import { readModelDocument } from './modelSource.js';

/** A mounted canvas node can still be outside the viewport or in a hidden window. */
export function useModelCanvasVisible(host: RefObject<HTMLDivElement>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let intersects = typeof IntersectionObserver === 'undefined';
    const update = (): void => setVisible(intersects && (typeof document === 'undefined' || document.visibilityState !== 'hidden'));
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      intersects = entries.some((entry) => entry.isIntersecting);
      update();
    });
    if (host.current) observer?.observe(host.current);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', update);
    update();
    return () => {
      observer?.disconnect();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', update);
    };
  }, [host]);
  return visible;
}

interface DocumentState {
  key: string;
  document: CreationDoc | null;
  loading: boolean;
  failed: boolean;
}

/** Read committed sources only: a pending candidate changes the head stamp, never this scene. */
export function useModelCanvasDocument(projectId: string, workRef: string | undefined, enabled: boolean): Omit<DocumentState, 'key'> {
  const head = useCreationHead(projectId, workRef, { enabled });
  const key = JSON.stringify([projectId, workRef]);
  const revision = head?.revision;
  const [state, setState] = useState<DocumentState>({ key: '', document: null, loading: false, failed: false });
  useEffect(() => {
    if (!workRef || !enabled) return undefined;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      setState((previous) => ({ key, document: previous.key === key ? previous.document : null, loading: true, failed: false }));
      try {
        const document = await readModelDocument(projectId, workRef);
        if (!stopped) setState((previous) => ({
          key, document: previous.key === key && previous.document?.revision === document.revision ? previous.document : document,
          loading: false, failed: false,
        }));
      } catch {
        if (!stopped) {
          setState((previous) => ({ ...previous, loading: false, failed: true }));
          // A transient read failure must recover even when the small head has not changed again.
          retry = setTimeout(() => { void read(); }, CREATION_HEAD_POLL_MS);
        }
      }
    };
    void read();
    return () => { stopped = true; clearTimeout(retry); };
  }, [projectId, workRef, key, revision, enabled]);
  return state.key === key ? state : { document: null, loading: enabled && !!workRef, failed: false };
}
