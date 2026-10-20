import { CreationUiError } from '../Creation/creationErrors.js';
import { blobDataUrl } from '../Creation/imageRender.js';

const IMPORTABLE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/svg+xml']);

/**
 * §5.13 (R-10) — an imported picture stays in memory as an inline data URL. Opening or importing writes nothing;
 * the first save of the editable source stores it once, as a content-addressed blob under `.vibisual/creation/blobs`
 * (never a copy in the user's project folder).
 */
export async function importedImageSource(blob: Blob): Promise<string> {
  if (!IMPORTABLE.has(blob.type)) throw new CreationUiError('image-source-invalid');
  return blobDataUrl(blob);
}
