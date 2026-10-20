import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';
import { mediaDirName, mediaFileName, workspaceMediaUrl } from '../../utils/workspaceMedia.js';
import { CreationUiError } from './creationErrors.js';
import { attachGltfDecoders, gltfCompressions, readGltfJson } from './modelDecoders.js';

export const MODEL_FILE_ACCEPT = '.glb,.gltf,.obj,.stl,.ply,.fbx,.dae,.3mf';
/** `missingTextures`: referenced texture files that could not be loaded; the model opened without them. */
export interface LoadedModel { object: THREE.Object3D; clips: THREE.AnimationClip[]; fileName: string; missingTextures?: string[] }

/** Textures are optional companions (the model opens without them); buffers and material libraries are required. */
const TEXTURE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.avif', '.tga', '.tif', '.tiff', '.psd', '.dds', '.ktx', '.ktx2', '.exr', '.hdr'];
const TEXTURE_PATTERN = new RegExp(`\\.(?:${TEXTURE_EXTENSIONS.map((ext) => ext.slice(1)).join('|')})$`, 'i');
/** Handed to a loader in place of a texture we do not have. It never decodes, so the slot is cleared after loading. */
export const UNAVAILABLE_TEXTURE = 'data:,vibi3d-unavailable-texture';

function extension(name: string): string { return name.slice(name.lastIndexOf('.')).toLowerCase(); }
function normalizedPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && parts.length && parts[parts.length - 1] !== '..') parts.pop();
    else if (part !== '..' || parts.length === 0 || parts[parts.length - 1] === '..') parts.push(part);
  }
  return parts.join('/');
}
function decodedPath(url: string): string {
  const clean = url.split(/[?#]/, 1)[0] ?? url;
  try { return normalizedPath(decodeURIComponent(clean)); } catch { return normalizedPath(clean); }
}
function embedded(url: string): boolean { return /^(data:|blob:)/i.test(url); }
function isTexturePath(url: string): boolean { return TEXTURE_EXTENSIONS.includes(extension(decodedPath(url))); }
/** The file a texture URL names, for the user; embedded images have none. */
function textureName(url: string): string { return embedded(url) ? '' : mediaFileName(decodedPath(url)); }

/** Companion files are resolved against the model folder, then by unambiguous basename. */
export function createLocalResourceResolver(files: readonly File[], primary: File): { resolve: (url: string) => string; dispose: () => void } {
  const paths = new Map<string, File>();
  const basenames = new Map<string, File[]>();
  const urls = new Map<File, string>();
  const primaryPath = normalizedPath(primary.webkitRelativePath || primary.name);
  const directory = mediaDirName(primaryPath);
  for (const file of files) {
    const path = normalizedPath(file.webkitRelativePath || file.name);
    paths.set(path, file);
    const name = mediaFileName(path);
    basenames.set(name, [...(basenames.get(name) ?? []), file]);
  }
  return {
    resolve: (url) => {
      if (embedded(url)) return url;
      const path = decodedPath(url);
      const matches = basenames.get(mediaFileName(path)) ?? [];
      const file = paths.get(normalizedPath(`${directory}/${path}`)) ?? paths.get(path) ?? (matches.length === 1 ? matches[0] : undefined);
      if (!file && isTexturePath(path)) return UNAVAILABLE_TEXTURE;
      if (!file) throw new CreationUiError('model-companion-missing', { name: mediaFileName(path) || url });
      let objectUrl = urls.get(file);
      if (!objectUrl) { objectUrl = URL.createObjectURL(file); urls.set(file, objectUrl); }
      return objectUrl;
    },
    dispose: () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls.clear(); },
  };
}

export function workspaceResourceUrl(projectId: string, filePath: string, url: string): string {
  if (embedded(url) || url.startsWith('/api/workspace-media?')) return url;
  const directory = mediaDirName(filePath);
  if (/^[a-z]+:/i.test(url) || url.startsWith('//')) {
    // Exporters record textures by the author's absolute path; the file usually travels next to the model.
    if (isTexturePath(url)) return workspaceMediaUrl(projectId, normalizedPath(`${directory}/${textureName(url)}`));
    throw new CreationUiError('model-external-resource');
  }
  return workspaceMediaUrl(projectId, normalizedPath(`${directory}/${decodedPath(url)}`));
}

/**
 * Texture bytes come through `fetch`, which the packaged app routes over IPC; an `<img>`'s own
 * request to /api/… never reaches the server there (see useWorkspaceImage). TGA, common in game
 * assets, has no browser decoder and goes through three's parser. A texture that cannot be
 * fetched or decoded is reported and left empty, so the model still opens.
 */
class FetchedTextureLoader extends THREE.Loader<THREE.Texture> {
  constructor(manager: THREE.LoadingManager, private readonly tga: boolean, private readonly failed: (url: string) => void) { super(manager); }

  override load(url: string, onLoad?: (texture: THREE.Texture) => void, _onProgress?: (event: ProgressEvent) => void, onError?: (error: unknown) => void): THREE.Texture {
    const texture = this.tga ? new THREE.DataTexture() : new THREE.Texture();
    const requested = this.path ? this.path + url : url;
    const fail = (error: unknown): void => { this.failed(requested); onError?.(error); };
    let target: string;
    try { target = this.manager.resolveURL(requested); } catch (error) { fail(error); return texture; }
    if (target === UNAVAILABLE_TEXTURE) { fail(new Error(`Texture not found: ${requested}`)); return texture; }
    this.manager.itemStart(target);
    void fetch(target)
      .then(async (response) => {
        if (!response.ok) throw new CreationUiError('model-texture-failed', { status: response.status });
        if (texture instanceof THREE.DataTexture) applyTga(texture, await response.arrayBuffer());
        else texture.image = await decodeImage(await response.blob());
        texture.needsUpdate = true;
        onLoad?.(texture);
      })
      .catch(fail)
      .finally(() => this.manager.itemEnd(target));
    return texture;
  }
}

async function decodeImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

/** Mirrors DataTextureLoader, except that it keeps the wrap modes the model loader already set. */
function applyTga(texture: THREE.DataTexture, bytes: ArrayBuffer): void {
  const parsed = new TGALoader().parse(bytes);
  if (!parsed.data || !parsed.width || !parsed.height) throw new CreationUiError('model-texture-failed', { status: 0 });
  texture.image = { data: parsed.data, width: parsed.width, height: parsed.height };
  texture.flipY = parsed.flipY ?? texture.flipY;
  texture.generateMipmaps = parsed.generateMipmaps ?? texture.generateMipmaps;
  texture.minFilter = parsed.minFilter ?? THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
}

/** A texture that never received pixels renders black; clear it so the material shows its own color. */
function clearUnloadedTextures(object: THREE.Object3D): void {
  const cleared = new Set<THREE.Texture>();
  object.traverse((node) => {
    const material = (node as THREE.Mesh).material;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      const slots = item as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(slots)) {
        if (value instanceof THREE.Texture && value.version === 0) { slots[key] = null; cleared.add(value); item.needsUpdate = true; }
      }
    }
  });
  cleared.forEach((texture) => texture.dispose());
}

/** Wait for textures as well as geometry before revoking object URLs or replacing the visible model. */
async function loadManaged(fileName: string, bytes: ArrayBuffer, resolveUrl: (url: string) => string): Promise<LoadedModel> {
  const manager = new THREE.LoadingManager();
  const missing = new Set<string>();
  const names = new Map<string, string>();
  const note = (name: string): void => { if (name) missing.add(name); };
  manager.setURLModifier((url) => {
    const resolved = resolveUrl(url);
    if (resolved === UNAVAILABLE_TEXTURE) note(textureName(url)); else names.set(resolved, textureName(url));
    return resolved;
  });
  // A missing buffer or material library rejects the parse itself; what fails here is a texture.
  manager.onError = (url) => { if (url !== UNAVAILABLE_TEXTURE) note(names.get(url) ?? textureName(url)); };
  const format = extension(fileName);
  // glTF already fetches its images (ImageBitmapLoader) and drops the ones that fail. VRM is a glb container.
  if (format !== '.gltf' && format !== '.glb' && format !== '.vrm') {
    const failed = (url: string): void => note(textureName(url));
    manager.addHandler(/\.tga$/i, new FetchedTextureLoader(manager, true, failed));
    manager.addHandler(TEXTURE_PATTERN, new FetchedTextureLoader(manager, false, failed));
  }
  const complete = new Promise<void>((resolve) => { manager.onLoad = resolve; });
  // A sentinel prevents synchronous parsers from finishing before they schedule their resources.
  manager.itemStart('vibi3d-parse');
  let object: THREE.Object3D | undefined;
  try {
    const parsed = await parseModel(format, bytes, manager);
    object = parsed.object;
    manager.itemEnd('vibi3d-parse');
    await complete;
    clearUnloadedTextures(object);
    return { ...parsed, fileName, missingTextures: [...missing] };
  } catch (error) {
    if (object) disposeModel(object);
    throw error;
  }
}

export async function loadLocalModel(files: File[], primaryFile?: File): Promise<LoadedModel> {
  const primary = primaryFile ?? files.find((file) => MODEL_FILE_ACCEPT.split(',').includes(extension(file.name)));
  if (!primary) throw new CreationUiError('model-format-unsupported');
  const resolver = createLocalResourceResolver(files.includes(primary) ? files : [primary, ...files], primary);
  try { return await loadManaged(primary.name, await primary.arrayBuffer(), resolver.resolve); }
  finally { resolver.dispose(); }
}

export async function loadWorkspaceModel(projectId: string, filePath: string): Promise<LoadedModel> {
  const response = await fetch(workspaceMediaUrl(projectId, filePath));
  if (!response.ok) throw new CreationUiError('model-load-failed', { status: response.status });
  return loadManaged(mediaFileName(filePath), await response.arrayBuffer(), (url) => workspaceResourceUrl(projectId, filePath, url));
}

export async function parseModel(
  ext: string, bytes: ArrayBuffer, manager = new THREE.LoadingManager(), renderer?: THREE.WebGLRenderer,
): Promise<Omit<LoadedModel, 'fileName'>> {
  const text = (): string => new TextDecoder().decode(bytes);
  switch (ext.toLowerCase()) {
    // §5.1 #2-1 (G) ⑦ — VRM 은 glb 그릇이다(확장 정보는 읽지 않고 형상·재질만).
    case '.vrm':
    case '.glb':
    case '.gltf': {
      const data = ext.toLowerCase() === '.gltf' ? text() : bytes;
      const loader = new GLTFLoader(manager);
      // Draco / meshopt / KTX2 decoders load only for files that use them.
      const release = await attachGltfDecoders(loader, gltfCompressions(readGltfJson(data)), renderer);
      let gltf;
      try { gltf = await loader.parseAsync(data, ''); } finally { release(); }
      // GLTFExporter adds an identity scene around a non-Scene root. Restore our saved
      // root so each save/reopen does not add a wrapper or lose its lighting metadata.
      const child = gltf.scene.children[0];
      const savedRoot = gltf.scene.userData['vibi3dId'] === undefined && gltf.scene.children.length === 1
        && child && typeof child.userData['vibi3dId'] === 'string' && typeof child.userData['vibi3dLighting'] === 'number'
        ? child : gltf.scene;
      if (savedRoot !== gltf.scene) savedRoot.removeFromParent();
      return { object: savedRoot, clips: gltf.animations };
    }
    case '.obj': {
      const object = new OBJLoader(manager).parse(text());
      try {
        // OBJ without a material library remains supported; libraries, when present, must resolve.
        for (const library of (object as THREE.Group & { materialLibraries: string[] }).materialLibraries) {
          const creator = await new MTLLoader(manager).loadAsync(library);
          object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const replace = (material: THREE.Material): THREE.Material => {
              if (!(material.name in creator.materialsInfo)) return material;
              const result = creator.create(material.name);
              material.dispose();
              return result;
            };
            child.material = Array.isArray(child.material) ? child.material.map(replace) : replace(child.material);
          });
        }
        return { object, clips: [] };
      } catch (error) { disposeModel(object); throw error; }
    }
    case '.stl':
    case '.ply': {
      const geometry = ext.toLowerCase() === '.stl' ? new STLLoader(manager).parse(bytes) : new PLYLoader(manager).parse(bytes);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ color: geometry.hasAttribute('color') ? 0xffffff : 0xb9c2d0, roughness: 0.65, metalness: 0.1, vertexColors: geometry.hasAttribute('color') });
      return { object: new THREE.Mesh(geometry, material), clips: [] };
    }
    case '.fbx': {
      const object = new FBXLoader(manager).parse(bytes, '');
      return { object, clips: object.animations };
    }
    case '.dae': {
      const collada = new ColladaLoader(manager).parse(text(), '');
      if (!collada?.scene) throw new CreationUiError('model-empty-scene');
      return { object: collada.scene, clips: collada.scene.animations };
    }
    case '.3mf': return { object: new ThreeMFLoader(manager).parse(bytes), clips: [] };
    default: throw new CreationUiError('model-format-unsupported');
  }
}

/** Exports only the imported model (no grid, selection helpers, or viewer lights). Stop playback first. */
export async function exportModelGlb(object: THREE.Object3D, clips: THREE.AnimationClip[] = []): Promise<ArrayBuffer> {
  // GLTFExporter interprets wireframe=true as line primitives. A viewer toggle must
  // never turn a saved solid mesh into line geometry, even temporarily on failure.
  const wireframes = new Map<THREE.Material & { wireframe: boolean }, boolean>();
  object.traverse((node) => {
    const material = (node as THREE.Mesh).material;
    for (const item of Array.isArray(material) ? material : material ? [material] : []) {
      if ('wireframe' in item && typeof item.wireframe === 'boolean') {
        const wireMaterial = item as THREE.Material & { wireframe: boolean };
        if (!wireframes.has(wireMaterial)) wireframes.set(wireMaterial, wireMaterial.wireframe);
        wireMaterial.wireframe = false;
      }
    }
  });
  try {
    const result = await new GLTFExporter().parseAsync(object, { binary: true, animations: clips, onlyVisible: false, trs: true });
    if (!(result instanceof ArrayBuffer)) throw new CreationUiError('glb-export-failed');
    return result;
  } finally {
    wireframes.forEach((value, material) => { material.wireframe = value; });
  }
}

/** Imported model resources may be shared between meshes; each GPU resource is disposed once. */
export function disposeModel(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (node instanceof THREE.InstancedMesh) node.dispose();
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => materials.add(material));
    else if (mesh.material) materials.add(mesh.material);
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
  });
  materials.forEach((material) => Object.values(material).forEach((value: unknown) => { if (value instanceof THREE.Texture) textures.add(value); }));
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
}
