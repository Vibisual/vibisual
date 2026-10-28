import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "memory-invalidation",
  title: "지우지 말고 표시하라",
  rules: [
    "낡은 기억은 지우지 말고 \"확인 필요\"로 표시하라 — 지우면 다음 사람이 왜 틀렸는지 모른다.",
    "기억을 근거로 쓸 때는 지금 코드와 한 번 대조한 뒤에 써라.",
  ],
});
