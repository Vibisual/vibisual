/**
 * event-driven — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "event-driven",
  title: "신호에 반응하라",
  rules: [
    "일어난 일(훅·이벤트)을 근거로 움직여라 — 짐작으로 상태를 단정하지 마라.",
    "이벤트가 안 왔으면 \"안 왔다\"고 말하라. 왔을 것으로 가정하고 진행하지 마라.",
  ],
});
