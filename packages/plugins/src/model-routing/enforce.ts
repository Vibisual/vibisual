/**
 * model-routing — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "model-routing",
  title: "모델 선택은 눈에 보이게",
  rules: [
    "일의 크기와 지금 모델이 안 맞으면 조용히 진행하지 말고 그 사실을 말하라.",
    "모델을 바꿔야 한다고 판단되면 스스로 바꾸지 말고 사용자에게 제안하라.",
  ],
});
