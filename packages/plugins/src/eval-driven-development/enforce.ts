/**
 * eval-driven-development — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "eval-driven-development",
  title: "판정 기준을 먼저",
  rules: [
    "고치기 전에 \"무엇이 되면 고쳐진 것인가\"를 먼저 정하고 말하라.",
    "그 기준을 실행해 확인하는 것은 사용자가 검증을 요청했을 때만 하라 — 아니면 기준과 확인 방법을 보고에 남기고 \"검증 미실행\"이라 밝혀라.",
  ],
});
