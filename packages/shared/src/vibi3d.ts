import {
  validateVibi3DAuthoringCommand,
  type Vibi3DAuthoringCommand, type Vibi3DCameraKey, type Vibi3DLight, type Vibi3DMaterial, type Vibi3DMotionKey, type Vibi3DRecipe,
} from './vibi3dAuthoring.js';
import { getVibi3DCommandDefinition } from './vibi3dCommandCatalog.js';
import { validateVibi3DLook, validateVibi3DNodeShadows, type Vibi3DLook, type Vibi3DNodeShadows } from './vibi3dLook.js';
import { validateVibi3DArchitectureCommand, type Vibi3DArchitectureCommand, type Vibi3DArchitectureRecipe } from './vibi3dArchitecture.js';
import { validateVibi3DWorkflowCommand,
  type Vibi3DDocumentBinding, type Vibi3DWorkflowCommand, type Vibi3DWorkflowResult } from './vibi3dWorkflow.js';
import { validateVibi3DKitCommand, type Vibi3DKitCommand, type Vibi3DInstance, type Vibi3DKitModule } from './vibi3dKit.js';
import { VIBI3D_LIMITS, vibi3DJsonBytes } from './vibi3dLimits.js';
import { validateVibi3DDecorationCommand, type Vibi3DDecorationCommand, type Vibi3DSignRecipe, type Vibi3DDecalRecipe, type Vibi3DMascotRecipe } from './vibi3dDecorations.js';
import type { Vibi3DCameraView, Vibi3DShot } from './vibi3dCamera.js';
export * from './vibi3dAuthoring.js';
/** The Vibi3D bridge exposes data and bounded edits, never executable source. */
export const VIBI3D_API_PREFIX = '/api/app/vibi3d';
export const VIBI3D_RENDERER_TOKEN_HEADER = 'x-vibi3d-renderer-token';
export type Vibi3DVec3 = [number, number, number];
export interface Vibi3DNode {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  position: Vibi3DVec3;
  /** Euler XYZ angles, in degrees. */
  rotation: Vibi3DVec3;
  scale: Vibi3DVec3;
  color?: string;
  recipe?: Vibi3DRecipe;
  architecture?: Vibi3DArchitectureRecipe;
  sign?: Vibi3DSignRecipe;
  decal?: Vibi3DDecalRecipe;
  mascot?: Vibi3DMascotRecipe;
  instance?: Vibi3DInstance;
  material?: Vibi3DMaterial;
  locked?: boolean;
  shadows?: Vibi3DNodeShadows;
  /** Present on lights: what the light editor shows and edits. */
  light?: Vibi3DLight;
  /** Named motions authored on this object (re-opened for editing). */
  motions?: { name: string; keys: Vibi3DMotionKey[] }[];
}
export interface Vibi3DSnapshot {
  sessionId: string;
  projectId: string;
  fileName: string;
  revision: number;
  selectedId: string | null;
  nodes: Vibi3DNode[];
  kitModules?: Vibi3DKitModule[];
  document?: Vibi3DDocumentBinding;
  ownerId?: string;
  runId?: string;
  canUndo?: boolean;
  canRedo?: boolean;
  lighting?: number;
  look?: Vibi3DLook;
  camera?: Vibi3DCameraView;
  shots?: Vibi3DShot[];
  activeShotId?: string;
  /** The keyframed view-camera path, if one was authored. */
  cameraMotion?: { name: string; keys: Vibi3DCameraKey[] };
  playback?: { clip: string | null; time: number; playing: boolean };
}
export type Vibi3DCommand =
  | Vibi3DAuthoringCommand
  | Vibi3DWorkflowCommand
  | Vibi3DArchitectureCommand
  | Vibi3DKitCommand
  | Vibi3DDecorationCommand
  | { type: 'update'; id: string; position?: Vibi3DVec3; rotation?: Vibi3DVec3; scale?: Vibi3DVec3; color?: string; shadows?: Partial<Vibi3DNodeShadows> }
  | { type: 'select'; id: string | null }
  | { type: 'undo' | 'redo' }
  | { type: 'lighting'; intensity: number }
  | ({ type: 'look' } & Vibi3DLook);
export interface Vibi3DCommandRequest {
  commandId: string;
  expectedRevision: number;
  commands: Vibi3DCommand[];
}
export interface Vibi3DCommandResult {
  commandId: string;
  status: 'pending' | 'running' | 'applied' | 'rejected';
  revision?: number;
  error?: string;
  progress?: number;
  expiresAt?: number;
  result?: Vibi3DWorkflowResult;
}

type Bag = Record<string, unknown>;
function bag(v: unknown): v is Bag { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function text(v: unknown, max = 1024): v is string { return typeof v === 'string' && v.length > 0 && v.length <= max; }
export function isVibi3DIdentifier(v: unknown): v is string { return typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v); }
function finite(v: unknown, max = 1e9): v is number { return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max; }
function vec(v: unknown, scale = false): v is Vibi3DVec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => finite(n, scale ? 1e6 : 1e9) && (!scale || n !== 0));
}
function color(v: unknown): v is string { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); }
function revision(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }
function keys(v: Bag, allowed: string[]): boolean { return Object.keys(v).every((k) => allowed.includes(k)); }

/** Returns a canonical copy; unknown command fields are rejected, not silently executed later. */
export function validateVibi3DCommand(value: unknown): Vibi3DCommand | null {
  if (!bag(value) || !getVibi3DCommandDefinition(value.type)) return null;
  const kit = validateVibi3DKitCommand(value); if (kit) return kit;
  const decoration = validateVibi3DDecorationCommand(value); if (decoration) return decoration;
  const architecture = validateVibi3DArchitectureCommand(value); if (architecture) return architecture;
  const workflow = validateVibi3DWorkflowCommand(value);
  if (workflow) return workflow;
  const authored = validateVibi3DAuthoringCommand(value);
  if (authored) return authored;
  if (value.type === 'undo' || value.type === 'redo') {
    return keys(value, ['type']) ? { type: value.type } : null;
  }
  if (value.type === 'select') {
    return keys(value, ['type', 'id']) && (value.id === null || text(value.id)) ? { type: 'select', id: value.id } : null;
  }
  if (value.type === 'lighting') {
    return keys(value, ['type', 'intensity']) && finite(value.intensity, 10) && value.intensity >= 0
      ? { type: 'lighting', intensity: value.intensity } : null;
  }
  if (value.type === 'look') {
    const { type: _type, ...settings } = value;
    const look = validateVibi3DLook(settings);
    return look && Object.keys(look).length ? { type: 'look', ...look } : null;
  }
  if (value.type !== 'update' || !text(value.id) || !keys(value, ['type', 'id', 'position', 'rotation', 'scale', 'color', 'shadows'])) return null;
  const result: Extract<Vibi3DCommand, { type: 'update' }> = { type: 'update', id: value.id };
  for (const key of ['position', 'rotation', 'scale'] as const) {
    if (value[key] !== undefined) {
      if (!vec(value[key], key === 'scale')) return null;
      result[key] = [...value[key]];
    }
  }
  if (value.color !== undefined) {
    if (!color(value.color)) return null;
    result.color = value.color.toLowerCase();
  }
  if (value.shadows !== undefined) {
    const shadows = validateVibi3DNodeShadows(value.shadows); if (!shadows) return null; result.shadows = shadows;
  }
  return Object.keys(result).length > 2 ? result : null;
}

export function validateVibi3DCommandRequest(value: unknown): Vibi3DCommandRequest | null {
  if (!bag(value) || !keys(value, ['commandId', 'expectedRevision', 'commands']) || !isVibi3DIdentifier(value.commandId)
    || !revision(value.expectedRevision) || !Array.isArray(value.commands) || value.commands.length < 1 || value.commands.length > VIBI3D_LIMITS.commandCount
    || vibi3DJsonBytes(value) > VIBI3D_LIMITS.requestBytes) return null;
  const commands = value.commands.map(validateVibi3DCommand);
  if (commands.some((c) => c === null)) return null;
  const valid = commands as Vibi3DCommand[];
  if (valid.length > 1 && valid.some((c) => ['select', 'undo', 'redo', 'capture', 'checkpoint', 'propose', 'resume', 'stats'].includes(c.type))) return null;
  return { commandId: value.commandId, expectedRevision: value.expectedRevision, commands: valid };
}

export { validateVibi3DSnapshot } from './vibi3dSnapshot.js';
