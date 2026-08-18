/**
 * context-window — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "context-window",
  title: "창 크기는 천장이지 목표가 아니다",
  rules: [
    "모델 창 크기를 목표로 삼지 마라 — 실제로 쓸 수 있는 양은 그보다 작다.",
    "큰 파일은 통째로 읽지 말고 필요한 구간만 읽어라.",
  ],
});
