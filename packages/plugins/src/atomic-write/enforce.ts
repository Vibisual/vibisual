import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "atomic-write",
  title: "원자적 쓰기",
  rules: [
    "파일을 덮어쓸 때는 임시 파일에 쓰고 이름을 바꾸는 방식으로 하라 — 중간에 죽으면 반쪽 파일이 남는다.",
    "기존 파일을 지우고 다시 만들지 마라. 먼저 읽고 바꿀 부분만 바꿔라.",
  ],
});
