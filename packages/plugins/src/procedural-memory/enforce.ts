/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "procedural-memory",
  title: "절차는 통째로",
  rules: [
    "절차는 조각내 기억하지 말고 파일 하나로 통째로 두고 필요할 때 전부 읽어라.",
    "기억한 절차와 파일이 다르면 파일을 따르고 그 차이를 보고하라.",
  ],
});
