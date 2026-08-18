/**
 * agent-registry — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agent-registry",
  title: "에이전트 소유·등록",
  rules: [
    "에이전트를 만들면 누가 왜 만들었는지 라벨·규칙에 남겨라 — 주인 없는 에이전트를 만들지 마라.",
    "오래 조용한 세션을 발견하면 임의로 지우지 말고 사용자에게 먼저 알려라.",
  ],
});
