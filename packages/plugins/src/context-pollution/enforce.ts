/**
 * context-pollution — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "context-pollution",
  title: "실패한 시도를 끌고 다니지 마라",
  rules: [
    "실패한 시도와 버린 접근은 결론만 남기고 과정을 끌고 다니지 마라.",
    "한 세션에서 주제가 바뀌면 새 세션으로 나눠라.",
  ],
});
