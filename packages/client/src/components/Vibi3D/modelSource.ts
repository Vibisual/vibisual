import * as THREE from 'three';
import { escapeCreationPointer, type CreationDoc, type CreationLink, type CreationValue } from '@vibisual/shared';
import { commitCreationDoc, createCreationDoc, readCreationDoc } from '../Creation/creationApi.js';
import { resolveCreationBlobs } from '../Creation/creationBlobs.js';
import { CreationUiError } from '../Creation/creationErrors.js';
import type { LoadedModel } from './modelIO.js';

export interface ModelSource {
  format: 'vibi3d'; version: 1;
  scene: ReturnType<THREE.Object3D['toJSON']>;
  clips: ReturnType<typeof THREE.AnimationClip.toJSON>[];
  /** Generator code is text here. Only the existing CLI may run an explicit local authoring request (§5.13 R-11). */
  generatorCode?: string;
}
export const GENERATOR_CODE_MAX = 200_000;

type Bag = Record<string, unknown>;
const bag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The local matrices a source was opened with. decompose → compose is not exact, so without this an object nobody
 * touched (a locked one) would be written back with different last digits and fail the server's lock check.
 */
const openedMatrices = new WeakMap<THREE.Object3D, { matrix: number[]; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();
function rememberMatrices(root: THREE.Object3D): void {
  root.traverse((node) => openedMatrices.set(node, {
    matrix: node.matrix.toArray(), position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
  }));
}
function untouchedMatrices(root: THREE.Object3D): Map<string, number[]> {
  const result = new Map<string, number[]>();
  root.traverse((node) => {
    const opened = openedMatrices.get(node);
    if (opened && opened.position.equals(node.position) && opened.quaternion.equals(node.quaternion) && opened.scale.equals(node.scale)) {
      result.set(node.uuid, opened.matrix);
    }
  });
  return result;
}
function eachNode(node: unknown, pointer: string, visit: (node: Bag, pointer: string) => void): void {
  if (!bag(node)) return;
  visit(node, pointer);
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (bag(child) && typeof child.uuid === 'string') eachNode(child, `${pointer}/children/@${escapeCreationPointer(child.uuid)}`, visit);
    }
  }
}

export function serializeModelSource(object: THREE.Object3D, clips: THREE.AnimationClip[], previous?: unknown, generatorCode?: string | null): ModelSource {
  object.updateMatrixWorld(true);
  // Three's JSON writer/loader retain userData references. Sources and previews must own their data.
  const metadata = bag(previous) && previous.format === 'vibi3d' ? previous : {};
  const scene = object.toJSON();
  const kept = untouchedMatrices(object);
  eachNode(scene.object, '', (node) => {
    const matrix = typeof node.uuid === 'string' ? kept.get(node.uuid) : undefined;
    if (matrix) node.matrix = [...matrix];
  });
  const source = structuredClone({ ...metadata, format: 'vibi3d', version: 1, scene, clips: clips.map((clip) => THREE.AnimationClip.toJSON(clip)) }) as ModelSource;
  if (generatorCode === null || generatorCode === '') delete source.generatorCode;
  else if (generatorCode !== undefined) source.generatorCode = generatorCode.slice(0, GENERATOR_CODE_MAX);
  return source;
}

/**
 * §5.13 (R-10) — what the server must keep exactly as it is: each locked object (with its children) and the
 * geometry, material, texture and image entries it uses. User saves send these as `lockedPaths`; an agent proposal
 * that changes one is refused by the server, not only by this screen.
 */
export function modelLockedPaths(source: unknown): string[] {
  if (!bag(source) || !bag(source.scene)) return [];
  const scene = source.scene;
  const uuids = (key: string): Set<string> => new Set((Array.isArray(scene[key]) ? scene[key] : []).flatMap((item) => bag(item) && typeof item.uuid === 'string' ? [item.uuid] : []));
  const geometries = uuids('geometries'); const materials = uuids('materials'); const textures = uuids('textures');
  const textureImage = new Map<string, string>();
  for (const texture of Array.isArray(scene.textures) ? scene.textures : []) {
    if (bag(texture) && typeof texture.uuid === 'string' && typeof texture.image === 'string') textureImage.set(texture.uuid, texture.image);
  }
  const materialEntries = new Map<string, Bag>();
  for (const material of Array.isArray(scene.materials) ? scene.materials : []) if (bag(material) && typeof material.uuid === 'string') materialEntries.set(material.uuid, material);
  const paths = new Set<string>();
  const resource = (kind: string, uuid: string): string => `/scene/${kind}/@${escapeCreationPointer(uuid)}`;
  const holdResources = (node: Bag): void => {
    if (typeof node.geometry === 'string' && geometries.has(node.geometry)) paths.add(resource('geometries', node.geometry));
    for (const id of Array.isArray(node.material) ? node.material : [node.material]) {
      if (typeof id !== 'string' || !materials.has(id)) continue;
      paths.add(resource('materials', id));
      for (const value of Object.values(materialEntries.get(id) ?? {})) {
        if (typeof value !== 'string' || !textures.has(value)) continue;
        paths.add(resource('textures', value));
        const image = textureImage.get(value);
        if (image) paths.add(resource('images', image));
      }
    }
    if (Array.isArray(node.children)) node.children.forEach((child) => { if (bag(child)) holdResources(child); });
  };
  eachNode(scene.object, '/scene/object', (node, pointer) => {
    if (!bag(node.userData) || node.userData.vibi3dLocked !== true) return;
    paths.add(pointer);
    holdResources(node);
  });
  // A locked parent already covers its children's pointers.
  const all = [...paths];
  return all.filter((path) => !all.some((other) => other !== path && path.startsWith(`${other}/children/`))).sort();
}

export async function loadModelSource(payload: unknown, fileName = 'model', projectId?: string): Promise<LoadedModel> {
  if (!bag(payload) || payload.format !== 'vibi3d' || !bag(payload.scene) || !Array.isArray(payload.clips)) throw new CreationUiError('invalid-model-source');
  // Stored sources keep large binaries as content-hash files; put them back before three reads the JSON.
  const resolved = projectId ? await resolveCreationBlobs(projectId, payload as unknown as CreationValue) : payload;
  const source = resolved as unknown as ModelSource;
  // Sources are data, never scripts. Disallow a serialized image causing external network requests.
  for (const image of (source.scene as THREE.Object3DJSON & { images?: Array<{ url: unknown }> }).images ?? []) {
    const urls = Array.isArray(image.url) ? image.url : [image.url];
    if (urls.some((url) => typeof url === 'string' && !/^data:image\//i.test(url))) throw new CreationUiError('textures-must-embed');
  }
  const scene = structuredClone(source.scene);
  // Blob resolution is for image bytes. Keep authoring references as references so later saves and edits can reuse them.
  const rawNodes = new Map<string, Bag>();
  eachNode(payload.scene.object, '', node => { if (typeof node.uuid === 'string') rawNodes.set(node.uuid, node); });
  eachNode(scene.object, '', node => {
    const raw = typeof node.uuid === 'string' ? rawNodes.get(node.uuid) : undefined;
    if (!raw || !bag(raw.userData)) return;
    for (const key of ['vibi3dSignRecipe', 'vibi3dDecalRecipe', 'vibi3dMascotRecipe']) {
      if (raw.userData[key] === undefined) continue;
      if (!bag(node.userData)) node.userData = {};
      (node.userData as Bag)[key] = structuredClone(raw.userData[key]);
    }
  });
  const rawMaterials = new Map((Array.isArray(payload.scene.materials) ? payload.scene.materials : [])
    .filter(bag).map((material) => [material.uuid, material]));
  for (const material of (scene as THREE.Object3DJSON & { materials?: Array<{ uuid: string; userData?: Bag }> }).materials ?? []) {
    const raw = rawMaterials.get(material.uuid);
    if (raw && bag(raw.userData) && raw.userData.vibi3dMaterial !== undefined) {
      material.userData ??= {};
      material.userData['vibi3dMaterial'] = structuredClone(raw.userData.vibi3dMaterial);
    }
  }
  const object = await new THREE.ObjectLoader().parseAsync(scene);
  // Recorded before anything recomposes the matrices from position/rotation/scale.
  rememberMatrices(object);
  return { object, clips: source.clips.map((clip) => THREE.AnimationClip.parse(clip)), fileName };
}
export async function readModelDocument(projectId: string, id: string): Promise<CreationDoc> {
  const doc = await readCreationDoc(projectId, id);
  if (doc.appId !== 'vibi3d') throw new CreationUiError('source-open-failed');
  return doc;
}
/** Opens a stored source: its document plus the scene, with blob references resolved. */
export async function openModelDocument(projectId: string, doc: CreationDoc): Promise<LoadedModel & { document: CreationDoc }> {
  return { ...await loadModelSource(doc.payload, doc.title, projectId), document: doc };
}
export function modelGeneratorCode(doc: Pick<CreationDoc, 'payload'> | null): string {
  return doc && bag(doc.payload) && typeof doc.payload.generatorCode === 'string' ? doc.payload.generatorCode : '';
}

/**
 * Saves the scene as a new revision (or as a new source with `copy`). The request id follows the content, so a
 * retry after a lost reply replays instead of failing as a conflict; locked objects travel as server `lockedPaths`.
 */
export async function saveModelDocument(
  projectId: string, document: CreationDoc | null, title: string, payload: ModelSource, copy = false, links?: CreationLink[],
): Promise<CreationDoc> {
  const value = payload as unknown as CreationValue;
  const lockedPaths = modelLockedPaths(payload);
  // No free-text label: the history shows the translated operation (commit) for user saves.
  if (document && !copy) return commitCreationDoc(projectId, document, { payload: value, lockedPaths, ...(links ? { links } : {}) });
  return createCreationDoc(projectId, {
    appId: 'vibi3d', title, payload: value, lockedPaths,
    ...(document ? { links: document.links.map(({ keptRevision: _kept, ...link }) => link), parameters: document.parameters } : {}),
    ...(links ? { links: links.map(({ keptRevision: _kept, ...link }) => link) } : {}),
  });
}
