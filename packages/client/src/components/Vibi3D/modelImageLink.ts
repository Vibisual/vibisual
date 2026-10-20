import * as THREE from 'three';
import { creationStableJson, type CreationDoc, type CreationLink, type CreationValue, type Vibi3DMaterialMapSlot } from '@vibisual/shared';
import { commitCreationDoc, creationIntentId, readCreationDoc, readCreationRevision } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { externalizeForSave } from '../Creation/creationBlobs.js';
import { isImageDocument } from '../Creation/imageSource.js';
import { blobDataUrl, loadImage, renderImageBlob } from '../Creation/imageRender.js';
import { ModelEditor } from './modelEditor.js';
import { disposeModel, type LoadedModel } from './modelIO.js';
import { loadModelSource, modelLockedPaths, serializeModelSource, type ModelSource } from './modelSource.js';

import { modelTextureRole, pinModelTexture } from './modelTextureReferences.js';
export { MODEL_TEXTURE_ROLE, modelTextureRole, modelTextureSlot } from './modelTextureReferences.js';

export async function readTextureSource(projectId: string, sourceId: string, revision?: number): Promise<CreationDoc> {
  const doc = revision === undefined ? await readCreationDoc(projectId, sourceId) : await readCreationRevision(projectId, sourceId, revision);
  if (doc.appId !== 'vibimage') throw new CreationUiError('unsupported-image-source');
  return doc;
}

/**
 * True when any pixel is not fully opaque. Sampled nearest-neighbour at most 512 px wide (no smoothing, so an opaque
 * picture never reads as transparent at its edges). Only such an image makes the receiving material transparent.
 */
export function imageHasAlpha(image: CanvasImageSource & { width: number; height: number }): boolean {
  const scale = Math.min(1, 512 / Math.max(image.width, image.height, 1));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  // Unknown: keep the blended setting, which still shows an opaque picture correctly.
  if (!context) return true;
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  return false;
}

export interface RenderedTexture { texture: THREE.Texture; hasAlpha: boolean }
/** Render the source's real layers, and embed the PNG so a pinned model never fetches a newer image. */
export async function renderTextureSource(source: CreationDoc, projectId: string): Promise<RenderedTexture> {
  if (source.appId !== 'vibimage' || !isImageDocument(source.payload)) throw new CreationUiError('unsupported-image-source');
  const image = await loadImage(await blobDataUrl(await renderImageBlob(source.payload, projectId, 'png')));
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { texture, hasAlpha: imageHasAlpha(image) };
}

export interface PreparedModelTexture { loaded: LoadedModel; payload: ModelSource; links: CreationLink[]; }
/** All edits occur on a separate scene. Only a successful version-checked save may replace the live model. */
export async function prepareModelTexture(
  projectId: string, document: CreationDoc, source: CreationDoc, targets: string[], rendered: RenderedTexture, linkId?: string, slot: Vibi3DMaterialMapSlot = 'map',
): Promise<PreparedModelTexture> {
  const { texture } = rendered;
  if (!targets.length) { texture.dispose(); throw new CreationUiError('select-target'); }
  // The same picture always gets the same ids, so a retried save carries the same content (and replays).
  texture.source.uuid = creationIntentId('texture-image', source.id, source.revision);
  let loaded: LoadedModel | undefined;
  try {
    loaded = await loadModelSource(document.payload, document.title, projectId);
    const editor = new ModelEditor(loaded.object, loaded.clips);
    const id = linkId ?? creationIntentId(modelTextureRole(slot), document.id, document.revision, source.id, [...targets].sort());
    applyModelTextureSource(editor, source, targets, rendered, id, slot);
    const links = modelTextureLinks(document.links, source, targets, id, slot);
    texture.dispose();
    return { loaded, payload: serializeModelSource(loaded.object, loaded.clips, document.payload), links };
  } catch (error) { if (loaded) disposeModel(loaded.object); texture.dispose(); throw error; }
}

/** The live agent and [Texture connection] share material application and stable texture identities. */
export function applyModelTextureSource(
  editor: ModelEditor, source: CreationDoc, targets: string[], rendered: RenderedTexture, linkId: string, mapSlot: Vibi3DMaterialMapSlot = 'map',
): void {
  const { hasAlpha } = rendered;
  rendered.texture.source.uuid = creationIntentId('texture-image', source.id, source.revision);
  for (const target of targets) {
    const texture = rendered.texture.clone();
    pinModelTexture(texture, source, target, mapSlot, linkId);
    try {
      editor.applyMaterialMaps(target, { maps: { [mapSlot]: { source: { kind: 'vibimage', docId: source.id } } },
        ...(mapSlot === 'map' && hasAlpha ? { transparent: true } : {}),
      }, { [mapSlot]: texture }, editor.revision);
      texture.dispose();
    } catch (error) { texture.dispose(); throw error; }
    let slot = 0;
    editor.findObject(target)?.traverse((child) => {
      for (const material of Array.isArray((child as THREE.Mesh).material) ? (child as THREE.Mesh).material as THREE.Material[] : [(child as THREE.Mesh).material]) {
        const map = (material as THREE.MeshStandardMaterial | undefined)?.[mapSlot];
        if (map && map.source === texture.source) map.uuid = creationIntentId('texture', linkId, target, slot++);
      }
    });
  }
}

/** A target follows one source per material slot; pinned source revisions change only by user request. */
export function modelTextureLinks(previous: CreationLink[], source: CreationDoc, targets: string[], id: string, slot: Vibi3DMaterialMapSlot = 'map'): CreationLink[] {
  const role = modelTextureRole(slot);
  const link: CreationLink = { id, sourceId: source.id, sourceRevision: source.revision, role, targets };
  const links = previous.flatMap((old) => {
    if (old.id === id) return [];
    if (old.role !== role) return [old];
    const remaining = old.targets.filter((target) => !targets.includes(target));
    return remaining.length ? [{ ...old, targets: remaining }] : [];
  });
  return [...links, link];
}

export async function commitModelTexture(projectId: string, document: CreationDoc, prepared: PreparedModelTexture): Promise<CreationDoc> {
  const payload = await externalizeForSave(projectId, prepared.payload as unknown as CreationValue);
  const saved = await commitCreationDoc(projectId, document, {
    payload, links: prepared.links, lockedPaths: modelLockedPaths(prepared.payload),
  });
  const plainLinks = (links: CreationLink[]): CreationValue => links.map(({ keptRevision: _kept, ...link }) => link) as unknown as CreationValue;
  // Replayed receipts return the latest head, even when the original operation was a no-op.
  if (creationStableJson(saved.payload) !== creationStableJson(payload)
    || creationStableJson(plainLinks(saved.links)) !== creationStableJson(plainLinks(prepared.links))) throw new CreationUiError('source-changed-elsewhere');
  return saved;
}
