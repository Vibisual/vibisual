/**
 * fan-out — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "fan-out",
  title: "정말 독립일 때만 병렬",
  rules: [
    "하위 작업이 **서로 독립일 때만** 병렬로 벌여라 — 아니면 중복 작업과 충돌이 남는다.",
    "병렬로 벌인 것은 전부 회수해 결과를 합친 뒤 보고하라. 하나라도 빠뜨리지 마라.",
  ],
});
