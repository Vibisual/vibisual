/**
 * multi-hop — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "multi-hop",
  title: "한 번 찾고 끝내지 마라",
  rules: [
    "한 번의 검색으로 답이 안 나오면, 찾은 것을 바탕으로 두 번째 검색을 하라.",
    "첫 검색 결과만으로 결론짓지 마라 — 못 찾은 것과 없는 것은 다르다.",
  ],
});
