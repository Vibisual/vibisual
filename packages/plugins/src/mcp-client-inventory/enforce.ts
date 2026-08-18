/**
 * mcp-client-inventory — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "mcp-client-inventory",
  title: "붙은 외부 도구를 알아라",
  rules: [
    "외부 도구 서버를 새로 붙이기 전에 무엇이 딸려 오는지 확인하고 사용자에게 알려라.",
    "설치 한 줄이 임의 코드를 들여올 수 있다 — 출처가 불분명하면 붙이지 마라.",
  ],
});
