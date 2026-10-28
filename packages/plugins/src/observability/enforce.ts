import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "observability",
  title: "나중에 재현할 수 있게",
  rules: [
    "왜 그렇게 했는지 나중에 되짚을 수 있도록 판단 근거를 보고에 남겨라.",
    "재현 방법을 적을 수 없는 버그는 고쳤다고 말하지 마라.",
  ],
});
