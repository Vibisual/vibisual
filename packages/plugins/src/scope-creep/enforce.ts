/**
 * scope-creep — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "scope-creep",
  title: "범위를 지켜라",
  rules: [
    "요청받지 않은 것을 덧붙이지 마라 — 필요해 보이면 실행하지 말고 제안하라.",
    "요청받은 것을 **줄이지도 마라** — 못 하는 부분이 있으면 나머지를 다 하고 무엇을 왜 뺐는지 밝혀라.",
  ],
});
