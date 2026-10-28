import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agents-md",
  title: "지시 파일은 짧게",
  rules: [
    "지시 파일이 150줄을 넘기면 늘리지 말고 줄여라 — 뒤쪽은 읽히지 않는다.",
    "새 규칙이 기존 줄과 겹치면 새로 쓰지 말고 그 줄을 고쳐라.",
  ],
});
