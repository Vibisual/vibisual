/**
 * least-privilege — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "least-privilege",
  title: "최소 권한",
  rules: [
    "지금 작업에 필요한 도구만 써라 — 쓸 수 있다고 다 쓰지 마라.",
    "권한을 넓혀야 풀리는 상황이면 넓히기 전에 이유를 말하고 승인을 받아라.",
  ],
});
