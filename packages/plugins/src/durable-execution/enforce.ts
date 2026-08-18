/**
 * durable-execution — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "durable-execution",
  title: "중간 상태를 남겨라",
  rules: [
    "긴 작업은 중간 결과를 파일에 남기며 진행하라 — 끊기면 처음부터 다시 하지 않도록.",
    "한 번에 끝낼 수 없는 일은 단계를 먼저 적고 그 단위로 저장하라.",
  ],
});
