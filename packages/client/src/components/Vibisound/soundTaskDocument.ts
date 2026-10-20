import type { AppTaskDocumentBuilder } from '../../apps/registry.js';
import { copySoundDoc, createSoundDoc, importSoundAsset, mutateSoundDoc } from './soundApi.js';
import { assetClipOps } from './soundModel.js';
import { measureSoundImport } from './soundImport.js';

/** The caller has already flushed open editors. Never rebind or clear the old task here. */
export const prepareSoundTaskDocument: AppTaskDocumentBuilder = async (args) => {
  const project = args.projectName || args.projectId;
  const title = args.title.trim();
  if (args.mode === 'copy' && args.source.ref) {
    return { ref: (await copySoundDoc(project, args.source.ref, title, args.requestId)).doc.id };
  }
  if (args.mode === 'copy' && !args.source.file) throw new Error('There is no audio document to copy.');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(args.requestId))), b => b.toString(16).padStart(2, '0')).join('');
  let value = await createSoundDoc(project, title, `task-${hash.slice(0, 40)}`);
  if (args.mode === 'copy' && args.source.file && value.doc.version === 1 && value.doc.title === title
    && Object.keys(value.doc.assets).length === 0 && value.doc.tracks.every(track => track.clips.length === 0)) {
    const asset = await importSoundAsset(project, args.source.file);
    const duration = await measureSoundImport(project, asset);
    value = await mutateSoundDoc(project, value.doc, 'patch', assetClipOps(value.doc, asset, { track: 'task-audio', clip: 'task-source' }, duration));
  }
  return { ref: value.doc.id };
};
