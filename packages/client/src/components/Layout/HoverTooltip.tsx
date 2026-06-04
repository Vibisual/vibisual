import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface HoverTooltipProps {
  /** 표시할 풀 텍스트(= 잘리기 전 전체 라벨). */
  label: string;
  /** 라벨 span 에 입힐 클래스(truncate 등). 부모 레이아웃 그대로 유지. */
  className?: string;
  /** 호버 후 툴팁이 뜨기까지 지연(ms). 네이티브 title(~0.5~1s)보다 빠르게. */
  delay?: number;
}

/**
 * 탭 라벨용 경량 호버 툴팁.
 * - 네이티브 `title` 은 표시 지연이 브라우저 고정값이라 느리다 → 직접 그려서 지연을 짧게(기본 150ms).
 * - 탭은 overflow-x-auto/overflow-y-hidden 컨테이너 안이라 absolute 툴팁이 잘린다 → `createPortal` 로 body 에 띄운다.
 * - **실제로 truncate 된 경우(scrollWidth>clientWidth)에만** 표시 — 안 잘린 라벨엔 노이즈 X.
 */
export function HoverTooltip({ label, className, delay = 150 }: HoverTooltipProps): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const handleEnter = useCallback(() => {
    clear();
    timerRef.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      // 잘리지 않았으면(=풀 표시 중) 띄우지 않는다.
      if (el.scrollWidth <= el.clientWidth) return;
      const r = el.getBoundingClientRect();
      setPos({ x: r.left + r.width / 2, y: r.bottom + 4 });
    }, delay);
  }, [clear, delay]);

  const handleLeave = useCallback(() => {
    clear();
    setPos(null);
  }, [clear]);

  // 언마운트/스크롤 등으로 라벨이 사라질 때 타이머 누수 방지.
  useEffect(() => clear, [clear]);

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {label}
      {pos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[9999] max-w-[320px] -translate-x-1/2 truncate rounded-md border border-white/[0.08] bg-[#1f2937] px-2 py-1 text-[11px] font-medium text-gray-100 shadow-lg shadow-black/50"
            style={{ left: pos.x, top: pos.y }}
          >
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
