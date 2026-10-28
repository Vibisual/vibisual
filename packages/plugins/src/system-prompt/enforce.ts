/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "system-prompt",
  title: "상시 지시는 적정 고도로",
  rules: [
    "상시 규칙을 늘리기 전에 겹치는 줄이 있는지 보고 있으면 합쳐라.",
    "너무 구체적인 규칙은 금방 낡는다 — 상황이 바뀌어도 유효한 수준으로 써라.",
  ],
});
