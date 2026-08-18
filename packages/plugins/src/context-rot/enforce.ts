/**
 * context-rot — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "context-rot",
  title: "창이 차면 마무리하라",
  rules: [
    "컨텍스트가 절반을 넘으면 새 작업을 시작하지 말고 지금 것을 마무리하라.",
    "창이 크다고 채우지 마라 — 채울수록 비슷한 내용을 헷갈린다.",
  ],
});
