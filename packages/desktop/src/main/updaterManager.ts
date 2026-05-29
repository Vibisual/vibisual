import { app, BrowserWindow } from 'electron';
import pkg from 'electron-updater';
import { UPDATE_CHECK_INTERVAL_MS, type UpdateState } from '@vibisual/shared';
import { recordDiagnostic } from '@vibisual/server';

// 자동 업데이트 매니저 — SCENARIO.md §4 v2.44 (electron-updater + GitHub Releases).
//
// VS Code 우상단 파란 업데이트 버튼과 같은 모델 — 앱이 GitHub Releases 의 최신 빌드를
// 감지 → 자동 다운로드 → 재시작 시 적용. 업데이트 상태는 프로젝트 그래프 데이터가 아니라
// Electron *shell* 상태라 server 코어/GraphSnapshot 을 거치지 않고, §5.4 #14-1 별창
// (windowManager.broadcastList) 선례대로 전용 IPC 채널(`vibisual:update:status`)로 모든
// renderer 에 직접 푸시한다. invoke 핸들러(check/install/get-state)는 ipc.ts 가 등록한다.
//
// 중요 — `app.isPackaged === false`(=`electron-vite preview` = /runapp) 면 no-op.
// electron-updater 는 패키지 빌드에만 동봉되는 app-update.yml(electron-builder 의 publish
// 설정으로 베이킹)을 읽으므로 preview/개발 경로에선 동작하지 않는다. 실 NSIS 설치본 전용.

// electron-updater 는 CJS default export 라 named import 가 불안정 — default 에서 꺼낸다.
const { autoUpdater } = pkg;

let state: UpdateState = { phase: 'idle', currentVersion: '0.0.0' };
let checkTimer: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;
let initialized = false;

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('vibisual:update:status', state);
  }
}

function patchState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  broadcast();
}

export function getUpdateState(): UpdateState {
  return state;
}

/**
 * autoUpdater 이벤트 → UpdateState 정규화 + 주기 체크 타이머 기동.
 * app.whenReady 이후(윈도우 생성 후 근처)에서 1회 호출. 비패키지 경로면 즉시 반환.
 */
export function initAutoUpdater(): void {
  state = { phase: 'idle', currentVersion: app.getVersion() };

  if (!app.isPackaged) {
    console.log(
      '[updater] not packaged (electron-vite preview) — auto-update disabled. ' +
        'Auto-update runs only in the installed NSIS build (app-update.yml present).',
    );
    return;
  }
  if (initialized) return;
  initialized = true;

  // autoDownload=true — 새 버전 발견 즉시 백그라운드 다운로드(사용자 요청: "자동으로 받아서").
  // autoInstallOnAppQuit=true — 다운로드된 업데이트는 앱 종료 시 자동 적용(재시작 버튼 미클릭 시에도).
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    patchState({ phase: 'checking', error: undefined });
  });
  autoUpdater.on('update-available', (info) => {
    patchState({
      phase: 'available',
      newVersion: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      error: undefined,
    });
  });
  autoUpdater.on('update-not-available', () => {
    patchState({ phase: 'up-to-date', newVersion: undefined, checkedAt: Date.now(), error: undefined });
  });
  autoUpdater.on('download-progress', (p) => {
    patchState({
      phase: 'downloading',
      percent: Math.round(p.percent),
      bytesPerSecond: Math.round(p.bytesPerSecond),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    patchState({ phase: 'downloaded', newVersion: info.version, percent: 100, error: undefined });
  });
  autoUpdater.on('error', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[updater] error:', message);
    recordDiagnostic('main', 'warn', `auto-update: ${message}`, err instanceof Error ? err.stack : undefined);
    patchState({ phase: 'error', error: message, checkedAt: Date.now() });
  });

  // 첫 체크는 윈도우가 뜬 직후(~10s)에 1회 — 부팅 직후 새 버전을 빨리 알린다.
  // 이후 UPDATE_CHECK_INTERVAL_MS 주기로 반복 체크.
  initialTimer = setTimeout(() => {
    void checkForUpdates();
  }, 10_000);
  checkTimer = setInterval(() => {
    void checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);
}

/** 업데이트 체크 트리거. 사용자가 버튼으로 수동 호출하거나 타이머가 자동 호출. */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[updater] checkForUpdates failed:', message);
    patchState({ phase: 'error', error: message, checkedAt: Date.now() });
  }
  return state;
}

/** 다운로드 완료 상태에서만 재시작+설치. 그 외에는 no-op. */
export function quitAndInstall(): boolean {
  if (!app.isPackaged) return false;
  if (state.phase !== 'downloaded') return false;
  // isSilent=true — 마법사 없이 무인 설치(oneClick 인스톨러와 짝). isForceRunAfter=true — 설치 후 앱 재기동.
  autoUpdater.quitAndInstall(true, true);
  return true;
}

/** before-quit 정리 — 타이머 해제. */
export function stopAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
}
