import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "human-in-the-loop",
  title: "되돌릴 수 없는 일은 먼저 물어라",
  rules: [
    "삭제·강제 푸시·외부 전송·설치처럼 되돌릴 수 없는 일은 실행 전에 사용자에게 물어라.",
    "되돌릴 수 있는 일까지 일일이 묻지 마라 — 다 물으면 승인이 의미를 잃는다.",
  ],
});
