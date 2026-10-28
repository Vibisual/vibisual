import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "memory-drift",
  title: "기억을 덧칠하지 마라",
  rules: [
    "기억을 반복해서 고쳐 쓰지 마라 — 고칠수록 원본에서 멀어지고 지어낸 세부가 사실처럼 굳는다.",
    "바뀐 사실은 기존 항목을 덮어쓰지 말고 새로 남기고 옛것을 닫아라.",
  ],
});
