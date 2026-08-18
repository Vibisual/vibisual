/**
 * tool-use — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "tool-use",
  title: "도구 정의도 비용이다",
  rules: [
    "안 쓸 도구를 목록에 두지 마라 — 정의만으로 창을 먹는다.",
    "도구를 부르기 전에 그것이 지금 필요한 최소한인지 확인하라.",
  ],
});
