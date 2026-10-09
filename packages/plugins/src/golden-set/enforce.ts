/**
 * golden-set — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "golden-set",
  title: "실패 사례를 넣어라",
  rules: [
    "검증 기준을 만들 때 성공 사례만 넣지 마라 — 과거에 실제로 틀렸던 것을 반드시 포함하라.",
    "지난 실패의 재현 실행은 사용자가 검증을 요청했을 때만 하라 — 재현하지 않았으면 고쳤다고 단정하지 말고 재현 방법을 적어라.",
  ],
});
