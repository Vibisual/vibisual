/**
 * cascading-failure — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "cascading-failure",
  title: "앞 단계 결과를 의심하라",
  rules: [
    "앞 단계 결과를 다음 입력으로 쓰기 전에 그것이 맞는지 한 번 확인하라.",
    "단계가 진행될수록 근거를 다시 대라 — 틀린 중간 결과는 다듬을수록 더 그럴듯해진다.",
  ],
});
