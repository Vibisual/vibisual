/**
 * graceful-degradation — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "graceful-degradation",
  title: "막히면 통과가 아니라 정지",
  rules: [
    "판단이 안 서면 통과시키지 말고 멈춰라 — 관문은 안전한 쪽으로 실패해야 한다.",
    "승인 요청이 응답 없이 끝나면 승인된 것으로 간주하지 마라.",
  ],
});
