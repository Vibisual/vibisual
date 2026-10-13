import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WindowControls } from '../components/Layout/WindowControls.js';
import { AppShellHost } from './AppShellHost.js';
import { parseAppHash, type AppHash } from './appHash.js';
import { getInternalApp } from './registry.js';
import { prepareAppWindowTransfer } from './appWindowTransfer.js';
import { subscribeAppWindowDragRelease } from './useAppWindowRedock.js';
import { AppChromeContext, useAppChromeHost, useAppChromeSlotGestures } from './appChrome.js';
import { AttentionFlash } from '../components/Layout/AttentionFlash.js';
import type { TitleBarPress } from '../hooks/useFloatingWindow.js';

/** 제목줄에서 끌기·두 번 눌러 최대화를 시작하지 않는 자손 — 입력·단추는 제 일을 한다(앱 안 창의 판정과 같다). */
const TITLE_NO_DRAG = 'button,input,select,textarea,a,[data-window-nodrag]';

/** One native title bar for every app; app-specific headers only contain editor controls. */
export function DetachedAppWindow({ initial }: { initial: AppHash }): React.JSX.Element {
  const { t } = useTranslation();
  const [hash, setHash] = useState(initial);
  const [error, setError] = useState(false);
  const [returning, setReturning] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  const app = getInternalApp(hash.appId);
  const hosted = useMemo(() => ({ ...hash, params: { ...hash.params, appWindowHosted: '1', appWindowAppId: hash.appId } }), [hash]);
  // §5.13 (V) 37-1 — 앱 화면이 이 창의 머리줄을 쓰는 일반 통로. 앱이 정한 제목은 OS 창 제목(작업 표시줄)에도 쓴다.
  const chromeHost = useAppChromeHost();
  const windowTitle = chromeHost.title ?? hash.params['_windowTitle'] ?? app?.name ?? hash.appId;
  useEffect(() => {
    if (hash.mode !== 'main') return;
    document.title = windowTitle;
  }, [hash.mode, windowTitle]);

  useEffect(() => {
    const api = window.api?.app;
    if (!api) return;
    let alive = true;
    let accepting = false;
    const offTarget = api.onShowTarget?.(payload => {
      const next = parseAppHash(payload.hash);
      void (async () => {
        if (!next || next.appId !== initial.appId || accepting) {
          if (payload.requestId) await api.ackTarget?.(payload.requestId, false);
          return;
        }
        accepting = true;
        try {
          const prepared = await prepareAppWindowTransfer('@detached');
          if (!alive || !prepared) {
            if (alive) setError(true);
            if (payload.requestId) await api.ackTarget?.(payload.requestId, false);
            return;
          }
          // Do not replace a live editor if its request expired while it was saving.
          if (payload.requestId && !await api.ackTarget?.(payload.requestId, true)) return;
          if (alive) { setHash(next); setError(false); }
        } finally { accepting = false; }
      })().catch(() => { if (alive) setError(true); });
    });
    const offDrag = subscribeAppWindowDragRelease(api);
    return () => { alive = false; offTarget?.(); offDrag(); dragCleanup.current?.(); };
  }, [initial.appId]);

  const redock = useCallback(async (): Promise<void> => {
    if (returning) return;
    setReturning(true); setError(false);
    try {
      const prepared = await prepareAppWindowTransfer('@detached');
      if (!prepared || !await window.api?.app?.redock?.()) setError(true);
    } catch { setError(true); }
    finally { setReturning(false); }
  }, [returning]);

  const startDrag = useCallback((event: TitleBarPress): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest(TITLE_NO_DRAG)) return;
    const api = window.api?.app;
    if (!api?.startDrag) return;
    event.preventDefault();
    dragCleanup.current?.();
    const start = { x: event.clientX, y: event.clientY };
    let ended = false;
    let preparing = false;
    let started = false;
    const cleanup = (): void => {
      ended = true;
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      if (dragCleanup.current === cleanup) dragCleanup.current = null;
    };
    const up = (): void => {
      cleanup();
      if (started) void api.endDrag?.().catch(() => undefined);
    };
    const move = (mouse: MouseEvent): void => {
      if (!(mouse.buttons & 1)) { up(); return; }
      if (preparing || Math.hypot(mouse.clientX - start.x, mouse.clientY - start.y) < 4) return;
      preparing = true;
      void (async () => {
        if (!await prepareAppWindowTransfer('@detached')) { setError(true); cleanup(); return; }
        if (ended) return;
        started = true;
        try { if (!await api.startDrag!()) { started = false; cleanup(); } }
        catch { setError(true); cleanup(); }
      })();
    };
    dragCleanup.current = cleanup;
    window.addEventListener('mousemove', move, true);
    window.addEventListener('mouseup', up, true);
  }, []);

  const toggleMaximize = useCallback((event: Pick<MouseEvent, 'target'>): void => {
    if ((event.target as HTMLElement).closest(TITLE_NO_DRAG)) return;
    void window.api?.window?.toggleMaximizeSelf();
  }, []);

  // §5.13 (S-11) 앱이 머리줄 자리에 그린 머리줄 위에서도 제목줄과 같은 손짓(끌어 옮기기·앱 안으로 되돌리기·두 번 눌러
  //   최대화) — 그 머리줄은 포털이라 React 이벤트가 이 제목줄까지 오지 않는다(자세한 것은 그 훅).
  useAppChromeSlotGestures(chromeHost.chrome.slot, { onPress: startDrag, onDoublePress: toggleMaximize });

  // §5.13 (S-11) 본체가 이 창을 불렀다(같은 문서를 캔버스에서 다시 열었다) — main 이 앞으로 세운 뒤 한 번 비춘다. 이미
  //   보이던 창이면 앞으로 오는 것만으로는 화면이 그대로라 누른 사람은 안 먹은 줄 안다(IDE 창 §5.5 #17-6 (H-16) 과 같다).
  //   신호를 못 받는 판(구버전 preload)에서도 앞세우기는 이미 끝난 뒤다 — 기척만 조용히 빠진다.
  const [attention, setAttention] = useState(0);
  useEffect(() => {
    const off = window.api?.app?.onAttention?.((payload) => {
      if (payload.appId !== initial.appId) return;
      // 같은 번호로 두 번 세면 같은 원소라 애니메이션이 다시 돌지 않는다 — 연달아 불러도 매번 대답하게 올린다.
      setAttention((n) => n + 1);
    });
    return () => { off?.(); setAttention(0); };
  }, [initial.appId]);

  // Rendering stages do not get window chrome or different dimensions.
  if (hash.mode !== 'main') return <AppShellHost hash={hash} />;
  const Icon = app?.icon;
  return <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950 text-white">
    <div data-app-window-titlebar="" className={`${window.api?.app?.startDrag ? 'app-nodrag' : 'app-drag'} flex h-10 shrink-0 cursor-grab select-none items-center gap-2 border-b border-white/10 bg-slate-900 px-3 active:cursor-grabbing`}
      onMouseDown={startDrag}
      onDoubleClick={toggleMaximize}
      title={t('panel.apps.window.redockHint')}>
      {Icon && <Icon />}
      {!chromeHost.claimed ? <span className="min-w-0 truncate text-[13px] font-semibold">{windowTitle}</span> : null}
      {/* (V) 37-1 머리줄 자리 — 앱이 쓰지 않으면 빈 칸이다. */}
      <div ref={chromeHost.slotRef} data-app-chrome-slot="" className="flex min-w-0 flex-1 items-center gap-2" />
      {window.api?.app?.redock && <button type="button" disabled={returning} onClick={() => { void redock(); }}
        className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40" title={t('panel.apps.window.redock')}>
        {t('panel.apps.window.redock')}
      </button>}
      <WindowControls />
    </div>
    {error && <p role="alert" className="shrink-0 bg-rose-950 px-3 py-1 text-xs text-rose-100">{t('panel.apps.window.transferFailed')}</p>}
    <div className="min-h-0 flex-1">
      <AppChromeContext.Provider value={chromeHost.chrome}><AppShellHost key={JSON.stringify(hash)} hash={hosted} fill /></AppChromeContext.Provider>
    </div>
    <AttentionFlash seq={attention} onDone={() => setAttention(0)} />
  </div>;
}
