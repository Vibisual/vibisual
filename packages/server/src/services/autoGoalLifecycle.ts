/** Procedure review and reuse evidence live in the original SKILL.md, never a side database. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  AUTO_GOAL_EVIDENCE_FILE_MAX, AUTO_GOAL_EVIDENCE_FILE_BYTES,
  AUTO_GOAL_ASSESSMENT_TTL_MS, AUTO_GOAL_ASSESSMENT_MAX, AUTO_GOAL_COMPLETION_MAX,
  type AutoGoalSkillSummary,
} from '@vibisual/shared';
import { atomicWriteFileSync } from './statePersistence.js';

export type AutoGoalLifecycleStatus = 'candidate' | 'active' | 'needs-review' | 'retired' | 'superseded';
export interface AutoGoalActor { agentId: string; subAgentId: string }
export interface AutoGoalReviewInput {
  skillId: string; revision: string; decision: 'approve' | 'revise' | 'retire' | 'supersede';
  reason: string; applicability?: string; body?: string; files?: string[]; supersededBy?: string;
}
export interface AutoGoalAssessInput { skillId: string; taskKey: string; inputFiles: string[] }
export interface AutoGoalOutcomeInput {
  skillId: string; assessmentId: string; outcome: 'completed' | 'reused' | 'skipped' | 'failed';
  outputFiles?: string[]; evidence: string;
}
export interface AutoGoalAssessment {
  decision: 'review' | 'run' | 'skip' | 'blocked'; revision: string; assessmentId?: string; reason: string;
}
type FileHashes = Record<string, string>;
interface Completion {
  taskKey: string; procedureRevision: string; inputs: FileHashes; outputs: FileHashes;
  evidence: string; completedAt: number; actor: AutoGoalActor;
}
interface Lifecycle {
  version: 1; status: AutoGoalLifecycleStatus; reason: string; applicability?: string;
  reviewedAt?: number; reviewedBy?: AutoGoalActor; supersededBy?: string;
  review?: { fingerprint: string; files: FileHashes; applicability: string };
  reuseCount: number; skipCount: number; failureCount: number; revisionCount: number;
  completions: Completion[];
}
export interface AutoGoalDocument {
  file: string; relativePath: string; text: string; fields: Map<string, string>; body: string; id: string;
}
interface AssessmentToken {
  root: string; skillId: string; actor: AutoGoalActor; revision: string; procedureRevision: string;
  reviewRevision: string;
  taskKey: string; inputs: FileHashes; outputs?: FileHashes; decision: 'run' | 'skip'; expiresAt: number;
  receipt?: { request: string; result: { skill: AutoGoalSkillSummary; idempotent: boolean } };
}
const tokens = new Map<string, AssessmentToken>();
const evidenceHashes = new Map<string, { size: number; mtimeMs: number; ctimeMs: number; hash: string }>();
const LIFECYCLE_FIELD = 'autoGoalLifecycle';
export const AUTO_GOAL_SKILL_DIRS = ['.vibisual/skills', '.vibisual/brain/skills'] as const;
const statuses = new Set<AutoGoalLifecycleStatus>(['candidate', 'active', 'needs-review', 'retired', 'superseded']);

export class AutoGoalLifecycleError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string = code) {
    super(message); this.name = 'AutoGoalLifecycleError';
  }
}
function fail(code: string, message: string, status = 400): never { throw new AutoGoalLifecycleError(status, code, message); }
function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export function autoGoalRevision(text: string): string { return hash(text); }
function validId(id: unknown): id is string {
  return typeof id === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,159}$/u.test(id)
    && !/[. ]$/.test(id) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id);
}
function rootKey(root: string): string {
  try { return fs.realpathSync(root); } catch { return fail('invalid-root', 'Project root is unavailable.'); }
}
/** Reject traversal, alternate streams and every symlink/junction below the project root. */
export function safeAutoGoalPath(root: string, relative: string, allowMissing = false): string {
  if (typeof relative !== 'string' || !relative || /[\x00-\x1f<>"|?*]/.test(relative)
    || path.isAbsolute(relative) || path.win32.isAbsolute(relative) || relative.includes(':')) {
    return fail('unsafe-path', 'Evidence and skill paths must be relative to this project.');
  }
  const pieces = relative.replace(/\\/g, '/').split('/');
  if (pieces.some((s) => !s || s === '.' || s === '..' || /[. ]$/.test(s))) {
    return fail('unsafe-path', 'Traversal and ambiguous paths are not allowed.');
  }
  const base = rootKey(root);
  let current = base;
  for (const piece of pieces) {
    current = path.join(current, piece);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) fail('unsafe-path', 'Symlink evidence and skill paths are not allowed.');
      const real = fs.realpathSync(current);
      const rel = path.relative(base, real);
      if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        fail('unsafe-path', 'Path escapes the project root.');
      }
    } catch (e) {
      if (e instanceof AutoGoalLifecycleError) throw e;
      if (allowMissing && (e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      fail('missing-file', 'A required project file is missing.');
    }
  }
  return current;
}
export function autoGoalSkillRelativePath(id: string, directory: string = AUTO_GOAL_SKILL_DIRS[0]): string {
  if (!validId(id)) return fail('invalid-skill-id', 'Invalid procedure identifier.');
  return `${directory}/${id}/SKILL.md`;
}
export function parseAutoGoalDocument(text: string, id: string, file = '', relativePath = ''): AutoGoalDocument | null {
  if (!validId(id)) return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const colon = line.indexOf(': ');
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 2).trim());
  }
  if (!fields.get('name') || !fields.get('description')) return null;
  // Folder identity owns access. A forged frontmatter ID must not redirect file operations.
  if (fields.has('id') && fields.get('id') !== id) return null;
  return { file, relativePath, text, fields, body: match[2] ?? '', id };
}
export function readAutoGoalDocumentAt(root: string, relativePath: string, id: string): AutoGoalDocument | null {
  try {
    const file = safeAutoGoalPath(root, relativePath);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > AUTO_GOAL_EVIDENCE_FILE_BYTES) return null;
    return parseAutoGoalDocument(fs.readFileSync(file, 'utf8'), id, file, relativePath);
  } catch (e) {
    if (e instanceof AutoGoalLifecycleError && e.code === 'missing-file') return null;
    throw e;
  }
}
export function readAutoGoalDocument(root: string, id: string): AutoGoalDocument | null {
  for (const dir of AUTO_GOAL_SKILL_DIRS) {
    const doc = readAutoGoalDocumentAt(root, autoGoalSkillRelativePath(id, dir), id);
    if (doc) return doc;
  }
  return null;
}
function requiredDocument(root: string, id: string): AutoGoalDocument {
  return readAutoGoalDocument(root, id) ?? fail('skill-not-found', 'Procedure not found.', 404);
}
function nonempty(value: unknown, name: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) return fail('invalid-evidence', `${name} is required and must be bounded.`);
  return value.trim();
}
function actorKey(actor: AutoGoalActor): string {
  return `${nonempty(actor?.agentId, 'agentId', 300)}\0${nonempty(actor?.subAgentId, 'subAgentId', 300)}`;
}
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function isHashes(value: unknown): value is FileHashes {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0 && Object.keys(value).length <= AUTO_GOAL_EVIDENCE_FILE_MAX
    && Object.values(value).every((v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v));
}
function lifecycle(doc: AutoGoalDocument): Lifecycle {
  const oldStatus = doc.fields.get('status');
  const base: Lifecycle = {
    version: 1,
    status: oldStatus === 'retired' || oldStatus === 'superseded' ? oldStatus
      : oldStatus === 'active' || doc.fields.get('verifyState') === 'verified' ? 'needs-review' : 'candidate',
    reason: 'Current procedure and dependency evidence have not been reviewed.',
    reuseCount: 0, skipCount: 0, failureCount: 0, revisionCount: 0, completions: [],
  };
  const raw = doc.fields.get(LIFECYCLE_FIELD);
  if (!raw) return base;
  try {
    const state = JSON.parse(raw) as Partial<Lifecycle>;
    if (state.version !== 1 || !statuses.has(state.status as AutoGoalLifecycleStatus)) return { ...base, status: 'needs-review' };
    const out: Lifecycle = {
      ...base, status: state.status as AutoGoalLifecycleStatus,
      reason: typeof state.reason === 'string' ? state.reason.slice(0, 4000) : base.reason,
      reuseCount: count(state.reuseCount), skipCount: count(state.skipCount),
      failureCount: count(state.failureCount), revisionCount: count(state.revisionCount),
    };
    if (typeof state.applicability === 'string') out.applicability = state.applicability;
    if (typeof state.reviewedAt === 'number') out.reviewedAt = state.reviewedAt;
    if (state.reviewedBy && typeof state.reviewedBy.agentId === 'string' && typeof state.reviewedBy.subAgentId === 'string') out.reviewedBy = state.reviewedBy;
    if (validId(state.supersededBy)) out.supersededBy = state.supersededBy;
    if (state.review && typeof state.review.fingerprint === 'string' && isHashes(state.review.files)
      && typeof state.review.applicability === 'string') out.review = state.review;
    if (Array.isArray(state.completions)) out.completions = state.completions.filter((c): c is Completion =>
      !!c && typeof c.taskKey === 'string' && typeof c.procedureRevision === 'string'
      && isHashes(c.inputs) && isHashes(c.outputs) && typeof c.evidence === 'string'
      && typeof c.completedAt === 'number').slice(-AUTO_GOAL_COMPLETION_MAX);
    // The visible markdown status can close execution, but can never bypass a stored review gate.
    if (oldStatus !== out.status && oldStatus !== 'active') {
      out.status = statuses.has(oldStatus as AutoGoalLifecycleStatus) ? oldStatus as AutoGoalLifecycleStatus : 'needs-review';
      out.reason = 'The procedure status was changed in its source file; review is required before activation.';
      out.completions = [];
    }
    return out;
  } catch { return { ...base, status: 'needs-review', reason: 'Stored review evidence is invalid.' }; }
}
/** Observation counters are not procedure revisions; every instruction and all applicable evidence are. */
function procedureFingerprint(doc: AutoGoalDocument): string {
  const ignored = new Set([LIFECYCLE_FIELD, 'runs', 'updatedAt', 'createdAt', 'status', 'verifyState', 'refCount', 'lastReferencedAt']);
  return hash(JSON.stringify([...doc.fields].filter(([k]) => !ignored.has(k)).sort(([a], [b]) => a.localeCompare(b))) + '\n' + doc.body);
}
function reviewFingerprint(state: Lifecycle): string {
  return hash(JSON.stringify({ review: state.review, applicability: state.applicability,
    reviewedAt: state.reviewedAt, reviewedBy: state.reviewedBy, revisionCount: state.revisionCount }));
}
function serializeDocument(doc: AutoGoalDocument, fields: Map<string, string>, body = doc.body): string {
  return `---\n${[...fields].map(([k, v]) => `${k}: ${v.replace(/\r?\n/g, ' ')}`).join('\n')}\n---\n${body}`;
}
export function patchAutoGoalDocument(root: string, doc: AutoGoalDocument, updates: Record<string, string>, body = doc.body): AutoGoalDocument {
  const file = safeAutoGoalPath(root, doc.relativePath);
  if (autoGoalRevision(fs.readFileSync(file, 'utf8')) !== autoGoalRevision(doc.text)) fail('revision-conflict', 'Procedure changed; read it again before writing.', 409);
  const fields = new Map(doc.fields);
  for (const [key, value] of Object.entries(updates)) fields.set(key, value);
  const text = serializeDocument(doc, fields, body);
  if (Buffer.byteLength(text) > AUTO_GOAL_EVIDENCE_FILE_BYTES) fail('skill-too-large', 'Procedure exceeds the file size limit.');
  atomicWriteFileSync(file, text);
  return parseAutoGoalDocument(text, doc.id, file, doc.relativePath) as AutoGoalDocument;
}
function saveLifecycle(root: string, doc: AutoGoalDocument, state: Lifecycle, body = doc.body, updates: Record<string, string> = {}): AutoGoalDocument {
  return patchAutoGoalDocument(root, doc, { ...updates, [LIFECYCLE_FIELD]: JSON.stringify(state), status: state.status, updatedAt: String(Date.now()) }, body);
}
function snapshotFiles(root: string, paths: unknown, skillPath?: string, useCache = false): FileHashes {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > AUTO_GOAL_EVIDENCE_FILE_MAX
    || paths.some((p) => typeof p !== 'string')) fail('invalid-files', `Supply 1–${AUTO_GOAL_EVIDENCE_FILE_MAX} project files.`);
  const pairs: [string, string][] = [];
  for (const raw of paths as string[]) {
    const relative = raw.replace(/\\/g, '/');
    if (relative === skillPath || AUTO_GOAL_SKILL_DIRS.some((dir) => relative.startsWith(`${dir}/`))) fail('invalid-files', 'Procedure metadata cannot be its own execution evidence.');
    const file = safeAutoGoalPath(root, relative);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > AUTO_GOAL_EVIDENCE_FILE_BYTES) fail('invalid-files', 'Evidence must be a regular file within the size limit.');
    const key = `${rootKey(root)}\0${file}`;
    const cached = useCache ? evidenceHashes.get(key) : undefined;
    const digest = cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs && cached.ctimeMs === stat.ctimeMs
      ? cached.hash : hash(fs.readFileSync(file));
    evidenceHashes.delete(key);
    evidenceHashes.set(key, { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, hash: digest });
    while (evidenceHashes.size > AUTO_GOAL_ASSESSMENT_MAX * 4) evidenceHashes.delete(evidenceHashes.keys().next().value as string);
    pairs.push([relative, digest]);
  }
  pairs.sort(([a], [b]) => a.localeCompare(b));
  if (new Set(pairs.map(([p]) => p)).size !== pairs.length) fail('invalid-files', 'Evidence paths must be unique.');
  return Object.fromEntries(pairs);
}
function equalHashes(a: FileHashes, b: FileHashes): boolean {
  const keys = Object.keys(a).sort();
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}
function stillMatches(root: string, files: FileHashes, useCache = false): boolean {
  try { return equalHashes(files, snapshotFiles(root, Object.keys(files), undefined, useCache)); } catch { return false; }
}
function staleReason(root: string, doc: AutoGoalDocument, state: Lifecycle, useCache = false): string | undefined {
  if (!state.review || !state.applicability?.trim() || !state.reviewedAt) return 'Current review evidence is missing.';
  if (state.review.applicability !== state.applicability) return 'Procedure applicability changed after review.';
  if (state.review.fingerprint !== procedureFingerprint(doc)) return 'Procedure instructions changed after review.';
  if (!stillMatches(root, state.review.files, useCache)) return 'A reviewed dependency changed or is unavailable.';
  return undefined;
}
export function summarizeAutoGoalDocument(root: string | null, doc: AutoGoalDocument, persistStale = true, useEvidenceCache = true): AutoGoalSkillSummary {
  let state = lifecycle(doc);
  if (root && persistStale && doc.fields.has(LIFECYCLE_FIELD)) {
    try {
      const stored = JSON.parse(doc.fields.get(LIFECYCLE_FIELD) as string) as { status?: unknown };
      // Once a manual stop has been observed, changing only the visible marker back cannot revive it.
      if (stored.status !== state.status) doc = saveLifecycle(root, doc, state);
    } catch { /* The derived closed state remains authoritative if persistence is unavailable. */ }
  }
  if (root && state.status === 'active') {
    const reason = staleReason(root, doc, state, useEvidenceCache);
    if (reason) {
      state = { ...state, status: 'needs-review', reason, completions: [] };
      if (persistStale) {
        try { doc = saveLifecycle(root, doc, state); } catch { /* Failure to persist can never activate a stale procedure. */ }
      }
    }
  } else if (!root && state.status === 'active') {
    state = { ...state, status: 'needs-review', reason: 'Dependency evidence has not been checked.' };
  }
  const num = (key: string): number => count(Number(doc.fields.get(key)));
  const files = (doc.fields.get('files') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = doc.fields.get('origin');
  return {
    id: doc.id, name: doc.fields.get('name') as string, description: doc.fields.get('description') as string,
    steps: num('steps'), runs: num('runs'), createdAt: num('createdAt'), updatedAt: num('updatedAt'),
    ...(doc.fields.get('candidateId') ? { candidateId: doc.fields.get('candidateId') as string } : {}),
    ...(files.length ? { files } : {}), ...(origin === 'command' || origin === 'step' ? { origin } : {}),
    status: state.status, reason: state.reason, revision: autoGoalRevision(doc.text),
    ...(doc.relativePath ? { path: doc.relativePath } : {}),
    ...(state.applicability ? { applicability: state.applicability } : {}),
    ...(state.reviewedAt ? { reviewedAt: state.reviewedAt } : {}),
    ...(state.supersededBy ? { supersededBy: state.supersededBy } : {}),
    reuseCount: state.reuseCount, skipCount: state.skipCount, failureCount: state.failureCount, revisionCount: state.revisionCount,
  };
}
function assertRevision(doc: AutoGoalDocument, revision: string): void {
  if (revision !== autoGoalRevision(doc.text)) fail('revision-conflict', 'Procedure changed; fetch and review the current revision.', 409);
}
function archiveRevision(root: string, doc: AutoGoalDocument): void {
  const relative = `${path.posix.dirname(doc.relativePath)}/revisions/${Date.now()}-${autoGoalRevision(doc.text).slice(0, 16)}-${randomUUID().slice(0, 8)}.md`;
  const file = safeAutoGoalPath(root, relative, true);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  safeAutoGoalPath(root, relative, true);
  atomicWriteFileSync(file, doc.text);
}
export function reviewAutoGoalSkill(root: string, input: AutoGoalReviewInput, actor: AutoGoalActor): AutoGoalSkillSummary {
  actorKey(actor);
  const doc = requiredDocument(root, input.skillId);
  assertRevision(doc, input.revision);
  const reason = nonempty(input.reason, 'Review reason');
  if (!['approve', 'revise', 'retire', 'supersede'].includes(input.decision)) fail('invalid-decision', 'Unknown review decision.');
  const previous = lifecycle(doc);
  let state: Lifecycle = { ...previous, reason, completions: [] };
  let body = doc.body;
  const updates: Record<string, string> = {};
  if (input.decision === 'retire' || input.decision === 'supersede') {
    state.status = input.decision === 'retire' ? 'retired' : 'superseded';
    delete state.supersededBy;
    if (input.decision === 'supersede') {
      if (!input.supersededBy || input.supersededBy === doc.id) fail('invalid-replacement', 'Specify a different active replacement procedure.');
      const replacement = summarizeAutoGoalDocument(root, requiredDocument(root, input.supersededBy));
      if (replacement.status !== 'active') fail('invalid-replacement', 'The replacement procedure must have current approved evidence.');
      state.supersededBy = input.supersededBy;
    }
  } else {
    if (input.decision === 'revise') body = nonempty(input.body, 'Revised procedure body', AUTO_GOAL_EVIDENCE_FILE_BYTES);
    else if (input.body !== undefined) fail('invalid-decision', 'Use revise to change procedure instructions.');
    const applicability = nonempty(input.applicability, 'Applicability');
    nonempty(body, 'Procedure body', AUTO_GOAL_EVIDENCE_FILE_BYTES);
    const files = snapshotFiles(root, input.files, doc.relativePath);
    updates.files = Object.keys(files).join(', ');
    const fields = new Map(doc.fields);
    fields.set('files', updates.files);
    const draft = { ...doc, fields, body };
    state = { ...state, status: 'active', applicability, reviewedAt: Date.now(), reviewedBy: actor,
      review: { fingerprint: procedureFingerprint(draft), files, applicability }, revisionCount: previous.revisionCount + 1 };
    delete state.supersededBy;
  }
  archiveRevision(root, doc);
  const saved = saveLifecycle(root, doc, state, body, updates);
  return summarizeAutoGoalDocument(root, saved);
}
export function requestAutoGoalReview(root: string, input: { skillId: string; revision: string; reason: string }, actor: AutoGoalActor): AutoGoalSkillSummary {
  actorKey(actor);
  const doc = requiredDocument(root, input.skillId);
  assertRevision(doc, input.revision);
  const state = { ...lifecycle(doc), status: 'needs-review' as const, reason: nonempty(input.reason, 'Review reason'), completions: [] };
  archiveRevision(root, doc);
  return summarizeAutoGoalDocument(root, saveLifecycle(root, doc, state));
}
export function suspendAutoGoalSkill(root: string, input: { skillId: string; revision: string; reason: string }, actor: AutoGoalActor): AutoGoalSkillSummary {
  return reviewAutoGoalSkill(root, { ...input, decision: 'retire' }, actor);
}
function pruneTokens(): void {
  const now = Date.now();
  for (const [key, token] of tokens) if (token.expiresAt <= now) tokens.delete(key);
  while (tokens.size >= AUTO_GOAL_ASSESSMENT_MAX) tokens.delete(tokens.keys().next().value as string);
}
export function dropAutoGoalAssessments(root: string): void {
  const key = rootKey(root);
  for (const [id, token] of tokens) if (token.root === key) tokens.delete(id);
  for (const file of evidenceHashes.keys()) if (file.startsWith(`${key}\0`)) evidenceHashes.delete(file);
}
export function assessAutoGoalSkill(root: string, input: AutoGoalAssessInput, actor: AutoGoalActor): AutoGoalAssessment {
  actorKey(actor);
  let doc = requiredDocument(root, input.skillId);
  const summary = summarizeAutoGoalDocument(root, doc, true, false);
  const revision = summary.revision as string;
  if (summary.status === 'retired' || summary.status === 'superseded') return { decision: 'blocked', revision, reason: summary.reason ?? 'Procedure is no longer in use.' };
  if (summary.status !== 'active') return { decision: 'review', revision, reason: summary.reason ?? 'Review is required.' };
  const taskKey = nonempty(input.taskKey, 'taskKey', 500);
  const inputs = snapshotFiles(root, input.inputFiles, doc.relativePath);
  doc = requiredDocument(root, input.skillId);
  assertRevision(doc, revision);
  const state = lifecycle(doc);
  const procedureRevision = state.review?.fingerprint as string;
  const completion = [...state.completions].reverse().find((c) => c.taskKey === taskKey && c.procedureRevision === procedureRevision
    && equalHashes(c.inputs, inputs) && stillMatches(root, c.outputs));
  const decision = completion ? 'skip' : 'run';
  pruneTokens();
  const assessmentId = randomUUID();
  tokens.set(assessmentId, { root: rootKey(root), skillId: doc.id, actor: { ...actor }, revision,
    procedureRevision, reviewRevision: reviewFingerprint(state), taskKey, inputs, ...(completion ? { outputs: completion.outputs } : {}),
    decision, expiresAt: Date.now() + AUTO_GOAL_ASSESSMENT_TTL_MS });
  return { decision, revision, assessmentId, reason: completion
    ? 'This task has a confirmed completion with the same reviewed procedure, unchanged inputs and unchanged outputs. Current user instructions still take precedence.'
    : 'No unchanged confirmed completion matches this task and its input files.' };
}
export function recordAutoGoalOutcome(root: string, input: AutoGoalOutcomeInput, actor: AutoGoalActor): { skill: AutoGoalSkillSummary; idempotent: boolean } {
  const actorIdentity = actorKey(actor);
  const token = tokens.get(input.assessmentId);
  if (!token || token.expiresAt <= Date.now()) fail('assessment-expired', 'Assessment is unavailable or expired; assess again.', 409);
  if (token.root !== rootKey(root) || token.skillId !== input.skillId || actorKey(token.actor) !== actorIdentity) fail('assessment-owner', 'Assessment belongs to another procedure, project or session.', 403);
  const evidence = nonempty(input.evidence, 'Outcome evidence');
  const request = hash(JSON.stringify({ ...input, evidence }));
  if (token.receipt) {
    if (token.receipt.request !== request) fail('assessment-used', 'Assessment has already recorded a different outcome.', 409);
    return { ...token.receipt.result, idempotent: true };
  }
  const doc = requiredDocument(root, input.skillId);
  let state = lifecycle(doc);
  // Observation/outcome counters can change during execution. They are not a new instruction revision.
  // The full source revision still protects review writes; execution tokens bind all instructions and review evidence.
  if (state.status !== 'active' || state.review?.fingerprint !== token.procedureRevision
    || procedureFingerprint(doc) !== token.procedureRevision || reviewFingerprint(state) !== token.reviewRevision) {
    summarizeAutoGoalDocument(root, doc, true, false);
    fail('revision-conflict', 'Procedure or review changed after assessment; assess again.', 409);
  }
  if (input.outcome === 'failed') {
    state = { ...state, status: 'needs-review', reason: evidence, failureCount: state.failureCount + 1, completions: [] };
  } else {
    const summary = summarizeAutoGoalDocument(root, doc, true, false);
    if (summary.status !== 'active') fail('review-required', 'Procedure needs review before results can be recorded.', 409);
    if (!stillMatches(root, token.inputs)) fail('inputs-changed', 'Input files changed after assessment; assess the new inputs.', 409);
    if (input.outcome === 'skipped') {
      if (token.decision !== 'skip' || !token.outputs || !stillMatches(root, token.outputs)) fail('skip-not-proven', 'Skipping requires unchanged confirmed outputs.', 409);
      state = { ...state, skipCount: state.skipCount + 1 };
    } else if (input.outcome === 'completed' || input.outcome === 'reused') {
      if (token.decision !== 'run') fail('invalid-outcome', 'This assessment permits reusing existing output; assess a new task before recording execution.', 409);
      const outputs = snapshotFiles(root, input.outputFiles, doc.relativePath);
      const completion: Completion = { taskKey: token.taskKey, procedureRevision: token.procedureRevision,
        inputs: token.inputs, outputs, evidence, actor: { ...actor }, completedAt: Date.now() };
      state = { ...state, reuseCount: state.reuseCount + 1,
        completions: [...state.completions.filter((c) => !(c.taskKey === token.taskKey && equalHashes(c.inputs, token.inputs))), completion].slice(-AUTO_GOAL_COMPLETION_MAX) };
    } else fail('invalid-outcome', 'Unknown outcome.');
  }
  const saved = saveLifecycle(root, doc, state);
  const result = { skill: summarizeAutoGoalDocument(root, saved), idempotent: false };
  token.receipt = { request, result };
  return result;
}
