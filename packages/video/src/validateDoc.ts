/**
 * 문서 구조 검증(§5.13 (I)) — 디스크 JSON 은 믿지 않는다(타입 단언으로 넘기면 렌더 한참 뒤 엉뚱한 자리에서 터진다).
 * 의미 검사(`resolveTimeline`)와 합치지 않는다 — 구조가 깨진 문서에 의미 검사를 돌리면 오류가 쏟아져 원인이 묻힌다.
 */

import { VIDEO_MAX_ITEMS, VIDEO_SCHEMA_VERSION } from './constants.js';
import { validVideoRequirements } from './requestReview.js';
import type { TimeAnchor, VideoDoc, VideoItemKind, VideoTrackKind } from './types.js';

const TRACK_KINDS: readonly VideoTrackKind[] = ['visual', 'audio', 'caption'];
const ITEM_KINDS: readonly VideoItemKind[] = [
  'scene',
  'footage',
  'image',
  'model',
  'audio',
  'caption',
  'shape',
  'text',
  // §5.13 (T-1) — 코드 컴포지션. 소재가 맞는지는 의미 검사(`resolveTimeline`)가 아이템 단위로 본다.
  'composition',
];

export type ValidateResult =
  | { readonly ok: true; readonly doc: VideoDoc }
  | { readonly ok: false; readonly errors: readonly string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isTimeAnchor(v: unknown): v is TimeAnchor {
  if (isFiniteNumber(v)) return true;
  if (!isRecord(v)) return false;
  const hasAfter = isNonEmptyString(v['after']);
  const hasStart = isNonEmptyString(v['start']);
  // §5.13 (V) 37-4 장면 앵커 · (T-8) 표지 앵커(그 표지를 낸 아이템 id 가 함께 있어야 한다).
  const hasChapter = isNonEmptyString(v['chapter']);
  const hasCue = isNonEmptyString(v['cue']);
  if (hasCue && !isNonEmptyString(v['item'])) return false;
  // 정확히 하나만 있어야 한다 — 둘 이상이면 어느 쪽을 따를지 알 수 없다.
  if ([hasAfter, hasStart, hasChapter, hasCue].filter(Boolean).length !== 1) return false;
  const offset = v['offset'];
  return offset === undefined || isFiniteNumber(offset);
}

const CHAPTER_STATUSES = ['plan', 'approved', 'building', 'done'];
const TRANSITION_KINDS = ['cut', 'dissolve', 'push', 'zoom', 'flash', 'wipe'];

/** §5.13 (V) 37-4 — 장면 층의 모양. 없으면(옛 문서) 그대로 통과. */
function validateChapters(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push('chapters 가 배열이 아닙니다.');
    return;
  }
  const seen = new Set<string>();
  value.forEach((chapter, i) => {
    const where = `장면 #${i}`;
    if (!isRecord(chapter)) {
      errors.push(`${where} 가 객체가 아닙니다.`);
      return;
    }
    const id = chapter['id'];
    if (!isNonEmptyString(id)) errors.push(`${where} 에 id 가 없습니다.`);
    else if (seen.has(id)) errors.push(`장면 id '${id}' 가 중복입니다.`);
    else seen.add(id);
    if (typeof chapter['title'] !== 'string') errors.push(`${where} 의 title 이 문자열이 아닙니다.`);
    if (!isFiniteNumber(chapter['duration'])) errors.push(`${where} 의 duration 이 숫자가 아닙니다.`);
    if (!CHAPTER_STATUSES.includes(String(chapter['status']))) errors.push(`${where} 의 status '${String(chapter['status'])}' 는 알 수 없는 값입니다.`);
    for (const key of ['at', 'offset']) {
      if (chapter[key] !== undefined && !isFiniteNumber(chapter[key])) errors.push(`${where} 의 ${key} 가 숫자가 아닙니다.`);
    }
    const tr = chapter['transition'];
    if (tr !== undefined && (!isRecord(tr) || !TRANSITION_KINDS.includes(String(tr['kind'])) || !isFiniteNumber(tr['duration']))) {
      errors.push(`${where} 의 transition 이 { kind, duration } 형태가 아닙니다.`);
    }
    const variants = chapter['variants'];
    if (variants !== undefined && (!Array.isArray(variants) || variants.some((v) => !isRecord(v) || !isNonEmptyString(v['id'])))) {
      errors.push(`${where} 의 variants 가 { id, engine, status } 목록이 아닙니다.`);
    }
    // §5.13 (W) 38-7 — 정지 화면은 { assetId, t? }. 소재가 컴포지션인지는 의미 검사(`resolveTimeline`)가 진단으로 본다.
    const frame = chapter['frame'];
    if (frame !== undefined && (!isRecord(frame) || !isNonEmptyString(frame['assetId']) || (frame['t'] !== undefined && !isFiniteNumber(frame['t'])))) {
      errors.push(`${where} 의 frame 이 { assetId, t? } 형태가 아닙니다.`);
    }
  });
}

const KEYFRAME_NUMBERS = ['dx', 'dy', 'scale', 'rotation', 'opacity'];
const KEYFRAME_EASES = ['linear', 'in', 'out', 'inOut', 'hold'];

/** §5.13 (W) 38-4·38-5 — 키프레임·이펙트의 모양(값의 범위는 렌더가 자른다). 틀린 곳마다 한 줄. */
function validateItemMotion(item: Record<string, unknown>, where: string, errors: string[]): void {
  const keyframes = item['keyframes'];
  if (keyframes !== undefined) {
    if (!Array.isArray(keyframes)) errors.push(`${where} 의 keyframes 가 배열이 아닙니다.`);
    else keyframes.forEach((k, ki) => {
      if (!isRecord(k) || !isFiniteNumber(k['t'])) { errors.push(`${where} 키프레임 #${ki} 에 숫자 t 가 없습니다.`); return; }
      for (const key of KEYFRAME_NUMBERS) {
        if (k[key] !== undefined && !isFiniteNumber(k[key])) errors.push(`${where} 키프레임 #${ki} 의 ${key} 가 숫자가 아닙니다.`);
      }
      if (k['ease'] !== undefined && !KEYFRAME_EASES.includes(String(k['ease']))) {
        errors.push(`${where} 키프레임 #${ki} 의 ease '${String(k['ease'])}' 는 ${KEYFRAME_EASES.join('·')} 가 아닙니다.`);
      }
    });
  }
  const effects = item['effects'];
  if (effects !== undefined) {
    if (!Array.isArray(effects)) errors.push(`${where} 의 effects 가 배열이 아닙니다.`);
    else effects.forEach((e, ei) => {
      if (!isRecord(e) || !isNonEmptyString(e['kind'])) errors.push(`${where} 이펙트 #${ei} 에 kind 가 없습니다.`);
      else if (e['params'] !== undefined && !isRecord(e['params'])) errors.push(`${where} 이펙트 #${ei} 의 params 가 객체가 아닙니다.`);
    });
  }
}

/** 첫 오류에서 멈추지 않고 전부 모아 돌려준다(고칠 사람이 한 번에 다 보게). */
export function validateDoc(value: unknown): ValidateResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ['문서가 객체가 아닙니다.'] };
  }

  if (!isFiniteNumber(value['schemaVersion'])) {
    errors.push('schemaVersion 이 없거나 숫자가 아닙니다.');
  } else if (value['schemaVersion'] > VIDEO_SCHEMA_VERSION) {
    errors.push(
      `이 문서의 schemaVersion(${String(value['schemaVersion'])})이 앱이 아는 버전(${VIDEO_SCHEMA_VERSION})보다 높습니다. 앱을 업데이트하세요.`,
    );
  }

  if (!isNonEmptyString(value['id'])) errors.push('id 가 없습니다.');
  if (typeof value['title'] !== 'string') errors.push('title 이 문자열이 아닙니다.');
  if (!isFiniteNumber(value['version'])) errors.push('version 이 없거나 숫자가 아닙니다.');
  if (!isFiniteNumber(value['fps']) || (value['fps'] as number) <= 0) errors.push('fps 가 양수가 아닙니다.');

  const size = value['size'];
  if (!isRecord(size) || !isFiniteNumber(size['width']) || !isFiniteNumber(size['height'])) {
    errors.push('size 가 { width, height } 형태가 아닙니다.');
  }

  const assets = value['assets'];
  if (!isRecord(assets)) {
    errors.push('assets 가 객체가 아닙니다.');
  } else {
    for (const [assetId, asset] of Object.entries(assets)) {
      if (!isRecord(asset)) {
        errors.push(`소재 '${assetId}' 가 객체가 아닙니다.`);
        continue;
      }
      if (asset['id'] !== assetId) {
        errors.push(`소재 '${assetId}' 의 id 필드(${String(asset['id'])})가 키와 다릅니다.`);
      }
      const source = asset['source'];
      if (!isRecord(source) || !isNonEmptyString(source['kind'])) {
        errors.push(`소재 '${assetId}' 의 source 가 없습니다.`);
      } else if (source['kind'] === 'file' && !isNonEmptyString(source['path'])) {
        errors.push(`소재 '${assetId}' 의 파일 경로가 없습니다.`);
      } else if (source['kind'] === 'external' && !isNonEmptyString(source['command'])) {
        errors.push(`소재 '${assetId}' 의 외부 명령이 없습니다.`);
      }
      if (asset['duration'] !== undefined && !isFiniteNumber(asset['duration'])) {
        errors.push(`소재 '${assetId}' 의 duration 이 숫자가 아닙니다.`);
      }
      if (asset['hasAudio'] !== undefined && typeof asset['hasAudio'] !== 'boolean') {
        errors.push(`소재 '${assetId}' 의 hasAudio 가 참/거짓이 아닙니다.`);
      }
    }
  }

  validateChapters(value['chapters'], errors);
  if (value['requirements'] !== undefined && !validVideoRequirements(value['requirements'])) errors.push('requirements must contain valid request checks with unique ids (maximum 100).');

  const tracks = value['tracks'];
  if (!Array.isArray(tracks)) {
    errors.push('tracks 가 배열이 아닙니다.');
    return { ok: false, errors };
  }

  const seenTrackIds = new Set<string>();
  let itemCount = 0;

  tracks.forEach((track, ti) => {
    const where = `트랙 #${ti}`;
    if (!isRecord(track)) {
      errors.push(`${where} 가 객체가 아닙니다.`);
      return;
    }
    const trackId = track['id'];
    if (!isNonEmptyString(trackId)) {
      errors.push(`${where} 에 id 가 없습니다.`);
    } else if (seenTrackIds.has(trackId)) {
      errors.push(`트랙 id '${trackId}' 가 중복입니다.`);
    } else {
      seenTrackIds.add(trackId);
    }

    if (!TRACK_KINDS.includes(track['kind'] as VideoTrackKind)) {
      errors.push(`${where} 의 kind '${String(track['kind'])}' 는 알 수 없는 값입니다.`);
    }

    const items = track['items'];
    if (!Array.isArray(items)) {
      errors.push(`${where} 의 items 가 배열이 아닙니다.`);
      return;
    }

    items.forEach((item, ii) => {
      itemCount += 1;
      const iw = `${where} 아이템 #${ii}`;
      if (!isRecord(item)) {
        errors.push(`${iw} 가 객체가 아닙니다.`);
        return;
      }
      if (!isNonEmptyString(item['id'])) errors.push(`${iw} 에 id 가 없습니다.`);
      if (!ITEM_KINDS.includes(item['kind'] as VideoItemKind)) {
        errors.push(`${iw} 의 kind '${String(item['kind'])}' 는 알 수 없는 값입니다.`);
      }
      if (!isTimeAnchor(item['at'])) {
        errors.push(`${iw} 의 at 이 시각도 앵커도 아닙니다.`);
      }
      const duration = item['duration'];
      if (duration !== 'auto' && !isFiniteNumber(duration)) {
        errors.push(`${iw} 의 duration 이 숫자도 'auto' 도 아닙니다.`);
      }
      validateItemMotion(item, iw, errors);
    });
  });

  if (itemCount > VIDEO_MAX_ITEMS) {
    errors.push(`아이템이 ${itemCount}개로 상한(${VIDEO_MAX_ITEMS})을 넘었습니다. 문서가 깨졌을 수 있습니다.`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, doc: value as unknown as VideoDoc };
}
