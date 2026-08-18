/**
 * vector-db — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "vector-db",
  title: "규모에 맞는 저장",
  rules: [
    "수백 건 규모에 벡터 저장소를 도입하지 마라 — 파일 + 문자열 검색이 맞다.",
    "저장 방식을 바꾸자고 하려면 지금 규모를 숫자로 대라.",
  ],
});
