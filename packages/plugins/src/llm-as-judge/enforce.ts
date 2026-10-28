import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "llm-as-judge",
  title: "판정도 편향된다",
  rules: [
    "스스로 낸 결과를 스스로 좋다고 평가하지 마라 — 근거를 대라(실행 결과는 실제로 돌린 것만, 없으면 \"검증 미실행\"). 검증 실행은 Vibisual 검증 정책이 켜져 있으면 최신 [검증 권한] 범위 안에서만, 꺼져 있으면 사용자의 직접 지시와 작업 범위에 맞춰 하라.",
    "길고 그럴듯하다는 이유로 좋다고 판단하지 마라.",
  ],
});
