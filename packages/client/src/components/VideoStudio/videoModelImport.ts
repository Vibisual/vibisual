import { disposeModel, exportModelGlb, loadLocalModel } from '../Creation/modelIO.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import { readGltfJson } from '../Creation/modelDecoders.js';
import { mediaFileName } from '../../utils/workspaceMedia.js';

const MODEL = /\.(glb|gltf)$/i;
/** Binary GPU companions never stand alone on a timeline. */
const BINARY_COMPANION = /\.(bin|ktx2?|dds|basis)$/i;

/** File names a glTF points at (buffers, images) — those files travel inside the model, not as separate media.
 *  Compared exactly, like the loader resolves them (Linux file names are case-sensitive). */
async function companionNames(file: File): Promise<Set<string>> {
  const json = readGltfJson(/\.gltf$/i.test(file.name) ? await file.text() : await file.arrayBuffer()) as
    { buffers?: { uri?: unknown }[]; images?: { uri?: unknown }[] } | null;
  const names = new Set<string>();
  for (const entry of [...(json?.buffers ?? []), ...(json?.images ?? [])]) {
    if (typeof entry?.uri !== 'string' || entry.uri.startsWith('data:')) continue;
    try { names.add(mediaFileName(decodeURIComponent(entry.uri))); } catch { names.add(mediaFileName(entry.uri)); }
  }
  return names;
}

/** The same loader used by Vibi3D resolves sidecars before publishing one self-contained video asset. */
export async function prepareVideoImports(files: readonly File[]): Promise<File[]> {
  const models = files.filter(file => MODEL.test(file.name));
  if (!models.length) return [...files];
  const result: File[] = [];
  const consumed = new Set<string>();
  for (const file of models) {
    for (const name of await companionNames(file)) consumed.add(name);
    const model = await loadLocalModel([...files], file);
    try {
      if (model.missingTextures?.length) throw new CreationUiError('model-textures-missing', { names: model.missingTextures.join(', ') });
      const bytes = await exportModelGlb(model.object, model.clips);
      result.push(new File([bytes], file.name.replace(/\.[^.]+$/, '.glb'), { type: 'model/gltf-binary' }));
    } finally { disposeModel(model.object); }
  }
  // Ordinary images and other materials stay, so selecting a model never discards unrelated input — but the
  // model's own textures and buffers are already embedded and do not become separate timeline items.
  result.push(...files.filter(file => !MODEL.test(file.name) && !BINARY_COMPANION.test(file.name) && !consumed.has(file.name)));
  return result;
}
