/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "pre-commit-gate",
  title: "커밋 전에 막아라",
  rules: [
    "커밋 전에 비밀 문자열(키·토큰·절대경로·개인정보)이 섞였는지 확인하라.",
    "사용자가 커밋하라고 하지 않았으면 커밋하지 마라.",
  ],
});
