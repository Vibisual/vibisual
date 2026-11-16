/**
 * §5.13 (G) 고칠 방법 — op 하나의 모양 검사(문서 없이). 틀린 곳마다 `field`(op 안 경로)·`got`·`allowed` 를 낸다.
 * `validateDoc` 이 보는 허용 값(트랙·아이템 kind·장면 status·전환·ease)은 그 목록을 그대로 써 오류로 낸다. `validateDoc` 이 보지 않는
 * 소재 kind·source.kind 는 적용을 막지 않으므로 경고로만 낸다 — 묶음·미리 검사가 같은 기존 op 열보다 엄하면 안 된다.
 */

import { CHAPTER_STATUSES, ITEM_KINDS, KEYFRAME_EASES, TRACK_KINDS, TRANSITION_DIRECTIONS, TRANSITION_KINDS, isTimeAnchor } from './validateDoc.js';
import { VIDEO_ASSET_KINDS } from './types.js';
import type { PatchFix, VideoDocBundleOp, VideoDocOp } from './types.js';

/** op 안 경로까지만 정한 고칠 방법(요청 순번·묶음 몇 번째는 부르는 쪽이 붙인다). */
export type FixDraft = Omit<PatchFix, 'opIndex' | 'part' | 'op'>;

export const BASE_OP_NAMES: readonly VideoDocOp['op'][] = [
  'addTrack', 'removeTrack', 'updateTrack', 'addItem', 'removeItem', 'updateItem', 'moveItem', 'setAsset', 'removeAsset', 'setDoc',
  'addChapter', 'updateChapter', 'removeChapter', 'moveChapter', 'setChapters',
];
export const BUNDLE_OP_NAMES: readonly VideoDocBundleOp['op'][] = ['addScene', 'fillChapter', 'placeAsset'];
const ASSET_SOURCE_KINDS = ['file', 'external'];

/** 허용 값·있는 id 목록 상한 — 응답이 문서 크기만큼 붓지 않게. */
export const FIX_ALLOWED_MAX = 50;

const ANCHOR_HINT = "Use seconds, { after: itemId, offset? }, { start: itemId, offset? }, { chapter: chapterId, offset? } or { cue, item, offset? } — exactly one kind.";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 응답에 실을 값 — 원시값만, 글은 짧게(객체를 통째로 되돌려 주지 않는다). */
export function gotOf(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return Array.isArray(v) ? '<array>' : `<${typeof v}>`;
}

export function listed(values: readonly (string | number)[]): Pick<PatchFix, 'allowed' | 'allowedTotal'> {
  if (values.length <= FIX_ALLOWED_MAX) return { allowed: values };
  return { allowed: values.slice(0, FIX_ALLOWED_MAX), allowedTotal: values.length };
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function missing(field: string, what: string): FixDraft {
  return { code: 'missing-field', level: 'error', field, got: null, hint: `Add ${field} (${what}).` };
}

/** 꼭 있어야 하는 id 글자. */
function needId(v: unknown, field: string, out: FixDraft[]): void {
  if (v === undefined) out.push(missing(field, 'a non-empty string id'));
  else if (!isId(v)) out.push({ code: 'bad-type', level: 'error', field, got: gotOf(v), hint: `${field} must be a non-empty string id.` });
}

/** 있으면 id 글자여야 한다. */
function optId(v: unknown, field: string, out: FixDraft[]): void {
  if (v !== undefined) needId(v, field, out);
}

function optNumber(v: unknown, field: string, out: FixDraft[]): void {
  if (v !== undefined && !isFiniteNumber(v)) out.push({ code: 'bad-type', level: 'error', field, got: gotOf(v), hint: `${field} must be a number.` });
}

function oneOf(v: unknown, field: string, allowed: readonly string[], out: FixDraft[], required = true): void {
  if (v === undefined) {
    if (required) out.push({ code: 'missing-field', level: 'error', field, got: null, ...listed(allowed), hint: `Add ${field}: one of the allowed values.` });
    return;
  }
  if (typeof v !== 'string' || !allowed.includes(v)) {
    out.push({ code: 'bad-value', level: 'error', field, got: gotOf(v), ...listed(allowed), hint: `${field} must be one of the allowed values.` });
  }
}

/** 적용은 막지 않는 허용 값(validateDoc 이 보지 않는다) — 모르는 값이면 경고 한 줄. */
function knownValue(v: unknown, field: string, allowed: readonly string[], out: FixDraft[]): void {
  if (typeof v === 'string' && allowed.includes(v)) return;
  out.push({
    code: v === undefined ? 'missing-field' : 'unknown-value', level: 'warn', field, got: gotOf(v), ...listed(allowed),
    hint: `${field} is not a known value. It is stored as is, but the studio may not show or play it — use one of the allowed values.`,
  });
}

function needRecord(v: unknown, field: string, shape: string, out: FixDraft[]): v is Record<string, unknown> {
  if (v === undefined) { out.push(missing(field, shape)); return false; }
  if (!isRecord(v)) { out.push({ code: 'bad-type', level: 'error', field, got: gotOf(v), hint: `${field} must be an object ${shape}.` }); return false; }
  return true;
}

function checkAnchor(v: unknown, field: string, out: FixDraft[]): void {
  if (!isTimeAnchor(v)) out.push({ code: 'bad-value', level: 'error', field, got: gotOf(v), hint: ANCHOR_HINT });
}

function checkDuration(v: unknown, field: string, out: FixDraft[]): void {
  if (v === undefined) out.push({ code: 'missing-field', level: 'error', field, got: null, allowed: ['auto'], hint: `Add ${field}: seconds or 'auto'.` });
  else if (v !== 'auto' && !isFiniteNumber(v)) out.push({ code: 'bad-value', level: 'error', field, got: gotOf(v), allowed: ['auto'], hint: `${field} must be seconds (a number) or 'auto'.` });
}

function checkMotion(item: Record<string, unknown>, path: string, out: FixDraft[]): void {
  const keyframes = item['keyframes'];
  if (keyframes !== undefined) {
    if (!Array.isArray(keyframes)) out.push({ code: 'bad-type', level: 'error', field: `${path}.keyframes`, got: gotOf(keyframes), hint: 'keyframes must be an array of { t, dx?, dy?, scale?, rotation?, opacity?, ease? }.' });
    else keyframes.forEach((k, i) => {
      const at = `${path}.keyframes[${i}]`;
      if (!isRecord(k) || !isFiniteNumber(k['t'])) { out.push({ code: 'missing-field', level: 'error', field: `${at}.t`, got: null, hint: 'Every keyframe needs t (seconds from the item start).' }); return; }
      for (const key of ['dx', 'dy', 'scale', 'rotation', 'opacity']) optNumber(k[key], `${at}.${key}`, out);
      oneOf(k['ease'], `${at}.ease`, KEYFRAME_EASES, out, false);
    });
  }
  const effects = item['effects'];
  if (effects !== undefined) {
    if (!Array.isArray(effects)) out.push({ code: 'bad-type', level: 'error', field: `${path}.effects`, got: gotOf(effects), hint: 'effects must be an array of { id, kind, params? }.' });
    else effects.forEach((e, i) => {
      if (!isRecord(e) || !isId(e['kind'])) out.push({ code: 'missing-field', level: 'error', field: `${path}.effects[${i}].kind`, got: null, allowed: ['look', 'color', 'blur', 'vignette'], hint: 'Every effect needs a kind.' });
      else if (e['params'] !== undefined && !isRecord(e['params'])) out.push({ code: 'bad-type', level: 'error', field: `${path}.effects[${i}].params`, got: gotOf(e['params']), hint: 'params must be an object.' });
    });
  }
}

/** 아이템 전체. `needAt` 이 거짓이면 `at` 이 없어도 된다(묶음이 장면 앵커를 붙인다). */
export function checkItem(v: unknown, path: string, out: FixDraft[], needAt = true): void {
  if (!needRecord(v, path, '{ id, kind, at, duration }', out)) return;
  needId(v['id'], `${path}.id`, out);
  oneOf(v['kind'], `${path}.kind`, ITEM_KINDS, out);
  if (v['at'] !== undefined) checkAnchor(v['at'], `${path}.at`, out);
  else if (needAt) out.push({ code: 'missing-field', level: 'error', field: `${path}.at`, got: null, hint: `Add ${path}.at. ${ANCHOR_HINT}` });
  checkDuration(v['duration'], `${path}.duration`, out);
  optId(v['assetId'], `${path}.assetId`, out);
  optId(v['chapterId'], `${path}.chapterId`, out);
  optNumber(v['trimStart'], `${path}.trimStart`, out);
  checkMotion(v, path, out);
}

function checkItemPatch(v: unknown, path: string, out: FixDraft[]): void {
  if (!needRecord(v, path, '(the fields to change)', out)) return;
  if (v['id'] !== undefined) out.push({ code: 'ignored-field', level: 'warn', field: `${path}.id`, got: gotOf(v['id']), hint: 'An item id never changes; it is ignored. To rename, removeItem and addItem with the new id.' });
  if (v['kind'] !== undefined) oneOf(v['kind'], `${path}.kind`, ITEM_KINDS, out);
  if (v['at'] !== undefined) checkAnchor(v['at'], `${path}.at`, out);
  if (v['duration'] !== undefined) checkDuration(v['duration'], `${path}.duration`, out);
  optNumber(v['trimStart'], `${path}.trimStart`, out);
  checkMotion(v, path, out);
}

function checkTrack(v: unknown, path: string, out: FixDraft[]): void {
  if (!needRecord(v, path, '{ id, kind, items }', out)) return;
  needId(v['id'], `${path}.id`, out);
  oneOf(v['kind'], `${path}.kind`, TRACK_KINDS, out);
  const items = v['items'];
  if (!Array.isArray(items)) out.push(items === undefined ? missing(`${path}.items`, 'an array, [] for an empty track') : { code: 'bad-type', level: 'error', field: `${path}.items`, got: gotOf(items), hint: 'items must be an array.' });
  else items.forEach((item, i) => checkItem(item, `${path}.items[${i}]`, out));
}

function checkChapterFields(v: Record<string, unknown>, path: string, out: FixDraft[], whole: boolean): void {
  if (whole || v['title'] !== undefined) {
    if (typeof v['title'] !== 'string') out.push(v['title'] === undefined ? missing(`${path}.title`, 'a string') : { code: 'bad-type', level: 'error', field: `${path}.title`, got: gotOf(v['title']), hint: 'title must be a string.' });
  }
  if (whole || v['duration'] !== undefined) {
    if (!isFiniteNumber(v['duration'])) out.push(v['duration'] === undefined ? missing(`${path}.duration`, 'seconds') : { code: 'bad-type', level: 'error', field: `${path}.duration`, got: gotOf(v['duration']), hint: 'duration must be seconds (a number).' });
  }
  if (whole || v['status'] !== undefined) oneOf(v['status'], `${path}.status`, CHAPTER_STATUSES, out);
  optNumber(v['at'], `${path}.at`, out);
  optNumber(v['offset'], `${path}.offset`, out);
  const tr = v['transition'];
  if (tr !== undefined && needRecord(tr, `${path}.transition`, '{ kind, duration }', out)) {
    oneOf(tr['kind'], `${path}.transition.kind`, TRANSITION_KINDS, out);
    if (!isFiniteNumber(tr['duration'])) out.push(missing(`${path}.transition.duration`, 'seconds'));
    oneOf(tr['direction'], `${path}.transition.direction`, TRANSITION_DIRECTIONS, out, false);
  }
  const frame = v['frame'];
  if (frame !== undefined && needRecord(frame, `${path}.frame`, '{ assetId, t? }', out)) {
    needId(frame['assetId'], `${path}.frame.assetId`, out);
    optNumber(frame['t'], `${path}.frame.t`, out);
  }
  const variants = v['variants'];
  if (variants !== undefined && (!Array.isArray(variants) || variants.some((x) => !isRecord(x) || !isId(x['id'])))) {
    out.push({ code: 'bad-type', level: 'error', field: `${path}.variants`, got: gotOf(variants), hint: 'variants must be an array of { id, engine, status }.' });
  }
}

export function checkChapter(v: unknown, path: string, out: FixDraft[]): void {
  if (!needRecord(v, path, '{ id, title, duration, status }', out)) return;
  needId(v['id'], `${path}.id`, out);
  checkChapterFields(v, path, out, true);
}

export function checkAsset(v: unknown, path: string, out: FixDraft[]): void {
  if (!needRecord(v, path, '{ id, kind, source }', out)) return;
  needId(v['id'], `${path}.id`, out);
  knownValue(v['kind'], `${path}.kind`, VIDEO_ASSET_KINDS, out);
  const source = v['source'];
  if (needRecord(source, `${path}.source`, "{ kind:'file', path }", out)) {
    // 빈 source.kind 는 validateDoc 이 막고, 모르는 글자는 통과시킨다.
    if (isId(source['kind'])) knownValue(source['kind'], `${path}.source.kind`, ASSET_SOURCE_KINDS, out);
    else oneOf(source['kind'], `${path}.source.kind`, ASSET_SOURCE_KINDS, out);
    if (source['kind'] === 'file') needId(source['path'], `${path}.source.path`, out);
    if (source['kind'] === 'external') needId(source['command'], `${path}.source.command`, out);
  }
  optNumber(v['duration'], `${path}.duration`, out);
  if (v['hasAudio'] !== undefined && typeof v['hasAudio'] !== 'boolean') out.push({ code: 'bad-type', level: 'error', field: `${path}.hasAudio`, got: gotOf(v['hasAudio']), hint: 'hasAudio must be true or false.' });
}

function checkDocPatch(v: unknown, out: FixDraft[]): void {
  if (!needRecord(v, 'patch', '{ title?, size?, fps?, seed?, style? }', out)) return;
  if (v['title'] !== undefined && typeof v['title'] !== 'string') out.push({ code: 'bad-type', level: 'error', field: 'patch.title', got: gotOf(v['title']), hint: 'title must be a string.' });
  const size = v['size'];
  if (size !== undefined && (!isRecord(size) || !isFiniteNumber(size['width']) || !isFiniteNumber(size['height']))) {
    out.push({ code: 'bad-type', level: 'error', field: 'patch.size', got: gotOf(size), hint: 'size must be { width, height } in pixels.' });
  }
  if (v['fps'] !== undefined && (!isFiniteNumber(v['fps']) || v['fps'] <= 0)) out.push({ code: 'bad-value', level: 'error', field: 'patch.fps', got: gotOf(v['fps']), hint: 'fps must be a positive number.' });
  optNumber(v['seed'], 'patch.seed', out);
  if (v['style'] !== undefined && v['style'] !== null && !isRecord(v['style'])) out.push({ code: 'bad-type', level: 'error', field: 'patch.style', got: gotOf(v['style']), hint: 'style must be an object, or null to remove it.' });
}

function checkPatchObject(v: unknown, out: FixDraft[]): v is Record<string, unknown> {
  return needRecord(v, 'patch', '(the fields to change)', out);
}

/** 기존 op 15종의 모양. */
function checkBaseOp(op: Record<string, unknown> & { op: VideoDocOp['op'] }, out: FixDraft[]): void {
  switch (op.op) {
    case 'addTrack': checkTrack(op['track'], 'track', out); optId(op['beforeTrackId'], 'beforeTrackId', out); return;
    case 'removeTrack': needId(op['trackId'], 'trackId', out); return;
    case 'updateTrack': {
      needId(op['trackId'], 'trackId', out);
      if (checkPatchObject(op['patch'], out) && op['patch']['kind'] !== undefined) oneOf(op['patch']['kind'], 'patch.kind', TRACK_KINDS, out);
      return;
    }
    case 'addItem': needId(op['trackId'], 'trackId', out); checkItem(op['item'], 'item', out); optId(op['beforeItemId'], 'beforeItemId', out); return;
    case 'removeItem': needId(op['itemId'], 'itemId', out); return;
    case 'updateItem': needId(op['itemId'], 'itemId', out); checkItemPatch(op['patch'], 'patch', out); return;
    case 'moveItem': needId(op['itemId'], 'itemId', out); needId(op['toTrackId'], 'toTrackId', out); optId(op['beforeItemId'], 'beforeItemId', out); return;
    case 'setAsset': checkAsset(op['asset'], 'asset', out); return;
    case 'removeAsset': needId(op['assetId'], 'assetId', out); return;
    case 'setDoc': checkDocPatch(op['patch'], out); return;
    case 'addChapter': checkChapter(op['chapter'], 'chapter', out); optId(op['beforeChapterId'], 'beforeChapterId', out); return;
    case 'updateChapter': {
      needId(op['chapterId'], 'chapterId', out);
      const patch = op['patch'];
      if (checkPatchObject(patch, out)) {
        if (patch['id'] !== undefined) out.push({ code: 'ignored-field', level: 'warn', field: 'patch.id', got: gotOf(patch['id']), hint: 'A chapter id never changes; it is ignored.' });
        checkChapterFields(patch, 'patch', out, false);
      }
      return;
    }
    case 'removeChapter': needId(op['chapterId'], 'chapterId', out); return;
    case 'moveChapter': needId(op['chapterId'], 'chapterId', out); optId(op['beforeChapterId'], 'beforeChapterId', out); return;
    case 'setChapters': {
      const chapters = op['chapters'];
      if (!Array.isArray(chapters)) out.push(chapters === undefined ? missing('chapters', 'an array') : { code: 'bad-type', level: 'error', field: 'chapters', got: gotOf(chapters), hint: 'chapters must be an array.' });
      else chapters.forEach((c, i) => checkChapter(c, `chapters[${i}]`, out));
      return;
    }
    default: {
      const exhaustive: never = op.op;
      void exhaustive;
    }
  }
}

/** 장면 묶음의 아이템 한 줄. `chapterId` 는 그 묶음의 장면(모르면 undefined). */
function checkBundleItem(v: unknown, path: string, chapterId: unknown, out: FixDraft[]): void {
  if (!needRecord(v, path, '{ trackId, item, offset?, beforeItemId? }', out)) return;
  needId(v['trackId'], `${path}.trackId`, out);
  checkItem(v['item'], `${path}.item`, out, false);
  optNumber(v['offset'], `${path}.offset`, out);
  optId(v['beforeItemId'], `${path}.beforeItemId`, out);
  const item = v['item'];
  if (isRecord(item)) {
    if (item['chapterId'] !== undefined && isId(chapterId) && item['chapterId'] !== chapterId) {
      out.push({ code: 'bad-value', level: 'error', field: `${path}.item.chapterId`, got: gotOf(item['chapterId']), allowed: [chapterId], hint: 'Leave chapterId out — the bundle sets it to its chapter.' });
    }
    if (item['at'] !== undefined && v['offset'] !== undefined) {
      out.push({ code: 'ignored-field', level: 'warn', field: `${path}.offset`, got: gotOf(v['offset']), hint: 'offset is ignored because item.at is given.' });
    }
  }
}

function checkBundleList(v: unknown, field: string, each: (x: unknown, path: string) => void, out: FixDraft[]): void {
  if (v === undefined) return;
  if (!Array.isArray(v)) { out.push({ code: 'bad-type', level: 'error', field, got: gotOf(v), hint: `${field} must be an array.` }); return; }
  v.forEach((x, i) => each(x, `${field}[${i}]`));
}

function checkBundleOp(op: Record<string, unknown> & { op: VideoDocBundleOp['op'] }, out: FixDraft[]): void {
  switch (op.op) {
    case 'addScene': {
      checkChapter(op['chapter'], 'chapter', out);
      optId(op['beforeChapterId'], 'beforeChapterId', out);
      const chapterId = isRecord(op['chapter']) ? op['chapter']['id'] : undefined;
      checkBundleList(op['assets'], 'assets', (x, p) => checkAsset(x, p, out), out);
      checkBundleList(op['items'], 'items', (x, p) => checkBundleItem(x, p, chapterId, out), out);
      return;
    }
    case 'fillChapter': {
      needId(op['chapterId'], 'chapterId', out);
      oneOf(op['status'], 'status', CHAPTER_STATUSES, out, false);
      checkBundleList(op['assets'], 'assets', (x, p) => checkAsset(x, p, out), out);
      checkBundleList(op['items'], 'items', (x, p) => checkBundleItem(x, p, op['chapterId'], out), out);
      return;
    }
    case 'placeAsset': {
      checkAsset(op['asset'], 'asset', out);
      needId(op['trackId'], 'trackId', out);
      optId(op['chapterId'], 'chapterId', out);
      optNumber(op['offset'], 'offset', out);
      optId(op['beforeItemId'], 'beforeItemId', out);
      checkItem(op['item'], 'item', out, op['chapterId'] === undefined);
      const item = op['item'];
      const assetId = isRecord(op['asset']) ? op['asset']['id'] : undefined;
      if (isRecord(item)) {
        if (item['assetId'] !== undefined && isId(assetId) && item['assetId'] !== assetId) {
          out.push({ code: 'bad-value', level: 'error', field: 'item.assetId', got: gotOf(item['assetId']), allowed: [assetId], hint: 'Leave item.assetId out — the bundle sets it to asset.id.' });
        }
        if (item['chapterId'] !== undefined && op['chapterId'] !== undefined && item['chapterId'] !== op['chapterId']) {
          out.push({ code: 'bad-value', level: 'error', field: 'item.chapterId', got: gotOf(item['chapterId']), allowed: [String(op['chapterId'])], hint: 'Leave item.chapterId out — the bundle sets it from chapterId.' });
        }
      }
      return;
    }
    default: {
      const exhaustive: never = op.op;
      void exhaustive;
    }
  }
}

export function isBundleOpName(name: unknown): name is VideoDocBundleOp['op'] {
  return typeof name === 'string' && (BUNDLE_OP_NAMES as readonly string[]).includes(name);
}

function isBaseOpName(name: unknown): name is VideoDocOp['op'] {
  return typeof name === 'string' && (BASE_OP_NAMES as readonly string[]).includes(name);
}

/** op 하나의 모양(문서 없이). 틀린 곳마다 한 줄 — 첫 오류에서 멈추지 않는다(한 번에 다 고치게). */
export function checkOpShape(op: unknown): FixDraft[] {
  const out: FixDraft[] = [];
  if (!isRecord(op)) {
    out.push({ code: 'bad-type', level: 'error', field: '', got: gotOf(op), hint: 'Each op must be an object { op: <name>, ... }.' });
    return out;
  }
  const name = op['op'];
  if (isBaseOpName(name)) checkBaseOp(op as Record<string, unknown> & { op: VideoDocOp['op'] }, out);
  else if (isBundleOpName(name)) checkBundleOp(op as Record<string, unknown> & { op: VideoDocBundleOp['op'] }, out);
  else out.push({ code: 'unknown-op', level: 'error', field: 'op', got: gotOf(name), ...listed([...BASE_OP_NAMES, ...BUNDLE_OP_NAMES]), hint: 'Use one of the allowed op names (GET /guide/model).' });
  return out;
}
