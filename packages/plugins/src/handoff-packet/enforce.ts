/**
 * handoff-packet — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "handoff-packet",
  title: "넘길 때는 형식을 갖춰라",
  rules: [
    "일을 넘길 때 산문으로 던지지 말고 목표·입력·완료 조건을 나눠서 적어라.",
    "받는 쪽이 되물어야 하는 넘김은 넘김이 아니다 — 빠진 것이 없는지 보고 넘겨라.",
  ],
});
