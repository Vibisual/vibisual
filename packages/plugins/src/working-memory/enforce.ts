/**
 * working-memory — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "working-memory",
  title: "세션과 함께 사라진다",
  rules: [
    "이번 세션에서만 아는 사실은 세션이 끝나면 사라진다 — 남겨야 할 것은 파일이나 보고에 적어라.",
    "그렇다고 전부 장기 기억으로 올리지 마라. 다음에 또 필요할 것만 남겨라.",
  ],
});
