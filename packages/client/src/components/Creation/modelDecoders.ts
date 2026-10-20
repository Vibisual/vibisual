import * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * §5.13 (R-10) — compressed glTF (Draco geometry · meshopt buffers · KTX2/Basis textures).
 *
 * The decoders are the copies three.js ships (`examples/jsm/libs`) — Draco and Basis Universal are Apache-2.0, meshopt
 * is MIT; their license texts sit next to this file (`third-party/`). They load only when a file actually uses the
 * extension. They reach the loaders as `blob:`/`data:` URLs through three's public options (`setDecoderPath` with an
 * explicit `{js, wasm}` pair, a LoadingManager URL modifier for KTX2), because the packaged app loads its pages from
 * `file://` where fetching a bundled asset path does not work on every OS.
 */
export type GltfCompression = 'draco' | 'meshopt' | 'ktx2';
const EXTENSION: Readonly<Record<string, GltfCompression>> = {
  KHR_draco_mesh_compression: 'draco',
  EXT_meshopt_compression: 'meshopt',
  KHR_meshopt_compression: 'meshopt',
  KHR_texture_basisu: 'ktx2',
};

/** The JSON of a .gltf text or a .glb container (null when it cannot be read — the loader reports that). */
export function readGltfJson(data: ArrayBuffer | string): { extensionsUsed?: unknown; extensionsRequired?: unknown } | null {
  try {
    if (typeof data === 'string') return JSON.parse(data) as { extensionsUsed?: unknown };
    const view = new DataView(data);
    if (data.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return JSON.parse(new TextDecoder().decode(data)) as { extensionsUsed?: unknown };
    const length = view.getUint32(12, true);
    if (view.getUint32(16, true) !== 0x4e4f534a || 20 + length > data.byteLength) return null;
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, length))) as { extensionsUsed?: unknown };
  } catch { return null; }
}
export function gltfCompressions(json: { extensionsUsed?: unknown; extensionsRequired?: unknown } | null): GltfCompression[] {
  if (!json) return [];
  const used = [json.extensionsUsed, json.extensionsRequired].flatMap((list) => Array.isArray(list) ? list : []);
  return [...new Set(used.flatMap((name) => typeof name === 'string' && EXTENSION[name] ? [EXTENSION[name]] : []))];
}

export interface GltfDecoderModules {
  draco: () => Promise<{ wrapper: string; wasm: string }>;
  basis: () => Promise<{ transcoder: string; wasm: string }>;
}
/** The bundled decoder files (lazy: only fetched into the chunk that decodes a compressed file). */
export const BUNDLED_DECODERS: GltfDecoderModules = {
  draco: async () => ({
    wrapper: (await import('three/examples/jsm/libs/draco/draco_wasm_wrapper.js?raw')).default,
    wasm: (await import('three/examples/jsm/libs/draco/draco_decoder.wasm?url&inline')).default,
  }),
  basis: async () => ({
    transcoder: (await import('three/examples/jsm/libs/basis/basis_transcoder.js?raw')).default,
    wasm: (await import('three/examples/jsm/libs/basis/basis_transcoder.wasm?url&inline')).default,
  }),
};

/**
 * Configures `loader` for the compressions `needs` lists. Returns a cleanup that releases workers and URLs.
 * KTX2 needs a renderer to pick a GPU format; without one, a small offscreen renderer answers once and is released.
 */
export async function attachGltfDecoders(
  loader: GLTFLoader, needs: readonly GltfCompression[], renderer?: THREE.WebGLRenderer, modules: GltfDecoderModules = BUNDLED_DECODERS,
): Promise<() => void> {
  const cleanups: (() => void)[] = [];
  if (needs.includes('draco')) {
    const [{ DRACOLoader }, files] = await Promise.all([import('three/examples/jsm/loaders/DRACOLoader.js'), modules.draco()]);
    const draco = new DRACOLoader();
    const js = URL.createObjectURL(new Blob([files.wrapper], { type: 'text/javascript' }));
    draco.setDecoderPath({ js, wasm: files.wasm } as unknown as string);
    loader.setDRACOLoader(draco);
    cleanups.push(() => { draco.dispose(); URL.revokeObjectURL(js); });
  }
  if (needs.includes('meshopt')) {
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  if (needs.includes('ktx2')) {
    const [{ KTX2Loader }, files] = await Promise.all([import('three/examples/jsm/loaders/KTX2Loader.js'), modules.basis()]);
    const js = URL.createObjectURL(new Blob([files.transcoder], { type: 'text/javascript' }));
    const manager = new THREE.LoadingManager();
    // The loader asks for "<path>basis_transcoder.js|wasm"; the modifier hands it our bundled copies.
    manager.setURLModifier((url) => url.endsWith('basis_transcoder.js') ? js : url.endsWith('basis_transcoder.wasm') ? files.wasm : url);
    const ktx2 = new KTX2Loader(manager).setTranscoderPath('vibisual-basis/');
    let probe: THREE.WebGLRenderer | null = null;
    try {
      if (!renderer) probe = new THREE.WebGLRenderer({ canvas: document.createElement('canvas') });
      ktx2.detectSupport(renderer ?? probe!);
    } finally {
      probe?.dispose();
      probe?.forceContextLoss();
    }
    loader.setKTX2Loader(ktx2);
    cleanups.push(() => { ktx2.dispose(); URL.revokeObjectURL(js); });
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}
