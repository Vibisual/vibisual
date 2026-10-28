/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "reranking",
  title: "상위 몇 개만 쓴다",
  rules: [
    "찾은 것을 전부 싣지 말고 실제로 관련 있는 몇 개만 골라 근거로 써라.",
    "고른 기준을 한 줄로 말하라.",
  ],
});
