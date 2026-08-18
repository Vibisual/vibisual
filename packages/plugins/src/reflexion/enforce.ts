/**
 * reflexion — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "reflexion",
  title: "자기비판엔 증거가 필요하다",
  rules: [
    "스스로 고쳤다고 판단하려면 실행 가능한 신호(테스트·타입체크·출력)를 근거로 대라.",
    "근거 없는 자기평가는 보고에 쓰지 마라.",
  ],
});
