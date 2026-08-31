import { workspaceSiteUrl } from '@vibisual/shared';

import { isPackagedDesktop } from '../transport/index.js';

/**
 * workspaceSite.ts — §5.5 #17-27 ⑮ 편집창의 페이지 미리보기가 물릴 **iframe src**.
 *
 * `toProxyUrl`(§5.14 v4.62)과 **같은 규칙**이다. 패키지 Electron 에서 renderer 는 `file://` 로
 * 로드되므로 `<iframe src="/api/…">` 가 `file:///api/…` 로 깨진다 — 엘리먼트가 스스로 내는 요청은
 * transport 의 fetch 몽키패치를 타지 않기 때문이다(§3.7). main 에 이미 등록된 `vibproxy://`
 * 스킴을 거치면 `protocol.handle` 이 in-process Express 로 합성 디스패치한다.
 *
 * 호스트 세그먼트가 고정값 `proxy` 인 것도 같은 이유다 — 페이지가 부르는 상대 경로 자산이
 * **같은 오리진**으로 다시 들어와야 CSS·그림·스크립트가 산다.
 */
export function workspaceSiteSrc(root: string, relPath: string, cacheToken = 0): string {
  const path = workspaceSiteUrl(root, relPath, cacheToken);
  return isPackagedDesktop() ? `vibproxy://proxy${path}` : path;
}
