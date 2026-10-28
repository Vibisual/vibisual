// SCENARIO.md §3.7 · §9 「시작 화면(스플래시)」 — **시작 진입점.** 빌드의 main 입구(`out/main/index.cjs`)는 이 파일이다.
// 스플래시를 먼저 띄우고 본체(`index.ts` — 서버 코어 전부)를 읽는다. 실측(7회): 본체 첫 줄까지 4.4~5.4초(재설치·업데이트 직후 첫 실행), 서버 기동 동기 구간
// 4.2~6.2초, 첫 창은 약 10초 — 이 파일은 Electron 이 뜬 직후(0.05초)에 돌아 스플래시가 0.3초 안팎에 보인다.
// **가볍게 남아야 한다** — 서버 코어·shared 값을 정적으로 부르지 않고, 본체는 `import('./index')` 로만 읽는다(별도 청크). `bootstrap.test.ts` 가 원문으로 지킨다.
// 여기 있는 것은 `ready` 전에 해야 하는 일과 스플래시뿐: vibproxy 스킴 등록 · Linux 캡처 스위치 · 크래시 수집과 부팅 배너 · 단일 인스턴스 잠금 ·
// 앱 사용자 모델 ID(Windows 작업 표시줄에서 스플래시와 본체가 한 묶음이 되게).

import { app, protocol } from 'electron';
import { showAppMessageBox } from './appMessageBox';
import { electronApp } from '@electron-toolkit/utils';
import { installBootErrorLog } from './bootErrors';
import { appendCrashLine, logAppStart, logCleanExit, startCrashReporter } from './crashLog';
import { isHookCleanupRun } from './hookLifecycle';
import { logStartupMilestone, markSplashShown, startMainStallLog } from './mainStallLog';
import { readSplashCache } from './splashCache';
import { resolveSplashLocale, SPLASH_FALLBACK_BACKGROUND } from './splashPolicy';
import { splashStrings } from './splashStrings';
import { openSplash, type SplashHandle } from './splashWindow';

// §3.7 — iframe 서버 프리뷰용 커스텀 스킴 등록(app.ready 전 필수).
// renderer 는 file:// 로 로드되므로 <iframe src="/iframe-proxy/…"> 상대경로가
// file:///iframe-proxy/… 로 깨진다(fetch 몽키패치는 엘리먼트 로드를 못 가로챔).
// vibproxy:// 스킴이 main 의 protocol.handle 을 거쳐 in-process Express(iframe 프록시)에
// 합성 디스패치된다. standard=호스트/경로 파싱(iframe 내부 root-relative 링크 해석용).
protocol.registerSchemesAsPrivileged([
  { scheme: 'vibproxy', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// §5.9 화면/프로그램 캡처 — Linux Wayland 세션에서 desktopCapturer 가 소스를 못 받는 것을 막는다.
// Wayland 는 X11 처럼 아무 창이나 긁게 두지 않고 PipeWire 포털을 거치게 하는데,
// Chromium 은 이 스위치가 있어야 그 경로를 쓴다. 없으면 X11 캡처러로 폴백해
// 소스 목록이 비거나 검은 화면이 잡힌다(Ubuntu 22.04+·Fedora 는 기본이 Wayland).
// ⚠️ app.whenReady() **이전**에 설정해야 먹는다 — 아래로 옮기지 마라.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}

// crashLog(§4) — 네이티브 크래시 minidump 수집을 app ready·창 생성 전에 켜고, 이번 실행의 부팅 배너를 crash.log 에 남긴다
// (clean exit 마커 없이 다음 배너로 넘어갔으면 그 사이에 팅긴 것).
startCrashReporter();
logAppStart();
// 본체가 자기 진단기를 걸기 전 구간(스플래시 만들기·본체 읽기)의 오류도 crash.log 에 남긴다.
installBootErrorLog();

/** 본체(`index.ts`)가 돌려주는 손잡이 — 두 번째 실행·Dock 클릭을 넘긴다. */
interface LaunchedApp {
  onSecondInstance(): void;
  onActivate(): void;
}

// §3.6 「수명」 · §5.7 #24-3 ⑤ — Windows 제거기가 파일을 지우기 **전**에 `--vibisual-remove-hooks` 로 부른다. 잠금·스플래시·
// 본체·서버 없이 설정 파일에 남은 우리 훅만 걷고 끝낸다(`hookCleanup.ts` — 본체처럼 동적으로만 읽는다). 잠금을 잡지 않으므로
// 떠 있는 앱이 있어도 그 창을 불러내지 않는다.
const hookCleanupRun = isHookCleanupRun(process.argv);

// 단일 인스턴스 락 — 2번째 실행이 백엔드를 또 부팅해 ~/.claude/settings.json 의 hook 포트를 자기 동적 포트로 덮어쓰는
// 사고를 원천 차단한다(상세는 `index.ts` `launchApp`). **스플래시보다 먼저** 잡는다 — 못 잡은 쪽이 스플래시를 한 번
// 번쩍이고 사라지면 안 된다. 못 잡으면 즉시 끝내고, 기존 인스턴스가 자기 창(또는 스플래시)을 앞으로 가져온다.
const gotSingleInstanceLock = !hookCleanupRun && app.requestSingleInstanceLock();
if (hookCleanupRun) {
  void import('./hookCleanup')
    .then((m) => { m.removeHooksForUninstall(); })
    .catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      appendCrashLine('main', 'error', `[hook-cleanup] failed: ${err.message}`, err.stack);
    })
    .finally(() => {
      logCleanExit();
      void app.whenReady().then(() => app.exit(0));
    });
} else if (!gotSingleInstanceLock) {
  logCleanExit();
  app.quit();
} else {
  // 첫 칠에 실패한 스플래시는 숨긴 채 버린다. 그 창이 유일한 창이어도 본체를 읽기 전에 앱이 끝나면 안 된다.
  // 본체가 자기 window-all-closed 처리기를 설치할 때까지만 시작 진입점이 이 사건을 맡는다.
  const keepBooting = (): void => {};
  app.on('window-all-closed', keepBooting);
  let splash: SplashHandle | null = null;
  let launched: LaunchedApp | null = null;
  app.on('second-instance', () => {
    if (launched) launched.onSecondInstance();
    else splash?.focus();
  });
  app.on('activate', () => {
    if (launched) launched.onActivate();
    else splash?.focus();
  });

  void app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.vibisual.app');

    // §3.7 · §9 「창이 뜬 직후의 메인 스레드」 ④ — 메인 스레드 멈춤을 늘 잰다. 본체를 읽기 **전에** 건다 — 본체 읽기·서버
    //   기동의 동기 구간이 얼마나 막았는지도 한 줄씩 남는다(스플래시가 떠 있던 구간은 `splash+` 로 적힌다).
    startMainStallLog();

    // 지난 실행이 남긴 언어·바탕(표시 캐시). 없으면 OS 언어·기본 바탕.
    const cache = readSplashCache();
    const locale = resolveSplashLocale(cache?.locale, app.getLocale());
    splash = await openSplash({
      locale,
      background: cache?.background ?? SPLASH_FALLBACK_BACKGROUND,
      kind: cache?.kind ?? 'dark',
      version: app.getVersion(),
    });
    if (splash) {
      markSplashShown();
      logStartupMilestone('splash shown');
      // 본체를 읽는 동안은 동기라 소식을 보낼 수 없다 — 그 전에 보내 둔다(스플래시는 천장 쪽으로 혼자 다가간다).
      splash.stage('loading');
    }

    let main: typeof import('./index');
    try {
      main = await import('./index');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      appendCrashLine('main', 'fatal', `[boot] main module failed to load: ${err.message}`, err.stack);
      splash?.close();
      const s = splashStrings(locale);
      try {
        await showAppMessageBox({ type: 'error', title: s.loadFailedTitle, message: s.loadFailedMessage,
          buttons: [s.loadFailedClose], locale, theme: cache ?? undefined });
      } catch { /* 안내 실패 — 기록은 남았다 */ }
      app.exit(1);
      return;
    }
    launched = main.launchApp({ splash });
    app.removeListener('window-all-closed', keepBooting);
  });
}
