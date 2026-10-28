import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "guardrails",
  title: "도구 호출 직전에 막아라",
  rules: [
    "위험한 도구 호출은 실행한 뒤 수습하지 말고 **실행 전에** 멈춰서 확인받아라.",
    "승인 팝업이 거부되면 우회 경로를 찾지 말고 그대로 멈춰라.",
  ],
});
