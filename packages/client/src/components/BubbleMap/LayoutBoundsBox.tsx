import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewportPortal, useReactFlow } from '@xyflow/react';
import { LAYOUT_CENTER_X, LAYOUT_CENTER_Y } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';

/**
 * 루트 캔버스에서 부모 버블이 나가지 못하도록 하는 사각 바운딩 박스.
 * - 회색 점선(드문드문)으로 영역만 시각화 — 별도 핸들 글리프 없음.
 * - 4개 변(N/E/S/W) 어디든 pointerdown → 해당 변을 끌어 박스 크기 조절.
 * - 변 근처 일정 두께(`HIT_THICKNESS`) 만 hit 영역, 나머지는 클릭 통과.
 *
 * 물리 클램프는 usePhysicsLayout 가 store 의 layoutBoundsByProject 를 읽어 처리.
 * 이 컴포넌트는 루트 뷰(currentFolderId === null) 에서만 마운트한다.
 */

type Edge = 'n' | 's' | 'e' | 'w';

const HIT_THICKNESS = 16;
const MIN_HALF = 300;
const MAX_HALF = 8000;

const DEFAULT_HW = 1500;
const DEFAULT_HH = 1100;

export function LayoutBoundsBox(): React.JSX.Element | null {
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const activeProject = useGraphStore((s) => s.activeProject);
  const bounds = useGraphStore((s) =>
    activeProject ? s.layoutBoundsByProject[activeProject] : undefined,
  );
  const setSize = useGraphStore((s) => s.setLayoutBoundsSize);
  const flushSize = useGraphStore((s) => s.flushLayoutBoundsSize);
  const { screenToFlowPosition } = useReactFlow();

  const halfWidth = bounds?.hw ?? DEFAULT_HW;
  const halfHeight = bounds?.hh ?? DEFAULT_HH;

  const [dragging, setDragging] = useState<Edge | null>(null);
  const dragRef = useRef<{
    edge: Edge;
    startHW: number;
    startHH: number;
    startFlowX: number;
    startFlowY: number;
  } | null>(null);

  const left = LAYOUT_CENTER_X - halfWidth;
  const top = LAYOUT_CENTER_Y - halfHeight;
  const width = halfWidth * 2;
  const height = halfHeight * 2;

  const onEdgePointerDown = useCallback(
    (edge: Edge) => (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      dragRef.current = {
        edge,
        startHW: halfWidth,
        startHH: halfHeight,
        startFlowX: flow.x,
        startFlowY: flow.y,
      };
      setDragging(edge);
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },
    [halfWidth, halfHeight, screenToFlowPosition],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent): void => {
      const ctx = dragRef.current;
      if (!ctx) return;
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const dx = flow.x - ctx.startFlowX;
      const dy = flow.y - ctx.startFlowY;
      let nextHW = ctx.startHW;
      let nextHH = ctx.startHH;
      if (ctx.edge === 'e') nextHW = ctx.startHW + dx;
      else if (ctx.edge === 'w') nextHW = ctx.startHW - dx;
      else if (ctx.edge === 's') nextHH = ctx.startHH + dy;
      else if (ctx.edge === 'n') nextHH = ctx.startHH - dy;
      nextHW = Math.min(MAX_HALF, Math.max(MIN_HALF, nextHW));
      nextHH = Math.min(MAX_HALF, Math.max(MIN_HALF, nextHH));
      setSize(nextHW, nextHH);
    };
    const onUp = (): void => {
      dragRef.current = null;
      setDragging(null);
      // 드래그 종료 시 1회만 서버에 영속화 — 중간 broadcast 로 인한 리렌더 스태거 방지
      flushSize();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, screenToFlowPosition, setSize, flushSize]);

  const hitBase: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'auto',
    background: 'transparent',
  };

  return (
    <ViewportPortal>
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width,
          height,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      >
        {/* 회색 점선(드문드문) 테두리 — 시각화만, 인터랙션 없음. 변 4개를 background-image 로 표현. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: [
              'repeating-linear-gradient(90deg, rgba(148,163,184,0.55) 0 6px, transparent 6px 18px)',
              'repeating-linear-gradient(90deg, rgba(148,163,184,0.55) 0 6px, transparent 6px 18px)',
              'repeating-linear-gradient(0deg, rgba(148,163,184,0.55) 0 6px, transparent 6px 18px)',
              'repeating-linear-gradient(0deg, rgba(148,163,184,0.55) 0 6px, transparent 6px 18px)',
            ].join(', '),
            backgroundSize: '100% 1.5px, 100% 1.5px, 1.5px 100%, 1.5px 100%',
            backgroundPosition: 'left top, left bottom, left top, right top',
            backgroundRepeat: 'no-repeat',
          }}
        />
        {/* 좌상단 외부 라벨 — 외곽선 이름 + (?) 툴팁 + 현재 크기 */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: -22,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'rgba(148,163,184,0.75)',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        >
          <span>{t('canvas.bounds.label')}</span>
          {/* 물음표 — hover/focus 시 툴팁 노출. pointerEvents: auto 로 hit 만 받음. */}
          <span
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onFocus={() => setShowTooltip(true)}
            onBlur={() => setShowTooltip(false)}
            tabIndex={0}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 14,
              height: 14,
              borderRadius: 9999,
              border: '1px solid rgba(148,163,184,0.55)',
              color: 'rgba(148,163,184,0.85)',
              cursor: 'help',
              pointerEvents: 'auto',
              fontSize: 9,
              lineHeight: '1',
            }}
            aria-label={t('canvas.bounds.tooltip')}
          >
            <svg
              viewBox="0 0 24 24"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4" />
              <circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
            </svg>
            {showTooltip && (
              <span
                role="tooltip"
                style={{
                  position: 'absolute',
                  left: '100%',
                  top: '50%',
                  transform: 'translate(8px, -50%)',
                  whiteSpace: 'normal',
                  width: 260,
                  padding: '6px 8px',
                  background: 'rgba(15,23,42,0.95)',
                  color: 'rgba(226,232,240,0.95)',
                  border: '1px solid rgba(71,85,105,0.7)',
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                  lineHeight: 1.45,
                  pointerEvents: 'none',
                  zIndex: 10,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                }}
              >
                {t('canvas.bounds.tooltip')}
              </span>
            )}
          </span>
          <span>{width} × {height}</span>
        </div>
        {/* hit-zone — 변 어디서나 드래그 시작 가능. 보이지 않는 두꺼운 띠. */}
        <div
          onPointerDown={onEdgePointerDown('n')}
          style={{
            ...hitBase,
            left: 0,
            top: -HIT_THICKNESS / 2,
            width: '100%',
            height: HIT_THICKNESS,
            cursor: 'ns-resize',
          }}
        />
        <div
          onPointerDown={onEdgePointerDown('s')}
          style={{
            ...hitBase,
            left: 0,
            top: height - HIT_THICKNESS / 2,
            width: '100%',
            height: HIT_THICKNESS,
            cursor: 'ns-resize',
          }}
        />
        <div
          onPointerDown={onEdgePointerDown('w')}
          style={{
            ...hitBase,
            left: -HIT_THICKNESS / 2,
            top: 0,
            width: HIT_THICKNESS,
            height: '100%',
            cursor: 'ew-resize',
          }}
        />
        <div
          onPointerDown={onEdgePointerDown('e')}
          style={{
            ...hitBase,
            left: width - HIT_THICKNESS / 2,
            top: 0,
            width: HIT_THICKNESS,
            height: '100%',
            cursor: 'ew-resize',
          }}
        />
      </div>
    </ViewportPortal>
  );
}
