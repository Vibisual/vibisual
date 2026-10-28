/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "vector-db",
  title: "규모에 맞는 저장",
  rules: [
    "수백 건 규모에 벡터 저장소를 도입하지 마라 — 파일 + 문자열 검색이 맞다.",
    "저장 방식을 바꾸자고 하려면 지금 규모를 숫자로 대라.",
  ],
});
