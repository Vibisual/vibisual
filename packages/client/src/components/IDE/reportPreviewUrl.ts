import { isLoopbackPreviewUrl } from '@vibisual/shared';

/**
 * §7.11 — **누른 그 주소를 프리뷰로도 띄운다.**
 *
 * IDE 본문·터미널에 찍힌 `http://localhost:8080` 을 누르면 지금까지는 외부 브라우저만 열렸다.
 * 그런데 그 클릭이야말로 사람이 직접 내리는 가장 확실한 신고다 — "이건 내가 보려는 서버다".
 * 감지 폴백이 놓친 서버(이미 떠 있던 것을 그대로 쓴 경우 등)를 **토큰 한 자 없이** 회수하는 자리다.
 *
 * 서버 `/api/agent-iframe` 은 이미 신고 경로의 게이트를 통째로 들고 있다(포트 listen 확인 →
 * 접속되는 별칭으로 실응답 확인 → 위성 + ServerEntry 등록). 그래서 여기서 할 일은 루프백인지
 * 한 번 거르고 그 엔드포인트에 넘기는 것뿐이다 — 새 통신 레일 ❌.
 *
 * 표시 전용이라 실패는 조용히 삼킨다. 브라우저를 여는 동작은 이 함수와 무관하게 그대로 진행된다.
 */
export function reportPreviewUrlIfLoopback(url: string, agentId: string | undefined): void {
  if (!agentId || !isLoopbackPreviewUrl(url)) return;
  void fetch('/api/agent-iframe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId, url }),
  }).catch(() => { /* 표시 전용 — 무시 */ });
}
