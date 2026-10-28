/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "schema-evolution",
  title: "옛 저장물을 깨지 마라",
  rules: [
    "저장 구조에 필드를 추가할 때는 선택 필드 + 기본값으로 하라 — 기존 저장물이 그대로 읽혀야 한다.",
    "필드 이름을 바꾸거나 지우지 마라. 새로 추가하고 옛것을 남겨라.",
  ],
});
