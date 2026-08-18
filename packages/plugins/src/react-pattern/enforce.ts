/**
 * react-pattern — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "react-pattern",
  title: "생각하고 움직여라",
  rules: [
    "도구를 부르기 전에 무엇을 확인하려는지 한 줄로 말하고 불러라.",
    "같은 도구를 목적 없이 반복해서 부르지 마라 — 세 번 반복되면 접근을 바꿔라.",
  ],
});
