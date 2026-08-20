import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 툴팁이 뜨기까지의 기본 지연(ms) — 네이티브 `title`(0.5~1초)보다 빠르되, 스쳐 지나갈 때는 안 뜨게. */
const DEFAULT_DELAY = 220;
/** 화면 가장자리에서 이만큼은 띄운다(px). */
const EDGE_GAP = 8;
/** 툴팁 폭(px) — 설명 두세 줄이 읽히는 폭. */
const TOOLTIP_WIDTH = 300;

interface InfoTooltipProps {
  /** 굵게 서는 첫 줄(대개 그 줄의 제목). */
  title: string;
  /** 설명 본문 — 여기가 비면 툴팁을 띄우지 않는다(빈 상자를 띄우느니 안 뜨는 편이 낫다). */
  body: string;
  /** 아래에 회색으로 붙는 한 줄(경로·"눌러 보세요" 같은 안내). */
  footer?: string;
  delay?: number;
  /** 감싸는 span 에 입힐 클래스 — 부모 레이아웃을 그대로 둔다. */
  className?: string;
  children: React.ReactNode;
}

/**
 * InfoTooltip.tsx — §5.5 #17-28 ⑦ **설명을 띄우는** 호버 툴팁.
 *
 * 옆에 있는 `HoverTooltip` 과 역할이 다르다 — 그쪽은 **잘린 라벨의 전문**을 보여 주는 것이라
 * 안 잘렸으면 뜨지 않는다. 이쪽은 라벨과 **다른 내용**(그 줄이 무엇인지)을 말하므로 항상 뜬다.
 *
 * 자리는 오른쪽을 먼저 보고, 폭이 모자라면 왼쪽 → 아래 순으로 물러난다. 사이드바(`w-72`)처럼 좁고
 * 스크롤되는 상자 안에서도 잘리지 않도록 `createPortal` 로 body 에 그린다.
 */
export function InfoTooltip({
  title,
  body,
  footer,
  delay = DEFAULT_DELAY,
  className,
  children,
}: InfoTooltipProps): React.JSX.Element {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const hide = useCallback(() => {
    clear();
    setAnchorRect(null);
    setPos(null);
  }, [clear]);

  const handleEnter = useCallback(() => {
    if (!body) return;
    clear();
    timerRef.current = window.setTimeout(() => {
      const el = anchorRef.current;
      if (!el) return;
      setAnchorRect(el.getBoundingClientRect());
    }, delay);
  }, [body, clear, delay]);

  // 실제 높이를 잰 뒤에야 화면 안으로 밀어 넣을 수 있다 — 그리기 전 한 번 더 자리를 잡는다.
  useLayoutEffect(() => {
    if (!anchorRect) return;
    const box = boxRef.current;
    const height = box?.offsetHeight ?? 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = anchorRect.right + EDGE_GAP;
    if (x + TOOLTIP_WIDTH + EDGE_GAP > vw) {
      const left = anchorRect.left - TOOLTIP_WIDTH - EDGE_GAP;
      x = left >= EDGE_GAP ? left : Math.max(EDGE_GAP, vw - TOOLTIP_WIDTH - EDGE_GAP);
    }
    const y = Math.min(Math.max(EDGE_GAP, anchorRect.top), Math.max(EDGE_GAP, vh - height - EDGE_GAP));
    setPos({ x, y });
  }, [anchorRect]);

  // 스크롤·리사이즈가 나면 자리가 어긋난다 — 따라다니게 만들기보다 그냥 접는다(호버는 곧 다시 든다).
  useEffect(() => {
    if (!anchorRect) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchorRect, hide]);

  useEffect(() => clear, [clear]);

  return (
    <span
      ref={anchorRef}
      className={className}
      onMouseEnter={handleEnter}
      onMouseLeave={hide}
      onMouseDown={hide}
    >
      {children}
      {anchorRect &&
        createPortal(
          <div
            ref={boxRef}
            role="tooltip"
            style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, width: TOOLTIP_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
            className="pointer-events-none fixed z-[9999] rounded-md border border-white/[0.08] bg-[#1f2937] px-2.5 py-2 shadow-xl shadow-black/50"
          >
            <p className="text-[12px] font-semibold leading-snug text-gray-100">{title}</p>
            <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-gray-300">{body}</p>
            {footer && <p className="mt-1.5 text-[12px] leading-snug text-gray-500">{footer}</p>}
          </div>,
          document.body,
        )}
    </span>
  );
}
