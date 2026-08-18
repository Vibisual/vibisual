/**
 * memory-invalidation — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "memory-invalidation",
  title: "지우지 말고 표시하라",
  rules: [
    "낡은 기억은 지우지 말고 \"확인 필요\"로 표시하라 — 지우면 다음 사람이 왜 틀렸는지 모른다.",
    "기억을 근거로 쓸 때는 지금 코드와 한 번 대조한 뒤에 써라.",
  ],
});
