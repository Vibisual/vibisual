import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeHoverTooltip } from './hoverTooltipPlacement.js';
import type { CommandId } from '@vibisual/shared';
// §6 — 툴팁의 단축키 표시는 레지스트리에서 나온다(문구에 키를 적지 않는다).
import { KeyHint } from '../Shortcuts/KeyHint.js';

interface HoverTooltipProps {
  /** 표시할 풀 텍스트(= 잘리기 전 전체 라벨). */
  label: string;
  /** 라벨 span 에 입힐 클래스(truncate 등). 부모 레이아웃 그대로 유지. */
  className?: string;
  /** 호버 후 툴팁이 뜨기까지 지연(ms). 네이티브 title(~0.5~1s)보다 빠르게. */
  delay?: number;
  /** 툴팁 최대 가로(px). 사이드바처럼 긴 이름이 오는 자리는 넓게 준다. */
  maxWidth?: number;
  /** 잘리지 않았을 때도 띄운다(설명형 툴팁). 기본은 잘린 경우에만. */
  always?: boolean;
  /** 라벨 대신 그릴 내용(칩·아이콘을 함께 truncate 하는 자리). 없으면 label 을 그린다. */
  children?: React.ReactNode;
  /** 라벨 아래 옅게 붙일 부가 설명. 네이티브 title 과 겹쳐 뜨는 대신 한 박스에 모을 때. */
  detail?: string;
  /** 툴팁 안 라벨 줄에만 얹을 클래스(예: 스킬 이름은 `font-mono`). 트리거 span 과 별개. */
  labelClassName?: string;
  /** 트리거 span 의 네이티브 `title`. 부모의 title 이 우리 툴팁 위에 겹쳐 뜰 때 `''` 로 눌러 끈다. */
  title?: string;
  /**
   * §6 단축키 명령 — 주면 라벨 오른쪽에 **현재 배정된 키캡**을 붙인다.
   *
   * 다른 앱들이 툴팁에 키를 적어 주는 그 자리다. 우리는 그 문구를 손으로 적지 않고
   * 레지스트리에서 읽으므로, 사용자가 재매핑해도 툴팁이 옛 키를 말하지 않는다.
   */
  cmd?: CommandId;
}

/**
 * 잘린 라벨의 전문을 띄우는 경량 호버 툴팁.
 * - 네이티브 `title` 은 표시 지연이 브라우저 고정값이라 느리다 → 직접 그려서 지연을 짧게(기본 150ms).
 * - 탭·사이드바는 overflow 컨테이너 안이라 absolute 툴팁이 잘린다 → `createPortal` 로 body 에 띄운다.
 * - **실제로 truncate 된 경우(scrollWidth>clientWidth)에만** 표시 — 안 잘린 라벨엔 노이즈 X(`always` 로 해제).
 * - 띄운 뒤 **실측해서 뷰포트 안으로 당긴다** — 좁은 사이드바(w-52)의 라벨은 가운데 정렬만으로는
 *   박스 절반이 화면 밖으로 나간다. 아래로 넘치면 라벨 **위쪽으로 뒤집는다**.
 */
export function HoverTooltip({
  label,
  className,
  delay = 150,
  maxWidth = 320,
  always = false,
  children,
  detail,
  labelClassName,
  title,
  cmd,
}: HoverTooltipProps): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  /** 라벨의 화면 위치 — 실제 좌표는 박스를 실측한 뒤 `pos` 로 확정한다. */
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

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
      if (!always && el.scrollWidth <= el.clientWidth) return;
      setAnchor(el.getBoundingClientRect());
    }, delay);
  }, [clear, delay, always]);

  const handleLeave = useCallback(() => {
    clear();
    setAnchor(null);
    setPos(null);
  }, [clear]);

  // 박스를 실측해 뷰포트 안으로 당긴다. 페인트 전에 잡아야 한 프레임 튀지 않는다.
  useLayoutEffect(() => {
    if (!anchor) return;
    const box = boxRef.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    const { left, top } = placeHoverTooltip(
      anchor,
      { width, height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ left, top });
  }, [anchor, label, detail]);

  // 언마운트/스크롤 등으로 라벨이 사라질 때 타이머 누수 방지.
  useEffect(() => clear, [clear]);

  return (
    <span ref={ref} className={className} title={title} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {children ?? label}
      {anchor &&
        createPortal(
          <div
            ref={boxRef}
            className="pointer-events-none fixed z-[9999] whitespace-pre-wrap break-words rounded-md border border-white/[0.08] bg-[#1f2937] px-2 py-1 text-[12px] font-medium leading-snug text-gray-100 shadow-lg shadow-black/50"
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              maxWidth,
              // 실측 전(첫 프레임)에는 그리지 않는다 — 좌상단에 한 번 번쩍이는 것을 막는다.
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            <span className="flex items-center gap-2">
              <span className={`block min-w-0 flex-1 ${labelClassName ?? ''}`}>{label}</span>
              {/* 툴팁 박스는 `pointer-events-none` 이라 애초에 누를 수 없다 — 읽기 전용으로 못 박는다. */}
              {cmd && <KeyHint cmd={cmd} editable={false} className="shrink-0" />}
            </span>
            {detail && (
              // 위계는 크기가 아니라 색·굵기로 — 한글 가독 하한 12px(§9)을 지킨다.
              <span className="mt-1 block border-t border-white/[0.08] pt-1 text-[12px] font-normal text-gray-400">
                {detail}
              </span>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
