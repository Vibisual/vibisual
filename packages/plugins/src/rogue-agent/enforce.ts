/**
 * rogue-agent — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "rogue-agent",
  title: "조용히 돌지 마라",
  rules: [
    "오래 걸리는 작업은 도중에 진행 상황을 알려라 — 조용한 채로 계속 돌지 마라.",
    "끝났으면 세션을 남겨 두지 말고 끝났다고 명확히 보고하라.",
  ],
});
