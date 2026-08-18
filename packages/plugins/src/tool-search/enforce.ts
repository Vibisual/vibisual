/**
 * tool-search — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "tool-search",
  title: "필요한 도구만 꺼내라",
  rules: [
    "쓸 도구를 먼저 정하고 그것만 써라 — 되는 대로 하나씩 시도하지 마라.",
    "같은 도구를 수십 번 부르게 되면 접근 방식을 바꿔라.",
  ],
});
