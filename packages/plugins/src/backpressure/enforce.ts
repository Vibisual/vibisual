/**
 * backpressure — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "backpressure",
  title: "밀리면 벌이지 마라",
  rules: [
    "처리보다 요청이 빨리 쌓이면 새 작업을 더 벌이지 말고 밀린 것부터 끝내라.",
    "벌여 놓은 것이 밀리면 조용히 버리지 말고 밀린 양을 보고하라.",
  ],
});
