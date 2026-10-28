import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "blast-radius",
  title: "닿는 범위를 먼저 말하라",
  rules: [
    "되돌릴 수 없는 변경 전에 그 변경이 닿는 범위를 한 줄로 말하라.",
    "한 번에 필요 이상으로 넓게 바꾸지 마라 — 나눌 수 있으면 나눠서 하라.",
  ],
});
