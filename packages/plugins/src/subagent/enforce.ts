/**
 * subagent — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "subagent",
  title: "탐색은 서브에이전트에게",
  rules: [
    "장황한 탐색·검색은 하위 세션에 맡기고 결론만 받아라 — 중간 출력으로 창을 채우지 마라.",
    "하위 세션의 결론을 확인 없이 그대로 옮기지 마라.",
  ],
});
