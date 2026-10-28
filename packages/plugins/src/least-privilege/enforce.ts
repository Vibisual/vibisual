import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "least-privilege",
  title: "최소 권한",
  rules: [
    "지금 작업에 필요한 도구만 써라 — 쓸 수 있다고 다 쓰지 마라.",
    "권한을 넓혀야 풀리는 상황이면 넓히기 전에 이유를 말하고 승인을 받아라.",
  ],
});
