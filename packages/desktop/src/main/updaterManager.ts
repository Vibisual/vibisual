import { promises as fs } from 'node:fs';
import { app, BrowserWindow } from 'electron';
import pkg from 'electron-updater';
import {
  UPDATE_CHECK_INTERVAL_MS,
  resolveUpdateDelivery,
  releasesPageUrl,
  toProcessArch,
  reduceUpdateState,
  type UpdateDelivery,
  type UpdateEvent,
  type UpdateState,
} from '@vibisual/shared';
import { recordDiagnostic } from '@vibisual/server';
import { openExternalWithNotice } from './externalOpen';
import { prepareSelfInstall, runSwap, type StagedUpdate } from './macSelfInstall';

// 자동 업데이트 매니저 — SCENARIO.md §4 v2.44 (electron-updater + GitHub Releases).
//
// VS Code 우상단 파란 업데이트 버튼과 같은 모델 — 앱이 GitHub Releases 의 최신 빌드를
// 감지 → 자동 다운로드 → 재시작 시 적용. 업데이트 상태는 프로젝트 그래프 데이터가 아니라
// Electron *shell* 상태라 server 코어/GraphSnapshot 을 거치지 않고, §5.4 #14-1 별창
// (windowManager.broadcastList) 선례대로 전용 IPC 채널(`vibisual:update:status`)로 모든
// renderer 에 직접 푸시한다. invoke 핸들러(check/install/get-state)는 ipc.ts 가 등록한다.
//
// ⚠️ **전달 방식은 플랫폼마다 다르다.** `resolveUpdateDelivery`(shared, 플랫폼을 인자로 받는
// 순수 판정)로 갈라진다:
//   - `auto-install`(Windows·Linux·서명된 mac) : 종전 그대로 electron-updater 가 받고 적용
//   - `self-install`(무서명 mac)                : **우리가 직접 받아 직접 교체**(macSelfInstall.ts)
//
// 무서명 macOS 에서 Squirrel.Mac 이 서명 검증을 **강제**하는 것은 사실이지만, 그 검증은
// **Squirrel 의 적용 경로 안**에 있다 — 우리가 적용하면 그 코드가 아예 돌지 않는다. Gatekeeper
// 의 첫 실행 차단도 서명이 아니라 `com.apple.quarantine` **속성**이 발동시키고, 그 속성은
// **파일을 받은 프로그램이 붙인다**(브라우저는 붙이고 CLI·Node 는 안 붙인다). 그래서 받는 것도
// 적용하는 것도 우리가 하면 둘 다 발동하지 않는다. 종전 `notify-only`(알리고 릴리스 페이지 열기)
// 는 걷어냈다 — 사용자에게 업데이트마다 첫 설치를 통째로 반복시키는 방식이었다.
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

/**
 * 업데이터 신호를 **규칙 한 곳**(`reduceUpdateState`)에 통과시켜 상태로 바꾼다.
 *
 * ⚠️ 상태를 바꾸는 길은 이것 하나다. 종전의 `patchState({ phase: … })` 처럼 임의 패치를
 * 허용하면 규칙이 다시 호출부로 흩어지고, 흩어진 규칙은 테스트가 못 붙든다.
 *
 * 이벤트마다 `phase` 를 직접 찍던 것을 여기로 모은 이유: 주기 체크가
 * 이미 받아 둔 업데이트를 지우고 있었다. 오프라인에서 4시간짜리 체크가 실패하면
 * `phase:'error'` 가 되어 `quitAndInstall` 이 거절했고, 디스크에 멀쩡히 있는 설치본을 다음
 * 성공 체크까지 못 깔았다. 규칙을 순수 함수로 뽑으면 그 전이를 단위 테스트로 붙들 수 있다.
 */
function applyEvent(ev: UpdateEvent): void {
  state = reduceUpdateState(state, ev);
  broadcast();
}

export function getUpdateState(): UpdateState {
  return state;
}

/** 이 플랫폼의 업데이트 전달 방식. 테스트·진단용 접근자. */
export function getUpdateDelivery(): UpdateDelivery {
  return delivery;
}

// ── self-install 경로 ───────────────────────────────────────────────────────
/** 받아서 검사까지 끝내 놓은 새 번들. 교체는 종료 직전에 한다. */
let staged: StagedUpdate | null = null;
/** 같은 버전을 두 번 받지 않도록 — 주기 체크가 10분마다 같은 `update-available` 을 준다. */
let preparing = false;

/**
 * 새 버전을 우리 손으로 받아 검사하고 임시 위치에 꺼내 둔다(`macSelfInstall.prepareSelfInstall`).
 * 성공하면 `phase:'downloaded'` 로 올라가 종전과 **같은 버튼 흐름**을 탄다 — 사용자가
 * "재시작하여 업데이트" 를 누르면 v2.63 확인 모달을 거쳐 교체가 일어난다.
 *
 * 실패는 조용히 넘어가지 않는다. `errorCode` 로 사유를 실어 보내 화면이 제 나라 말로 말하게 하고,
 * 원문은 진단 로그에 남긴다. **어느 실패 경로에서도 설치는 시작되지 않으므로** 앱은 종전 버전
 * 그대로 산다.
 */
async function beginSelfInstall(version: string): Promise<void> {
  if (preparing) return;
  if (staged?.version === version) return; // 이미 받아 뒀다
  preparing = true;
  try {
    const arch = toProcessArch(process.arch);
    if (!arch) {
      applyEvent({
        kind: 'error',
        message: `unsupported architecture: ${process.arch}`,
        errorCode: 'arch-mismatch',
        at: Date.now(),
      });
      return;
    }

    applyEvent({ kind: 'download-started', version });
    const result = await prepareSelfInstall({
      version,
      arch,
      exePath: app.getPath('exe'),
      onProgress: (percent, bytesPerSecond) => {
        applyEvent({ kind: 'progress', percent, bytesPerSecond });
      },
    });

    if (!result.ok) {
      console.warn(`[updater] self-install prepare failed (${result.code}):`, result.message);
      recordDiagnostic('main', 'warn', `self-install ${result.code}: ${result.message}`);
      // ⚠️ 앞서 받아 둔 번들이 있으면 리듀서가 그 자리로 되돌린다 — 0.1.20 받기가 실패했다고
      //    이미 꺼내 둔 0.1.19 를 못 깔게 되면 그건 실패 두 개다.
      applyEvent({ kind: 'error', message: result.message, errorCode: result.code, at: Date.now() });
      return;
    }

    // 앞 버전을 꺼내 둔 작업 폴더는 여기서 지운다. 안 지우면 새 버전이 올라올 때마다 tmp 에
    // **통째로 꺼낸 .app 한 벌**(수백 MB)이 그대로 쌓인다 — 교체 스크립트는 자기 것만 지운다.
    const superseded = staged;
    staged = result.staged;
    if (superseded && superseded.workDir !== result.staged.workDir) {
      void fs.rm(superseded.workDir, { recursive: true, force: true })
        .then(() => console.log(`[updater] cleaned superseded staging ${superseded.version}`))
        .catch(() => undefined);
    }
    console.log(`[updater] self-install staged ${version} at ${staged.stagedAppPath}`);
    applyEvent({ kind: 'downloaded', version });
  } finally {
    preparing = false;
  }
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

  const selfInstall = delivery === 'self-install';
  if (selfInstall) {
    console.log(
      '[updater] self-install mode (unsigned macOS) — we download and swap the bundle ' +
        'ourselves. Squirrel.Mac is not used, so its mandatory signature check never runs, ' +
        'and files we download carry no com.apple.quarantine attribute.',
    );
  }

  // auto-install: 새 버전 발견 즉시 electron-updater 가 받고 종료 시 적용(종전 동작).
  // self-install: **둘 다 끈다** — Squirrel 이 받아 봐야 적용 단계에서 거부되고, 종료 시
  //               자동 설치를 켜 두면 매 종료마다 그 실패를 반복한다. 받는 일은 우리가 한다.
  autoUpdater.autoDownload = !selfInstall;
  autoUpdater.autoInstallOnAppQuit = !selfInstall;

  autoUpdater.on('checking-for-update', () => {
    applyEvent({ kind: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    applyEvent({
      kind: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    });
    // self-install 은 여기서부터 우리 경로다 — electron-updater 는 "새 버전이 있다"까지만 한다.
    if (selfInstall) void beginSelfInstall(info.version);
  });
  autoUpdater.on('update-not-available', () => {
    applyEvent({ kind: 'not-available', at: Date.now() });
  });
  autoUpdater.on('download-progress', (p) => {
    applyEvent({
      kind: 'progress',
      percent: Math.round(p.percent),
      bytesPerSecond: Math.round(p.bytesPerSecond),
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    applyEvent({ kind: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[updater] error:', message);
    recordDiagnostic('main', 'warn', `auto-update: ${message}`, err instanceof Error ? err.stack : undefined);
    // ⚠️ 받아 둔 것이 있으면 리듀서가 `downloaded` 로 되돌린다 — 오프라인 체크 한 번이
    //    이미 받아 둔 설치본을 못 쓰게 만들던 자리다. 실패 자체는 위 진단 로그에 남는다.
    applyEvent({ kind: 'error', message, at: Date.now() });
  });

  // 첫 체크는 윈도우가 뜬 직후(~10s)에 1회 — 부팅 직후 새 버전을 빨리 알린다.
  // 이후 UPDATE_CHECK_INTERVAL_MS 주기로 반복 체크. self-install 도 체크 경로는 **같다** —
  // 갈리는 것은 `update-available` 이후(누가 받는가)뿐이고, 주기 체크가 같은 버전을 다시
  // 물어와도 `beginSelfInstall` 의 `preparing`·`staged.version` 가 재다운로드를 막는다.
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
    // 주기 체크가 오프라인에서 던지는 자리다 — 받아 둔 것이 있으면 리듀서가 지키고,
    // 없을 때만 화면이 실패를 말한다.
    applyEvent({ kind: 'error', message, at: Date.now() });
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

  // self-install — Squirrel 대신 우리 교체 셸을 띄운다. 구조는 Windows 와 같다:
  // 여기서 **분리된 자식만 띄우고** 우리는 곧장 사라진다. 자식이 우리 pid 의 소멸을 기다렸다가
  // 번들을 바꾼다(살아 있는 자기 자신을 덮어쓰지 않기 위해).
  if (delivery === 'self-install') {
    if (!staged) return false;
    const ok = runSwap(staged, process.pid);
    console.log(
      ok
        ? `[updater] self-install swap spawned for ${staged.version}`
        : '[updater] self-install swap spawn failed',
    );
    if (!ok) recordDiagnostic('main', 'warn', 'self-install: swap spawn failed');
    staged = null;
    return ok;
  }

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
 * - `self-install` : 우리가 꺼내 둔 번들이 있을 때만 같은 방식으로 예약한다(교체는 정리 후).
 *                    준비가 실패해 `phase:'error'` 인 상태에서는 **릴리스 페이지를 연다** —
 *                    전달 방식이 아니라 막혔을 때의 **복구 손잡이**다.
 *
 * 반환값은 "액션을 실제로 수행했는가" — 채널 계약(boolean)은 종전과 같다.
 */
export function quitAndInstall(): boolean {
  if (!app.isPackaged) return false;

  // self-install 이 막힌 상태에서 누른 것 — 손으로 받을 길이라도 열어 준다.
  if (delivery === 'self-install' && state.phase === 'error') {
    const url = releasesPageUrl(state.newVersion);
    // §3.7 — 열기가 실패하면 화면에도 안내가 뜬다(종전에는 로그에만 남아 버튼이 죽은 것처럼 보였다).
    // 누른 창을 특정할 수 없는 자리라 sender 를 주지 않는다 → 전 창 broadcast.
    openExternalWithNotice(url, null, ({ reason }) => {
      recordDiagnostic('main', 'warn', `auto-update: open releases page failed (${reason}): ${url}`);
    });
    return true;
  }

  // 설치의 근거는 **`readyVersion`** 이다 — "지금 누르면 깔리는 그 버전". `phase` 만 보면
  // 주기 체크가 잠시 지나가는 사이에 눌린 클릭이 거절되고, 반대로 화면이 말한 버전과 실제로
  // 깔리는 것이 어긋날 수 있다.
  if (state.phase !== 'downloaded' || !state.readyVersion) return false;
  // mac 은 우리가 꺼내 둔 번들을 바꾼다 — 화면이 약속한 버전과 **같은 것**일 때만 간다.
  // (0.1.19 를 꺼내 둔 채 0.1.20 을 받다 실패하면 둘이 어긋날 수 있는 자리다.)
  if (delivery === 'self-install' && staged?.version !== state.readyVersion) return false;
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
