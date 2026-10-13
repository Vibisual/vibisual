import { useEffect, useMemo, useRef, useState } from 'react';
import { chapterFingerprint, chapterIdOf, stableHash, type ResolvedTimeline, type VideoDoc } from '@vibisual/video';

import { fetchFrameImage, fetchStillImage } from './videoApi.js';

/**
 * §5.13 (V) 37-4·37-8 — 장면마다 **대표 프레임**(장면 40% 지점의 일꾼 스틸). 기획 카드와 장면 구슬 안에 찬다 — "끝난 장면부터
 * 실제 프레임이 찬다". 장면 내용 지문(`chapterFingerprint` — 장면 + 묶인 아이템 + 소재)마다 **한 번** 굽고 기억한다(바뀌지 않은
 * 장면은 다시 찍지 않는다). 한 번에 하나씩 굽는다(일꾼의 스틸 줄을 막지 않게). 기억 열쇠는 프로젝트·문서를 품는다(§3.5).
 *
 * §5.13 (W) 38-7 — **기획 단계**의 장면은 정지 화면(`chapter.frame` 컴포지션)이 있으면 그것을 띄운다 — 움직임을 짓기 전에 모양을
 * 승인받는 그림이다. 열쇠는 그 소재의 내용 해시 + 시각(코드가 바뀔 때만 다시 굽는다).
 */

/** 대표 프레임 시각 — 장면 길이의 이 비율(첫 프레임은 등장 전인 일이 흔하다). */
const THUMB_AT = 0.4;
const CACHE_MAX = 160;
/** 열쇠 → 그림(data URL). 못 찍은 것은 빈 글자(다시 묻지 않는다 — 내용이 바뀌면 열쇠가 바뀐다). */
const cache = new Map<string, string>();

function remember(key: string, image: string): void {
  cache.delete(key);
  cache.set(key, image);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

interface ThumbWant {
  readonly id: string;
  readonly key: string;
  /** 장면 프레임(문서 시각) 또는 정지 화면(그 장면 id 로 묻는다). */
  readonly source: { readonly kind: 'still'; readonly t: number } | { readonly kind: 'frame' };
}

export function useChapterThumbs(project: string, doc: VideoDoc | null, timeline: ResolvedTimeline | null): Readonly<Record<string, string | null>> {
  const [kick, setKick] = useState(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const docId = doc?.id ?? '';

  // 굽을 것: 기획이 아닌 장면 중 그릴 것이 묶인 장면과 그 지문 + 정지 화면이 있는 기획 장면.
  const wanted = useMemo((): ThumbWant[] => {
    if (!doc || !timeline) return [];
    const withItems = new Set<string>();
    for (const item of timeline.items) {
      const id = chapterIdOf(item.item);
      if (id) withItems.add(id);
    }
    const out: ThumbWant[] = [];
    for (const c of timeline.chapters) {
      if (c.chapter.status === 'plan') {
        const frame = c.chapter.frame;
        const asset = frame ? doc.assets[frame.assetId] : undefined;
        if (!frame || !asset || asset.kind !== 'composition') continue;
        out.push({
          id: c.id,
          source: { kind: 'frame' },
          key: JSON.stringify([project, doc.id, c.id, 'frame', asset.id, asset.contentHash ?? '', frame.t ?? 0, doc.size, doc.style ?? null]),
        });
        continue;
      }
      if (!withItems.has(c.id) || c.duration <= 0) continue;
      out.push({
        id: c.id,
        source: { kind: 'still', t: c.start + c.duration * THUMB_AT },
        key: JSON.stringify([project, doc.id, c.id, stableHash(chapterFingerprint(doc, timeline, c.id))]),
      });
    }
    return out;
  }, [project, doc, timeline]);

  useEffect(() => {
    if (busy.current || project === '' || docId === '') return;
    const todo = wanted.find((w) => !cache.has(w.key));
    if (!todo) return;
    busy.current = true;
    const fetchIt = todo.source.kind === 'frame' ? fetchFrameImage(project, docId, todo.id) : fetchStillImage(project, docId, todo.source.t);
    fetchIt
      .then((image) => remember(todo.key, image))
      .catch(() => remember(todo.key, ''))
      .finally(() => {
        busy.current = false;
        if (mounted.current) setKick((k) => k + 1);
      });
  }, [wanted, project, docId, kick]);

  return useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const w of wanted) out[w.id] = cache.get(w.key) || null;
    return out;
    // `kick` 은 기억이 찼다는 신호다(기억 자체는 모듈 밖에 있어 의존성으로 잡히지 않는다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, kick]);
}
