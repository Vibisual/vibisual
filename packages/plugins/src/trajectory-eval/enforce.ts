/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "trajectory-eval",
  title: "결과보다 경로",
  rules: [
    "같은 결과라도 몇 단계를 거쳤는지가 다르다 — 불필요하게 돌아간 경로가 있으면 밝혀라.",
    "우연히 맞은 결과를 성공으로 보고하지 마라.",
  ],
});
