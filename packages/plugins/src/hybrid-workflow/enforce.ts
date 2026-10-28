import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "hybrid-workflow",
  title: "어디까지 정하고 시작할지",
  rules: [
    "인터페이스·데이터 모델·권한은 먼저 정하고 시작하라. 나머지는 진행하며 정해도 된다.",
    "정해야 할 것을 안 정하고 시작하지 말고, 다 정하려고 멈춰 있지도 마라.",
  ],
});
