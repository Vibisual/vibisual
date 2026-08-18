/**
 * idempotency — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "idempotency",
  title: "다시 해도 같아야 한다",
  rules: [
    "실패를 재시도로 덮지 마라 — 같은 명령을 두 번 실행하면 결과가 달라지는지 먼저 확인하라.",
    "추가·전송 계열은 재시도 전에 이미 반영됐는지 확인하라.",
  ],
});
