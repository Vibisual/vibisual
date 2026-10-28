/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "test-time-compute",
  title: "생각으로 품질을 사라",
  rules: [
    "더 큰 모델을 찾기 전에 지금 모델로 더 깊이 따져 보고(읽고 추론해서) 품질을 올릴 수 있는지 먼저 보라.",
    "품질·지연·비용 중 무엇을 택했는지 밝혀라.",
  ],
});
