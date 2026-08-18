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
 * 느리다는 것은 설계상 받아들인 대가다 — 프레임마다 창을 그리고 비트맵을 꺼내야 한다.
 * 그래서 우선순위가 두 번째이고, 첫 번째가 되는 일은 없다.
 */
import { BrowserWindow } from 'electron';

import type { AppMainHost } from '../host.js';

/** 렌더 화면이 준비될 때까지 기다리는 최대 시간(ms). 넘으면 이 백엔드를 못 쓴다고 본다. */
const READY_TIMEOUT_MS = 20_000;
/** 한 프레임을 그리고 찍는 데 허용하는 최대 시간(ms). */
const FRAME_TIMEOUT_MS = 15_000;

interface OffscreenSession {
  window: BrowserWindow;
  width: number;
  height: number;
}

let session: OffscreenSession | null = null;

/** 파일 경로는 호스트가 준다 — 앱이 코어의 디렉토리 구조를 알지 않게(§5.13 (P)). */
let mainHost: AppMainHost | null = null;
export function setMainHost(h: AppMainHost): void {
  mainHost = h;
}
function hostOrThrow(): AppMainHost {
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

export function probeOffscreen(): { available: boolean; reason?: string } {
  // BrowserWindow 를 만들 수 있으면 쓸 수 있다. 실제 실패는 open 에서 드러난다.
  return { available: true };
}

export async function openOffscreen(opts: {
  width: number;
  height: number;
  project: string;
  docId: string;
}): Promise<void> {
  await closeOffscreen();

  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    show: false,
    frame: false,
    backgroundColor: '#000000',
    // 창 크기와 픽셀 크기를 1:1 로 묶는다 — 배율이 끼면 찍힌 그림이 요청한 해상도와 어긋난다.
    useContentSize: true,
    webPreferences: {
      preload: hostOrThrow().preloadFile,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 보이지 않는 창은 브라우저가 타이머를 늦춘다 — 렌더가 기어가는 원인이라 끈다.
      backgroundThrottling: false,
      offscreen: false,
    },
  });

  const hash =
    `app=vibistudio&mode=render&project=${encodeURIComponent(opts.project)}&docId=${encodeURIComponent(opts.docId)}` +
    `&w=${opts.width}&h=${opts.height}`;
  await win.loadFile(hostOrThrow().rendererFile, { hash });

  // 렌더 화면이 문서를 받아 무대를 세울 때까지 기다린다.
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (win.isDestroyed()) throw new Error('렌더 창이 닫혔습니다.');
    const ready = (await win.webContents.executeJavaScript('window.__vibiRenderReady === true')) as boolean;
    if (ready) break;
    if (Date.now() > deadline) {
      const err = (await win.webContents.executeJavaScript(
        'window.__vibiRenderError ?? null',
      )) as string | null;
      win.destroy();
      throw new Error(err ?? '렌더 화면이 준비되지 않았습니다.');
    }
    await sleep(120);
  }

  session = { window: win, width: opts.width, height: opts.height };
}

export async function captureOffscreenAt(t: number): Promise<Buffer> {
  const current = session;
  if (!current || current.window.isDestroyed()) throw new Error('렌더 창이 열려 있지 않습니다.');

  await withTimeout(
    current.window.webContents.executeJavaScript(`window.__vibiRenderSeek(${JSON.stringify(t)})`),
    FRAME_TIMEOUT_MS,
    '프레임 준비',
  );

  const image = await withTimeout(
    current.window.webContents.capturePage({
      x: 0,
      y: 0,
      width: current.width,
      height: current.height,
    }),
    FRAME_TIMEOUT_MS,
    '화면 캡처',
  );

  return image.toPNG();
}

export async function closeOffscreen(): Promise<void> {
  const current = session;
  session = null;
  if (current && !current.window.isDestroyed()) current.window.destroy();
}
