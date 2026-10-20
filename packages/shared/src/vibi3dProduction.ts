/** Local CLI authoring metadata. Source programs are text; only the user's coding CLI executes them. */
export interface Vibi3DParameter {
  label: string;
  type: 'number' | 'color' | 'boolean';
  value: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  partIds?: string[];
}
export interface Vibi3DAuthoring {
  engine: 'blender';
  version: 1;
  runId: string;
  stage: { id: string; label: string; completedAt: number };
  parameters: Record<string, Vibi3DParameter>;
  source: { script: string; blend: string; manifest: string; baseline: string; glb?: string };
  renderPaths: string[];
  checks: { finite: true; triangles: number; objects: number; triangleBudget: number; visualReview: 'pending' };
}
export interface Vibi3DAuthoringManifest {
  projectId: string;
  projectRoot: string;
  docId: string;
  script: string;
  outputDir: string;
  runId: string;
  parameters?: Record<string, Vibi3DParameter>;
  input?: string;
  publish?: boolean;
  render?: boolean;
  triangleBudget?: number;
  mode?: 'auto' | 'candidate';
  sourceDocument?: string;
}
export interface Vibi3DAuthoringKit {
  version: 1;
  projectRoot: string;
  blenderPath: string | null;
  files: Record<string, string>;
  protocol: string[];
  manifest: Vibi3DAuthoringManifest;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const relative = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2000
  && !value.startsWith('/') && !value.includes('\\') && !value.includes(':') && !value.includes('\0') && !value.split('/').some(part => part === '..' || part === '.');
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,90}$/.test(value);

/** Older/imported sources have no authoring data. Malformed data never becomes runnable instructions in the UI. */
export function readVibi3DAuthoring(payload: unknown): Vibi3DAuthoring | null {
  if (!record(payload) || !record(payload.authoring)) return null;
  const value = payload.authoring;
  const source = value.source;
  const checks = value.checks;
  if (value.engine !== 'blender' || value.version !== 1 || !identifier(value.runId) || !record(value.stage)
    || !identifier(value.stage.id) || typeof value.stage.label !== 'string' || value.stage.label.length > 200 || !finite(value.stage.completedAt)
    || !record(source) || !['script', 'blend', 'manifest', 'baseline'].every(key => relative(source[key]))
    || (source.glb !== undefined && !relative(source.glb)) || !Array.isArray(value.renderPaths)
    || value.renderPaths.length > 32 || !value.renderPaths.every(relative) || !record(value.parameters) || Object.keys(value.parameters).length > 100
    || !record(checks) || checks.finite !== true || checks.visualReview !== 'pending'
    || !['triangles', 'objects', 'triangleBudget'].every(key => finite(checks[key]))) return null;
  for (const [key, parameter] of Object.entries(value.parameters)) {
    if (!identifier(key) || !record(parameter) || typeof parameter.label !== 'string' || parameter.label.length > 200) return null;
    if (parameter.type === 'number') { if (!finite(parameter.value)) return null; }
    else if (parameter.type === 'color') { if (typeof parameter.value !== 'string' || !/^#[0-9a-f]{6}$/i.test(parameter.value)) return null; }
    else if (parameter.type === 'boolean') { if (typeof parameter.value !== 'boolean') return null; }
    else return null;
    if (['min', 'max', 'step'].some(key => parameter[key] !== undefined && !finite(parameter[key]))) return null;
    if (parameter.type === 'number' && ((finite(parameter.min) && Number(parameter.value) < parameter.min)
      || (finite(parameter.max) && Number(parameter.value) > parameter.max) || (finite(parameter.step) && parameter.step <= 0))) return null;
    if (parameter.partIds !== undefined && (!Array.isArray(parameter.partIds) || parameter.partIds.length > 1000
      || !parameter.partIds.every(id => typeof id === 'string' && id.length <= 200))) return null;
  }
  // All persisted fields used by consumers have been checked above; extra metadata is deliberately retained.
  return value as unknown as Vibi3DAuthoring;
}
