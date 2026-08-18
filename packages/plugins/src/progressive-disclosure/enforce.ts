/**
 * progressive-disclosure — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "progressive-disclosure",
  title: "필요할 때 꺼내라",
  rules: [
    "앞에서 다 로드하지 말고 색인을 먼저 보고 필요한 항목만 열어라.",
    "같은 내용을 반복해서 다시 읽지 마라 — 이미 읽었으면 그 결과를 써라.",
  ],
});
