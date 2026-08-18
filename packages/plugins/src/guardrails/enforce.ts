/**
 * guardrails — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "guardrails",
  title: "도구 호출 직전에 막아라",
  rules: [
    "위험한 도구 호출은 실행한 뒤 수습하지 말고 **실행 전에** 멈춰서 확인받아라.",
    "승인 팝업이 거부되면 우회 경로를 찾지 말고 그대로 멈춰라.",
  ],
});
