// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 — 스플래시 창을 실제로 띄우고 진척을 흘려보내는 얇은 층.
//
// 판정(단계별 진행·문구·색·창 옵션)은 전부 `splashPolicy.ts` 에 있다 — 여기는 electron 을 부르는 일만 한다.
// 시작 진입점(`bootstrap.ts`)이 **본체 모듈보다 먼저** 이 창을 띄우므로 이 파일은 서버 코어·shared 를 부르지 않는다.
//
// 사용자가 닫지 못한다(테두리도 없다) — 언리얼·Visual Studio 의 시작 화면과 같다. 부팅 도중의 종료는 부팅과 정리가
// 엇갈리는 새 길이 되므로 막아 둔다. 다만 앱이 끝나는 중(`before-quit`)이나 Windows 세션 종료에서는 막지 않는다 —
// 막으면 종료·로그오프를 붙잡는다.

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, MessageChannelMain, screen } from 'electron';
import type { AppThemeKind, BootProgress } from '@vibisual/shared';
import { splashPage } from './splashPage';
import {
  FIRST_SHOW_COVER_FRAMES,
  FIRST_SHOW_COVER_MIN_MS,
  rendererFramesScript,
  SPLASH_FIRST_PAINT_CAP_MS,
  SPLASH_HANDOFF_MS,
  SPLASH_PRESENT_CAP_MS,
  splashBootView,
  splashDoneView,
  splashIconFile,
  splashPalette,
  splashStageView,
  splashWindowOptions,
  type SplashRect,
  type SplashStage,
  type SplashView,
} from './splashPolicy';
import { splashStrings, type SplashLocale } from './splashStrings';
import { cloakBeforeFirstShow, uncloakWindow } from './windowCloak';

/** main → 스플래시 preload 로 메시지 포트를 넘기는 채널. 정본은 여기 — `preload/splash.ts` 가 같은 이름을 듣는다. */
export const SPLASH_PORT_CHANNEL = 'vibisual:splash:port';

export interface SplashHandle {
  readonly locale: SplashLocale;
  /** 단계 하나(문구·진행 구간이 정해져 있다). */
  stage(stage: SplashStage): void;
  /** 서버 코어가 넘긴 부팅 진척. */
  boot(progress: BootProgress): void;
  /** 동의 창이 떠 있는 동안처럼 잠시 감춘다. */
  hide(): void;
  show(): void;
  /** 두 번째 실행·Dock 클릭에 답한다 — 최소화돼 있으면 되살린다. */
  focus(): void;
  isFocused(): boolean;
  /**
   * 본체 창이 보인다 — 막대를 끝까지 채우고, `after` 가 풀린 뒤(본체가 실제로 화면에 나온 때 — Windows 는 첫 프레임 가림을
   * 걷은 때) 잠시 있다가 걷는다. 본체가 나오기 전에 걷으면 그 사이 바탕화면이 번쩍인다.
   */
  finish(after?: Promise<unknown>): void;
  /** 지금 걷는다(부팅 실패 안내를 띄우기 전 등). */
  close(): void;
}

export interface OpenSplashOptions {
  locale: SplashLocale;
  background: string;
  kind: AppThemeKind;
  version: string;
}

function primaryWorkArea(): SplashRect | null {
  try {
    return screen.getPrimaryDisplay().workArea;
  } catch {
    return null;
  }
}

/**
 * 문서 로드와 첫 그림을 모두 기다려 창을 보이고, 표시 뒤 두 프레임까지 메인 스레드를 비워 둔다.
 * show() 직후 반환하면 본체의 동기 로드가 OS 의 첫 창 표시를 막아 흰 사각형이 남을 수 있다.
 * Windows 는 그래도 첫 프레임이 흰색으로 찍힌다(엔진이 처음 보이는 창의 첫 장을 흰 바탕으로 합성한다 — `splashPolicy`
 * `coversFirstShow`). 그래서 DWM 가림 뒤에서 보이고, 렌더러가 몇 프레임을 지난 뒤 걷는다(`windowCloak.ts`).
 * 창 생성·로드·칠하기가 실패하거나 상한을 넘기면 `null` — 빈 창을 보이지 않고 스플래시 없이 부팅한다.
 */
export async function openSplash(opts: OpenSplashOptions): Promise<SplashHandle | null> {
  const strings = splashStrings(opts.locale);
  const palette = splashPalette(opts.background, opts.kind);
  let win: BrowserWindow;
  try {
    win = new BrowserWindow(splashWindowOptions({
      platform: process.platform,
      background: palette.background,
      iconPath: join(__dirname, '..', splashIconFile(process.platform)),
      preloadPath: join(__dirname, '../preload/splash.cjs'),
      workArea: primaryWorkArea(),
    }));
  } catch (err) {
    console.warn('[splash] could not create the window:', err);
    return null;
  }
  // Windows — 처음 보일 때의 흰 프레임을 가릴 준비를 문서 로드와 나란히 한다(보이기 직전에 기다린다).
  const cloaking = cloakBeforeFirstShow(win, process.platform);

  let destroyed = false;
  let closing = false;
  const allowClose = (): void => { closing = true; };
  app.once('before-quit', allowClose);
  win.on('close', (event) => { if (!closing) event.preventDefault(); });
  win.on('session-end', allowClose);

  const { port1, port2 } = new MessageChannelMain();
  win.once('closed', () => {
    destroyed = true;
    app.removeListener('before-quit', allowClose);
    try { port1.close(); } catch { /* 이미 닫힘 */ }
  });
  const close = (): void => {
    if (destroyed || win.isDestroyed()) return;
    closing = true;
    try { win.destroy(); } catch { /* 이미 닫힘 */ }
  };

  // 자기 세션(`vibisual-splash`) — 권한·새 창·이동·webview 를 전부 거절한다(동의 창과 같은 격리).
  const contents = win.webContents;
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.once('did-finish-load', () => {
    try { contents.postMessage(SPLASH_PORT_CHANNEL, null, [port2]); } catch { /* 표시 전용 */ }
  });

  const html = splashPage({
    nonce: randomBytes(24).toString('hex'),
    locale: opts.locale,
    view: splashStageView('starting', strings),
    palette,
    version: `v${opts.version}`,
    progressLabel: strings.progressLabel,
  });
  const ready = await new Promise<boolean>((resolve) => {
    let loaded = false;
    let painted = false;
    const finish = (ok: boolean): void => {
      clearTimeout(cap);
      win.removeListener('ready-to-show', onPaint);
      win.removeListener('closed', onFailure);
      contents.removeListener('render-process-gone', onFailure);
      resolve(ok);
    };
    const onPaint = (): void => { painted = true; if (loaded) finish(true); };
    const onFailure = (): void => finish(false);
    const cap = setTimeout(() => {
      console.warn('[splash] first paint timed out — skipping the splash');
      finish(false);
    }, SPLASH_FIRST_PAINT_CAP_MS);
    win.once('ready-to-show', onPaint);
    win.once('closed', onFailure);
    contents.once('render-process-gone', onFailure);
    const onError = (err: unknown): void => {
      console.warn('[splash] page load failed:', err);
      finish(false);
    };
    try {
      void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).then(() => {
        loaded = true;
        if (painted) finish(true);
      }).catch(onError);
    } catch (err) { onError(err); }
  });
  if (!ready || destroyed || win.isDestroyed()) {
    close();
    return null;
  }
  const covered = await cloaking;
  if (destroyed || win.isDestroyed()) {
    close();
    return null;
  }
  win.show();

  // 숨긴 창의 ready-to-show 는 표시 후의 프레임이 아니다. 이 왕복 동안 OS 창 메시지와 Chromium 합성이
  // 돌게 둔 뒤에야 bootstrap 이 서버 코어를 읽는다. 고정 지연 대신 실제 프레임을 기다리고, 실패는 제한한다.
  // 가렸으면(Windows) 그 앞에 한 단계 — 렌더러가 FIRST_SHOW_COVER_FRAMES 를 지나고 FIRST_SHOW_COVER_MIN_MS 가 흐른 뒤 걷는다.
  // 그 사이 찍히는 흰 프레임은 화면에 나오지 않는다. 상한(SPLASH_PRESENT_CAP_MS)을 넘기면 걷지 않은 채 버린다 — 한 번도
  // 화면에 나오지 않은 창이라 아무것도 번쩍이지 않는다.
  const presented = await new Promise<boolean>((resolve) => {
    let settled = false;
    let minTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(cap);
      if (minTimer !== null) clearTimeout(minTimer);
      win.removeListener('closed', onFailure);
      contents.removeListener('render-process-gone', onFailure);
      resolve(ok);
    };
    const onFailure = (): void => finish(false);
    const cap = setTimeout(() => {
      console.warn('[splash] presentation timed out — skipping the splash');
      finish(false);
    }, SPLASH_PRESENT_CAP_MS);
    win.once('closed', onFailure);
    contents.once('render-process-gone', onFailure);
    const onError = (err: unknown): void => {
      console.warn('[splash] presentation failed:', err);
      finish(false);
    };
    const afterFrames = (frames: number, then: () => void): void => {
      try {
        void contents.executeJavaScript(rendererFramesScript(frames))
          .then(() => { if (!settled) then(); })
          .catch(onError);
      } catch (err) { onError(err); }
    };
    const presentFrames = (): void => afterFrames(2, () => finish(true));
    if (!covered) {
      presentFrames();
      return;
    }
    let framesDone = false;
    let minDone = false;
    const uncover = (): void => {
      if (settled || !framesDone || !minDone) return;
      if (!uncloakWindow(win)) {
        onError(new Error('could not uncover the splash after its first frames'));
        return;
      }
      presentFrames();
    };
    minTimer = setTimeout(() => { minTimer = null; minDone = true; uncover(); }, FIRST_SHOW_COVER_MIN_MS);
    afterFrames(FIRST_SHOW_COVER_FRAMES, () => { framesDone = true; uncover(); });
  });
  if (!presented || destroyed || win.isDestroyed()) {
    close();
    return null;
  }

  const send = (view: SplashView): void => {
    if (destroyed) return;
    try { port1.postMessage(view); } catch { /* 표시 전용 */ }
  };
  return {
    locale: opts.locale,
    stage: (stage) => send(splashStageView(stage, strings)),
    boot: (progress) => send(splashBootView(progress, strings)),
    hide: () => { if (!destroyed && !win.isDestroyed() && win.isVisible()) win.hide(); },
    show: () => { if (!destroyed && !win.isDestroyed() && !win.isVisible()) win.show(); },
    focus: () => {
      if (destroyed || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    },
    isFocused: () => !destroyed && !win.isDestroyed() && win.isFocused(),
    finish: (after) => {
      send(splashDoneView(strings));
      const closeLater = (): void => { setTimeout(close, SPLASH_HANDOFF_MS); };
      if (after) void after.then(closeLater, closeLater);
      else closeLater();
    },
    close,
  };
}
