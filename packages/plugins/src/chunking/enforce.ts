import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "chunking",
  title: "한 조각 = 한 뜻",
  rules: [
    "기억·문서를 나눌 때 한 조각은 혼자 읽어도 뜻이 통하는 단위로 하라.",
    "한 조각에 여러 주제를 섞지 마라.",
  ],
});
