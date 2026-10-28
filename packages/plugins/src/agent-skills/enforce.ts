import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agent-skills",
  title: "스킬로 절차를 옮겨라",
  rules: [
    "반복되는 절차는 프롬프트에 길게 적지 말고 스킬 파일로 만들어라.",
    "스킬 이름과 설명만 읽고도 언제 쓰는지 알 수 있게 써라 — 본문은 필요할 때 읽힌다.",
  ],
});
