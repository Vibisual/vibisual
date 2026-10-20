/**
 * §5.13 (F) — offscreen-capture 백엔드의 main 프로세스 다리.
 *
 * 보이지 않는 창 하나를 띄워 렌더 전용 화면을 열고, 시각을 맞춘 뒤 한 장씩 찍는다.
 * 실험 API(HTML-in-Canvas)가 막히는 날에도 **CSS 를 온전히 살린 채** 영상이 계속
 * 나오게 하는 자리다.
 *
 * §3.7 과의 관계: 이건 **자식 프로세스 spawn 이 아니라** 우리 앱 안의 BrowserWindow 라
 * 단일 프로세스 원칙과 부딪히지 않는다(별창·지휘통제실과 같은 성질).
 *
 * §5.13 (W) 38-1 — 실측으로 찾은 두 결함을 고쳤다.
 * - **창이 화면 크기로 줄어들었다** — 1920×1080 을 청하면 작업 영역(예: 1707×912)이 됐고, 그 창을 찍어 늘였다(잘림·늘어남).
 *   이제 창을 만든 뒤 크기를 다시 키우고(`growWindowToContent`), 그래도 작으면 맞춤 배율(`fit`)을 렌더 화면에 넘긴다.
 * - **프레임마다 메인 스레드에서 PNG 를 구웠다**(332ms) — 이제 `toBitmap()`(수 ms) 날 비트맵과 바이트 순서를 넘긴다.
 *   순서는 처음 한 번 1×1 빨간 점으로 판정한다(플랫폼 가정 ❌). 판정이 안 되면 PNG 로 물러선다.
 */
import { BrowserWindow, nativeImage } from 'electron';

import { OFFSCREEN_MAX_EDGE } from '../constants.js';
import { RED_PIXEL_PNG_BASE64, bitmapOrderOf, type BitmapOrder, type RawFrame } from '../render/rawFrame.js';
import type { AppMainHost } from '../host.js';
import { growWindowToContent } from './windowSize.js';

/** 렌더 화면이 준비될 때까지 기다리는 최대 시간(ms). 넘으면 이 백엔드를 못 쓴다고 본다. */
const READY_TIMEOUT_MS = 20_000;
/** §5.13 (Y) 40-7 ③ — 일감이 끝난 렌더 창을 이만큼(ms) 쉬게 두었다가 닫는다(그 사이 다음 일감은 창을 다시 읽지 않는다). */
export const OFFSCREEN_IDLE_TTL_MS = 60_000;
/** 쉬게 둘 창 수의 상한(배경 종류마다) — 렌더러가 기기 예산으로 더 줄여 청한다(`keep`). */
export const OFFSCREEN_IDLE_MAX = 1;
/** 한 프레임을 그리고 찍는 데 허용하는 최대 시간(ms). */
const FRAME_TIMEOUT_MS = 15_000;

interface OffscreenSession {
  window: BrowserWindow;
  width: number;
  height: number;
  /** §5.13 (W) 38-1 — 창을 문서 크기로 못 키웠을 때의 맞춤 배율(1 = 그대로). */
  fit: number;
  /** §5.13 (Y) 40-7 ③ — 투명 창인가(쉬게 둘 때 같은 종류끼리만 다시 쓴다). */
  alpha?: boolean;
}

/**
 * §5.13 (T-4) — 세션 열쇠별 오프스크린 창. 종전에는 한 벌뿐이라, 렌더가 도는 중에 스틸 하나를 찍으려고 창을 열면
 * 렌더의 창이 닫혀 버렸다. 이제 일감마다 자기 열쇠로 연다(열쇠가 없으면 종전 한 벌 자리 `default`).
 */
const sessions = new Map<string, OffscreenSession>();
const DEFAULT_SESSION = 'default';

/**
 * §5.13 (Y) 40-7 ③ — 쉬는 렌더 창(풀). 종전에는 still·stills·strip·review 일감마다 창을 새로 띄우고 끝나면 부숴, 창마다 본체 엔트리
 * (13MB)를 코드 캐시 없이 다시 해석했다. 이제 끝난 창은 무대만 내려놓고 쉬다가, 다음 일감은 새 문서만 건네받는다
 * (`__vibiRenderOpen`). 투명 창은 만들 때 정해지므로 배경 종류(`alpha`)마다 따로 쉰다.
 */
interface IdleWindow {
  readonly window: BrowserWindow;
  readonly alpha: boolean;
  readonly timer: ReturnType<typeof setTimeout>;
}
const idleWindows: IdleWindow[] = [];

/** 끝난 창을 쉬게 둘까(순수 — 시험이 고정한다). `keep` 은 렌더러의 기기 예산이 정한다. */
export function offscreenPoolDecision(opts: { readonly keep: boolean; readonly idleSameKind: number; readonly maxIdle?: number }): 'pool' | 'destroy' {
  return opts.keep && opts.idleSameKind < (opts.maxIdle ?? OFFSCREEN_IDLE_MAX) ? 'pool' : 'destroy';
}

function takeIdleWindow(alpha: boolean): BrowserWindow | null {
  for (let i = idleWindows.length - 1; i >= 0; i -= 1) {
    const idle = idleWindows[i]!;
    if (idle.alpha !== alpha) continue;
    idleWindows.splice(i, 1);
    clearTimeout(idle.timer);
    if (!idle.window.isDestroyed()) return idle.window;
  }
  return null;
}

function destroyWindow(win: BrowserWindow | null | undefined): void {
  if (win && !win.isDestroyed()) win.destroy();
}

function sessionKey(raw: unknown): string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw) ? raw : DEFAULT_SESSION;
}

/** 파일 경로는 호스트가 준다 — 앱이 코어의 디렉토리 구조를 알지 않게(§5.13 (P)). */
let mainHost: AppMainHost | null = null;
export function setMainHost(h: AppMainHost): void {
  mainHost = h;
}
export function hostOrThrow(): AppMainHost {
  if (!mainHost) throw new Error('video 앱이 아직 붙지 않았습니다.');
  return mainHost;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} 가 ${ms}ms 안에 끝나지 않았습니다.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** §5.13 (W) 38-1 — `toBitmap()` 의 바이트 순서(처음 한 번 판정 — null 이면 PNG 로 물러선다). */
let bitmapOrder: BitmapOrder | null | undefined;
function nativeBitmapOrder(): BitmapOrder | null {
  if (bitmapOrder !== undefined) return bitmapOrder;
  try {
    const probe = nativeImage.createFromDataURL(`data:image/png;base64,${RED_PIXEL_PNG_BASE64}`);
    bitmapOrder = probe.isEmpty() ? null : bitmapOrderOf(probe.toBitmap());
  } catch {
    bitmapOrder = null;
  }
  return bitmapOrder;
}

/**
 * §5.13 (W) 38-3 — 이 환경에서 투명 창이 알파를 가진 채 찍히는가(처음 한 번만 잰다). 창 합성기가 없는 데스크톱(일부 리눅스)에서는
 * 투명 창이 검은 바탕으로 그려져 **조용히 불투명 영상**이 나온다 — 그 전에 이유와 함께 멈추려고 잰다(Windows 실측 = 알파 유지).
 */
let alphaCapture: Promise<boolean> | null = null;
function probeAlphaCapture(): Promise<boolean> {
  if (alphaCapture) return alphaCapture;
  alphaCapture = (async () => {
    const win = new BrowserWindow({ width: 32, height: 32, show: false, frame: false, transparent: true, backgroundColor: '#00000000', useContentSize: true, webPreferences: { backgroundThrottling: false } });
    try {
      await win.loadURL('data:text/html,<html style="background:transparent"><body style="margin:0;background:transparent"></body></html>');
      await sleep(250);
      const shot = await win.webContents.capturePage({ x: 0, y: 0, width: 32, height: 32 });
      if (shot.isEmpty()) return false;
      const size = shot.getSize();
      const bmp = shot.toBitmap();
      // 알파는 BGRA·RGBA 모두 네 번째 바이트다(순서 판정이 필요 없다).
      const i = ((Math.floor(size.height / 2) * size.width) + Math.floor(size.width / 2)) * 4 + 3;
      return (bmp[i] ?? 255) < 16;
    } catch {
      return false;
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  })();
  return alphaCapture;
}

export function probeOffscreen(): { available: boolean; reason?: string } {
  // BrowserWindow 를 만들 수 있으면 쓸 수 있다. 실제 실패는 open 에서 드러난다.
  return { available: true };
}

/** 렌더 화면에 넘기는 해시(순수 — 시험이 모양을 본다). */
export function renderHash(opts: { project: string; docId: string; width: number; height: number; rev?: string; fit?: number; alpha?: boolean; frame?: string }): string {
  return (
    `app=vibistudio&mode=render&project=${encodeURIComponent(opts.project)}&docId=${encodeURIComponent(opts.docId)}` +
    `&w=${opts.width}&h=${opts.height}` +
    (opts.rev ? `&rev=${encodeURIComponent(opts.rev)}` : '') +
    (opts.fit !== undefined && opts.fit < 1 ? `&fit=${opts.fit}` : '') +
    (opts.alpha === true ? '&alpha=1' : '') +
    (opts.frame ? `&frame=${encodeURIComponent(opts.frame)}` : '')
  );
}

export async function openOffscreen(opts: {
  width: number;
  height: number;
  project: string;
  docId: string;
  /** §5.13 (T-4) — 세션 열쇠(일감마다). 없으면 종전 한 벌 자리. */
  session?: string;
  /** §5.13 (V) 37-3 — 판 기록의 한 판을 찍으면 그 판(렌더 화면이 그 판의 문서·코드로 무대를 세운다). */
  rev?: string;
  /** §5.13 (W) 38-3 — 투명 배경(창·문서·무대 배경을 비운다). */
  alpha?: boolean;
  /** §5.13 (W) 38-7 — 장면 정지 화면(렌더 화면이 그 컴포지션 하나짜리 문서로 무대를 세운다). */
  frame?: string;
}): Promise<{ fit: number }> {
  const key = sessionKey(opts.session);
  await closeOffscreen(key);

  const alpha = opts.alpha === true;
  // §5.13 (W) 38-3 — 투명 창이 알파를 지키지 못하는 환경이면 불투명 영상을 내보내지 않고 이유와 함께 멈춘다.
  if (alpha && !(await probeAlphaCapture())) {
    throw new Error('이 환경에서는 투명 배경을 찍을 수 없습니다 — 창 합성(컴포지터)이 꺼져 있으면 투명 창이 검은 바탕으로 그려집니다. 일반 MP4 로 내보내 주세요.');
  }

  // §5.13 (Y) 40-7 ③ — 쉬던 창이 있으면 새 문서만 건넨다(본체를 다시 읽지 않는다). 실패하면 그 창은 버리고 새로 띄운다.
  const reused = takeIdleWindow(alpha);
  if (reused) {
    try {
      const grown = growWindowToContent(reused, opts.width, opts.height, OFFSCREEN_MAX_EDGE);
      const params = renderParams({ ...opts, fit: grown.fit, alpha });
      await reused.webContents.executeJavaScript(`window.__vibiRenderOpen && window.__vibiRenderOpen(${JSON.stringify(params)}); typeof window.__vibiRenderOpen === 'function'`).then((ok: unknown) => {
        if (ok !== true) throw new Error('render window cannot be reused');
      });
      await waitRenderReady(reused);
      sessions.set(key, { window: reused, width: opts.width, height: opts.height, fit: grown.fit, alpha });
      return { fit: grown.fit };
    } catch {
      destroyWindow(reused);
    }
  }

  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    show: false,
    frame: false,
    backgroundColor: alpha ? '#00000000' : '#000000',
    ...(alpha ? { transparent: true } : {}),
    // 창 크기와 픽셀 크기를 1:1 로 묶는다 — 배율이 끼면 찍힌 그림이 요청한 해상도와 어긋난다.
    useContentSize: true,
    // §5.13 (W) 38-1 — mac 은 이 값이 있어야 화면보다 큰 창이 선다(Windows 는 아래 키우기가 맡는다).
    enableLargerThanScreen: true,
    webPreferences: {
      preload: hostOrThrow().preloadFile,
      // §5.13 (Y) 40-7 ⑤ — 일꾼 창과 같은 판단: preload 는 샌드박스에서도 실리지만(31.7.7 probe) 창 전체의 샌드박스 전환은 사용자 확인 뒤(P3 ⑥).
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 보이지 않는 창은 브라우저가 타이머를 늦춘다 — 렌더가 기어가는 원인이라 끈다.
      backgroundThrottling: false,
      offscreen: false,
    },
  });
  // §5.13 (Y) 40-7 ③ — 읽기·준비 중 무엇이 던지든 창을 반드시 닫는다(종전에는 `loadFile`·`executeJavaScript` 가 던지면 창이
  //   `sessions` 에 들지 않은 채 남아 `closeAllOffscreen` 도 못 찾는 고아가 됐다).
  let committed = false;
  try {
    // §5.13 (W) 38-1 — Windows 는 창을 화면 작업 영역으로 줄인다(실측). 최대 크기를 연 뒤 내용 크기를 다시 준다.
    const grown = growWindowToContent(win, opts.width, opts.height, OFFSCREEN_MAX_EDGE);

    await win.loadFile(hostOrThrow().rendererFile, {
      hash: renderHash({ ...opts, fit: grown.fit, alpha }),
    });

    // 렌더 화면이 문서를 받아 무대를 세울 때까지 기다린다.
    await waitRenderReady(win);

    sessions.set(key, { window: win, width: opts.width, height: opts.height, fit: grown.fit, alpha });
    committed = true;
    return { fit: grown.fit };
  } finally {
    if (!committed) destroyWindow(win);
  }
}

/** 렌더 화면이 문서를 받아 무대를 세웠는가(상한까지 기다린다 — 넘으면 그 화면이 남긴 이유와 함께 던진다). */
async function waitRenderReady(win: BrowserWindow): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (win.isDestroyed()) throw new Error('렌더 창이 닫혔습니다.');
    const ready = (await win.webContents.executeJavaScript('window.__vibiRenderReady === true')) as boolean;
    if (ready) return;
    const err = (await win.webContents.executeJavaScript('window.__vibiRenderError ?? null')) as string | null;
    if (err) throw new Error(err);
    if (Date.now() > deadline) throw new Error('렌더 화면이 준비되지 않았습니다.');
    await sleep(120);
  }
}

/** 해시와 같은 이름의 값(풀로 다시 쓰는 창에 건넨다). */
function renderParams(opts: { project: string; docId: string; width: number; height: number; rev?: string; fit?: number; alpha?: boolean; frame?: string }): Record<string, string> {
  return {
    app: 'vibistudio', mode: 'render', project: opts.project, docId: opts.docId, w: String(opts.width), h: String(opts.height),
    ...(opts.rev ? { rev: opts.rev } : {}),
    ...(opts.fit !== undefined && opts.fit < 1 ? { fit: String(opts.fit) } : {}),
    ...(opts.alpha === true ? { alpha: '1' } : {}),
    ...(opts.frame ? { frame: opts.frame } : {}),
  };
}

/**
 * 시각 t 로 맞추고 한 장 찍는다. `format: 'raw'` 면 날 비트맵(새 길 — 메인 스레드에서 PNG 를 굽지 않는다), 아니면 PNG(옛 길).
 * 바이트 순서를 판정할 수 없는 환경이면 raw 를 청해도 PNG 로 돌려준다(일꾼은 둘 다 받는다).
 */
export async function captureOffscreenAt(t: number, session?: string, format?: 'raw' | 'png'): Promise<Buffer | RawFrame> {
  const current = sessions.get(sessionKey(session));
  if (!current || current.window.isDestroyed()) throw new Error('렌더 창이 열려 있지 않습니다.');

  await withTimeout(
    current.window.webContents.executeJavaScript(`window.__vibiRenderSeek(${JSON.stringify(t)})`),
    FRAME_TIMEOUT_MS,
    '프레임 준비',
  );

  // 맞춤 배율이면 무대가 그만큼 줄어 서 있다 — 그 칸만 찍는다.
  const image = await withTimeout(
    current.window.webContents.capturePage({
      x: 0,
      y: 0,
      width: Math.max(1, Math.ceil(current.width * current.fit)),
      height: Math.max(1, Math.ceil(current.height * current.fit)),
    }),
    FRAME_TIMEOUT_MS,
    '화면 캡처',
  );

  const order = format === 'raw' ? nativeBitmapOrder() : null;
  if (order) {
    const size = image.getSize();
    const bitmap = image.toBitmap();
    // Buffer 를 그대로 보내면 구조적 복제에서 Uint8Array 로 바뀐다 — ArrayBuffer 로 통일.
    const data = bitmap.buffer.slice(bitmap.byteOffset, bitmap.byteOffset + bitmap.byteLength) as ArrayBuffer;
    return { kind: 'raw', width: size.width, height: size.height, order, premultiplied: true, data };
  }
  return image.toPNG();
}

/**
 * §5.13 (V) 37-9 — 마지막으로 맞춘 시각에 무대의 컴포지션들 안에서 보이는 글자 상자(읽기 전용 — 무대가 샌드박스에 `inspect` 를
 * 묻는다). 렌더 화면이 그 길을 모르면 빈 목록.
 */
export async function inspectOffscreen(session?: string): Promise<unknown[]> {
  const current = sessions.get(sessionKey(session));
  if (!current || current.window.isDestroyed()) throw new Error('렌더 창이 열려 있지 않습니다.');
  const raw = await withTimeout(
    current.window.webContents.executeJavaScript('window.__vibiRenderInspect ? window.__vibiRenderInspect() : "[]"') as Promise<unknown>,
    FRAME_TIMEOUT_MS,
    '글자 상자 읽기',
  );
  try {
    const parsed: unknown = JSON.parse(typeof raw === 'string' ? raw : '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 일감을 끝낸다. `keep` 이면(렌더러의 기기 예산) 창을 부수지 않고 무대만 내려놓은 채 `OFFSCREEN_IDLE_TTL_MS` 동안 쉬게 둔다 —
 * 다음 일감이 그 창을 다시 쓴다. 쉬는 창이 이미 차 있으면 부순다.
 */
export async function closeOffscreen(session?: string, keep = false): Promise<void> {
  const key = sessionKey(session);
  const current = sessions.get(key);
  sessions.delete(key);
  if (!current || current.window.isDestroyed()) return;
  const alpha = current.alpha === true;
  const decision = offscreenPoolDecision({ keep, idleSameKind: idleWindows.filter((w) => w.alpha === alpha).length });
  if (decision === 'destroy') { current.window.destroy(); return; }
  const win = current.window;
  try {
    // 무대(샌드박스 문서·디코더)를 내려놓는다 — 빈 값을 건네면 렌더 화면이 아무것도 세우지 않는다.
    await win.webContents.executeJavaScript('window.__vibiRenderOpen && window.__vibiRenderOpen({}); true');
  } catch {
    destroyWindow(win);
    return;
  }
  if (win.isDestroyed()) return;
  const timer = setTimeout(() => {
    const i = idleWindows.findIndex((w) => w.window === win);
    if (i >= 0) idleWindows.splice(i, 1);
    destroyWindow(win);
  }, OFFSCREEN_IDLE_TTL_MS);
  timer.unref?.();
  idleWindows.push({ window: win, alpha, timer });
}

/** 본체 창이 닫힐 때 — 열린·쉬는 오프스크린 창을 전부 닫는다(§5.13 (T-11) ④). */
export function closeAllOffscreen(): void {
  for (const [key, current] of sessions) {
    sessions.delete(key);
    if (!current.window.isDestroyed()) current.window.destroy();
  }
  for (const idle of idleWindows.splice(0)) {
    clearTimeout(idle.timer);
    destroyWindow(idle.window);
  }
}

/** 지금 살아 있는 오프스크린 창 수(일감 중 + 쉬는 것) — 계측·시험용. */
export function offscreenWindowCount(): { active: number; idle: number } {
  return { active: sessions.size, idle: idleWindows.length };
}
