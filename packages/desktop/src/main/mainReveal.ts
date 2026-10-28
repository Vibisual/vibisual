// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 — 본체 창은 다 그리고 조용해진 뒤에 보인다.
// `ready-to-show` 에 보이면 React 마운트·첫 스냅샷·부팅 확인이 몰려 첫 3초에 0.2~2.9초씩 멈춘다(main-stall.log 실측).
// 숨긴 창도 그린다(실측: rAF 초당 30회·visibilityState 'visible'). 조건·순서는 `splashPolicy.decideMainReveal` 단독 — 여기는 신호를 모아 보이기만.
// 신호: ① 렌더러 첫 화면 완료(`MAIN_READY_CHANNEL`) ② 부팅 한 번짜리 확인의 남은 수 ③ 메인 스레드 조용함(시계가 늦게 깬 만큼이 바빴던 시간).
// 렌더러가 죽거나 못 읽거나 무응답이면 기다리지 않는다 — 그 창의 복구 안내(`windowCrashRecovery`)가 보여야 한다.

import { ipcMain, type BrowserWindow } from 'electron';
import {
  decideMainReveal,
  MAIN_REVEAL_BUSY_LAG_MS,
  MAIN_REVEAL_POLL_MS,
  type MainRevealReason,
} from './splashPolicy';
import type { SplashHandle } from './splashWindow';
import type { FirstShowCover } from './windowCloak';

/** 렌더러 → main "첫 화면을 다 그렸다". 채널 정본은 여기 — preload `lifecycle.mainReady` 가 같은 이름을 쓴다. */
export const MAIN_READY_CHANNEL = 'vibisual:lifecycle:main-ready';

export interface MainRevealController {
  /** 본체 창이 아직 숨어 있는가. */
  readonly pending: boolean;
  /** 두 번째 실행·Dock 클릭 — 숨은 본체 대신 스플래시를 앞으로. */
  focusSplash(): void;
}

export interface MainRevealOptions {
  window: BrowserWindow;
  splash: SplashHandle;
  /** 부팅 한 번짜리 확인 중 아직 시작하지 않은 수(`pendingStartupJobCount`). */
  pendingStartupJobs: () => number;
  /**
   * 본체 창이 처음 보일 때 실제로 화면에 나오는 때(`windowCloak.coverFirstShow` — Windows 는 첫 프레임 가림을 걷은 때).
   * 스플래시는 이게 풀린 뒤에 걷는다. 없으면 보이는 즉시로 친다.
   */
  firstShow?: Promise<FirstShowCover>;
  /** 본체 창이 화면에 나왔다(사유·창을 만든 뒤 걸린 시간·첫 프레임 가림이 어떻게 끝났나). */
  onRevealed?: (reason: MainRevealReason, waitedMs: number, firstShow: FirstShowCover) => void;
}

interface ActiveReveal {
  webContentsId: number;
  markRendererReady(): void;
}

let active: ActiveReveal | null = null;
let ipcInstalled = false;

/** 채널은 한 번만 건다(`ipcMain.handle` 은 같은 이름을 두 번 받지 않는다). 공개가 끝난 뒤의 신호는 아무 일도 하지 않는다. */
function installReadyChannel(): void {
  if (ipcInstalled) return;
  ipcInstalled = true;
  ipcMain.handle(MAIN_READY_CHANNEL, (event): boolean => {
    const target = active;
    if (!target || event.sender.id !== target.webContentsId) return false;
    target.markRendererReady();
    return true;
  });
}

/**
 * A missing splash must not remove the renderer-ready IPC. Observe the existing fallback show path
 * without changing when it shows or releases startup jobs. A first paint alone is not app readiness.
 */
export function observeMainWindowReady(opts: Pick<MainRevealOptions, 'window' | 'firstShow' | 'onRevealed'>): void {
  installReadyChannel();
  const win = opts.window;
  if (win.isDestroyed()) return;
  const createdAt = Date.now();
  let rendererReady = false;
  let shown = win.isVisible();
  let presented: FirstShowCover | null = null;
  let done = false;

  const stop = (): void => {
    done = true;
    if (active === self) active = null;
    win.removeListener('show', onShow);
    win.removeListener('closed', stop);
    win.webContents.removeListener('render-process-gone', stop);
    win.webContents.removeListener('did-fail-load', onLoadFailure);
  };
  const reportReady = (): void => {
    if (done || !rendererReady || !shown || presented === null || win.isDestroyed() || !win.isVisible()) return;
    stop();
    try {
      opts.onRevealed?.('ready', Date.now() - createdAt, presented);
    } catch { /* 표시·기록 전용 */ }
  };
  const onShow = (): void => { shown = true; reportReady(); };
  const onLoadFailure = (_event: unknown, _code: number, _description: string, _url: string, isMainFrame: boolean): void => {
    if (isMainFrame) stop();
  };
  const self: ActiveReveal = {
    webContentsId: win.webContents.id,
    markRendererReady: () => { rendererReady = true; reportReady(); },
  };
  active = self;
  win.on('show', onShow);
  win.once('closed', stop);
  win.webContents.once('render-process-gone', stop);
  win.webContents.on('did-fail-load', onLoadFailure);
  void (opts.firstShow ?? Promise.resolve<FirstShowCover>('plain')).then((cover) => {
    if (done) return;
    if (cover === 'closed') { stop(); return; }
    presented = cover;
    reportReady();
  }, stop);
}

export function startMainReveal(opts: MainRevealOptions): MainRevealController {
  installReadyChannel();
  const win = opts.window;
  const createdAt = Date.now();
  let rendererReadyAt: number | null = null;
  let forced = false;
  let done = false;
  let lastTick = performance.now();
  let lastBusyAt = lastTick;
  let timer: ReturnType<typeof setInterval> | null = null;

  const pendingJobs = (): number => {
    try {
      return Math.max(0, opts.pendingStartupJobs());
    } catch {
      return 0;
    }
  };

  const stopWaiting = (): void => {
    done = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (active === self) active = null;
  };

  const reveal = (reason: MainRevealReason): void => {
    if (done) return;
    stopWaiting();
    if (win.isDestroyed()) {
      opts.splash.close();
      return;
    }
    // 스플래시를 보고 있던 사람에게는 본체가 손을 이어받고, 그 사이 다른 앱으로 간 사람의 손은 뺏지 않는다.
    const takeFocus = opts.splash.isFocused();
    // 막대는 지금 끝까지 채우고, 스플래시는 본체가 실제로 화면에 나온 뒤에 걷는다 — Windows 는 본체의 첫 프레임들을 가림
    //   뒤에서 흘려 보내므로(흰 프레임) 보인 순간과 화면에 나온 순간이 다르다. 먼저 걷으면 그 사이 바탕화면이 번쩍인다.
    const onScreen: Promise<FirstShowCover> = opts.firstShow ?? Promise.resolve('plain');
    opts.splash.finish(onScreen);
    if (takeFocus) win.show();
    else win.showInactive();
    void onScreen.then((cover) => {
      try {
        opts.onRevealed?.(reason, Date.now() - createdAt, cover);
      } catch { /* 표시·기록 전용 */ }
    });
  };

  const evaluate = (t: number = performance.now()): void => {
    if (done) return;
    const decision = decideMainReveal({
      now: Date.now(),
      createdAt,
      rendererReadyAt,
      pendingJobs: pendingJobs(),
      quietMs: t - lastBusyAt,
      forced,
    });
    if (decision.reveal) reveal(decision.reason);
  };

  const force = (): void => {
    if (done) return;
    forced = true;
    evaluate();
  };

  const self: ActiveReveal = {
    webContentsId: win.webContents.id,
    markRendererReady: () => {
      if (done || rendererReadyAt !== null) return;
      rendererReadyAt = Date.now();
      opts.splash.stage('finishing');
      evaluate();
    },
  };
  active = self;

  timer = setInterval(() => {
    const t = performance.now();
    if (t - lastTick - MAIN_REVEAL_POLL_MS >= MAIN_REVEAL_BUSY_LAG_MS) lastBusyAt = t;
    lastTick = t;
    evaluate(t);
  }, MAIN_REVEAL_POLL_MS);

  win.webContents.once('render-process-gone', force);
  win.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) force();
  });
  win.once('unresponsive', force);
  win.once('closed', () => {
    if (done) return;
    stopWaiting();
    opts.splash.close();
  });

  return {
    get pending() {
      return !done;
    },
    focusSplash: () => opts.splash.focus(),
  };
}
