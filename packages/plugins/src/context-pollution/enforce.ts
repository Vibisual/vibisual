import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "context-pollution",
  title: "실패한 시도를 끌고 다니지 마라",
  rules: [
    "실패한 시도와 버린 접근은 결론만 남기고 과정을 끌고 다니지 마라.",
    "한 세션에서 주제가 바뀌면 새 세션으로 나눠라.",
  ],
});
