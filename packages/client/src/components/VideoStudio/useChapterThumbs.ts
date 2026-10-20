import { useEffect, useMemo, useRef, useState } from 'react';
import { CHAPTER_THUMB_CACHE_BYTES, chapterThumbWants, type ResolvedTimeline, type VideoDoc } from '@vibisual/video';

import { fetchChapterThumbs } from './videoApi.js';
import { runWhenIdle } from './studioIdle.js';

/**
 * §5.13 (V) 37-4·37-8 — 장면마다 **대표 프레임**(장면 40% 지점의 일꾼 스틸). 기획 카드와 장면 구슬 안에 찬다 — "끝난 장면부터
 * 실제 프레임이 찬다". §5.13 (W) 38-7 — **기획 단계**의 장면은 정지 화면(`chapter.frame` 컴포지션)이 있으면 그것을 띄운다.
 *
 * §5.13 (X) 39-4 — 종전에는 창을 열 때마다 장면 수만큼 일꾼에게 한 장씩 청했고(한 장마다 숨은 렌더 창 하나 — 본체 번들을 처음부터
 * 다시 읽는 창), 기억은 이 창 안에만 있어 앱을 다시 켜면 처음부터 다시 구웠다. 그 사이 여는 화면이 CPU 를 빼앗겼다. 이제
 *  ① 디스크에 남은 그림을 **한 번에** 받는다(굽지 않는다 — 바로 온다). 열쇠는 순수 층 `chapterThumbWants` 로 서버와 같다.
 *  ② 빠진 것은 `active`(첫 그림이 선 뒤 · 보이는 동안)일 때만 **일감 하나로 묶어** 굽는다(한 무대에서 차례로).
 *  ③ 창 안 기억은 개수가 아니라 **바이트**로 묶는다(데이터 주소 글자 수 — `CHAPTER_THUMB_CACHE_BYTES`, 오래 안 본 것부터).
 * 못 구운 것은 빈 글자로 기억해 다시 조르지 않는다(내용이 바뀌면 열쇠가 바뀌어 다시 시도한다). 기억 열쇠는 프로젝트·문서를 품는다(§3.5).
 */

/** 열쇠 → 그림(data URL). 빈 글자 = 못 구움. 넣은 순서가 곧 오래된 순서다(꺼내 볼 때 뒤로 옮긴다). */
const cache = new Map<string, string>();
let cacheBytes = 0;

function remember(key: string, image: string): void {
  const prev = cache.get(key);
  if (prev !== undefined) { cacheBytes -= prev.length; cache.delete(key); }
  cache.set(key, image);
  cacheBytes += image.length;
  while (cacheBytes > CHAPTER_THUMB_CACHE_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    cacheBytes -= cache.get(oldest)?.length ?? 0;
    cache.delete(oldest);
  }
}

function recall(key: string): string | undefined {
  const image = cache.get(key);
  if (image !== undefined) { cache.delete(key); cache.set(key, image); }
  return image;
}

/** 디스크 기억을 이미 물어본 열쇠(프로젝트·문서·열쇠) — 같은 열쇠를 디스크에 두 번 묻지 않는다. */
const askedDisk = new Set<string>();
const ASKED_DISK_MAX = 4000;

export function useChapterThumbs(
  project: string,
  doc: VideoDoc | null,
  timeline: ResolvedTimeline | null,
  opts: { readonly active?: boolean } = {},
): Readonly<Record<string, string | null>> {
  const active = opts.active !== false;
  const [kick, setKick] = useState(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const docId = doc?.id ?? '';

  const wants = useMemo(() => (doc && timeline ? chapterThumbWants(doc, timeline) : []), [doc, timeline]);

  useEffect(() => {
    if (busy.current || project === '' || docId === '') return;
    const missing = wants.filter((w) => !cache.has(w.key));
    if (missing.length === 0) return;
    const scope = (key: string): string => `${project}\u0000${docId}\u0000${key}`;
    const askDisk = missing.some((w) => !askedDisk.has(scope(w.key)));
    // 디스크를 이미 물었고 아직 구울 때가 아니면(첫 그림 전·숨은 동안) 기다린다 — `active` 가 켜지면 이 효과가 다시 돈다.
    if (!askDisk && !active) return;
    const render = !askDisk;
    busy.current = true;
    // §5.13 (Y) 40-10 ④ — 디스크 기억은 바로 묻고, 굽기는 배경 줄에서(재생·끌기·입력 중에는 쉬었다가 한가할 때).
    (render ? runWhenIdle(() => fetchChapterThumbs(project, docId, true)) : fetchChapterThumbs(project, docId, false))
      .then(({ thumbs }) => {
        for (const [key, image] of Object.entries(thumbs)) remember(key, image);
        if (render) for (const w of missing) if (!cache.has(w.key)) remember(w.key, '');
      })
      .catch(() => {
        if (render) for (const w of missing) if (!cache.has(w.key)) remember(w.key, '');
      })
      .finally(() => {
        if (!render) {
          for (const w of missing) askedDisk.add(scope(w.key));
          if (askedDisk.size > ASKED_DISK_MAX) askedDisk.clear();
        }
        busy.current = false;
        if (mounted.current) setKick((k) => k + 1);
      });
  }, [wants, project, docId, active, kick]);

  return useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const w of wants) out[w.chapterId] = recall(w.key) || null;
    return out;
    // `kick` 은 기억이 찼다는 신호다(기억 자체는 모듈 밖에 있어 의존성으로 잡히지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wants, kick]);
}
