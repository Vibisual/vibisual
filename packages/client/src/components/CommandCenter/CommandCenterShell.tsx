import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WS_PATH } from '@vibisual/shared';
import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { CommandCenterBoard } from './CommandCenterBoard.js';

// SCENARIO.md §5.12 (A) — 지휘통제실 창의 shell. `#command=1&projectId=…` 로 뜨는 네 번째 shell
// (DetachedShell / OverlayShell / OverlayMenuShell 에 이어).
//
// 데이터: 같은 in-process 서버에 IPC WS 로 붙어 같은 graph_snapshot 을 받는다(별창 선례 — 별도
// hydrate·별도 REST ❌). 자기 창의 활성 프로젝트는 `setActiveProjectLocal` 로 **로컬만** 설정해
// 서버 appState 를 건드리지 않는다(다른 창의 활성 탭에 영향 ❌).
//
// 캔버스(BubbleMap)는 그리지 않는다 — 목록·검색 전용 화면(§5.12 (G)).

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;

export interface CommandCenterShellProps {
  projectId: string;
}

/** main.tsx 가 부팅 시 호출 — `#command=1&projectId=...` 파싱. */
export function parseCommandCenterHash(hash: string): { projectId: string } | null {
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('command') !== '1') return null;
  const projectId = params.get('projectId');
  if (!projectId) return null;
  return { projectId };
}

export function CommandCenterShell({ projectId }: CommandCenterShellProps): React.JSX.Element {
  useWebSocket(WS_URL);
  const { t } = useTranslation();

  const projects = useGraphStore((s) => s.projects);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  const setActiveProjectLocal = useGraphStore((s) => s.setActiveProjectLocal);

  useEffect(() => {
    setActiveProjectLocal(projectId);
  }, [projectId, setActiveProjectLocal]);

  const known = !!projects[projectId] || !!stubProjects[projectId];

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-950 text-gray-100">
      <CommandCenterTitleBar projectId={projectId} />
      <main className="min-h-0 flex-1 overflow-hidden">
        {known ? (
          <CommandCenterBoard projectId={projectId} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
            <svg className="h-10 w-10 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <p className="text-[13px] text-gray-300">
              {t('commandCenter.missingTitle', { defaultValue: 'Project not loaded' })}
            </p>
            <p className="text-[11px] text-gray-500">
              {t('commandCenter.missingBody', { defaultValue: 'The project "{{name}}" is not open in this Vibisual instance.', name: projectId })}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * 미니 타이틀바 — 별창(§5.4 #14-1)과 같은 톤이되 **redock 드래그는 없다**(탭이 아니라 도구 창).
 * 최소화/최대화/닫기는 별창의 기존 `vibisual:window:*-self` 채널을 그대로 쓴다.
 */
function CommandCenterTitleBar({ projectId }: { projectId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = window.api;
    if (!api?.window?.onMaximizeState) return;
    const off = api.window.onMaximizeState((s) => setMaximized(s.maximized));
    return () => { off(); };
  }, []);

  const handleMinimize = useCallback((): void => { void window.api?.window?.minimizeSelf(); }, []);
  const handleToggleMaximize = useCallback((): void => { void window.api?.window?.toggleMaximizeSelf(); }, []);
  const handleClose = useCallback((): void => { void window.api?.window?.closeSelf(); }, []);

  return (
    <div className="flex h-9 flex-shrink-0 items-stretch border-b border-black/40 bg-[#1f2937] select-none">
      <div className="flex flex-shrink-0 items-center gap-2 px-3 text-[12px] font-medium text-gray-200">
        <svg className="h-3.5 w-3.5 flex-shrink-0 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
          <circle cx="12" cy="12" r="4" />
        </svg>
        <span className="truncate max-w-[280px]">
          {t('commandCenter.windowTitle', { defaultValue: 'Command Center — {{name}}', name: projectId })}
        </span>
      </div>

      {/* OS 드래그 영역 */}
      <div className="app-drag flex-1" style={{ minWidth: 0 }} />

      <div className="flex flex-shrink-0 items-center gap-1 pr-2 app-nodrag">
        <button
          type="button"
          onClick={handleMinimize}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
          title={t('tabDetach.minimizeWindow', { defaultValue: 'Minimize' })}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2.5 6h7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={handleToggleMaximize}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
          title={maximized
            ? t('tabDetach.restoreWindow', { defaultValue: 'Restore' })
            : t('tabDetach.maximizeWindow', { defaultValue: 'Maximize' })}
        >
          {maximized ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3.5" y="3.5" width="6" height="6" rx="0.5" />
              <path d="M2.5 8V2.5H8" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="2.5" width="7" height="7" rx="0.5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-red-500/80 hover:text-white"
          title={t('tabDetach.closeWindow', { defaultValue: 'Close window' })}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 3l6 6M9 3l-6 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
