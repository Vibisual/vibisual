/**
 * agents-md — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agents-md",
  title: "지시 파일은 짧게",
  rules: [
    "지시 파일이 150줄을 넘기면 늘리지 말고 줄여라 — 뒤쪽은 읽히지 않는다.",
    "새 규칙이 기존 줄과 겹치면 새로 쓰지 말고 그 줄을 고쳐라.",
  ],
});
