import type { CreationDocSummary, CreationValue } from '@vibisual/shared';
import type { VideoAsset } from '@vibisual/video';
import { listCreationDocs, readCreationRevision } from './creationApi.js';
import { resolveCreationBlobs } from './creationBlobs.js';
import { CreationUiError } from './creationErrors.js';
import { isImageDocument, type ImageDocument } from './imageSource.js';
import { resolveImageSources } from './imageRender.js';
import { importVideoAsset } from './videoDocumentApi.js';

/** Editable sources a video can use (payload-free summaries; failures stay visible through the shared list). */
export async function listVideoSources(projectId: string): Promise<CreationDocSummary[]> {
  const { docs } = await listCreationDocs(projectId);
  return docs.filter(doc => doc.appId === 'vibi3d' || doc.appId === 'vibimage');
}

/**
 * Imports one immutable revision as a self-contained video asset: blob references and project photos are inlined,
 * so preview, export workers and later edits of the source never change this asset.
 */
export async function importVideoSource(projectId: string, id: string, revision: number): Promise<VideoAsset> {
  const doc = await readCreationRevision(projectId, id, revision);
  const resolved = await resolveCreationBlobs(projectId, doc.payload);
  let payload: CreationValue = resolved;
  if (doc.appId === 'vibimage') {
    if (!isImageDocument(resolved)) throw new CreationUiError('image-source-invalid');
    const image: ImageDocument = resolved;
    const { sources, failed } = await resolveImageSources(image, projectId);
    if (failed.length) throw new CreationUiError('image-source-unavailable');
    payload = JSON.parse(JSON.stringify({
      ...image, layers: image.layers.map(layer => layer.kind === 'image' && layer.source ? { ...layer, source: sources[layer.source] ?? layer.source } : layer),
    })) as CreationValue;
  } else if (doc.appId !== 'vibi3d') throw new CreationUiError('unsupported-source-app');
  const file = new File([JSON.stringify(payload)], `${id}-r${revision}.${doc.appId}`, { type: 'application/json' });
  const asset = await importVideoAsset(projectId, file);
  return {
    ...asset, creationSource: { id, revision, appId: doc.appId },
    ...(isImageDocument(payload) ? { width: payload.width, height: payload.height } : {}),
  };
}
