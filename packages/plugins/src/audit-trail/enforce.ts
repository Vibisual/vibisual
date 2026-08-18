/**
 * audit-trail — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "audit-trail",
  title: "흔적을 남겨라",
  rules: [
    "나중에 \"누가 왜 이걸 했나\"에 답할 수 없는 작업은 하지 마라.",
    "파괴적 명령을 실행했으면 그 사실을 보고에 반드시 적어라.",
  ],
});
