/**
 * §5.13 (X) 39-4 — 장면 대표 프레임의 **열쇠와 찍을 자리**(순수 — 서버와 화면이 같은 함수를 쓴다).
 *
 * 대표 프레임은 장면 구슬·기획 카드에 들어가는 작은 그림이다. 종전에는 화면이 창을 열 때마다 장면 수만큼 일꾼에게 한 장씩
 * 청했고(한 장마다 숨은 렌더 창 하나), 기억은 그 창 안에만 있어 앱을 다시 켜면 처음부터 다시 구웠다. 이제 열쇠가 같으면
 * 디스크에 남은 그림을 그대로 쓴다 — 그래서 열쇠는 **그 프레임에 보이는 것 전부**에서 온다.
 *
 *  · 일반 장면: 장면 내용 지문(`chapterFingerprint` — 장면 + 묶인 아이템 + 소재 해시) + 그 시각에 보이는 모든 아이템(장면에
 *    묶이지 않은 덧그림까지) + 문서 크기·스타일 + 그림 크기. 바뀌지 않은 장면은 열쇠가 그대로다.
 *  · 기획 장면: 정지 화면(`chapter.frame`)이 있을 때만 — 그 컴포지션의 내용 해시 + 시각 + 문서 크기·스타일 + 그림 크기.
 *
 * 그리는 법이 바뀌어 옛 그림을 버려야 하면 `CHAPTER_THUMB_KEY_VERSION` 을 올린다.
 */

import { CHAPTER_THUMB_MAX_EDGE } from './constants.js';
import { chapterFingerprint, chapterIdOf } from './chapters.js';
import { stableHash } from './hashItem.js';
import type { ResolvedTimeline, VideoDoc } from './types.js';

/** 대표 프레임 시각 — 장면 길이의 이 비율(첫 프레임은 등장 전인 일이 흔하다). */
export const CHAPTER_THUMB_AT = 0.4;

/** 열쇠의 판 — 그리는 법이 바뀌면 올려 옛 그림을 버린다. */
export const CHAPTER_THUMB_KEY_VERSION = 1;

export interface ChapterThumbWant {
  readonly chapterId: string;
  /** 파일 이름으로도 쓰는 열쇠(16진 16자 — `stableHash`). */
  readonly key: string;
  /** 일반 장면은 문서의 그 시각, 기획 장면은 그 장면의 정지 화면. */
  readonly source: { readonly kind: 'still'; readonly t: number } | { readonly kind: 'frame' };
}

/** 이 문서의 장면 대표 프레임 목록(문서 순서). 그릴 것이 묶이지 않은 장면·길이 0 인 장면은 없다. */
export function chapterThumbWants(doc: VideoDoc, timeline: ResolvedTimeline, edge: number = CHAPTER_THUMB_MAX_EDGE): ChapterThumbWant[] {
  const withItems = new Set<string>();
  for (const item of timeline.items) {
    const id = chapterIdOf(item.item);
    if (id) withItems.add(id);
  }
  const assetHash = (assetId: string | undefined): string | null => {
    const asset = assetId ? doc.assets[assetId] : undefined;
    return asset?.contentHash ?? asset?.id ?? null;
  };
  const out: ChapterThumbWant[] = [];
  for (const c of timeline.chapters) {
    if (c.chapter.status === 'plan') {
      const frame = c.chapter.frame;
      const asset = frame ? doc.assets[frame.assetId] : undefined;
      if (!frame || !asset || asset.kind !== 'composition') continue;
      out.push({
        chapterId: c.id,
        source: { kind: 'frame' },
        key: stableHash(JSON.stringify([CHAPTER_THUMB_KEY_VERSION, 'frame', doc.id, c.id, asset.id, asset.contentHash ?? '', frame.t ?? 0, doc.size, doc.style ?? null, edge])),
      });
      continue;
    }
    if (!withItems.has(c.id) || c.duration <= 0) continue;
    const t = c.start + c.duration * CHAPTER_THUMB_AT;
    const visible = timeline.items
      .filter((r) => r.start <= t && r.end > t)
      .map((r) => [r.item, r.start, r.end, assetHash(r.item.assetId)]);
    out.push({
      chapterId: c.id,
      source: { kind: 'still', t },
      key: stableHash(JSON.stringify([CHAPTER_THUMB_KEY_VERSION, 'still', doc.id, c.id, chapterFingerprint(doc, timeline, c.id), visible, edge])),
    });
  }
  return out;
}
