import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IDE_EDITOR_WIDTH, editorPaneKindOf } from '@vibisual/shared';

import { isAppWindowVisible } from '../../apps/appWindowProject.js';
import { workspaceOpenClaims } from '../../apps/registry.js';
import { useFloatingWindow } from '../../hooks/useFloatingWindow.js';
import { useFloatingWindowFullScreenLock } from '../../hooks/useIsMobile.js';
import { setCanvasCover } from '../../stores/canvasVisibility.js';
import { useFileWindowsStore, type FileWindowEntry } from '../../stores/fileWindows.js';
import { useGraphStore, type IDEEditorFile } from '../../stores/graphStore.js';
import { selectShellImmersive, useProjectImmersionStore } from '../../stores/projectImmersion.js';
import { registerCaptureWindow, type CaptureWindowHandle } from '../BubbleMap/captureWindowManager.js';
import { closeFileWindow, dropFileWindow } from './fileWindowOpen.js';
import { IDEBodyLayoutContext, type IDEBodyLayoutValue } from './ideBodyLayoutContext.js';
import { IDEEditorPane } from './IDEEditorPane.js';
import { ImageLightboxHost } from './IDEMainArea.js';
import { IDEPaneProvider } from './idePane.js';
import { PANE_KIND_TEXT, PaneKindGlyph } from './paneKinds.js';

/**
 * FileWindow.tsx — §5.5 #17-27 ⑳ 파일 창: IDE 의 [오른쪽에 표시] 판을 IDE 밖에 따로 세운 창(캔버스 파일 버블 더블클릭 — §5.1 #2-1 (A)).
 * 판은 새로 만들지 않고 `IDEEditorPane` 을 세운다 — 슬롯 키(`IDEPaneProvider`, `ensureFileWindowSlot` 의 에이전트 없는 자리)와 배치(`IDEBodyLayoutContext`, 꽉 찬 덮개)만 준다.
 * 창 틀은 앱 안 창과 같다(`useFloatingWindow` · `registerCaptureWindow` · `useFloatingWindowFullScreenLock` · 다른 탭에선 숨김 `isAppWindowVisible`).
 * 다른 점: ① Esc 로 닫지 않는다(편집기 것) — [닫기]·미저장 확인 ② OS 창으로 꺼내지 않는다.
 * 뿌리 표식: `data-file-window` · `data-app-window`(캔버스 지우기 키 ❌) · `data-ide-overlay`(편집 단축키 스코프).
 */

/** 판이 창을 꽉 채우는 배치 — 덮개 모양(`editorDrawer`)이라 폭 손잡이가 없고, 활동바 자리도 비워 두지 않는다(`navDrawer`). */
const FILE_WINDOW_BODY: IDEBodyLayoutValue = {
  measured: true,
  navDrawer: true,
  sidebarDrawer: true,
  editorDrawer: true,
  editorWidth: IDE_EDITOR_WIDTH.DEFAULT,
  editorMaxWidth: IDE_EDITOR_WIDTH.MAX,
  streamWidth: 0,
  titleBarNarrow: false,
  navOpen: false,
  setNavOpen: () => { /* 파일 창에는 서랍이 없다 */ },
};

const NO_FILES: readonly IDEEditorFile[] = [];

/** 머리줄에 적을 이름과 갈래 — 지금 탭의 파일 이름(빈 탭이면 그 갈래 이름), 갈래는 판이 그리는 넷 중 하나. */
function useFileWindowHead(slotKey: string): { name: string | null; kind: ReturnType<typeof editorPaneKindOf> } {
  const files = useGraphStore((s) => s.ideOverlays[slotKey]?.editorFiles ?? NO_FILES);
  const activePath = useGraphStore((s) => s.ideOverlays[slotKey]?.activeEditorPath ?? null);
  const active = files.find((f) => f.relPath === activePath) ?? null;
  if (!active) return { name: null, kind: null };
  if (active.opener) return { name: null, kind: active.opener };
  return { name: active.name, kind: editorPaneKindOf(active.relPath, workspaceOpenClaims()) };
}

export const FileWindow = memo(function FileWindow({ win, visible }: { win: FileWindowEntry; visible: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  const projectImmersive = useProjectImmersionStore(selectShellImmersive);
  const shown = visible && !projectImmersive;
  const tabCount = useGraphStore((s) => s.ideOverlays[win.id]?.editorFiles.length ?? 0);
  const head = useFileWindowHead(win.id);

  // 판의 탭이 모두 닫히면(탭 x · 판의 [판 닫기] — 판이 이미 초안 확인을 거쳤다) 창도 내려간다. 빈 창틀만 남지 않게.
  useEffect(() => {
    if (tabCount === 0) dropFileWindow(win.id);
  }, [tabCount, win.id]);

  const closeRef = useRef<() => void>(() => undefined);
  closeRef.current = () => closeFileWindow(win.id);

  // 공용 창 스택 — **앞뒤만** 맡긴다. 보이는지 묻는 자리에 늘 거짓을 줘 Esc 대상에서 빠진다(Esc 는 편집기의 것이다).
  const handleRef = useRef<CaptureWindowHandle | null>(null);
  if (!handleRef.current) handleRef.current = registerCaptureWindow(() => closeRef.current(), () => false);
  const handle = handleRef.current;
  const visibleRef = useRef(shown);
  visibleRef.current = shown;
  const [z, setZ] = useState<number>(handle.initialZ);
  const bringToFront = useCallback(() => { if (visibleRef.current) setZ(handle.bringToFront()); }, [handle]);
  useEffect(() => () => { handle.release(); }, [handle]);

  const lockFullScreen = useFloatingWindowFullScreenLock();
  const fw = useFloatingWindow({
    enabled: shown,
    cascade: handle.cascadeOffset,
    lockFullScreen,
    onInteractStart: bringToFront,
  });
  const { maximized, setMode } = fw;

  // 파일을 또 열었다 — 두 벌로 서지 않고 이 창이 앞으로 온다(접혀 있었으면 편다).
  useEffect(() => {
    bringToFront();
    setMode((m) => (m === 'minimized' ? 'floating' : m));
  }, [win.focusAt, bringToFront, setMode]);

  // §4 가시성 LOD — 캔버스를 실제로 덮을 때만 덮개 등록(키는 창마다).
  const coverKey = `file-window:${win.id}`;
  useEffect(() => {
    setCanvasCover(coverKey, shown && fw.fullScreen);
    return () => setCanvasCover(coverKey, false);
  }, [coverKey, shown, fw.fullScreen]);

  const kindLabel = head.kind ? t(PANE_KIND_TEXT[head.kind].label) : null;
  const title = head.name ?? kindLabel ?? '';

  return createPortal(
    <div
      ref={fw.windowRef}
      data-file-window=""
      data-app-window=""
      data-ide-overlay=""
      aria-hidden={!shown}
      {...(!shown ? { inert: '' } : {})}
      className={`fixed flex flex-col overflow-hidden border border-white/10 bg-vb-window shadow-2xl shadow-black/70${lockFullScreen ? '' : ' rounded-xl'}`}
      style={{
        ...fw.style,
        // 다른 프로젝트 탭에서는 숨는다 — 내리지 않고 숨겨야 고치던 초안·보던 자리가 남는다.
        display: visible ? undefined : 'none',
        visibility: projectImmersive ? 'hidden' : undefined,
        zIndex: z,
      }}
      onMouseDownCapture={bringToFront}
    >
      {/* 머리줄 — 앱 안 창과 같은 유리면. 끌어 옮기기 + 두 번 눌러 최대화. */}
      <div
        {...fw.titleBarProps}
        className={`flex h-10 flex-shrink-0 select-none items-center gap-2 border-b border-white/10 bg-vb-sunken/90 px-3 text-slate-200 backdrop-blur-[10px]${lockFullScreen ? '' : ' cursor-grab active:cursor-grabbing'}`}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sky-500/20 text-sky-300">
          {head.kind ? <PaneKindGlyph kind={head.kind} className="h-3.5 w-3.5" /> : null}
        </span>
        <span className="min-w-0 truncate text-[13px] font-semibold text-slate-100" title={title}>{title}</span>
        {head.name !== null && kindLabel !== null && (
          <span className="shrink-0 truncate text-[12px] text-slate-500">{kindLabel}</span>
        )}
        <div className="min-w-0 flex-1" />
        {/* 잠긴 전체 화면(폰 폭·터치)에서는 최대화가 할 일이 없다 — 눌러도 그대로인 버튼은 고장으로 읽힌다. */}
        {!lockFullScreen && (
          <button
            type="button"
            onClick={fw.toggleMaximized}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
            title={maximized ? t('panel.apps.window.restore') : t('panel.apps.window.maximize')}
            aria-label={maximized ? t('panel.apps.window.restore') : t('panel.apps.window.maximize')}
          >
            {maximized ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3" />
                <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
                <path d="M3 16h3a2 2 0 0 1 2 2v3" />
                <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => closeRef.current()}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-500/80 hover:text-white pointer-coarse:h-8 pointer-coarse:w-8"
          title={t('ide.fileWindow.close')}
          aria-label={t('ide.fileWindow.close')}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* 본문 — IDE 창 안의 그 판이 창을 꽉 채운다(판이 `absolute inset-0` 덮개 모양으로 선다). */}
      <div className="relative min-h-0 flex-1">
        <IDEPaneProvider paneKey={win.id} index={0}>
          <IDEBodyLayoutContext.Provider value={FILE_WINDOW_BODY}>
            <IDEEditorPane />
            {/* §5.5 #17-25 — 그림 탭의 [편집]이 여는 주석 팝업. 붙일 입력창이 없어 덮어쓰기·내려받기만 선다. */}
            <ImageLightboxHost agentId="" activeSessionId={null} canAttach={false} zIndex={z + 1} />
          </IDEBodyLayoutContext.Provider>
        </IDEPaneProvider>
      </div>

      {/* 우하단 리사이즈 핸들 — 최대화·잠긴 전체 화면에선 숨김. */}
      {!maximized && !lockFullScreen && (
        <div
          {...fw.resizeProps}
          className="absolute bottom-0 right-0 z-30 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-1 text-slate-600 transition-colors hover:text-slate-300"
          aria-hidden="true"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15 15 21" />
            <path d="M21 9 9 21" />
          </svg>
        </div>
      )}
    </div>,
    document.body,
  );
});

/**
 * 떠 있는 파일 창들의 **유일한 마운트 지점** — 열림 여부는 store 가 들고 창은 여기서만 그린다(`AppWindowHost` 와 같은 문법).
 * 캔버스가 있는 셸(App · DetachedShell)마다 하나. 다른 탭의 창도 내리지 않고 숨긴다(초안·보던 자리를 지킨다).
 */
export function FileWindowHost(): React.JSX.Element | null {
  const windows = useFileWindowsStore((s) => s.windows);
  const activeProject = useGraphStore((s) => s.activeProject);
  const activeIframeId = useGraphStore((s) => s.activeIframeId);
  const projects = useGraphStore((s) => s.projects);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  if (windows.length === 0) return null;
  return (
    <>
      {windows.map((w) => (
        <FileWindow
          key={w.id}
          win={w}
          visible={isAppWindowVisible(w.projectRoot, { activeProject, activeIframeId, projects, stubProjects })}
        />
      ))}
    </>
  );
}
