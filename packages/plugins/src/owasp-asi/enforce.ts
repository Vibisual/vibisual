/**
 * owasp-asi — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "owasp-asi",
  title: "에이전트 고유 위험 점검",
  rules: [
    "목표 탈취·도구 오남용·신원 혼동·기억 오염·통제 이탈 중 지금 작업이 건드리는 것이 있으면 먼저 말하라.",
    "위험이 하네스(도구·권한·격리)에서 오는지 먼저 보라 — 대부분 거기서 온다.",
  ],
});
