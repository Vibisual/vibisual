import { useEffect, useState } from 'react';
import { pathKey, type Vibi3DRun } from '@vibisual/shared';
import { onAppEvent } from '../../apps/appEvents.js';
import { CreationApiError } from '../Creation/creationApi.js';

/** Document-bound history uses the existing app event channel; stale responses cannot replace another document. */
export function useVibi3DWorkflow(projectId: string, documentId: string, revision: number): {
  run: Vibi3DRun | null; error: unknown; refresh: () => void;
} {
  const [state, setState] = useState<{ run: Vibi3DRun | null; error: unknown }>({ run: null, error: null });
  const [request, setRequest] = useState(0);
  useEffect(() => onAppEvent('vibi3d', event => {
    // Both paths are canonical server values. A phone must not apply its own OS case rules to the host path.
    if (event.kind === 'workflow-updated' && event.key === documentId && pathKey(event.project, 'linux') === pathKey(projectId, 'linux')) {
      setRequest(value => value + 1);
    }
  }), [projectId, documentId]);
  useEffect(() => {
    setState({ run: null, error: null });
  }, [projectId, documentId]);
  useEffect(() => {
    if (!projectId || !documentId) return;
    const controller = new AbortController();
    const url = `/api/app/vibi3d/documents/${encodeURIComponent(documentId)}/runs?projectId=${encodeURIComponent(projectId)}`;
    void fetch(url, { signal: controller.signal }).then(async response => {
      const body = await response.json() as { run?: Vibi3DRun | null; error?: string };
      if (!response.ok) throw new CreationApiError(body.error ?? 'request-failed', response.status);
      if (!controller.signal.aborted) setState({ run: body.run ?? null, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, error }));
    });
    return () => controller.abort();
  }, [projectId, documentId, revision, request]);
  return { ...state, refresh: () => setRequest(value => value + 1) };
}
