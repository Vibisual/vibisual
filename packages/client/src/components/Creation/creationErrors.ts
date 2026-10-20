import type { TFunction } from 'i18next';
import { CreationApiError } from './creationApi.js';
import { CreationBlobError } from './creationBlobs.js';

/**
 * §5.13 (R-10) — errors the creation screens show are codes; the screen translates them. Server reasons
 * (`source-too-large`, `revision-conflict` …) and screen-side reasons (`model-busy` …) share one table.
 */
export class CreationUiError extends Error {
  constructor(readonly code: string, readonly params: Record<string, string | number> = {}) { super(code); }
}

/** Every code with a translated sentence under `panel.creation.errors.<camelCase>`. */
export const CREATION_ERROR_CODES = [
  // server
  'source-too-large', 'blob-too-large', 'revision-conflict', 'request-id-reused', 'candidate-conflict', 'candidate-discarded',
  'candidate-limit', 'candidate-overlap', 'stale-base', 'locked-element-changed', 'user-decision-required', 'user-locks-only',
  'mirror-read-only', 'project-not-found', 'source-not-found', 'source-unreadable', 'source-busy', 'invalid-link', 'blob-not-found',
  'lock-target-missing', 'history-empty', 'invalid-payload', 'revision-not-found', 'request-failed', 'output-not-found',
  'blob-upload-failed', 'blob-read-failed', 'candidate-not-found', 'link-not-found', 'invalid-blob', 'invalid-body', 'invalid-id',
  'invalid-links', 'invalid-locks', 'invalid-output-path', 'invalid-parameters', 'invalid-revision', 'invalid-scope', 'invalid-text',
  'outside-project', 'source-io-failed',
  // video server (assets, models, request checks)
  'asset-not-found', 'asset-outside-project', 'media-name-required', 'media-size-invalid', 'model-companion-missing', 'model-invalid',
  'model-dependency-path', 'model-dependency-type', 'invalid-requirements',
  // screens
  'model-not-open', 'model-busy', 'model-changed', 'scene-changed', 'save-before-review', 'select-target', 'object-protected',
  'no-texture-slot', 'no-editable-material', 'no-material-color', 'object-missing', 'invalid-command', 'command-count',
  'command-alone', 'object-id-exists', 'object-limit', 'nothing-to-undo', 'nothing-to-redo', 'invalid-model-source',
  'textures-must-embed', 'source-open-failed', 'source-save-failed', 'source-changed-elsewhere', 'image-source-unavailable',
  'unsupported-image-source', 'unbundled-dependency', 'model-request-failed', 'model-open-failed', 'model-format-unsupported',
  'model-external-resource', 'model-texture-failed', 'model-load-failed', 'model-empty-scene', 'image-decode-failed', 'image-export-failed',
  'image-read-failed', 'image-renderer-unavailable', 'command-expired', 'preview-closed',
  'model-stage-closed', 'model-renderer-unavailable', 'model-asset-missing', 'model-textures-missing', 'image-source-invalid',
  'image-stage-closed', 'model-export-failed', 'output-not-recorded', 'unsupported-source-app', 'root-not-groupable',
  'root-not-deletable', 'select-child', 'rig-geometry-protected', 'rig-structure-protected', 'motion-needs-keys',
  'view-busy', 'capture-failed', 'webgl-context-lost', 'unsupported-media-format', 'glb-export-failed', 'save-failed',
  // Native document-bound authoring. Error codes stay language-independent across both agent transports.
  'vibi3d-source-unavailable', 'vibi3d-window-unavailable', 'vibi3d-session-not-ready', 'vibi3d-workflow-unavailable',
  'unsaved-human-edits', 'capture-shot-not-found', 'capture-ao-unavailable', 'local-transport-network-required',
  'invalid-run-id', 'workflow-unreadable', 'workflow-storage-unavailable', 'run-not-found', 'run-source-mismatch',
  'unsaved-user-edits', 'stage-limit', 'stage-id-conflict', 'run-already-proposed', 'capture-evidence-not-found',
  'candidate-links-must-match-source', 'checkpoint-required', 'invalid-capture', 'capture-too-large', 'capture-id-conflict',
  'document-viewer-exists', 'renderer-owner-required', 'command-not-pending', 'command-type-mismatch', 'run-required',
  'invalid-progress', 'workflow-request-failed', 'stage-not-found',
  'invalid-stats-result', 'command-body-too-large', 'kit-module-missing', 'kit-module-changed', 'kit-nested-module',
  'kit-module-empty', 'kit-instance-transform', 'kit-instance-animation', 'kit-placement-limit', 'kit-source-unsupported',
  'invalid-decal-recipe', 'decal-misses-surface', 'decal-target-mesh-required', 'invalid-mascot-recipe',
  'sign-font-unavailable', 'sign-glyph-missing',
  'camera-shot-missing', 'camera-shot-conflict', 'shot-aspect-mismatch',
] as const;
const KNOWN = new Set<string>(CREATION_ERROR_CODES);

export function creationErrorKey(code: string): string {
  return `panel.creation.errors.${code.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase())}`;
}
export function creationErrorCode(error: unknown): string {
  if (error instanceof CreationUiError || error instanceof CreationApiError || error instanceof CreationBlobError) return error.code;
  if (error instanceof Error && KNOWN.has(error.message)) return error.message;
  return 'unexpected';
}
/** The sentence for an error; unknown failures get a translated generic sentence (the detail stays in the log). */
export function creationErrorText(t: TFunction, error: unknown): string {
  const code = creationErrorCode(error);
  const params = error instanceof CreationUiError ? error.params : {};
  return KNOWN.has(code) ? t(creationErrorKey(code), params) : t('panel.creation.errors.unexpected');
}
