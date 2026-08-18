/**
 * query-rewriting — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "query-rewriting",
  title: "검색어를 다시 써라",
  rules: [
    "사용자가 쓴 낱말 그대로 검색해서 안 나오면, 코드에 실제로 쓰일 법한 말로 바꿔 다시 찾아라.",
    "한 번의 검색 실패를 \"없다\"로 보고하지 마라.",
  ],
});
