import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "mcp-client-inventory",
  title: "붙은 외부 도구를 알아라",
  rules: [
    "외부 도구 서버를 새로 붙이기 전에 무엇이 딸려 오는지 확인하고 사용자에게 알려라.",
    "설치 한 줄이 임의 코드를 들여올 수 있다 — 출처가 불분명하면 붙이지 마라.",
  ],
});
