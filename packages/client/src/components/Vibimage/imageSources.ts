import type { CreationDoc, CreationDocSummary, CreationLink } from '@vibisual/shared';
import { readCreationRevision } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { imageId, isImageDocument, newImageLayer } from '../Creation/imageSource.js';
import { blobDataUrl, renderImageBlob } from '../Creation/imageRender.js';
import { renderModelSourceStill } from '../Creation/modelScene.js';
import { commitImageDoc, retainedImageLinks, type ImageSourceDoc } from './imageApi.js';

/** How a picture layer uses another source; the inspector names it ("3D render" is not "imported photo"). */
export const IMAGE_LINK_ROLE = { image: 'image-layer', model: 'model-render' } as const;
const ROLE_OF_APP: Readonly<Record<string, string>> = { vibimage: IMAGE_LINK_ROLE.image, vibi3d: IMAGE_LINK_ROLE.model };

function pixels(n: number): number { return Math.max(16, Math.min(8192, Math.round(n))); }

/** Renders one immutable revision of a linked source into an inline picture (stored as a blob on the next save). */
export async function renderLinkedImage(source: CreationDoc, root: string, width: number, height: number): Promise<string> {
  if (source.appId === 'vibi3d') return blobDataUrl(await renderModelSourceStill(root, source.payload, pixels(width), pixels(height)));
  if (!isImageDocument(source.payload)) throw new CreationUiError('unsupported-image-source');
  return blobDataUrl(await renderImageBlob(source.payload, root, 'png'));
}

export async function addLinkedImage(root: string, doc: ImageSourceDoc, summary: Pick<CreationDocSummary, 'id' | 'revision'>): Promise<ImageSourceDoc> {
  const source = await readCreationRevision(root, summary.id, summary.revision);
  const role = ROLE_OF_APP[source.appId];
  if (!role) throw new CreationUiError('unsupported-source-app');
  const layer = newImageLayer(doc.payload, 'image', source.title);
  layer.width = Math.max(16, doc.payload.width - doc.payload.style.margin * 2);
  layer.height = Math.max(16, doc.payload.height - doc.payload.style.margin * 2);
  layer.source = await renderLinkedImage(source, root, layer.width, layer.height);
  const link: CreationLink = { id: imageId(), sourceId: source.id, sourceRevision: source.revision, role, targets: [layer.id] };
  const payload = { ...doc.payload, layers: [...doc.payload.layers, layer] };
  return commitImageDoc(root, doc, { payload: JSON.parse(JSON.stringify(payload)), links: [...retainedImageLinks(doc.links, payload), link] });
}

/**
 * Replaces only the linked pictures with the chosen revision; placement, other layers and other references stay.
 * Returns null for a role this app cannot redraw (the shared panel then moves only the reference and says so).
 */
export async function updateLinkedImage(root: string, doc: ImageSourceDoc, link: CreationLink, revision: number): Promise<ImageSourceDoc | null> {
  if (link.role !== IMAGE_LINK_ROLE.image && link.role !== IMAGE_LINK_ROLE.model) return null;
  const source = await readCreationRevision(root, link.sourceId, revision);
  const targets = doc.payload.layers.filter((layer) => link.targets.includes(layer.id));
  if (targets.some((layer) => layer.locked)) throw new CreationUiError('object-protected');
  const images = new Map(await Promise.all(targets.map(async (layer) => [layer.id, await renderLinkedImage(source, root, layer.width, layer.height)] as const)));
  const payload = { ...doc.payload, layers: doc.payload.layers.map((layer) => images.has(layer.id) ? { ...layer, source: images.get(layer.id)! } : layer) };
  return commitImageDoc(root, doc, {
    payload: JSON.parse(JSON.stringify(payload)),
    links: retainedImageLinks(doc.links, payload).map((item) => item.id === link.id ? { ...item, sourceRevision: source.revision } : item),
  });
}

/** Where a picture layer comes from, by the reference that targets it. */
export function imageLayerOrigin(links: readonly CreationLink[], layerId: string): 'import' | 'model-render' | 'linked-image' {
  const link = links.find((item) => item.targets.includes(layerId));
  if (!link) return 'import';
  return link.role === IMAGE_LINK_ROLE.model ? 'model-render' : 'linked-image';
}
