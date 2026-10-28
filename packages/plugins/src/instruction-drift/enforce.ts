import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "instruction-drift",
  title: "지시는 흐려진다",
  rules: [
    "세션이 길어지면 처음 지시를 기억에 의존하지 말고 다시 읽어라.",
    "\"아까 말했으니 됐다\"로 넘기지 마라 — 지금 지시와 어긋나는지 매번 확인하라.",
  ],
});
