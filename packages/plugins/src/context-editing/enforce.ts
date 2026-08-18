/**
 * context-editing — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "context-editing",
  title: "요약 말고 덜어내라",
  rules: [
    "오래된 도구 호출·결과는 요약하지 말고 규칙대로 덜어내라 — 요약은 손실이 크다.",
    "지금 필요 없는 내용을 다시 끌어오지 마라.",
  ],
});
