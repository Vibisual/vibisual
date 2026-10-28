import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "non-human-identity",
  title: "이 에이전트만 끊을 수 있게",
  rules: [
    "지금 이 에이전트 하나만 멈출 수 있는 상태를 유지하라 — 전체를 멈춰야만 끊긴다면 그 사실을 보고하라.",
    "여러 에이전트가 같은 자격증명·같은 세션을 공유하게 만들지 마라.",
  ],
});
