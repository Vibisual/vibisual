/**
 * 문서 구조 검증 (SCENARIO.md §5.13 (I)).
 *
 * 디스크에서 읽은 JSON 은 믿을 수 없다 — 스키마가 움직였을 수도, 손으로 고치다
 * 깨졌을 수도, 다른 버전이 쓴 것일 수도 있다. 타입 단언 하나로 통과시키면 그
 * 어긋남이 렌더 한참 뒤에 엉뚱한 자리에서 터진다.
 *
 * `resolveTimeline` 이 **의미**(앵커가 말이 되는가)를 보는 반면 여기서는 **구조**
 * (모양이 문서인가)만 본다. 둘을 합치지 않는 이유는 구조가 깨진 문서에 의미 검사를
 * 돌리면 오류가 폭포처럼 쏟아져 진짜 원인이 묻히기 때문이다.
 */

import { VIDEO_MAX_ITEMS, VIDEO_SCHEMA_VERSION } from './constants.js';
import type { TimeAnchor, VideoDoc, VideoItemKind, VideoTrackKind } from './types.js';

const TRACK_KINDS: readonly VideoTrackKind[] = ['visual', 'audio', 'caption'];
const ITEM_KINDS: readonly VideoItemKind[] = [
  'scene',
  'footage',
  'image',
  'audio',
  'caption',
  'shape',
  'text',
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
  // 정확히 하나만 있어야 한다 — 둘 다 있으면 어느 쪽을 따를지 알 수 없다.
  if (hasAfter === hasStart) return false;
  const offset = v['offset'];
  return offset === undefined || isFiniteNumber(offset);
}

/**
 * 값이 문서인지 검사한다.
 *
 * 통과하면 그 값을 `VideoDoc` 으로 쓸 수 있다. 실패하면 무엇이 왜 아닌지를 전부
 * 모아 돌려준다(첫 오류에서 멈추지 않는 이유 — 고칠 사람이 한 번에 다 보게).
 */
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
    }
  }

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
    });
  });

  if (itemCount > VIDEO_MAX_ITEMS) {
    errors.push(`아이템이 ${itemCount}개로 상한(${VIDEO_MAX_ITEMS})을 넘었습니다. 문서가 깨졌을 수 있습니다.`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, doc: value as unknown as VideoDoc };
}
