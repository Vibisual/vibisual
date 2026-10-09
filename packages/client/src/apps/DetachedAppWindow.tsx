import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WindowControls } from '../components/Layout/WindowControls.js';
import { AppShellHost } from './AppShellHost.js';
import { parseAppHash, type AppHash } from './appHash.js';
import { getInternalApp } from './registry.js';
import { prepareAppWindowTransfer } from './appWindowTransfer.js';
import { subscribeAppWindowDragRelease } from './useAppWindowRedock.js';

/** One native title bar for every app; app-specific headers only contain editor controls. */
export function DetachedAppWindow({ initial }: { initial: AppHash }): React.JSX.Element {
  const { t } = useTranslation();
  const [hash, setHash] = useState(initial);
  const [error, setError] = useState(false);
  const [returning, setReturning] = useState(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  const app = getInternalApp(hash.appId);
  const hosted = useMemo(() => ({ ...hash, params: { ...hash.params, appWindowHosted: '1', appWindowAppId: hash.appId } }), [hash]);

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

  const startDrag = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,select,a,[data-window-nodrag]')) return;
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

  // Rendering stages do not get window chrome or different dimensions.
  if (hash.mode !== 'main') return <AppShellHost hash={hash} />;
  const Icon = app?.icon;
  return <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-950 text-white">
    <div data-app-window-titlebar="" className={`${window.api?.app?.startDrag ? 'app-nodrag' : 'app-drag'} flex h-10 shrink-0 cursor-grab select-none items-center gap-2 border-b border-white/10 bg-slate-900 px-3 active:cursor-grabbing`}
      onMouseDown={startDrag}
      onDoubleClick={event => { if (!(event.target as HTMLElement).closest('button')) void window.api?.window?.toggleMaximizeSelf(); }}
      title={t('panel.apps.window.redockHint')}>
      {Icon && <Icon />}
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{hash.params['_windowTitle'] ?? app?.name ?? hash.appId}</span>
      {window.api?.app?.redock && <button type="button" disabled={returning} onClick={() => { void redock(); }}
        className="rounded px-2 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-40" title={t('panel.apps.window.redock')}>
        {t('panel.apps.window.redock')}
      </button>}
      <WindowControls />
    </div>
    {error && <p role="alert" className="shrink-0 bg-rose-950 px-3 py-1 text-xs text-rose-100">{t('panel.apps.window.transferFailed')}</p>}
    <div className="min-h-0 flex-1"><AppShellHost key={JSON.stringify(hash)} hash={hosted} fill /></div>
  </div>;
}
