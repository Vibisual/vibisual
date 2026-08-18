/**
 * supersede — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "supersede",
  title: "지우지 말고 닫아라",
  rules: [
    "새 지식이 옛 지식과 충돌하면 옛것을 지우지 말고 닫고 새것을 열어라.",
    "언제 열렸고 언제 닫혔는지 알 수 있게 남겨라.",
  ],
});
