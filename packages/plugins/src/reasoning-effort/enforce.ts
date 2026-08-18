/**
 * reasoning-effort — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "reasoning-effort",
  title: "생각의 양을 맞춰라",
  rules: [
    "일의 크기에 맞게 생각하라 — 작은 일에 길게 생각하지 말고, 큰 일을 즉답하지 마라.",
    "더 생각해도 결론이 안 바뀌면 멈추고 실행하라.",
  ],
});
