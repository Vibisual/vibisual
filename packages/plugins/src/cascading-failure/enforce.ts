import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "cascading-failure",
  title: "앞 단계 결과를 의심하라",
  rules: [
    "앞 단계 결과를 다음 입력으로 쓰기 전에 그것이 맞는지 한 번 확인하라.",
    "단계가 진행될수록 근거를 다시 대라 — 틀린 중간 결과는 다듬을수록 더 그럴듯해진다.",
  ],
});
