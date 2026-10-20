import { stableHash, stableStringify } from './hashItem.js';
import { buildDrawList } from './render/drawList.js';
import { activeItems } from './resolveTimeline.js';
import type { ResolvedTimeline, VideoAsset, VideoDoc, VideoItem, VideoTrack } from './types.js';

/**
 * §5.13 (R-10) — request checks. Every text check together samples at most this many output frames (a total, not
 * per check); what does not fit is reported as unverified, never silently passed.
 */
export const REQUEST_CHECK_FRAME_BUDGET = 20_000;
/** Frames sampled between yields, so a long check never freezes the studio or the server. */
const FRAMES_PER_SLICE = 250;
const MAX_ITEM_IDS = 500;
const MAX_BASE_ITEMS = 5_000;

/** Item signatures at the version a check was made against (what "unchanged" means). */
export interface VideoBaseline { readonly version: number; readonly items: Readonly<Record<string, string>> }
export type VideoRequirement =
  | { id: string; kind: 'ending-text'; text: string; lastSeconds: number; itemId?: string }
  | { id: string; kind: 'source-revision'; assetId: string; sourceId: string; revision: number }
  | { id: string; kind: 'visual'; description: string; evidence?: { framePath: string; at: number; docVersion: number; verdict: 'passed' | 'failed'; note: string } }
  /** Only these items may differ from the base (the user asked to change just the selection). */
  | { id: string; kind: 'selected-only'; itemIds: string[]; base: VideoBaseline }
  /** These items (fixed elements, the person's own edits) must stay exactly as in the base. */
  | { id: string; kind: 'preserved'; itemIds: string[]; base: VideoBaseline };
/** Why a check is not a pass — the screen translates these. */
export type VideoCheckReason = 'frame-budget' | 'scene-text' | 'frame-missing' | 'stale-evidence' | 'not-used' | 'other-items-changed'
  | 'items-changed' | 'items-missing' | 'text-missing' | 'pinned-revision-differs' | 'no-evidence';
export interface VideoRequirementResult {
  id: string; kind: VideoRequirement['kind']; status: 'passed' | 'failed' | 'unverified'; evidence: string; at?: number; reason?: VideoCheckReason;
}
export interface VideoCheckOptions {
  /** Whether a frame file named as visual evidence exists (project-relative). Without it the file is not trusted. */
  readonly frameExists?: (path: string) => boolean | Promise<boolean>;
  readonly signal?: AbortSignal;
  readonly budget?: number;
  /** Gives the event loop a turn; tests pass a synchronous no-op. */
  readonly yieldNow?: () => Promise<void>;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function validBaseline(value: unknown): value is VideoBaseline {
  if (!record(value) || typeof value['version'] !== 'number' || !Number.isInteger(value['version']) || value['version'] < 0 || !record(value['items'])) return false;
  const entries = Object.entries(value['items']);
  return entries.length <= MAX_BASE_ITEMS && entries.every(([key, hash]) => key.length > 0 && key.length <= 200 && typeof hash === 'string' && /^[0-9a-f]{16}$/.test(hash));
}
function validItemIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_ITEM_IDS && value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200);
}
function validEvidence(evidence: unknown): boolean {
  if (evidence === undefined) return true;
  if (!record(evidence)) return false;
  const path = evidence['framePath'];
  return typeof path === 'string' && !!path && !/^(?:[a-z]+:|[\\/])/i.test(path) && !path.split(/[\\/]/).includes('..')
    && typeof evidence['at'] === 'number' && Number.isFinite(evidence['at']) && evidence['at'] >= 0
    && typeof evidence['docVersion'] === 'number' && Number.isInteger(evidence['docVersion']) && evidence['docVersion'] > 0
    && ['passed', 'failed'].includes(String(evidence['verdict'])) && typeof evidence['note'] === 'string';
}

export function validVideoRequirements(value: unknown): value is VideoRequirement[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  const ids = new Set<string>();
  const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  return value.every(entry => {
    if (!record(entry) || typeof entry['id'] !== 'string' || !entry['id'] || ids.has(entry['id'])) return false;
    ids.add(entry['id']);
    switch (entry['kind']) {
      case 'ending-text':
        return typeof entry['text'] === 'string' && entry['text'].length <= 500 && positive(entry['lastSeconds'])
          && (entry['itemId'] === undefined || typeof entry['itemId'] === 'string');
      case 'source-revision':
        return typeof entry['assetId'] === 'string' && typeof entry['sourceId'] === 'string' && positive(entry['revision']) && Number.isInteger(entry['revision']);
      case 'visual': return typeof entry['description'] === 'string' && validEvidence(entry['evidence']);
      case 'selected-only': case 'preserved': return validItemIds(entry['itemIds']) && validBaseline(entry['base']);
      default: return false;
    }
  });
}

/** What an item draws and where it sits: its whole description, its track's visibility and its asset's identity. */
export function videoItemSignature(item: VideoItem, track: Pick<VideoTrack, 'id' | 'hidden' | 'muted'>, assets: Readonly<Record<string, VideoAsset>>): string {
  const asset = item.assetId === undefined ? undefined : assets[item.assetId];
  return stableHash(stableStringify({
    item, track: { id: track.id, hidden: track.hidden === true, muted: track.muted === true },
    asset: asset ? { kind: asset.kind, source: asset.source, contentHash: asset.contentHash, creationSource: asset.creationSource } : null,
  }));
}
/** Signatures of every item (or only `itemIds`) at this version — the base a selected-only / preserved check compares with. */
export function videoBaseline(doc: VideoDoc, itemIds?: readonly string[]): VideoBaseline {
  const wanted = itemIds ? new Set(itemIds) : null;
  const items: Record<string, string> = {};
  for (const track of doc.tracks) {
    for (const item of track.items) if (!wanted || wanted.has(item.id)) items[item.id] = videoItemSignature(item, track, doc.assets);
  }
  return { version: doc.version, items };
}
function currentSignatures(doc: VideoDoc): Map<string, string> {
  const result = new Map<string, string>();
  for (const track of doc.tracks) for (const item of track.items) result.set(item.id, videoItemSignature(item, track, doc.assets));
  return result;
}
function itemLabel(doc: VideoDoc, id: string): string {
  for (const track of doc.tracks) { const item = track.items.find((entry) => entry.id === id); if (item) return item.label || id; }
  return id;
}
const defaultYield = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Text presence is a document/frame-timing check, never a claim about legibility, occlusion, or visual identity.
 * Asynchronous: text checks share one frame budget and yield every few hundred frames.
 */
export async function checkVideoRequirements(doc: VideoDoc, timeline: ResolvedTimeline, options: VideoCheckOptions = {}): Promise<VideoRequirementResult[]> {
  let remaining = options.budget ?? REQUEST_CHECK_FRAME_BUDGET;
  const yieldNow = options.yieldNow ?? defaultYield;
  const signatures = (doc.requirements ?? []).some((r) => r.kind === 'selected-only' || r.kind === 'preserved') ? currentSignatures(doc) : null;
  const results: VideoRequirementResult[] = [];
  for (const requirement of doc.requirements ?? []) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
    const base = { id: requirement.id, kind: requirement.kind };
    if (requirement.kind === 'visual') {
      const evidence = requirement.evidence;
      if (!evidence) { results.push({ ...base, status: 'unverified', evidence: '', reason: 'no-evidence' }); continue; }
      if (evidence.docVersion !== doc.version) { results.push({ ...base, status: 'unverified', evidence: evidence.framePath, at: evidence.at, reason: 'stale-evidence' }); continue; }
      // A verdict counts only with the frame it was judged on: a named file that is not there is not evidence.
      const exists = options.frameExists ? await options.frameExists(evidence.framePath) : false;
      results.push(exists ? { ...base, status: evidence.verdict, evidence: evidence.framePath, at: evidence.at }
        : { ...base, status: 'unverified', evidence: evidence.framePath, at: evidence.at, reason: 'frame-missing' });
      continue;
    }
    if (requirement.kind === 'source-revision') {
      const ref = doc.assets[requirement.assetId]?.creationSource;
      const evidence = `${requirement.sourceId}@${requirement.revision}`;
      if (ref?.id !== requirement.sourceId || ref.revision !== requirement.revision) { results.push({ ...base, status: 'failed', evidence, reason: 'pinned-revision-differs' }); continue; }
      // The pinned asset must actually be in the picture: an enabled item on a visible track, in the chosen variant.
      const used = activeItems(doc, timeline).some((entry) => entry.item.assetId === requirement.assetId);
      results.push(used ? { ...base, status: 'passed', evidence } : { ...base, status: 'failed', evidence, reason: 'not-used' });
      continue;
    }
    if (requirement.kind === 'selected-only' || requirement.kind === 'preserved') {
      const now = signatures!;
      const allowed = new Set(requirement.itemIds);
      if (requirement.kind === 'selected-only') {
        const ids = new Set([...Object.keys(requirement.base.items), ...now.keys()]);
        const changed = [...ids].filter((id) => !allowed.has(id) && requirement.base.items[id] !== now.get(id));
        results.push(changed.length ? { ...base, status: 'failed', evidence: changed.slice(0, 10).map((id) => itemLabel(doc, id)).join(', '), reason: 'other-items-changed' }
          : { ...base, status: 'passed', evidence: requirement.itemIds.map((id) => itemLabel(doc, id)).join(', ') });
      } else {
        const missing = requirement.itemIds.filter((id) => !now.has(id));
        const changed = requirement.itemIds.filter((id) => now.has(id) && requirement.base.items[id] !== now.get(id));
        results.push(missing.length ? { ...base, status: 'failed', evidence: missing.slice(0, 10).join(', '), reason: 'items-missing' }
          : changed.length ? { ...base, status: 'failed', evidence: changed.slice(0, 10).map((id) => itemLabel(doc, id)).join(', '), reason: 'items-changed' }
            : { ...base, status: 'passed', evidence: requirement.itemIds.map((id) => itemLabel(doc, id)).join(', ') });
      }
      continue;
    }
    const start = Math.max(0, timeline.duration - requirement.lastSeconds);
    if (requirement.text.trim() === '' || requirement.lastSeconds <= 0 || requirement.lastSeconds > timeline.duration || timeline.duration <= 0) {
      results.push({ ...base, status: 'failed', evidence: requirement.text, at: start, reason: 'text-missing' });
      continue;
    }
    const first = Math.ceil(start * doc.fps);
    const end = Math.ceil(timeline.duration * doc.fps);
    if (end - first > remaining) { results.push({ ...base, status: 'unverified', evidence: requirement.text, at: start, reason: 'frame-budget' }); continue; }
    remaining -= end - first;
    // Sample every output frame, exactly as export does, including keyframe opacity and variant selection.
    let failedAt: number | null = null;
    let unverifiableAt: number | null = null;
    for (let frame = first; frame < end; frame += 1) {
      if ((frame - first) % FRAMES_PER_SLICE === FRAMES_PER_SLICE - 1) {
        await yieldNow();
        if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
      }
      const t = frame / doc.fps;
      let found = false;
      let opaque = false;
      for (const op of buildDrawList(doc, timeline, t)) {
        if (requirement.itemId && op.itemId !== requirement.itemId) continue;
        if (op.transform.opacity <= 0 || op.transform.scale <= 0 || op.transform.width <= 0 || op.transform.height <= 0) continue;
        // Scene components and HTML compositions draw their own text: the document cannot tell what they show.
        if (op.kind === 'scene' || op.kind === 'composition') { opaque = true; continue; }
        const text = op.kind === 'text' ? op.resolved.item.props?.['text'] : op.kind === 'caption' ? op.cues.map(cue => cue.text).join(' ') : '';
        if (typeof text === 'string' && text.includes(requirement.text)) { found = true; break; }
      }
      if (found) continue;
      if (opaque) { unverifiableAt ??= t; continue; }
      failedAt = t;
      break;
    }
    if (failedAt !== null) results.push({ ...base, status: 'failed', evidence: requirement.text, at: failedAt, reason: 'text-missing' });
    else if (unverifiableAt !== null) results.push({ ...base, status: 'unverified', evidence: requirement.text, at: unverifiableAt, reason: 'scene-text' });
    else results.push({ ...base, status: 'passed', evidence: requirement.text, at: start });
  }
  return results;
}
