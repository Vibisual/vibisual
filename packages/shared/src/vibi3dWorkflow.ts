import { isCreationDocId, type CreationValue } from './creation.js';
import type { Vibi3DStats } from './vibi3dStats.js';
import { VIBI3D_LIMITS } from './vibi3dLimits.js';
import { validateVibi3DCameraView, isVibi3DCameraAspect, type Vibi3DCameraView, type Vibi3DCameraAspect } from './vibi3dCamera.js';

export const VIBI3D_WORKFLOW_LIMITS = {
  views: 12, imageDimension: 4096, imagePixels: 16_777_216, pngBytes: 5_500_000,
  stages: 256, checks: 100, claimMs: 30_000, commandCount: VIBI3D_LIMITS.commandCount, capturePixels: 50_000_000,
} as const;
export interface Vibi3DDocumentBinding { id: string; revision: number; dirty: boolean; humanDirty?: boolean }
export type Vibi3DCaptureMode = 'lit' | 'clay' | 'wire' | 'ao';
export type Vibi3DCaptureQuality = 'draft' | 'final';
/** Inspection captures are full resolution unless the author explicitly requests a fast draft. */
export const VIBI3D_CAPTURE_DEFAULT_QUALITY: Vibi3DCaptureQuality = 'final';
export interface Vibi3DCaptureRaster { width: number; height: number; samples?: number }
export type Vibi3DCaptureView = string | ({ name?: string } & Vibi3DCameraView);
export interface Vibi3DCaptureCommand {
  type: 'capture'; views?: Vibi3DCaptureView[]; size?: [number, number]; aspect?: Vibi3DCameraAspect; mode?: Vibi3DCaptureMode; quality?: Vibi3DCaptureQuality;
}
export interface Vibi3DStageCheck {
  id: string; status: 'passed' | 'failed' | 'needs-review'; note?: string; evidencePath?: string;
}
export type Vibi3DWorkflowCommand = Vibi3DCaptureCommand
  | { type: 'checkpoint'; stage: string; label: string; checks?: Vibi3DStageCheck[] }
  | { type: 'propose'; label: string }
  | { type: 'resume'; runId: string; stage?: string };
export interface Vibi3DCaptureRecord {
  path: string; view: string; mode: Vibi3DCaptureMode; quality: Vibi3DCaptureQuality;
  width: number; height: number; revision: number; capturedAt: number; commandId?: string; raster?: Vibi3DCaptureRaster;
}
export interface Vibi3DCaptureUpload {
  view: string; mode: Vibi3DCaptureMode; quality: Vibi3DCaptureQuality; width: number; height: number; dataUrl: string; raster?: Vibi3DCaptureRaster;
}
export interface Vibi3DStageRecord {
  id: string; label: string; revision: number; sceneRevision: number; sourcePath: string;
  mode: 'commit' | 'intermediate' | 'candidate'; candidateId?: string; createdAt: number;
  captures: Vibi3DCaptureRecord[]; checks: Vibi3DStageCheck[];
}
export interface Vibi3DRun {
  id: string; docId: string; projectId: string; baseRevision: number; currentRevision: number;
  initialEmpty: boolean; createdAt: number; stages: Vibi3DStageRecord[]; candidateId?: string; activeStageId?: string;
}
export interface Vibi3DWorkflowResult { checkpoint?: Vibi3DStageRecord; captures?: Vibi3DCaptureRecord[]; stats?: Vibi3DStats }

type Bag = Record<string, unknown>;
const bag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const only = (value: Bag, allowed: string[]): boolean => Object.keys(value).every(key => allowed.includes(key));
export const isVibi3DWorkflowId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
/** Raster dimensions describe the actual draw buffer, independently of the encoded PNG size. */
export function validateVibi3DCaptureRaster(value: unknown): Vibi3DCaptureRaster | null {
  if (!bag(value) || !only(value, ['width', 'height', 'samples'])
    || ![value.width, value.height].every(n => Number.isSafeInteger(n) && Number(n) >= 1 && Number(n) <= VIBI3D_WORKFLOW_LIMITS.imageDimension)
    || (value.samples !== undefined && (!Number.isSafeInteger(value.samples) || Number(value.samples) < 0 || Number(value.samples) > 16))) return null;
  return { width: Number(value.width), height: Number(value.height), ...(value.samples === undefined ? {} : { samples: Number(value.samples) }) };
}
export function validateVibi3DDocumentBinding(value: unknown): Vibi3DDocumentBinding | null {
  return bag(value) && only(value, ['id', 'revision', 'dirty', 'humanDirty']) && isCreationDocId(value.id)
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 1 && typeof value.dirty === 'boolean'
    && (value.humanDirty === undefined || typeof value.humanDirty === 'boolean')
    ? { id: value.id, revision: Number(value.revision), dirty: value.dirty,
      ...(typeof value.humanDirty === 'boolean' ? { humanDirty: value.humanDirty } : {}) } : null;
}
export function validateVibi3DStageChecks(value: unknown): Vibi3DStageCheck[] | null {
  if (!Array.isArray(value) || value.length > VIBI3D_WORKFLOW_LIMITS.checks) return null;
  for (const check of value) {
    if (!bag(check) || !only(check, ['id', 'status', 'note', 'evidencePath']) || !text(check.id)
      || !['passed', 'failed', 'needs-review'].includes(String(check.status))
      || (check.note !== undefined && !text(check.note, 2000))
      || (check.evidencePath !== undefined && (!text(check.evidencePath, 2000) || check.evidencePath.includes('\\')
        || check.evidencePath.startsWith('/') || check.evidencePath.split('/').includes('..')))) return null;
  }
  return structuredClone(value) as Vibi3DStageCheck[];
}
export function validateVibi3DWorkflowCommand(value: unknown): Vibi3DWorkflowCommand | null {
  if (!bag(value)) return null;
  if (value.type === 'resume') return only(value, ['type', 'runId', 'stage']) && isVibi3DWorkflowId(value.runId)
    && (value.stage === undefined || isVibi3DWorkflowId(value.stage))
    ? { type: 'resume', runId: value.runId, ...(typeof value.stage === 'string' ? { stage: value.stage } : {}) } : null;
  if (value.type === 'propose') return only(value, ['type', 'label']) && text(value.label, 500)
    ? { type: 'propose', label: value.label } : null;
  if (value.type === 'checkpoint') {
    if (!only(value, ['type', 'stage', 'label', 'checks']) || !isVibi3DWorkflowId(value.stage) || !text(value.label, 500)
      || (value.checks !== undefined && !validateVibi3DStageChecks(value.checks))) return null;
    return structuredClone(value) as Extract<Vibi3DWorkflowCommand, { type: 'checkpoint' }>;
  }
  if (value.type !== 'capture' || !only(value, ['type', 'views', 'size', 'aspect', 'mode', 'quality'])) return null;
  if (value.aspect !== undefined && !isVibi3DCameraAspect(value.aspect)) return null;
  if (value.mode !== undefined && !['lit', 'clay', 'wire', 'ao'].includes(String(value.mode))) return null;
  if (value.quality !== undefined && !['draft', 'final'].includes(String(value.quality))) return null;
  if (value.size !== undefined && (!Array.isArray(value.size) || value.size.length !== 2
    || !value.size.every(n => Number.isSafeInteger(n) && n >= 1 && n <= VIBI3D_WORKFLOW_LIMITS.imageDimension)
    || Number(value.size[0]) * Number(value.size[1]) > VIBI3D_WORKFLOW_LIMITS.imagePixels)) return null;
  if (value.views !== undefined) {
    if (!Array.isArray(value.views) || !value.views.length || value.views.length > VIBI3D_WORKFLOW_LIMITS.views) return null;
    for (const view of value.views) {
      if (typeof view === 'string') { if (!text(view)) return null; continue; }
      if (!bag(view)) return null;
      const { name, ...camera } = view;
      if ((name !== undefined && !text(name)) || !validateVibi3DCameraView(camera)) return null;
    }
  }
  const size = value.size as [number, number] | undefined;
  const quality = value.quality ?? VIBI3D_CAPTURE_DEFAULT_QUALITY;
  if (quality === 'final' && size && size[0] * 16 === size[1] * 9 && (size[0] < 1080 || size[1] < 1920)) return null;
  const defaultPixels = quality === 'final' ? 1080 * 1920 : 1080 * 1080;
  if ((size ? size[0] * size[1] : defaultPixels) * (Array.isArray(value.views) ? value.views.length : 1)
    > VIBI3D_WORKFLOW_LIMITS.capturePixels) return null;
  return structuredClone({ ...value, type: 'capture' }) as Vibi3DCaptureCommand;
}

/** Fail closed: transforms, authored data, clips, maps or extra metadata are human content. */
export function isEmptyVibi3DSource(payload: CreationValue): boolean {
  if (!bag(payload) || payload.format !== 'vibi3d' || payload.version !== 1 || !bag(payload.scene)
    || !Array.isArray(payload.clips) || payload.clips.length || payload.generatorCode
    || Object.keys(payload).some(key => !['format', 'version', 'scene', 'clips', 'generatorCode'].includes(key))) return false;
  const scene = payload.scene;
  if (['geometries', 'materials', 'textures', 'images', 'skeletons', 'animations'].some(key => Array.isArray(scene[key]) && scene[key].length)) return false;
  const root = scene.object;
  if (!bag(root) || !['Group', 'Object3D'].includes(String(root.type))
    || Object.keys(root).some(key => !['uuid', 'type', 'name', 'children', 'matrix', 'up', 'layers', 'userData'].includes(key))
    || (root.children !== undefined && (!Array.isArray(root.children) || root.children.length))) return false;
  if (root.matrix !== undefined && JSON.stringify(root.matrix) !== '[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]') return false;
  if (root.up !== undefined && JSON.stringify(root.up) !== '[0,1,0]') return false;
  if (root.layers !== undefined && root.layers !== 1) return false;
  const data = root.userData;
  return data === undefined || (bag(data) && Object.keys(data).every(key => ['vibi3dId', 'vibi3dLighting'].includes(key))
    && (data.vibi3dLighting === undefined || data.vibi3dLighting === 1) && (data.vibi3dId === undefined || text(data.vibi3dId)));
}
