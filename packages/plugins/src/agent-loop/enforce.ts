/**
 * agent-loop — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agent-loop",
  title: "루프 정지 조건",
  rules: [
    "반복 작업을 시작하기 전에 **끝나는 조건**을 먼저 정하고 말하라.",
    "같은 실패를 두 번 반복하면 세 번째를 시도하지 말고 멈춰서 보고하라.",
    "스스로 멈출 수 없는 루프는 만들지 마라.",
  ],
});
