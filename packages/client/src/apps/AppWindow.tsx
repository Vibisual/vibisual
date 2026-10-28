import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { registerCaptureWindow, type CaptureWindowHandle } from '../components/BubbleMap/captureWindowManager.js';
import { useFloatingWindow } from '../hooks/useFloatingWindow.js';
import { useFloatingWindowFullScreenLock } from '../hooks/useIsMobile.js';
import { setCanvasCover } from '../stores/canvasVisibility.js';
import { selectShellImmersive, useProjectImmersionStore } from '../stores/projectImmersion.js';
import { AppShellHost } from './AppShellHost.js';
import { AppChromeContext, useAppChromeHost, useAppChromeSlotGestures } from './appChrome.js';
import { AppWindowShownContext } from './appWindowVisibility.js';
import { appShellParams, getInternalApp } from './registry.js';
import { canPopOutAppWindow, useAppWindowsStore, type AppWindow as AppWindowEntry } from './appWindows.js';
import { useAppWindowRedock } from './useAppWindowRedock.js';
import type { FloatingWindowGeom } from '../hooks/floatingWindowGeom.js';
import { useGraphStore } from '../stores/graphStore.js';
import { isAppWindowVisible } from './appWindowProject.js';
import { requestAppWindowClose } from './appWindowCloseRetention.js';

/**
 * §5.13 (S) — 앱 안 창. 틀은 `useFloatingWindow`, z-order·Escape 는 다른 떠 있는 창들과 같은 스택(따로 겹치면 "어느 창이 앞인가"가 갈린다).
 * 타이틀바를 밖으로 끌면 OS 창(S-3 — 결과만 store 에, 열기는 `InternalApp.open()`), 끄는 동안은 가상 창이 따라간다(S-10).
 * 특정 앱을 모른다(§5.13 (P-4)) — 전부 `appId` 로 레지스트리에서 꺼낸다.
 */
export const AppWindow = memo(function AppWindow({ win, visible = true }: { win: AppWindowEntry; visible?: boolean }): React.JSX.Element | null {
  const { t } = useTranslation();
  const projectImmersive = useProjectImmersionStore(selectShellImmersive);
  const shown = visible && !projectImmersive;
  const app = getInternalApp(win.appId);
  const closeWindow = useAppWindowsStore((s) => s.close);
  const popOutWindow = useAppWindowsStore((s) => s.popOut);

  // 최신 닫기를 ref 로 — 창 스택에 넘긴 콜백(Escape)이 stale 되지 않게(캡처 창과 같은 규약).
  const closeRef = useRef<() => void>(() => undefined);
  const closingRef = useRef(false);
  // §5.13 (R-10) — the user's close asks the shell first (unsaved edits).
  closeRef.current = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    void requestAppWindowClose(win.id, () => closeWindow(win.id))
      .finally(() => { closingRef.current = false; });
  };
  const visibleRef = useRef(shown);
  visibleRef.current = shown;

  // 공용 창 스택 등록(z-order + Escape 최상단). 첫 렌더에 1회.
  const handleRef = useRef<CaptureWindowHandle | null>(null);
  if (!handleRef.current) handleRef.current = registerCaptureWindow(() => closeRef.current(), () => visibleRef.current);
  const handle = handleRef.current;

  const [z, setZ] = useState<number>(handle.initialZ);
  const bringToFront = useCallback(() => { if (visibleRef.current) setZ(handle.bringToFront()); }, [handle]);

  const [transferFailed, setTransferFailed] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const canPopOut = canPopOutAppWindow();

  // §5.13 (V) 37-1 — 앱 화면이 이 창의 머리줄을 쓰는 일반 통로(창 제목 + 머리줄 자리). 창마다 한 벌.
  const chromeHost = useAppChromeHost();

  // 창 제목 — 타이틀바와 끌어낼 때의 가상 창(S-10)이 같은 이름을 쓴다. 앱이 정한 제목(작업 문서 이름 등)이 먼저다.
  const appName = app ? t(app.nameKey, { defaultValue: app.name }) : win.appId;
  const custom = chromeHost.title ?? win.title?.trim();
  const title = custom !== undefined && custom !== '' ? custom : appName;

  /**
   * 밖으로 꺼낸다(S-5) — 열렸는지를 돌려준다.
   * @param fromGhost (S-10) 끌어낸 판 — 새 창은 main 의 멈춰 선 선의 자리·크기에 선다. 아니면 이 창의 화면 자리.
   */
  const popOutSelf = useCallback((geom?: FloatingWindowGeom, screenPosition?: { x: number; y: number }, fromGhost = false): Promise<boolean> => {
    setTransferFailed(false);
    setTransferring(true);
    const rect = geom ?? win.geometry;
    return popOutWindow(win.id, rect ? {
      width: Math.round(rect.w), height: Math.round(rect.h),
      x: Math.round(screenPosition?.x ?? window.screenX + rect.x), y: Math.round(screenPosition?.y ?? window.screenY + rect.y),
      ...(fromGhost ? { fromGhost: true } : {}),
    } : undefined).then((ok) => { setTransferFailed(!ok); setTransferring(false); return ok; });
  }, [popOutWindow, win.id, win.geometry]);

  // 폰 폭·터치 기기에서는 떠 있는 창이 아니라 화면 전체다 — 320px 하한 창에 앱 화면이 짓눌리지 않고, 손가락으로 못 옮기는
  //   창이 남지 않게(끌기가 마우스 이벤트다). 이동·크기 조절·최대화 손잡이는 잠기고, 조건이 풀리면 저장된 자리로 돌아온다.
  const lockFullScreen = useFloatingWindowFullScreenLock();
  const fw = useFloatingWindow({
    enabled: shown,
    cascade: handle.cascadeOffset,
    initial: win.geometry ? { geom: win.geometry, mode: 'floating' } : null,
    lockFullScreen,
    onInteractStart: bringToFront,
    // 창을 못 여는 판(웹·구버전 preload)에서는 손짓 자체가 없다 — 안내만 뜨고 아무 일도 안
    //   일어나면 그건 고장으로 읽힌다.
    pullOut: {
      enabled: shown && canPopOut && !transferring,
      // (S-10) 선 안의 이름 띠와 안내 한 줄 — 앱 안 윤곽선과 main 의 선이 같은 말을 한다(경계를 넘어도 안 바뀐다).
      ghost: {
        label: title,
        hint: (armed) => (armed
          ? t('panel.apps.window.pullOutArmed', { defaultValue: '놓으면 별도 창으로 나갑니다' })
          : t('panel.apps.window.dragHint', { defaultValue: '앱 밖으로 끌어내면 별도 창이 됩니다.' })),
      },
      // (S-10) 꺼내기가 끝날 때까지 선은 그 자리에 서 있다 — 못 열면 훅이 선을 걷고 이 창을 되살린다.
      onRelease: ({ geom, screenPosition, fromGhost }) => popOutSelf(geom, screenPosition, fromGhost),
    },
  });
  // §5.13 (S-11) 앱이 머리줄 자리에 그린 머리줄 위에서도 타이틀바와 같은 손짓 — 빈 곳을 잡고 끌기·밖으로 빼기·두 번
  //   눌러 최대화. 그 머리줄은 포털이라 React 이벤트가 위 타이틀바까지 오지 않는다(자세한 것은 그 훅).
  useAppChromeSlotGestures(chromeHost.chrome.slot, {
    onPress: fw.titleBarProps.onMouseDown,
    onDoublePress: fw.titleBarProps.onDoubleClick,
  });
  /** (S-10) 밖으로 빼는 중 — 본체는 숨고, 손을 따라가는 것은 이 선 하나다. */
  const ghost = fw.pullOutGhost;
  const maximized = fw.maximized;
  const setMode = fw.setMode;

  // 이미 떠 있는 창을 또 열었다 — 두 벌로 겹치는 대신 이 창이 앞으로 온다(접혀 있었으면 펼친다).
  useEffect(() => {
    bringToFront();
    setMode((m) => (m === 'minimized' ? 'floating' : m));
  }, [win.focusAt, bringToFront, setMode]);

  // 언마운트 — 창 스택 등록 해제(진행 중 드래그 리스너 정리는 공용 훅이 담당).
  useEffect(() => () => { handle.release(); }, [handle]);

  /** §4 가시성 LOD — 캔버스를 실제로 덮을 때만 덮개로 등록한다(떠 있는 창 ❌). 키는 창마다 — 같은 키면 한 창을 닫을 때 다른 창의 등록까지 풀린다. */
  const coverKey = `app-window:${win.id}`;
  useEffect(() => {
    setCanvasCover(coverKey, shown && fw.fullScreen);
    return () => setCanvasCover(coverKey, false);
  }, [coverKey, shown, fw.fullScreen]);

  /** OS 창과 같은 한 벌(S-6). 원시값에서만 다시 만든다 — 새 객체면 셸의 `params` 효과가 다시 돌아 문서를 다시 읽고 보던 자리를 잃는다. */
  const params = useMemo(
    () => (app ? { ...appShellParams(app, { projectId: win.projectId, ref: win.ref, file: win.file, draftKey: win.draftKey, bubbleId: win.bubbleId }), appWindowId: win.id, appWindowAppId: win.appId } : {}),
    [app, win.projectId, win.ref, win.file, win.draftKey, win.id, win.bubbleId],
  );

  /**
   * (S-10) ⑩ 끄는 동안 앱 화면을 다시 그리지 않는다 — 창이 이동마다 다시 그려지는데 편집기까지 그리면 프레임이 밀린다(§5.5 #17-6 (H-6) ②).
   * 같은 문서인 동안은 같은 요소를 돌려줘 React 가 건너뛰게 한다(자기 상태·구독으로는 여전히 그려진다).
   */
  const shellView = useMemo(
    () => <AppShellHost hash={{ appId: win.appId, mode: 'main', params }} fill />,
    [win.appId, params],
  );

  if (!app) return null;

  const Icon = app.icon;

  return createPortal(
    <>
    <div
      ref={fw.windowRef}
      data-app-window=""
      aria-hidden={!shown}
      {...(!shown ? { inert: '' } : {})}
      // (S-10) ⑨ 흐림 전환은 숨을 때만(120ms) — 늘 걸면 돌아올 때 흐릿하게 떠 잔상이 진다.
      // §5.13 (V) 37-1 — 창 틀도 테마 토큰을 따른다(고정 rgba 면 라이트 테마에서 머리줄 글자가 사라진다).
      className={`fixed flex flex-col overflow-hidden border border-white/10 bg-vb-window shadow-2xl shadow-black/70${lockFullScreen ? '' : ' rounded-xl'}${ghost ? ' transition-opacity duration-120 ease-out' : ''}`}
      style={{
        ...fw.style,
        // Background renderers need real layout dimensions for their scene and captures.
        display: visible || win.background ? undefined : 'none',
        // Immersion keeps editor dimensions and unsaved state while hiding this body portal.
        visibility: projectImmersive || (!visible && win.background) ? 'hidden' : undefined,
        zIndex: z,
        // (S-10) 밖으로 빼는 동안 본체는 **완전히 숨는다** — 손을 따라가는 것은 선 하나다(§5.5 #17-6 (H-19)).
        //   반쯤 흐린 채 앱 경계에서 잘린 본체는 "밖으로 나가는 모습"이 아니라 잔상으로 읽혔다. 자리는
        //   숨은 채로도 계속 맞춰 두므로(훅), 선이 꺼지면 손 아래 그 자리에 다시 나타난다.
        opacity: ghost ? 0 : 1,
        ...(ghost ? { pointerEvents: 'none' as const } : {}),
      }}
      onMouseDownCapture={bringToFront}
    >
      {/* 타이틀바 — 캡처 창과 같은 그래파이트 유리면. 드래그 이동 + 더블클릭 최대화 + 밖으로 끌어내기. */}
      <div
        {...fw.titleBarProps}
        className={`flex h-10 flex-shrink-0 select-none items-center gap-2 border-b border-white/10 bg-vb-sunken/90 px-3 text-slate-200 backdrop-blur-[10px]${lockFullScreen ? '' : ' cursor-grab active:cursor-grabbing'}`}
        title={canPopOut ? t('panel.apps.window.dragHint', { defaultValue: '앱 밖으로 끌어내면 별도 창이 됩니다.' }) : undefined}
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5"
          style={{ backgroundColor: `${app.color}CC`, color: app.glow }}
        >
          <Icon />
        </span>
        {/* (V) 37-1 — 앱이 머리줄 자리를 쓰는 동안은 제목 글자를 그리지 않는다(앱이 자기 제목을 그 자리에 그린다). */}
        {!chromeHost.claimed ? (
          <span className="truncate text-[13px] font-semibold text-slate-100" title={title}>{title}</span>
        ) : null}
        {!chromeHost.claimed && custom !== undefined && custom !== '' ? (
          <span className="shrink-0 truncate text-[12px] text-slate-500">{appName}</span>
        ) : null}
        {/* 머리줄 자리 — 앱이 쓰지 않으면 빈 칸(종전 사이 띄우개)이다. */}
        <div ref={chromeHost.slotRef} data-app-chrome-slot="" className="flex min-w-0 flex-1 items-center gap-2" />

        {/* 끌 자리가 없는 사람에게도 길이 있어야 한다 — 끌어내기와 **같은 함수**를 부른다(S-5). */}
        {canPopOut && (
          <button
            type="button"
            onClick={() => { void popOutSelf(fw.geom); }}
            disabled={transferring}
            className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
            title={t('panel.apps.window.popOut', { defaultValue: '별도 창으로' })}
            aria-label={t('panel.apps.window.popOut', { defaultValue: '별도 창으로' })}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 4h6v6" />
              <path d="M20 4 11 13" />
              <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </button>
        )}
        {/* 잠긴 전체 화면(폰 폭·터치)에서는 최대화가 할 일이 없다 — 눌러도 그대로인 버튼은 고장으로 읽힌다. */}
        {!lockFullScreen && <button
          type="button"
          onClick={fw.toggleMaximized}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
          title={maximized ? t('panel.apps.window.restore', { defaultValue: '원래 크기로' }) : t('panel.apps.window.maximize', { defaultValue: '최대화' })}
          aria-label={maximized ? t('panel.apps.window.restore', { defaultValue: '원래 크기로' }) : t('panel.apps.window.maximize', { defaultValue: '최대화' })}
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
        </button>}
        <button
          type="button"
          onClick={() => closeRef.current()}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-500/80 hover:text-white pointer-coarse:h-8 pointer-coarse:w-8"
          title={t('panel.apps.window.close', { defaultValue: '닫기 (Esc)' })}
          aria-label={t('panel.apps.window.close', { defaultValue: '닫기 (Esc)' })}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* 본문 — 앱 화면은 레지스트리의 늦은 로더가 그린다(안 열면 그 청크는 내려오지 않는다). */}
      {transferFailed && <p role="alert" className="shrink-0 bg-rose-950 px-3 py-1 text-xs text-rose-100">{t('panel.apps.window.transferFailed')}</p>}
      <div className="relative min-h-0 flex-1" aria-busy={transferring} {...(transferring ? { inert: '' } : {})}>
        {/* §5.13 (X) 39-8 — 숨은(다른 탭) 앱 안 창이라는 것을 앱 화면에 알린다 — 앱은 그동안 폴링·무대·미리 굽기를 쉰다. */}
        <AppWindowShownContext.Provider value={shown}>
          <AppChromeContext.Provider value={chromeHost.chrome}>{shellView}</AppChromeContext.Provider>
        </AppWindowShownContext.Provider>
      </div>

      {/* 우하단 리사이즈 핸들 — 최대화·잠긴 전체 화면에선 숨김. */}
      {!maximized && !lockFullScreen && (
        <div
          {...fw.resizeProps}
          className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-1 text-slate-600 transition-colors hover:text-slate-300"
          aria-hidden="true"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15 15 21" />
            <path d="M21 9 9 21" />
          </svg>
        </div>
      )}
    </div>
    {/* (S-10) 앱 안 폴백 가상 창 — 정본은 main 의 클릭통과 창(`ghostFrame.ts`)이고 이것은 그 창이 없을 때만 그린다.
       그림(이름 띠 34px + 안내 한 줄, 같은 색)이 main 의 선과 같아야 넘어가는 순간이 안 보인다. */}
    {shown && ghost?.kind === 'inapp' && (
      <div
        data-app-window-ghost=""
        aria-hidden="true"
        className={`fixed overflow-hidden rounded-[10px] border-2 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.55),0_10px_30px_rgba(0,0,0,0.35)] ${
          ghost.armed ? 'border-violet-300/95 bg-violet-500/[0.14]' : 'border-violet-400/75 bg-violet-500/[0.07]'
        }`}
        style={{
          left: Math.round(ghost.rect.x),
          top: Math.round(ghost.rect.y),
          width: Math.round(ghost.rect.w),
          height: Math.round(ghost.rect.h),
          zIndex: z + 1,
          pointerEvents: 'none',
        }}
      >
        <div className={`flex h-[34px] items-center gap-1.5 border-b bg-slate-900/55 px-2.5 text-[12px] font-medium text-violet-100/95 ${
          ghost.armed ? 'border-violet-300/80' : 'border-violet-400/55'
        }`}>
          <span className="h-2 w-2 flex-none rounded-full bg-violet-400/95" />
          <span className="truncate">{title}</span>
        </div>
        <div className="truncate border-b border-violet-400/30 bg-slate-900/40 px-[11px] py-[7px] text-[12px] font-medium leading-[1.35] text-violet-200/90">
          {ghost.armed
            ? t('panel.apps.window.pullOutArmed', { defaultValue: '놓으면 별도 창으로 나갑니다' })
            : t('panel.apps.window.dragHint', { defaultValue: '앱 밖으로 끌어내면 별도 창이 됩니다.' })}
        </div>
      </div>
    )}
    </>,
    document.body,
  );
});

/** 떠 있는 앱 창의 유일한 마운트 지점 — 여는 문이 넷이라 각자 그리면 두 벌 뜬다(열림 여부는 store). 캔버스 셸(App · DetachedShell)마다 마운트한다. */
export function AppWindowHost(): React.JSX.Element | null {
  useAppWindowRedock();
  const windows = useAppWindowsStore((s) => s.windows);
  const activeProject = useGraphStore((s) => s.activeProject);
  const activeIframeId = useGraphStore((s) => s.activeIframeId);
  const projects = useGraphStore((s) => s.projects);
  const stubProjects = useGraphStore((s) => s.stubProjects);
  if (windows.length === 0) return null;
  return (
    <>
      {/* Keep editors mounted so tab switches preserve unsaved scenes, selections and geometry. */}
      {windows.map((w) => <AppWindow key={w.id} win={w} visible={!w.background && isAppWindowVisible(w.projectId, { activeProject, activeIframeId, projects, stubProjects })} />)}
    </>
  );
}
