import { app, BrowserWindow, shell } from 'electron';
import pkg from 'electron-updater';
import {
  UPDATE_CHECK_INTERVAL_MS,
  resolveUpdateDelivery,
  releasesPageUrl,
  type UpdateDelivery,
  type UpdateState,
} from '@vibisual/shared';
import { recordDiagnostic } from '@vibisual/server';

// 자동 업데이트 매니저 — SCENARIO.md §4 v2.44 (electron-updater + GitHub Releases).
//
// VS Code 우상단 파란 업데이트 버튼과 같은 모델 — 앱이 GitHub Releases 의 최신 빌드를
// 감지 → 자동 다운로드 → 재시작 시 적용. 업데이트 상태는 프로젝트 그래프 데이터가 아니라
// Electron *shell* 상태라 server 코어/GraphSnapshot 을 거치지 않고, §5.4 #14-1 별창
// (windowManager.broadcastList) 선례대로 전용 IPC 채널(`vibisual:update:status`)로 모든
// renderer 에 직접 푸시한다. invoke 핸들러(check/install/get-state)는 ipc.ts 가 등록한다.
//
// ⚠️ **전달 방식은 플랫폼마다 다르다** — 종전에는 전 플랫폼이 같은 경로를 탔으나,
// 무서명 macOS 는 Squirrel.Mac 이 서명 검증을 강제해 **다운로드까지 해놓고 적용 단계에서
// 반드시 실패**했다(사용자에게는 "업데이트 오류"만 남았다). 이제 `resolveUpdateDelivery`
// (shared, 플랫폼을 인자로 받는 순수 판정)로 갈라:
//   - `auto-install`(Windows·Linux·서명된 mac) : 종전 그대로 자동 다운로드 + 재시작 적용
//   - `notify-only`(무서명 mac)                 : 다운로드하지 않고 **알리기만** 하고,
//                                                 액션은 릴리스 페이지 열기로 대체
// 판정 근거와 승격 조건은 shared `updateDelivery.ts` 머리말에 있다.
//
// 중요 — `app.isPackaged === false`(=`electron-vite preview` = /runapp) 면 no-op.
// electron-updater 는 패키지 빌드에만 동봉되는 app-update.yml(electron-builder 의 publish
// 설정으로 베이킹)을 읽으므로 preview/개발 경로에선 동작하지 않는다. 실 설치본 전용.

// electron-updater 는 CJS default export 라 named import 가 불안정 — default 에서 꺼낸다.
const { autoUpdater } = pkg;

/**
 * 이 빌드의 macOS 바이너리에 Developer ID 서명 + 공증이 붙어 있는가.
 *
 * ⚠️ `packages/desktop/electron-builder.yml` 의 mac 섹션과 **짝**이다. 지금 그 파일에는
 * 서명 설정이 없으므로(인증서 슬롯 미배선) `false` 다. Apple Developer 인증서를 배선하는
 * 라운드에서 **이 상수도 함께 켜야** mac 이 `auto-install` 로 돌아온다. 한쪽만 바꾸면
 * 서명은 됐는데 여전히 알림형으로 남거나(이 상수만 false), 서명이 없는데 자동 설치를
 * 시도해 종전 오류가 재발한다(이 상수만 true).
 */
const MAC_CODE_SIGNED = false;

const delivery: UpdateDelivery = resolveUpdateDelivery({
  platform: process.platform,
  macCodeSigned: MAC_CODE_SIGNED,
});

let state: UpdateState = { phase: 'idle', currentVersion: '0.0.0', delivery };
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

/** 이 플랫폼의 업데이트 전달 방식. 테스트·진단용 접근자. */
export function getUpdateDelivery(): UpdateDelivery {
  return delivery;
}

/**
 * autoUpdater 이벤트 → UpdateState 정규화 + 주기 체크 타이머 기동.
 * app.whenReady 이후(윈도우 생성 후 근처)에서 1회 호출. 비패키지 경로면 즉시 반환.
 */
export function initAutoUpdater(): void {
  state = { phase: 'idle', currentVersion: app.getVersion(), delivery };

  if (!app.isPackaged) {
    console.log(
      '[updater] not packaged (electron-vite preview) — auto-update disabled. ' +
        'Auto-update runs only in the installed build (app-update.yml present).',
    );
    return;
  }
  if (initialized) return;
  initialized = true;

  const notifyOnly = delivery === 'notify-only';
  if (notifyOnly) {
    console.log(
      '[updater] notify-only mode (unsigned macOS) — new versions are announced but not ' +
        'downloaded. Squirrel.Mac requires a code signature to apply updates; the button ' +
        'opens the releases page instead.',
    );
  }

  // auto-install: 새 버전 발견 즉시 백그라운드 다운로드 + 종료 시 자동 적용(종전 동작).
  // notify-only : 둘 다 끈다 — 어차피 적용이 거부되므로 받아봐야 헛수고이고, 종료 시
  //               자동 설치를 켜두면 매 종료마다 실패를 반복한다.
  autoUpdater.autoDownload = !notifyOnly;
  autoUpdater.autoInstallOnAppQuit = !notifyOnly;

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
  // 이후 UPDATE_CHECK_INTERVAL_MS 주기로 반복 체크. notify-only 도 체크는 그대로 한다
  // (알리는 것이 이 모드의 전부이므로 체크를 끄면 아무것도 남지 않는다).
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

/**
 * 설치기를 아직 띄우지 않은 **예약** 상태인가. `before-quit` 정리 경로가 읽는다.
 *
 * ⚠️ **왜 예약이 필요한가 — 설치기를 먼저 띄우면 업데이트가 실패한다.**
 * `autoUpdater.quitAndInstall()` 은 NSIS 설치기를 **먼저 spawn 하고** 그 다음에 `app.quit()`
 * 을 건다. 그런데 electron-builder 의 업데이트용 언인스톨러는 설치 폴더의 파일을 하나씩
 * **rename 해서 들어내는** 방식이라(`un.atomicRMDir`), 그 시점에 `Vibisual.exe` 가 아직 살아
 * 있으면 첫 파일에서 막히고 → 1초 간격 5회 재시도 후 포기 → "Failed to uninstall old
 * application files" 대화상자 → `SetErrorLevel 2; Quit` 으로 **설치도 재기동도 하지 않는다.**
 * 사용자에게는 "눌렀는데 앱만 닫히고 그대로"로 보인다.
 *
 * 2026-08-27 실측(v0.1.12 → 0.1.13): 정리 시작 12:39:04 → 설치기 첫 rename 시도 12:39:11 →
 * **프로세스가 실제로 사라진 시각 12:40:12**. 우리 종료 정리가 68초 걸려 설치기는 한참 전에
 * 포기한 뒤였다. 그래서 이제 여기서는 **예약만** 하고, 실제 발사는 정리가 끝나 프로세스가
 * 죽기 직전(`runPendingUpdateInstall`)에 한다 — 설치기가 보는 앱은 이미 없다.
 */
let installPending = false;

/** `before-quit` 가 "이번 종료는 업데이트 설치용인가" 를 판정할 때 쓴다. */
export function isUpdateInstallPending(): boolean {
  return installPending;
}

/**
 * 예약된 설치기를 **지금** 띄운다. 종료 정리를 모두 마치고 `app.exit()` 직전에 한 번만 부른다.
 * 예약이 없으면 아무것도 하지 않고 `false`.
 *
 * spawn 은 동기(자식 pid 가 즉시 잡힌다) + `detached` 라 곧바로 프로세스를 내려도 살아남는다.
 * 다만 호출부는 spawn 직후 한 틱 정도 여유를 주고 나가는 편이 안전하다.
 */
export function runPendingUpdateInstall(): boolean {
  if (!installPending) return false;
  installPending = false;
  try {
    // isSilent=true — 마법사 없이 무인 설치(oneClick 인스톨러와 짝). isForceRunAfter=true — 설치 후 앱 재기동.
    autoUpdater.quitAndInstall(true, true);
    console.log('[updater] installer spawned after shutdown cleanup');
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[updater] quitAndInstall failed:', message);
    recordDiagnostic('main', 'warn', `auto-update: quitAndInstall failed: ${message}`);
    return false;
  }
}

/**
 * 업데이트 **적용 액션**. renderer 의 `api.update.install()`(IPC `vibisual:update:install`)이
 * 부른다. 전달 방식에 따라 하는 일이 다르다:
 *
 * - `auto-install` : 다운로드 완료 상태에서만 설치를 예약하고 종료를 건다(설치기 발사는
 *                    정리 후 `runPendingUpdateInstall`). 그 외에는 no-op.
 * - `notify-only`  : 설치할 수 없으므로 **릴리스 페이지를 기본 브라우저로 연다.**
 *                    새 버전을 아직 못 찾았으면(=알릴 게 없으면) 아무것도 하지 않는다.
 *
 * 반환값은 "액션을 실제로 수행했는가" — 채널 계약(boolean)은 종전과 같다.
 */
export function quitAndInstall(): boolean {
  if (!app.isPackaged) return false;

  if (delivery === 'notify-only') {
    if (state.phase !== 'available') return false;
    const url = releasesPageUrl(state.newVersion);
    void shell.openExternal(url).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[updater] openExternal failed:', message);
      recordDiagnostic('main', 'warn', `auto-update: open releases page failed: ${message}`);
    });
    return true;
  }

  if (state.phase !== 'downloaded') return false;
  installPending = true;
  // 평소 닫기와 **같은** 정리 경로를 탄다(체크포인트 flush·자식 회수). 설치기는 그 끝에서 뜬다.
  app.quit();
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
