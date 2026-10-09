/**
 * hallucination-guard — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "hallucination-guard",
  title: "있는지 확인하고 써라",
  rules: [
    "API·파일·함수를 쓰기 전에 실제로 있는지 읽어서 확인하라 — 이름을 지어내지 마라.",
    "고친 뒤 타입체크·테스트는 사용자가 검증을 요청했을 때만 돌려라 — 돌리지 않았으면 \"검증 미실행\"이라 밝히고 확인됐다고 쓰지 마라.",
  ],
});
