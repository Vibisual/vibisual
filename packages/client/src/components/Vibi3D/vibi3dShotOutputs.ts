import { isCreationDocId, vibi3DCaptureSize, type CreationDoc, type Vibi3DShot } from '@vibisual/shared';
import type { VideoAsset, VideoDoc, VideoDocOp } from '@vibisual/video';
import { creationIntentId, recordCreationOutput } from '../Creation/creationApi.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { writeWorkspaceMedia } from '../../utils/workspaceMedia.js';
import type { CapturedView } from './vibi3dCapture.js';

/** User exports are immutable outputs of the saved revision, outside the workflow's capture receipts. */
export async function saveShotStills(projectId: string, doc: CreationDoc, frames: readonly CapturedView[]): Promise<string[]> {
  if (!isCreationDocId(doc.id)) throw new CreationUiError('invalid-id');
  const paths: string[] = [];
  for (const frame of frames) {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(frame.dataUrl);
    if (!match) throw new CreationUiError('invalid-capture');
    const bytes = Uint8Array.from(atob(match[1]!), character => character.charCodeAt(0));
    const path = `.vibisual/creation/${doc.id}/stills/${crypto.randomUUID()}.png`;
    const written = await writeWorkspaceMedia(projectId, path, bytes);
    if (!written.ok) throw new CreationUiError('save-failed');
    try { await recordCreationOutput(projectId, doc.id, { sourceRevision: doc.revision, path: written.path, mediaType: 'image/png' }); }
    catch { throw new CreationUiError('output-not-recorded', { path: written.path }); }
    paths.push(written.path);
  }
  return paths;
}

export interface ShotVideoOptions { shots: readonly Vibi3DShot[]; motion?: { duration: number; aspect?: Vibi3DShot['aspect'] } }
export function shotVideoOps(doc: VideoDoc, asset: VideoAsset, options: ShotVideoOptions): VideoDocOp[] {
  if (!options.motion && !options.shots.length) throw new CreationUiError('capture-shot-not-found');
  const aspect = options.motion?.aspect ?? options.shots[0]?.aspect ?? '9:16';
  if (!options.motion && options.shots.some(shot => (shot.aspect ?? '9:16') !== aspect)) throw new CreationUiError('shot-aspect-mismatch');
  const [width, height] = vibi3DCaptureSize(aspect, 'final');
  const duration = options.motion ? Math.max(0.1, Math.min(3600, options.motion.duration)) : 4;
  const items = options.motion ? [{ id: creationIntentId(doc.id, 'camera-motion'), kind: 'model' as const, assetId: asset.id,
    at: 0, duration, props: { cameraMotion: true, modelBackground: 'sky' }, transform: { width, height } }]
    : options.shots.map((shot, index) => ({ id: creationIntentId(doc.id, 'shot', shot.id), kind: 'model' as const, assetId: asset.id,
      at: index * duration, duration, label: shot.name, props: { cameraShot: shot.id, modelBackground: 'sky' }, transform: { width, height } }));
  return [{ op: 'setDoc', patch: { size: { width, height }, fps: 30 } }, { op: 'setAsset', asset },
    { op: 'addTrack', track: { id: creationIntentId(doc.id, 'model-track'), kind: 'visual', items } }];
}
/** Reuses the existing immutable source import and optimistic video-document patch API. */
export async function createShotVideo(projectId: string, source: CreationDoc, options: ShotVideoOptions): Promise<VideoDoc> {
  if (!options.motion && (!options.shots.length || options.shots.some(shot => (shot.aspect ?? '9:16') !== (options.shots[0]?.aspect ?? '9:16')))) {
    throw new CreationUiError(options.shots.length ? 'shot-aspect-mismatch' : 'capture-shot-not-found');
  }
  const { createDoc, patchDoc } = await import('../Creation/videoDocumentApi.js');
  const { importVideoSource } = await import('../Creation/creationVideoSource.js');
  const id = `vibi3d-${creationIntentId(source.id, source.revision, options)}`;
  const doc = await createDoc(projectId, source.title, id);
  // A retry opens the existing completed document; human edits are never replaced.
  if (doc.tracks.some(track => track.items.length > 0)) return doc;
  const asset = await importVideoSource(projectId, source.id, source.revision);
  return (await patchDoc(projectId, doc.id, doc.version, shotVideoOps(doc, asset, options))).doc;
}
