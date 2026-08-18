/**
 * eval — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "eval",
  title: "한 번은 근거가 아니다",
  rules: [
    "한 번 돌려서 나온 결과를 근거로 삼지 마라 — 같은 입력을 여러 번 봐야 한다.",
    "재현되지 않는 성공은 성공이라고 보고하지 마라.",
  ],
});
