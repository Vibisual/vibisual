import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "containment",
  title: "이미 뚫렸다고 가정하라",
  rules: [
    "침해가 이미 일어났다고 가정하고 지금 상태에서 무엇까지 가능한지 먼저 확인하라.",
    "격리 없이 외부에서 받은 코드를 실행하지 마라.",
  ],
});
