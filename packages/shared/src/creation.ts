import { LOOPBACK_REQUEST_MAX_BYTES } from './constants.js';

/**
 * §5.13 (R-10) — App-neutral editable-source contract. Renderers and document schemas belong to their apps.
 *
 * Nothing here knows an app name: the host stores ids, revisions, JSON payloads, locks, references and outputs.
 * Large binary values (data URLs, long numeric arrays) are moved into content-addressed immutable files and the
 * payload keeps only a `vibi-blob:` reference string, so identical bytes are stored once across revisions.
 */
export type CreationValue = null | boolean | number | string | CreationValue[] | { [key: string]: CreationValue };

/** A pinned reference from one document to an immutable revision of another. */
export interface CreationLink {
  id: string;
  sourceId: string;
  sourceRevision: number;
  role: string;
  targets: string[];
  /**
   * The user's "keep this version" decision. It lives in the ledger, never in an immutable revision, so recording it
   * does not raise this document's revision (no cascade of "new version" notices). Every source revision up to this
   * one was seen and `sourceRevision` kept; a newer source revision notifies again.
   */
  keptRevision?: number;
}

/** What produced a revision. Stored as a code so the screen can translate it. */
export type CreationOperation = 'create' | 'commit' | 'undo' | 'redo' | 'restore' | 'accept' | 'sync';

export interface CreationDoc {
  schemaVersion: 1;
  id: string;
  appId: string;
  title: string;
  revision: number;
  payload: CreationValue;
  parameters: Record<string, CreationValue>;
  lockedPaths: string[];
  links: CreationLink[];
  createdAt: number;
  updatedAt: number;
  /** Free text supplied by the caller (may be empty). The operation code is the translated label. */
  label: string;
  operation?: CreationOperation;
  /** For undo/redo/restore: the revision whose content this revision repeats. */
  restoredFrom?: number;
  author: 'user' | 'agent';
  canUndo?: boolean;
  canRedo?: boolean;
}
/** List/history entries never carry a payload. */
export type CreationDocSummary = Omit<CreationDoc, 'payload'>;

/** The cheapest poll: enough to know whether a full read is needed. */
export interface CreationHead {
  id: string;
  appId: string;
  revision: number;
  updatedAt: number;
  /** Changes whenever the candidate list changes (proposal, decision, cleanup). */
  candidateStamp: number;
  pendingCandidates: number;
}

export interface CreationCandidate {
  id: string;
  baseRevision: number;
  payload: CreationValue;
  /** Optional complete reference set proposed together with the payload; old candidates inherit their base links. */
  links?: CreationLink[];
  label: string;
  input: string;
  createdAt: number;
  status: 'pending' | 'accepted' | 'discarded';
  /** Set when the user moved a stale candidate onto a newer revision. */
  rebasedFrom?: string;
  decidedAt?: number;
}
export type CreationCandidateSummary = Omit<CreationCandidate, 'payload'>;

export interface CreationOutput {
  id: string;
  sourceRevision: number;
  path: string;
  mediaType: string;
  createdAt: number;
}

export interface CreationImpact {
  docId: string;
  title: string;
  appId: string;
  linkId: string;
  role: string;
  sourceId: string;
  sourceRevision: number;
  latestRevision: number;
  keptRevision?: number;
  targets: string[];
  /** 1 = this document uses the source directly; larger = through other documents. */
  depth: number;
  /** Files produced from that document (which revision of it). */
  outputs: Pick<CreationOutput, 'id' | 'path' | 'sourceRevision' | 'mediaType'>[];
  /** A revision on the dependency chain could not be read — depth is a lower bound. */
  broken?: true;
}
export interface CreationListFailure { id: string; error: string }

export interface CreationRequirement {
  id: string;
  description: string;
  kind: 'equals' | 'unchanged' | 'visual';
  pointer?: string;
  expected?: CreationValue;
  evidence?: { path: string; time?: number; note: string };
}
export interface CreationCheck {
  id: string;
  kind: CreationRequirement['kind'];
  status: 'passed' | 'failed' | 'needs-review';
  description: string;
  evidence?: CreationRequirement['evidence'];
}

/** Per-command limits a creation request may carry (applied only by engines that support them). */
export interface CreationRunLimits {
  maxTurns?: number;
  maxMinutes?: number;
}
export const CREATION_QUALITY_LIMITS: Readonly<Record<'draft' | 'refine', CreationRunLimits>> = {
  draft: { maxTurns: 24, maxMinutes: 10 },
  refine: { maxTurns: 80, maxMinutes: 40 },
};

export const CREATION_API_PREFIX = '/api/app/creation';
const MIB = 1024 * 1024;
export const CREATION_LIMITS = {
  /** One JSON request. Same constant the loopback ingress enforces, so agents and the app see one limit. */
  requestBytes: LOOPBACK_REQUEST_MAX_BYTES,
  /** Serialized payload after large binaries moved out. */
  payloadBytes: 8 * MIB,
  /** One immutable blob through the in-app channel (the loopback ingress still caps a request at requestBytes). */
  blobBytes: 128 * MIB,
  links: 500,
  requestHistory: 256,
  candidates: 100,
  /** Recent accepted revisions kept by the cleanup, besides every referenced/undoable revision. */
  keptRevisions: 30,
  candidateRetentionMs: 14 * 24 * 60 * 60 * 1000,
  blobGraceMs: 60 * 60 * 1000,
  /** Shortest data URL / numeric array moved out of a payload. */
  inlineStringMin: 1024,
  inlineArrayMin: 64,
} as const;

/** Lowercase only: doc ids become directory names on case-insensitive file systems too. */
export const CREATION_DOC_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
/** Device names Windows reserves in every directory (with or without an extension). */
export function isWindowsReservedName(name: string): boolean {
  return /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i.test(name);
}
export function isCreationDocId(value: unknown): value is string {
  return typeof value === 'string' && CREATION_DOC_ID_PATTERN.test(value) && !isWindowsReservedName(value);
}

/** Canonical JSON, also used to compare a locked subtree without key-order false positives. */
export function creationStableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(creationStableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${creationStableJson(record[key])}`).join(',')}}`;
}

function isRecord(value: unknown): value is { [key: string]: CreationValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Arrays of objects are addressed by a stable `id` (app layers) or `uuid` (Three JSON nodes/resources). */
function stableKey(item: unknown): string | null {
  if (!isRecord(item)) return null;
  if (typeof item['id'] === 'string' && item['id']) return item['id'];
  if (typeof item['uuid'] === 'string' && item['uuid']) return item['uuid'];
  return null;
}
export function escapeCreationPointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** RFC 6901 pointer; an array may also be addressed by @stable-id (id or uuid) to survive reorder operations. */
export function creationValueAt(value: CreationValue, pointer: string): CreationValue | undefined {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) return undefined;
  let current: CreationValue | undefined = value;
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current)) {
      current = key.startsWith('@')
        ? current.find(item => stableKey(item) === key.slice(1))
        : /^(0|[1-9]\d*)$/.test(key) ? current[Number(key)] : undefined;
    } else current = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined;
  }
  return current;
}

export function checkCreationRequirements(
  before: CreationValue, after: CreationValue, requirements: readonly CreationRequirement[],
): CreationCheck[] {
  return requirements.map(rule => {
    const value = rule.pointer === undefined ? undefined : creationValueAt(after, rule.pointer);
    const expected = rule.kind === 'unchanged' && rule.pointer !== undefined ? creationValueAt(before, rule.pointer) : rule.expected;
    const equal = value !== undefined && expected !== undefined && creationStableJson(value) === creationStableJson(expected);
    return {
      id: rule.id, description: rule.description, kind: rule.kind,
      status: rule.kind === 'visual' ? 'needs-review' : equal ? 'passed' : 'failed',
      ...(rule.evidence ? { evidence: rule.evidence } : {}),
    };
  });
}

// ─── Large binaries outside the payload ───────────────────────────────────────────────

export const CREATION_BLOB_EXTENSIONS = ['png', 'jpg', 'webp', 'gif', 'avif', 'bmp', 'svg', 'bin', 'u32', 'f32', 'f64'] as const;
export type CreationBlobExt = typeof CREATION_BLOB_EXTENSIONS[number];
export const CREATION_BLOB_PREFIX = 'vibi-blob:';
const BLOB_NAME = /^([0-9a-f]{64})\.(png|jpg|webp|gif|avif|bmp|svg|bin|u32|f32|f64)$/;
export const CREATION_BLOB_MIME: Readonly<Record<CreationBlobExt, string>> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp',
  svg: 'image/svg+xml', bin: 'application/octet-stream',
  u32: 'application/octet-stream', f32: 'application/octet-stream', f64: 'application/octet-stream',
};
const MIME_EXT: Readonly<Record<string, CreationBlobExt>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/avif': 'avif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'application/octet-stream': 'bin',
};
export interface CreationBlobName { hash: string; ext: CreationBlobExt; name: string }
export interface CreationBinary { bytes: Uint8Array; ext: CreationBlobExt }

export function creationBlobExtForMime(mime: string): CreationBlobExt | null {
  return MIME_EXT[mime.toLowerCase().split(';')[0]!.trim()] ?? null;
}
export function parseCreationBlobName(name: unknown): CreationBlobName | null {
  if (typeof name !== 'string') return null;
  const match = BLOB_NAME.exec(name);
  return match ? { hash: match[1]!, ext: match[2] as CreationBlobExt, name } : null;
}
export function creationBlobRef(name: CreationBlobName | string): string {
  return `${CREATION_BLOB_PREFIX}${typeof name === 'string' ? name : name.name}`;
}
export function parseCreationBlobRef(value: unknown): CreationBlobName | null {
  return typeof value === 'string' && value.startsWith(CREATION_BLOB_PREFIX)
    ? parseCreationBlobName(value.slice(CREATION_BLOB_PREFIX.length)) : null;
}
export function isNumericBlobExt(ext: CreationBlobExt): ext is 'u32' | 'f32' | 'f64' {
  return ext === 'u32' || ext === 'f32' || ext === 'f64';
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) table[B64.charCodeAt(i)] = i;
  return table;
})();
/** Strict base64 (whitespace tolerated). null on anything else. */
export function base64Bytes(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) return null;
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array(clean.length / 4 * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const codes = [0, 1, 2, 3].map(k => {
      const ch = clean.charCodeAt(i + k);
      if (ch === 61 && i + k >= clean.length - pad) return 0; // '=' padding at the end only
      return ch < 128 ? B64_INDEX[ch]! : -1;
    });
    if (codes.some(code => code < 0)) return null;
    const n = (codes[0]! << 18) | (codes[1]! << 12) | (codes[2]! << 6) | codes[3]!;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
export function bytesBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 3 * 8192;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    let chunk = '';
    const end = Math.min(bytes.length, start + CHUNK);
    for (let i = start; i < end; i += 3) {
      const a = bytes[i]!, b = i + 1 < end ? bytes[i + 1]! : 0, c = i + 2 < end ? bytes[i + 2]! : 0;
      const n = (a << 16) | (b << 8) | c;
      chunk += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
        + (i + 1 < end ? B64[(n >> 6) & 63]! : '=') + (i + 2 < end ? B64[n & 63]! : '=');
    }
    parts.push(chunk);
  }
  return parts.join('');
}

/** `data:<mime>;base64,<bytes>` with a known mime → bytes. Anything else stays inline. */
export function dataUrlBinary(value: string): CreationBinary | null {
  const match = /^data:([a-z0-9.+/-]+);base64,/i.exec(value);
  if (!match) return null;
  const ext = creationBlobExtForMime(match[1]!);
  if (!ext) return null;
  const bytes = base64Bytes(value.slice(match[0].length));
  return bytes ? { bytes, ext } : null;
}
export function binaryDataUrl(binary: CreationBinary): string {
  return `data:${CREATION_BLOB_MIME[binary.ext]};base64,${bytesBase64(binary.bytes)}`;
}

/** Narrowest exact little-endian encoding of a JSON number array. Decoding gives back the same JSON numbers. */
export function numericArrayBinary(values: readonly number[]): CreationBinary {
  let u32 = true;
  let f32 = true;
  for (const v of values) {
    if (u32 && !(Number.isInteger(v) && v >= 0 && v <= 0xffffffff)) u32 = false;
    if (f32 && Math.fround(v) !== v) f32 = false;
    if (!u32 && !f32) break;
  }
  const ext: CreationBlobExt = u32 ? 'u32' : f32 ? 'f32' : 'f64';
  const size = ext === 'f64' ? 8 : 4;
  const bytes = new Uint8Array(values.length * size);
  const view = new DataView(bytes.buffer);
  values.forEach((v, i) => {
    if (ext === 'u32') view.setUint32(i * 4, v, true);
    else if (ext === 'f32') view.setFloat32(i * 4, v, true);
    else view.setFloat64(i * 8, v, true);
  });
  return { bytes, ext };
}
export function binaryNumbers(bytes: Uint8Array, ext: 'u32' | 'f32' | 'f64'): number[] {
  const size = ext === 'f64' ? 8 : 4;
  if (bytes.length % size !== 0) throw new Error('blob-length-mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Array<number>(bytes.length / size);
  for (let i = 0; i < out.length; i++) {
    out[i] = ext === 'u32' ? view.getUint32(i * 4, true) : ext === 'f32' ? view.getFloat32(i * 4, true) : view.getFloat64(i * 8, true);
  }
  return out;
}

interface Job<T> { input: T; assign: (value: CreationValue) => void }
type Slot = { parent: CreationValue[] | { [key: string]: CreationValue }; key: number | string };
function assignTo(slot: Slot, value: CreationValue): void {
  (slot.parent as Record<string | number, CreationValue>)[slot.key] = value;
}

/**
 * Copies `value`, moving inline binaries (long data URLs, long numeric arrays) into jobs.
 * Sync planning keeps the walk cheap; the caller hashes/uploads/writes, then the refs are assigned.
 */
export function planCreationExternalization(
  value: CreationValue,
  options: { stringMin?: number; arrayMin?: number } = {},
): { root: CreationValue; jobs: Job<CreationBinary>[] } {
  const stringMin = options.stringMin ?? CREATION_LIMITS.inlineStringMin;
  const arrayMin = options.arrayMin ?? CREATION_LIMITS.inlineArrayMin;
  const jobs: Job<CreationBinary>[] = [];
  const copy = (v: CreationValue, slot: Slot | null): CreationValue => {
    if (typeof v === 'string') {
      if (v.length >= stringMin && v.startsWith('data:')) {
        const binary = dataUrlBinary(v);
        if (binary) jobs.push({ input: binary, assign: next => (slot ? assignTo(slot, next) : (rootValue = next)) });
      }
      return v;
    }
    if (Array.isArray(v)) {
      if (v.length >= arrayMin && v.every(n => typeof n === 'number' && Number.isFinite(n))) {
        jobs.push({ input: numericArrayBinary(v as number[]), assign: next => (slot ? assignTo(slot, next) : (rootValue = next)) });
        return v;
      }
      const out: CreationValue[] = new Array(v.length);
      v.forEach((item, i) => { out[i] = copy(item, { parent: out, key: i }); });
      return out;
    }
    if (isRecord(v)) {
      const out: { [key: string]: CreationValue } = {};
      for (const [key, item] of Object.entries(v)) out[key] = copy(item, { parent: out, key });
      return out;
    }
    return v;
  };
  let rootValue: CreationValue = copy(value, null);
  return { get root() { return rootValue; }, jobs };
}

export async function externalizeCreationValue(
  value: CreationValue,
  put: (binary: CreationBinary) => Promise<string>,
  options?: { stringMin?: number; arrayMin?: number },
): Promise<CreationValue> {
  const plan = planCreationExternalization(value, options);
  // Sequential: one blob in flight bounds memory and the host's write queue.
  for (const job of plan.jobs) job.assign(await put(job.input));
  return plan.root;
}

/** Every blob name a value references (for cleanup and existence checks). */
export function collectCreationBlobNames(value: CreationValue, into = new Set<string>()): Set<string> {
  const visit = (v: CreationValue): void => {
    if (typeof v === 'string') {
      const ref = parseCreationBlobRef(v);
      if (ref) into.add(ref.name);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (isRecord(v)) Object.values(v).forEach(visit);
  };
  visit(value);
  return into;
}

/**
 * Copies `value` with every blob reference replaced by inline data: numeric blobs become number arrays, the others
 * data URLs. Each distinct blob is fetched once.
 */
export async function resolveCreationValue(
  value: CreationValue,
  get: (name: CreationBlobName) => Promise<Uint8Array>,
): Promise<CreationValue> {
  const jobs: Job<CreationBlobName>[] = [];
  const copy = (v: CreationValue, slot: Slot | null): CreationValue => {
    if (typeof v === 'string') {
      const ref = parseCreationBlobRef(v);
      if (ref) jobs.push({ input: ref, assign: next => (slot ? assignTo(slot, next) : (rootValue = next)) });
      return v;
    }
    if (Array.isArray(v)) {
      const out: CreationValue[] = new Array(v.length);
      v.forEach((item, i) => { out[i] = copy(item, { parent: out, key: i }); });
      return out;
    }
    if (isRecord(v)) {
      const out: { [key: string]: CreationValue } = {};
      for (const [key, item] of Object.entries(v)) out[key] = copy(item, { parent: out, key });
      return out;
    }
    return v;
  };
  let rootValue: CreationValue = copy(value, null);
  const cache = new Map<string, Promise<CreationValue>>();
  for (const job of jobs) {
    let decoded = cache.get(job.input.name);
    if (!decoded) {
      const ref = job.input;
      decoded = get(ref).then(bytes => isNumericBlobExt(ref.ext) ? binaryNumbers(bytes, ref.ext) : binaryDataUrl({ bytes, ext: ref.ext }));
      cache.set(ref.name, decoded);
    }
    job.assign(await decoded);
  }
  return rootValue;
}

// ─── Three-way merge (moving a stale candidate onto a newer revision) ─────────────────

export type CreationMergeResult = { ok: true; value: CreationValue } | { ok: false; conflicts: string[] };

function sameValue(a: CreationValue | undefined, b: CreationValue | undefined): boolean {
  if (a === b) return true;
  return creationStableJson(a) === creationStableJson(b);
}
function keyedIndex(values: readonly CreationValue[]): Map<string, CreationValue> | null {
  const map = new Map<string, CreationValue>();
  for (const item of values) {
    const key = stableKey(item);
    if (!key || map.has(key)) return null;
    map.set(key, item);
  }
  return map;
}
function keysIn(values: readonly CreationValue[], keep: (key: string) => boolean): string[] {
  return values.map(stableKey).filter((key): key is string => !!key && keep(key));
}

function mergeAt(
  base: CreationValue | undefined, ours: CreationValue | undefined, theirs: CreationValue | undefined,
  pointer: string, conflicts: string[],
): CreationValue | undefined {
  if (sameValue(ours, theirs) || sameValue(base, theirs)) return ours;
  if (sameValue(base, ours)) return theirs;
  if (isRecord(ours) && isRecord(theirs)) {
    const from = isRecord(base) ? base : {};
    const out: { [key: string]: CreationValue } = {};
    for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      const merged = mergeAt(from[key], ours[key], theirs[key], `${pointer}/${escapeCreationPointer(key)}`, conflicts);
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    const baseList = Array.isArray(base) ? base : [];
    const b = keyedIndex(baseList), o = keyedIndex(ours), t = keyedIndex(theirs);
    if (b && o && t) return mergeKeyed(baseList, ours, theirs, b, o, t, pointer, conflicts);
  }
  conflicts.push(pointer || '/');
  return ours;
}

function mergeKeyed(
  baseList: readonly CreationValue[], ours: readonly CreationValue[], theirs: readonly CreationValue[],
  b: Map<string, CreationValue>, o: Map<string, CreationValue>, t: Map<string, CreationValue>,
  pointer: string, conflicts: string[],
): CreationValue[] {
  const merged = new Map<string, CreationValue>();
  for (const key of new Set([...o.keys(), ...t.keys(), ...b.keys()])) {
    const value = mergeAt(b.get(key), o.get(key), t.get(key), `${pointer}/@${escapeCreationPointer(key)}`, conflicts);
    if (value !== undefined) merged.set(key, value);
  }
  // Order: whoever kept the base order of the shared items yields to the other side's order.
  const common = (key: string): boolean => b.has(key) && o.has(key) && t.has(key);
  const baseOrder = keysIn(baseList, common).join('\u0000');
  const oursOrder = keysIn(ours, common).join('\u0000');
  const theirsOrder = keysIn(theirs, common).join('\u0000');
  let primary: readonly CreationValue[] = ours;
  let secondary: readonly CreationValue[] = theirs;
  if (oursOrder === baseOrder && theirsOrder !== baseOrder) { primary = theirs; secondary = ours; }
  else if (oursOrder !== baseOrder && theirsOrder !== baseOrder && oursOrder !== theirsOrder) conflicts.push(pointer || '/');
  const order = keysIn(primary, key => merged.has(key));
  let previous: string | null = null;
  for (const key of keysIn(secondary, k => merged.has(k))) {
    if (!order.includes(key)) order.splice(previous === null ? 0 : order.indexOf(previous) + 1, 0, key);
    previous = key;
  }
  return order.map(key => merged.get(key)!);
}

/**
 * Applies the change base→theirs on top of ours when the two changes do not touch the same place.
 * Objects merge by key; arrays of `id`/`uuid` objects merge by that key; anything else changed on both sides conflicts.
 */
export function mergeCreationValues(base: CreationValue, ours: CreationValue, theirs: CreationValue): CreationMergeResult {
  const conflicts: string[] = [];
  const value = mergeAt(base, ours, theirs, '', conflicts);
  return conflicts.length ? { ok: false, conflicts } : { ok: true, value: value ?? null };
}
