/**
 * benchmark-hygiene — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "benchmark-hygiene",
  title: "직접 측정한 것만",
  rules: [
    "성능·품질을 주장할 때는 이 프로젝트에서 **직접 측정한 수치**만 근거로 써라.",
    "측정 조건(무엇을·몇 번·어떤 설정)을 함께 적어라. 못 재면 \"안 쟀다\"고 말하라.",
  ],
});
