/**
 * verifier-critic — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "verifier-critic",
  title: "쓴 사람과 보는 사람을 나눠라",
  rules: [
    "자기가 쓴 것을 자기가 검토했다고 하지 마라 — 검증은 실행 결과로 하라.",
    "검토를 맡길 수 있으면 맡기고, 못 맡기면 최소한 반대 가설로 한 번 확인하라.",
  ],
});
