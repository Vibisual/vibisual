import { promises as fs } from 'node:fs';
import { app, BrowserWindow } from 'electron';
import pkg from 'electron-updater';
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FEED_URL,
  UPDATE_FEED_PROBE_TIMEOUT_MS,
  resolveUpdateDelivery,
  resolveUpdateFeed,
  updateFeedFileName,
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

// 자동 업데이트 매니저 — SCENARIO.md §4 (electron-updater + GitHub Releases). 상태는 shell 상태라 server 코어를 안 거치고 `vibisual:update:status` 로 민다.
// 전달은 플랫폼마다 다르다(`resolveUpdateDelivery`): `auto-install`(Windows·Linux·서명 mac) = electron-updater, `self-install`(무서명 mac) = 우리가 받아 교체.
// 무서명 mac 에서 우리가 받고 적용하면 Squirrel 서명 검증도 Gatekeeper(`com.apple.quarantine`)도 안 돈다(근거: shared `updateDelivery.ts`).
// `app.isPackaged === false`(/runapp preview)면 no-op — app-update.yml 은 패키지 빌드에만 있다.

// electron-updater 는 CJS default export 라 named import 가 불안정 — default 에서 꺼낸다.
const { autoUpdater } = pkg;

/**
 * 이 빌드의 mac 바이너리에 Developer ID 서명 + 공증이 있는가. `electron-builder.yml` mac 서명 설정과 **짝**이다(지금 없음 → `false`).
 * 한쪽만 바꾸면 서명했어도 `auto-install` 로 안 돌아오거나, 서명 없이 자동 설치를 시도해 실패한다.
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
 * 업데이터 신호를 `reduceUpdateState` 한 곳에 통과시킨다 — 상태를 바꾸는 길은 이것 하나다(임의 `patchState` 는 규칙을 흩어 시험이 못 붙든다).
 * 이벤트마다 phase 를 찍으면 오프라인 주기 체크 실패가 `phase:'error'` 로 받아 둔 업데이트를 지워 `quitAndInstall` 이 거절한다.
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
 * 새 버전을 직접 받아 검사·임시 위치에 꺼낸다(`prepareSelfInstall`) — 성공하면 `phase:'downloaded'` 로 같은 버튼 흐름을 탄다.
 * 실패는 `errorCode` 로 화면에, 원문은 진단 로그에. 어느 실패에서도 설치는 시작되지 않는다(지금 버전 그대로).
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

  // 첫 체크는 창이 뜬 직후(~10s) 1회, 이후 UPDATE_CHECK_INTERVAL_MS 주기. self-install 도 체크는 같다 —
  // 같은 버전을 다시 물어와도 `preparing`·`staged.version` 이 재다운로드를 막는다.
  initialTimer = setTimeout(() => {
    void checkForUpdates();
  }, 10_000);
  // (피드 주소 결정은 `checkForUpdates` 가 첫 호출에서 한 번만 한다 — 아래 configureFeed.)
  checkTimer = setInterval(() => {
    void checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);
}

/**
 * 업데이트 피드를 우리 프록시로 돌린다 — GitHub 직접이면 `latest.yml` 다운로드 수뿐이라 1대인지 여럿인지 못 가린다(shared `updateFeed.ts`).
 * 깨지지 않는 것이 첫째: `UPDATE_FEED_URL` 이 비면 손대지 않고(`app-update.yml` 의 GitHub 그대로), 응답을 먼저 확인하며, `setFeedURL` 이 던져도 삼킨다.
 * 결정은 세션당 1회 — 도중에 프록시가 죽으면 그 세션만 실패하고 다음 실행에서 폴백한다.
 */
let feedConfigured: Promise<void> | null = null;

function configureFeed(): Promise<void> {
  if (!feedConfigured) feedConfigured = applyFeedUrl();
  return feedConfigured;
}

async function applyFeedUrl(): Promise<void> {
  const configured = UPDATE_FEED_URL;
  const override = process.env.VIBISUAL_UPDATE_FEED_URL;

  // 주소부터 본다 — 안 쓰기로 돼 있으면 네트워크를 건드릴 이유가 없다.
  const dry = resolveUpdateFeed({ configured, override });
  if (dry.kind === 'default') {
    if (dry.reason !== 'not-configured') {
      console.warn(`[updater] update feed ignored (${dry.reason}) — staying on GitHub`);
    }
    return;
  }

  const reachable = await probeFeed(dry.url);
  const choice = resolveUpdateFeed({ configured, override, reachable });
  if (choice.kind !== 'generic') {
    console.warn(`[updater] update feed unreachable — staying on GitHub (${dry.url})`);
    return;
  }

  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: choice.url });
    console.log(`[updater] update feed → ${choice.url}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[updater] setFeedURL failed — staying on GitHub:', message);
  }
}

/** 프록시가 이 플랫폼의 피드 파일을 실제로 내주는가. 실패·시간초과는 전부 `false`. */
async function probeFeed(base: string): Promise<boolean> {
  const url = `${base}/${updateFeedFileName(process.platform)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_FEED_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 업데이트 체크 트리거. 사용자가 버튼으로 수동 호출하거나 타이머가 자동 호출. */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!app.isPackaged) return state;
  await configureFeed();
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
 * 설치기를 아직 안 띄운 **예약** 상태인가(`before-quit` 이 읽는다). 먼저 띄우면 업데이트가 실패한다 — NSIS 언인스톨러는 파일을 rename 으로
 * 들어내(`un.atomicRMDir`) `Vibisual.exe` 가 살아 있으면 5회 재시도 뒤 포기한다(설치·재기동 없음). 2026-08-27 실측: 종료 정리 68초.
 * 그래서 예약만 하고 발사는 정리가 끝난 뒤(`runPendingUpdateInstall`).
 */
let installPending = false;

/** `before-quit` 가 "이번 종료는 업데이트 설치용인가" 를 판정할 때 쓴다. */
export function isUpdateInstallPending(): boolean {
  return installPending;
}

/**
 * 예약된 설치기를 지금 띄운다 — 종료 정리를 마친 `app.exit()` 직전에 한 번만(예약이 없으면 `false`). spawn 은 동기 + `detached` 라 곧바로
 * 내려도 살지만, 호출부는 한 틱쯤 여유를 둔다.
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
 * 업데이트 적용(`vibisual:update:install`). 반환 = 실제로 수행했는가. `auto-install` 은 다운로드 완료일 때만, `self-install` 은 꺼낸 번들이 있을 때만
 * 설치를 예약하고 종료를 건다(발사는 정리 뒤). self-install 준비 실패(`phase:'error'`)면 릴리스 페이지를 연다 — 복구 손잡이.
 */
export function quitAndInstall(): boolean {
  if (!app.isPackaged) return false;

  // self-install 이 막힌 상태에서 누른 것 — 손으로 받을 길이라도 열어 준다.
  if (delivery === 'self-install' && state.phase === 'error') {
    const url = releasesPageUrl(state.newVersion);
    // §3.7 — 열기가 실패하면 화면에도 안내를 띄운다(로그에만 남으면 버튼이 죽은 것처럼 보인다). 누른 창을 특정할 수 없어 sender 없이 전 창 broadcast.
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
