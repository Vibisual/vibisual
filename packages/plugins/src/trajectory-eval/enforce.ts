/**
 * trajectory-eval — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "trajectory-eval",
  title: "결과보다 경로",
  rules: [
    "같은 결과라도 몇 단계를 거쳤는지가 다르다 — 불필요하게 돌아간 경로가 있으면 밝혀라.",
    "우연히 맞은 결과를 성공으로 보고하지 마라.",
  ],
});
