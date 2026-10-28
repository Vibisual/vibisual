import { IFRAME_PROXY_PATH } from '@vibisual/shared';

import { isPackagedDesktop } from '../transport/index.js';
import { isWorkspaceSiteSrc } from './workspaceSite.js';

/**
 * 원본 URL → iframe 프록시 URL(in-process Express 의 iframe 프록시 → 대상 서버).
 * 패키지 Electron 은 renderer 가 file:// 라 상대경로 `/iframe-proxy/…` 가 `file:///iframe-proxy/…` 로 깨진다 — main 의 `vibproxy://` 스킴을 거치면
 * protocol.handle 이 in-process 서버로 디스패치한다. 호스트 세그먼트는 고정값 `proxy` — 프록시된 페이지의 root-relative `/iframe-proxy/…` 링크가 같은 오리진으로 들어오게.
 * §5.14 — 탭 프리뷰(`IframeView`)와 캔버스 프리뷰(`PlayPreviewNode`)가 같은 규칙을 써야 한쪽만 흰 화면이 되지 않는다. 그래서 이 함수는 여기 한 곳에만 둔다.
 */
export function toProxyUrl(raw: string): string {
  if (isWorkspaceSiteSrc(raw)) {
    return raw.startsWith('/') && isPackagedDesktop() ? `vibproxy://proxy${raw}` : raw;
  }
  try {
    const parsed = new URL(raw);
    const proxyPath = `${IFRAME_PROXY_PATH}/${parsed.host}${parsed.pathname}${parsed.search}`;
    return isPackagedDesktop() ? `vibproxy://proxy${proxyPath}` : proxyPath;
  } catch {
    return raw;
  }
}
