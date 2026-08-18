/**
 * procedural-memory — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "procedural-memory",
  title: "절차는 통째로",
  rules: [
    "절차는 조각내 기억하지 말고 파일 하나로 통째로 두고 필요할 때 전부 읽어라.",
    "기억한 절차와 파일이 다르면 파일을 따르고 그 차이를 보고하라.",
  ],
});
