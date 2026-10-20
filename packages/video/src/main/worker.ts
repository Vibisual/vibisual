/**
 * §5.13 (T-4) — 창 없는 렌더 일꾼: **보이지 않는 창 하나**.
 *
 * 종전에는 스틸·렌더 일감을 집어 가는 쪽이 스튜디오 창뿐이라, 창이 닫혀 있으면 에이전트의 스틸 요청이 30초 뒤 504 로
 * 끝났다(에이전트가 자기 결과를 볼 길이 사라진다). 이제 서버 몫이 일감을 받으면 `worker:ensure` 로 이 창을 깨우고, 창은
 * 일감 두 줄(스틸·렌더)을 집어 처리한다(`VideoWorkerShell`). 스튜디오는 일감을 걸고 지켜보기만 한다.
 *
 * - **안 쓰면 0** — 일감을 한 번도 걸지 않은 사용자에게는 창도 코드 로드도 없다. 일감이 끊기면 창이 스스로 닫아 달라고
 *   한다(`worker:idle` — `WORKER_IDLE_MS`).
 * - **본체가 닫히면 함께 닫힌다** — 앱 main 몫 `dispose()` 가 부른다(숨은 창이 남아 앱이 안 꺼지는 일을 막는다).
 * - §3.7 과의 관계: 자식 프로세스 spawn 이 아니라 우리 앱 안의 BrowserWindow 다(별창·지휘통제실과 같은 성질).
 */
import { BrowserWindow } from 'electron';

import { hostOrThrow } from './offscreen.js';

let worker: BrowserWindow | null = null;
let opening: Promise<void> | null = null;

/** 일꾼 창이 떠 있게 한다. 이미 떠 있거나 뜨는 중이면 그것을 기다린다(두 벌 뜨지 않게). */
export async function ensureWorker(): Promise<{ started: boolean }> {
  if (worker && !worker.isDestroyed()) return { started: false };
  if (opening) {
    await opening;
    return { started: false };
  }
  const host = hostOrThrow();
  const win = new BrowserWindow({
    width: 480,
    height: 320,
    show: false,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      preload: host.preloadFile,
      // §5.13 (Y) 40-7 ⑤ — 꼭 필요해서가 아니다: 이 preload 는 샌드박스 창에서도 실린다(Electron 31.7.7 probe — `window.api`·`request`·
      //   `app.invoke` 그대로). 모든 창과 같은 설정을 지킬 뿐이고, 샌드박스 전환은 창 전체를 함께 바꾸는 결정이다(사용자 확인 — P3 ⑥).
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 보이지 않는 창은 브라우저가 타이머를 늦춘다 — 일감 줄을 도는 시계가 기어가지 않게 끈다.
      backgroundThrottling: false,
    },
  });
  worker = win;
  win.on('closed', () => {
    if (worker === win) worker = null;
  });
  opening = win
    .loadFile(host.rendererFile, { hash: 'app=vibistudio&mode=worker' })
    .catch((err: unknown) => {
      if (!win.isDestroyed()) win.destroy();
      if (worker === win) worker = null;
      throw err;
    })
    .finally(() => {
      opening = null;
    });
  await opening;
  return { started: true };
}

/** 일꾼 창을 닫는다(일감이 끊겼을 때·본체가 닫힐 때). 없으면 아무 일 없음. */
export function closeWorker(): void {
  const win = worker;
  worker = null;
  if (win && !win.isDestroyed()) win.destroy();
}
