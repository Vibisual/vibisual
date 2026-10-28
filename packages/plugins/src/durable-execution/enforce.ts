import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "durable-execution",
  title: "중간 상태를 남겨라",
  rules: [
    "긴 작업은 중간 결과를 파일에 남기며 진행하라 — 끊기면 처음부터 다시 하지 않도록.",
    "한 번에 끝낼 수 없는 일은 단계를 먼저 적고 그 단위로 저장하라.",
  ],
});
