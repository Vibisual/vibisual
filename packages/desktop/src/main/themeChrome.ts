/**
 * §4 앱 테마 — 창 바탕(`backgroundColor`)과 제목줄 단추(`titleBarOverlay`)를 테마 색으로 칠한다.
 *
 * 화면 안은 렌더러가 CSS 변수로 칠하지만, **창 바탕은 렌더러가 그리기 전의 빈 창**이고 제목줄 단추는
 * OS 가 그린다 — 그 둘은 main 만 칠할 수 있다. 색은 서버 코어가 화면과 **같은 해석**으로 낸 값
 * (`getAppThemeChrome`)이라 창 바탕과 화면이 서로 다른 테마를 칠하지 않는다.
 *
 * 투명 창(오버레이 버블·윤곽선 · `#00000000`)은 등록하지 않는다 — 바탕을 칠하면 그 창의 정체가 무너진다.
 */
import type { BrowserWindow } from 'electron';
import type { AppThemeChrome } from '@vibisual/shared';
import { getAppThemeChrome, subscribeAppThemeChrome } from '@vibisual/server';
import { FALLBACK_APP_THEME_CHROME, titleBarOverlayFor } from './themeChromePolicy';

/** 테마가 바뀌면 바탕을 다시 칠할 창들(불투명 창만). */
const themedWindows = new Set<BrowserWindow>();
/** 제목줄 오버레이를 가진 창 — 지금은 본체 창 하나다(별창들은 `frame:false` 로 우리 UI 가 대신 그린다). */
const overlayWindows = new Set<BrowserWindow>();
let unsubscribe: (() => void) | null = null;

/** 지금 칠할 창 색. 서버 코어가 답하지 못하면 기본 테마 색 — 창을 못 여는 것보다 낫다. */
export function safeAppThemeChrome(): AppThemeChrome {
  try {
    return getAppThemeChrome();
  } catch {
    return FALLBACK_APP_THEME_CHROME;
  }
}

/** 새 창을 테마 칠하기 대상으로 올린다. 창이 닫히면 저절로 빠진다. */
export function trackThemedWindow(win: BrowserWindow, opts: { titleBarOverlay?: boolean } = {}): void {
  themedWindows.add(win);
  if (opts.titleBarOverlay) overlayWindows.add(win);
  win.once('closed', () => {
    themedWindows.delete(win);
    overlayWindows.delete(win);
  });
}

/** 열린 창 전부를 이 색으로 다시 칠한다. */
export function applyAppThemeChrome(chrome: AppThemeChrome, platform: NodeJS.Platform = process.platform): void {
  for (const win of themedWindows) {
    if (win.isDestroyed()) continue;
    try {
      win.setBackgroundColor(chrome.background);
    } catch {
      // 닫히는 중인 창 — 다음 창에 영향 없이 넘어간다.
    }
  }
  const overlay = titleBarOverlayFor(chrome, platform);
  if (!overlay) return;
  for (const win of overlayWindows) {
    if (win.isDestroyed()) continue;
    try {
      win.setTitleBarOverlay(overlay);
    } catch {
      // 오버레이 없이 뜬 창(환경에 따라 꺼질 수 있다) — 바탕은 이미 칠했다.
    }
  }
}

/** 부팅 때 한 번 — 테마가 바뀌면 열린 창 전부를 다시 칠한다. 두 번 불려도 구독은 하나다. */
export function installAppThemeChromeSync(): void {
  if (unsubscribe) return;
  try {
    unsubscribe = subscribeAppThemeChrome((chrome) => applyAppThemeChrome(chrome));
  } catch (err) {
    console.error('[themeChrome] subscribe failed', err);
  }
}
