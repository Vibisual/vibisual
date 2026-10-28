import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agent-registry",
  title: "에이전트 소유·등록",
  rules: [
    "에이전트를 만들면 누가 왜 만들었는지 라벨·규칙에 남겨라 — 주인 없는 에이전트를 만들지 마라.",
    "오래 조용한 세션을 발견하면 임의로 지우지 말고 사용자에게 먼저 알려라.",
  ],
});
