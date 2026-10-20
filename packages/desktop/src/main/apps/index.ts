/**
 * §5.13 (P) v4.49 — 내부 앱의 main 프로세스 자리.
 *
 * **코어(`ipc.ts`)가 아는 것은 `mountAppIpc(ipcMain)` 한 줄뿐이다.**
 *
 * 그리고 **안 쓰는 앱은 코드조차 로드하지 않는다** — 여기서는 경로만 알고 있다가 그 앱을
 * 실제로 부를 때 늦게 불러온다. 앱 모듈을 위에서 `import` 하면 앱이 늘어날수록 main
 * 번들이 그만큼 커지고, 그건 이 기능을 안 쓰는 사용자가 내는 비용이 된다.
 *
 * 채널은 셋으로 고정이다 — `open` / `close` / `invoke`. 앱이 늘어도 이 셋은 그대로이고,
 * 늘어나는 것은 아래 배열의 한 줄이다.
 */
import { join } from 'node:path';
import { BrowserWindow, type IpcMain } from 'electron';

import {
  ackAppWindowRedock, ackAppWindowTarget, closeAppWindow, endAppWindowDrag, focusAppWindow, listAppWindows, openAppWindow,
  redockAppWindow, startAppWindowDrag, updateAppWindowTarget, type AppWindowSpec,
  hideAppWindow, setAppWindowCloseRetention,
} from '../windowManager';
import type { AppWindowListItem, AppWindowPlacement } from '../appWindowTransfer';
import { simpleAppWindowHash } from '../appWindowHash';

/** 앱의 main 프로세스 몫이 갖춰야 할 모양. 앱은 코어 타입을 import 하지 않는다. */
interface MainAppModule {
  id: string;
  /** 파일 경로 등 호스트만 아는 값을 건네받는다(§5.13 (P) 도킹 계약). */
  attach: (host: { rendererFile: string; preloadFile: string }) => void;
  window: (params: Record<string, string>) => AppWindowSpec;
  invoke?: (action: string, payload: unknown) => Promise<unknown>;
  /**
   * §5.13 (T-11) ④ — 본체 창이 닫힐 때 앱이 띄운 **숨은 창**(일꾼·오프스크린)을 정리한다. 숨은 창이 살아 있으면
   * Windows·Linux 에서 `window-all-closed` 가 오지 않아 앱이 보이지 않게 남는다(별창·오버레이와 같은 이유).
   */
  dispose?: () => void;
}

interface MainAppEntry {
  readonly id: string;
  /** main 프로세스 몫이 있는 앱만. **호출 전까지 로드되지 않는다.** */
  readonly load?: () => Promise<{ vibistudioApp: MainAppModule }>;
  /**
   * main 몫이 **없는** 앱(창만 있는 앱)의 창 규격.
   *
   * 화면이 렌더러에만 있는 앱까지 main 모듈 파일을 만들게 하면, 실제로 하는 일이 "창 크기 네 줄"
   * 뿐인 파일이 앱 수만큼 생긴다. 그런 앱은 여기 한 줄로 끝낸다 — 코어가 앱 코드를 부르지 않는다는
   * 성질은 그대로다(부를 모듈 자체가 없다).
   */
  readonly window?: (params: Record<string, string>) => AppWindowSpec;
}

const MAIN_APPS: readonly MainAppEntry[] = [
  { id: 'vibistudio', load: () => import('@vibisual/video/main') },
  {
    id: 'vibisound',
    window: (params) => ({
      title: 'Vibisual — Vibisound',
      width: 1020,
      height: 660,
      minWidth: 720,
      minHeight: 440,
      hash: simpleAppWindowHash('vibisound', params),
    }),
  },
  {
    id: 'vibi3d',
    window: (params) => ({
      title: 'Vibisual — Vibi3D',
      width: 1120,
      height: 780,
      minWidth: 720,
      minHeight: 520,
      hash: simpleAppWindowHash('vibi3d', params),
    }),
  },
  {
    // §5.13 (R-9) — 이미지. 화면이 렌더러에만 있는 앱이라 창 규격 한 줄이다(main 몫 없음).
    id: 'vibimage',
    window: (params) => ({
      title: 'Vibisual — Vibimage',
      width: 960,
      height: 680,
      minWidth: 480,
      minHeight: 360,
      hash: simpleAppWindowHash('vibimage', params),
    }),
  },
];

const attached = new Map<string, MainAppModule>();

/** 이 앱의 모듈을 얻는다. 처음 부를 때만 실제로 불러오고 호스트를 붙인다. */
async function moduleFor(appId: unknown): Promise<MainAppModule | null> {
  if (typeof appId !== 'string') return null;
  const cached = attached.get(appId);
  if (cached) return cached;

  const entry = MAIN_APPS.find((a) => a.id === appId);
  if (!entry) return null;

  // 창만 있는 앱 — 부를 모듈이 없으므로 여기서 그 자리에 맞는 모양을 세워 준다.
  if (!entry.load) {
    const windowFn = entry.window;
    if (!windowFn) return null;
    const simple: MainAppModule = { id: entry.id, attach: () => undefined, window: windowFn };
    attached.set(appId, simple);
    return simple;
  }

  const mod = (await entry.load()).vibistudioApp;
  mod.attach({
    rendererFile: join(__dirname, '../renderer/index.html'),
    preloadFile: join(__dirname, '../preload/index.cjs'),
  });
  attached.set(appId, mod);
  return mod;
}

export function mountAppIpc(ipcMain: IpcMain): void {
  ipcMain.handle('vibisual:app:hide-self', (event): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return !!win && hideAppWindow(win.id);
  });
  ipcMain.handle('vibisual:app:close-retention', (event, retained: unknown): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return !!win && typeof retained === 'boolean' && setAppWindowCloseRetention(win.id, retained);
  });
  ipcMain.handle(
    'vibisual:app:open',
    async (event, payload: { appId: string; params?: Record<string, string>; placement?: AppWindowPlacement }): Promise<{ windowId: number; reused: boolean }> => {
      const mod = await moduleFor(payload?.appId);
      if (!mod) throw new Error(`vibisual:app:open — 알 수 없는 앱: ${String(payload?.appId)}`);
      const params = appParams(payload.params);
      return openAppWindow(mod.id, mod.window(params), {
        params, origin: BrowserWindow.fromWebContents(event.sender),
        ...(payload.placement ? { placement: payload.placement } : {}),
      });
    },
  );

  ipcMain.handle('vibisual:app:update-target', (event, params: unknown): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return !!win && updateAppWindowTarget(win.id, appParams(params));
  });
  ipcMain.handle('vibisual:app:drag-start', (event): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return !!win && startAppWindowDrag(win.id);
  });
  ipcMain.handle('vibisual:app:drag-end', (event, payload?: { commit?: boolean; appId?: string }): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return !!win && endAppWindowDrag(win.id, payload?.commit !== false,
      typeof payload?.appId === 'string' ? payload.appId : undefined);
  });
  ipcMain.handle('vibisual:app:redock', (event): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return !!win && redockAppWindow(win.id);
  });
  ipcMain.handle('vibisual:app:redock-ack', (event, requestId: unknown): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return !!win && typeof requestId === 'string' && ackAppWindowRedock(win.id, requestId);
  });
  ipcMain.handle('vibisual:app:target-ack', (event, payload?: { requestId?: unknown; accepted?: unknown }): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return !!win && typeof payload?.requestId === 'string'
      && ackAppWindowTarget(win.id, payload.requestId, payload.accepted === true);
  });

  ipcMain.handle('vibisual:app:close', (_e, payload: { appId: string }): boolean => {
    // 닫기는 모듈을 부를 필요가 없다 — 창 관리자만 알면 된다(안 깐 앱을 로드시키지 않는다).
    return typeof payload?.appId === 'string' ? closeAppWindow(payload.appId) : false;
  });

  // §5.13 (S-11) 밖에 떠 있는 앱 창 목록 — 처음 한 번 묻는 길(바뀔 때는 `vibisual:app:list` 로 밀어 준다).
  ipcMain.handle('vibisual:app:list', (): AppWindowListItem[] => listAppWindows());
  // §5.13 (S-11) 본체가 이미 밖에 떠 있는 문서를 다시 열었다 — 새로 열지 않고 그 창을 앞으로 세운다(모듈을 부르지 않는다).
  ipcMain.handle('vibisual:app:focus', async (_e, payload?: { appId?: unknown; windowId?: unknown }): Promise<boolean> => (
    typeof payload?.appId === 'string'
      ? focusAppWindow(payload.appId, typeof payload.windowId === 'number' ? payload.windowId : undefined)
      : false
  ));

  ipcMain.handle(
    'vibisual:app:invoke',
    async (_e, payload: { appId: string; action: string; payload?: unknown }): Promise<unknown> => {
      const mod = await moduleFor(payload?.appId);
      if (!mod?.invoke) throw new Error(`vibisual:app:invoke — 지원하지 않는 앱: ${String(payload?.appId)}`);
      return mod.invoke(payload.action, payload.payload);
    },
  );
}

export function removeAppIpc(ipcMain: IpcMain): void {
  ipcMain.removeHandler('vibisual:app:hide-self');
  ipcMain.removeHandler('vibisual:app:close-retention');
  ipcMain.removeHandler('vibisual:app:open');
  ipcMain.removeHandler('vibisual:app:close');
  ipcMain.removeHandler('vibisual:app:invoke');
  ipcMain.removeHandler('vibisual:app:update-target');
  ipcMain.removeHandler('vibisual:app:drag-start');
  ipcMain.removeHandler('vibisual:app:drag-end');
  ipcMain.removeHandler('vibisual:app:redock');
  ipcMain.removeHandler('vibisual:app:redock-ack');
  ipcMain.removeHandler('vibisual:app:target-ack');
  ipcMain.removeHandler('vibisual:app:list');
  ipcMain.removeHandler('vibisual:app:focus');
}

/** The transport carries strings; ignore unexpected object values rather than stringify them. */
function appParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** 앱 창을 전부 닫는다(앱 종료 경로). 로드되지 않은 앱은 창도 없으므로 건드릴 것이 없다. */
export function closeAllAppWindows(): void {
  for (const entry of MAIN_APPS) closeAppWindow(entry.id);
}

/**
 * §5.13 (T-11) ① — 서버 몫이 같은 앱의 main 몫을 부르는 길(`setAppMainInvoker` 로 서버 코어에 꽂힌다).
 * 렌더러의 `vibisual:app:invoke` 와 **같은 모듈·같은 `invoke`** 를 탄다 — 두 길이 갈리지 않게.
 */
export async function invokeAppMain(appId: string, action: string, payload: unknown): Promise<unknown> {
  const mod = await moduleFor(appId);
  if (!mod?.invoke) throw new Error(`app main invoke — unsupported app: ${appId}`);
  return mod.invoke(action, payload);
}

/** §5.13 (T-11) ④ — 붙어 있는 앱 main 몫의 숨은 창을 정리한다(본체 창이 닫힐 때). 로드되지 않은 앱은 띄운 것도 없다. */
export function disposeAppMains(): void {
  for (const mod of attached.values()) {
    try {
      mod.dispose?.();
    } catch (err) {
      console.warn('[apps] dispose failed:', err);
    }
  }
}
