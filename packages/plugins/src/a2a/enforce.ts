/**
 * a2a — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "a2a",
  title: "에이전트 간 협업(A2A)",
  rules: [
    "다른 에이전트에게 일을 넘길 때는 무엇을 주고 무엇을 돌려받는지 한 줄로 먼저 적고 넘겨라.",
    "남의 세션에 직접 명령을 밀어 넣지 마라 — 넘김은 선언된 경로(Task Edge)로만 한다.",
    "조직 밖 에이전트와 주고받아야 하면 실행 전에 사용자에게 물어라.",
  ],
});
