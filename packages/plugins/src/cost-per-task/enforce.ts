/**
 * cost-per-task — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "cost-per-task",
  title: "일당 비용으로 판단하라",
  rules: [
    "토큰 단가가 아니라 **끝낸 일 하나당 비용**으로 판단하라.",
    "성과 없이 턴만 늘고 있으면 계속하지 말고 멈춰서 보고하라.",
  ],
});
