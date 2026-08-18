/**
 * containment — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "containment",
  title: "이미 뚫렸다고 가정하라",
  rules: [
    "침해가 이미 일어났다고 가정하고 지금 상태에서 무엇까지 가능한지 먼저 확인하라.",
    "격리 없이 외부에서 받은 코드를 실행하지 마라.",
  ],
});
