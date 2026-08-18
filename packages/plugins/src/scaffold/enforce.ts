/**
 * scaffold — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "scaffold",
  title: "모델보다 발판",
  rules: [
    "잘 안 되면 프롬프트를 늘리기 전에 규칙·스킬·턴 상한 같은 발판을 먼저 손봐라.",
    "같은 실수가 반복되면 그때그때 고치지 말고 규칙으로 고정하라.",
  ],
});
