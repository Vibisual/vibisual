import { WORKSPACE_SITE_PATH, workspaceSiteUrl } from '@vibisual/shared';

import { isPackagedDesktop } from '../transport/index.js';

/** 우리 파일 창구는 HTTP 서버 프록시로 다시 감싸지 않는다. */
export function isWorkspaceSiteSrc(url: string): boolean {
  return url.startsWith(`${WORKSPACE_SITE_PATH}/`)
    || url.startsWith(`vibproxy://proxy${WORKSPACE_SITE_PATH}/`);
}

/**
 * §5.5 #17-27 ⑮ 편집창의 페이지 미리보기가 물릴 iframe src. `toProxyUrl`(§5.14)과 **같은 규칙**이다.
 * 패키지 Electron 은 renderer 가 `file://` 라 `<iframe src="/api/…">` 가 `file:///api/…` 로 깨진다(엘리먼트 요청은 transport fetch 패치를 안 탄다, §3.7) —
 * `vibproxy://` 를 거치면 `protocol.handle` 이 in-process Express 로 합성 디스패치한다. 호스트가 고정 `proxy` 인 것도 같은 이유 — 페이지의 상대 경로 자산이
 * 같은 오리진으로 다시 들어와야 CSS·그림·스크립트가 산다.
 */
export function workspaceSiteSrc(root: string, relPath: string, cacheToken = 0): string {
  const path = workspaceSiteUrl(root, relPath, cacheToken);
  return isPackagedDesktop() ? `vibproxy://proxy${path}` : path;
}
