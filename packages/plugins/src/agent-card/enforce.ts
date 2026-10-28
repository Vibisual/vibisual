import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agent-card",
  title: "에이전트 능력 명세",
  rules: [
    "에이전트를 만들 때 할 수 있는 것뿐 아니라 **못 하는 것·실패 양상**을 함께 적어라.",
    "다른 에이전트에게 맡기기 전에 그 역할과 권한을 확인하고, 모르면 맡기지 마라.",
  ],
});
