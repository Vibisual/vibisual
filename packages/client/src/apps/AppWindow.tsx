import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CAPTURE_BUBBLE_DEFAULTS } from '@vibisual/shared';

import { registerCaptureWindow, type CaptureWindowHandle } from '../components/BubbleMap/captureWindowManager.js';
import { useFloatingWindow } from '../hooks/useFloatingWindow.js';
import { setCanvasCover } from '../stores/canvasVisibility.js';
import { AppShellHost } from './AppShellHost.js';
import { appShellParams, getInternalApp } from './registry.js';
import { canPopOutAppWindow, useAppWindowsStore, type AppWindow as AppWindowEntry } from './appWindows.js';

/**
 * §5.13 (S) — 내부 앱이 **앱 안에서** 열리는 창.
 *
 * 창 틀은 새로 만들지 않는다 — 좌표·3상태(가운데 팝업 → 타이틀바 드래그 이동 → 리사이즈 →
 * 최대화/복원)는 §5.9 v3.34 캡처 창이 만들고 §5.10 v3.77 이 훅으로 뽑은 `useFloatingWindow`,
 * z-order·Escape(최상단 하나만)는 캡처 창·플레이테스트 클립 창·검증 시연 창이 함께 쓰는 스택
 * 한 곳이다. 앱 창만 자기 규칙으로 겹치면 "어느 창이 앞인가"가 창 종류마다 갈린다.
 *
 * **타이틀바를 앱 밖으로 끌어내면** 그때 독립 OS 창이 된다(S-3). 여기서 하는 일은 그 손짓의
 * 결과를 store 에 넘기는 것뿐이고, 밖에 뜨는 창은 종전 그대로 `InternalApp.open()` 이 연다.
 *
 * **특정 앱을 알지 않는다** (§5.13 (P-4)) — 제목·색·아이콘·화면은 전부 `appId` 로 레지스트리에서
 * 꺼내므로 앱이 늘어도 이 파일은 그대로다.
 */
export const AppWindow = memo(function AppWindow({ win }: { win: AppWindowEntry }): React.JSX.Element | null {
  const { t } = useTranslation();
  const app = getInternalApp(win.appId);
  const closeWindow = useAppWindowsStore((s) => s.close);
  const popOutWindow = useAppWindowsStore((s) => s.popOut);

  // 최신 닫기를 ref 로 — 창 스택에 넘긴 콜백(Escape)이 stale 되지 않게(캡처 창과 같은 규약).
  const closeRef = useRef<() => void>(() => undefined);
  closeRef.current = () => closeWindow(win.id);

  // 공용 창 스택 등록(z-order + Escape 최상단). 첫 렌더에 1회.
  const handleRef = useRef<CaptureWindowHandle | null>(null);
  if (!handleRef.current) handleRef.current = registerCaptureWindow(() => closeRef.current());
  const handle = handleRef.current;

  const [z, setZ] = useState<number>(handle.initialZ);
  const bringToFront = useCallback(() => { setZ(handle.bringToFront()); }, [handle]);

  /** 끌어내기 무장 — 지금 손을 떼면 밖으로 나간다는 사실을 화면에 보여 주는 상태(S-4). */
  const [pullOutArmed, setPullOutArmed] = useState(false);
  const canPopOut = canPopOutAppWindow();

  const popOutSelf = useCallback(() => {
    setPullOutArmed(false);
    popOutWindow(win.id);
  }, [popOutWindow, win.id]);

  const fw = useFloatingWindow({
    cascade: handle.cascadeOffset,
    onInteractStart: bringToFront,
    // 창을 못 여는 판(웹·구버전 preload)에서는 손짓 자체가 없다 — 안내만 뜨고 아무 일도 안
    //   일어나면 그건 고장으로 읽힌다.
    pullOut: { enabled: canPopOut, onArmedChange: setPullOutArmed, onRelease: popOutSelf },
  });
  const maximized = fw.maximized;
  const setMode = fw.setMode;

  // 이미 떠 있는 창을 또 열었다 — 두 벌로 겹치는 대신 이 창이 앞으로 온다(접혀 있었으면 펼친다).
  useEffect(() => {
    bringToFront();
    setMode((m) => (m === 'minimized' ? 'floating' : m));
  }, [win.focusAt, bringToFront, setMode]);

  // 언마운트 — 창 스택 등록 해제(진행 중 드래그 리스너 정리는 공용 훅이 담당).
  useEffect(() => () => { handle.release(); }, [handle]);

  /**
   * §4 v3.71 가시성 LOD — **캔버스를 실제로 덮을 때만** 덮개로 등록한다.
   *
   * 떠 있는 창은 옆으로 캔버스가 보이고 조작도 되므로 등록하지 않는다(기억 라이브러리·IDE 창의
   * floating 과 같은 규칙). 키는 창마다 달라야 한다 — 같은 키를 여럿이 쓰면 한 창을 닫을 때
   * 아직 덮고 있는 다른 창의 등록까지 함께 풀린다.
   */
  const coverKey = `app-window:${win.id}`;
  useEffect(() => {
    setCanvasCover(coverKey, fw.fullScreen);
    return () => setCanvasCover(coverKey, false);
  }, [coverKey, fw.fullScreen]);

  /**
   * 앱 화면에 넘길 값 — **OS 창과 같은 한 벌**(S-6). 원시값에서만 다시 만든다.
   *
   * 매 렌더 새 객체를 넘기면 셸 안에서 `params` 를 의존성으로 잡은 효과가 통째로 다시 돈다
   * (문서를 다시 읽고, 보던 자리를 잃는다).
   */
  const params = useMemo(
    () => (app ? appShellParams(app, { projectId: win.projectId, ref: win.ref, file: win.file }) : {}),
    [app, win.projectId, win.ref, win.file],
  );

  if (!app) return null;

  const Icon = app.icon;
  const appName = t(app.nameKey, { defaultValue: app.name });
  const custom = win.title?.trim();
  const title = custom !== undefined && custom !== '' ? custom : appName;

  return createPortal(
    <div
      ref={fw.windowRef}
      data-app-window=""
      className="fixed flex flex-col overflow-hidden rounded-xl shadow-2xl shadow-black/70 transition-opacity"
      style={{
        ...fw.style,
        zIndex: z,
        background: CAPTURE_BUBBLE_DEFAULTS.STAGE_BG,
        border: `1px solid ${pullOutArmed ? `${app.glow}99` : CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}`,
        // 끌어내는 동안 창이 흐려진다 — 손을 떼면 여기가 아니라 밖에 뜬다는 뜻이 눈에 먼저 온다.
        opacity: pullOutArmed ? 0.55 : 1,
      }}
      onMouseDownCapture={bringToFront}
    >
      {/* 타이틀바 — 캡처 창과 같은 그래파이트 유리면. 드래그 이동 + 더블클릭 최대화 + 밖으로 끌어내기. */}
      <div
        {...fw.titleBarProps}
        className="flex h-10 flex-shrink-0 cursor-grab select-none items-center gap-2 px-3 text-slate-200 active:cursor-grabbing"
        style={{
          background: CAPTURE_BUBBLE_DEFAULTS.CHROME_BG,
          borderBottom: `1px solid ${CAPTURE_BUBBLE_DEFAULTS.CHROME_BORDER}`,
          backdropFilter: 'blur(10px)',
        }}
        title={canPopOut ? t('panel.apps.window.dragHint', { defaultValue: '앱 밖으로 끌어내면 별도 창이 됩니다.' }) : undefined}
      >
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md [&>svg]:h-3.5 [&>svg]:w-3.5"
          style={{ backgroundColor: `${app.color}CC`, color: app.glow }}
        >
          <Icon />
        </span>
        <span className="truncate text-[13px] font-semibold text-slate-100" title={title}>{title}</span>
        {custom !== undefined && custom !== '' ? (
          <span className="shrink-0 truncate text-[12px] text-slate-500">{appName}</span>
        ) : null}
        <span className="flex-1" />

        {/* 끌 자리가 없는 사람에게도 길이 있어야 한다 — 끌어내기와 **같은 함수**를 부른다(S-5). */}
        {canPopOut && (
          <button
            type="button"
            onClick={popOutSelf}
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
        <button
          type="button"
          onClick={fw.toggleMaximized}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-100"
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
        </button>
        <button
          type="button"
          onClick={() => closeWindow(win.id)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-500/80 hover:text-white"
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
      <div className="relative min-h-0 flex-1">
        <AppShellHost hash={{ appId: win.appId, mode: 'main', params }} fill />

        {/* 무장 안내 — 손을 떼면 무슨 일이 일어나는지 그 자리에서 말한다(S-4). */}
        {pullOutArmed && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-b-xl border-2 border-dashed"
            style={{ borderColor: `${app.glow}AA`, background: 'rgba(2,6,23,0.45)' }}
          >
            <span
              className="rounded-full border px-3 py-1 text-[12px] font-semibold"
              style={{ borderColor: `${app.glow}AA`, background: 'rgba(2,6,23,0.85)', color: app.glow }}
            >
              {t('panel.apps.window.pullOutArmed', { defaultValue: '놓으면 별도 창으로 나갑니다' })}
            </span>
          </div>
        )}
      </div>

      {/* 우하단 리사이즈 핸들 — 최대화 중엔 숨김. */}
      {!maximized && (
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
    </div>,
    document.body,
  );
});

/**
 * 떠 있는 앱 창들의 **유일한 마운트 지점**.
 *
 * 여는 문이 넷(버블 더블클릭·우클릭 메뉴·옵션 패널·파일 클릭)이라 창을 여는 쪽마다 그리면 같은
 * 창이 두 벌 뜬다 — 열림 여부는 store 가 들고 창은 여기서만 그린다(`GuideWindowHost` 선례).
 * 캔버스가 있는 셸(App · DetachedShell)에 각각 마운트한다.
 */
export function AppWindowHost(): React.JSX.Element | null {
  const windows = useAppWindowsStore((s) => s.windows);
  if (windows.length === 0) return null;
  return (
    <>
      {windows.map((w) => <AppWindow key={w.id} win={w} />)}
    </>
  );
}
