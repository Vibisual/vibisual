import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "graceful-degradation",
  title: "막히면 통과가 아니라 정지",
  rules: [
    "판단이 안 서면 통과시키지 말고 멈춰라 — 관문은 안전한 쪽으로 실패해야 한다.",
    "승인 요청이 응답 없이 끝나면 승인된 것으로 간주하지 마라.",
  ],
});
