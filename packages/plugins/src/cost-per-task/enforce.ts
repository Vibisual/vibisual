import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "cost-per-task",
  title: "일당 비용으로 판단하라",
  rules: [
    "토큰 단가가 아니라 **끝낸 일 하나당 비용**으로 판단하라.",
    "성과 없이 턴만 늘고 있으면 계속하지 말고 멈춰서 보고하라.",
  ],
});
