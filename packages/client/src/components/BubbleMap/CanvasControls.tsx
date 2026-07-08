import { useCallback, useEffect, useState } from 'react';
import { Panel, useReactFlow, useStore, useStoreApi } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { useIsNarrowViewport } from '../../hooks/useIsMobile';
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
const FitIcon = (): React.JSX.Element => (
  <Glyph>
    <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
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
    </Panel>
  );
}
