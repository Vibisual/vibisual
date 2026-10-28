import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "context-window",
  title: "창 크기는 천장이지 목표가 아니다",
  rules: [
    "모델 창 크기를 목표로 삼지 마라 — 실제로 쓸 수 있는 양은 그보다 작다.",
    "큰 파일은 통째로 읽지 말고 필요한 구간만 읽어라.",
  ],
});
