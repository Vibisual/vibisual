/**
 * schema-evolution — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "schema-evolution",
  title: "옛 저장물을 깨지 마라",
  rules: [
    "저장 구조에 필드를 추가할 때는 선택 필드 + 기본값으로 하라 — 기존 저장물이 그대로 읽혀야 한다.",
    "필드 이름을 바꾸거나 지우지 마라. 새로 추가하고 옛것을 남겨라.",
  ],
});
