/**
 * §5.13 (V) 37-1 — 문서 갤러리 포스터: 문서마다 대표 한 장의 열쇠와 찍을 자리(순수, 서버 전용 아님).
 * 장면이 있으면 그 장면의 대표 프레임(39-4 와 같은 열쇠 — 스튜디오가 이미 구운 디스크 그림을 그대로 쓴다), 없으면 길이 35% 지점 정지 화면.
 */

import { CHAPTER_THUMB_MAX_EDGE } from './constants.js';
import { chapterThumbWants, type ChapterThumbWant } from './chapterThumbs.js';
import { stableHash } from './hashItem.js';
import type { ResolvedTimeline, VideoDoc } from './types.js';

/** 장면이 없는 문서의 포스터 시각 — 길이의 이 비율(첫 프레임은 등장 전·검은 화면인 일이 흔하다). */
export const DOC_POSTER_AT = 0.35;

/** 장면이 없는 문서 포스터 열쇠의 판 — 그리는 법이 바뀌면 올려 옛 그림을 버린다. */
export const DOC_POSTER_KEY_VERSION = 1;

export interface DocPosterWant {
  /** 디스크 파일 이름이 되는 열쇠(16진 16자). */
  readonly key: string;
  /** 대표가 된 장면(장면이 없는 문서는 `null`). */
  readonly chapterId: string | null;
  readonly source: ChapterThumbWant['source'];
}

/** 장면이 없는 문서의 포스터 시각(마지막 프레임 앞까지). */
export function docPosterTime(duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.max(0, Math.min(duration * DOC_POSTER_AT, duration - 1 / 30));
}

/** 이 문서의 대표 한 장. 그릴 것이 없으면(길이 0) `null`. 제목·메모처럼 그림에 안 보이는 변경은 열쇠를 바꾸지 않는다. */
export function docPosterWant(doc: VideoDoc, timeline: ResolvedTimeline, edge: number = CHAPTER_THUMB_MAX_EDGE): DocPosterWant | null {
  const wants = chapterThumbWants(doc, timeline, edge);
  if (wants.length > 0) {
    const done = new Set(timeline.chapters.filter((c) => c.chapter.status === 'done').map((c) => c.id));
    const pick = wants.find((w) => done.has(w.chapterId)) ?? wants[0];
    if (pick) return { key: pick.key, chapterId: pick.chapterId, source: pick.source };
  }
  if (!(timeline.duration > 0)) return null;
  const t = docPosterTime(timeline.duration);
  const visible = timeline.items
    .filter((r) => r.start <= t && r.end > t)
    .map((r) => {
      const asset = r.item.assetId ? doc.assets[r.item.assetId] : undefined;
      return [r.item, r.start, r.end, asset?.contentHash ?? asset?.id ?? null];
    });
  if (visible.length === 0) return null;
  return {
    key: stableHash(JSON.stringify([DOC_POSTER_KEY_VERSION, 'poster', doc.id, t, visible, doc.size, doc.style ?? null, edge])),
    chapterId: null,
    source: { kind: 'still', t },
  };
}
