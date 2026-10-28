import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizeSnipRect } from './snipRect.js';
import type { PreviewSnip } from './usePreviewSnip.js';

/**
 * §5.17 (B) — 조준 레이어. 덮인 동안 프리뷰 조작을 막는다(긋는 클릭이 앱을 누르지 않게).
 * 좌표는 창 기준 CSS px — `capturePage(rect)` 와 같고 캔버스 줌·스크롤도 이미 반영돼 있어 변환하지 않는다.
 */

interface Point { x: number; y: number }

/** 크기 표시(`-top-5`, 20px)가 상자 위에 들어갈 자리 — 상자 윗변이 이보다 위쪽이면 상자 안쪽으로 내린다. */
const SNIP_SIZE_LABEL_ROOM_PX = 20;

export function PreviewSnipOverlay({ snip }: { snip: PreviewSnip }): React.JSX.Element | null {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);

  const reset = useCallback(() => { setStart(null); setCurrent(null); }, []);

  // Esc — 그리던 사각형과 캡처 모드를 함께 접는다.
  useEffect(() => {
    if (!snip.snipMode) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      reset();
      snip.cancel();
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [snip, reset]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setStart({ x: e.clientX, y: e.clientY });
    setCurrent({ x: e.clientX, y: e.clientY });
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!start) return;
    setCurrent({ x: e.clientX, y: e.clientY });
  }, [start]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!start) return;
    e.preventDefault();
    e.stopPropagation();
    const host = hostRef.current?.getBoundingClientRect();
    const bounds = host ? { x: host.left, y: host.top, width: host.width, height: host.height } : undefined;
    const rect = normalizeSnipRect(start, { x: e.clientX, y: e.clientY }, bounds);
    reset();
    // 너무 작게 그은 것은 오조작이다 — 아무 것도 찍지 않고 조준 레이어만 접는다.
    if (!rect) { snip.cancel(); return; }
    snip.capture(rect);
  }, [start, reset, snip]);

  if (!snip.snipMode) return null;

  const host = hostRef.current?.getBoundingClientRect();
  const box = start && current && host
    ? {
      left: Math.min(start.x, current.x) - host.left,
      top: Math.min(start.y, current.y) - host.top,
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    }
    : null;

  return (
    <div
      ref={hostRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute inset-0 z-20 cursor-crosshair bg-sky-500/10"
    >
      {box === null && (
        <div className="pointer-events-none absolute left-1/2 top-2 max-w-[calc(100%-1rem)] -translate-x-1/2 rounded bg-gray-950/85 px-2 py-0.5 text-center text-[12px] text-sky-200">
          {t('common.preview.snipHint')}
        </div>
      )}
      {box !== null && (
        <div
          className="pointer-events-none absolute border border-sky-300 bg-sky-400/20"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        >
          {/* 크기 표시는 상자 위에 붙인다 — 상자가 위쪽 가장자리에 붙어 그 자리가 없으면 상자 안쪽 위로 내린다
              (밖에 두면 프리뷰 칸의 `overflow-hidden` 에 잘려 숫자가 안 보였다). */}
          <span
            className={`absolute whitespace-nowrap rounded bg-gray-950/85 px-1 text-[12px] text-sky-200 ${
              box.top < SNIP_SIZE_LABEL_ROOM_PX ? 'left-1 top-1' : '-top-5 left-0'
            }`}
          >
            {Math.round(box.width)} × {Math.round(box.height)}
          </span>
        </div>
      )}
    </div>
  );
}
