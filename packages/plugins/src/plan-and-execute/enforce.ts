/**
 * plan-and-execute — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "plan-and-execute",
  title: "계획을 남기고 실행하라",
  rules: [
    "여러 단계짜리 작업은 계획을 먼저 세워 보이게 하고, 단계마다 진행 상태를 갱신하라.",
    "계획과 다르게 가게 되면 조용히 바꾸지 말고 바뀐 계획을 먼저 말하라.",
  ],
});
