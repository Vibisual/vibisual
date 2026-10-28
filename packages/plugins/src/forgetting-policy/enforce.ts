import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "forgetting-policy",
  title: "지우는 규칙도 정하라",
  rules: [
    "기억을 늘릴 때는 언제 내릴지도 함께 정하라 — 늘기만 하는 기억은 정확도를 떨어뜨린다.",
    "낡은 기억을 발견하면 조용히 두지 말고 낡았다고 표시해 보고하라.",
  ],
});
