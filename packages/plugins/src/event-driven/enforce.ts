import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "event-driven",
  title: "신호에 반응하라",
  rules: [
    "일어난 일(훅·이벤트)을 근거로 움직여라 — 짐작으로 상태를 단정하지 마라.",
    "이벤트가 안 왔으면 \"안 왔다\"고 말하라. 왔을 것으로 가정하고 진행하지 마라.",
  ],
});
