import { session, type WebContents } from 'electron';
import { WEB_PAGE_PARTITION } from '@vibisual/shared';
import { openExternalWithNotice } from './externalOpen';
import { guardWebPageAttach, type WebPageGuardDeps } from './webPageView';

/**
 * §5.23 「더블클릭」 — 인터넷 페이지를 띄우는 격리 웹뷰의 세션(`WEB_PAGE_PARTITION`)에 **권한 거절**을 세운다.
 *
 * 기본 세션은 전부 허락한다(§5.5 #17-38 — 그 세션에 뜨는 것은 우리 번들과 로컬 프리뷰뿐이라는 전제). 이 세션에는 남의
 * 페이지가 뜨므로 거꾸로 **전부 거절**한다 — 마이크·카메라·위치·알림·클립보드 읽기·장치(HID/USB/직렬)·바깥 프로그램 열기.
 * 페이지를 보는 데에는 어느 것도 필요 없고, 필요한 일은 [브라우저에서 열기]로 사용자의 브라우저에서 한다.
 *
 * 세션은 처음 웹뷰가 붙을 때 한 번만 세운다(`app.ready` 뒤 — `session.fromPartition` 은 그 전에 부를 수 없다).
 */
let prepared = false;

export function prepareWebPageSession(): void {
  if (prepared) return;
  prepared = true;
  const guestSession = session.fromPartition(WEB_PAGE_PARTITION);
  guestSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  guestSession.setPermissionCheckHandler(() => false);
  guestSession.setDevicePermissionHandler(() => false);
}

const WEB_PAGE_GUARD_DEPS: WebPageGuardDeps = {
  prepareSession: prepareWebPageSession,
  openExternal: (url, sender) => openExternalWithNotice(url, sender),
};

/**
 * 이 창에서 인터넷 페이지 웹뷰를 띄울 수 있게 한다 — **웹뷰 태그(`webviewTag: true`)를 켠 창에서 창을 만든 그 자리에서** 부른다.
 *
 * 전역 `web-contents-created` 에 걸지 않는 이유: 본체 창은 그 등록보다 먼저 만들어질 수 있고, 그러면 그 창의 웹뷰는 가드 없이
 * 붙는다(손님 설정이 렌더러가 적은 그대로 — 샌드박스도 권한 거절도 없이). 태그를 켜는 자리와 가드를 거는 자리를 한 곳에 둬서
 * 둘이 갈라지지 않게 한다.
 */
export function allowWebPageViews(contents: WebContents): void {
  guardWebPageAttach(contents, WEB_PAGE_GUARD_DEPS);
}
