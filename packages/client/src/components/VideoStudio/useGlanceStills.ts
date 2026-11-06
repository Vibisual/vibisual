import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { APP_CANVAS_FACE } from '@vibisual/shared';
import type { ChapterThumbWant } from '@vibisual/video';

import { chapterThumbFailed } from './useChapterThumbs.js';
import { chapterThumbTime, pickPoster, posterTime, scrubTime, type PosterPick } from './glanceView.js';
import {
  bakePosterStill,
  bakeScrubStills,
  holdStillKey,
  loadHoldStill,
  posterStillKey,
  recallGlanceStill,
  scrubStillsOf,
  subscribeGlanceStills,
} from './glanceStills.js';
import type { VideoGlance } from './videoGlance.js';

/**
 * §5.4 #36 (J) — 훑어보기 화면이 보일 그림의 훅들(③ 포스터 · ② 훑기 · ④ 직전 판). 그림 기억은 `glanceStills.ts`·`useChapterThumbs.ts`
 * 의 모듈 기억이고, 여기는 언제 굽고 무엇을 고를지만 정한다.
 */

const NO_STILLS: readonly (string | null)[] = [];
/** 훑는 시각·테를 이 단위(초)로 묶는다 — 포인터가 움직일 때마다 그리기 목록을 다시 풀지 않게. */
const SCRUB_STEP_S = 0.1;

/** 정지 화면 기억이 찰 때마다 다시 그린다(다른 노드가 구운 것도). */
export function useGlanceStillsTick(): number {
  const counter = useRef(0);
  const subscribe = useCallback((listener: () => void) => subscribeGlanceStills(() => { counter.current += 1; listener(); }), []);
  return useSyncExternalStore(subscribe, () => counter.current, () => counter.current);
}

export interface GlancePoster {
  readonly pick: PosterPick | null;
  /** 지금 보일 포스터(새 것을 굽는 동안은 앞 것). */
  readonly image: string | null;
}

/**
 * ③ 포스터 — 바뀐 장면의 대표 프레임 → 첫 done 장면 → 아무 장면 그림 → (장면 그림이 하나도 없거나 다 못 구웠으면) 종전 35% 정지 화면.
 * 새로 굽는 동안에는 앞 그림을 그대로 보인다(같은 문서의 것만 — 화면은 문서마다 새로 선다).
 */
export function useGlancePoster(
  project: string,
  docId: string,
  glance: VideoGlance | null,
  thumbs: Readonly<Record<string, string | null>>,
  wants: readonly ChapterThumbWant[],
): GlancePoster {
  const pick = glance ? pickPoster(glance, thumbs) : null;
  const anyThumb = pick?.image || !glance ? null : glance.timeline.chapters.map((c) => thumbs[c.id]).find((x): x is string => !!x) ?? null;
  const duration = glance?.timeline.duration ?? 0;
  const version = glance?.doc.version ?? 0;
  const needStill = glance !== null && duration > 0 && !pick?.image && !anyThumb
    && (wants.length === 0 || wants.every((w) => chapterThumbFailed(w.key)));
  useEffect(() => {
    if (!needStill) return undefined;
    const abort = new AbortController();
    void bakePosterStill(project, docId, version, posterTime(duration), abort.signal);
    return () => abort.abort();
  }, [needStill, project, docId, version, duration]);
  const still = needStill ? recallGlanceStill(posterStillKey(project, docId, version)) : null;
  const last = useRef<string | null>(null);
  const fresh = pick?.image ?? anyThumb ?? still;
  if (fresh) last.current = fresh;
  return { pick, image: fresh ?? last.current };
}

export interface GlanceScrub {
  /** 훑는 시각(초) — 포인터가 결과 칸 밖이면 `null`. */
  readonly t: number | null;
  readonly onScrub: (fraction: number | null) => void;
  /** 장면이 없는 문서의 훑기 정지 화면들(`scrubStillTimes` 순서). 장면이 있으면 빈 목록. */
  readonly stills: readonly (string | null)[];
}

/** ② 훑기 — 장면이 없는 문서는 처음 훑을 때 그 판본의 정지 화면(`APP_CANVAS_FACE.scrubStills` 장)을 쉬는 틈에 굽는다(떠나도 이어 굽는다). */
export function useGlanceScrub(project: string, docId: string, glance: VideoGlance | null): GlanceScrub {
  const [t, setT] = useState<number | null>(null);
  const duration = glance?.timeline.duration ?? 0;
  const fps = glance?.doc.fps && glance.doc.fps > 0 ? glance.doc.fps : 30;
  const onScrub = useCallback((fraction: number | null): void => {
    setT(fraction === null ? null : Math.round(scrubTime(fraction, duration, fps) / SCRUB_STEP_S) * SCRUB_STEP_S);
  }, [duration, fps]);
  const noChapters = glance !== null && glance.timeline.chapters.length === 0;
  const version = glance?.doc.version ?? 0;
  const versionKey = glance ? `${glance.doc.version}:${glance.doc.updatedAt}` : '';
  const [wanted, setWanted] = useState('');
  if (t !== null && noChapters && wanted !== versionKey) setWanted(versionKey);
  useEffect(() => {
    if (wanted === '' || wanted !== versionKey || !(duration > 0)) return undefined;
    const abort = new AbortController();
    void bakeScrubStills(project, docId, version, duration, abort.signal);
    return () => abort.abort();
  }, [wanted, versionKey, project, docId, version, duration]);
  const stills = noChapters && APP_CANVAS_FACE.scrubStills > 0 ? scrubStillsOf(project, docId, version) : NO_STILLS;
  return { t, onScrub, stills };
}

export interface GlanceHold {
  readonly holding: boolean;
  readonly setHolding: (on: boolean) => void;
  /** 직전 판의 그 시각 그림(받는 중·못 받았으면 `null`). */
  readonly image: string | null;
}

/** ④ 직전 판 — 누르고 있는 동안 바퀴 시작 판(`startRev`)의 같은 시각 정지 화면. 열쇠가 같으면(0.1초 안) 다시 묻지 않는다. */
export function useGlanceHold(project: string, docId: string, startRev: string | undefined, t: number): GlanceHold {
  const [holding, setHolding] = useState(false);
  const key = holding && startRev ? holdStillKey(project, docId, startRev, t) : null;
  const latest = useRef({ project, docId, startRev, t });
  latest.current = { project, docId, startRev, t };
  useEffect(() => {
    const cur = latest.current;
    if (key && cur.startRev) void loadHoldStill(cur.project, cur.docId, cur.startRev, cur.t);
  }, [key]);
  return { holding, setHolding, image: key ? recallGlanceStill(key) : null };
}

/** 지금 결과 칸이 보이는 시각 — 훑는 중이면 그 시각, 고른 장면이면 그 대표 프레임 자리, 아니면 포스터 자리. */
export function glanceShownTime(scrubT: number | null, focused: Parameters<typeof chapterThumbTime>[0] | null, pick: PosterPick | null): number {
  if (scrubT !== null) return scrubT;
  if (focused) return chapterThumbTime(focused);
  return pick?.t ?? 0;
}
