/**
 * hybrid-workflow — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "hybrid-workflow",
  title: "어디까지 정하고 시작할지",
  rules: [
    "인터페이스·데이터 모델·권한은 먼저 정하고 시작하라. 나머지는 진행하며 정해도 된다.",
    "정해야 할 것을 안 정하고 시작하지 말고, 다 정하려고 멈춰 있지도 마라.",
  ],
});
