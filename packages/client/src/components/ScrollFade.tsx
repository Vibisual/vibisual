import { useRef, useEffect, useCallback, useState } from 'react';

/** 지금 보이는 구간 — `onViewport` 가 알려주는 값. */
export interface ScrollViewport {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

interface ScrollFadeProps {
  /** 최대 높이 (px). fill=true일 때는 무시됨. */
  maxHeight?: number;
  /** true면 flex 부모의 남은 공간을 채움 (flex-1 용도). className은 외부 래퍼에 적용. */
  fill?: boolean;
  /** 추가 CSS 클래스 */
  className?: string;
  /** 보이는 구간 알림(§7.5 윈도잉). 기존 `scroll`·`ResizeObserver` 에서 부른다 — 목록마다 스크롤 컨테이너를 따로 만들면 그라데이션 규약이 두 벌이 된다. */
  onViewport?: (v: ScrollViewport) => void;
  children: React.ReactNode;
}

/** 가려진 방향에만 그라데이션 + hover 스크롤바. className 은 fill=false 면 안쪽 스크롤 div, fill=true(flex 남은 공간)면 바깥 래퍼에. */
export function ScrollFade({ maxHeight, fill, className = '', onViewport, children }: ScrollFadeProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);

  // 콜백은 ref 로 잡는다 — 인라인 함수를 의존성에 두면 렌더마다 리스너가 다시 걸린다.
  const onViewportRef = useRef(onViewport);
  onViewportRef.current = onViewport;

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowTop(el.scrollTop > 4);
    setShowBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    onViewportRef.current?.({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    });
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
      <div className={`scroll-fade-top ${showTop ? 'scroll-fade-shown' : ''}`} />
      <div
        ref={scrollRef}
        className={scrollClass}
        style={scrollStyle}
      >
        {children}
      </div>
      <div className={`scroll-fade-bottom ${showBottom ? 'scroll-fade-shown' : ''}`} />
    </div>
  );
}
