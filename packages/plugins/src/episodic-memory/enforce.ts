import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "episodic-memory",
  title: "원본을 지우지 마라",
  rules: [
    "요약을 남기더라도 원본 기록을 지우지 마라 — 지우면 요약이 맞는지 확인할 길이 없다.",
    "\"그때 이랬다\"고 말할 때는 원본을 근거로 대라.",
  ],
});
