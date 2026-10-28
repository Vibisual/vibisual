import { session, type WebContents } from 'electron';
import { WEB_PAGE_PARTITION } from '@vibisual/shared';
import { openExternalWithNotice } from './externalOpen';
import { guardWebPageAttach, type WebPageGuardDeps } from './webPageView';

/**
 * §5.23 「더블클릭」 — 인터넷 페이지용 격리 세션(`WEB_PAGE_PARTITION`)은 권한을 전부 거절한다(마이크·카메라·위치·알림·클립보드 읽기·장치·바깥 프로그램).
 * 기본 세션은 전부 허락이다(§5.5 #17-38 — 우리 번들·로컬 프리뷰만 뜬다는 전제). `session.fromPartition` 은 `app.ready` 뒤에만 — 첫 웹뷰 때 한 번 세운다.
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
 * `webviewTag: true` 창을 만든 그 자리에서 부른다. 전역 `web-contents-created` 에 걸지 않는다 — 본체 창이 그보다 먼저 만들어지면
 * 그 웹뷰는 가드 없이 붙는다. 태그와 가드를 한 곳에 둬 갈라지지 않게 한다.
 */
export function allowWebPageViews(contents: WebContents): void {
  guardWebPageAttach(contents, WEB_PAGE_GUARD_DEPS);
}
