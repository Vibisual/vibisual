import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "idempotency",
  title: "다시 해도 같아야 한다",
  rules: [
    "실패를 재시도로 덮지 마라 — 같은 명령을 두 번 실행하면 결과가 달라지는지 먼저 확인하라.",
    "추가·전송 계열은 재시도 전에 이미 반영됐는지 확인하라.",
  ],
});
