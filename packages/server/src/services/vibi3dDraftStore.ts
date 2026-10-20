import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  CREATION_LIMITS, VIBI3D_DRAFT_LIMITS, creationStableJson, isVibi3DDraftActor, isVibi3DDraftKey,
  type Vibi3DDraft, type Vibi3DDraftActor, type Vibi3DDraftReadResult, type Vibi3DDraftSummary,
  type Vibi3DDraftWriteResult,
} from '@vibisual/shared';
import { CreationError, CreationStore, creationDocId, creationKey, type CreationHost } from './creationStore.js';

type Input = Record<string, unknown>;
interface Entry { summary: Vibi3DDraftSummary; artifact: string }
interface Receipt { id: string; digest: string; version: number }
interface State {
  schemaVersion: 1;
  key: string;
  actor: Vibi3DDraftActor;
  version: number;
  head: Entry | null;
  history: Entry[];
  receipts: Receipt[];
}
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new CreationError(400, 'invalid-draft-version');
  return value;
}
function identity(key: unknown, actor: unknown): { key: string; actor: Vibi3DDraftActor } {
  if (!isVibi3DDraftKey(key) || !isVibi3DDraftActor(actor)) throw new CreationError(400, 'invalid-draft-identity');
  return { key, actor };
}
function summary(draft: Vibi3DDraft): Vibi3DDraftSummary {
  const { payload: _payload, links: _links, ...result } = draft; return result;
}

/** Disk is authoritative. Synchronous publication after blob upload gives CAS across store instances. */
export class Vibi3DDraftStore {
  constructor(private readonly host: CreationHost, private readonly creation: CreationStore, private readonly now = Date.now) {}

  private root(projectId: unknown): string {
    const root = this.host.resolveProjectPath(projectId);
    if (!root) throw new CreationError(404, 'project-not-found');
    try { return fs.realpathSync(root); } catch { throw new CreationError(404, 'project-not-found'); }
  }
  /** Reject every symlink below the project, including a dangling link or an in-project alias. */
  private file(projectId: unknown, ...parts: string[]): string {
    let current = this.root(projectId);
    for (const part of ['.vibisual', 'vibi3d-drafts', ...parts]) {
      if (!part || part === '.' || part === '..' || /[/\\]/.test(part)) throw new CreationError(400, 'invalid-draft-path');
      current = path.join(current, part);
      try { if (fs.lstatSync(current).isSymbolicLink()) throw new CreationError(403, 'outside-project'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return current;
  }
  private folder(key: string, actor: Vibi3DDraftActor): string { return hash(`${key}\0${actor}`); }
  private readJson<T>(file: string): T {
    try {
      if (fs.statSync(file).size > CREATION_LIMITS.requestBytes * 2) throw new CreationError(422, 'draft-unreadable');
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch (error) {
      if (error instanceof CreationError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CreationError(404, 'draft-not-found');
      throw new CreationError(422, 'draft-unreadable');
    }
  }
  private state(projectId: unknown, key: string, actor: Vibi3DDraftActor): State {
    const file = this.file(projectId, this.folder(key, actor), 'state.json');
    if (!fs.existsSync(file)) return { schemaVersion: 1, key, actor, version: 0, head: null, history: [], receipts: [] };
    const state = this.readJson<State>(file);
    const validEntry = (entry: Entry): boolean => !!entry && /^[a-f0-9]{64}$/.test(entry.artifact)
      && entry.summary?.key === key && entry.summary.actor === actor
      && Number.isSafeInteger(entry.summary.version) && entry.summary.version > 0 && entry.summary.version <= state.version;
    if (state?.schemaVersion !== 1 || state.key !== key || state.actor !== actor || !Number.isSafeInteger(state.version) || state.version < 1
      || !Array.isArray(state.history) || state.history.length > VIBI3D_DRAFT_LIMITS.history || !state.history.every(validEntry)
      || (state.head !== null && (!validEntry(state.head) || state.head.summary.version !== state.version))
      || !Array.isArray(state.receipts) || state.receipts.length > VIBI3D_DRAFT_LIMITS.receipts
      || state.receipts.some(receipt => !receipt || typeof receipt.id !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.digest)
        || !Number.isSafeInteger(receipt.version) || receipt.version < 1 || receipt.version > state.version)) {
      throw new CreationError(422, 'draft-unreadable');
    }
    return state;
  }
  private entry(projectId: unknown, state: State, entry: Entry): Vibi3DDraft {
    const draft = this.readJson<Vibi3DDraft>(this.file(projectId, this.folder(state.key, state.actor), `${entry.artifact}.json`));
    if (creationStableJson(summary(draft)) !== creationStableJson(entry.summary) || draft.payload === undefined || !Array.isArray(draft.links)) {
      throw new CreationError(422, 'draft-unreadable');
    }
    this.creation.validateArtifactPayload(projectId, draft.payload);
    return draft;
  }
  private view(projectId: unknown, state: State): Vibi3DDraftReadResult {
    return { draft: state.head ? this.entry(projectId, state, state.head) : null, version: state.version };
  }
  read(projectId: unknown, rawKey: unknown, rawActor: unknown): Vibi3DDraftReadResult {
    const { key, actor } = identity(rawKey, rawActor); return this.view(projectId, this.state(projectId, key, actor));
  }
  list(projectId: unknown): { drafts: Vibi3DDraftSummary[]; failed: string[] } {
    const folder = this.file(projectId); const drafts: Vibi3DDraftSummary[] = []; const failed: string[] = [];
    if (!fs.existsSync(folder)) return { drafts, failed };
    for (const dir of fs.readdirSync(folder)) {
      if (!/^[a-f0-9]{64}$/.test(dir)) continue;
      try {
        const raw = this.readJson<State>(this.file(projectId, dir, 'state.json'));
        const { key, actor } = identity(raw.key, raw.actor);
        if (this.folder(key, actor) !== dir) throw new CreationError(422, 'draft-unreadable');
        const state = this.state(projectId, key, actor);
        if (state.head) drafts.push(state.head.summary);
      } catch { failed.push(dir); }
    }
    return { drafts: drafts.sort((left, right) => right.updatedAt - left.updatedAt), failed };
  }
  history(projectId: unknown, rawKey: unknown, rawActor: unknown): Vibi3DDraftSummary[] {
    const { key, actor } = identity(rawKey, rawActor);
    return this.state(projectId, key, actor).history.map(entry => entry.summary).reverse();
  }
  revision(projectId: unknown, rawKey: unknown, rawActor: unknown, rawVersion: unknown): Vibi3DDraft {
    const { key, actor } = identity(rawKey, rawActor); const state = this.state(projectId, key, actor);
    const wanted = version(rawVersion); const entry = state.history.find(item => item.summary.version === wanted);
    if (!entry) throw new CreationError(404, 'draft-version-not-found');
    return this.entry(projectId, state, entry);
  }
  private replay(projectId: unknown, state: State, requestId: string, digest: string): Vibi3DDraftWriteResult | null {
    const receipt = state.receipts.find(item => item.id === requestId);
    if (!receipt) return null;
    if (receipt.digest !== digest) throw new CreationError(409, 'request-id-reused');
    return { ...this.view(projectId, state), savedVersion: receipt.version, replayed: true };
  }
  private compare(state: State, expected: number): void {
    if (state.version !== expected) throw new CreationError(409, 'draft-version-conflict', undefined, { version: state.version });
    if (state.version >= Number.MAX_SAFE_INTEGER) throw new CreationError(409, 'draft-version-limit');
  }
  private publish(projectId: unknown, state: State, requestId: string, digest: string, removed: Entry[]): void {
    state.receipts = [...state.receipts, { id: requestId, digest, version: state.version }].slice(-VIBI3D_DRAFT_LIMITS.receipts);
    this.host.atomicWriteFile(this.file(projectId, this.folder(state.key, state.actor), 'state.json'), JSON.stringify(state));
    // The pointer is durable before releasing any previous version. Cleanup failure does not turn
    // a successful save into a failure; leaving a pin temporarily consumes space but loses no work.
    for (const entry of removed) try {
      fs.rmSync(this.file(projectId, this.folder(state.key, state.actor), `${entry.artifact}.json`), { force: true });
      this.creation.releaseProjectArtifact(projectId, `draft-${entry.artifact}`);
    } catch (error) { this.host.warn?.(`[vibi3d] old draft cleanup failed: ${String(error)}`); }
  }
  async save(projectId: unknown, input: Input): Promise<Vibi3DDraftWriteResult> {
    const { key, actor } = identity(input.key, input.actor); const expected = version(input.expectedVersion);
    const requestId = creationKey(input.requestId);
    if (typeof input.fileName !== 'string' || !input.fileName.trim() || input.fileName.length > VIBI3D_DRAFT_LIMITS.fileNameLength) {
      throw new CreationError(400, 'invalid-draft-name');
    }
    const documentId = input.documentId === undefined ? undefined : creationDocId(input.documentId);
    const baseRevision = input.baseRevision === undefined ? undefined : version(input.baseRevision);
    if ((baseRevision !== undefined && (!documentId || baseRevision < 1)) || (key.startsWith('doc:') && documentId !== key.slice(4))) {
      throw new CreationError(400, 'draft-source-mismatch');
    }
    // Payload structure is checked before canonical hashing/externalization to bound recursion.
    this.checkInput(input.payload);
    const digest = hash(creationStableJson(['save', expected, input.fileName, documentId ?? null, baseRevision ?? null, input.payload, input.links ?? []]));
    let state = this.state(projectId, key, actor);
    const replay = this.replay(projectId, state, requestId, digest); if (replay) return replay;
    this.compare(state, expected);
    if (documentId) {
      const doc = this.creation.get(projectId, documentId);
      if (doc.appId !== 'vibi3d') throw new CreationError(400, 'draft-source-mismatch');
      if (baseRevision !== undefined) this.creation.revision(projectId, documentId, baseRevision);
    }
    const payload = this.creation.validateArtifactPayload(projectId, await this.creation.externalize(projectId, input.payload));
    const links = this.creation.validateDraftLinks(projectId, documentId, input.links ?? []);
    // A newer save/discard may have completed while blob writes were awaiting disk.
    state = this.state(projectId, key, actor);
    const repeated = this.replay(projectId, state, requestId, digest); if (repeated) return repeated;
    this.compare(state, expected);
    const at = this.now(); const next = state.version + 1;
    const draft: Vibi3DDraft = { key, actor, version: next, fileName: input.fileName, ...(documentId ? { documentId } : {}),
      ...(baseRevision !== undefined ? { baseRevision } : {}), payload, links, createdAt: state.head?.summary.createdAt ?? at, updatedAt: at };
    const entry: Entry = { summary: summary(draft), artifact: hash(`${key}\0${actor}\0${next}\0${requestId}`) };
    // Pins precede both immutable snapshot and pointer publication, including drafts without a source.
    const pinnedLinks = [...links];
    if (documentId && baseRevision !== undefined) pinnedLinks.push({ id: `draft-base-${hash(documentId).slice(0, 24)}`,
      sourceId: documentId, sourceRevision: baseRevision, role: 'draft-base', targets: [] });
    this.creation.retainProjectArtifact(projectId, `draft-${entry.artifact}`, payload, pinnedLinks);
    this.host.atomicWriteFile(this.file(projectId, this.folder(key, actor), `${entry.artifact}.json`), JSON.stringify(draft));
    const previous = state.history; state.version = next; state.head = entry;
    state.history = [...previous, entry].slice(-VIBI3D_DRAFT_LIMITS.history);
    this.publish(projectId, state, requestId, digest, previous.filter(old => !state.history.includes(old)));
    return { draft, version: next, savedVersion: next, replayed: false };
  }
  discard(projectId: unknown, input: Input): Vibi3DDraftWriteResult {
    const { key, actor } = identity(input.key, input.actor); const expected = version(input.expectedVersion);
    const requestId = creationKey(input.requestId); const digest = hash(creationStableJson(['discard', expected]));
    const state = this.state(projectId, key, actor);
    const replay = this.replay(projectId, state, requestId, digest); if (replay) return replay;
    this.compare(state, expected);
    const removed = state.history; state.version += 1; state.head = null; state.history = [];
    this.publish(projectId, state, requestId, digest, removed);
    return { draft: null, version: state.version, savedVersion: state.version, replayed: false };
  }
  private checkInput(value: unknown): void {
    const visit = (item: unknown, depth: number): boolean => depth <= 80 && (item === null || typeof item === 'string' || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item)) || (Array.isArray(item) && item.every(child => visit(child, depth + 1)))
      || (!!item && typeof item === 'object' && Object.entries(item).every(([key, child]) => !['__proto__', 'constructor', 'prototype'].includes(key) && visit(child, depth + 1))));
    if (!visit(value, 0)) throw new CreationError(400, 'invalid-payload');
    if (Buffer.byteLength(JSON.stringify(value)) > CREATION_LIMITS.requestBytes) throw new CreationError(413, 'source-too-large');
  }
}
