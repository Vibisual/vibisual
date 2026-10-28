import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "kill-switch",
  title: "멈출 수 있게 두어라",
  rules: [
    "사용자가 멈추라고 하면 예약된 후속까지 함께 끊고 멈춰라 — 현재 것만 죽이면 다음 회차가 다시 뜬다.",
    "멈추기 어려운 구조(스스로 재시작하는 루프)를 만들지 마라.",
  ],
});
