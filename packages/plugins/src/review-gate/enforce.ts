/**
 * review-gate — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "review-gate",
  title: "검수 가능한 모양으로 끝내라",
  rules: [
    "완료 보고는 긴 산문 대신 **무엇을 어떻게 바꿨는지 목록 + 확인 방법**으로 내라.",
    "사용자가 확인할 수 없는 완료는 완료가 아니다 — 확인 지점을 반드시 적어라.",
  ],
});
