import type * as THREE from 'three';
import { parseCreationBlobRef, type Vibi3DImageSource } from '@vibisual/shared';
import { externalizeForSave } from '../Creation/creationBlobs.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { modelGraphicSourceOwners } from './modelGraphicSources.js';

/** Regenerable artwork needs a pinned source, while ordinary imported model textures keep their existing upload path. */
export async function prepareLocalGraphicTexture(projectId: string, root: THREE.Object3D, target: THREE.Object3D,
  image: CanvasImageSource & { width: number; height: number }): Promise<Vibi3DImageSource | undefined> {
  if (!modelGraphicSourceOwners(root, target).size) return undefined;
  if (!projectId) throw new CreationUiError('vibi3d-source-unavailable');
  if (image.width > 4096 || image.height > 4096) throw new CreationUiError('source-too-large');
  const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d'); if (!context) throw new CreationUiError('image-source-unavailable');
  context.drawImage(image, 0, 0);
  // Even a tiny sticker needs a source reference that its recipe can resolve after regeneration.
  const ref = await externalizeForSave(projectId, canvas.toDataURL('image/png'), { stringMin: 0 });
  if (typeof ref !== 'string' || !parseCreationBlobRef(ref)) throw new CreationUiError('image-source-unavailable');
  return { kind: 'blob', ref };
}
