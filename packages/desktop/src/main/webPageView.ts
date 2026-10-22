import type { WebContents, WebPreferences } from 'electron';
import { WEB_PAGE_PARTITION, isHttpUrl } from '@vibisual/shared';

/**
 * §5.23 「더블클릭」 · §7.11 — **인터넷 페이지는 격리 웹뷰로만 들어온다.**
 *
 * 도메인 버블을 앱 안에서 열면 그 페이지는 iframe 탭 안의 `<webview>` 로 뜬다. 본체 창의 iframe 에 직접 싣지 않는 이유는
 * 셋이다 — ① 본체·별창은 `sandbox:false` 라 그 하위 프레임 프로세스도 샌드박스 없이 돈다 ② 기본 세션의 권한 처리기는
 * "바깥 주소는 이 세션에 뜨지 않는다"는 전제로 전부 허락한다 ③ 기본 세션에는 `vibproxy://`(로컬 프리뷰 프록시) 처리기가 있다.
 * 웹뷰는 **손님 webContents** 라 설정을 따로 줄 수 있고, 그 설정을 정하는 것은 렌더러가 아니라 여기다 — 렌더러가 무엇을
 * 적어 보냈든(`preload`·`nodeintegration`·`webpreferences` 속성) 아래 값이 이긴다(Electron 보안 지침 "Verify WebView options").
 *
 * 이 파일은 electron 을 **형(type)으로만** 읽는다 — 판정이 electron 에 붙어 있으면 시험이 영영 닿지 않는다(vitest 설정 머리말).
 * 세션의 권한 처리기는 electron 을 직접 부르는 `webPageSession.ts` 가 세우고, 여기에는 주입으로 들어온다.
 */

/** 손님 설정에 주입되는 바깥 일 — 시험이 가짜로 바꿔 끼운다. */
export interface WebPageGuardDeps {
  /** 격리 세션의 권한 처리기를 세운다(여러 번 불려도 한 번만 한다). */
  prepareSession: () => void;
  /** 손님이 연 새 창을 바깥 브라우저로 넘긴다(앱에 하나뿐인 여는 길 — `openExternalWithNotice`). */
  openExternal: (url: string, sender: WebContents) => void;
}

/** 웹뷰가 처음 열 주소로 받아도 되는가 — http(s) 만. `file:`·`vibproxy:`·`javascript:` 는 손님으로 띄우지 않는다. */
export function isWebPageGuestSrc(src: unknown): boolean {
  return typeof src === 'string' && isHttpUrl(src);
}

/**
 * 손님 설정을 **다시 쓴다**(제자리 수정 — `will-attach-webview` 가 넘긴 객체를 Electron 이 그대로 손님 생성에 쓴다).
 *
 * - 전용 메모리 세션(`WEB_PAGE_PARTITION`) — 쿠키를 디스크에 남기지 않고, 기본 세션의 처리기(권한 "전부 허락"·`vibproxy://`)가 없다.
 * - 샌드박스 · contextIsolation · Node 없음 · preload 없음 · 웹뷰 중첩 없음 · 플러그인 없음 · 실험 기능 없음.
 * - 새 창 요청은 막지 않는다 — 막으면 `target=_blank` 링크가 아무 일도 안 한다. 대신 손님의 `setWindowOpenHandler` 가
 *   창을 만들지 않고 바깥 브라우저로 넘긴다(`guardWebPageGuest`).
 */
export function sanitizeWebPageGuestPreferences(prefs: WebPreferences): void {
  const loose = prefs as Record<string, unknown>;
  delete loose['preload'];
  delete loose['preloadURL'];
  delete loose['enableBlinkFeatures'];
  prefs.partition = WEB_PAGE_PARTITION;
  prefs.sandbox = true;
  prefs.contextIsolation = true;
  prefs.nodeIntegration = false;
  prefs.nodeIntegrationInSubFrames = false;
  prefs.nodeIntegrationInWorker = false;
  prefs.webSecurity = true;
  prefs.allowRunningInsecureContent = false;
  prefs.webviewTag = false;
  prefs.plugins = false;
  prefs.experimentalFeatures = false;
  prefs.navigateOnDragDrop = false;
  prefs.safeDialogs = true;
  loose['disablePopups'] = false;
}

/** 손님의 최상위 이동을 막아야 하는가 — http(s) 밖으로는 가지 못한다(브라우저 안의 이동은 그대로 둔다). */
export function shouldBlockWebPageNavigation(url: string): boolean {
  return !isHttpUrl(url);
}

/** 붙은 손님 하나를 잠근다 — 새 창은 바깥 브라우저, http(s) 밖으로의 이동은 막는다. */
export function guardWebPageGuest(guest: WebContents, embedder: WebContents, deps: WebPageGuardDeps): void {
  guest.setWindowOpenHandler(({ url }) => {
    // 남의 페이지가 연 창이다 — http(s) 만 바깥으로 넘긴다(`mailto:` 같은 OS 처리기를 남의 페이지가 부르게 두지 않는다).
    if (isHttpUrl(url)) deps.openExternal(url, embedder);
    return { action: 'deny' };
  });
  const guard = (event: { preventDefault: () => void }, url: string): void => {
    if (shouldBlockWebPageNavigation(url)) event.preventDefault();
  };
  guest.on('will-navigate', guard);
  guest.on('will-redirect', guard);
}

/**
 * 이 webContents 가 붙이려는 웹뷰를 지킨다. 창마다 한 번(`web-contents-created`).
 * 웹뷰를 쓰지 않는 창(웹뷰 태그가 꺼진 창)에서는 이 사건이 오지 않으므로 아무 일도 없다.
 */
export function guardWebPageAttach(contents: WebContents, deps: WebPageGuardDeps): void {
  contents.on('will-attach-webview', (event, prefs, params) => {
    if (!isWebPageGuestSrc(params['src'])) {
      event.preventDefault();
      return;
    }
    deps.prepareSession();
    sanitizeWebPageGuestPreferences(prefs);
  });
  contents.on('did-attach-webview', (_event, guest) => {
    guardWebPageGuest(guest, contents, deps);
  });
}
