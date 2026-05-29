import { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { BubbleMap } from '../BubbleMap/BubbleMap.js';
import { CanvasBreadcrumb } from '../BubbleMap/CanvasBreadcrumb.js';
import { IframeView } from './IframeView.js';
import { DetailPanel } from '../Panel/DetailPanel.js';
import { InspectorOverlay } from '../Inspector/InspectorOverlay.js';
import { PermissionPromptStack } from '../PermissionPrompt/PermissionPromptStack.js';
import { useGraphStore } from '../../stores/graphStore.js';
import { useWebSocket } from '../../hooks/useWebSocket.js';
import { useDetachedSync } from '../../hooks/useDetachedSync.js';
import { WS_PATH } from '@vibisual/shared';

// SCENARIO.md §5.4 #14-1 (v2.29) — 메인 TabBar 에서 분리돼 별도 BrowserWindow 로 뜬 별창의 shell.
// 미니 타이틀바(앱 드래그) + 단일 탭 콘텐츠. 같은 in-process 서버 / 같은 preload 라 graphStore 는
// 자동으로 같은 graph_snapshot 을 수신(setBroadcastSink 가 모든 BrowserWindow 순회).
//
// 격리(§3.5): 같은 projectId 가 메인+별창에 동시 노출되는 일은 없다 — detach 즉시 메인 TabBar 가
// 그 키를 detachedTabKeys 로 숨김(applyDetachedList 가 'vibisual:detached:list' 푸시로 sync).

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${WS_PATH}`;

export interface DetachedShellProps {
  kind: 'project' | 'iframe';
  tabKey: string;
}

interface ParsedHash {
  kind: 'project' | 'iframe';
  tabKey: string;
}

/** main.tsx 가 부팅 시 호출 — `#detached=1&kind=...&tabKey=...` 파싱. */
export function parseDetachedHash(hash: string): ParsedHash | null {
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('detached') !== '1') return null;
  const kindRaw = params.get('kind');
  const tabKey = params.get('tabKey');
  if (!tabKey) return null;
  if (kindRaw !== 'project' && kindRaw !== 'iframe') return null;
  return { kind: kindRaw, tabKey };
}

export function DetachedShell({ kind, tabKey }: DetachedShellProps): React.JSX.Element {
  // 같은 in-process 서버에 IPC WS 로 연결 — 초기 snapshot + 이후 broadcast 수신.
  useWebSocket(WS_URL);
  // 별창도 detached 목록을 동기화해야 자기 자신 redock 시 일관성 유지 + 다른 별창 상태 인지.
  useDetachedSync();

  const projects = useGraphStore((s) => s.projects);
  const iframeTabs = useGraphStore((s) => s.iframeTabs);

  // 별창은 자기 단일 탭만 활성. 메인의 setActiveProject 는 서버 appState 를 건드리므로 사용하지 않고
  // local 액션으로 자기 store 만 set (다른 윈도우와 격리).
  const setActiveProjectLocal = useGraphStore((s) => s.setActiveProjectLocal);
  const setActiveIframeIdLocal = useGraphStore((s) => s.setActiveIframeIdLocal);

  // 별창의 단일 탭을 식별 — tabKey 포맷은 TabBar 와 동일:
  //   'p:<projectName>' 또는 'i:<iframeTabId>'
  const targetName = useMemo(() => {
    if (kind === 'project') return tabKey.startsWith('p:') ? tabKey.slice(2) : tabKey;
    return tabKey.startsWith('i:') ? tabKey.slice(2) : tabKey;
  }, [kind, tabKey]);

  // 마운트 시 자기 창의 활성 탭을 설정. 이후 메인의 setActiveProject 변경이 broadcast 로 와도 영향 없음
  // (별창 store 는 독립 인스턴스).
  useEffect(() => {
    if (kind === 'project') {
      setActiveProjectLocal(targetName);
    } else {
      setActiveIframeIdLocal(targetName);
    }
  }, [kind, targetName, setActiveProjectLocal, setActiveIframeIdLocal]);

  const activeProjectInfo = kind === 'project' ? projects[targetName] : null;
  const iframeTab = kind === 'iframe' ? iframeTabs.find((t) => t.id === targetName) : null;

  // ─── 미니 타이틀바 (드래그 = redock 시도) ────────────────────────────────
  return (
    <div className="flex h-screen w-screen flex-col bg-gray-950 text-gray-100">
      <DetachedTitleBar kind={kind} tabKey={tabKey} title={activeProjectInfo?.name ?? iframeTab?.label ?? targetName} />
      <DetailPanelHost>
        <main className="relative flex-1 overflow-hidden">
          {kind === 'iframe' && iframeTab ? (
            <IframeView url={iframeTab.url} tabId={iframeTab.id} />
          ) : kind === 'project' && activeProjectInfo ? (
            <>
              <BubbleMap />
              <CanvasBreadcrumb />
            </>
          ) : (
            <DetachedMissingPlaceholder kind={kind} targetName={targetName} />
          )}
        </main>
      </DetailPanelHost>
      <InspectorOverlay />
      <PermissionPromptStack />
    </div>
  );
}

function DetachedMissingPlaceholder({ kind, targetName }: { kind: 'project' | 'iframe'; targetName: string }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-950 px-6 text-center">
      <svg className="h-10 w-10 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <p className="text-[13px] text-gray-300">{t('tabDetach.missingTitle', { defaultValue: 'Tab no longer available' })}</p>
      <p className="text-[11px] text-gray-500">
        {kind === 'project'
          ? t('tabDetach.missingProject', { defaultValue: 'The project "{{name}}" is not loaded in this Vibisual instance.', name: targetName })
          : t('tabDetach.missingIframe', { defaultValue: 'The iframe tab "{{id}}" was closed.', id: targetName })}
      </p>
    </div>
  );
}

// DetailPanel 은 별창 안에서도 자기 창의 selectedNodeId 를 따라 뜨도록 wrapping.
function DetailPanelHost({ children }: { children: React.ReactNode }): React.JSX.Element {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const selectedTaskEdgeId = useGraphStore((s) => s.selectedTaskEdgeId);
  const selectedCommentBoxId = useGraphStore((s) => s.selectedCommentBoxId);
  return (
    <div className="relative flex flex-1 overflow-hidden">
      {children}
      {(selectedNodeId !== null || selectedTaskEdgeId !== null || selectedCommentBoxId !== null) && (
        <DetailPanel
          onClose={() => {
            const s = useGraphStore.getState();
            s.selectNode(null);
            s.selectTaskEdge(null);
            s.selectCommentBox(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Mini title bar — mini-ghost drag → redock ────────────────────────────
//
// v2.30: 사용자가 미니 타이틀바를 잡으면 별창 본체가 mini ghost(200×44, opacity 0.85)로
// 축소되어 cursor 따라간다. 메인 헤더 영역 위에서 떼면 redock, 그 외 위치에선 원본 복원.
// 이전 polling 은 main 의 windowManager 가 담당 — renderer 는 pointer down/up 신호만 보낸다.

interface DetachedTitleBarProps {
  kind: 'project' | 'iframe';
  tabKey: string;
  title: string;
}

function DetachedTitleBar({ kind, tabKey, title }: DetachedTitleBarProps): React.JSX.Element {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);

  // main 이 polling 중 dragging/hovering 변경을 push — 그 신호로 미니 박스 모양 갱신.
  useEffect(() => {
    const api = window.api;
    if (!api?.window?.onDragState) return;
    const off = api.window.onDragState((s) => {
      setDragging(s.dragging);
      setHovering(s.hovering);
    });
    return () => { off(); };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    // pointer capture — 마우스가 어디로 가든 pointerup 을 우리가 받게.
    try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    void window.api?.window?.startDetachDrag();
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    const commit = hovering; // main 이 polling 한 마지막 hover 상태
    setDragging(false);
    setHovering(false);
    void window.api?.window?.endDetachDrag(commit);
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }, [dragging, hovering]);

  const handleClose = useCallback((): void => {
    void window.api?.window?.closeSelf();
  }, []);

  // 미니 모드면 박스 전체를 mini ghost 모양으로 재구성 (200×44 안에 라벨 + 메시지).
  if (dragging) {
    return (
      <div
        data-tab-key={tabKey}
        data-detached-titlebar="1"
        data-mini-ghost="1"
        className={`flex h-full w-full flex-col items-stretch justify-center gap-0.5 select-none px-3 py-1 ${
          hovering
            ? 'bg-blue-600/90 ring-2 ring-blue-300/80'
            : 'bg-[#1f2937] ring-1 ring-amber-400/50 shadow-lg shadow-black/60'
        } rounded-md`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="flex items-center gap-1.5">
          {kind === 'project' ? (
            <svg className="h-3 w-3 flex-shrink-0 text-blue-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
          ) : (
            <svg className="h-3 w-3 flex-shrink-0 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
            </svg>
          )}
          <span className="truncate text-[12px] font-semibold text-white">{title}</span>
        </div>
        <span
          className={`truncate text-[10px] font-medium ${
            hovering ? 'text-blue-100' : 'text-amber-200/90'
          }`}
        >
          {hovering
            ? t('tabDetach.redockCardTitle', { defaultValue: 'Drop on the main tab bar to redock' })
            : t('tabDetach.redockCardSubtitle', { defaultValue: 'Or release anywhere else to leave detached' })}
        </span>
      </div>
    );
  }

  // §5.4 #14-1 v2.35 — 미니 타이틀바를 좌/우 두 영역으로 분할:
  //   (a) 좌측 redock-trigger zone — 프로젝트 아이콘 + 라벨 + "분리됨" 배지. app-nodrag, 우리가 pointer 처리.
  //   (b) 우측 OS-drag zone — 빈 공간 + 닫기 버튼. -webkit-app-region: drag 라 OS 가 윈도우 자체를 이동.
  //   (c) 닫기 버튼만 app-nodrag (그 외 우측 공간 전체는 OS drag).
  // 사용자 의도: "독립창된 이후로 그건 왼쪽 영역에서만 하고 나머지 텝은 기존 동작 그대로 화면 옮기는 역할".
  return (
    <div
      data-tab-key={tabKey}
      data-detached-titlebar="1"
      className="flex h-9 flex-shrink-0 items-stretch border-b border-black/40 bg-[#1f2937] select-none"
    >
      {/* (a) 좌측 redock-trigger zone — 컨텐츠 폭만큼만 (flex-shrink-0). */}
      <div
        data-redock-trigger="1"
        className="app-nodrag flex flex-shrink-0 items-center gap-2 px-3 text-[12px] font-medium text-gray-200 cursor-grab active:cursor-grabbing hover:bg-white/[0.04]"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        title={t('tabDetach.redockHint', { defaultValue: 'Drag to the main tab bar to redock' })}
      >
        {kind === 'project' ? (
          <svg className="h-3.5 w-3.5 flex-shrink-0 text-blue-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5 flex-shrink-0 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
          </svg>
        )}
        <span className="truncate max-w-[200px]">{title}</span>
        <span className="ml-1 rounded bg-white/[0.06] px-1.5 py-[1px] text-[9px] uppercase tracking-wide text-gray-400">
          {t('tabDetach.detachedBadge', { defaultValue: 'detached' })}
        </span>
      </div>

      {/* (b) 우측 OS-drag zone — flex-1 로 남은 폭 차지. CSS 변수 webkit-app-region 으로 OS 드래그. */}
      <div
        className="app-drag flex-1"
        style={{ minWidth: 0 }}
        title={t('tabDetach.osDragHint', { defaultValue: 'Drag here to move the window' })}
      />

      {/* (c) 닫기 버튼 — app-nodrag 라 OS 드래그 영향 받지 않음. */}
      <div className="flex flex-shrink-0 items-center gap-1 pr-2 app-nodrag">
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-white/[0.08] hover:text-gray-100"
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
