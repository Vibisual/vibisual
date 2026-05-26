import { useRef, useEffect, useCallback, useState } from 'react';

interface ScrollFadeProps {
  /** 최대 높이 (px). fill=true일 때는 무시됨. */
  maxHeight?: number;
  /** true면 flex 부모의 남은 공간을 채움 (flex-1 용도). className은 외부 래퍼에 적용. */
  fill?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
  children: React.ReactNode;
}

/**
 * 스크롤 가능 영역 래퍼 — 상/하단 물결 그라데이션 + hover 스크롤바.
 * 스크롤이 가려진 방향에만 그라데이션 표시.
 *
 * - fill=false (기본): maxHeight로 고정 높이 제한. className은 내부 스크롤 div에 적용.
 * - fill=true: flex 부모 남은 공간 채움. className은 외부 래퍼에 적용.
 */
export function ScrollFade({ maxHeight, fill, className = '', children }: ScrollFadeProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowTop(el.scrollTop > 4);
    setShowBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [update]);

  // children 변경 시 재계산
  useEffect(() => { update(); }, [children, update]);

  const wrapperClass = fill
    ? `scroll-fade flex flex-col min-h-0 ${className}`
    : 'scroll-fade relative';

  const scrollClass = fill
    ? 'scrollbar-thin overflow-y-auto flex-1 min-h-0'
    : `scrollbar-thin overflow-y-auto ${className}`;

  const scrollStyle = fill ? undefined : (maxHeight != null ? { maxHeight } : undefined);

  return (
    <div className={wrapperClass}>
      <div className={`scroll-fade-top ${showTop ? 'visible' : ''}`} />
      <div
        ref={scrollRef}
        className={scrollClass}
        style={scrollStyle}
      >
        {children}
      </div>
      <div className={`scroll-fade-bottom ${showBottom ? 'visible' : ''}`} />
    </div>
  );
}
