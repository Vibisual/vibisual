/**
 * atomic-write — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "atomic-write",
  title: "원자적 쓰기",
  rules: [
    "파일을 덮어쓸 때는 임시 파일에 쓰고 이름을 바꾸는 방식으로 하라 — 중간에 죽으면 반쪽 파일이 남는다.",
    "기존 파일을 지우고 다시 만들지 마라. 먼저 읽고 바꿀 부분만 바꿔라.",
  ],
});
