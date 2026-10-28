/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "trace-span",
  title: "경로를 남겨라",
  rules: [
    "한 요청이 어떤 단계를 거쳤는지 되짚을 수 있게 단계마다 무엇을 했는지 남겨라.",
    "어디서 시간이 걸렸는지 모른 채 느리다고 보고하지 마라.",
  ],
});
