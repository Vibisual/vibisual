import { useState } from 'react';
import { writeWorkspaceMedia } from '../../utils/workspaceMedia.js';
import { recordCreationOutput } from '../Creation/creationApi.js';
import { creationErrorCode } from '../Creation/creationErrors.js';
import { IMAGE_RATIOS, imageVariant, type ImageDocument } from '../Creation/imageSource.js';
import { imageTextFonts, renderImageBlob } from '../Creation/imageRender.js';
import { defaultTextMeasure, ensureImageFonts, resetImageTextMeasure } from '../Creation/imageText.js';
import type { ImageSourceDoc } from './imageApi.js';

export type ImageExportRatio = 'original' | keyof typeof IMAGE_RATIOS;
/** Characters no OS accepts in a file name (plus control characters). */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]+/g;
function fileStem(title: string, fallback: string): string {
  const stem = title.replace(UNSAFE_NAME, '-').replace(/\s+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
  return stem || fallback;
}
/**
 * An export's name is decided by the source revision, the format and the ratio — exporting the same revision again
 * reuses the same file instead of piling up random-suffixed copies.
 */
export function imageExportPath(source: Pick<ImageSourceDoc, 'id' | 'title' | 'revision'>, ratio: ImageExportRatio, kind: 'png' | 'svg'): string {
  return `exports/${fileStem(source.title, source.id)}-r${source.revision}-${ratio}.${kind}`;
}
/** The documents an export run renders (derived formats re-flow their text with real font widths). */
export function imageExportDocs(payload: ImageDocument, variants: boolean): [ImageExportRatio, ImageDocument][] {
  if (!variants) return [['original', payload]];
  const measure = defaultTextMeasure();
  return (Object.entries(IMAGE_RATIOS) as [keyof typeof IMAGE_RATIOS, readonly [number, number]][])
    .map(([ratio, [width, height]]) => [ratio, imageVariant(payload, width, height, measure)]);
}

export function useImageExport(root: string, save: () => Promise<ImageSourceDoc | null>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paths, setPaths] = useState<string[]>([]);
  const run = async (kind: 'png' | 'svg', variants: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(''); setPaths([]);
    try {
      const source = await save();
      // A save that did not happen is reported — the export never just stops.
      if (!source) { setError('save-failed'); return; }
      await ensureImageFonts(imageTextFonts(source.payload));
      resetImageTextMeasure();
      for (const [ratio, doc] of imageExportDocs(source.payload, variants)) {
        const path = imageExportPath(source, ratio, kind);
        const blob = await renderImageBlob(doc, root, kind);
        const result = await writeWorkspaceMedia(root, path, new Uint8Array(await blob.arrayBuffer()));
        // The same revision + ratio + format renders the same picture: an existing file is that export.
        if (!result.ok && result.error !== 'exists') throw new Error('save-failed');
        await recordCreationOutput(root, source.id, { sourceRevision: source.revision, path, mediaType: blob.type });
        setPaths((previous) => [...previous, path]);
      }
    } catch (failure) { setError(creationErrorCode(failure) === 'unexpected' ? 'export-failed' : creationErrorCode(failure)); }
    finally { setBusy(false); }
  };
  return { busy, error, paths, run };
}
