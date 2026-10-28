import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "model-routing",
  title: "모델 선택은 눈에 보이게",
  rules: [
    "일의 크기와 지금 모델이 안 맞으면 조용히 진행하지 말고 그 사실을 말하라.",
    "모델을 바꿔야 한다고 판단되면 스스로 바꾸지 말고 사용자에게 제안하라.",
  ],
});
