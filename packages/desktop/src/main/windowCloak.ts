// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 ② 첫 표시 — 처음 보일 때의 흰 프레임을 DWM 가림 뒤로 보낸다. Windows 는 숨겨 만든 창의
// 첫 프레임을 바탕색·`ready-to-show` 와 무관하게 흰색으로 합성한다(Electron 28+ · electron#45774) — 기다려서는 못 없앤다.
// DWMWA_CLOAK 은 창을 숨기지 않아 Chromium 이 계속 그린다. `setOpacity` 로 가리지 마라 — 영영 layered 창이 된다.
// 판정은 `splashPolicy.ts`, koffi(`dwmCloak.ts`)는 Windows 에서 처음 가릴 때만 동적으로 읽는다(시작 청크에 실리는 파일).

import type { BrowserWindow } from 'electron';
import type { DwmSetWindowAttribute } from './dwmCloak';
import {
  coversFirstShow,
  FIRST_SHOW_COVER_CAP_MS,
  FIRST_SHOW_COVER_FRAMES,
  FIRST_SHOW_COVER_MIN_MS,
  rendererFramesScript,
} from './splashPolicy';

/** `DWMWA_CLOAK` — dwmapi.h `DWMWINDOWATTRIBUTE` 의 13번. */
const DWMWA_CLOAK = 13;

let binding: Promise<DwmSetWindowAttribute | null> | null = null;
let bound: DwmSetWindowAttribute | null = null;

/** dwmapi 의 함수 하나만 묶는다(처음 한 번). 실패하면 `null` — 가리지 않은 채 종전대로 간다(창은 그대로 나온다). */
function loadBinding(): Promise<DwmSetWindowAttribute | null> {
  binding ??= import('./dwmCloak').then((mod) => {
    const fn = mod.bindDwmSetWindowAttribute();
    bound = fn;
    return fn;
  }).catch((err: unknown) => {
    console.warn('[cloak] DWM binding unavailable — windows show without the first-frame cover:', err);
    return null;
  });
  return binding;
}

/** 창 핸들(HWND) 값. `getNativeWindowHandle()` 은 그 값을 담은 버퍼를 준다(64비트 8바이트). 못 읽으면 `null`. */
function hwndOf(win: BrowserWindow): bigint | null {
  try {
    const handle = win.getNativeWindowHandle();
    if (handle.length >= 8) return handle.readBigUInt64LE(0);
    if (handle.length >= 4) return BigInt(handle.readUInt32LE(0));
  } catch { /* 닫혔거나 핸들이 없는 창 */ }
  return null;
}

function setCloak(fn: DwmSetWindowAttribute, win: BrowserWindow, cloaked: boolean): boolean {
  try {
    if (win.isDestroyed()) return false;
    const hwnd = hwndOf(win);
    if (hwnd === null) return false;
    return fn(hwnd, DWMWA_CLOAK, Buffer.from(Int32Array.of(cloaked ? 1 : 0).buffer), 4) === 0;
  } catch {
    return false;
  }
}

/**
 * 아직 보인 적 없는 창을 가린다. Windows 가 아니거나 · 이미 보이거나 · 못 걸면 `false`(부르는 쪽은 가리지 않고 보인다).
 * 보이는 창은 가리지 않는다 — 걷을 때까지 화면에서 사라진다.
 */
export async function cloakBeforeFirstShow(win: BrowserWindow, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (!coversFirstShow(platform) || win.isDestroyed() || win.isVisible() || hwndOf(win) === null) return false;
    const fn = await loadBinding();
    // 묶는 사이에 누가 먼저 보였으면 걸지 않는다.
    if (!fn || win.isDestroyed() || win.isVisible()) return false;
    return setCloak(fn, win, true);
  } catch {
    return false;
  }
}

/** 가림을 걷는다. 건 적이 없거나 창이 닫혔으면 `false`. */
export function uncloakWindow(win: BrowserWindow): boolean {
  return bound ? setCloak(bound, win, false) : false;
}

/**
 * 첫 표시 결과: `plain` 가리지 않았다(Windows 밖·가림 실패·이미 보임) · `uncovered` 가린 채 보이고 프레임 뒤 걷었다 ·
 * `forced` 프레임 소식이 상한 안에 없어 그냥 걷었다(창은 나와야 한다) · `closed` 보이기(걷기) 전에 닫혔다.
 */
export type FirstShowCover = 'plain' | 'uncovered' | 'forced' | 'closed';

/**
 * 첫 `show` 의 첫 프레임들을 가린다(어떤 길로 보이든). 창을 만든 직후·보이기 전에 부르고, 약속은 화면에 나온 때 풀린다.
 * 걷기: `FIRST_SHOW_COVER_FRAMES` + `FIRST_SHOW_COVER_MIN_MS` 뒤, `FIRST_SHOW_COVER_CAP_MS` 를 넘기면 무조건 — 안 나오는 창이 흰 프레임보다 나쁘다.
 */
export function coverFirstShow(win: BrowserWindow, opts: { platform: NodeJS.Platform }): Promise<FirstShowCover> {
  return cloakBeforeFirstShow(win, opts.platform).then((covered) => {
    if (!covered) return 'plain';
    return new Promise<FirstShowCover>((resolve) => {
      let settled = false;
      let shown = false;
      let framesDone = false;
      let minDone = false;
      let minTimer: ReturnType<typeof setTimeout> | null = null;
      let capTimer: ReturnType<typeof setTimeout> | null = null;
      const settle = (result: FirstShowCover): void => {
        if (settled) return;
        settled = true;
        if (minTimer !== null) clearTimeout(minTimer);
        if (capTimer !== null) clearTimeout(capTimer);
        win.removeListener('show', onShow);
        win.removeListener('closed', onClosed);
        if (result === 'uncovered' || result === 'forced') {
          if (!uncloakWindow(win) && !win.isDestroyed()) console.warn('[cloak] could not uncover a window after its first show');
        }
        resolve(result);
      };
      const tryUncover = (): void => {
        if (framesDone && minDone) settle('uncovered');
      };
      const onClosed = (): void => settle('closed');
      const onShow = (): void => {
        if (shown || settled) return;
        shown = true;
        minTimer = setTimeout(() => { minTimer = null; minDone = true; tryUncover(); }, FIRST_SHOW_COVER_MIN_MS);
        capTimer = setTimeout(() => { capTimer = null; settle('forced'); }, FIRST_SHOW_COVER_CAP_MS);
        try {
          void win.webContents.executeJavaScript(rendererFramesScript(FIRST_SHOW_COVER_FRAMES))
            .then(() => { framesDone = true; tryUncover(); })
            .catch(() => { if (!settled) settle('forced'); });
        } catch {
          settle('forced');
        }
      };
      win.on('show', onShow);
      win.once('closed', onClosed);
    });
  }).catch((): FirstShowCover => 'plain');
}
