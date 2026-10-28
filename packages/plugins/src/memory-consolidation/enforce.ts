import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "memory-consolidation",
  title: "증류하되 원본을 남겨라",
  rules: [
    "경험을 사실로 요약할 때 원본을 대체하지 말고 **추가**하라 — 증류는 손실이다.",
    "요약이 원본과 어긋나면 요약을 고치지 말고 어긋난 사실을 보고하라.",
  ],
});
