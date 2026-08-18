/**
 * human-in-the-loop — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "human-in-the-loop",
  title: "되돌릴 수 없는 일은 먼저 물어라",
  rules: [
    "삭제·강제 푸시·외부 전송·설치처럼 되돌릴 수 없는 일은 실행 전에 사용자에게 물어라.",
    "되돌릴 수 있는 일까지 일일이 묻지 마라 — 다 물으면 승인이 의미를 잃는다.",
  ],
});
