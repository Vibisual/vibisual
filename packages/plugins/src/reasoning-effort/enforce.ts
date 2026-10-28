/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "reasoning-effort",
  title: "생각의 양을 맞춰라",
  rules: [
    "일의 크기에 맞게 생각하라 — 작은 일에 길게 생각하지 말고, 큰 일을 즉답하지 마라.",
    "더 생각해도 결론이 안 바뀌면 멈추고 실행하라.",
  ],
});
