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
}
export interface Vibi3DSnapshot {
  sessionId: string;
  projectId: string;
  fileName: string;
  revision: number;
  selectedId: string | null;
  nodes: Vibi3DNode[];
  canUndo?: boolean;
  canRedo?: boolean;
  lighting?: number;
  camera?: { position: Vibi3DVec3; target: Vibi3DVec3 };
  playback?: { clip: string | null; time: number; playing: boolean };
}
export type Vibi3DCommand =
  | { type: 'update'; id: string; position?: Vibi3DVec3; rotation?: Vibi3DVec3; scale?: Vibi3DVec3; color?: string }
  | { type: 'select'; id: string | null }
  | { type: 'undo' | 'redo' | 'capture' }
  | { type: 'lighting'; intensity: number };
export interface Vibi3DCommandRequest {
  commandId: string;
  expectedRevision: number;
  commands: Vibi3DCommand[];
}
export interface Vibi3DCommandResult {
  commandId: string;
  status: 'pending' | 'applied' | 'rejected';
  revision?: number;
  error?: string;
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
  if (!bag(value)) return null;
  if (value.type === 'undo' || value.type === 'redo' || value.type === 'capture') {
    return keys(value, ['type']) ? { type: value.type } : null;
  }
  if (value.type === 'select') {
    return keys(value, ['type', 'id']) && (value.id === null || text(value.id)) ? { type: 'select', id: value.id } : null;
  }
  if (value.type === 'lighting') {
    return keys(value, ['type', 'intensity']) && finite(value.intensity, 10) && value.intensity >= 0
      ? { type: 'lighting', intensity: value.intensity } : null;
  }
  if (value.type !== 'update' || !text(value.id) || !keys(value, ['type', 'id', 'position', 'rotation', 'scale', 'color'])) return null;
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
  return Object.keys(result).length > 2 ? result : null;
}

export function validateVibi3DCommandRequest(value: unknown): Vibi3DCommandRequest | null {
  if (!bag(value) || !keys(value, ['commandId', 'expectedRevision', 'commands']) || !isVibi3DIdentifier(value.commandId)
    || !revision(value.expectedRevision) || !Array.isArray(value.commands) || value.commands.length < 1 || value.commands.length > 100) return null;
  const commands = value.commands.map(validateVibi3DCommand);
  if (commands.some((c) => c === null)) return null;
  const valid = commands as Vibi3DCommand[];
  if (valid.length > 1 && valid.some((c) => c.type !== 'update' && c.type !== 'lighting')) return null;
  return { commandId: value.commandId, expectedRevision: value.expectedRevision, commands: valid };
}

export function validateVibi3DSnapshot(value: unknown): Vibi3DSnapshot | null {
  if (!bag(value) || !isVibi3DIdentifier(value.sessionId) || !text(value.projectId, 4096) || !text(value.fileName, 4096)
    || !revision(value.revision) || !Array.isArray(value.nodes) || value.nodes.length > 20000
    || !(value.selectedId === null || text(value.selectedId))) return null;
  const nodes: Vibi3DNode[] = [];
  const ids = new Set<string>();
  for (const n of value.nodes) {
    if (!bag(n) || !text(n.id) || ids.has(n.id) || typeof n.name !== 'string' || n.name.length > 4096 || !text(n.type)
      || !(n.parentId === null || text(n.parentId)) || !vec(n.position) || !vec(n.rotation) || !vec(n.scale)
      || (n.color !== undefined && !color(n.color))) return null;
    ids.add(n.id);
    nodes.push({ id: n.id, name: n.name, type: n.type, parentId: n.parentId, position: [...n.position],
      rotation: [...n.rotation], scale: [...n.scale], ...(typeof n.color === 'string' ? { color: n.color.toLowerCase() } : {}) });
  }
  if ((value.selectedId !== null && !ids.has(value.selectedId)) || nodes.some((n) => n.parentId !== null && (!ids.has(n.parentId) || n.parentId === n.id))) return null;
  const result: Vibi3DSnapshot = { sessionId: value.sessionId, projectId: value.projectId, fileName: value.fileName,
    revision: value.revision, selectedId: value.selectedId, nodes };
  for (const key of ['canUndo', 'canRedo'] as const) {
    if (value[key] !== undefined) { if (typeof value[key] !== 'boolean') return null; result[key] = value[key]; }
  }
  if (value.lighting !== undefined) { if (!finite(value.lighting, 10) || value.lighting < 0) return null; result.lighting = value.lighting; }
  if (value.camera !== undefined) {
    if (!bag(value.camera) || !vec(value.camera.position) || !vec(value.camera.target)) return null;
    result.camera = { position: [...value.camera.position], target: [...value.camera.target] };
  }
  if (value.playback !== undefined) {
    const p = value.playback;
    if (!bag(p) || !(p.clip === null || text(p.clip, 4096)) || !finite(p.time) || p.time < 0 || typeof p.playing !== 'boolean') return null;
    result.playback = { clip: p.clip, time: p.time, playing: p.playing };
  }
  return result;
}
