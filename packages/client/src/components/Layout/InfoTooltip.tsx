import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useLongPress } from '../../hooks/useIsMobile.js';

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

/** §5.5 #17-28 ⑦ — 설명 툴팁. `HoverTooltip`(잘렸을 때만)과 달리 항상 뜬다. 오른쪽 → 왼쪽 → 아래로 물러나고, 잘리지 않게 body 포털. */
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

  /** 길게 눌러 띄운 판인가(터치) — 그때는 뒤따르는 흉내 `mousedown` 으로 접지 않고 다음 터치에서 접는다. */
  const [touchShown, setTouchShown] = useState(false);

  const hide = useCallback(() => {
    clear();
    setAnchorRect(null);
    setPos(null);
    setTouchShown(false);
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

  /** 터치에는 hover 가 없다 — 흉내 `mouseenter` 뒤의 `mousedown` 이 `hide` 로 지운다. 탭은 줄의 원래 동작이라, 터치는 길게 눌러 띄우고 다음 터치에 접는다. */
  const showByLongPress = useCallback(() => {
    const el = anchorRef.current;
    if (!body || !el) return;
    clear();
    setAnchorRect(el.getBoundingClientRect());
    setTouchShown(true);
  }, [body, clear]);
  const longPress = useLongPress(showByLongPress);
  useEffect(() => {
    if (!touchShown || !anchorRect) return;
    const onNextTouch = (): void => { hide(); };
    window.addEventListener('touchstart', onNextTouch, { capture: true, once: true });
    return () => window.removeEventListener('touchstart', onNextTouch, { capture: true });
  }, [touchShown, anchorRect, hide]);

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
      onMouseDown={() => { if (!touchShown) hide(); }}
      {...longPress}
    >
      {children}
      {anchorRect &&
        createPortal(
          <div
            ref={boxRef}
            role="tooltip"
            style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, width: TOOLTIP_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
            className="pointer-events-none fixed z-[9999] rounded-md border border-white/[0.08] bg-vb-raised px-2.5 py-2 shadow-xl shadow-black/50"
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
