/** 캔버스 컨트롤 공용 부품 — 새 React Flow 뷰도 기본 `<Controls>`(흰 사각, 혼자 밝게 뜬다) 대신 이것을 쓴다. 두 벌이면 한쪽만 고쳐진다. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Panel, useReactFlow, type PanelPosition } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

/** 공통 stroke SVG 래퍼 — lucide 톤 (viewBox 24, fill none, currentColor, round). */
export function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 pointer-coarse:h-5 pointer-coarse:w-5"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (): React.JSX.Element => (
  <Glyph><path d="M12 5v14M5 12h14" /></Glyph>
);
export const MinusIcon = (): React.JSX.Element => (
  <Glyph><path d="M5 12h14" /></Glyph>
);
// 화면맞춤(중앙 포커싱) — 전체화면의 모서리 괄호와 헷갈리지 않도록 조준경처럼 중앙에 원을 둔다.
export const FitIcon = (): React.JSX.Element => (
  <Glyph>
    <circle cx="12" cy="12" r="3" />
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
  </Glyph>
);

export interface CtrlButtonProps {
  label: string;
  /** Hover/touch hint can include the current shortcut while the accessible name stays stable. */
  title?: string;
  onClick: () => void;
  active?: boolean;
  /** 지금은 누를 수 없다 — 이유는 `label` 이 말한다(버튼을 숨기면 자리가 튀어 더 헷갈린다). */
  disabled?: boolean;
  children: React.ReactNode;
}

/** 터치에서 이름표를 띄우기까지 누르고 있어야 하는 시간(ms). */
const HOLD_LABEL_MS = 450;
/** 손을 뗀 뒤 이름표가 남아 있는 시간(ms) — 읽을 틈. */
const HOLD_LABEL_LINGER_MS = 1200;
/** 이만큼 움직이면 누르기가 아니라 끌기(무리 스크롤 등) — 이름표를 걸지 않는다(px). */
const HOLD_LABEL_MOVE_PX = 10;
/** 이름표와 단추 사이 틈(px). */
const HOLD_LABEL_GAP = 8;

/**
 * 터치 길게 누르기 = 이름표(아이콘 단추의 `title` 은 손가락에 안 뜬다). 이름표를 띄운 누름은 누르기로 치지 않고(잠금·전체화면 ❌),
 * click 이 안 오는 브라우저를 위해 다음 누름·걷힘에 그 표시를 푼다(Enter 가 먹히지 않게 되지 않도록).
 */
function useHoldLabel(): {
  rect: DOMRect | null;
  handlers: {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
  };
  consumeClick: () => boolean;
} {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** 손가락이 지금 누르고 있는가 — 길게 누르기가 부르는 브라우저 메뉴(contextmenu)를 그동안만 막는다. */
  const holding = useRef(false);
  /** 이름표를 띄운 누름 — 그 누름이 낳은 click 은 단추 동작이 아니다. */
  const swallow = useRef(false);

  const clearHold = (): void => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
  };
  const clearHide = (): void => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  };
  useEffect(() => () => { clearHold(); clearHide(); }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>): void => {
    swallow.current = false;
    if (e.pointerType === 'mouse') return;
    clearHold();
    clearHide();
    setRect(null);
    const el = e.currentTarget;
    start.current = { x: e.clientX, y: e.clientY };
    holding.current = true;
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      swallow.current = true;
      setRect(el.getBoundingClientRect());
    }, HOLD_LABEL_MS);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>): void => {
    const s = start.current;
    if (!s || !holdTimer.current) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > HOLD_LABEL_MOVE_PX) {
      clearHold();
      start.current = null;
    }
  }, []);

  const release = useCallback((): void => {
    clearHold();
    start.current = null;
    holding.current = false;
    if (!swallow.current) return;
    clearHide();
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      swallow.current = false;
      setRect(null);
    }, HOLD_LABEL_LINGER_MS);
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent): void => {
    if (holding.current) e.preventDefault();
  }, []);

  const consumeClick = useCallback((): boolean => {
    if (!swallow.current) return false;
    swallow.current = false;
    return true;
  }, []);

  return {
    rect,
    handlers: { onPointerDown, onPointerMove, onPointerUp: release, onPointerCancel: release, onContextMenu },
    consumeClick,
  };
}

/** 컨트롤 버튼 하나 — 다크 + blue 액센트. 활성 표기는 캔버스 전반과 같은 톤이다. */
export function CtrlButton({ label, title = label, onClick, active, disabled, children }: CtrlButtonProps): React.JSX.Element {
  const hold = useHoldLabel();
  const rect = hold.rect;
  // 이름표는 단추 옆 넓은 쪽에 선다(무리는 보통 왼쪽 아래 — 오른쪽). 화면 좌표라 캔버스 패널의 잘림 밖으로 띄운다.
  const placeLeft = rect !== null && typeof window !== 'undefined' && rect.left > window.innerWidth / 2;
  return (
    <>
      <button
        type="button"
        onClick={() => { if (!hold.consumeClick()) onClick(); }}
        {...hold.handlers}
        disabled={disabled}
        title={title}
        aria-label={label}
        aria-pressed={active}
        className={`flex h-7 w-7 items-center justify-center transition-colors pointer-coarse:h-11 pointer-coarse:w-11 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400 ${
          disabled
            ? 'cursor-not-allowed text-gray-600'
            : active
              ? 'bg-blue-500/25 text-blue-300'
              : 'text-gray-100 hover:bg-blue-500/20 hover:text-blue-300 active:bg-blue-500/30'
        }`}
      >
        {children}
      </button>
      {rect && createPortal(
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[70] max-w-[calc(100vw-16px)] -translate-y-1/2 truncate whitespace-nowrap rounded-md border border-white/10 bg-gray-900/95 px-2 py-1 text-[12px] text-gray-100 shadow-lg shadow-black/40"
          style={placeLeft
            ? { right: window.innerWidth - rect.left + HOLD_LABEL_GAP, top: rect.top + rect.height / 2 }
            : { left: rect.right + HOLD_LABEL_GAP, top: rect.top + rect.height / 2 }}
        >
          {title}
        </span>,
        document.body,
      )}
    </>
  );
}

/** 버튼을 세로로 쌓는 플로팅 패널 — 컨트롤 무리의 껍데기(고대비 + 배경 흐림). */
export function CtrlPanel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-gray-900/60 shadow-md shadow-black/30 backdrop-blur-md">
      {children}
    </div>
  );
}

interface CanvasZoomControlsProps {
  /** 붙일 모서리. 기본은 React Flow 기본 `<Controls>` 와 같은 좌하단이다. */
  position?: PanelPosition;
  /** 여백 조정용 — 뷰마다 아래에 깔린 것(상태줄 등)이 다르다. */
  className?: string;
}

/** 기본 `<Controls showInteractive={false} />` 대체(같은 동작). 화면맞춤만 애니메이션 — 카메라가 간 곳을 눈이 따라가야 한다. */
export function CanvasZoomControls({ position = 'bottom-left', className = '' }: CanvasZoomControlsProps): React.JSX.Element {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const handleZoomIn = useCallback(() => { zoomIn(); }, [zoomIn]);
  const handleZoomOut = useCallback(() => { zoomOut(); }, [zoomOut]);
  const handleFitView = useCallback(() => { fitView({ duration: 300 }); }, [fitView]);
  return (
    <Panel position={position} className={className}>
      <CtrlPanel>
        <CtrlButton label={t('canvas.controls.zoomIn')} onClick={handleZoomIn}>
          <PlusIcon />
        </CtrlButton>
        <CtrlButton label={t('canvas.controls.zoomOut')} onClick={handleZoomOut}>
          <MinusIcon />
        </CtrlButton>
        <CtrlButton label={t('canvas.controls.fitView')} onClick={handleFitView}>
          <FitIcon />
        </CtrlButton>
      </CtrlPanel>
    </Panel>
  );
}
