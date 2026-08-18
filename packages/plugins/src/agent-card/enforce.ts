/**
 * agent-card — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agent-card",
  title: "에이전트 능력 명세",
  rules: [
    "에이전트를 만들 때 할 수 있는 것뿐 아니라 **못 하는 것·실패 양상**을 함께 적어라.",
    "다른 에이전트에게 맡기기 전에 그 역할과 권한을 확인하고, 모르면 맡기지 마라.",
  ],
});
