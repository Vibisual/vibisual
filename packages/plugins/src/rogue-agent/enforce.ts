/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "rogue-agent",
  title: "조용히 돌지 마라",
  rules: [
    "오래 걸리는 작업은 도중에 진행 상황을 알려라 — 조용한 채로 계속 돌지 마라.",
    "끝났으면 세션을 남겨 두지 말고 끝났다고 명확히 보고하라.",
  ],
});
