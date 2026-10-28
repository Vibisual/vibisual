/**
 * §5.13 (V) 37-2 — '이 앱 소개' 레시피의 실제 화면 한 장: 이 프로젝트의 iframe 프리뷰를 숨은 창에 열어 찍고 바로 닫는다((T-14) 3단계).
 * loopback 주소만 받는다 — 남의 사이트 ❌((T-10)), 판정은 순수 `isLoopbackPageUrl`(세 OS 모양을 시험). 창은 샌드박스·preload 없음 — 우리 다리를 주지 않는다.
 * 새 창·다른 출처 이동은 막는다. 숨은 창 `capturePage` 는 오프스크린 렌더와 같은 자리(§5.13 (T-12) ①) — 세 OS 실기 미확인.
 */
import { BrowserWindow } from 'electron';

import { growWindowToContent } from './windowSize.js';

/** 페이지가 뜨기를 기다리는 상한(ms). */
const LOAD_TIMEOUT_MS = 15_000;
/** 뜬 뒤 그림이 자리 잡기를 기다리는 시간(ms) — 글꼴·첫 애니메이션. */
const SETTLE_MS = 900;
/** 찍는 창의 기본 크기(px). */
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const MAX_EDGE = 3840;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** loopback 의 http(s) 주소인가 — 그 밖은 찍지 않는다. */
export function isLoopbackPageUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.trim() === '') return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username !== '' || url.password !== '') return false;
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  } catch {
    return false;
  }
}

function clampEdge(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(320, Math.min(MAX_EDGE, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 주소를 숨은 창에 열고 한 장 찍는다(PNG). loopback 이 아니면 거절한다. */
export async function capturePageImage(opts: { url: unknown; width?: unknown; height?: unknown }): Promise<Buffer> {
  if (!isLoopbackPageUrl(opts.url)) throw new Error('Only pages served from this computer (loopback) can be captured.');
  const url = opts.url;
  const width = clampEdge(opts.width, DEFAULT_WIDTH);
  const height = clampEdge(opts.height, DEFAULT_HEIGHT);
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    skipTaskbar: true,
    useContentSize: true,
    backgroundColor: '#000000',
    // §5.13 (W) 38-1 — mac 은 이 값이 있어야 화면보다 큰 창이 선다(다른 OS 는 아래 키우기가 맡는다).
    enableLargerThanScreen: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  // §5.13 (W) 38-1 — Windows 는 창을 화면 작업 영역으로 줄인다 — 청한 크기로 다시 키운다(못 키우면 선 크기 그대로 찍는다).
  const grown = growWindowToContent(win, width, height, MAX_EDGE);
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, next) => { if (!isLoopbackPageUrl(next)) event.preventDefault(); });
    win.webContents.setAudioMuted(true);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        win.loadURL(url),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('The page did not load in time.')), LOAD_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    await sleep(SETTLE_MS);
    if (win.isDestroyed()) throw new Error('The capture window closed.');
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: Math.min(width, grown.width || width), height: Math.min(height, grown.height || height) });
    if (image.isEmpty()) throw new Error('The page produced an empty picture.');
    return image.toPNG();
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
