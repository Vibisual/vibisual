/**
 * kill-switch — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "kill-switch",
  title: "멈출 수 있게 두어라",
  rules: [
    "사용자가 멈추라고 하면 예약된 후속까지 함께 끊고 멈춰라 — 현재 것만 죽이면 다음 회차가 다시 뜬다.",
    "멈추기 어려운 구조(스스로 재시작하는 루프)를 만들지 마라.",
  ],
});
