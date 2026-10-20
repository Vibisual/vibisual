import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CreationUiError } from './creationErrors.js';
import { attachGltfDecoders, gltfCompressions, readGltfJson } from './modelDecoders.js';

/** Snapshots are self-contained: only embedded (data:/blob:) dependencies may load. */
function embeddedOnly(): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => { if (/^(data:|blob:)/i.test(url)) return url; throw new CreationUiError('unbundled-dependency'); });
  return manager;
}
/** Parses an editable 3D source (`.vibi3d`), a glTF or a GLB into an object and its clips. */
export async function parseModelAsset(bytes: ArrayBuffer, path: string, renderer?: THREE.WebGLRenderer): Promise<{ object: THREE.Object3D; clips: THREE.AnimationClip[] }> {
  const manager = embeddedOnly();
  if (/\.vibi3d$/i.test(path)) {
    let payload: { format?: unknown; scene?: unknown; clips?: unknown };
    try { payload = JSON.parse(new TextDecoder().decode(bytes)) as typeof payload; } catch { throw new CreationUiError('invalid-model-source'); }
    if (payload.format !== 'vibi3d' || !payload.scene || typeof payload.scene !== 'object') throw new CreationUiError('invalid-model-source');
    const object = await new THREE.ObjectLoader(manager).parseAsync(payload.scene as Parameters<THREE.ObjectLoader['parseAsync']>[0]);
    const clips = (Array.isArray(payload.clips) ? payload.clips : []).map(clip => THREE.AnimationClip.parse(clip as Parameters<typeof THREE.AnimationClip.parse>[0]));
    return { object, clips };
  }
  const data = /\.gltf$/i.test(path) ? new TextDecoder().decode(bytes) : bytes;
  const loader = new GLTFLoader(manager);
  const release = await attachGltfDecoders(loader, gltfCompressions(readGltfJson(data)), renderer);
  try {
    const gltf = await loader.parseAsync(data, '');
    return { object: gltf.scene, clips: gltf.animations };
  } finally { release(); }
}
