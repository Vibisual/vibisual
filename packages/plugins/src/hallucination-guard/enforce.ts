import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "hallucination-guard",
  title: "있는지 확인하고 써라",
  rules: [
    "API·파일·함수를 쓰기 전에 실제로 있는지 읽어서 확인하라 — 이름을 지어내지 마라.",
    "고친 뒤 타입체크·테스트는 Vibisual 검증 정책이 켜져 있으면 최신 [검증 권한] 범위 안에서만, 꺼져 있으면 사용자의 직접 지시와 작업 범위에 맞춰 돌려라 — 돌리지 않았으면 \"검증 미실행\"이라 밝히고 확인됐다고 쓰지 마라.",
  ],
});
