/**
 * test-time-compute — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "test-time-compute",
  title: "생각으로 품질을 사라",
  rules: [
    "더 큰 모델을 찾기 전에 지금 모델로 더 깊이 검증해서 품질을 올릴 수 있는지 먼저 보라.",
    "품질·지연·비용 중 무엇을 택했는지 밝혀라.",
  ],
});
