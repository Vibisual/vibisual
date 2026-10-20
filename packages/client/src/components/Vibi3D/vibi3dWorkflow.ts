import { VIBI3D_API_PREFIX, pathKey, type Vibi3DSnapshot, type Vibi3DRun } from '@vibisual/shared';
import { AppAgentPreparationError } from '../../apps/registry.js';
import { openAppWindow } from '../../apps/appWindows.js';
import { onAppEvent } from '../../apps/appEvents.js';

const SESSION_READY_MS = 30_000;
const SESSION_POLL_MS = 250;
const REQUEST_TIMEOUT_MS = 8_000;
let ownerId: string | undefined;
const documents = new Map<string, { projectId: string; documentId: string }>();
const recoveries = new Map<string, Promise<boolean>>();
// Inputs are canonical server paths; preserve case even when the initiating phone uses another OS.
const key = (projectId: string, documentId: string): string => JSON.stringify([pathKey(projectId, 'linux'), documentId]);
const documentUrl = (documentId: string): string => `${VIBI3D_API_PREFIX}/documents/${encodeURIComponent(documentId)}`;

export async function workflowRequest<T>(url: string, body?: object, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  // The readiness loop's deadline cannot run while an unbounded HTTP request is still awaiting a response.
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(url, { signal: controller.signal,
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new AppAgentPreparationError(result.error ?? 'vibi3d-workflow-unavailable');
    return result;
  } catch (error) {
    if (error instanceof AppAgentPreparationError) throw error;
    throw new AppAgentPreparationError('vibi3d-workflow-unavailable');
  } finally { clearTimeout(timeout); }
}

/** One browser surface owns its document renderers; recovery never raises a window. */
export function vibi3DOwnerId(): string {
  if (ownerId) return ownerId;
  ownerId = crypto.randomUUID();
  onAppEvent('vibi3d', (event) => {
    if (event.kind !== 'reopen') return;
    for (const target of documents.values()) {
      if (target.documentId !== event.key || pathKey(event.project, 'linux') !== pathKey(target.projectId, 'linux')) continue;
      void recoverVibi3DDocument(target.projectId, target.documentId)
        .catch(() => undefined); // The waiting agent receives the server's explicit unavailable state.
    }
  });
  return ownerId;
}

export function rememberVibi3DDocument(projectId: string, documentId: string): string {
  const owner = vibi3DOwnerId();
  documents.set(key(projectId, documentId), { projectId, documentId });
  return owner;
}

interface DocumentSession { session?: { snapshot: Vibi3DSnapshot; online?: boolean } | null; run?: Vibi3DRun | null }
export async function readVibi3DDocumentSession(projectId: string, documentId: string, timeoutMs?: number): Promise<DocumentSession> {
  return workflowRequest<DocumentSession>(`${documentUrl(documentId)}/session?projectId=${encodeURIComponent(projectId)}`, undefined, timeoutMs);
}

/** A stale outside-window list may suppress one open. Only a live bound session proves recovery succeeded. */
export function recoverVibi3DDocument(projectId: string, documentId: string): Promise<boolean> {
  const targetKey = key(projectId, documentId), previous = recoveries.get(targetKey);
  if (previous) return previous;
  if (!documents.has(targetKey)) return Promise.resolve(false);
  const owner = vibi3DOwnerId(), deadline = Date.now() + SESSION_READY_MS;
  const recover = async (): Promise<boolean> => {
    while (Date.now() < deadline) {
      const claim = await workflowRequest<{ ownerId: string }>(`${documentUrl(documentId)}/claim`, { projectId, ownerId: owner },
        Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
      if (claim.ownerId !== owner) return false;
      if (Date.now() >= deadline) break;
      if (!openAppWindow({ appId: 'vibi3d', projectId, ref: documentId }, { background: true })) throw new AppAgentPreparationError('vibi3d-window-unavailable');
      const state = await readVibi3DDocumentSession(projectId, documentId, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
      if (state.session?.online !== false && state.session?.snapshot.document?.id === documentId) return true;
      await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, Math.min(SESSION_POLL_MS, deadline - Date.now()))));
    }
    throw new AppAgentPreparationError('vibi3d-session-not-ready');
  };
  const pending = recover().finally(() => { recoveries.delete(targetKey); });
  recoveries.set(targetKey, pending); return pending;
}

/** Prepare once before sending the real agent command; failures preserve the user's unsent prompt. */
export async function prepareVibi3DRun(projectId: string, documentId: string): Promise<{ snapshot: Vibi3DSnapshot; run: Vibi3DRun | null; previousRun: Vibi3DRun | null }> {
  const deadline = Date.now() + SESSION_READY_MS;
  const owner = rememberVibi3DDocument(projectId, documentId);
  const ensured = await workflowRequest<{ ownerId: string; sessionId?: string }>(`${documentUrl(documentId)}/ensure`, { projectId, ownerId: owner });
  if (!ensured.sessionId && ensured.ownerId === owner) {
    if (!openAppWindow({ appId: 'vibi3d', projectId, ref: documentId }, { background: true })) throw new AppAgentPreparationError('vibi3d-window-unavailable');
  }
  let snapshot: Vibi3DSnapshot | undefined;
  let previousRun: Vibi3DRun | null = null;
  while (Date.now() < deadline) {
    const state = await readVibi3DDocumentSession(projectId, documentId, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
    if (state.session?.online !== false && state.session?.snapshot.document?.id === documentId) {
      snapshot = state.session.snapshot; previousRun = state.run ?? null; break;
    }
    // Preparation can race the same closing outside window as recovery. An accepted open is not readiness.
    if (ensured.ownerId === owner && Date.now() < deadline) {
      const claim = await workflowRequest<{ ownerId: string }>(`${documentUrl(documentId)}/claim`, { projectId, ownerId: owner },
        Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()));
      if (claim.ownerId === owner && Date.now() < deadline) openAppWindow({ appId: 'vibi3d', projectId, ref: documentId }, { background: true });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, Math.min(SESSION_POLL_MS, deadline - Date.now()))));
  }
  if (!snapshot) throw new AppAgentPreparationError('vibi3d-session-not-ready');
  // Restored work may be newer than the latest named checkpoint. Keep its live session,
  // revision, and run binding; neither document preparation nor a generic "continue"
  // request may replace that branch with a source or an older saved stage.
  if (snapshot.document?.dirty && snapshot.document.humanDirty === false) {
    return { snapshot, run: previousRun?.id === snapshot.runId ? previousRun : null, previousRun };
  }
  const { run } = await workflowRequest<{ run: Vibi3DRun }>(`${documentUrl(documentId)}/runs`, { projectId, runId: crypto.randomUUID() });
  return { snapshot: { ...snapshot, runId: run.id }, run, previousRun };
}

export function vibi3DResumePrompt(run: Vibi3DRun | null): string {
  return run ? `Previous named document run (history, not the current work draft): ${JSON.stringify(run)}\nContinue from the current live or restored autosaved work draft by default. A generic request to continue is not permission to replace that draft with an older checkpoint. Only when the user explicitly selects a named saved stage, send resume {runId,stage?} for that stage before editing. Preserve the newer draft until the explicit restore is confirmed; never restore another document or claim discarded work was recovered.` : '';
}
