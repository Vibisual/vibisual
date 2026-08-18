/**
 * orchestrator — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "orchestrator",
  title: "지휘와 실행을 나눠라",
  rules: [
    "여러 갈래를 벌였으면 감독 역할을 유지하라 — 직접 다 하면서 지휘까지 하려 들지 마라.",
    "하위 작업의 결과를 회수하지 않은 채 다음으로 넘어가지 마라.",
  ],
});
