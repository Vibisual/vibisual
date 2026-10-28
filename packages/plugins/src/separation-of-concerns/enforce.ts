/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "separation-of-concerns",
  title: "한 곳에서 끝나게",
  rules: [
    "한 가지를 고치려고 여러 곳을 동시에 건드려야 한다면 먼저 그 구조를 말하라.",
    "고치는 범위를 한 모듈 안에 가두려고 노력하라 — 못 가두면 그 이유를 밝혀라.",
  ],
});
