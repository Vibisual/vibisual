/**
 * §5.13 (G) 고칠 방법 `fix[]` — 409·invalid-op·해소 진단에 "무엇이 틀렸나 / 어떻게 고치나"를 기계가 읽는 모양으로 더한다.
 * 순수(문서 → 줄). 기존 응답 필드는 만들지 않는다 — 부르는 쪽이 `fix` 만 더한다.
 */

import { applyDocOp } from './ops.js';
import { placeFix, type ExpandedPatch } from './patchBundles.js';
import { checkOpShape, gotOf, isRecord, listed, type FixDraft } from './patchShape.js';
import { validateDoc } from './validateDoc.js';
import type { PatchFix, ResolveDiagnostic, VideoDoc, VideoItem } from './types.js';

interface DocIds {
  readonly tracks: string[];
  readonly items: string[];
  readonly chapters: string[];
  readonly assets: string[];
}

function idsOf(doc: VideoDoc): DocIds {
  return {
    tracks: doc.tracks.map((t) => t.id),
    items: doc.tracks.flatMap((t) => t.items.map((i) => i.id)),
    chapters: (doc.chapters ?? []).map((c) => c.id),
    assets: Object.keys(doc.assets),
  };
}

function unknownId(field: string, got: unknown, ids: readonly string[], what: string): FixDraft {
  return {
    code: 'unknown-id', level: 'error', field, got: gotOf(got), ...listed(ids),
    hint: `No ${what} with this id in the current version. Use an allowed id, or add the ${what} earlier in the same patch.`,
  };
}

function duplicateId(field: string, got: unknown, what: string): FixDraft {
  return { code: 'duplicate-id', level: 'error', field, got: gotOf(got), hint: `A ${what} with this id already exists. Choose a new id, or change the existing ${what} instead.` };
}

/** 적용이 실패한 op 의 이유(그 op 직전 상태 기준) — id 가 없거나 겹친다. */
function explainFailure(doc: VideoDoc, op: Record<string, unknown>): FixDraft[] {
  const ids = idsOf(doc);
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  switch (op['op']) {
    case 'addTrack': {
      const track = isRecord(op['track']) ? op['track'] : {};
      if (ids.tracks.includes(str(track['id']))) return [duplicateId('track.id', track['id'], 'track')];
      const items = Array.isArray(track['items']) ? track['items'] : [];
      const k = items.findIndex((it) => isRecord(it) && ids.items.includes(str(it['id'])));
      return k >= 0 ? [duplicateId(`track.items[${k}].id`, (items[k] as Record<string, unknown>)['id'], 'item')] : [];
    }
    case 'removeTrack':
    case 'updateTrack':
      return [unknownId('trackId', op['trackId'], ids.tracks, 'track')];
    case 'addItem': {
      if (!ids.tracks.includes(str(op['trackId']))) return [unknownId('trackId', op['trackId'], ids.tracks, 'track')];
      const item = isRecord(op['item']) ? op['item'] : {};
      return ids.items.includes(str(item['id'])) ? [duplicateId('item.id', item['id'], 'item')] : [];
    }
    case 'removeItem':
    case 'updateItem':
      return [unknownId('itemId', op['itemId'], ids.items, 'item')];
    case 'moveItem':
      return ids.items.includes(str(op['itemId']))
        ? [unknownId('toTrackId', op['toTrackId'], ids.tracks, 'track')]
        : [unknownId('itemId', op['itemId'], ids.items, 'item')];
    case 'removeAsset':
      return [unknownId('assetId', op['assetId'], ids.assets, 'asset')];
    case 'addChapter': {
      const chapter = isRecord(op['chapter']) ? op['chapter'] : {};
      return [duplicateId('chapter.id', chapter['id'], 'chapter')];
    }
    case 'updateChapter':
    case 'removeChapter':
    case 'moveChapter':
      return [unknownId('chapterId', op['chapterId'], ids.chapters, 'chapter')];
    case 'setChapters': {
      const list = Array.isArray(op['chapters']) ? op['chapters'] : [];
      const seen = new Set<string>();
      for (let k = 0; k < list.length; k += 1) {
        const id = isRecord(list[k]) ? str((list[k] as Record<string, unknown>)['id']) : '';
        if (seen.has(id)) return [{ code: 'duplicate-id', level: 'error', field: `chapters[${k}].id`, got: gotOf(id), hint: 'This chapter id appears twice in the list. Give each chapter its own id.' }];
        seen.add(id);
      }
      return [];
    }
    default:
      return [];
  }
}

/** 적용은 되지만 뜻과 다를 수 있는 것 — 앞에 둘 대상이 없으면 끝에 붙는다(종전 동작). */
function refWarnings(doc: VideoDoc, op: Record<string, unknown>): FixDraft[] {
  const warn = (field: string, got: unknown, ids: readonly string[], what: string): FixDraft => ({
    code: 'unknown-id', level: 'warn', field, got: gotOf(got), ...listed(ids), hint: `No ${what} with this id here, so it goes to the end. Use an allowed id or leave ${field} out.`,
  });
  const name = op['op'];
  if (name === 'addTrack' && op['beforeTrackId'] !== undefined) {
    const ids = doc.tracks.map((t) => t.id);
    if (!ids.includes(String(op['beforeTrackId']))) return [warn('beforeTrackId', op['beforeTrackId'], ids, 'track')];
  }
  if ((name === 'addItem' || name === 'moveItem') && op['beforeItemId'] !== undefined) {
    const track = doc.tracks.find((t) => t.id === (name === 'addItem' ? op['trackId'] : op['toTrackId']));
    const ids = (track?.items ?? []).map((i) => i.id).filter((id) => id !== op['itemId']);
    if (!ids.includes(String(op['beforeItemId']))) return [warn('beforeItemId', op['beforeItemId'], ids, 'item on that track')];
  }
  if ((name === 'addChapter' || name === 'moveChapter') && op['beforeChapterId'] !== undefined) {
    const ids = (doc.chapters ?? []).map((c) => c.id).filter((id) => id !== op['chapterId']);
    if (!ids.includes(String(op['beforeChapterId']))) return [warn('beforeChapterId', op['beforeChapterId'], ids, 'chapter')];
  }
  return [];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => a[k] !== undefined || b[k] !== undefined));
  return [...keys].every((k) => sameValue(a[k], b[k]));
}

function describeValue(v: unknown): string {
  if (isRecord(v) && typeof v['kind'] === 'string' && (typeof v['path'] === 'string' || typeof v['command'] === 'string')) {
    return `${v['kind']} ${String(v['path'] ?? v['command'])}`;
  }
  const got = gotOf(v);
  return got === null ? '(none)' : String(got);
}

/**
 * 묶음 안 setAsset 이 이미 있는 소재 id 를 다른 내용으로 덮는다 — 동작은 기존 setAsset 과 같아 막지 않고 알리기만 한다.
 * 같은 내용 재전송은 조용히 둔다. 손으로 쓴 setAsset 은 고치려고 덮는 길이라 대상이 아니다.
 */
function overwriteWarnings(doc: VideoDoc, op: unknown): FixDraft[] {
  if (!isRecord(op) || op['op'] !== 'setAsset' || !isRecord(op['asset'])) return [];
  const next = op['asset'];
  const id = typeof next['id'] === 'string' ? next['id'] : '';
  const prev = Object.prototype.hasOwnProperty.call(doc.assets, id) ? (doc.assets[id] as unknown as Record<string, unknown>) : undefined;
  if (!prev || sameValue(prev, next)) return [];
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter((k) => !sameValue(prev[k], next[k]));
  const changes = keys.slice(0, 5).map((k) => `${k}: ${describeValue(prev[k])} -> ${describeValue(next[k])}`).join('; ');
  return [{
    code: 'asset-overwrite', level: 'warn', field: 'asset.id', got: id,
    hint: `Asset '${id}' already exists and this replaces it (${changes}). Every item using '${id}' changes too. For a new asset, use a new id.`,
  }];
}

export interface SimulateResult {
  readonly fixes: readonly PatchFix[];
  /** 적용에 실패한 op 수(실패한 op 는 건너뛰고 끝까지 대 본다). */
  readonly failed: number;
}

/**
 * op 를 하나씩 대 본다 — 실패한 op 는 건너뛰고 끝까지 가서 틀린 곳을 한 번에 모은다(종전 응답은 첫 실패 하나뿐이었다).
 * 건너뛴 op 에 기대던 뒤 op 도 실패로 잡힐 수 있다 — 앞 줄부터 고치면 된다.
 */
export function simulateOps(doc: VideoDoc, expanded: ExpandedPatch): SimulateResult {
  let state = doc;
  const fixes: PatchFix[] = [];
  let failed = 0;
  expanded.ops.forEach((op, k) => {
    const origin = expanded.origin[k] ?? { opIndex: k, op: '' };
    // applyPatch 가 빈 자리는 건너뛴다 — 같은 판정으로.
    if (!op) {
      fixes.push(placeFix({ code: 'empty-op', level: 'warn', got: gotOf(op), hint: 'This op is empty and is skipped. Remove it.' }, origin));
      return;
    }
    // 묶음은 풀기 전에 오류를 이미 봤다 — 풀린 op 에서는 경고(모르는 소재 kind 등)만 더 줍는다.
    const shape = origin.part === undefined ? checkOpShape(op) : checkOpShape(op).filter((d) => d.level === 'warn');
    const overwrite = origin.part !== undefined ? overwriteWarnings(state, op) : [];
    const outcome = applyDocOp(state, op);
    if (!outcome.ok) {
      failed += 1;
      const shapeErrors = shape.filter((d) => d.level === 'error');
      const drafts = shapeErrors.length > 0 ? shapeErrors : isRecord(op) ? explainFailure(state, op) : [];
      const list = drafts.length > 0 ? drafts : [{ code: 'op-failed', level: 'error' as const, got: null, hint: outcome.message }];
      fixes.push(...list.map((d) => placeFix(d, origin)));
      return;
    }
    fixes.push(...shape.map((d) => placeFix(d, origin)), ...overwrite.map((d) => placeFix(d, origin)), ...refWarnings(state, op as unknown as Record<string, unknown>).map((d) => placeFix(d, origin)));
    state = outcome.doc;
  });
  return { fixes, failed };
}

/** 409 — 판본 한 줄 + 지금 판본에 ops 를 대 본 결과(다시 읽고 무엇을 고쳐야 하는지까지). */
export function versionConflictFix(baseVersion: unknown, doc: VideoDoc, expanded: ExpandedPatch): PatchFix[] {
  const sim = simulateOps(doc, expanded);
  const v = doc.version;
  const hint = sim.failed === 0
    ? `The document is now at version ${v}. GET it again and check that your ops still mean the same; they apply cleanly to version ${v}, so resend with baseVersion ${v} if they do.`
    : `The document is now at version ${v}. GET it again; some ops do not fit version ${v} (see the other entries) — rebuild them and resend with baseVersion ${v}.`;
  return [{ code: 'version-conflict', level: 'error', field: 'baseVersion', got: gotOf(baseVersion), currentVersion: v, hint }, ...sim.fixes];
}

/** 400 — 본문에 `baseVersion`·`ops` 가 없거나 모양이 틀렸다. */
export function bodyFix(body: { baseVersion?: unknown; ops?: unknown }, currentVersion: number): PatchFix[] {
  const out: PatchFix[] = [];
  if (typeof body.baseVersion !== 'number') {
    out.push({
      code: body.baseVersion === undefined ? 'missing-field' : 'bad-type', level: 'error', field: 'baseVersion', got: gotOf(body.baseVersion), currentVersion,
      hint: `Send baseVersion: the version of the document you read (now ${currentVersion}).`,
    });
  }
  if (!Array.isArray(body.ops)) {
    out.push({ code: body.ops === undefined ? 'missing-field' : 'bad-type', level: 'error', field: 'ops', got: gotOf(body.ops), hint: 'Send ops: an array of ops (GET /guide/model).' });
  }
  return out;
}

/** 적용 결과가 구조 검증을 통과하지 못하면(다시 읽을 수 없는 문서) 그 이유. */
export function docUnreadableFix(next: VideoDoc): PatchFix[] {
  const result = validateDoc(next);
  if (result.ok) return [];
  return result.errors.slice(0, 5).map((message) => ({
    code: 'doc-unreadable', level: 'error' as const, got: gotOf(message),
    hint: 'After this patch the document would fail its structure check and could not be read back. Fix the op fields reported above.',
  }));
}

function anchorRef(at: VideoItem['at']): { field: string; ref: string } | null {
  if (typeof at === 'number') return null;
  if ('after' in at) return { field: 'item.at.after', ref: at.after };
  if ('start' in at) return { field: 'item.at.start', ref: at.start };
  if ('cue' in at) return { field: 'item.at.item', ref: at.item };
  return null;
}

const diagKey = (d: ResolveDiagnostic): string => `${d.code}|${d.itemId ?? ''}|${d.message}`;

/**
 * 해소 진단마다 고칠 방법 한 줄(`diagnostic` = 그 진단의 순번). `before` 를 주면 이 patch 가 새로 낳은 진단에 `introduced`.
 * 장면 진단은 장면 id 를 싣지 않으므로 같은 조건을 문서 순서로 다시 세어 짝짓는다(해소기도 장면을 문서 순서로 돈다).
 */
export function diagnosticFixes(doc: VideoDoc, diagnostics: readonly ResolveDiagnostic[], before?: readonly ResolveDiagnostic[]): PatchFix[] {
  if (diagnostics.length === 0) return [];
  const items = new Map<string, VideoItem>();
  for (const track of doc.tracks) for (const item of track.items) if (!items.has(item.id)) items.set(item.id, item);
  const itemIds = [...items.keys()];
  const assetIds = Object.keys(doc.assets);
  const compositionIds = assetIds.filter((id) => doc.assets[id]?.kind === 'composition');
  const chapters = doc.chapters ?? [];
  const badDuration = chapters.filter((c) => !(typeof c.duration === 'number' && Number.isFinite(c.duration) && c.duration >= 0));
  const badFrame = chapters.filter((c) => c.frame !== undefined && doc.assets[c.frame.assetId]?.kind !== 'composition');
  let durationSeen = 0;
  let frameSeen = 0;
  const pending = new Map<string, number>();
  for (const d of before ?? []) pending.set(diagKey(d), (pending.get(diagKey(d)) ?? 0) + 1);

  return diagnostics.map((d, index): PatchFix => {
    let introduced: boolean | undefined;
    if (before) {
      const left = pending.get(diagKey(d)) ?? 0;
      introduced = left === 0;
      if (left > 0) pending.set(diagKey(d), left - 1);
    }
    const base = { code: d.code, level: d.level, diagnostic: index, ...(d.itemId !== undefined ? { itemId: d.itemId } : {}), ...(introduced !== undefined ? { introduced } : {}) };
    const item = d.itemId !== undefined ? items.get(d.itemId) : undefined;
    const others = itemIds.filter((id) => id !== d.itemId);
    switch (d.code) {
      case 'duplicate-item-id':
        return { ...base, field: 'item.id', hint: 'Two items share this id. removeItem one of them and addItem it again with a new id.' };
      case 'unknown-anchor': {
        const ref = item ? anchorRef(item.at) : null;
        return { ...base, field: ref?.field ?? 'item.at', got: gotOf(ref?.ref), ...listed(others), hint: 'The anchor points at an item that does not exist. updateItem at to an allowed item id, a chapter anchor or seconds.' };
      }
      case 'anchor-cycle':
        return { ...base, field: 'item.at', hint: 'These items anchor to each other in a loop. Anchor one of them to seconds or to its chapter.' };
      case 'unknown-asset':
        return { ...base, field: 'item.assetId', got: gotOf(item?.assetId), ...listed(item?.kind === 'composition' ? compositionIds : assetIds), hint: 'Point assetId at an existing asset (allowed), or setAsset it in the same patch.' };
      case 'auto-without-source':
        return { ...base, field: 'item.duration', got: 'auto', hint: "duration 'auto' needs an assetId with a measured length. Give seconds instead." };
      case 'auto-without-duration':
        return { ...base, field: 'item.duration', got: 'auto', hint: "The asset has no measured length yet. POST /composition/probe (compositions) or /assets/import, or give seconds." };
      case 'negative-duration':
        return { ...base, field: 'item.duration', got: gotOf(item?.duration), hint: "Use seconds >= 0 or 'auto'." };
      case 'negative-start':
        return { ...base, field: 'item.at', hint: 'The item would start before 0 s. Raise at (or its offset).' };
      case 'empty-caption':
        return { ...base, field: 'item.cues', hint: "A caption with duration 'auto' needs cues [{ start, end, text }], or give seconds." };
      case 'composition-asset-kind':
        return { ...base, field: 'item.assetId', got: gotOf(item?.assetId), ...listed(compositionIds), hint: "A composition item must point at a kind:'composition' asset." };
      case 'composition-not-html':
      case 'composition-outside-project': {
        const asset = item?.assetId !== undefined ? doc.assets[item.assetId] : undefined;
        const path = asset?.source.kind === 'file' ? asset.source.path : undefined;
        return { ...base, field: 'asset.source.path', got: gotOf(path), hint: 'A composition asset must be a project-relative .html file (no absolute path, no ..). POST /composition makes one.' };
      }
      case 'unknown-chapter': {
        const ref = item && typeof item.at !== 'number' && 'chapter' in item.at ? item.at.chapter : undefined;
        return { ...base, field: 'item.at.chapter', got: gotOf(ref), ...listed(chapters.map((c) => c.id)), hint: 'The chapter anchor points at a chapter that does not exist. Use an allowed chapter id (and set chapterId to match).' };
      }
      case 'chapter-bad-duration': {
        const chapter = badDuration[durationSeen++];
        return { ...base, ...(chapter ? { chapterId: chapter.id } : {}), field: 'chapter.duration', got: gotOf(chapter?.duration), hint: 'updateChapter the duration to seconds >= 0.' };
      }
      case 'chapter-frame-asset': {
        const chapter = badFrame[frameSeen++];
        return { ...base, ...(chapter ? { chapterId: chapter.id } : {}), field: 'chapter.frame.assetId', got: gotOf(chapter?.frame?.assetId), ...listed(compositionIds), hint: 'The style frame must be a composition asset of this document.' };
      }
      case 'cue-missing': {
        const at = item && typeof item.at !== 'number' && 'cue' in item.at ? item.at : undefined;
        const source = at ? items.get(at.item) : undefined;
        const cues = source?.assetId !== undefined ? (doc.assets[source.assetId]?.cues ?? []).map((c) => c.name) : [];
        return { ...base, field: 'item.at.cue', got: gotOf(at?.cue), ...listed(cues), hint: "Use a cue that composition announces (allowed), or call window.__vibi.cue('<name>') in its code and probe again." };
      }
      case 'cue-outside':
        return { ...base, field: 'item.at.offset', hint: 'The cue falls outside the visible part of its composition item (trimmed). Change trimStart or anchor elsewhere.' };
      case 'cue-duplicate':
      case 'cues-truncated':
      case 'cue-error':
        return { ...base, hint: 'Fix the composition code (one name per moment, no errors while it plays), then probe again.' };
      default:
        return { ...base, hint: d.message };
    }
  });
}

/** 그대로 보내도 되는가 — 이미 있던 진단 말고는 오류가 없다. */
export function isSafeFix(fix: readonly PatchFix[]): boolean {
  return fix.every((f) => f.level !== 'error' || (f.diagnostic !== undefined && f.introduced === false));
}

