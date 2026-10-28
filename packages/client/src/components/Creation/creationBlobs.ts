import {
  CREATION_API_PREFIX,
  CREATION_BLOB_MIME,
  planCreationExternalization,
  resolveCreationValue,
  type CreationBinary,
  type CreationBlobName,
  type CreationValue,
} from '@vibisual/shared';

/**
 * §5.13 (R-10) — large binaries live outside the payload: data URLs and long number arrays are hashed, only missing blobs are
 * uploaded (raw bytes), the payload keeps `vibi-blob:` references. Blobs are immutable (hash-named), so a byte-budgeted cache is always correct.
 */
const BLOBS = `${CREATION_API_PREFIX}/blobs`;
const query = (projectId: string): string => `projectId=${encodeURIComponent(projectId)}`;

export class CreationBlobError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

/** Blobs this window already knows the project has (hash names are global truths). */
const knownPresent = new Map<string, Set<string>>();
function present(projectId: string): Set<string> {
  let set = knownPresent.get(projectId);
  if (!set) { set = new Set(); knownPresent.set(projectId, set); }
  return set;
}
/** The server cleanup may remove a blob nothing referenced; forget what this window assumed and ask again. */
export function forgetKnownBlobs(projectId: string): void {
  knownPresent.delete(projectId);
}

async function missing(projectId: string, names: string[]): Promise<Set<string>> {
  const unknown = names.filter((name) => !present(projectId).has(name));
  if (!unknown.length) return new Set();
  const response = await fetch(`${BLOBS}/missing`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, names: unknown }),
  });
  const data = await response.json().catch(() => ({})) as { missing?: string[]; error?: string };
  if (!response.ok || !Array.isArray(data.missing)) throw new CreationBlobError(data.error ?? 'blob-upload-failed');
  const result = new Set(data.missing);
  for (const name of unknown) if (!result.has(name)) present(projectId).add(name);
  return result;
}

async function upload(projectId: string, binary: CreationBinary): Promise<string> {
  const response = await fetch(`${BLOBS}?${query(projectId)}&ext=${binary.ext}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([binary.bytes as unknown as BlobPart]),
  });
  const data = await response.json().catch(() => ({})) as { ref?: string; error?: string };
  if (!response.ok || !data.ref) throw new CreationBlobError(data.error ?? 'blob-upload-failed');
  return data.ref;
}

/** Moves inline binaries of a payload into the project's blob store; returns the payload with references. */
export async function externalizeForSave(projectId: string, value: CreationValue, options?: Parameters<typeof planCreationExternalization>[1]): Promise<CreationValue> {
  const plan = planCreationExternalization(value, options);
  if (!plan.jobs.length) return plan.root;
  const named = await Promise.all(plan.jobs.map(async (job) => ({ job, name: `${await sha256Hex(job.input.bytes)}.${job.input.ext}` })));
  const absent = await missing(projectId, [...new Set(named.map((entry) => entry.name))]);
  const uploaded = new Map<string, Promise<string>>();
  for (const { job, name } of named) {
    if (absent.has(name)) {
      let ref = uploaded.get(name);
      if (!ref) { ref = upload(projectId, job.input); uploaded.set(name, ref); }
      job.assign(await ref);
      present(projectId).add(name);
    } else job.assign(`vibi-blob:${name}`);
  }
  return plan.root;
}

const CACHE_BUDGET_BYTES = 96 * 1024 * 1024;
const cache = new Map<string, { bytes: Promise<Uint8Array>; size: number }>();
let cached = 0;
function remember(key: string, bytes: Promise<Uint8Array>): Promise<Uint8Array> {
  const entry = { bytes, size: 0 };
  cache.set(key, entry);
  void bytes.then((value) => {
    if (cache.get(key) !== entry) return;
    entry.size = value.byteLength;
    cached += value.byteLength;
    for (const [oldKey, old] of cache) {
      if (cached <= CACHE_BUDGET_BYTES || oldKey === key) break;
      cache.delete(oldKey);
      cached -= old.size;
    }
  }, () => { if (cache.get(key) === entry) cache.delete(key); });
  return bytes;
}

export function creationBlobUrl(projectId: string, name: string): string {
  return `${BLOBS}/${encodeURIComponent(name)}?${query(projectId)}`;
}
/** Immutable bytes of one blob (cached by project + name, least recently used dropped beyond the budget). */
export function fetchCreationBlob(projectId: string, name: string): Promise<Uint8Array> {
  const key = `${projectId}\u0000${name}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit.bytes; }
  return remember(key, fetch(creationBlobUrl(projectId, name)).then(async (response) => {
    if (!response.ok) throw new CreationBlobError(response.status === 404 ? 'blob-not-found' : 'blob-read-failed');
    return new Uint8Array(await response.arrayBuffer());
  }));
}
export async function creationBlobObject(projectId: string, ref: CreationBlobName): Promise<Blob> {
  const bytes = await fetchCreationBlob(projectId, ref.name);
  return new Blob([bytes as unknown as BlobPart], { type: CREATION_BLOB_MIME[ref.ext] });
}
/** Payload with every reference inlined again (number arrays, data URLs) — for renderers and exports. */
export function resolveCreationBlobs(projectId: string, value: CreationValue): Promise<CreationValue> {
  return resolveCreationValue(value, (ref) => fetchCreationBlob(projectId, ref.name));
}
