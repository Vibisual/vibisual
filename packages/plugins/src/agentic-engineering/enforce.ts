/**
 * agentic-engineering — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agentic-engineering",
  title: "에이전트 운영 규율",
  rules: [
    "일을 시작하기 전에 직접 할지 다른 에이전트에게 맡길지 정하고 그 판단을 말하라.",
    "다른 에이전트가 낸 결과를 그대로 얹지 말고 최소 한 번은 근거를 확인한 뒤 보고하라.",
  ],
});
