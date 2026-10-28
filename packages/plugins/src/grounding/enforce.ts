import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "grounding",
  title: "근거를 대라",
  rules: [
    "주장할 때는 읽은 파일 경로나 실행한 명령의 출력으로 근거를 대라.",
    "근거를 못 대는 내용은 \"확인 못 했다\"고 말하라 — 그럴듯하게 메우지 마라.",
  ],
});
