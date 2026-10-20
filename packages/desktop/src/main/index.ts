import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, type Server as HttpServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { app, shell, BrowserWindow, protocol, Notification, session } from 'electron';
import { hasAppMessageBox, showAppMessageBox } from './appMessageBox';
import { createQuitConfirmationGate } from './quitConfirmation';
import { optimizer } from '@electron-toolkit/utils';
import { inject, type DispatchFunc } from 'light-my-request';
import type { Express } from 'express';
import { followOuterDisconnect, isHoldPath, type InjectDispatch } from './injectDisconnect';
import { isVerificationToolIngress } from './verificationToolIngress';
import { releaseStartupJobs, unloadAllLocalModels, runServer, resolveAppMediaFile, shutdownDiskWriteQueue, flushPendingStreamWrites, flushPendingCheckpointSave, setBroadcastSink, setHookListenerPort, setHookListenerToken, setHookListenerIdentityFile, setHookHandlerPath, setEngineBridgeSourceDir, setCodexHookContext, setDebugLogDir, ensureHooksInstalledEverywhere, refreshStatusLineIfInstalled, recordDiagnostic, subAgentManager, stopAllPlays, closeStaticHost, setCmdTerminalController, setCmdBlockedNotifier, setWorkspaceTrash, setMicSettingsOpener, getUiLocale } from '@vibisual/server';
import { IFRAME_PROXY_PATH, WORKSPACE_SITE_PATH, LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE, appIdOfMediaPath, isAppContentPath, isAppMediaPath } from '@vibisual/shared';
import { setupIpc, type IpcHub } from './ipc';
import { startBackendBeforeWindow } from './backendStartup';
import { ensureDesktopConsent, focusConsentWindow, closeConsentWindow } from './consentWindow';
// §3.7 · §9 「창이 뜬 직후의 메인 스레드」 ④ — 메인 스레드 멈춤을 늘 기록한다(userData/logs/main-stall.log).
//   시계는 시작 진입점(`bootstrap.ts`)이 본체를 읽기 **전에** 건다 — 여기서는 기준점과 시작 이정표만 찍는다.
import { logStartupMilestone, logTransfer, markMainWindowShown } from './mainStallLog';
import { appMediaResponse } from './appMediaResponse';
// §3.7 · §9 「시작 화면(스플래시)」 — 스플래시가 앞을 지키는 동안 본체 창은 숨긴 채 그리고, 준비가 끝나면 보인다.
import { pendingStartupJobCount, setBootProgressSink, subscribeAppThemeChrome, atomicWriteFileSync } from '@vibisual/server';
import type { SplashHandle } from './splashWindow';
import { startMainReveal, type MainRevealController } from './mainReveal';
import { coverFirstShow } from './windowCloak';
import { writeSplashCache } from './splashCache';
import { makeSplashCache } from './splashPolicy';
import { retireBootErrorLog } from './bootErrors';
// §4 앱 테마 — 창 바탕·제목줄 단추 색(렌더러가 못 칠하는 두 곳).
import { installAppThemeChromeSync, safeAppThemeChrome, trackThemedWindow } from './themeChrome';
// §9 — 스냅샷 팬아웃(1회 인코딩 → 창마다 바이트 postMessage, 실패 시 종전 send 폴백).
import { broadcastToWindows, initWsFanout } from './wsFanout';
import { loadSecrets } from './secrets';
import { loadHookIdentity, saveHookIdentity, hookIdentityPath } from './hookIdentity';
import { configureWindowManager, closeAll as closeAllDetachedWindows, closeAllOverlays, closeAllCommandCenters, raiseExpandedOverlaysForMainFocus } from './windowManager';
import { initMobileAccess, mobileBroadcast, stopMobileAccess } from './mobileAccess';
// §4 메신저 원격제어 브리지 — 아웃바운드 전용(우리는 포트를 열지 않는다). 기본 OFF.
import { chatBroadcast, initChatBridge, stopChatBridge } from './chat';
import { initAutoUpdater, stopAutoUpdater, isUpdateInstallPending, runPendingUpdateInstall } from './updaterManager';
import { openExternalWithNotice } from './externalOpen';
import { killAllTerminals, terminalController, setTerminalCardIdentity } from './terminalManager';
import { appendCrashLine, logCleanExit } from './crashLog';
import { installWindowCrashRecovery } from './windowCrashRecovery';
import { createMainDiagnostics } from './mainDiagnostics';
import { LoopbackBodyBudget, readLoopbackBody } from './loopbackBody';
import { forwardLoopbackResponse } from './loopbackResponse';
// §3.2.1 — 종료 직전 렌더러가 아직 안 저장한 손글씨(세션 입력·IDE 폼 초안·명령 히스토리)를 받아 낸다.
import { flushRendererDrafts, releaseRendererDrafts } from './rendererFlush';
import { waitForDurableDrafts } from './durableShutdown';
import { mainStrings, fmt } from './strings';
import { setVerificationAutomationAdapter, setAppMainInvoker } from '@vibisual/server';
import { setProcessContainmentBackend } from '@vibisual/server';
import { createWindowsJobBackend } from './winJobObject.js';
import { verificationAutomationAdapter, closeAllVerificationTargets } from './verificationAutomation';
// §5.13 (T-11) — 내부 앱 공통 층의 앱 이름 없는 접점: 서버 몫 → main 몫 호출 · 숨은 창 정리 · 콘텐츠 프레임 이동 금지.
import { disposeAppMains, invokeAppMain } from './apps';
import { guardAppContentFrames } from './appContentGuard';

// Vibisual desktop main — SCENARIO.md §3.7 (in-process 통합, 단일 프로세스).
//
// server 코어를 child 프로세스로 spawn 하지 않고 이 main 프로세스 안에서 직접 구동한다
// (`runServer()`). renderer↔server 는 Electron IPC 직결(ipc.ts) —
// localhost HTTP/WS 브리지 없음.
//
// 단 하나의 예외: Claude Code hook 과 커스텀 위임 엣지 dispatch 는 claude CLI 가 spawn 하는
// 외부 프로세스라 in-process 흡수(IPC)가 불가능하다. 그래서 main 은 127.0.0.1 loopback
// HTTP 리스너 하나를 띄워 /api/hook-event·/api/task-edges/dispatch·/health 만 받는다
// (renderer 브리지가 아니라 외부 claude 프로세스 ingress 전용 — §3.7 v2.8).
//
// §3.7 · §9 「시작 화면(스플래시)」 — **이 파일은 더 이상 빌드의 입구가 아니다.** 입구는 `bootstrap.ts` 이고, 그것이
// 화면 가운데에 스플래시를 먼저 띄운 뒤 `ready` 가 지나서 이 모듈을 읽는다(`launchApp`). 그래서 `ready` 전에 해야만
// 하는 일 — vibproxy 스킴 등록 · Linux 캡처 스위치 · 크래시 수집·부팅 배너 · 단일 인스턴스 잠금 — 은 전부 거기로 갔다.
// 여기 다시 두지 마라: 이 모듈이 읽힐 때는 이미 늦다.

let ipcHub: IpcHub | null = null;
let hookListener: HttpServer | null = null;
let primaryMainWindow: BrowserWindow | null = null;
let backendBootFailed = false;
let backendStartAttempted = false;

// Hook 리스너 인증 토큰. 예전엔 매 실행 새 랜덤이었으나, 이제 userData 에 저장된 값을
// bootBackend 에서 불러와 재사용한다(hookIdentity.ts) — 재실행해도 동일 유지. 모듈 로드 시점엔
// app 이 아직 ready 가 아니라 userData 를 못 읽으므로, 일단 랜덤 폴백으로 두고 boot 때 덮어쓴다.
let hookToken: string = randomBytes(24).toString('hex');

export function getHookToken(): string {
  return hookToken;
}

/**
 * §보안 감사 2026-09-09 — loopback 토큰 비교는 **걸리는 시간이 값에 따라 달라지면 안 된다.**
 *
 * `!==` 는 첫 번째로 다른 글자에서 곧바로 끝난다. 이 리스너는 같은 PC 의 아무 프로그램이나
 * 두드릴 수 있고 횟수 제한도 없으므로, 응답 시간을 쌓으면 토큰을 앞에서부터 한 글자씩 맞춰
 * 나갈 수 있다. 토큰 하나면 이 리스너의 화이트리스트 전체(카드·설정·명령 큐)에 닿는다.
 *
 * 길이도 먼저 재지 않는다 — 길이 자체가 신호가 된다. 양쪽을 sha256 으로 접어 **항상 같은 32
 * 바이트**를 `timingSafeEqual` 로 비교한다(길이가 다르면 그 함수가 던지므로 접는 것이 필수다).
 */
function isValidHookToken(incoming: string | string[] | undefined): boolean {
  if (typeof incoming !== 'string') return false;
  const a = createHash('sha256').update(incoming).digest();
  const b = createHash('sha256').update(hookToken).digest();
  return timingSafeEqual(a, b);
}

// crashLog(§4 v1.98 확장) — 크래시 수집과 부팅 배너는 시작 진입점(`bootstrap.ts`)이 이 모듈보다 먼저 건다.

// §3.5 v4.67 — 서버 코어의 버블 생명주기 진단 로그도 crash.log 와 같은 곳(userData/logs)에 둔다.
// 이 로그는 프로젝트 데이터가 아니라 앱 진단이고, 종전엔 server 가 `process.cwd()` 상대 경로를
// 쓰는 바람에 패키지 앱의 실행 위치에 따라 AppData/Local 같은 엉뚱한 곳으로 갈라져 쌓였다.
// (app.getPath 는 ready 전에도 대체로 동작하지만 초기 실패에 대비해 감싼다 — crashLog 와 동일 방어.)
try {
  setDebugLogDir(join(app.getPath('userData'), 'logs'));
} catch { /* ready 전 극초기 실패 — server 의 cwd 상대 폴백을 그대로 쓴다 */ }

// §4 v1.98 — main 프로세스 에러를 진단 로그(diagnosticService)에 적재 → DebugPanel 에 표시.
// Unknown exceptions remain diagnostic events, not proof that execution recovered safely.
// Expected transport failures are contained at their own stream/request/window boundaries.
const mainDiagnostics = createMainDiagnostics({
  persist: (message, stack) => appendCrashLine('main', 'error', message, stack),
  publish: (message, stack) => recordDiagnostic('main', 'error', message, stack),
  console: (message) => console.error(`[main] ${message}`),
});
mainDiagnostics.guardStreams(process.stdout, process.stderr);
process.on('uncaughtException', (error) => mainDiagnostics.report('uncaughtException', error));
process.on('unhandledRejection', (error) => mainDiagnostics.report('unhandledRejection', error));
// 시작 진입점이 본체를 읽기 전 구간만 받던 오류 기록은 여기서 물러난다(같은 오류가 두 번 적히지 않게).
retireBootErrorLog();

/** §3.7 · §9 「시작 화면(스플래시)」 — 시작 진입점이 띄운 스플래시. 본체 창이 보이면 걷히고 `null` 이 된다. */
let bootSplash: SplashHandle | null = null;
/** 본체 창이 숨은 채 그리는 동안의 공개 제어 — 두 번째 실행·Dock 클릭은 숨은 본체 대신 스플래시를 앞으로 부른다. */
let mainReveal: MainRevealController | null = null;

/**
 * §9 「시작 화면(스플래시)」 — 다음 실행의 스플래시가 첫 칠에 쓸 언어·바탕(userData/splash.json, 표시 캐시).
 * 권위는 프로젝트 체크포인트(`uiLocale`)·설정 창(`appearance.themeId`)이다. 쓰기는 서버의 원자적 쓰기를 쓴다.
 */
function saveSplashDisplayCache(): void {
  try {
    const chrome = safeAppThemeChrome();
    writeSplashCache(makeSplashCache(safeUiLocale(), chrome.background, chrome.kind), atomicWriteFileSync);
  } catch (err) {
    console.warn('[main] splash display cache failed:', err);
  }
}

/**
 * 본체 창. `splash` 가 있으면(앱을 켠 첫 창) 숨긴 채 그리다가 준비가 끝나면 보이고, 없으면(mac 에서 창을 다시
 * 만들 때 등) 종전처럼 첫 칠(`ready-to-show`)에 곧바로 보인다.
 */
function createWindow(opts: { splash?: SplashHandle | null } = {}): void {
  const splash = opts.splash ?? null;
  // §3.7 v2.10 — 통합 앱 단일 타이틀바. Electron 네이티브 타이틀바를 숨기고(titleBarStyle: 'hidden')
  // React Header(`app-drag` 영역)가 그 자리에 타이틀바 역할을 한다. Windows 는 titleBarOverlay 가
  // 우상단에 네이티브 윈도우 컨트롤(min/max/close)을 오버레이로 깔아준다 — 헤더 우측의 `pr-36` 가
  // 그 오버레이 폭(=Windows 기본 138px)을 비워둔다. Mac 은 같은 설정이 트래픽 라이트를 자동 표기.
  // §4 앱 테마 — 창 바탕·제목줄 단추 색은 고른 테마에서 온다(화면과 같은 해석). 기본 테마는 종전 값 그대로다.
  const chrome = safeAppThemeChrome();
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: chrome.background,
    autoHideMenuBar: true,
    title: 'Vibisual',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      // §3.7 v2.15 — Header(`bg-vb-titlebar` = 테마 토큰 `titleBar.background`)와 같은 색.
      // ⚠️ `color`/`symbolColor` 는 Windows·Linux 전용이다. macOS 는 이 값을 무시하고
      //    대신 신호등(닫기/최소화/최대화)을 기본 위치에 그대로 띄운다 — 아래 참조.
      color: chrome.titleBar,
      symbolColor: chrome.titleBarSymbol,
      height: 36,
    },
    // macOS 전용 — `titleBarStyle:'hidden'` 이면 신호등이 좌상단 기본 좌표에 그대로 뜨는데,
    // 우리 Header 는 좌측 12px 부터 로고 + File 메뉴를 그린다. 위치를 안 잡아 주면
    // 신호등이 File 버튼을 덮어 폴더 열기·설정·플러그인의 **유일한 진입로가 막힌다**
    // (네이티브 앱 메뉴를 등록하지 않아 대체 경로가 없다).
    // h-9(36px) 헤더의 세로 가운데에 오도록 y 를 잡고, Header 쪽은 mac 에서 좌측 여백을 예약한다.
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 11 } } : {}),
    // out/main/index.cjs → ../icon.{ico,png} (staged by electron.vite.config copy plugin).
    // On Windows, PNG icons render blurry in the taskbar/title bar; use the multi-size
    // .ico instead. macOS/Linux keep the PNG (ICO not supported there).
    icon: join(__dirname, '..', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      // preload 는 CJS(.cjs)로 빌드 — electron.vite.config.ts 참조.
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      // §5.13 (R) — Chromium 내장 PDF 뷰어를 켠다. 우리가 PDF 렌더를 쓰지 않고 iframe 하나로 여는 근거.
      plugins: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // §3.7 — 창 상태 전이마다 렌더러에 드래그 영역 재신고를 시키던 배선은 걷었다. 그 재신고(영역 흔들기)가
  //   제목줄 누름을 버리게 했다 — 페이지까지 온 누름은 렌더러가 덮개와 같은 길로 옮긴다(client `titlebarPress.ts`).
  // §4 앱 테마 — 테마를 바꾸면 이 창의 바탕과 제목줄 단추도 다시 칠한다(그 창의 렌더러는 화면만 칠한다).
  trackThemedWindow(mainWindow, { titleBarOverlay: true });

  // §3.7 · §9 「시작 화면」 ② 첫 표시 — Windows 에서 숨겨 만든 창을 처음 보이면 첫 프레임이 흰색으로 찍힌다(바탕색을 줘도).
  //   보이기 전에 DWM 으로 가려 두고 첫 show 뒤 프레임이 지나면 걷는다 — 누가 어떤 길로 보이든 같다(아래 두 갈래·두 번째 실행).
  //   다른 OS 는 아무것도 하지 않는다(곧바로 'plain').
  const firstShow = coverFirstShow(mainWindow, { platform: process.platform });

  if (splash) {
    // §3.7 · §9 「시작 화면(스플래시)」 — 종전에는 빈 껍데기를 한 번 칠한 순간(`ready-to-show`) 보여, 그 뒤의 React
    //   마운트·첫 스냅샷·부팅 확인이 창이 뜬 첫 3초에 몰렸다(실측 멈춤 0.2~2.9초). 이제 스플래시가 앞을 지키는 동안
    //   숨긴 채 그리고(숨긴 창도 그린다), 렌더러가 첫 화면을 다 그리고 · 부팅 확인이 다 돌고 · 메인 스레드가 조용해지면
    //   보인다. 순서·상한은 `splashPolicy.decideMainReveal` 이 갖는다 — 무엇이 막혀도 상한 뒤에는 보인다.
    splash.stage('workspace');
    mainReveal = startMainReveal({
      window: mainWindow,
      splash,
      pendingStartupJobs: pendingStartupJobCount,
      firstShow,
      onRevealed: (reason, waitedMs, cover) => {
        mainReveal = null;
        bootSplash = null;
        const covered = cover === 'plain' ? '' : `, first frames covered → ${cover}`;
        logStartupMilestone(`main window revealed (${reason}, ${waitedMs}ms after the window was created${covered})`);
        saveSplashDisplayCache();
      },
    });
  } else {
    mainWindow.on('ready-to-show', () => mainWindow.show());
  }

  // §3.7 · §9 「창이 뜬 직후의 메인 스레드」 — 본체 창이 처음 보이는 순간을 두 곳에 알린다.
  //   ② 부팅 때 줄에 세워 둔 한 번짜리 확인(설치·로그인·사용량·코덱스·훅 전송)이 이때부터 한 칸씩 돈다.
  //      (스플래시가 있었으면 그 뒤에서 이미 풀었다 — 그때 이 부름은 아무것도 하지 않는다.)
  //   ④ 멈춤 기록이 "창이 뜬 뒤 몇 ms" 를 재는 기준점. 둘 다 첫 번만 센다(mac 에서 창을 다시 만들어도 같다).
  mainWindow.once('show', () => {
    markMainWindowShown();
    releaseStartupJobs();
  });

  // §5.5 #17-6 (E-2) — **본체 창을 고르면 밖의 펼친 IDE 창이 따라 올라온다.**
  //   펼친 IDE 는 (E) 개정으로 보통 층이라 다른 앱 뒤에 깔릴 수 있는데, `skipTaskbar:true` 라
  //   작업표시줄에도 없어 깔리면 되돌릴 길이 없다. 포커스는 옮기지 않고 Z 순서만 올린다.
  mainWindow.on('focus', () => {
    raiseExpandedOverlaysForMainFocus();
    // Windows 는 전면화가 아직 끝나지 않은 이 시점에 밟으면 OS 가 그 순서를 되돌린다 —
    //   한 프레임 뒤 한 번 더 밟는다(멱등). 그 사이 사용자가 다른 앱으로 갔으면 올릴 이유가
    //   없으므로, 그때도 본체가 여전히 포커스인지 확인한 뒤에만 밟는다.
    setTimeout(() => {
      if (mainWindow.isDestroyed() || !mainWindow.isFocused()) return;
      raiseExpandedOverlaysForMainFocus();
    }, 60);
  });

  // §3.7 — 복원 위치·크기는 OS 이동 루프가 정한다. unmaximize 뒤 중앙으로 재배치하면
  // 헤더의 어느 app-drag 영역에서 끌어도 커서에서 창이 떨어진다. 직접 처리하는 로고도
  // titlebarMove 가 정상 크기와 잡은 위치를 지키며, 별도 중앙 배치로 덮지 않는다.

  // §3.7 v2.12 — `titleBarStyle: 'hidden'` + `titleBarOverlay` Windows 조합에서 간헐적으로
  // `ready-to-show` 가 안 떠 창이 영구 숨김 상태가 되는 회귀가 보고됨. 3초 fallback —
  // 그때까지 안 떴으면 강제 show. 정상 경우엔 이미 ready-to-show 가 처리해서 이 분기 no-op.
  // 스플래시가 있으면 이 3초 그물은 걸지 않는다 — 공개 제어가 `ready-to-show` 를 기다리지 않고 자기 상한을 든다.
  if (!splash) {
    setTimeout(() => {
      if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        console.warn('[main] ready-to-show timeout — forcing window show()');
        mainWindow.show();
      }
    }, 3000);
  }

  // Renderer diagnostics and recovery are installed for every BrowserWindow below.

  // §3.7 — 여는 길은 종전 그대로 하나(`shell.openExternal`). 달라진 것은 **실패를 말한다**는 것뿐이다.
  // 리눅스에서는 그 프라미스가 실패해도 resolve 하므로 `openExternalWithNotice` 가 따로 잰다(폴백 ❌).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalWithNotice(url, mainWindow.webContents);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      openExternalWithNotice(url, mainWindow.webContents);
    }
  });

  // §3.7 v2.2 — dev 모드 폐기. renderer 는 항상 디스크의 프로덕션 빌드 산출물에서 로드한다
  // (electron-vite preview·packaged 동일 경로). renderer dev 서버·ELECTRON_RENDERER_URL 분기 없음.
  void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));

  // SCENARIO.md §5.4 #14-1 (v2.29) — 별창 매니저가 메인 윈도우를 참조해야 한다(redock 푸시 대상).
  primaryMainWindow = mainWindow;
  // Keep the main renderer alive while the themed quit question awaits an answer.
  let preparingMainClose = false;
  mainWindow.on('close', (event) => {
    event.preventDefault();
    if (quitting || preparingQuit || preparingMainClose) return;
    if (process.platform !== 'darwin') { app.quit(); return; }
    // macOS closes this renderer without quitting the app. Its embedded apps and hidden
    // child renderers still need the same durable barrier before `closed` destroys them.
    preparingMainClose = true;
    void flushDraftsBeforeClose(mainWindow).then((saved) => {
      if (saved && !mainWindow.isDestroyed()) mainWindow.destroy();
    }).catch((error: unknown) => mainDiagnostics.report('quit-confirmation', error))
      .finally(() => { preparingMainClose = false; });
  });
  mainWindow.on('closed', () => {
    if (primaryMainWindow === mainWindow) primaryMainWindow = null;
    // §5.4 #14-1 (v2.34) — 본체가 닫히면 별창도 같이 닫힌다(사용자 의도: "본체 꺼지면 별창도 같이").
    // 그렇지 않으면 별창이 살아있는 한 window-all-closed 가 발생하지 않아 앱이 quit 하지 못함.
    closeAllDetachedWindows();
    // §5.5 #17-6 (v2.73) — 오버레이 위젯 창도 함께 정리(같은 데드락 회피).
    closeAllOverlays();
    // §5.12 (v4.43) — 지휘통제실 창도 함께 정리(같은 데드락 회피).
    closeAllCommandCenters();
    // §5.13 (T-11) ④ — 내부 앱이 띄운 숨은 창(일꾼·오프스크린)도 함께 정리(같은 데드락 회피).
    disposeAppMains();
  });
}

/**
 * §3.7 — hook 전용 loopback HTTP 리스너.
 *
 * in-process 모델에서 유일하게 남는 프로세스 경계 — Claude Code hook 도, 커스텀 위임 엣지를
 * dispatch 하는 소스 커스텀 에이전트도 모두 claude CLI 가 spawn 하는 외부 프로세스라 renderer↔
 * server IPC 를 못 쓴다. 화이트리스트(/api/hook-event·/api/task-edges/dispatch·/health) 외
 * 경로는 404. `:0` 동적 포트 → §3.6 인스톨러가 그 포트를 ~/.claude/settings.json 에 기록하고,
 * server 코어는 setHookListenerPort() 로 같은 포트를 받아 dispatch curl URL 에 쓴다(§3.7 v2.8).
 *
 * 중요: 외부에서 온 **실제** IncomingMessage 를 Express app 에 직접 먹이지 않는다. body 만 읽어
 * light-my-request `inject` 로 재디스패치한다. light-my-request 는 Express 를 감지하면
 * `express.request` 프로토타입을 자기 Request 로 바꿔치기하는데(IPC 디스패치를 위해 필요),
 * 그 상태에서 실제 IncomingMessage 가 Express 를 거치면 socket close 시 `req.destroy` 가
 * light-my-request 의 것으로 풀려 크래시한다. 그 경로를 원천 차단 — 실제 req 는 Express 를
 * 절대 거치지 않고, Express 는 오직 light-my-request 요청만 받는다.
 */
async function startHookListener(expressApp: Express, preferredPort: number): Promise<number> {
  const bodyBudget = new LoopbackBodyBudget();
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';

    // /health is public — health checks must not require auth.
    const isHealth = path === '/health';
    // §3.7 (판올림 번호 발급 대기) — **dispatch 면제 폐기.** 종전 주석은 "dispatch 호출자에게는
    // 토큰 전달 채널이 없다"였는데, §5.5 #17-28 ⑧(b) 가 자식 환경에 `VIBISUAL_TOKEN` 을 넣기
    // 시작한 뒤로 그 전제는 사실이 아니다(카드 5경로가 이미 그 값을 쓴다). 면제가 남아 있는 동안
    // 이 경로는 **인증 없이 임의 지시문으로 새 에이전트를 스폰**할 수 있었다 — `edgeId` 존재
    // 검사는 호출자를 확인하지 않고, `express.text()` 를 타는 `text/plain` 본문이라 브라우저의
    // 단순 요청(preflight 없음)으로도 닿는다. 이제 `/health` 만 면제한다.

    // §5.3 #10-2 v2.47 — 하네스 빌더 구축 경로. 외부 빌더(spawn 된 claude)가 버블·엣지·설정·
    // kickoff 를 만들려면 이 loopback 으로 와야 한다. 토큰 게이트 필수(아래 분기 — `/health` 만 면제).
    const isBuilderPath =
      path === '/api/create-custom-agent' ||
      path === '/api/task-edges' ||
      path.startsWith('/api/agent-config/') ||
      path.startsWith('/api/commands/');

    // §5.13 (P) v4.49 — 내부 앱 REST. **앱 이름을 여기 적지 않는다** — 모든 앱이
    //   `/api/app/<id>/…` 아래로 들어오기로 했으므로 이 한 줄이면 앱이 늘어도 그대로다.
    //   외부 `claude` 프로세스에게는 이 loopback 이 유일한 통로라 열어 두되 토큰은 필수.
    const isAppPath = path.startsWith('/api/app/');

    // §5.5 #17-17 v4.46 — 세션 목표 진행률 신고. 주입 지시문을 받은 외부 `claude` 프로세스가
    // 유일한 호출자라 이 loopback 이 통로다. **`/progress` 로 끝나는 경로만** 연다 —
    // 목표 문장 자체를 고치는 PUT/DELETE 는 열지 않는다(목표는 사용자의 것이다).
    // 토큰 게이트 필수(아래 분기 — `/health` 만 면제).
    const isSessionGoalProgressPath =
      path.startsWith('/api/session-goal/') && path.endsWith('/progress');

    // §5.3 #10-4 — 오케스트라 지휘자의 **계획 신고**. 지휘자는 앱이 띄운 외부 `claude`/`codex` 프로세스라
    //   이 loopback 이 유일한 통로다. `/plan` 으로 끝나는 경로만 연다 — 켬/끔·세부 설정은 사용자의 스위치라
    //   열지 않는다(서버도 loopback 유입이면 403). 토큰 인증 필수(아래 분기).
    const isOrchestraPlanPath =
      path.startsWith('/api/orchestra/runs/') && path.endsWith('/plan');

    // §5.4 #36 (C) — 위성줄로 이어진 앱 노드에 **결과 파일을 담는** 창구. 부르는 쪽은 앱이 띄운 외부
    //   `claude`/`codex` 프로세스라 이 loopback 이 유일한 통로다. `/output` 으로 끝나는 POST 만 연다 —
    //   노드를 만들고·옮기고·지우는 손은 사용자의 것이라 열지 않는다. 토큰 인증 필수(아래 분기).
    const isAppBubbleOutputPath = req.method === 'POST'
      && path.startsWith('/api/app-bubbles/') && path.endsWith('/output');

    // §4 엔진 다리 — 우리가 띄운 claude 세션에 실린 모드(`vibisual-bridge`)의 신고(턴·생존·사용량).
    //   부르는 쪽이 그 claude 프로세스 안이라 이 loopback 이 유일한 통로다. POST 만 연다 — 상태 조회(GET)는
    //   렌더러 전용이다. 토큰 인증 필수(아래 분기).
    const isEngineBridgePath = req.method === 'POST' && path === '/api/engine-bridge';

    // Procedure feedback is session-scoped server-side. Settings/deletion remain UI-only.
    const isAutoGoalAgentPath = req.method === 'POST' && [
      '/api/auto-goal/context', '/api/auto-goal/review', '/api/auto-goal/assess', '/api/auto-goal/outcome',
    ].includes(path);

    // All other whitelisted paths require the per-launch token (item #7).
    if (
      path !== '/health' &&
      path !== '/api/hook-event' &&
      path !== '/api/permission-check' &&
      path !== '/api/codex-tool-check' &&
      !isVerificationToolIngress(req.method, path) &&
      path !== '/api/ask-user-question' &&
      path !== '/api/task-edges/dispatch' &&
      // §5.3 #10-2 (위임 결과 복구) — 끊긴 뒤 결과를 다시 받는 조회(`GET …/:cmdId`)와 취소(`POST …/:cmdId/cancel`).
      //   부르는 쪽이 dispatch 와 같은 외부 프로세스라 같은 통로가 필요하다. 토큰 인증 필수(아래 분기).
      !path.startsWith('/api/task-edges/dispatch/') &&
      // §4 v2.52 — 커스텀/스폰 에이전트의 작업 신고(did/userActions). 토큰 인증 필수(아래 분기).
      path !== '/api/agent-report' &&
      // §4 (CLI 사양 추종) — 에이전트 자율 컨텍스트 압축 요청. 큐에 얹는 시점은 그 턴이 끝난 뒤라
      //   여기서 여는 것은 "대기표에 적기"까지다. 토큰 인증 필수.
      path !== '/api/agent-compact' &&
      // §4 v2.60 — 커스텀/스폰 에이전트의 사용자 질문 카드(question + prompts). 토큰 인증 필수.
      path !== '/api/agent-questions' &&
      // §4 v2.70 — 커스텀/스폰 에이전트의 검수 요청 카드(changes + checkpoints). 토큰 인증 필수.
      path !== '/api/agent-review' &&
      // §4 v2.84 — 커스텀/스폰 에이전트의 번호 목록 정렬 카드(items). 토큰 인증 필수.
      path !== '/api/agent-list' &&
      // §7.11 v2.29 — 커스텀/스폰 에이전트의 서버 iframe 신고(url). 토큰 인증 필수.
      path !== '/api/agent-iframe' &&
      // §4 (CMD 터미널 업그레이드 ⑥) — 임베디드 PTY 제어. herdr 의 `pane send-text/read/wait-output`
      //   자리이며, **§10 'HTTP/REST API 외부 노출' 이 아니다** — 127.0.0.1 바인드 + 아래 토큰
      //   인증을 지나야 하는 기존 카드 5경로와 **같은 규율**의 loopback ingress 확장이다.
      //   `/api/cmd/send` 는 prefill 까지만 넣고 개행(Enter)은 절대 보내지 않는다(§4 v2.63 ToS 합법선).
      path !== '/api/cmd/send' &&
      path !== '/api/cmd/read' &&
      path !== '/api/cmd/wait' &&
      // §5.14 v4.62 — 플레이 버블의 실행 레시피 등록. **등록만** 열고 기동(`/start`)은 열지 않는다
      //   — 서버를 켜는 것은 사용자가 버튼을 누를 때의 일이다. 토큰 인증 필수.
      path !== '/api/play-recipe' &&
      // §4 v3.60 — 사용량 수집기(statusLine)가 미는 Claude.ai 한도 사용률. Claude Code 가
      //   statusLine 스크립트를 외부 프로세스로 돌리므로 이 loopback 이 유일한 도달 경로다.
      //   토큰 인증 필수(아래 분기).
      path !== '/api/rate-limits' &&
      // §4 v4.89 — 서브에이전트 행 수집기(`subagentStatusLine`)가 미는 토큰 사용량·모델·사고 깊이.
      //   statusLine 과 같은 이유로 이 loopback 이 유일한 도달 경로다. 토큰 인증 필수(아래 분기).
      path !== '/api/subagent-statusline' &&
      !isAppPath &&
      !isAppBubbleOutputPath &&
      !isSessionGoalProgressPath &&
      !isOrchestraPlanPath &&
      !isAutoGoalAgentPath &&
      !isEngineBridgePath &&
      !isBuilderPath
    ) {
      res.statusCode = 404;
      res.end('Vibisual hook listener — only hook ingest, edge dispatch, harness-builder construction routes and /health are served here.');
      req.resume();
      return;
    }

    if (!isHealth && !isValidHookToken(req.headers['x-vibisual-hook-token'])) {
      res.statusCode = 401;
      res.end('Unauthorized');
      req.resume();
      return;
    }

    // §3.7 v2.8 — hook 수신 외에 커스텀 위임 엣지 dispatch 도 외부 claude 프로세스가 호출하는
    // 경로다(renderer↔server IPC 불가 → loopback 리스너 경유). dispatch 도 화이트리스트에 포함.
    // §3.7 v2.9 — `/api/permission-check` 추가. §5.3 #12-1 권한 승인 팝업의 동기 게이트로,
    // 외부 claude 프로세스가 PreToolUse 훅(node handler.mjs)을 통해 도달한다. 이전 3경로
    // 화이트리스트가 permission-check 를 404 로 막아 `permissionBroker` 모달이 안 떴음.
    void readLoopbackBody(req, res, bodyBudget).then(async (body): Promise<void> => {
      if (!body) return;
      try {
        if (res.destroyed || res.writableEnded) return;
        // §5.3 #12-1 — **이 요청이 어디서 왔는지 표시한다.** 여기 닿은 것은 전부 우리가 스폰한
        //   외부 프로세스(빌더 포함)의 curl 이고, 그 토큰은 그 프로세스의 env·프롬프트에 실려
        //   나간 값이라 **토큰 보유가 곧 사용자 의사가 아니다.** 서버는 이 표식을 보고 권한 축을
        //   동결한다. 클라가 같은 이름의 헤더를 보냈어도 **덮어쓴다** — 위조는 제약을 더할 뿐이라
        //   안전하고, 반대로 지우지 못하게 하는 것이 이 한 줄의 전부다.
        const ingressHeaders = { ...(req.headers as Record<string, string | string[]>) };
        ingressHeaders[LOOPBACK_INGRESS_HEADER] = LOOPBACK_INGRESS_VALUE;
        // §5.3 #10-2 · #12-1-B — 결과를 붙드는 dispatch·조회와 권한 카드 창구는 바깥 호출자가 끊기면 안쪽 응답도 끊는다. 안 그러면 끊긴 호출자에게
        //   결과를 건넸다고 적혀, 그 결과를 기다리던 턴이 받지 못한 채 완료로 끝날 수 있다.
        const target = expressApp as unknown as InjectDispatch;
        const dispatchFn = (isHoldPath(path) ? followOuterDisconnect(res, target) : target) as unknown as DispatchFunc;
        await inject(dispatchFn, {
          method: (req.method ?? 'GET') as 'GET',
          url: req.url ?? path,
          headers: ingressHeaders,
          payload: body.payload,
        }).then((injected) => {
          if (res.destroyed || res.writableEnded) return;
          forwardLoopbackResponse(res, injected);
        }).catch((err: unknown) => {
          // 바깥이 먼저 끊겨 안쪽을 끊은 경우 — 받을 쪽이 없다.
          if (res.writableEnded || res.destroyed) return;
          res.statusCode = 500;
          res.end(`hook dispatch failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      } finally { body.release(); }
    }).catch((error: unknown) => {
      mainDiagnostics.report('hook', error);
      try {
        if (!res.destroyed && !res.writableEnded) { res.statusCode = 500; res.end('Hook dispatch failed'); }
      } catch { /* The response stream also owns asynchronous write errors. */ }
    });
  });
  hookListener = server;
  // The temporary listen/fallback handler below is removed after startup; runtime errors still need an owner.
  server.on('error', (error) => { if (server.listening) mainDiagnostics.report('hook-listener', error); });
  // 저장된 선호 포트를 먼저 시도하고, 점유됐으면(EADDRINUSE 등) 동적 포트(:0)로 폴백한다.
  // 단일 인스턴스 락이 우리 자신끼리의 경쟁은 막으므로, 폴백은 외부 프로세스가 그 포트를
  // 가로챈 드문 경우에만 발생한다. 폴백 시에도 bootBackend 가 실제 포트를 다시 저장한다.
  await new Promise<void>((resolve, reject) => {
    let triedFallback = false;
    const onError = (err: NodeJS.ErrnoException): void => {
      if (!triedFallback && preferredPort > 0) {
        triedFallback = true;
        console.warn(`[main] preferred hook port ${preferredPort} unavailable (${err.code ?? err.message}) — falling back to a dynamic port`);
        server.listen(0, '127.0.0.1');
        return;
      }
      reject(err);
    };
    server.on('error', onError);
    server.listen(preferredPort > 0 ? preferredPort : 0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

/**
 * §3.7 — `vibproxy://proxy/iframe-proxy/<host>/<path>` 요청을 in-process Express 의
 * iframe 프록시 핸들러로 합성 디스패치한다. renderer 의 <iframe> 엘리먼트 로드는
 * fetch 몽키패치로 가로챌 수 없어 이 프로토콜 핸들러가 유일한 경로다.
 *
 * - `/iframe-proxy/…` 경로만 처리(프록시된 페이지가 재작성한 root-relative 링크가 동일
 *   오리진으로 다시 들어온다). 그 외 경로는 404.
 * - 응답은 rawPayload(Buffer) 그대로 전달 — 이미지·폰트·JS 등 바이너리 무손실.
 * - 실제 IncomingMessage 가 아니라 light-my-request `inject`(plain 옵션)로 디스패치하므로
 *   startHookListener 주석의 req.destroy 크래시 경로와 무관하다.
 */
const ALLOWED_PROTOCOL_PREFIXES = [IFRAME_PROXY_PATH, WORKSPACE_SITE_PATH] as const;

function registerIframeProxyProtocol(expressApp: Express): void {
  protocol.handle('vibproxy', async (request) => {
    let pathname: string;
    let search: string;
    try {
      const u = new URL(request.url);
      pathname = u.pathname;
      search = u.search;
    } catch {
      return new Response('bad vibproxy url', { status: 400 });
    }
    // 이 스킴으로 들어올 수 있는 경로는 **화이트리스트 두 갈래**뿐이다.
    //   /iframe-proxy/…       — dev 서버 프리뷰(프록시된 페이지가 재작성한 root-relative 링크)
    //   /api/workspace-site/… — §5.5 #17-27 ⑮ 워크스페이스 HTML 을 페이지로. 그 페이지가 부르는
    //                           상대 경로 자산(css·js·그림)이 같은 오리진으로 다시 들어온다.
    // 그 외는 404 — 이 스킴이 in-process Express 전체로 가는 우회로가 되어서는 안 된다.
    //   + §5.13 (T-3) 내부 앱이 iframe 으로 띄울 정적 콘텐츠(`/api/app/<앱id>/content/…`) — 앱 이름 없이 모양 하나로.
    const allowed = ALLOWED_PROTOCOL_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
    ) || isAppContentPath(pathname) || isAppMediaPath(pathname);
    if (!allowed) {
      return new Response('not found', { status: 404 });
    }
    // §5.13 (Y) 40-1 — 앱 **미디어**(`/api/app/<id>/media?…`)는 Express 를 거치지 않고 파일을 흘려 보낸다(구간 지원 · 끊으면 멈춤).
    //   어느 파일인지는 그 앱의 서버 몫이 답한다(경로 검사는 그쪽 규칙) — 이 줄은 앱 이름을 모른다.
    if (isAppMediaPath(pathname)) {
      const startedAt = performance.now();
      const appId = appIdOfMediaPath(pathname);
      const file = appId ? await resolveAppMediaFile(appId, new URL(request.url).searchParams) : null;
      if (!file) return new Response('not found', { status: 404, headers: { 'X-Content-Type-Options': 'nosniff' } });
      const setupMs = performance.now() - startedAt;
      if (setupMs >= 100) logTransfer({ at: Date.now(), channel: 'vibproxy-media-open', path: pathname + search, ms: setupMs, bytes: 0 });
      try {
        return await appMediaResponse(file, request, (done) => {
          logTransfer({ at: Date.now(), channel: done.cancelled ? 'vibproxy-media-cancelled' : 'vibproxy-media', path: pathname + search, ms: 0, bytes: done.bytes });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(`media unavailable: ${msg}`, { status: 502, headers: { 'X-Content-Type-Options': 'nosniff' } });
      }
    }
    try {
      const startedAt = performance.now();
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const payload = hasBody ? Buffer.from(await request.arrayBuffer()) : undefined;
      const headers: Record<string, string> = {};
      request.headers.forEach((v, k) => { headers[k] = v; });
      // §5.13 (Y) 40-7 ① — `payloadAsStream`: 조각을 모으기만 한다. 종전 길은 바이너리여도 응답 전체를 UTF-8 문자열로 한 번 더
      //   바꿨다(light-my-request 가 `res.payload` 를 늘 만든다 — 164MB 에 메인 1.5초).
      const injected = await inject(expressApp as unknown as DispatchFunc, {
        method: (request.method ?? 'GET') as 'GET',
        url: pathname + search,
        headers,
        payload,
        payloadAsStream: true,
      });
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of injected.stream()) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        chunks.push(part);
        received += part.length;
      }
      const rawPayload = chunks.length === 1 ? chunks[0]! : Buffer.concat(chunks, received);
      logTransfer({ at: Date.now(), channel: 'vibproxy', path: pathname + search, ms: performance.now() - startedAt, bytes: received });
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(injected.headers)) {
        if (v == null) continue;
        resHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      }
      // 204/304/1xx 는 본문을 가질 수 없다 — Response 생성자가 throw 하므로 null 본문.
      const nullBody =
        injected.statusCode === 204 ||
        injected.statusCode === 304 ||
        (injected.statusCode >= 100 && injected.statusCode < 200);
      // §5.13 (Y) 40-7 ① — 모은 바이트를 한 번 더 복사하지 않고 보기(view)로 넘긴다(Response 가 본문을 만들 때 스스로 복사한다 — Fetch
      //   명세). Node 의 Buffer 는 일반 ArrayBuffer 위에 선다(SharedArrayBuffer ❌) — 그 형을 밝힌다.
      return new Response(nullBody ? null : new Uint8Array(rawPayload.buffer as ArrayBuffer, rawPayload.byteOffset, rawPayload.byteLength), {
        status: injected.statusCode,
        statusText: injected.statusMessage ?? '',
        headers: resHeaders,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`iframe proxy dispatch failed: ${msg}`, { status: 502 });
    }
  });
}

async function bootBackend(): Promise<void> {
  // Secrets — in-process 모델이라 server 코어는 이 main 프로세스의 process.env 를 그대로 읽는다.
  //   dev      : Electron 을 띄운 셸 env 가 이미 process.env 에 있음(추가 작업 불필요).
  //   packaged : 셸 env 가 없으므로 app.getPath('userData')/secrets.json 을 읽어 머지한다.
  // 프로젝트 데이터(§3.5)는 영향 없음 — 여전히 <projectPath>/.vibisual.
  const secrets = loadSecrets();
  for (const [k, v] of Object.entries(secrets.env)) process.env[k] = v;
  if (secrets.source === 'userData') {
    console.log(`[main] merged ${Object.keys(secrets.env).length} secret(s) from ${secrets.path}`);
  }

  // §9 — preload 의 "바이트 채널을 안다" 신고를 받을 창구를 먼저 연다.
  // createWindow() 보다 반드시 앞서야 한다(preload 는 로드되자마자 신고한다).
  initWsFanout();

  // broadcast sink — server 코어의 push 단일 창구를 모든 renderer 로 IPC 전송.
  // runServer 이전에 등록해야 부팅 중 push 가 유실되지 않는다.
  setBroadcastSink((msg) => {
    // §9 — 창 수와 무관하게 **1회만** 인코딩해(JSON + UTF-8 바이트) 창마다 postMessage 로 민다.
    // webContents.send 는 호출 시점에 메인 스레드에서 동기 구조화 클론을 수행하므로, 400KB 급
    // graph_snapshot 객체를 그대로 실으면 그 깊은 순회가 곧 입력 지연이 된다. 종전엔 창이 2개
    // 이상일 때만 문자열로 접었는데, **사용자 대부분인 단일 창**이 여전히 깊은 클론을 타고 있었다.
    // 평평한 바이트의 클론은 깊은 순회가 아니라 memcpy 다. 판정·폴백·detach 방지는 전부
    // snapshotWire.ts 에 있다(그래야 실기 없이 검증된다). 받는 쪽 preload 가 TextDecoder 로
    // 문자열을 되돌려 주므로 renderer 계약은 종전 그대로다.
    const json = broadcastToWindows(msg);
    // §4 v3.16 — 모바일 웹 접속 모드가 켜져 있으면 LAN WebSocket 클라이언트에도 팬아웃.
    // 위에서 이미 직렬화했으면 그 문자열을 재사용(스냅샷 재직렬화 방지).
    mobileBroadcast(msg, json ?? undefined);
    // §4 메신저 브리지 — 페어링된 대화가 하나도 없으면 즉시 반환하므로 꺼져 있을 때 비용 0.
    //   하행은 이 한 줄이 전부다(새 브로드캐스트 레일 ❌).
    chatBroadcast(msg);
  });

  // §5.3 #9-2 (A) — Windows 에서는 우리가 띄우는 에이전트 자식을 Job Object 로 묶는다(손자까지 · 프로세스당
  //   메모리 상한 · 본체가 끝나면 함께 정리). **`runServer()` 앞**이어야 부팅 때 되살아나는 세션도 묶인다.
  //   다른 OS 는 null — 서버가 종전 detached 그룹 + 감시로 간다. 바인딩이 실패해도 null(감시가 받친다).
  setProcessContainmentBackend(createWindowsJobBackend(process.platform));

  // server 코어를 in-process 구동 — HTTP listen / ws 없이 Express app 만 받는다.
  const handle = await runServer();
  // §9 「시작 화면(스플래시)」 — 서버 코어의 복원은 끝났다. 진척 창구를 걷고, 바깥 에이전트가 닿을 길(훅 리스너·설치)을 연다.
  setBootProgressSink(null);
  bootSplash?.stage('connecting');

  // iframe 서버 프리뷰용 vibproxy:// 프로토콜 핸들러 등록(app.ready 이후이므로 여기서).
  registerIframeProxyProtocol(handle.app);

  // §5.13 (T-11) ① — 내부 앱의 서버 몫이 같은 앱의 main 몫을 부르는 통로(일꾼 창 깨우기 등). 렌더러의
  //   `vibisual:app:invoke` 와 같은 모듈·같은 `invoke` 를 탄다.
  setAppMainInvoker((appId, action, payload) => invokeAppMain(appId, action, payload));
  // §5.13 (T-11) ③ — 앱 콘텐츠 프레임(샌드박스 iframe)이 처음 연 문서 밖으로 가지 못하게. 이후에 생기는 창마다 건다.
  app.on('web-contents-created', (_event, contents) => guardAppContentFrames(contents));

  // hook loopback 리스너 → §3.6 글로벌 훅 인스톨러로 그 포트를 등록.
  // 포트·토큰은 userData 에 저장된 값을 재사용한다(hookIdentity.ts) — 재실행해도 동일하게
  // 유지되어, 이전 인스턴스가 스폰한 외부 에이전트의 loopback curl 이 끊기지 않는다.
  const identity = loadHookIdentity();
  hookToken = identity.token;
  const hookPort = await startHookListener(handle.app, identity.preferredPort);
  // 실제 바인드된 포트·토큰을 확정 저장 → 다음 실행이 같은 값을 선호 포트/토큰으로 재사용.
  saveHookIdentity({ port: hookPort, token: hookToken });
  // §3.7 v2.8 — server 코어가 커스텀 위임 엣지 dispatch curl URL 을 이 포트로 조립하도록 주입.
  setHookListenerPort(hookPort);
  // §5.3 #10-2 v2.47 — 하네스 빌더 구축 curl 인증용 토큰을 server 코어에 주입.
  setHookListenerToken(hookToken);
  // §4 v2.71 — 카드 엔드포인트 curl 이 호출 시점에 live 포트·토큰을 읽을 신원 파일 경로를 주입.
  //   forward-slash 정규화: 빌더가 이 경로를 node 의 단일따옴표 JS 문자열에 그대로 박으므로
  //   Windows 역슬래시면 이스케이프가 깨진다. node 의 fs 는 forward-slash 를 그대로 받는다.
  setHookListenerIdentityFile(hookIdentityPath().replace(/\\/g, '/'));

  // §4 (CMD 터미널 업그레이드 ⑥) — loopback REST(`/api/cmd/*`)가 임베디드 PTY 를 만질 수 있게
  //   terminalManager 를 server 코어에 주입한다(§3.4 — server 는 desktop 을 import 하지 않는다).
  setCmdTerminalController(terminalController);
  // User-started verification uses the existing server queue and this app-owned tool adapter.
  setVerificationAutomationAdapter(verificationAutomationAdapter);
  // §5.5 #17-19 ⑦ — 탐색기에서 지운 파일은 **OS 휴지통**으로 간다(영구 삭제 ❌ — 되돌릴 수 있어야 한다).
  //   Windows 재활용·macOS ~/.Trash·Linux freedesktop 규약을 이미 옳게 다루는 물건이 `shell.trashItem`
  //   하나뿐이라 세 OS 분기를 우리가 다시 쓰지 않는다. 주입이 없는 실행 형태에서는 서버가 영구 삭제로
  //   떨어지고, 그 사실은 응답의 `trashed:false` 로 화면까지 전해진다.
  setWorkspaceTrash((absPath) => shell.trashItem(absPath));
  // §5.5 #17-38 ⑮ — 마이크가 막혔을 때 **OS 의 마이크 설정 창을 우리가 연다**(사유만 말하고 끝내지
  //   않는다). 여는 주소는 서버가 플랫폼으로 정한 하나뿐이고 여기서는 URL 을 만들지 않는다 —
  //   임의 URI 를 여는 문이 되지 않게 하기 위해서다. 웹 단독 실행에서는 주입이 없어 서버가
  //   `openable:false` 로 답하고, 화면은 버튼 대신 무엇을 확인해야 하는지를 글로 보여 준다.
  setMicSettingsOpener((url) => { void shell.openExternal(url); });
  // §4 (⑦) — PTY 안의 에이전트가 헤드리스와 **같은** 카드 엔드포인트를 curl 로 부를 수 있도록
  //   loopback 신원을 터미널 env 로 실어 보낸다(없으면 종전 `::VIBISUAL-CARD::` 마커 폴백).
  setTerminalCardIdentity({ port: hookPort, token: hookToken, identityFile: hookIdentityPath().replace(/\\/g, '/') });
  // §4 (④) — CMD 세션이 **백그라운드에서** blocked 로 전이할 때 1회 OS 알림. 창이 포커스돼 있으면
  //   화면에 이미 보이므로 띄우지 않는다(herdr 도 백그라운드 pane 에서만 알린다).
  setCmdBlockedNotifier((notice) => {
    try {
      if (!Notification.isSupported()) return;
      const focused = BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused());
      if (focused) return;
      const s = mainStrings(safeUiLocale());
      new Notification({
        title: fmt(s.cmdBlockedTitle, { label: notice.label }),
        body: notice.reason ?? s.cmdBlockedBody,
        silent: false,
      }).show();
    } catch { /* 알림은 표시 전용 — 실패해도 작업에 영향 없음 */ }
  });
  console.log(`[main] hook listener on http://127.0.0.1:${hookPort} (loopback — hook + edge dispatch ingest)`);

  // §4 엔진 다리 — 우리가 띄우는 claude 세션에 `--plugin-dir` 로 싣는 모드의 동봉 자리. electron-vite 가
  //   빌드 때 <repo>/hooks/mods/vibisual-bridge 를 out/mods/vibisual-bridge 로 복사하므로 훅 핸들러와 같은
  //   규칙(out/main/index.cjs 기준 ../mods)으로 dev·packaged 양쪽에서 같은 위치다. 훅 설치를 건너뛰는
  //   실행에서도 주입한다 — 모드는 이 인스턴스의 루프백으로만 신고하므로 설치와 무관하다.
  setEngineBridgeSourceDir(join(__dirname, '..', 'mods', 'vibisual-bridge'));

  // Item #1 — VIBISUAL_SKIP_HOOK_INSTALL opt-out gate.
  const skipInstall = process.env['VIBISUAL_SKIP_HOOK_INSTALL'];
  if (skipInstall === '1' || skipInstall === 'true') {
    console.log('[main] VIBISUAL_SKIP_HOOK_INSTALL is set — hooks NOT installed. Bubble map will receive no events until hooks are present in ~/.claude/settings.json.');
  } else if (process.env['VIBISUAL_HOME']?.trim()) {
    console.log('[main] hook installer skipped — VIBISUAL_HOME set (isolated instance)');
  } else {
    // §3.6 v2.9 — hook 명령은 `node <handlerPath> --server <loopbackUrl>`.
    // electron-vite 가 빌드 시 <repo>/hooks/handler.mjs 를 out/hooks/handler.mjs 로 복사하므로
    // out/main/index.cjs 기준 ../hooks/handler.mjs 가 dev·packaged 양쪽에서 같은 위치.
    const handlerPath = join(__dirname, '..', 'hooks', 'handler.mjs');
    // §4 v3.60 — 사용량 수집기(statusLine)도 같은 핸들러를 쓴다. 사용자가 팝업에서 켤 때
    //   server 가 이 경로로 명령을 조립하도록 주입.
    setHookHandlerPath(handlerPath);
    // §5.25 (I) — 코덱스 훅에 필요한 값도 같은 자리에서 넘긴다. **여기서 설치하지는 않는다** —
    //   코덱스 훅은 기본 꺼짐이고 사용자가 켤 때만 REST 로 깔린다(남의 전역 설정을 말없이 건드리지 않는다).
    setCodexHookContext({ port: hookPort, handlerPath, token: hookToken });
    // §3.6 — 호스트 `~/.claude` 하나가 아니라 **우리가 아는 모든 설정 홈**에 심는다.
    //   Cowork(Claude Desktop 로컬 세션)는 설정 홈을 세션마다 따로 잡아 우리 훅을 보지 않았다
    //   (anthropics/claude-code#63360) — 그래서 Cowork 작업은 캔버스에 한 획도 남지 않았다.
    const all = ensureHooksInstalledEverywhere(hookPort, handlerPath, hookToken);
    const r = all.host;
    if (all.coworkInstalled > 0) {
      console.log(`[main] hooks installed into ${all.coworkInstalled} Cowork session home(s)`);
    }
    if (r.error) {
      console.warn(`[main] hook installer failed: ${r.error.message} — 훅 이벤트가 0건일 수 있음`);
    } else if (r.installed) {
      console.warn(
        `[main] WROTE ~/.claude/settings.json (Vibisual-managed hook block). Backup at ${r.backupPath ?? '(no backup — file was new)'}. To opt out, set VIBISUAL_SKIP_HOOK_INSTALL=1 and remove the \`_vibisualManaged: true\` blocks from settings.json.`,
      );
    } else if (r.alreadyPresent) {
      console.log(`[main] hooks already up-to-date in ${r.settingsPath}`);
    }
    if (r.prunedLegacy > 0 || r.prunedBackups > 0) {
      console.log(
        `[main] hook settings cleanup — 표식 없는 옛 블록 ${r.prunedLegacy}장 / 오래된 백업 ${r.prunedBackups}개 제거`,
      );
    }

    // §4 v3.60 — 사용량 수집기는 **자동 설치하지 않는다**(opt-in). 사용자가 이미 켜둔
    //   경우에만 이번 런의 포트·토큰으로 명령을 갱신해 "재기동 후 값이 안 들어오는" 것을 막는다.
    const sl = refreshStatusLineIfInstalled(hookPort, handlerPath, hookToken);
    if (sl.installed && !sl.error) {
      console.log('[main] usage collector (statusLine) refreshed for this launch');
    } else if (sl.error) {
      console.warn(`[main] usage collector refresh skipped: ${sl.error}`);
    }
  }

  ipcHub = setupIpc(handle.app);

  // §4 v3.16 — 모바일 웹 접속 모드(opt-in). 꺼져 있으면 소켓을 열지 않는다.
  // 이전 실행에서 켜져 있었으면(userData mobile-access.json) 자동 재기동.
  initMobileAccess(handle.app);

  // §4 메신저 원격제어 브리지(opt-in). 켜 둔 채널이 있을 때만 바깥으로 나간다 —
  //   꺼져 있으면 네트워크를 한 번도 건드리지 않는다.
  initChatBridge(handle.app);
}

/**
 * §3.7 · §9 「시작 화면(스플래시)」 — **앱의 시작.** 시작 진입점(`bootstrap.ts`)이 `ready` 뒤에 화면 가운데에 스플래시를
 * 띄우고 이 모듈을 읽은 다음 부른다. 단일 인스턴스 잠금도 거기서 잡는다 — 두 번째 실행·Dock 클릭은 시작 진입점이 받아
 * 여기서 돌려준 `LaunchedApp` 으로 넘긴다.
 *
 * 순서: 동의(배포본 — 그동안 스플래시는 숨는다) → 권한 처리기·창 공통 배선 → 백엔드(스플래시에 진척) → 본체 창(숨긴 채
 * 그린다) → 준비가 끝나면 보이고 스플래시를 걷는다. 스플래시를 못 만들었으면(`null`) 종전처럼 본체 창이 곧바로 보인다.
 */
export interface LaunchedApp {
  onSecondInstance(): void;
  onActivate(): void;
}

export function launchApp(opts: { splash: SplashHandle | null }): LaunchedApp {
  bootSplash = opts.splash;
  void runLaunch().catch((error: unknown) => mainDiagnostics.report('launch', error));
  return {
    // 단일 인스턴스 락 — 2번째 실행이 백엔드를 또 부팅해 ~/.claude/settings.json 의 hook 포트를
    // 자기 동적 포트로 덮어쓰는 사고를 원천 차단한다. 그 2번째 인스턴스가 닫히면 settings.json 이
    // 죽은 포트를 가리켜, 새로 뜨는 훅·스폰 에이전트의 loopback curl(작업 신고/질문/검수)이 전부
    // connection refused 로 "전송 실패"하던 회귀의 근본 원인. 락을 못 얻은 쪽은 시작 진입점이 즉시 끝내고,
    // 이 쪽은 기존 인스턴스 창을 앞으로 가져온다 — 본체가 아직 숨어 있으면 그 앞을 지키는 스플래시를.
    onSecondInstance: () => {
      if (mainReveal?.pending) {
        mainReveal.focusSplash();
        return;
      }
      const win = primaryMainWindow;
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      } else {
        focusConsentWindow();
        bootSplash?.focus();
      }
    },
    onActivate: () => {
      if (mainReveal?.pending) {
        mainReveal.focusSplash();
        return;
      }
      if (!primaryMainWindow) {
        focusConsentWindow();
        bootSplash?.focus();
      }
    },
  };
}

async function runLaunch(): Promise<void> {
  // Distributed binaries must obtain consent before backend restoration, hooks, remote access,
  // provider setup, and updates. The consent window has no app preload or transport.
  // §3.7 「시작 화면」 — 동의 창이 떠 있는 동안 스플래시는 숨는다(약관 옆·위에 함께 서지 않게).
  if (!await ensureDesktopConsent({ onPrompt: () => bootSplash?.hide() })) {
    bootSplash?.close();
    bootSplash = null;
    app.quit();
    return;
  }
  if (quitting) return;
  bootSplash?.show();

  // §5.5 #17-38 — **마이크를 열 수 있게 한다.** 받아쓰기는 렌더러의 getUserMedia 로 마이크를
  //   여는데, 패키지 앱의 렌더러는 file:// 에서 뜨고 Electron 은 그 출처의 media 권한을 앱이
  //   명시적으로 받아 주지 않으면 거절한다(숨김 창 실측: 처리기가 없으면 음성 인식이 곧바로
  //   not-allowed 로 죽는다). 요청(request)과 확인(check) 두 경로가 따로라 둘 다 답해야 한다 —
  //   getUserMedia 는 확인 경로를 먼저 밟는다.
  //
  //   **목록을 좁히지 않는 것이 의도다.** 종전에는 처리기 자체가 없어 Electron 기본값으로
  //   돌았고, 여기서 아는 것만 골라 허용하면 이미 도는 기능(화면 캡처·클립보드·알림·전체화면)
  //   중 무엇이 조용히 죽을지 실기 없이 알 수 없다. 노출면도 늘지 않는다 — 이 세션에 뜨는
  //   것은 우리 번들과 로컬 프리뷰뿐이고, 바깥 주소는 기본 브라우저로 내보낸다(§5.13 (R-6)).
  //   모든 창이 defaultSession 하나를 쓰므로(커스텀 partition ❌) 이 한 벌이 전부를 덮는다.
  //   (스플래시·동의 창은 자기 partition 이라 이 처리기 밖이다 — 둘 다 전부 거절한다.)
  const allowPermission = (): true => true;
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(allowPermission());
  });
  session.defaultSession.setPermissionCheckHandler(allowPermission);

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
    installWindowCrashRecovery(window, {
      appPageUrl: pathToFileURL(join(__dirname, '../renderer/index.html')).href,
      isQuitting: () => quitting,
      log: (level, message) => appendCrashLine('renderer', level, message),
      askReload: async (owner): Promise<boolean> => {
        const s = mainStrings(safeUiLocale());
        const result = await showAppMessageBox({
          type: 'error',
          title: s.crashTitle,
          message: s.crashMessage,
          buttons: [s.crashReload, s.quitBtnCancel],
          defaultId: 0,
          cancelId: 1,
          locale: safeUiLocale() ?? undefined,
          theme: safeAppThemeChrome(),
        }, owner);
        return result.response === 0;
      },
    });
  });

  backendStartAttempted = true;
  // §9 「시작 화면(스플래시)」 — 서버 코어가 부팅하는 동안의 진척을 스플래시로 흘려보낸다(프로젝트 복원 "3/10" 등 —
  //   표시 전용). 복원은 동기라 그동안 메인 스레드가 붙잡히지만, 스플래시는 메시지 포트로 받아 그대로 그린다.
  bootSplash?.stage('services');
  setBootProgressSink((progress) => bootSplash?.boot(progress));
  await startBackendBeforeWindow({
    boot: bootBackend,
    reportError: (error) => {
      backendBootFailed = true;
      mainDiagnostics.report('backend-startup', error);
    },
    askRestart: async () => {
      // 부팅 실패 안내가 스플래시 뒤에 가려지지 않게 먼저 걷는다.
      setBootProgressSink(null);
      bootSplash?.close();
      bootSplash = null;
      const s = mainStrings(safeUiLocale());
      const result = await showAppMessageBox({
        type: 'error', title: s.backendBootTitle, message: s.backendBootMessage,
        buttons: [s.backendBootRetry, s.backendBootQuit], defaultId: 0, cancelId: 1,
        locale: safeUiLocale() ?? undefined, theme: safeAppThemeChrome(),
      });
      return result.response === 0;
    },
    relaunch: () => app.relaunch(),
    quit: () => app.quit(),
    openApp: () => {
      setBootProgressSink(null);
      // §5.4 #14-1 — windowManager 가 메인 윈도우를 알아야 redock-hover 푸시 가능.
      configureWindowManager({ getMainWindow: () => primaryMainWindow });
      // §3.7 · §9 「시작 화면」 — 스플래시가 앞을 지키는 동안 부팅 한 번짜리 확인을 먼저 돌린다(좁은 간격). 본체 창은 그 줄이
      //   다 돈 뒤에 보이므로, 창이 보인 뒤 +1.5s~ 에 몰리던 CLI 기동 멈춤이 오지 않는다. 스플래시가 없으면 종전대로 첫 show 에서.
      if (bootSplash) releaseStartupJobs('splash');
      createWindow({ splash: bootSplash });
      closeConsentWindow();
      // §4 앱 테마 — 테마가 바뀌면 열린 창 전부의 바탕·제목줄 단추를 다시 칠한다(구독은 한 번).
      installAppThemeChromeSync();
      // §9 「시작 화면」 — 테마를 바꾸면 다음 스플래시의 바탕도 따라간다(표시 캐시 — 바뀐 값만 쓴다).
      try {
        subscribeAppThemeChrome(() => saveSplashDisplayCache());
      } catch { /* 표시 캐시 — 없어도 스플래시는 기본 바탕으로 뜬다 */ }
      // 첫 상태 push 가 메인 윈도우에 도달하도록 창 생성 뒤 기동한다.
      initAutoUpdater();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    },
  });
}

// GPU·유틸리티 등 자식 프로세스 사망 — 네이티브 크래시의 흔한 원인(GPU 드라이버 등).
// webContents 의 render-process-gone 과 별개 축이라 앱 레벨에서 별도로 잡아 crash.log 에 남긴다.
app.on('child-process-gone', (_e, details) => {
  console.error(`[main] child-process-gone type=${details.type} reason=${details.reason}`);
  appendCrashLine(
    'child',
    'fatal',
    `child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}${details.name ? ` name=${details.name}` : ''}`,
  );
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !hasAppMessageBox()) app.quit();
});

// Item #8 — await cleanup before exit to prevent socket leak on dev-cycle restarts.
// Double-fire guard via quitting flag.
/**
 * 서버 코어에서 "지금 끊기면 잃는 일" 요약을 안전하게 읽는다.
 * 서버가 아직 안 떴거나 이미 정리된 뒤라도 **종료를 막지 않는다** — 판단 못 하면 그냥 닫는다.
 */
function safeRunningWorkSummary(): { sessions: number; backgroundTasks: number; labels: string[] } | null {
  try {
    return subAgentManager.getRunningWorkSummary();
  } catch (err) {
    console.warn('[main] getRunningWorkSummary failed:', err);
    return null;
  }
}

/**
 * 네이티브 문구에 쓸 UI 언어. 서버 코어가 아직 안 떴거나 이미 정리된 뒤라도 **문구가 없어서는 안 되므로**
 * 실패하면 `null` 로 떨어뜨린다 — `mainStrings` 가 그때 `en` 을 준다(침묵보다 영어가 낫다).
 */
function safeUiLocale(): string | null {
  try {
    return getUiLocale();
  } catch {
    return null;
  }
}

/**
 * 종료 정리의 **시간 상한**. 소켓 `close()` 는 열려 있던 연결이 전부 끝나야 콜백이 오므로
 * (폰이 붙어 있거나 keep-alive 가 살아 있으면 분 단위로 끌린다) 상한이 없으면 프로세스가
 * 언제 사라지는지 아무도 모른다. 2026-08-27 실측 68초 — 그 사이 업데이트 설치기가 포기했다.
 * 여기까지 기다렸으면 남은 것은 버리고 나간다(작업안의 내구 저장은 이 정리 시작 전에 끝난다).
 */
const QUIT_CLEANUP_TIMEOUT_MS = 4000;
/** 설치기 spawn 직후 프로세스를 내리기까지의 여유 — detached 자식이 완전히 뜨는 시간. */
const UPDATE_INSTALL_SPAWN_GRACE_MS = 200;

let quitting = false;
let preparingQuit = false;
let quitConfirmed = false;
const quitConfirmation = createQuitConfirmationGate();

async function flushDraftsBeforeClose(owner: BrowserWindow | null): Promise<boolean> {
  return waitForDurableDrafts(() => flushRendererDrafts(), async () => {
    releaseRendererDrafts();
    const s = mainStrings(safeUiLocale());
    const result = await showAppMessageBox({
      type: 'warning', buttons: [s.quitBtnCancel, s.draftSaveRetry], defaultId: 1, cancelId: 0,
      title: s.draftSaveTitle, message: s.draftSaveMessage,
      locale: safeUiLocale() ?? undefined, theme: safeAppThemeChrome(),
    }, owner);
    return result.response === 1;
  });
}

app.on('before-quit', (event) => {
  if (quitting || preparingQuit) { event.preventDefault(); return; }
  // Declining/closing the pre-start gate must not run project shutdown or persistence.
  if (!backendStartAttempted) { quitting = true; logCleanExit(); return; }

  // 헤드리스 자식은 우리 프로세스의 자식이라 앱이 내려가면 **함께 죽는다.** 대화는 세션에 남아
  //   다음 턴이 `--resume` 으로 잇지만(부팅 reconcile 이 자동으로 재개한다), 그 턴이 만들던
  //   **커밋 전 편집은 돌아오지 않는다.** 닫기 전에 한 번 묻는 것이 유일한 예방이다.
  //   물음은 사용자가 실수로 닫는 경우만 막는다 — [닫기] 를 고르면 종전과 똑같이 진행한다.
  // ⚠️ 업데이트 설치로 인한 종료는 **묻지 않는다** — 렌더러의 §4 v2.63 확인 모달이 이미
  //   같은 손실을 경고하고 확인까지 받았다(SSOT 2026-08-12 항목도 "업데이트 쪽은 이미 같은
  //   경고를 하고 있었다"를 근거로 이 물음을 평범한 닫기에만 추가한 것이다). 여기서 또 물으면
  //   같은 경고가 두 번 뜨고, 사용자가 답하는 동안 종료가 늦어져 설치기가 포기한다.
  // 부팅 오류창에서 이미 다시 시작/종료를 골랐다. 두 번째 취소창으로 돌아가면
  // 정상 창도 없는 부분 초기화 프로세스만 남으므로, 종료 정리로 바로 넘긴다.
  const work = quitConfirmed || isUpdateInstallPending() || backendBootFailed ? null : safeRunningWorkSummary();
  if (work && (work.sessions > 0 || work.backgroundTasks > 0)) {
    // 언어는 서버 코어가 들고 있는 UI 로케일 하나를 따른다 — main 에는 i18next 가 없다(./strings).
    const s = mainStrings(safeUiLocale());
    const labels = work.labels.slice(0, 4).join(', ');
    const detail = [
      work.sessions > 0
        ? (work.labels.length > 0
          ? fmt(s.quitSessionsWithLabels, { count: work.sessions, labels })
          : fmt(s.quitSessions, { count: work.sessions }))
        : '',
      work.backgroundTasks > 0 ? fmt(s.quitBackgroundTasks, { count: work.backgroundTasks }) : '',
      s.quitDetailNote,
    ].filter(Boolean).join(String.fromCharCode(10));
    event.preventDefault();
    quitConfirmation.request(async () => {
      const result = await showAppMessageBox({
        type: 'warning', buttons: [s.quitBtnCancel, s.quitBtnClose], defaultId: 0, cancelId: 0, destructiveId: 1,
        title: s.quitTitle, message: s.quitMessage, detail,
        locale: safeUiLocale() ?? undefined, theme: safeAppThemeChrome(),
      }, primaryMainWindow);
      return result.response === 1;
    }, () => { quitConfirmed = true; app.quit(); }, (error) => mainDiagnostics.report('quit-confirmation', error));
    return;
  }

  event.preventDefault();
  preparingQuit = true;
  void flushDraftsBeforeClose(primaryMainWindow).then((saved) => {
    if (!saved) { quitConfirmed = false; return; }
    quitting = true;
    finishApprovedQuit();
  }).catch((error: unknown) => {
    quitConfirmed = false;
    mainDiagnostics.report('quit-confirmation', error);
  }).finally(() => { preparingQuit = false; });
});

function finishApprovedQuit(): void {
  // crashLog — 정상 종료 마커. 다음 부팅 배너 이전에 이 줄이 있으면 지난 실행은 정상 종료,
  // 없으면 그 사이 팅긴 것으로 판별된다.
  logCleanExit();

  // §9 「시작 화면(스플래시)」 — 이번 실행에서 바꾼 언어·테마를 다음 스플래시의 첫 칠로 남긴다(표시 캐시 — 바뀐 값만 쓴다).
  if (!backendBootFailed) saveSplashDisplayCache();

  // Durable writes have succeeded while IPC/the server were still available. Only now may
  // windows be destroyed, writers shut down, and the bounded cleanup watchdog start.
  const windowsClosed = Promise.resolve().then(() => {
    closeAllVerificationTargets();
    // §5.4 #14-1 — 메인 종료 시 detached 별창 일괄 정리(서버 영속화 ❌, in-memory 라 자연 소멸).
    closeAllDetachedWindows();
    // §5.5 #17-6 — 오버레이 위젯 창 일괄 정리.
    closeAllOverlays();
    // §5.12 — 지휘통제실 창 일괄 정리(영속화 ❌ — 재시작 시 복원하지 않는다).
    closeAllCommandCenters();
  }).catch((err: unknown) => {
    console.warn('[main] window cleanup failed:', err);
  });

  // §4 v2.44 — 업데이트 체크 타이머 해제.
  stopAutoUpdater();

  // §4 v2.63 — 살아있는 임베디드 터미널 PTY 일괄 종료(좀비 셸 방지).
  killAllTerminals();

  ipcHub?.stop();
  ipcHub = null;

  const listenerClose = hookListener
    ? new Promise<void>((resolve) => {
        // close() 는 **열려 있는 연결이 다 끝나야** 콜백이 온다. 훅 curl 이 물고 있으면
        // 그만큼 종료가 밀리므로 소켓을 먼저 끊는다(node 18.2+, 없으면 조용히 건너뜀).
        try { hookListener!.closeAllConnections?.(); } catch { /* 이미 닫힘/미지원 */ }
        hookListener!.close(() => resolve());
      })
    : Promise.resolve();
  hookListener = null;

  // §4 메신저 브리지 — 아웃바운드 연결·재시도 타이머 정리(닫을 리스너 소켓은 없다).
  const chatClose = stopChatBridge().catch((err: unknown) => {
    console.warn('[main] stopChatBridge failed:', err);
  });

  // §4 v3.16 — 모바일 웹 접속 리스너 정리(켜져 있던 경우만 실 소켓 close).
  const mobileClose = stopMobileAccess().catch((err: unknown) => {
    console.warn('[main] stopMobileAccess failed:', err);
  });

  // Persistent SubAgent children — VS Code Claude Code 확장과 같은 long-lived 모델에서
  // 살아있는 claude 자식들을 깨끗이 종료. 마킹 → stdin.end → SIGTERM → 2s 후 SIGKILL.
  // 마킹 없이 죽이면 close 핸들러가 crash 경로로 분기해 다음 부팅 시 잔여 sessionId 로 오탐.
  const subShutdown = subAgentManager.shutdownAllPersistentChildren().catch((err: unknown) => {
    console.warn('[main] shutdownAllPersistentChildren failed:', err);
  });

  // §5.14 v4.62 — 플레이 버블이 띄운 서버 정리. **우리가 띄운 포트만** 죽인다(사용자가 직접
  // 켠 서버는 건드리지 않는다). 정적 호스트 소켓도 함께 닫는다 — 안 닫으면 다음 실행에서
  // 포트만 늘어난다.
  const playShutdown = stopAllPlays()
    .catch((err: unknown) => {
      console.warn('[main] stopAllPlays failed:', err);
    })
    .finally(() => {
      closeStaticHost();
    });

  // §5.19 — All Model 이 띄운 로컬 엔진(llama-server) 자식 정리. 이걸 안 하면 모델이 올라간
  //   메모리를 그대로 문 채 프로세스가 남아, 앱을 껐는데도 자원이 안 돌아온다.
  try {
    unloadAllLocalModels();
  } catch (err) {
    console.warn('[main] unloadAllLocalModels failed:', err);
  }

  // §9 — 코얼레스된 체크포인트 창을 **지금 동기로** 마무리한다(§3.2.1 내구성).
  //   ⚠ 반드시 아래 `shutdownDiskWriteQueue()` **앞**이다 — 순서가 뒤집히면 이 저장이 만든 쓰기가
  //     큐에 남은 채 프로세스가 사라진다. 예약이 없으면 no-op 이라 종료가 느려지지 않는다.
  //   ⚠ 이것이 없으면 서버의 `process 'exit'` 만 남는데, 우리 종료 경로는 전부 `app.exit(0)` 이라
  //     그 이벤트가 돌지 않을 수 있다 — 정상 종료·업데이트 설치마다 마지막 창(0.5~5초) 분량이
  //     조용히 사라지던 자리다.
  try {
    flushPendingCheckpointSave();
  } catch (err) {
    console.warn('[main] flushPendingCheckpointSave failed:', err);
  }

  // §9 — 체크포인트 디스크 쓰기 워커: 남은 쓰기를 동기로 마무리하고 스레드를 내린다.
  //   여기서 정리해 두면 뒤따르는 process 'exit' flush 는 아무것도 남지 않은 상태에서 no-op 이 된다.
  try {
    shutdownDiskWriteQueue();
  } catch (err) {
    console.warn('[main] shutdownDiskWriteQueue failed:', err);
  }

  // 정리가 끝나면(또는 상한을 넘기면) **한 번만** 실제 종료한다.
  // §4 v2.44 — 업데이트 설치기는 바로 여기, 프로세스가 사라지기 직전에 띄운다. 설치기의
  //   파일 교체(언인스톨러의 rename)는 살아 있는 `Vibisual.exe` 를 만나면 그대로 실패하므로,
  //   "설치기 먼저 → 정리" 순서였던 종전 경로에서는 정리가 조금만 길어져도 업데이트가 깨졌다.
  let quitWatchdog: NodeJS.Timeout | null = null;
  let finished = false;
  const finishQuit = (): void => {
    if (finished) return;
    finished = true;
    if (quitWatchdog) { clearTimeout(quitWatchdog); quitWatchdog = null; }
    // Child shutdown may emit final stream events after the initial checkpoint
    // flush. Electron app.exit does not guarantee Node's exit listeners run.
    try {
      flushPendingStreamWrites();
    } catch (err) {
      console.warn('[main] flushPendingStreamWrites failed:', err);
    }
    if (runPendingUpdateInstall()) {
      setTimeout(() => app.exit(0), UPDATE_INSTALL_SPAWN_GRACE_MS);
      return;
    }
    app.exit(0);
  };
  quitWatchdog = setTimeout(() => {
    console.warn(`[main] shutdown cleanup exceeded ${QUIT_CLEANUP_TIMEOUT_MS}ms — exiting anyway`);
    finishQuit();
  }, QUIT_CLEANUP_TIMEOUT_MS);

  // The durable flush barrier has already completed; this watchdog only bounds service cleanup.
  Promise.all([windowsClosed, listenerClose, mobileClose, chatClose, subShutdown, playShutdown]).finally(finishQuit);
}
