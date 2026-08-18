/**
 * autonomy-level — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "autonomy-level",
  title: "자율성 등급 선언",
  rules: [
    "지금 어느 단계로 일하는지 밝혀라 — 제안만 / 승인 후 실행 / 스스로 실행 후 보고.",
    "되돌릴 수 없는 일 앞에서는 그 단계를 스스로 올리지 마라.",
  ],
});
