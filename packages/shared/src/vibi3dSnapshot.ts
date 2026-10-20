import { validateVibi3DAuthoringCommand, validateVibi3DLight, validateVibi3DMaterial, validateVibi3DMotionKeys, validateVibi3DRecipe } from './vibi3dAuthoring.js';
import { validateVibi3DArchitectureRecipe } from './vibi3dArchitecture.js';
import { validateVibi3DLook, validateVibi3DNodeShadows, type Vibi3DNodeShadows } from './vibi3dLook.js';
import { validateVibi3DDocumentBinding, isVibi3DWorkflowId } from './vibi3dWorkflow.js';
import { isVibi3DIdentifier, type Vibi3DSnapshot, type Vibi3DNode, type Vibi3DVec3 } from './vibi3d.js';
import { validateVibi3DInstance, validateVibi3DKitModules } from './vibi3dKit.js';
import { VIBI3D_LIMITS } from './vibi3dLimits.js';
import { validateVibi3DSignRecipe, validateVibi3DDecalRecipe, validateVibi3DMascotRecipe } from './vibi3dDecorations.js';
import { validateVibi3DCameraView, validateVibi3DShots } from './vibi3dCamera.js';

type Bag = Record<string, unknown>;
function bag(v: unknown): v is Bag { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function text(v: unknown, max = 1024): v is string { return typeof v === 'string' && v.length > 0 && v.length <= max; }
function finite(v: unknown, max = 1e9): v is number { return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max; }
function vec(v: unknown): v is Vibi3DVec3 { return Array.isArray(v) && v.length === 3 && v.every(n => finite(n)); }
function color(v: unknown): v is string { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); }
function revision(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }

export function validateVibi3DSnapshot(value: unknown): Vibi3DSnapshot | null {
  if (!bag(value) || !isVibi3DIdentifier(value.sessionId) || !text(value.projectId, 4096) || !text(value.fileName, 4096)
    || !revision(value.revision) || !Array.isArray(value.nodes) || value.nodes.length > VIBI3D_LIMITS.snapshotNodes
    || !(value.selectedId === null || text(value.selectedId))) return null;
  const nodes: Vibi3DNode[] = [];
  const ids = new Set<string>();
  for (const n of value.nodes) {
    if (!bag(n) || !text(n.id) || ids.has(n.id) || typeof n.name !== 'string' || n.name.length > 4096 || !text(n.type)
      || !(n.parentId === null || text(n.parentId)) || !vec(n.position) || !vec(n.rotation) || !vec(n.scale)
      || (n.color !== undefined && !color(n.color))) return null;
    ids.add(n.id);
    // Optional descriptions that fail validation are dropped from this node — one bad value never rejects the scene.
    const recipe = n.recipe === undefined ? null : validateVibi3DRecipe(n.recipe);
    const architecture = n.architecture === undefined ? null : validateVibi3DArchitectureRecipe(n.architecture);
    const sign = validateVibi3DSignRecipe(n.sign), decal = validateVibi3DDecalRecipe(n.decal), mascot = validateVibi3DMascotRecipe(n.mascot);
    const instance = n.instance === undefined ? null : validateVibi3DInstance(n.instance);
    if (n.instance !== undefined && (!instance || instance.placementId !== n.id)) return null;
    const material = n.material === undefined ? null : validateVibi3DMaterial(n.material);
    const light = n.light === undefined ? null : validateVibi3DLight(n.light);
    const motions = Array.isArray(n.motions) ? n.motions.flatMap((m) => {
      const keys = bag(m) && text(m.name, 200) ? validateVibi3DMotionKeys(m.keys) : null;
      return keys && bag(m) ? [{ name: m.name as string, keys }] : [];
    }) : [];
    if (n.locked !== undefined && typeof n.locked !== 'boolean') return null;
    const shadows = n.shadows === undefined ? null : validateVibi3DNodeShadows(n.shadows);
    if (n.shadows !== undefined && (!shadows || typeof shadows.cast !== 'boolean' || typeof shadows.receive !== 'boolean')) return null;
    nodes.push({ id: n.id, name: n.name, type: n.type, parentId: n.parentId, position: [...n.position],
      rotation: [...n.rotation], scale: [...n.scale], ...(typeof n.color === 'string' ? { color: n.color.toLowerCase() } : {}),
      ...(recipe ? { recipe } : {}), ...(material ? { material } : {}), ...(light ? { light } : {}), ...(motions.length ? { motions } : {}),
      ...(architecture ? { architecture } : {}),
      ...(sign ? { sign } : {}), ...(decal ? { decal } : {}), ...(mascot ? { mascot } : {}),
      ...(instance ? { instance } : {}),
      ...(typeof n.locked === 'boolean' ? { locked: n.locked } : {}), ...(shadows ? { shadows: shadows as Vibi3DNodeShadows } : {}) });
  }
  if ((value.selectedId !== null && !ids.has(value.selectedId)) || nodes.some((n) => n.parentId !== null && (!ids.has(n.parentId) || n.parentId === n.id))) return null;
  const result: Vibi3DSnapshot = { sessionId: value.sessionId, projectId: value.projectId, fileName: value.fileName,
    revision: value.revision, selectedId: value.selectedId, nodes };
  if (value.kitModules !== undefined) {
    const modules = validateVibi3DKitModules(value.kitModules); if (!modules) return null; result.kitModules = modules;
  }
  if (nodes.filter(node => node.instance).length > VIBI3D_LIMITS.placements) return null;
  if (value.document !== undefined) {
    const document = validateVibi3DDocumentBinding(value.document); if (!document) return null; result.document = document;
  }
  for (const key of ['ownerId', 'runId'] as const) {
    if (value[key] !== undefined) { if (!isVibi3DWorkflowId(value[key])) return null; result[key] = value[key]; }
  }
  for (const key of ['canUndo', 'canRedo'] as const) {
    if (value[key] !== undefined) { if (typeof value[key] !== 'boolean') return null; result[key] = value[key]; }
  }
  if (value.lighting !== undefined) { if (!finite(value.lighting, 10) || value.lighting < 0) return null; result.lighting = value.lighting; }
  if (value.look !== undefined) {
    const look = validateVibi3DLook(value.look); if (!look) return null; result.look = look;
  }
  if (value.camera !== undefined) {
    const camera = validateVibi3DCameraView(value.camera); if (!camera) return null; result.camera = camera;
  }
  if (value.shots !== undefined) { const shots = validateVibi3DShots(value.shots); if (!shots) return null; result.shots = shots; }
  if (value.activeShotId !== undefined) {
    if (typeof value.activeShotId !== 'string' || !result.shots?.some(shot => shot.id === value.activeShotId)) return null;
    result.activeShotId = value.activeShotId;
  }
  if (bag(value.cameraMotion) && text(value.cameraMotion.name, 200)) {
    const keys = validateVibi3DAuthoringCommand({ type: 'cameraMotion', name: value.cameraMotion.name, keys: value.cameraMotion.keys });
    if (keys?.type === 'cameraMotion') result.cameraMotion = { name: keys.name, keys: keys.keys };
  }
  if (value.playback !== undefined) {
    const p = value.playback;
    if (!bag(p) || !(p.clip === null || text(p.clip, 4096)) || !finite(p.time) || p.time < 0 || typeof p.playing !== 'boolean') return null;
    result.playback = { clip: p.clip, time: p.time, playing: p.playing };
  }
  return result;
}
