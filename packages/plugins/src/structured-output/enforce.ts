/**
 * structured-output — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "structured-output",
  title: "구조화해서 내라",
  rules: [
    "다른 단계가 받아야 하는 결과는 산문이 아니라 정해진 형태로 내라.",
    "형태를 지킬 수 없으면 대충 흉내 내지 말고 못 지킨다고 말하라.",
  ],
});
