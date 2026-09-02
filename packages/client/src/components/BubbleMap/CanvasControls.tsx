import { useCallback, useEffect, useState } from 'react';
import { Panel, useReactFlow, useStore, useStoreApi } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useIsNarrowViewport } from '../../hooks/useIsMobile';
import { HEATMAP_RAMP, HEATMAP_ZERO_COLOR } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore';

/** 공통 stroke SVG 래퍼 — lucide 톤 (viewBox 24, fill none, currentColor, round). */
function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
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

const PlusIcon = (): React.JSX.Element => (
  <Glyph><path d="M12 5v14M5 12h14" /></Glyph>
);
const MinusIcon = (): React.JSX.Element => (
  <Glyph><path d="M5 12h14" /></Glyph>
);
// 화면맞춤(중앙 포커싱) — 전체화면의 모서리 괄호와 헷갈리지 않도록 조준경처럼 중앙에 원을 둔다.
const FitIcon = (): React.JSX.Element => (
  <Glyph>
    <circle cx="12" cy="12" r="3" />
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
  </Glyph>
);
const LockIcon = (): React.JSX.Element => (
  <Glyph>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Glyph>
);
const UnlockIcon = (): React.JSX.Element => (
  <Glyph>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </Glyph>
);
const FullscreenIcon = (): React.JSX.Element => (
  <Glyph>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
  </Glyph>
);
const ExitFullscreenIcon = (): React.JSX.Element => (
  <Glyph>
    <path d="M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3" />
  </Glyph>
);
// §5.24 읽기 히트맵 — 불꽃. "열"을 한 글리프로 말하는 가장 짧은 기호다.
const HeatIcon = (): React.JSX.Element => (
  <Glyph>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />
  </Glyph>
);
const RefreshIcon = ({ spinning }: { spinning?: boolean }): React.JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`h-3.5 w-3.5 pointer-coarse:h-5 pointer-coarse:w-5 ${spinning ? 'animate-spin' : ''}`}
    aria-hidden="true"
  >
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

/**
 * §5.24 — 히트 범례. **이것이 "상대적"이라는 말을 화면에서 성립시키는 유일한 장치다** —
 * 숫자가 없으면 사용자는 색이 절대 기준인지 상대 기준인지 알 수 없다.
 *
 * 값이 0 인(=아직 아무것도 안 읽은) 프로젝트에서는 램프 대신 한 줄만 둔다 —
 * 0 을 최대로 둔 램프는 모든 버블이 최고온으로 그려져 거짓말이 된다.
 */
function HeatLegend({ max }: { max: number }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-white/10 bg-gray-900/60 px-2 py-1.5 shadow-md shadow-black/30 backdrop-blur-md">
      <div className="mb-1 text-[12px] font-medium text-gray-300">{t('canvas.heatmap.title')}</div>
      {max <= 0 ? (
        <div className="text-[12px] text-gray-500">{t('canvas.heatmap.empty')}</div>
      ) : (
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] tabular-nums text-gray-500">0</span>
          {/* 램프는 런타임 상수 배열에서 오므로 Tailwind 클래스로 표현할 수 없다 —
              동적 색은 캔버스 전반과 같이 style 로 준다(버블 본체 색과 같은 예외). */}
          <span
            className="h-2 w-24 rounded-sm ring-1 ring-inset ring-white/10"
            style={{ background: `linear-gradient(to right, ${HEATMAP_ZERO_COLOR} 0%, ${HEATMAP_RAMP.join(', ')})` }}
          />
          <span className="text-[12px] tabular-nums text-gray-300">{t('canvas.heatmap.max', { n: max })}</span>
        </div>
      )}
    </div>
  );
}

interface CtrlButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}

function CtrlButton({ label, onClick, active, children }: CtrlButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center transition-colors pointer-coarse:h-11 pointer-coarse:w-11 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-400 ${
        active
          ? 'bg-blue-500/25 text-blue-300'
          : 'text-gray-100 hover:bg-blue-500/20 hover:text-blue-300 active:bg-blue-500/30'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * 캔버스 좌하단 줌/핏/잠금 컨트롤.
 * React Flow 기본 <Controls> 를 대체 — 프로젝트 디자인(다크 + blue 액센트)에 맞춘
 * 고대비 플로팅 패널. 상호작용 토글은 공식 Controls 와 동일하게 store 를 갱신한다.
 */
export function CanvasControls(): React.JSX.Element {
  const { t } = useTranslation();
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const store = useStoreApi();
  const isNarrow = useIsNarrowViewport();
  const isInteractive = useStore(
    (s) => s.nodesDraggable || s.nodesConnectable || s.elementsSelectable,
  );
  // 새로고침 — 활성 프로젝트 스냅샷을 서버(디스크)에서 다시 불러온다(버블/에이전트 재적재).
  const activeProject = useGraphStore((s) => s.activeProject);
  const isHydrating = useGraphStore((s) => (activeProject ? !!s.hydratingProjects[activeProject] : false));
  // §5.24 — 읽기 히트맵. 캔버스를 **보는 방식**을 바꾸는 것이라 줌·핏·잠금과 같은 줄에 선다.
  const heatmapMode = useGraphStore((s) => s.heatmapMode);
  const heatMax = useGraphStore((s) => s.readCountRange.max);
  const toggleHeatmapMode = useGraphStore((s) => s.toggleHeatmapMode);

  // 모바일 웹 접속(§4)에서만 노출되는 전체화면 토글. Fullscreen API 로 문서 루트를 확대하고,
  // fullscreenchange 를 구독해 다른 경로(ESC·시스템 제스처)로 풀려도 상태가 어긋나지 않게 한다.
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && !!document.fullscreenElement,
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = (): void => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const handleZoomIn = useCallback(() => { zoomIn(); }, [zoomIn]);
  const handleZoomOut = useCallback(() => { zoomOut(); }, [zoomOut]);
  const handleFitView = useCallback(() => { fitView({ duration: 300 }); }, [fitView]);
  const handleToggleLock = useCallback(() => {
    store.setState({
      nodesDraggable: !isInteractive,
      nodesConnectable: !isInteractive,
      elementsSelectable: !isInteractive,
    });
  }, [store, isInteractive]);
  const handleRefresh = useCallback(() => {
    if (!activeProject) return;
    useGraphStore.getState().hydrateProject(activeProject);
  }, [activeProject]);
  const handleToggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void document.documentElement.requestFullscreen?.();
    }
  }, []);

  return (
    <Panel position="bottom-left" className="!mb-12 !ml-3">
      <div className="flex flex-col items-start gap-1.5">
      {heatmapMode && <HeatLegend max={heatMax} />}
      <div className="flex flex-col divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10 bg-gray-900/60 shadow-md shadow-black/30 backdrop-blur-md">
        <CtrlButton label={t('canvas.controls.zoomIn')} onClick={handleZoomIn}>
          <PlusIcon />
        </CtrlButton>
        <CtrlButton label={t('canvas.controls.zoomOut')} onClick={handleZoomOut}>
          <MinusIcon />
        </CtrlButton>
        <CtrlButton label={t('canvas.controls.fitView')} onClick={handleFitView}>
          <FitIcon />
        </CtrlButton>
        <CtrlButton
          label={heatmapMode ? t('canvas.controls.heatmapOff') : t('canvas.controls.heatmap')}
          onClick={toggleHeatmapMode}
          active={heatmapMode}
        >
          <HeatIcon />
        </CtrlButton>
        <CtrlButton
          label={t('canvas.controls.refresh', { defaultValue: 'Reload project' })}
          onClick={handleRefresh}
        >
          <RefreshIcon spinning={isHydrating} />
        </CtrlButton>
        <CtrlButton
          label={isInteractive ? t('canvas.controls.lock') : t('canvas.controls.unlock')}
          onClick={handleToggleLock}
          active={!isInteractive}
        >
          {isInteractive ? <UnlockIcon /> : <LockIcon />}
        </CtrlButton>
        {isNarrow && (
          <CtrlButton
            label={isFullscreen ? t('canvas.controls.exitFullscreen') : t('canvas.controls.fullscreen')}
            onClick={handleToggleFullscreen}
            active={isFullscreen}
          >
            {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
          </CtrlButton>
        )}
      </div>
      </div>
    </Panel>
  );
}
