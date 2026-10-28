import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldCleanup } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import {
  CREATION_BLOB_EXTENSIONS,
  CREATION_LIMITS,
  collectCreationBlobNames,
  creationBlobRef,
  creationStableJson,
  creationValueAt,
  isCreationDocId,
  mergeCreationValues,
  parseCreationBlobName,
  parseCreationBlobRef,
  planCreationExternalization,
  type CreationBinary,
  type CreationBlobExt,
  type CreationCandidate,
  type CreationCandidateSummary,
  type CreationDoc,
  type CreationDocSummary,
  type CreationHead,
  type CreationImpact,
  type CreationLink,
  type CreationListFailure,
  type CreationOperation,
  type CreationOutput,
  type CreationValue,
} from '@vibisual/shared';

/**
 * §5.13 (R-10) — editable sources. Disk is authoritative (no module cache), so a reconnect never lets a stale copy overwrite newer work.
 * Layout under `<project>/.vibisual/creation/`: `<doc>/state.json` (current revision metadata, no payload, + ledger; written last) ·
 * `<doc>/previous.json` (ledger before the last change — recovery when state.json is corrupt) · `<doc>/revisions/<n>.json` (immutable; the only copy of each payload) ·
 * `<doc>/candidates/<sha>.json` (proposals; hashed ids never meet case-insensitive FS or Windows device names) · `blobs/<sha256>.<ext>` (immutable, `vibi-blob:<name>`).
 */
export interface CreationHost {
  resolveProjectPath(raw: unknown): string | null;
  atomicWriteFile(file: string, data: string): void;
  warn?(message: string): void;
}
interface Receipt { id: string; digest: string; revision: number }
interface CandidateEntry extends CreationCandidateSummary { file: string; digest: string }
interface Decision { keptRevision: number; at: number }
interface PruneWatch { root: string; changed: boolean }
interface State {
  schemaVersion: 2;
  head: CreationDocSummary;
  undo: number[];
  redo: number[];
  requests: Receipt[];
  outputs: CreationOutput[];
  accepted: number[];
  creationDigest?: string;
  candidates: CandidateEntry[];
  candidateStamp: number;
  decisions: Record<string, Decision>;
  /** Blobs referenced by durable app artifacts outside revisions (for example intermediate runs). */
  artifactBlobs?: Record<string, string[]>;
  artifactLinks?: Record<string, CreationLink[]>;
}
type Input = Record<string, unknown>;
type Author = CreationDoc['author'];

export class CreationError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly doc?: CreationDoc | CreationDocSummary,
    readonly detail?: Record<string, unknown>,
  ) { super(message); }
}

const KEY = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
/** Request, link, candidate and output keys: any case, never used directly as a file name. */
export function creationKey(value: unknown): string {
  if (typeof value !== 'string' || !KEY.test(value)) throw new CreationError(400, 'invalid-id');
  return value;
}
/** Document ids become directory names: lowercase and never a Windows device name. */
export function creationDocId(value: unknown): string {
  if (!isCreationDocId(value)) throw new CreationError(400, 'invalid-id');
  return value;
}
/** Kept for callers that validated ids before the doc/key split. */
export const creationId = creationKey;

function integer(value: unknown, code = 'invalid-revision'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new CreationError(400, code);
  return value;
}
function text(value: unknown, max: number, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new CreationError(400, 'invalid-text');
  return value;
}
function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function json(value: unknown): CreationValue {
  const visit = (v: unknown, depth: number): boolean => depth <= 80 && (v === null || typeof v === 'string' || typeof v === 'boolean'
    || (typeof v === 'number' && Number.isFinite(v)) || (Array.isArray(v) && v.every(x => visit(x, depth + 1)))
    || (typeof v === 'object' && v !== null && !Array.isArray(v)
      && Object.entries(v).every(([k, x]) => !['__proto__', 'constructor', 'prototype'].includes(k) && visit(x, depth + 1))));
  if (!visit(value, 0)) throw new CreationError(400, 'invalid-payload');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > CREATION_LIMITS.payloadBytes) throw new CreationError(413, 'source-too-large');
  return JSON.parse(serialized) as CreationValue;
}
function parameters(value: unknown): Record<string, CreationValue> {
  const result = json(value);
  if (result === null || typeof result !== 'object' || Array.isArray(result)) throw new CreationError(400, 'invalid-parameters');
  return result;
}
function lockedPaths(value: unknown): string[] {
  const bad = (p: unknown): boolean => typeof p !== 'string' || p.length > 1000 || (p !== '' && !p.startsWith('/')) || /~(?![01])/.test(p);
  if (!Array.isArray(value) || value.length > 2000 || value.some(bad)) throw new CreationError(400, 'invalid-locks');
  return [...new Set(value as string[])];
}
function within(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
}
function summary(doc: CreationDoc | CreationDocSummary): CreationDocSummary {
  const { payload: _payload, canUndo: _undo, canRedo: _redo, ...rest } = doc as CreationDoc;
  return rest;
}
function stripLink(link: CreationLink): CreationLink {
  return { id: link.id, sourceId: link.sourceId, sourceRevision: link.sourceRevision, role: link.role, targets: [...link.targets] };
}
function candidateSummary(entry: CandidateEntry): CreationCandidateSummary {
  const { file: _file, digest: _digest, ...rest } = entry;
  return rest;
}
export function isMirrorDocId(id: string): boolean {
  return id.startsWith('mirror-');
}

/** Errors worth a short retry: another handle (antivirus, indexer, our own rename) holds the file for a moment. */
const TRANSIENT = new Set(['EBUSY', 'EPERM', 'EACCES', 'EAGAIN', 'EMFILE', 'ENFILE']);
const READ_RETRIES = 3;
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/** How long after a change the cleanup runs (coalesces bursts of saves into one pass). */
const PRUNE_DELAY_MS = 30_000;
const UNDO_DEPTH = 50;
const HISTORY_LIMIT = 50;

export class CreationStore {
  private readonly pruneTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pruning = new Map<string, Promise<void>>();
  // Only active cleanups are observed; no per-project cache survives a pass. Separate store instances
  // still invalidate one another, because all of them write the same authoritative on-disk documents.
  private static readonly pruneWatches = new Set<PruneWatch>();

  constructor(private readonly host: CreationHost, private readonly now = Date.now) {}

  // ─── paths ──────────────────────────────────────────────────────────────────────────

  private project(projectId: unknown): string {
    const project = this.host.resolveProjectPath(projectId);
    if (!project) throw new CreationError(404, 'project-not-found');
    try { return fs.realpathSync(project); }
    catch { throw new CreationError(404, 'project-not-found'); }
  }
  private under(root: string, ...parts: string[]): string {
    const file = path.join(root, '.vibisual', 'creation', ...parts);
    // Check existing ancestors before mkdir/write as well as existing files. Symlinks cannot leave the project.
    let current = file;
    while (!fs.existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current) throw new CreationError(400, 'outside-project');
      current = parent;
    }
    if (!within(root, fs.realpathSync(current))) throw new CreationError(403, 'outside-project');
    return file;
  }
  private file(projectId: unknown, ...parts: string[]): string {
    return this.under(this.project(projectId), ...parts);
  }
  private invalidatePrunes(file: string, ownWatch?: PruneWatch): void {
    for (const watch of CreationStore.pruneWatches) {
      if (watch !== ownWatch && within(watch.root, file)) watch.changed = true;
    }
  }
  private write(file: string, value: unknown, ownWatch?: PruneWatch): void {
    const data = JSON.stringify(value);
    if (Buffer.byteLength(data) > CREATION_LIMITS.requestBytes * 2) throw new CreationError(413, 'source-too-large');
    this.invalidatePrunes(file, ownWatch);
    this.host.atomicWriteFile(file, data);
  }
  private read<T>(file: string): T {
    for (let attempt = 0; ; attempt += 1) {
      let data: string;
      try {
        if (fs.statSync(file).size > CREATION_LIMITS.requestBytes * 4) throw new CreationError(422, 'source-unreadable');
        data = fs.readFileSync(file, 'utf8');
      } catch (error) {
        if (error instanceof CreationError) throw error;
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (code === 'ENOENT' || code === 'ENOTDIR') throw new CreationError(404, 'source-not-found');
        if (TRANSIENT.has(code) && attempt < READ_RETRIES) { sleepSync(20 * (attempt + 1)); continue; }
        if (TRANSIENT.has(code)) throw new CreationError(503, 'source-busy');
        throw new CreationError(500, 'source-io-failed');
      }
      try { return JSON.parse(data) as T; } catch { throw new CreationError(422, 'source-unreadable'); }
    }
  }

  // ─── state ──────────────────────────────────────────────────────────────────────────

  /** Accepts the previous ledger shape (payload inside, candidate files named by id) and upgrades it in memory. */
  private upgrade(raw: unknown, id: string, dir: string): State {
    const value = raw as Partial<State> & { schemaVersion?: number; doc?: CreationDoc; acceptedCandidates?: string[] };
    const valid = (n: unknown): boolean => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
    if (value?.schemaVersion === 2) {
      const head = value.head;
      if (!head || head.id !== id || !valid(head.revision) || !Array.isArray(value.undo) || !Array.isArray(value.redo)
        || !Array.isArray(value.requests) || !Array.isArray(value.candidates)) throw new CreationError(422, 'source-unreadable');
      return {
        ...value, head: { ...head, links: (head.links ?? []).map(stripLink) }, outputs: value.outputs ?? [],
        accepted: value.accepted ?? [head.revision], candidateStamp: value.candidateStamp ?? 0, decisions: value.decisions ?? {},
      } as State;
    }
    const doc = value?.doc;
    if (value?.schemaVersion !== 1 || !doc || doc.id !== id || doc.schemaVersion !== 1 || !valid(doc.revision)
      || !Array.isArray(value.undo) || !Array.isArray(value.redo) || !Array.isArray(value.requests)) throw new CreationError(422, 'source-unreadable');
    const accepted = new Set(value.acceptedCandidates ?? []);
    const candidates: CandidateEntry[] = [];
    const folder = path.join(dir, 'candidates');
    if (fs.existsSync(folder)) {
      for (const name of fs.readdirSync(folder).filter(n => n.endsWith('.json'))) {
        try {
          const c = this.read<CreationCandidate>(path.join(folder, name));
          const status = accepted.has(c.id) ? 'accepted' : c.status;
          candidates.push({ id: c.id, file: name, baseRevision: c.baseRevision, label: c.label, input: c.input, createdAt: c.createdAt, status,
            digest: sha256(creationStableJson([c.baseRevision, c.payload, c.label, c.input])) });
        } catch { /* An unreadable legacy proposal is skipped; the source itself stays readable. */ }
      }
    }
    return {
      schemaVersion: 2, head: { ...summary(doc), links: doc.links.map(stripLink) }, undo: value.undo, redo: value.redo,
      requests: value.requests, outputs: value.outputs ?? [], accepted: value.accepted ?? Array.from({ length: doc.revision }, (_, i) => i + 1),
      ...(value.creationDigest ? { creationDigest: value.creationDigest } : {}), candidates, candidateStamp: 0, decisions: {},
    };
  }
  private state(projectId: unknown, id: string): State {
    creationDocId(id);
    const dir = this.file(projectId, id);
    const load = (name: string): State => this.upgrade(this.read<unknown>(path.join(dir, name)), id, dir);
    try { return load('state.json'); } catch (error) {
      // Only damage (or a missing pointer) falls back; a busy file is reported, never silently replaced by older data.
      if (!(error instanceof CreationError) || (error.status !== 422 && error.status !== 404)) throw error;
      try { return load('previous.json'); } catch { throw error; }
    }
  }
  private revisionFile(projectId: unknown, id: string, revision: number): string {
    return this.file(projectId, id, 'revisions', `${revision}.json`);
  }
  private readRevision(projectId: unknown, id: string, revision: number): CreationDoc {
    const doc = this.read<CreationDoc>(this.revisionFile(projectId, id, revision));
    if (doc.id !== id || doc.revision !== revision || doc.schemaVersion !== 1) throw new CreationError(422, 'source-unreadable');
    return { ...doc, links: (doc.links ?? []).map(stripLink) };
  }
  private annotate(state: State, links: CreationLink[]): CreationLink[] {
    return links.map(link => {
      const decision = state.decisions[link.id];
      return decision && decision.keptRevision > link.sourceRevision ? { ...link, keptRevision: decision.keptRevision } : { ...link };
    });
  }
  private view(state: State, payload: CreationValue): CreationDoc {
    return { ...state.head, payload, links: this.annotate(state, state.head.links), canUndo: state.undo.length > 0, canRedo: state.redo.length > 0 };
  }
  private summaryView(state: State): CreationDocSummary {
    return { ...state.head, links: this.annotate(state, state.head.links), canUndo: state.undo.length > 0, canRedo: state.redo.length > 0 };
  }
  private current(projectId: unknown, state: State): CreationDoc {
    return this.readRevision(projectId, state.head.id, state.head.revision);
  }
  private writeState(projectId: unknown, state: State): void {
    this.write(this.file(projectId, state.head.id, 'state.json'), state);
  }
  private assertWritable(id: string, internal = false): void {
    if (!internal && isMirrorDocId(id)) throw new CreationError(403, 'mirror-read-only');
  }

  // ─── reads ──────────────────────────────────────────────────────────────────────────

  get(projectId: unknown, id: string): CreationDoc {
    const state = this.state(projectId, id);
    return this.view(state, this.current(projectId, state).payload);
  }
  head(projectId: unknown, id: string): CreationHead {
    const state = this.state(projectId, id);
    return {
      id: state.head.id, appId: state.head.appId, revision: state.head.revision, updatedAt: state.head.updatedAt,
      candidateStamp: state.candidateStamp, pendingCandidates: state.candidates.filter(c => c.status === 'pending').length,
    };
  }
  summary(projectId: unknown, id: string): CreationDocSummary {
    return this.summaryView(this.state(projectId, id));
  }
  revision(projectId: unknown, id: string, revision: number): CreationDoc {
    const state = this.state(projectId, creationDocId(id));
    if (integer(revision) > state.head.revision || !state.accepted.includes(revision)) throw new CreationError(404, 'revision-not-found');
    return this.readRevision(projectId, id, revision);
  }
  private revisionExists(projectId: unknown, id: string, revision: number): boolean {
    try {
      const state = this.state(projectId, id);
      return revision <= state.head.revision && state.accepted.includes(revision) && fs.existsSync(this.revisionFile(projectId, id, revision));
    } catch (error) {
      if (error instanceof CreationError && error.status === 404) return false;
      throw error;
    }
  }
  private docIds(projectId: unknown): string[] {
    const root = this.file(projectId);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() && isCreationDocId(e.name) && e.name !== 'blobs').map(e => e.name);
  }
  /** Payload-free summaries; documents that could not be read are reported, not hidden. */
  listWithFailures(projectId: unknown): { docs: CreationDocSummary[]; failed: CreationListFailure[] } {
    const docs: CreationDocSummary[] = [];
    const failed: CreationListFailure[] = [];
    for (const id of this.docIds(projectId)) {
      try { docs.push(this.summary(projectId, id)); } catch (error) {
        failed.push({ id, error: error instanceof CreationError ? error.message : 'source-unreadable' });
      }
    }
    docs.sort((a, b) => b.updatedAt - a.updatedAt);
    return { docs, failed };
  }
  list(projectId: unknown): CreationDocSummary[] {
    return this.listWithFailures(projectId).docs;
  }
  history(projectId: unknown, id: string): CreationDocSummary[] {
    const state = this.state(projectId, id);
    const result: CreationDocSummary[] = [];
    for (const revision of [...state.accepted].reverse()) {
      if (result.length >= HISTORY_LIMIT) break;
      try { result.push(summary(this.readRevision(projectId, id, revision))); } catch (error) {
        // A cleaned-up revision simply leaves the list; anything else is a real failure.
        if (!(error instanceof CreationError && error.status === 404)) throw error;
      }
    }
    return result;
  }

  // ─── links ──────────────────────────────────────────────────────────────────────────

  private links(projectId: unknown, id: string, value: unknown, previous: CreationLink[] | null, author: Author): CreationLink[] {
    if (!Array.isArray(value) || value.length > CREATION_LIMITS.links) throw new CreationError(400, 'invalid-links');
    const seen = new Set<string>();
    const before = new Map((previous ?? []).map(link => [link.id, link]));
    return value.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CreationError(400, 'invalid-link');
      const link = raw as Input;
      const key = creationKey(link.id);
      const sourceId = creationDocId(link.sourceId);
      const sourceRevision = integer(link.sourceRevision);
      const targets = link.targets;
      if (seen.has(key) || sourceId === id || !Array.isArray(targets) || targets.length > 1000
        || targets.some(t => typeof t !== 'string' || t.length > 256)) throw new CreationError(400, 'invalid-link');
      seen.add(key);
      const old = before.get(key);
      // Moving an existing reference to another revision is the user's decision (update / keep).
      if (author === 'agent' && old && (old.sourceId !== sourceId || old.sourceRevision !== sourceRevision)) {
        throw new CreationError(403, 'user-decision-required', undefined, { linkId: key });
      }
      if (!this.revisionExists(projectId, sourceId, sourceRevision)) throw new CreationError(400, 'invalid-link', undefined, { linkId: key });
      return { id: key, sourceId, sourceRevision, role: text(link.role, 128), targets: [...new Set(targets as string[])] };
    });
  }
  /** "Keep the version I use": recorded in the ledger only — this document's revision does not change. */
  decide(projectId: unknown, id: string, linkId: string, keptRevision: number | null): CreationDoc {
    const state = this.state(projectId, id);
    const link = state.head.links.find(item => item.id === creationKey(linkId));
    if (!link) throw new CreationError(404, 'link-not-found');
    if (keptRevision === null) delete state.decisions[link.id];
    else {
      const latest = this.state(projectId, link.sourceId).head.revision;
      if (integer(keptRevision) <= link.sourceRevision || keptRevision > latest) throw new CreationError(400, 'invalid-revision');
      state.decisions[link.id] = { keptRevision, at: this.now() };
    }
    this.writeState(projectId, state);
    return this.view(state, this.current(projectId, state).payload);
  }

  // ─── blobs ──────────────────────────────────────────────────────────────────────────

  private blobFile(projectId: unknown, name: string): string {
    if (!parseCreationBlobName(name)) throw new CreationError(400, 'invalid-blob');
    return this.file(projectId, 'blobs', name);
  }
  /** Content-addressed: the same bytes always become the same file, written once. */
  async putBlob(projectId: unknown, binary: CreationBinary): Promise<string> {
    if (!CREATION_BLOB_EXTENSIONS.includes(binary.ext)) throw new CreationError(400, 'invalid-blob');
    if (binary.bytes.length > CREATION_LIMITS.blobBytes) throw new CreationError(413, 'blob-too-large');
    const size = binary.ext === 'f64' ? 8 : binary.ext === 'u32' || binary.ext === 'f32' ? 4 : 1;
    if (binary.bytes.length % size !== 0) throw new CreationError(400, 'invalid-blob');
    const name = `${sha256(binary.bytes)}.${binary.ext}`;
    const file = this.blobFile(projectId, name);
    if (fs.existsSync(file)) { this.touch(file); return creationBlobRef(name); }
    this.invalidatePrunes(file);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temp, binary.bytes);
      await fsp.rename(temp, file);
      this.invalidatePrunes(file);
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => undefined);
      // A concurrent writer of the same content may have published it first.
      if (!fs.existsSync(file)) throw error;
    }
    return creationBlobRef(name);
  }
  blobPath(projectId: unknown, name: string): string {
    const file = this.blobFile(projectId, name);
    if (!fs.existsSync(file)) throw new CreationError(404, 'blob-not-found');
    return file;
  }
  /** Reusing an existing blob restarts its cleanup grace, so a commit about to reference it never loses it. */
  private touch(file: string): void {
    this.invalidatePrunes(file);
    const at = new Date(this.now());
    try { fs.utimesSync(file, at, at); } catch { /* Best effort: the grace period is a safety margin, not a lock. */ }
  }
  missingBlobs(projectId: unknown, names: unknown): string[] {
    if (!Array.isArray(names) || names.length > 10_000) throw new CreationError(400, 'invalid-blob');
    return names.filter((name): name is string => {
      if (!parseCreationBlobName(name)) throw new CreationError(400, 'invalid-blob');
      const file = this.blobFile(projectId, name);
      if (!fs.existsSync(file)) return true;
      this.touch(file);
      return false;
    });
  }
  /** Moves inline binaries an agent sent (data URLs, long numeric arrays) into blobs; same rule as the app screens. */
  async externalize(projectId: unknown, value: unknown): Promise<unknown> {
    if (value === undefined || value === null || typeof value !== 'object') return value;
    const plan = planCreationExternalization(value as CreationValue);
    for (const job of plan.jobs) job.assign(await this.putBlob(projectId, job.input));
    return plan.root;
  }
  private checkBlobs(projectId: unknown, value: CreationValue): void {
    for (const name of collectCreationBlobNames(value)) {
      if (!fs.existsSync(this.blobFile(projectId, name))) throw new CreationError(400, 'blob-not-found', undefined, { blob: name });
    }
  }
  private payload(projectId: unknown, value: unknown): CreationValue {
    const result = json(value);
    this.checkBlobs(projectId, result);
    return result;
  }

  // ─── writes ─────────────────────────────────────────────────────────────────────────

  create(projectId: unknown, input: Input, author: Author, fixedId?: string, operation: CreationOperation = 'create'): CreationDoc {
    const requestId = input.requestId === undefined ? undefined : creationKey(input.requestId);
    const appId = creationKey(input.appId);
    const creationDigest = requestId ? sha256(creationStableJson({ ...input, links: input.links ?? [] })) : undefined;
    const id = fixedId ? creationDocId(fixedId)
      : requestId ? `source-${sha256(`${appId}:${requestId}`).slice(0, 40)}` : randomUUID();
    const dir = this.file(projectId, id);
    if (fs.existsSync(path.join(dir, 'state.json')) || fs.existsSync(path.join(dir, 'previous.json'))) {
      const previous = this.state(projectId, id);
      if (!requestId || previous.creationDigest !== creationDigest) throw new CreationError(409, 'request-id-reused', this.summaryView(previous));
      return this.view(previous, this.current(projectId, previous).payload);
    }
    const at = this.now();
    const doc: CreationDoc = {
      schemaVersion: 1, id, appId, title: text(input.title, 500), revision: 1,
      payload: this.payload(projectId, input.payload),
      parameters: input.parameters === undefined ? {} : parameters(input.parameters),
      lockedPaths: input.lockedPaths === undefined ? [] : lockedPaths(input.lockedPaths),
      links: input.links === undefined ? [] : this.links(projectId, id, input.links, null, author),
      createdAt: at, updatedAt: at, label: text(input.label, 500), operation, author,
    };
    this.checkLocksExist(doc);
    this.write(this.file(projectId, id, 'revisions', '1.json'), doc);
    const state: State = {
      schemaVersion: 2, head: summary(doc), undo: [], redo: [], requests: [], outputs: [], accepted: [1],
      ...(creationDigest ? { creationDigest } : {}), candidates: [], candidateStamp: 0, decisions: {},
    };
    this.writeState(projectId, state);
    return this.view(state, doc.payload);
  }
  private checkLocksExist(doc: CreationDoc): void {
    if (doc.lockedPaths.some(pointer => creationValueAt(doc.payload, pointer) === undefined)) throw new CreationError(400, 'lock-target-missing');
  }
  private guard(state: State, input: Input, operation: string): { receipt: Receipt; replay?: true } {
    const id = creationKey(input.requestId);
    const digest = sha256(creationStableJson({ ...input, operation }));
    const existing = state.requests.find(r => r.id === id);
    if (existing) {
      if (existing.digest !== digest) throw new CreationError(409, 'request-id-reused', this.summaryView(state));
      // Returning current state prevents a retried old operation from moving the editor backwards.
      return { receipt: existing, replay: true };
    }
    if (integer(input.baseRevision) !== state.head.revision) throw new CreationError(409, 'revision-conflict', this.summaryView(state));
    return { receipt: { id, digest, revision: state.head.revision } };
  }
  private save(
    projectId: unknown, state: State, previous: CreationDoc, next: CreationDoc, receipt: Receipt,
    history: 'commit' | 'undo' | 'redo', after?: (state: State) => void,
  ): CreationDoc {
    this.write(this.file(projectId, previous.id, 'previous.json'), state);
    // A failed pointer publish may leave a complete orphan revision. Never overwrite that recovery evidence.
    const dir = this.file(projectId, previous.id, 'revisions');
    const latest = fs.readdirSync(dir).reduce((max, name) => /^\d+\.json$/.test(name) ? Math.max(max, Number(name.slice(0, -5))) : max, previous.revision);
    const doc: CreationDoc = { ...next, id: previous.id, appId: previous.appId, revision: latest + 1, createdAt: previous.createdAt, updatedAt: this.now() };
    if (history === 'commit') { state.undo.push(previous.revision); state.redo = []; }
    if (history === 'undo') { state.undo.pop(); state.redo.push(previous.revision); }
    if (history === 'redo') { state.redo.pop(); state.undo.push(previous.revision); }
    state.undo = state.undo.slice(-UNDO_DEPTH);
    state.redo = state.redo.slice(-UNDO_DEPTH);
    // A decision belongs to the exact reference it was made for.
    for (const linkId of Object.keys(state.decisions)) {
      const old = previous.links.find(l => l.id === linkId);
      const now = doc.links.find(l => l.id === linkId);
      if (!old || !now || old.sourceId !== now.sourceId || old.sourceRevision !== now.sourceRevision) delete state.decisions[linkId];
    }
    state.head = summary(doc);
    state.accepted = [...state.accepted, doc.revision];
    state.requests = [...state.requests, { ...receipt, revision: doc.revision }].slice(-CREATION_LIMITS.requestHistory);
    after?.(state);
    this.write(this.file(projectId, doc.id, 'revisions', `${doc.revision}.json`), doc);
    // Publish pointer last. A failed write leaves the last accepted source and its history intact.
    this.writeState(projectId, state);
    this.schedulePrune(projectId);
    return this.view(state, doc.payload);
  }
  commit(
    projectId: unknown, id: string, input: Input, author: Author,
    options: { operation?: CreationOperation; internal?: boolean; after?: (state: State) => void } = {},
  ): CreationDoc {
    this.assertWritable(id, options.internal);
    const state = this.state(projectId, id);
    const { receipt, replay } = this.guard(state, input, 'commit');
    if (replay) return this.view(state, this.current(projectId, state).payload);
    const old = this.current(projectId, state);
    const next: CreationDoc = {
      ...old,
      payload: input.payload === undefined ? old.payload : this.payload(projectId, input.payload),
      title: text(input.title, 500, old.title),
      parameters: input.parameters === undefined ? old.parameters : parameters(input.parameters),
      lockedPaths: input.lockedPaths === undefined ? old.lockedPaths : lockedPaths(input.lockedPaths),
      links: input.links === undefined ? old.links : this.links(projectId, id, input.links, old.links, author),
      label: text(input.label, 500), operation: options.operation ?? 'commit', author,
    };
    delete next.restoredFrom;
    if (author === 'agent' && creationStableJson(next.lockedPaths) !== creationStableJson(old.lockedPaths)) throw new CreationError(403, 'user-locks-only');
    for (const pointer of old.lockedPaths) {
      if (author === 'user' && !next.lockedPaths.includes(pointer)) continue;
      if (creationStableJson(creationValueAt(old.payload, pointer)) !== creationStableJson(creationValueAt(next.payload, pointer))) {
        throw new CreationError(409, 'locked-element-changed', this.summaryView(state), { pointer });
      }
    }
    this.checkLocksExist(next);
    const same = (doc: CreationDoc): string => creationStableJson([doc.payload, doc.parameters, doc.lockedPaths, doc.links, doc.title]);
    if (same(old) === same(next)) {
      options.after?.(state);
      state.requests = [...state.requests, receipt].slice(-CREATION_LIMITS.requestHistory);
      this.writeState(projectId, state);
      return this.view(state, old.payload);
    }
    return this.save(projectId, state, old, next, receipt, 'commit', options.after);
  }
  restore(projectId: unknown, id: string, input: Input, operation: 'undo' | 'redo' | 'restore', author: Author): CreationDoc {
    this.assertWritable(id);
    const state = this.state(projectId, id);
    const { receipt, replay } = this.guard(state, input, operation);
    if (replay) return this.view(state, this.current(projectId, state).payload);
    const revision = operation === 'restore' ? integer(input.revision) : (operation === 'undo' ? state.undo : state.redo).at(-1);
    if (!revision) throw new CreationError(409, 'history-empty', this.summaryView(state));
    const source = this.revision(projectId, id, revision);
    const old = this.current(projectId, state);
    return this.save(projectId, state, old, { ...source, author, label: '', operation, restoredFrom: revision }, receipt,
      operation === 'restore' ? 'commit' : operation);
  }

  // ─── candidates ─────────────────────────────────────────────────────────────────────

  candidates(projectId: unknown, id: string): CreationCandidateSummary[] {
    return this.state(projectId, id).candidates.map(candidateSummary).sort((a, b) => b.createdAt - a.createdAt);
  }
  private entry(state: State, candidateId: string): CandidateEntry {
    const entry = state.candidates.find(c => c.id === creationKey(candidateId));
    if (!entry) throw new CreationError(404, 'candidate-not-found');
    return entry;
  }
  private candidateBody(projectId: unknown, id: string, entry: CandidateEntry): CreationCandidate {
    const stored = this.read<CreationCandidate>(this.file(projectId, id, 'candidates', entry.file));
    if (stored.id !== entry.id) throw new CreationError(422, 'source-unreadable');
    return { ...candidateSummary(entry), payload: stored.payload, ...(stored.links === undefined ? {} : { links: stored.links }) };
  }
  candidate(projectId: unknown, id: string, candidateId: string): CreationCandidate {
    const state = this.state(projectId, id);
    return this.candidateBody(projectId, id, this.entry(state, candidateId));
  }
  private addCandidate(projectId: unknown, state: State, candidate: CreationCandidate, digest: string): CreationCandidateSummary {
    const file = `${sha256(candidate.id).slice(0, 40)}.json`;
    this.write(this.file(projectId, state.head.id, 'candidates', file), candidate);
    const { payload: _payload, ...rest } = candidate;
    const entry: CandidateEntry = { ...rest, file, digest };
    state.candidates = [...state.candidates.filter(c => c.id !== candidate.id), entry];
    state.candidateStamp += 1;
    return candidateSummary(entry);
  }
  propose(projectId: unknown, id: string, input: Input): CreationCandidateSummary {
    this.assertWritable(id);
    const state = this.state(projectId, id);
    const key = creationKey(input.requestId);
    const baseRevision = integer(input.baseRevision);
    const payload = this.payload(projectId, input.payload);
    const label = text(input.label, 500);
    const request = text(input.input, 20000);
    const links = input.links === undefined ? undefined : this.links(projectId, id, input.links,
      baseRevision === state.head.revision ? state.head.links : this.revision(projectId, id, baseRevision).links, 'agent');
    const digest = sha256(creationStableJson([baseRevision, payload, label, request, ...(links === undefined ? [] : [links])]));
    const existing = state.candidates.find(c => c.id === key);
    if (existing) {
      if (existing.digest !== digest) throw new CreationError(409, 'request-id-reused', this.summaryView(state));
      return candidateSummary(existing);
    }
    if (baseRevision !== state.head.revision) {
      throw new CreationError(409, 'stale-base', this.summaryView(state), {
        currentRevision: state.head.revision,
        reason: 'The source changed after you read it. Read the latest revision, keep the newer human edits, and propose again.',
      });
    }
    // A proposal that changes what the user locked is refused here, not first at acceptance. The head is read only
    // when something is locked.
    if (state.head.lockedPaths.length) {
      const head = this.current(projectId, state);
      for (const pointer of head.lockedPaths) {
        if (creationStableJson(creationValueAt(head.payload, pointer)) !== creationStableJson(creationValueAt(payload, pointer))) {
          throw new CreationError(409, 'locked-element-changed', this.summaryView(state), {
            pointer, reason: 'The user locked this part. Keep it exactly as in the latest revision and propose again.',
          });
        }
      }
    }
    const pending = state.candidates.filter(c => c.status === 'pending').length;
    if (pending >= CREATION_LIMITS.candidates) {
      throw new CreationError(409, 'candidate-limit', this.summaryView(state), {
        limit: CREATION_LIMITS.candidates, pending,
        reason: `This source already has ${pending} pending candidates. Ask the user to review, discard or clean up old candidates in the app before proposing again.`,
      });
    }
    const candidate: CreationCandidate = { id: key, baseRevision, payload, ...(links === undefined ? {} : { links }), label, input: request, createdAt: this.now(), status: 'pending' };
    const result = this.addCandidate(projectId, state, candidate, digest);
    this.writeState(projectId, state);
    return result;
  }
  accept(projectId: unknown, id: string, candidateId: string, input: Input): CreationDoc {
    this.assertWritable(id);
    const state = this.state(projectId, id);
    const entry = this.entry(state, candidateId);
    if (entry.status === 'accepted') return this.view(state, this.current(projectId, state).payload);
    if (entry.status === 'discarded') throw new CreationError(409, 'candidate-discarded');
    // A user edit after proposal must survive, even if the caller supplies today's baseRevision.
    // (A stale candidate can still be moved onto the new revision with rebase.)
    if (entry.baseRevision !== state.head.revision) throw new CreationError(409, 'candidate-conflict', this.summaryView(state));
    const body = this.candidateBody(projectId, id, entry);
    const mark = (s: State): void => {
      s.candidates = s.candidates.map(c => c.id === entry.id ? { ...c, status: 'accepted', decidedAt: this.now() } : c);
      s.candidateStamp += 1;
    };
    return this.commit(projectId, id, { ...input, candidateId, payload: body.payload, ...(body.links === undefined ? {} : { links: body.links }), label: entry.label }, 'user', { operation: 'accept', after: mark });
  }
  discard(projectId: unknown, id: string, candidateId: string): CreationCandidateSummary {
    this.assertWritable(id);
    const state = this.state(projectId, id);
    const entry = this.entry(state, candidateId);
    if (entry.status === 'pending') {
      state.candidates = state.candidates.map(c => c.id === entry.id ? { ...c, status: 'discarded', decidedAt: this.now() } : c);
      state.candidateStamp += 1;
      this.writeState(projectId, state);
    }
    return candidateSummary(state.candidates.find(c => c.id === entry.id)!);
  }
  /** Discards every pending candidate built on an older revision ('stale') or all of them. */
  discardPending(projectId: unknown, id: string, scope: unknown): number {
    this.assertWritable(id);
    if (scope !== 'stale' && scope !== 'all') throw new CreationError(400, 'invalid-scope');
    const state = this.state(projectId, id);
    let count = 0;
    const at = this.now();
    state.candidates = state.candidates.map(c => {
      if (c.status !== 'pending' || (scope === 'stale' && c.baseRevision >= state.head.revision)) return c;
      count += 1;
      return { ...c, status: 'discarded', decidedAt: at };
    });
    if (count) { state.candidateStamp += 1; this.writeState(projectId, state); }
    return count;
  }
  /** Moves a stale candidate onto the current revision when its change does not overlap later edits (3-way). */
  rebase(projectId: unknown, id: string, candidateId: string, input: Input): CreationCandidateSummary {
    this.assertWritable(id);
    const state = this.state(projectId, id);
    const key = creationKey(input.requestId);
    const already = state.candidates.find(c => c.id === key);
    if (already) {
      if (already.rebasedFrom !== candidateId) throw new CreationError(409, 'request-id-reused', this.summaryView(state));
      return candidateSummary(already);
    }
    const entry = this.entry(state, candidateId);
    if (entry.status !== 'pending') throw new CreationError(409, 'candidate-discarded');
    if (entry.baseRevision === state.head.revision) return candidateSummary(entry);
    const base = this.revision(projectId, id, entry.baseRevision);
    const ours = this.current(projectId, state);
    const theirs = this.candidateBody(projectId, id, entry);
    const merged = mergeCreationValues(base.payload, ours.payload, theirs.payload);
    if (!merged.ok) throw new CreationError(409, 'candidate-overlap', this.summaryView(state), { conflicts: merged.conflicts.slice(0, 50) });
    let links: CreationLink[] | undefined;
    if (theirs.links !== undefined) {
      const linked = mergeCreationValues(json(base.links), json(ours.links), json(theirs.links));
      if (!linked.ok) throw new CreationError(409, 'candidate-overlap', this.summaryView(state), { conflicts: linked.conflicts.map(pointer => `/links${pointer}`).slice(0, 50) });
      links = this.links(projectId, id, linked.value, ours.links, 'user');
    }
    for (const pointer of ours.lockedPaths) {
      if (creationStableJson(creationValueAt(ours.payload, pointer)) !== creationStableJson(creationValueAt(merged.value, pointer))) {
        throw new CreationError(409, 'locked-element-changed', this.summaryView(state), { pointer });
      }
    }
    const at = this.now();
    const candidate: CreationCandidate = {
      id: key, baseRevision: state.head.revision, payload: merged.value, label: entry.label, input: entry.input,
      ...(links === undefined ? {} : { links }),
      createdAt: at, status: 'pending', rebasedFrom: entry.id,
    };
    state.candidates = state.candidates.map(c => c.id === entry.id ? { ...c, status: 'discarded', decidedAt: at } : c);
    const result = this.addCandidate(projectId, state, candidate,
      sha256(creationStableJson([candidate.baseRevision, candidate.payload, candidate.label, candidate.input, ...(links === undefined ? [] : [links])])));
    this.writeState(projectId, state);
    return result;
  }

  // ─── outputs ────────────────────────────────────────────────────────────────────────

  outputs(projectId: unknown, id: string): CreationOutput[] { return this.state(projectId, id).outputs ?? []; }
  retainArtifactBlobs(projectId: unknown, id: string, artifactId: string, payload: CreationValue, links?: CreationLink[]): void {
    this.assertWritable(id);
    const state = this.state(projectId, id);
    const names = new Set<string>(); collectCreationBlobNames(payload, names);
    for (const name of names) this.blobPath(projectId, name);
    state.artifactBlobs = { ...state.artifactBlobs, [creationKey(artifactId)]: [...names] };
    if (links) state.artifactLinks = { ...state.artifactLinks, [creationKey(artifactId)]: this.links(projectId, id, links, state.head.links, 'agent') };
    this.writeState(projectId, state);
  }
  validateArtifactPayload(projectId: unknown, payload: unknown): CreationValue { return this.payload(projectId, payload); }
  validateArtifactLinks(projectId: unknown, id: string, links: unknown): CreationLink[] {
    return this.links(projectId, id, links, this.state(projectId, id).head.links, 'agent');
  }
  /** Source-less app drafts can pin binaries and immutable references before a document exists. */
  validateDraftLinks(projectId: unknown, documentId: string | undefined, links: unknown): CreationLink[] {
    return this.links(projectId, documentId ?? '', links, [], 'user');
  }
  retainProjectArtifact(projectId: unknown, artifactId: string, payload: CreationValue, links: CreationLink[]): void {
    const names = [...collectCreationBlobNames(payload)];
    for (const name of names) this.blobPath(projectId, name);
    const pinned = this.validateDraftLinks(projectId, undefined, links);
    this.write(this.file(projectId, '.artifacts', `${creationKey(artifactId)}.json`), { schemaVersion: 1, names, links: pinned });
  }
  releaseProjectArtifact(projectId: unknown, artifactId: string): void {
    const file = this.file(projectId, '.artifacts', `${creationKey(artifactId)}.json`);
    this.invalidatePrunes(file);
    fs.rmSync(file, { force: true });
  }
  output(projectId: unknown, id: string, input: Input): CreationOutput {
    this.assertWritable(id);
    const state = this.state(projectId, id);
    const sourceRevision = integer(input.sourceRevision);
    this.revision(projectId, id, sourceRevision);
    const root = this.project(projectId);
    const relative = text(input.path, 2000);
    if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..')) throw new CreationError(400, 'invalid-output-path');
    const file = path.resolve(root, relative);
    if (!fs.existsSync(file) || !within(root, fs.realpathSync(file)) || !fs.statSync(file).isFile()) throw new CreationError(400, 'output-not-found');
    const output: CreationOutput = { id: creationKey(input.requestId), sourceRevision, path: relative, mediaType: text(input.mediaType, 100), createdAt: this.now() };
    const old = state.outputs.find(o => o.id === output.id);
    if (old) {
      if (old.sourceRevision !== sourceRevision || old.path !== relative || old.mediaType !== output.mediaType) throw new CreationError(409, 'request-id-reused');
      return old;
    }
    // The same file recorded again for the same revision is one output, not two.
    const same = state.outputs.find(o => o.path === relative && o.sourceRevision === sourceRevision && o.mediaType === output.mediaType);
    if (same) return same;
    state.outputs = [...state.outputs.filter(o => o.path !== relative), output];
    this.writeState(projectId, state);
    return output;
  }

  // ─── impacts ────────────────────────────────────────────────────────────────────────

  impacts(projectId: unknown, id: string): CreationImpact[] {
    this.state(projectId, id);
    const states = new Map<string, State>();
    for (const docId of this.docIds(projectId)) {
      try { states.set(docId, this.state(projectId, docId)); } catch { /* An unreadable document cannot be shown as an impact. */ }
    }
    const linksAt = new Map<string, CreationLink[] | null>();
    const readLinks = (sourceId: string, revision: number): CreationLink[] | null => {
      const key = `${sourceId}:${revision}`;
      if (!linksAt.has(key)) {
        let links: CreationLink[] | null;
        try { links = this.readRevision(projectId, sourceId, revision).links; } catch { links = null; }
        linksAt.set(key, links);
      }
      return linksAt.get(key)!;
    };
    const depthOf = (link: CreationLink): { depth: number; broken: boolean } => {
      // Follow the pinned snapshots, not each source's current links. Breadth-first gives the shortest path.
      const queue = [{ sourceId: link.sourceId, sourceRevision: link.sourceRevision, depth: 1 }];
      const visited = new Set<string>();
      let broken = false;
      for (let index = 0; index < queue.length; index += 1) {
        const source = queue[index]!;
        if (source.sourceId === id) return { depth: source.depth, broken };
        const key = `${source.sourceId}:${source.sourceRevision}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const next = readLinks(source.sourceId, source.sourceRevision);
        if (!next) { broken = true; continue; }
        for (const dependency of next) queue.push({ sourceId: dependency.sourceId, sourceRevision: dependency.sourceRevision, depth: source.depth + 1 });
      }
      return { depth: 0, broken };
    };
    const impacts: CreationImpact[] = [];
    for (const [docId, state] of states) {
      for (const link of this.annotate(state, state.head.links)) {
        const { depth, broken } = depthOf(link);
        if (!depth) continue;
        impacts.push({
          docId, title: state.head.title, appId: state.head.appId, linkId: link.id, role: link.role,
          sourceId: link.sourceId, sourceRevision: link.sourceRevision,
          latestRevision: states.get(link.sourceId)?.head.revision ?? link.sourceRevision,
          ...(link.keptRevision ? { keptRevision: link.keptRevision } : {}),
          targets: link.targets, depth,
          outputs: state.outputs.slice(-20).map(o => ({ id: o.id, path: o.path, sourceRevision: o.sourceRevision, mediaType: o.mediaType })),
          ...(broken ? { broken: true as const } : {}),
        });
      }
    }
    return impacts.sort((a, b) => a.depth - b.depth);
  }

  // ─── mirrors of app-native documents ────────────────────────────────────────────────

  /**
   * App adapters index their native document's references; the host never interprets the native payload, and the
   * mirror stores none of it. No links and no mirror yet → nothing is written. Same title and links → nothing written.
   */
  sync(projectId: unknown, input: { key: string; appId: string; title: string; payload?: CreationValue; links: CreationLink[] }): { id: string; revision: number } | null {
    const appId = creationKey(input.appId);
    const key = text(input.key, 500);
    const mirrorId = `mirror-${sha256(`${appId}:${key}`).slice(0, 32)}`;
    let state: State | null = null;
    try { state = this.state(projectId, mirrorId); } catch (error) {
      if (!(error instanceof CreationError) || error.status !== 404) throw error;
    }
    // A reference whose revision no longer exists is dropped from the index rather than failing the whole mirror.
    const links: CreationLink[] = [];
    for (const link of Array.isArray(input.links) ? input.links : []) {
      try { links.push(...this.links(projectId, mirrorId, [link], null, 'user')); } catch (error) {
        this.host.warn?.(`[creation] mirror ${mirrorId} skipped a reference: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const title = text(input.title, 500);
    const parameters = { nativeRef: key };
    if (!state) {
      if (!links.length) return null;
      const doc = this.create(projectId, { appId, title, payload: {}, parameters, links }, 'user', mirrorId, 'sync');
      return { id: doc.id, revision: doc.revision };
    }
    if (state.head.title === title && creationStableJson(state.head.links) === creationStableJson(links)) {
      return { id: state.head.id, revision: state.head.revision };
    }
    const doc = this.commit(projectId, mirrorId, {
      title, payload: {}, parameters, links, baseRevision: state.head.revision, requestId: randomUUID(),
    }, 'user', { operation: 'sync', internal: true });
    return { id: doc.id, revision: doc.revision };
  }
  /** Finds the mirror of an app-native document (to show/record decisions for it). */
  mirror(projectId: unknown, appId: string, key: string): CreationDoc | null {
    const mirrorId = `mirror-${sha256(`${creationKey(appId)}:${text(key, 500)}`).slice(0, 32)}`;
    try { return this.get(projectId, mirrorId); } catch (error) {
      if (error instanceof CreationError && error.status === 404) return null;
      throw error;
    }
  }

  // ─── cleanup ────────────────────────────────────────────────────────────────────────

  schedulePrune(projectId: unknown): void {
    let root: string;
    try { root = this.project(projectId); } catch { return; }
    if (this.pruneTimers.has(root)) return;
    const timer = setTimeout(() => {
      this.pruneTimers.delete(root);
      void this.pruneRoot(root, projectId).catch(error => this.host.warn?.(`[creation] cleanup failed: ${String(error)}`));
    }, PRUNE_DELAY_MS);
    (timer as { unref?: () => void }).unref?.();
    this.pruneTimers.set(root, timer);
  }
  /** Runs the cleanup now (tests, or a caller that wants it). */
  async prune(projectId: unknown): Promise<{ revisions: number; candidates: number; blobs: number }> {
    return this.pruneRoot(this.project(projectId), projectId);
  }
  private pruneRoot(root: string, projectId: unknown): Promise<{ revisions: number; candidates: number; blobs: number }> {
    const running = this.pruning.get(root);
    const run = (running ?? Promise.resolve()).then(async () => {
      const watch: PruneWatch = { root, changed: false };
      CreationStore.pruneWatches.add(watch);
      try { return await this.pruneOnce(root, projectId, watch); }
      finally { CreationStore.pruneWatches.delete(watch); }
    });
    const settled = run.then(() => undefined, () => undefined);
    this.pruning.set(root, settled);
    void settled.then(() => { if (this.pruning.get(root) === settled) this.pruning.delete(root); });
    return run;
  }
  private async pruneOnce(root: string, projectId: unknown, watch: PruneWatch): Promise<{ revisions: number; candidates: number; blobs: number }> {
    const base = path.join(root, '.vibisual', 'creation');
    const result = { revisions: 0, candidates: 0, blobs: 0 };
    let entries: fs.Dirent[];
    try { entries = await fsp.readdir(base, { withFileTypes: true }); } catch { return result; }
    const ids = entries.filter(e => e.isDirectory() && isCreationDocId(e.name) && e.name !== 'blobs').map(e => e.name);
    const states = new Map<string, State>();
    for (const id of ids) {
      try { states.set(id, this.upgrade(JSON.parse(await fsp.readFile(path.join(base, id, 'state.json'), 'utf8')), id, path.join(base, id))); }
      catch (error) {
        // Blobs and linked revisions are shared across documents. Skipping just this ledger would
        // turn its live references into apparent orphans, even when previous.json can recover it.
        this.host.warn?.(`[creation] cleanup skipped: unreadable ledger ${id}: ${String(error)}`);
        return result;
      }
    }
    // Failed pointer publication may leave a newer immutable revision as recovery evidence.
    // Preserve that existing rule independently of the concurrent-write guard.
    const seenHead = new Map([...states].map(([id, state]) => [id, state.head.revision]));
    const now = this.now();
    const retained = (candidate: CandidateEntry): boolean => candidate.status === 'pending'
      || now - (candidate.decidedAt ?? now) < CREATION_LIMITS.candidateRetentionMs;
    // 1. Revisions each ledger still needs.
    const keep = new Map<string, Set<number>>();
    const queue: [string, number][] = [];
    const protect = (id: string, revision: number): void => {
      creationDocId(id); integer(revision);
      const set = keep.get(id) ?? new Set<number>();
      keep.set(id, set);
      if (set.has(revision)) return;
      set.add(revision);
      queue.push([id, revision]);
    };
    for (const [id, state] of states) {
      protect(id, state.head.revision);
      [...state.undo, ...state.redo].forEach(r => protect(id, r));
      state.accepted.slice(-CREATION_LIMITS.keptRevisions).forEach(r => protect(id, r));
      state.outputs.forEach(o => protect(id, o.sourceRevision));
      state.candidates.forEach(c => { if (retained(c)) {
        protect(id, c.baseRevision); c.links?.forEach(l => protect(l.sourceId, l.sourceRevision));
      } });
      state.head.links.forEach(l => protect(l.sourceId, l.sourceRevision));
      Object.values(state.artifactLinks ?? {}).flat().forEach(l => protect(l.sourceId, l.sourceRevision));
    }
    // 2. Every kept revision keeps what it references (transitively) and its blobs.
    const blobs = new Set<string>();
    // Read project-level artifact pins before traversing the revision graph. An unreadable pin
    // means incomplete reachability, so fail closed just as for an unreadable document ledger.
    try {
      const folder = this.under(root, '.artifacts');
      if (fs.existsSync(folder)) for (const name of fs.readdirSync(folder)) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}\.json$/.test(name)) continue;
        const artifact = this.read<{ schemaVersion: number; names: string[]; links: CreationLink[] }>(this.under(root, '.artifacts', name));
        if (artifact.schemaVersion !== 1 || !Array.isArray(artifact.names) || !Array.isArray(artifact.links)
          || artifact.names.some(value => !parseCreationBlobName(value))) throw new CreationError(422, 'artifact-unreadable');
        artifact.names.forEach(value => blobs.add(value));
        artifact.links.forEach(link => protect(link.sourceId, link.sourceRevision));
      }
    } catch (error) {
      this.host.warn?.(`[creation] cleanup skipped: unreadable artifact pins: ${String(error)}`);
      return result;
    }
    for (const state of states.values()) for (const names of Object.values(state.artifactBlobs ?? {})) {
      names.forEach(name => blobs.add(name));
    }
    for (let index = 0; index < queue.length; index += 1) {
      const [id, revision] = queue[index]!;
      try {
        const doc = JSON.parse(await fsp.readFile(path.join(base, id, 'revisions', `${revision}.json`), 'utf8')) as CreationDoc;
        if (doc.id !== id || doc.revision !== revision || doc.schemaVersion !== 1 || doc.payload === undefined) {
          throw new CreationError(422, 'source-unreadable');
        }
        collectCreationBlobNames(doc.payload, blobs);
        (doc.links ?? []).forEach(l => protect(l.sourceId, l.sourceRevision));
      } catch (error) {
        this.host.warn?.(`[creation] cleanup skipped: unreadable revision ${id}/${revision}: ${String(error)}`);
        return result;
      }
    }
    // Read every retained proposal before changing any ledger or deleting anything. A read failure
    // is incomplete reachability, not proof that the proposal references no binaries.
    for (const [id, state] of states) {
      for (const candidate of state.candidates.filter(retained)) {
        try {
          const body = JSON.parse(await fsp.readFile(path.join(base, id, 'candidates', candidate.file), 'utf8')) as CreationCandidate;
          if (body.id !== candidate.id || body.payload === undefined) throw new CreationError(422, 'source-unreadable');
          collectCreationBlobNames(body.payload, blobs);
        } catch (error) {
          this.host.warn?.(`[creation] cleanup skipped: unreadable candidate ${id}/${candidate.id}: ${String(error)}`);
          return result;
        }
      }
    }
    // 3. Decided candidates past retention and dropped revisions leave the ledger
    //    (a synchronous read-modify-write, atomic for this process).
    const kept = (id: string, revision: number): boolean => (keep.get(id)?.has(revision) ?? false)
      || revision >= (seenHead.get(id) ?? Infinity);
    // Checking once is insufficient: commits may arrive at every await below. The check and each
    // unlink are synchronous together; async rm would allow a successful save before its unlink.
    const remove = (file: string): boolean => {
      if (watch.changed) return false;
      try {
        fs.unlinkSync(file);
        this.invalidatePrunes(file, watch);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.host.warn?.(`[creation] cleanup could not remove ${file}: ${String(error)}`);
        return false;
      }
    };
    for (const id of states.keys()) {
      if (watch.changed) return result;
      let state: State;
      try { state = this.state(projectId, id); } catch { return result; }
      // A disk edit outside this store is also a changed snapshot; never mix it with the old keep set.
      if (creationStableJson(state) !== creationStableJson(states.get(id))) return result;
      const expired = state.candidates.filter(c => !retained(c));
      const accepted = state.accepted.filter(r => kept(id, r));
      if (expired.length || accepted.length !== state.accepted.length) {
        state.candidates = state.candidates.filter(c => !expired.includes(c));
        if (expired.length) state.candidateStamp += 1;
        state.accepted = accepted;
        this.write(path.join(base, id, 'state.json'), state, watch);
        for (const c of expired) {
          await yieldCleanup();
          if (watch.changed) return result;
          if (remove(path.join(base, id, 'candidates', c.file))) result.candidates += 1;
        }
      }
      states.set(id, state);
    }
    // 4. Revisions nobody needs. The pointer and anything written during this pass are never touched.
    for (const id of states.keys()) {
      let files: string[];
      try { files = await fsp.readdir(path.join(base, id, 'revisions')); } catch { continue; }
      for (const name of files) {
        if (!/^\d+\.json$/.test(name)) continue;
        const revision = Number(name.slice(0, -5));
        if (kept(id, revision)) continue;
        await yieldCleanup();
        if (watch.changed) return result;
        if (remove(path.join(base, id, 'revisions', name))) result.revisions += 1;
      }
    }
    // 5. Unreferenced blobs, after a grace period (an upload may be waiting for its commit).
    let names: string[] = [];
    try { names = await fsp.readdir(path.join(base, 'blobs')); } catch { /* No blobs yet. */ }
    for (const name of names) {
      if (!parseCreationBlobName(name) || blobs.has(name)) continue;
      try {
        const st = await fsp.stat(path.join(base, 'blobs', name));
        if (watch.changed) return result;
        if (now - st.mtimeMs < CREATION_LIMITS.blobGraceMs) continue;
        if (remove(path.join(base, 'blobs', name))) result.blobs += 1;
      } catch { /* A concurrent cleanup removed it. */ }
    }
    return result;
  }
}

export function blobExtForUpload(raw: unknown): CreationBlobExt | null {
  return typeof raw === 'string' && (CREATION_BLOB_EXTENSIONS as readonly string[]).includes(raw) ? raw as CreationBlobExt : null;
}
export { parseCreationBlobRef };
