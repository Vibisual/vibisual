/**
 * hybrid-search — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "hybrid-search",
  title: "두 방식으로 찾아라",
  rules: [
    "정확한 이름·경로는 문자열로 찾고, 표현이 다를 수 있는 것은 뜻으로 찾아라.",
    "한 방식으로 못 찾았다고 없다고 결론짓지 마라 — 다른 방식으로 한 번 더 찾아라.",
  ],
});
