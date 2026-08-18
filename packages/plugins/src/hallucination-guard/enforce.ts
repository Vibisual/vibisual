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
    "고친 뒤에는 타입체크나 테스트로 확인한 다음 완료라고 하라.",
  ],
});
