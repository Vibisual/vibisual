import { evenSide, type VideoAsset } from '@vibisual/video';
import type { AppTaskDocumentBuilder } from '../../apps/registry.js';
import { createDoc, patchDoc, readJsonResponse } from '../Creation/videoDocumentApi.js';
import { buildAssetItemOps } from './videoEditor.js';

/** Preparation owns a new persisted document, never the old node's mutable reference. */
export const prepareVideoTaskDocument: AppTaskDocumentBuilder = async (args) => {
  const project = args.projectName || args.projectId;
  const title = args.title.trim();
  if (args.mode === 'copy' && args.source.ref) {
    const res = await fetch(`/api/app/vibistudio/doc/${encodeURIComponent(args.source.ref)}/copy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, title, requestId: args.requestId }),
    });
    return { ref: (await readJsonResponse<{ doc: { id: string } }>(res)).doc.id };
  }
  if (args.mode === 'copy' && !args.source.file) throw new Error('There is no video document to copy.');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(args.requestId))), b => b.toString(16).padStart(2, '0')).join('');
  let doc = await createDoc(project, title, `task-${hash.slice(0, 40)}`);
  if (args.mode === 'copy' && args.source.file && doc.title === title && Object.keys(doc.assets).length === 0
    && doc.version <= (doc.style ? 2 : 1) && doc.tracks.every(track => track.items.length === 0)) {
    const res = await fetch('/api/app/vibistudio/assets/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, path: args.source.file }),
    });
    const { asset } = await readJsonResponse<{ asset: VideoAsset }>(res);
    // Metadata measurement stays in the app's existing decoder path and is loaded only for file imports.
    const { measureAssets } = await import('./useVideoRenderer.js');
    const measured = asset.kind === 'image' ? undefined : (await measureAssets(project, [asset]))[asset.id];
    const ops = buildAssetItemOps(doc, { ...asset,
      ...(measured?.duration ? { duration: measured.duration } : {}),
      ...(measured?.width ? { width: measured.width } : {}),
      ...(measured?.height ? { height: measured.height } : {}),
      ...(measured?.hasAudio !== undefined ? { hasAudio: measured.hasAudio } : {}),
    }, 0, title);
    if (ops.length === 0) throw new Error('The source media could not be measured.');
    if (asset.kind === 'video' && measured?.width && measured.height) {
      ops.push({ op: 'setDoc', patch: { size: { width: evenSide(measured.width), height: evenSide(measured.height) } } });
    }
    doc = (await patchDoc(project, doc.id, doc.version, ops)).doc;
  }
  return { ref: doc.id };
};
