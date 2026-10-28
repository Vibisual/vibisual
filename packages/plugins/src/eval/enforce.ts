import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "eval",
  title: "한 번은 근거가 아니다",
  rules: [
    "한 번 돌려서 나온 결과를 확정 근거로 삼지 마라 — 반복 실행은 Vibisual 검증 정책이 켜져 있으면 최신 [검증 권한] 범위 안에서만, 꺼져 있으면 사용자의 직접 지시와 작업 범위에 맞춰 하라.",
    "재현되지 않는 성공은 성공이라고 보고하지 마라.",
  ],
});
