/**
 * forgetting-policy — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "forgetting-policy",
  title: "지우는 규칙도 정하라",
  rules: [
    "기억을 늘릴 때는 언제 내릴지도 함께 정하라 — 늘기만 하는 기억은 정확도를 떨어뜨린다.",
    "낡은 기억을 발견하면 조용히 두지 말고 낡았다고 표시해 보고하라.",
  ],
});
