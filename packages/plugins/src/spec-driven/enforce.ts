/**
 * spec-driven — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "spec-driven",
  title: "명세에서 코드로",
  rules: [
    "구현 전에 명세가 있는지 확인하고, 있으면 명세를 먼저 읽어라.",
    "명세와 다르게 만들지 마라 — 바꿔야 하면 명세를 먼저 고치고 그 다음에 구현하라.",
  ],
});
