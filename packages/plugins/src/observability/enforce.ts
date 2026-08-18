/**
 * observability — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "observability",
  title: "나중에 재현할 수 있게",
  rules: [
    "왜 그렇게 했는지 나중에 되짚을 수 있도록 판단 근거를 보고에 남겨라.",
    "재현 방법을 적을 수 없는 버그는 고쳤다고 말하지 마라.",
  ],
});
