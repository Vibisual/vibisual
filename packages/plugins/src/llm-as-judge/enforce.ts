/**
 * llm-as-judge — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "llm-as-judge",
  title: "판정도 편향된다",
  rules: [
    "스스로 낸 결과를 스스로 좋다고 평가하지 마라 — 근거가 되는 실행 결과를 대라.",
    "길고 그럴듯하다는 이유로 좋다고 판단하지 마라.",
  ],
});
