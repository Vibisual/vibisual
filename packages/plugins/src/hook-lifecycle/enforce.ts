/**
 * hook-lifecycle — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "hook-lifecycle",
  title: "훅은 생각보다 자주 온다",
  rules: [
    "훅이 한 번만 온다고 가정하지 마라 — 같은 훅이 매 턴 올 수 있다.",
    "훅 처리 안에서 다시 작업을 스폰하지 마라. 자기 자신을 부르는 고리가 된다.",
  ],
});
