import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { StudioIcon } from './studioIcons.js';
import { POSTER_FAILED, posterKey, recallPoster, requestPoster, subscribePoster } from './docPosters.js';
import type { DocSummary } from './videoApi.js';
import { docFormat } from './docGalleryModel.js';

/**
 * §5.13 (V) 37-1 — 갤러리 카드의 포스터 칸(16:9 틀 안). 화면에 들어온 동안만 포스터를 청하고(`docPosters.ts` 줄), 나가면 기다리던 요청을 걷는다.
 * 그림이 아직 없거나 못 얻었거나 그릴 것이 없으면 그 문서의 판형 비율 상자를 보인다(기다리는 중이면 천천히 깜박인다).
 */

/** 화면(스크롤 영역 포함)에 보이는가 — 관찰자가 없는 환경에서는 늘 보인다고 본다. */
function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setSeen(last.isIntersecting);
    }, { rootMargin: '96px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

const SHAPE: Readonly<Record<string, string>> = {
  landscape: 'aspect-video h-3/5',
  portrait: 'aspect-[9/16] h-4/5',
  square: 'aspect-square h-3/5',
};

export function DocGalleryPoster({ project, doc, className }: {
  readonly project: string;
  readonly doc: DocSummary;
  readonly className?: string;
}): React.JSX.Element {
  const [ref, visible] = useInView<HTMLDivElement>();
  const key = posterKey(project, doc);
  const value = useSyncExternalStore(
    (listener) => subscribePoster(key, listener),
    () => recallPoster(key),
    () => undefined,
  );
  const unknown = value === undefined;
  useEffect(() => (visible && unknown ? requestPoster(project, doc) : undefined), [visible, unknown, project, doc.id, doc.version, doc.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const image = value && value !== POSTER_FAILED ? value : null;
  const shape = SHAPE[docFormat(doc) ?? 'landscape'] ?? SHAPE['landscape'];
  return (
    <div ref={ref} aria-hidden="true" className={`relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-vb-sunken ring-1 ring-inset ring-white/[0.06] ${className ?? ''}`}>
      {image ? (
        <img src={image} alt="" draggable={false} className="h-full w-full object-contain" />
      ) : (
        <div className={`${shape} flex items-center justify-center rounded-sm border border-white/10 bg-white/[0.03] text-slate-600 ${unknown ? 'motion-safe:animate-pulse' : ''}`}>
          {unknown ? null : <StudioIcon name="film" className="h-4 w-4" />}
        </div>
      )}
    </div>
  );
}
