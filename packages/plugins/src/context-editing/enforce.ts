import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "context-editing",
  title: "요약 말고 덜어내라",
  rules: [
    "오래된 도구 호출·결과는 요약하지 말고 규칙대로 덜어내라 — 요약은 손실이 크다.",
    "지금 필요 없는 내용을 다시 끌어오지 마라.",
  ],
});
