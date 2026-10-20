// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 ② 첫 표시 — **처음 보일 때의 흰 프레임을 DWM 가림 뒤로 보낸다.**
//
// Windows 에서 숨겨 만든 창을 처음 보이면 첫 프레임이 흰색으로 찍힌다 — `backgroundColor` 를 줘도, 첫 칠(`ready-to-show`)을
// 기다려도 그렇다(Electron 28 부터 · electron#45774 — 두 번째 표시부터는 깨끗하다). 렉으로 늦게 그리는 것이 아니라 엔진이
// 첫 장을 흰 바탕으로 합성하는 것이라, 기다리는 시간을 늘려서는 못 없앤다. 그 몇 장이 화면에 나오지 않게 가린다.
//
// 가림(DWMWA_CLOAK — 앱이 쓰라고 공개된 DWM 특성, Windows 8+)은 창을 숨기지 않는다. 창은 보이는 상태라 Chromium 이 계속
// 그리고(앱이 건 가림은 Chromium 가림 판정에서 숨김이 아니다 — 지금 데스크톱의 창으로 친다), 화면에만 안 나온다. 창 모양
// (테두리·그림자·둥근 모서리)은 건드리지 않는다 — 투명도(`setOpacity`)로 가리면 창이 영영 layered 창이 된다.
//
// 판정·숫자는 `splashPolicy.ts`(electron 없이 세 OS 가지를 시험한다). koffi 묶음(`dwmCloak.ts`)은 Windows 에서 처음 가릴 때만
// 동적으로 읽는다 — 이 파일은 시작 진입점 청크에 실리지만 다른 OS 에서는 koffi 를 읽지 않는다.

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
 * 아직 보인 적 없는 창을 가린다. Windows 가 아니거나 · 이미 보이거나 · 못 걸면 `false` — 부르는 쪽은 가리지 않은 채
 * 종전대로 보인다. **보이는 창은 가리지 않는다** — 걷을 때까지 화면에서 사라진다.
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
 * 첫 표시가 어떻게 끝났나.
 *  - `plain` — 가리지 않았다(Windows 밖 · 가림을 못 걸었다 · 이미 보이던 창). 창은 종전대로 나온다.
 *  - `uncovered` — 가린 채 보였고, 렌더러가 프레임을 지난 뒤 걷었다.
 *  - `forced` — 가린 채 보였지만 프레임 소식이 상한 안에 안 왔거나 렌더러가 답하지 못해 그냥 걷었다(창은 나와야 한다).
 *  - `closed` — 보이기 전에(또는 걷기 전에) 창이 닫혔다.
 */
export type FirstShowCover = 'plain' | 'uncovered' | 'forced' | 'closed';

/**
 * 이 창이 **처음 보일 때**의 첫 프레임들을 가린다 — 누가 어떤 길로 보이든(`show`·`showInactive`·다른 손잡이) 그 첫 `show` 에
 * 맞춰 돈다. 약속은 창이 화면에 나온 때 풀린다(가리지 않았으면 곧바로). 창을 만든 **직후**, 보이기 전에 부른다.
 *
 * 걷는 조건: 첫 `show` 뒤 렌더러가 `FIRST_SHOW_COVER_FRAMES` 를 지나고 `FIRST_SHOW_COVER_MIN_MS` 가 흐른 때. 상한
 * `FIRST_SHOW_COVER_CAP_MS` 를 넘기면 그래도 걷는다 — 흰 프레임보다 안 나오는 창이 훨씬 나쁘다.
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
