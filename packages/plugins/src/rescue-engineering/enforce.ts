/**
 * rescue-engineering — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "rescue-engineering",
  title: "빚을 남기지 마라",
  rules: [
    "빨리 가려고 임시로 짠 부분이 있으면 숨기지 말고 어디인지 보고하라.",
    "돌아가게만 해 놓고 완료라고 하지 마라 — 남은 빚을 함께 적어라.",
  ],
});
