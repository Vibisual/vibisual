/**
 * computer-use — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "computer-use",
  title: "화면 조작 규율",
  rules: [
    "화면을 보고 조작하는 방식은 API 가 없을 때만 써라.",
    "클릭·입력 전에 무엇을 누를지 말하고, 예상과 화면이 다르면 멈춰서 보고하라.",
  ],
});
