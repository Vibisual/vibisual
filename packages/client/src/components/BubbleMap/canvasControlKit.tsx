/**
 * 캔버스 컨트롤 공용 부품 — 캔버스든 IDE 안의 작은 지도든 **같은 손잡이로 보이게** 하는 곳.
 *
 * React Flow 기본 `<Controls>` 는 흰 사각 버튼이라 우리 화면에서 혼자 밝게 뜬다(`.react-flow.light`
 * 기본 스킨). 그 자리를 이 부품들이 대신한다. **새 React Flow 뷰를 만들면 기본 `<Controls>` 대신
 * 여기 것을 쓴다** — 디자인이 두 벌로 갈리는 순간 한쪽만 고쳐진다.
 *
 * 아이콘은 이모지 ❌, lucide 톤 stroke SVG 만(`CLAUDE.md` UI 아이콘 규칙).
 */
import { useCallback } from 'react';
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
  onClick: () => void;
  active?: boolean;
  /** 지금은 누를 수 없다 — 이유는 `label` 이 말한다(버튼을 숨기면 자리가 튀어 더 헷갈린다). */
  disabled?: boolean;
  children: React.ReactNode;
}

/** 컨트롤 버튼 하나 — 다크 + blue 액센트. 활성 표기는 캔버스 전반과 같은 톤이다. */
export function CtrlButton({ label, onClick, active, disabled, children }: CtrlButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
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

/**
 * 어느 React Flow 뷰에나 그대로 얹는 줌/화면맞춤 3종 — 기본 `<Controls showInteractive={false} />`
 * 자리를 그대로 대신한다. 동작은 기본 컨트롤과 같다(`zoomIn`/`zoomOut`/`fitView`).
 *
 * 화면맞춤에만 애니메이션을 준다 — 카메라가 어디로 갔는지 눈이 따라갈 수 있어야 한다.
 * 줌은 d3 가 이미 부드럽게 밀어 준다.
 */
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
