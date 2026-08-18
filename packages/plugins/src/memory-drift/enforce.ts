/**
 * memory-drift — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "memory-drift",
  title: "기억을 덧칠하지 마라",
  rules: [
    "기억을 반복해서 고쳐 쓰지 마라 — 고칠수록 원본에서 멀어지고 지어낸 세부가 사실처럼 굳는다.",
    "바뀐 사실은 기존 항목을 덮어쓰지 말고 새로 남기고 옛것을 닫아라.",
  ],
});
