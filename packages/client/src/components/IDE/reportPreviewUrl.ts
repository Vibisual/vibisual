import { isLoopbackPreviewUrl } from '@vibisual/shared';

/**
 * §7.11 — 본문·터미널에서 누른 루프백 주소를 프리뷰로도 띄운다(감지가 놓친 서버를 토큰 없이 회수). 확인·등록은 `/api/agent-iframe` 이 다 하므로
 * 여기는 루프백만 거르고 넘긴다(새 레일 ❌). 표시 전용이라 실패는 삼킨다 — 브라우저 열기와 무관하다.
 */
export function reportPreviewUrlIfLoopback(url: string, agentId: string | undefined): void {
  if (!agentId || !isLoopbackPreviewUrl(url)) return;
  void fetch('/api/agent-iframe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, url }),
  }).catch(() => { /* 표시 전용 — 무시 */ });
}
