/**
 * instruction-drift — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "instruction-drift",
  title: "지시는 흐려진다",
  rules: [
    "세션이 길어지면 처음 지시를 기억에 의존하지 말고 다시 읽어라.",
    "\"아까 말했으니 됐다\"로 넘기지 마라 — 지금 지시와 어긋나는지 매번 확인하라.",
  ],
});
