import {
  CREATION_API_PREFIX,
  creationStableJson,
  type CreationCandidate,
  type CreationCandidateSummary,
  type CreationDoc,
  type CreationDocSummary,
  type CreationHead,
  type CreationImpact,
  type CreationListFailure,
  type CreationOutput,
  type CreationValue,
} from '@vibisual/shared';
import { externalizeForSave, forgetKnownBlobs } from './creationBlobs.js';

/** §5.13 (R-10) — the one client for `/api/app/creation`; screens never assemble these URLs, so a contract change lands in one file. */
export const CREATION_DOCS = `${CREATION_API_PREFIX}/docs`;

export class CreationApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly current?: CreationDoc | CreationDocSummary,
    readonly detail?: Record<string, unknown>,
  ) { super(code); }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, init); } catch { throw new CreationApiError('request-failed', 0); }
  const data = await response.json().catch(() => ({})) as T & { error?: string; doc?: CreationDoc; detail?: Record<string, unknown> };
  if (!response.ok) throw new CreationApiError(data.error ?? 'request-failed', response.status, data.doc, data.detail);
  return data;
}
const query = (projectId: string): string => `?projectId=${encodeURIComponent(projectId)}`;
const docUrl = (id: string, suffix = ''): string => `${CREATION_DOCS}/${encodeURIComponent(id)}${suffix}`;
function post<T>(url: string, projectId: string, body: object = {}): Promise<T> {
  return call<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, projectId }) });
}

/** Derived from the request's meaning, so a retry after a lost response replays on the server instead of failing as a conflict. */
export function creationIntentId(...parts: unknown[]): string {
  const text = creationStableJson(parts);
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return `i${a.toString(36)}${b.toString(36)}${text.length.toString(36)}`;
}

export function listCreationDocs(projectId: string): Promise<{ docs: CreationDocSummary[]; failed: CreationListFailure[] }> {
  return call<{ docs: CreationDocSummary[]; failed?: CreationListFailure[] }>(`${CREATION_DOCS}${query(projectId)}`)
    .then((data) => ({ docs: data.docs, failed: data.failed ?? [] }));
}
export async function readCreationDoc(projectId: string, id: string): Promise<CreationDoc> {
  return (await call<{ doc: CreationDoc }>(`${docUrl(id)}${query(projectId)}`)).doc;
}
export async function readCreationHead(projectId: string, id: string): Promise<CreationHead> {
  return (await call<{ head: CreationHead }>(`${docUrl(id, '/head')}${query(projectId)}`)).head;
}
export async function readCreationRevision(projectId: string, id: string, revision: number): Promise<CreationDoc> {
  return (await call<{ doc: CreationDoc }>(`${docUrl(id, `/revisions/${revision}`)}${query(projectId)}`)).doc;
}
export async function readCreationHistory(projectId: string, id: string): Promise<CreationDocSummary[]> {
  return (await call<{ revisions: CreationDocSummary[] }>(`${docUrl(id, '/history')}${query(projectId)}`)).revisions;
}
export async function readCreationImpacts(projectId: string, id: string): Promise<CreationImpact[]> {
  return (await call<{ impacts: CreationImpact[] }>(`${docUrl(id, '/impact')}${query(projectId)}`)).impacts;
}
export async function readCreationOutputs(projectId: string, id: string): Promise<CreationOutput[]> {
  return (await call<{ outputs: CreationOutput[] }>(`${docUrl(id, '/outputs')}${query(projectId)}`)).outputs;
}
export async function readCreationMirror(projectId: string, appId: string, key: string): Promise<CreationDoc | null> {
  const url = `${CREATION_API_PREFIX}/mirror${query(projectId)}&appId=${encodeURIComponent(appId)}&key=${encodeURIComponent(key)}`;
  return (await call<{ doc: CreationDoc | null }>(url)).doc;
}

/** Externalizes inline binaries; a blob the cache believed present but the cleanup removed is uploaded again once. */
async function withPayload<T>(projectId: string, payload: CreationValue | undefined, send: (payload: CreationValue | undefined) => Promise<T>): Promise<T> {
  if (payload === undefined) return send(undefined);
  try { return await send(await externalizeForSave(projectId, payload)); } catch (error) {
    if (!(error instanceof CreationApiError) || error.code !== 'blob-not-found') throw error;
    forgetKnownBlobs(projectId);
    return send(await externalizeForSave(projectId, payload));
  }
}

export interface CreationCreateInput {
  appId: string;
  title: string;
  payload: CreationValue;
  requestId?: string;
  parameters?: Record<string, CreationValue>;
  lockedPaths?: string[];
  links?: CreationDoc['links'];
  label?: string;
}
/**
 * A create keeps its request id only while it is unanswered: a retry after a lost reply replays the same create, but
 * once it succeeded, an identical new document (two blank models) is a second document — not the first one again.
 */
const pendingCreates = new Map<string, string>();
export async function createCreationDoc(projectId: string, input: CreationCreateInput): Promise<CreationDoc> {
  const fingerprint = creationIntentId('create', projectId, input.appId, input.title, input.payload, input.parameters ?? {}, input.links ?? [], input.lockedPaths ?? []);
  const requestId = input.requestId ?? pendingCreates.get(fingerprint) ?? crypto.randomUUID();
  pendingCreates.set(fingerprint, requestId);
  if (pendingCreates.size > 64) pendingCreates.delete(pendingCreates.keys().next().value as string);
  const doc = await withPayload(projectId, input.payload, async (payload) =>
    (await post<{ doc: CreationDoc }>(CREATION_DOCS, projectId, { ...input, payload, requestId })).doc);
  pendingCreates.delete(fingerprint);
  return doc;
}

export interface CreationCommitInput {
  payload?: CreationValue;
  title?: string;
  parameters?: Record<string, CreationValue>;
  lockedPaths?: string[];
  links?: CreationDoc['links'];
  label?: string;
}
export async function commitCreationDoc(
  projectId: string, doc: Pick<CreationDoc, 'id' | 'revision'>, input: CreationCommitInput, requestId?: string,
): Promise<CreationDoc> {
  const links = input.links?.map(({ keptRevision: _kept, ...link }) => link);
  const id = requestId ?? creationIntentId('commit', doc.id, doc.revision, input);
  return withPayload(projectId, input.payload, async (payload) => (await post<{ doc: CreationDoc }>(docUrl(doc.id, '/commit'), projectId, {
    ...input, ...(links ? { links } : {}), ...(payload !== undefined ? { payload } : {}), baseRevision: doc.revision, requestId: id,
  })).doc);
}
export async function restoreCreationDoc(
  projectId: string, doc: Pick<CreationDoc, 'id' | 'revision'>, operation: 'undo' | 'redo' | 'restore', revision?: number,
): Promise<CreationDoc> {
  return (await post<{ doc: CreationDoc }>(docUrl(doc.id, `/${operation}`), projectId, {
    baseRevision: doc.revision, requestId: creationIntentId(operation, doc.id, doc.revision, revision ?? null), ...(revision ? { revision } : {}),
  })).doc;
}
export async function keepCreationLink(projectId: string, docId: string, linkId: string, revision: number | null): Promise<CreationDoc> {
  return (await post<{ doc: CreationDoc }>(docUrl(docId, `/links/${encodeURIComponent(linkId)}/keep`), projectId, { revision })).doc;
}

export async function listCreationCandidates(projectId: string, id: string): Promise<CreationCandidateSummary[]> {
  return (await call<{ candidates: CreationCandidateSummary[] }>(`${docUrl(id, '/candidates')}${query(projectId)}`)).candidates;
}
export async function readCreationCandidate(projectId: string, id: string, candidateId: string): Promise<CreationCandidate> {
  return (await call<{ candidate: CreationCandidate }>(`${docUrl(id, `/candidates/${encodeURIComponent(candidateId)}`)}${query(projectId)}`)).candidate;
}
export async function acceptCreationCandidate(projectId: string, doc: Pick<CreationDoc, 'id' | 'revision'>, candidateId: string): Promise<CreationDoc> {
  return (await post<{ doc: CreationDoc }>(docUrl(doc.id, `/candidates/${encodeURIComponent(candidateId)}/accept`), projectId, {
    baseRevision: doc.revision, requestId: creationIntentId('accept', doc.id, candidateId, doc.revision),
  })).doc;
}
export async function discardCreationCandidate(projectId: string, id: string, candidateId: string): Promise<CreationCandidateSummary> {
  return (await post<{ candidate: CreationCandidateSummary }>(docUrl(id, `/candidates/${encodeURIComponent(candidateId)}/discard`), projectId)).candidate;
}
export async function cleanupCreationCandidates(projectId: string, id: string, scope: 'stale' | 'all'): Promise<number> {
  return (await post<{ discarded: number }>(docUrl(id, '/candidates-cleanup'), projectId, { scope })).discarded;
}
export async function rebaseCreationCandidate(projectId: string, doc: Pick<CreationDoc, 'id' | 'revision'>, candidateId: string): Promise<CreationCandidateSummary> {
  return (await post<{ candidate: CreationCandidateSummary }>(docUrl(doc.id, `/candidates/${encodeURIComponent(candidateId)}/rebase`), projectId, {
    requestId: creationIntentId('rebase', doc.id, candidateId, doc.revision),
  })).candidate;
}
export async function recordCreationOutput(
  projectId: string, id: string, output: { sourceRevision: number; path: string; mediaType: string },
): Promise<CreationOutput> {
  return (await post<{ output: CreationOutput }>(docUrl(id, '/outputs'), projectId, {
    ...output, requestId: creationIntentId('output', id, output.sourceRevision, output.path, output.mediaType),
  })).output;
}
