/**
 * semantic-memory — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "semantic-memory",
  title: "한 자리에 하나의 현재",
  rules: [
    "같은 사실이 두 군데서 다르게 말해지면 둘 다 두지 말고 어느 쪽이 현재인지 정하라.",
    "정할 수 없으면 임의로 고르지 말고 어긋난 사실을 보고하라.",
  ],
});
