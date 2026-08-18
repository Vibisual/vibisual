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
import type { IpcMain } from 'electron';

import { closeAppWindow, openAppWindow, type AppWindowSpec } from '../windowManager';

/** 앱의 main 프로세스 몫이 갖춰야 할 모양. 앱은 코어 타입을 import 하지 않는다. */
interface MainAppModule {
  id: string;
  /** 파일 경로 등 호스트만 아는 값을 건네받는다(§5.13 (P) 도킹 계약). */
  attach: (host: { rendererFile: string; preloadFile: string }) => void;
  window: (params: Record<string, string>) => AppWindowSpec;
  invoke?: (action: string, payload: unknown) => Promise<unknown>;
}

interface MainAppEntry {
  readonly id: string;
  /** **호출 전까지 로드되지 않는다.** */
  readonly load: () => Promise<{ vibistudioApp: MainAppModule }>;
}

const MAIN_APPS: readonly MainAppEntry[] = [
  { id: 'vibistudio', load: () => import('@vibisual/video/main') },
];

const attached = new Map<string, MainAppModule>();

/** 이 앱의 모듈을 얻는다. 처음 부를 때만 실제로 불러오고 호스트를 붙인다. */
async function moduleFor(appId: unknown): Promise<MainAppModule | null> {
  if (typeof appId !== 'string') return null;
  const cached = attached.get(appId);
  if (cached) return cached;

  const entry = MAIN_APPS.find((a) => a.id === appId);
  if (!entry) return null;

  const mod = (await entry.load()).vibistudioApp;
  mod.attach({
    rendererFile: join(__dirname, '../renderer/index.html'),
    preloadFile: join(__dirname, '../preload/index.cjs'),
  });
  attached.set(appId, mod);
  return mod;
}

export function mountAppIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    'vibisual:app:open',
    async (_e, payload: { appId: string; params?: Record<string, string> }): Promise<{ windowId: number; reused: boolean }> => {
      const mod = await moduleFor(payload?.appId);
      if (!mod) throw new Error(`vibisual:app:open — 알 수 없는 앱: ${String(payload?.appId)}`);
      return openAppWindow(mod.id, mod.window(payload.params ?? {}));
    },
  );

  ipcMain.handle('vibisual:app:close', (_e, payload: { appId: string }): boolean => {
    // 닫기는 모듈을 부를 필요가 없다 — 창 관리자만 알면 된다(안 깐 앱을 로드시키지 않는다).
    return typeof payload?.appId === 'string' ? closeAppWindow(payload.appId) : false;
  });

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
  ipcMain.removeHandler('vibisual:app:open');
  ipcMain.removeHandler('vibisual:app:close');
  ipcMain.removeHandler('vibisual:app:invoke');
}

/** 앱 창을 전부 닫는다(앱 종료 경로). 로드되지 않은 앱은 창도 없으므로 건드릴 것이 없다. */
export function closeAllAppWindows(): void {
  for (const entry of MAIN_APPS) closeAppWindow(entry.id);
}
