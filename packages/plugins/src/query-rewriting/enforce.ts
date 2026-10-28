/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "query-rewriting",
  title: "검색어를 다시 써라",
  rules: [
    "사용자가 쓴 낱말 그대로 검색해서 안 나오면, 코드에 실제로 쓰일 법한 말로 바꿔 다시 찾아라.",
    "한 번의 검색 실패를 \"없다\"로 보고하지 마라.",
  ],
});
