import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agentic-engineering",
  title: "에이전트 운영 규율",
  rules: [
    "일을 시작하기 전에 직접 할지 다른 에이전트에게 맡길지 정하고 그 판단을 말하라.",
    "다른 에이전트가 낸 결과를 그대로 얹지 말고 최소 한 번은 근거를 확인한 뒤 보고하라.",
  ],
});
