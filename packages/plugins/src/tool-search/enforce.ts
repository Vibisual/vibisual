/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "tool-search",
  title: "필요한 도구만 꺼내라",
  rules: [
    "쓸 도구를 먼저 정하고 그것만 써라 — 되는 대로 하나씩 시도하지 마라.",
    "같은 도구를 수십 번 부르게 되면 접근 방식을 바꿔라.",
  ],
});
