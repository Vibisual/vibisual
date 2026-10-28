import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "fan-out",
  title: "정말 독립일 때만 병렬",
  rules: [
    "하위 작업이 **서로 독립일 때만** 병렬로 벌여라 — 아니면 중복 작업과 충돌이 남는다.",
    "병렬로 벌인 것은 전부 회수해 결과를 합친 뒤 보고하라. 하나라도 빠뜨리지 마라.",
  ],
});
