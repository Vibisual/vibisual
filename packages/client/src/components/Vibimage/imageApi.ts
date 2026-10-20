import type { CreationCandidate, CreationCandidateSummary, CreationDoc, CreationDocSummary, CreationLink, CreationListFailure, CreationValue } from '@vibisual/shared';
import {
  acceptCreationCandidate, cleanupCreationCandidates, commitCreationDoc, createCreationDoc, discardCreationCandidate, listCreationCandidates,
  listCreationDocs, readCreationCandidate, readCreationDoc, readCreationRevision, rebaseCreationCandidate, restoreCreationDoc,
  type CreationCommitInput,
} from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { isImageDocument, type ImageDocument } from '../Creation/imageSource.js';

export type ImageSourceDoc = Omit<CreationDoc, 'payload'> & { payload: ImageDocument };
export type ImageCandidate = Omit<CreationCandidate, 'payload'> & { payload: ImageDocument };
export const VIBIMAGE_APP_ID = 'vibimage';

export function toImageSource(value: CreationDoc): ImageSourceDoc {
  if (value.appId !== VIBIMAGE_APP_ID || !isImageDocument(value.payload)) throw new CreationUiError('image-source-invalid');
  return { ...value, payload: value.payload };
}
export async function listImageDocs(root: string): Promise<{ docs: CreationDocSummary[]; failed: CreationListFailure[] }> {
  const { docs, failed } = await listCreationDocs(root);
  return { docs: docs.filter((doc) => doc.appId === VIBIMAGE_APP_ID), failed };
}
export async function readImageDoc(root: string, id: string): Promise<ImageSourceDoc> {
  return toImageSource(await readCreationDoc(root, id));
}
export async function readImageRevision(root: string, id: string, revision: number): Promise<ImageSourceDoc> {
  return toImageSource(await readCreationRevision(root, id, revision));
}
export async function createImageDoc(
  root: string, title: string, payload: ImageDocument,
  extras: { requestId?: string; links?: CreationLink[]; lockedPaths?: string[]; parameters?: Record<string, CreationValue> } = {},
): Promise<ImageSourceDoc> {
  return toImageSource(await createCreationDoc(root, { appId: VIBIMAGE_APP_ID, title, payload: imagePayloadValue(payload), ...extras }));
}
export async function commitImageDoc(root: string, doc: Pick<ImageSourceDoc, 'id' | 'revision'>, body: CreationCommitInput): Promise<ImageSourceDoc> {
  return toImageSource(await commitCreationDoc(root, doc, body));
}
export async function restoreImageDoc(root: string, doc: Pick<ImageSourceDoc, 'id' | 'revision'>, operation: 'undo' | 'redo'): Promise<ImageSourceDoc> {
  return toImageSource(await restoreCreationDoc(root, doc, operation));
}
/** Pending proposals only, without their payloads (the body is read when the user opens one). */
export async function imageCandidateSummaries(root: string, id: string): Promise<CreationCandidateSummary[]> {
  return (await listCreationCandidates(root, id)).filter((candidate) => candidate.status === 'pending');
}
export async function readImageCandidate(root: string, id: string, candidateId: string): Promise<ImageCandidate> {
  const candidate = await readCreationCandidate(root, id, candidateId);
  if (!isImageDocument(candidate.payload)) throw new CreationUiError('image-source-invalid');
  return { ...candidate, payload: candidate.payload };
}
export async function acceptImageCandidate(root: string, doc: Pick<ImageSourceDoc, 'id' | 'revision'>, candidateId: string): Promise<ImageSourceDoc> {
  return toImageSource(await acceptCreationCandidate(root, doc, candidateId));
}
export const discardImageCandidate = discardCreationCandidate;
export const cleanupImageCandidates = cleanupCreationCandidates;
export const rebaseImageCandidate = rebaseCreationCandidate;

export function imagePayloadValue(doc: ImageDocument): CreationValue {
  // App-specific interfaces intentionally have no JSON index signature; serialization removes optional fields.
  return JSON.parse(JSON.stringify(doc)) as CreationValue;
}
/** Links keep only targets that still exist; a link whose last target was removed goes away. */
export function retainedImageLinks(links: CreationLink[], payload: ImageDocument): CreationLink[] {
  const ids = new Set(payload.layers.map((layer) => layer.id));
  return links.map(({ keptRevision: _kept, ...link }) => ({ ...link, targets: link.targets.filter((target) => ids.has(target)) }))
    .filter((link) => link.targets.length > 0);
}
