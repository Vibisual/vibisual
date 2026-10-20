import {
  VIBI3D_API_PREFIX,
  type Vibi3DDraft,
  type Vibi3DDraftSummary,
  type Vibi3DDraftReadResult,
  type Vibi3DDraftWriteResult,
  type Vibi3DDraftSaveInput,
  type Vibi3DDraftDiscardInput,
} from '@vibisual/shared';
import { externalizeForSave, forgetKnownBlobs } from '../Creation/creationBlobs.js';

export interface ModelDraftScope { projectId: string; key: string; actor: 'human' | 'agent' }
export type ModelDraftInput = Omit<Vibi3DDraftSaveInput, 'projectId' | 'key' | 'actor' | 'expectedVersion' | 'requestId'>;

export class ModelDraftApiError extends Error {
  constructor(readonly code: string, readonly status = 0, readonly detail?: Record<string, unknown>) { super(code); }
}

const endpoint = `${VIBI3D_API_PREFIX}/drafts`;
const query = ({ projectId, key, actor }: ModelDraftScope): string => new URLSearchParams({ projectId, key, actor }).toString();

async function call<T>(url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, body === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch { throw new ModelDraftApiError('request-failed'); }
  const result = await response.json().catch(() => null) as (T & { error?: string; detail?: Record<string, unknown> }) | null;
  if (!response.ok || !result) throw new ModelDraftApiError(result?.error ?? 'request-failed', response.status, result?.detail);
  return result;
}

export function listModelDrafts(projectId: string): Promise<{ drafts: Vibi3DDraftSummary[]; failed: string[] }> {
  return call(`${endpoint}?${new URLSearchParams({ projectId })}`);
}
export function readModelDraft(scope: ModelDraftScope): Promise<Vibi3DDraftReadResult> {
  return call(`${endpoint}/current?${query(scope)}`);
}
export async function readModelDraftHistory(scope: ModelDraftScope): Promise<Vibi3DDraftSummary[]> {
  return (await call<{ revisions: Vibi3DDraftSummary[] }>(`${endpoint}/history?${query(scope)}`)).revisions;
}
export async function readModelDraftVersion(scope: ModelDraftScope, version: number): Promise<Vibi3DDraft> {
  return (await call<{ draft: Vibi3DDraft }>(`${endpoint}/revisions/${version}?${query(scope)}`)).draft;
}
export async function saveModelDraft(projectId: string, input: Vibi3DDraftSaveInput): Promise<Vibi3DDraftWriteResult> {
  const send = async (): Promise<Vibi3DDraftWriteResult> => call(`${endpoint}/save`, {
    ...input, projectId, payload: await externalizeForSave(projectId, input.payload),
  });
  try { return await send(); } catch (error) {
    if (!(error instanceof ModelDraftApiError) || error.code !== 'blob-not-found') throw error;
    forgetKnownBlobs(projectId);
    return send();
  }
}
export function discardModelDraft(projectId: string, input: Omit<Vibi3DDraftDiscardInput, 'projectId'>): Promise<Vibi3DDraftWriteResult> {
  return call(`${endpoint}/discard`, { ...input, projectId });
}
