import { IFRAME_PROXY_PATH } from '@vibisual/shared';

import { isPackagedDesktop } from '../transport/index.js';

/**
 * 원본 URL → iframe 프록시 URL 변환 (in-process Express 의 iframe 프록시 → 대상 서버).
 *
 * 패키지 Electron 에선 renderer 가 file:// 로 로드돼 상대경로 `<iframe src="/iframe-proxy/…">`
 * 가 `file:///iframe-proxy/…` 로 깨진다. main 에 등록된 `vibproxy://` 커스텀 스킴을 거치면
 * protocol.handle 이 in-process 서버로 합성 디스패치한다. 호스트 세그먼트는 고정값 `proxy`
 * — 프록시된 페이지가 재작성한 root-relative `/iframe-proxy/…` 링크가 같은 오리진으로
 * 다시 들어오게 한다.
 *
 * §5.14 v4.62 — 탭 프리뷰(`IframeView`)와 캔버스 프리뷰(`PlayPreviewNode`)가 **같은 규칙**을
 * 써야 한 쪽만 흰 화면이 되는 사고가 안 난다. 그래서 이 함수는 여기 한 곳에만 산다.
 */
export function toProxyUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const proxyPath = `${IFRAME_PROXY_PATH}/${parsed.host}${parsed.pathname}${parsed.search}`;
    return isPackagedDesktop() ? `vibproxy://proxy${proxyPath}` : proxyPath;
  } catch {
    return raw;
  }
}
