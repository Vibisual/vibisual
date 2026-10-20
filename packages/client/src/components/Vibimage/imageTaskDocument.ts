import type { AppTaskDocumentBuilder } from '../../apps/registry.js';
import { fetchWorkspaceMediaBlob } from '../../utils/workspaceMedia.js';
import { copyTaskSource } from '../Creation/copyTaskSource.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { loadImage } from '../Creation/imageRender.js';
import { newImageDocument, newImageLayer } from '../Creation/imageSource.js';
import { createImageDoc, imagePayloadValue, readImageDoc } from './imageApi.js';
import { importedImageSource } from './imageImport.js';

export const prepareImageTaskDocument: AppTaskDocumentBuilder = async (args) => {
  if (args.mode === 'copy' && args.source.ref) {
    const source = await readImageDoc(args.projectId, args.source.ref);
    return { ref: (await copyTaskSource(args.projectId, { ...source, payload: imagePayloadValue(source.payload) }, args.title, args.requestId)).id };
  }
  const payload = newImageDocument();
  if (args.mode === 'copy' && args.source.file) {
    const blob = await fetchWorkspaceMediaBlob(args.projectId, args.source.file);
    if (!blob) throw new CreationUiError('image-source-unavailable');
    const source = await importedImageSource(blob);
    const image = await loadImage(source);
    if (!image.naturalWidth || !image.naturalHeight) throw new CreationUiError('image-source-invalid');
    const scale = Math.min(1, 8192 / image.naturalWidth, 8192 / image.naturalHeight);
    payload.width = Math.max(16, Math.round(image.naturalWidth * scale));
    payload.height = Math.max(16, Math.round(image.naturalHeight * scale));
    payload.background = 'transparent';
    payload.layers = [{ ...newImageLayer(payload, 'image', args.source.file), x: 0, y: 0,
      width: payload.width, height: payload.height, source, sourceOriginal: args.source.file }];
  }
  return { ref: (await createImageDoc(args.projectId, args.title, payload, { requestId: args.requestId })).id };
};
