import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "golden-set",
  title: "실패 사례를 넣어라",
  rules: [
    "검증 기준을 만들 때 성공 사례만 넣지 마라 — 과거에 실제로 틀렸던 것을 반드시 포함하라.",
    "지난 실패의 재현 실행은 Vibisual 검증 정책이 켜져 있으면 최신 [검증 권한] 범위 안에서만, 꺼져 있으면 사용자의 직접 지시와 작업 범위에 맞춰 하라 — 재현하지 않았으면 고쳤다고 단정하지 말고 재현 방법을 적어라.",
  ],
});
