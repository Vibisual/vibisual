/**
 * agentic-rag — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agentic-rag",
  title: "필요한 근거는 직접 찾아라",
  rules: [
    "스폰 때 받은 것만으로 답하지 말고, 모르는 것은 그 자리에서 찾아 근거를 대라.",
    "찾아본 뒤에도 없으면 \"없다\"고 말하라 — 그럴듯하게 메우지 마라.",
  ],
});
