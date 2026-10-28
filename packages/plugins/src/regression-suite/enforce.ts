/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "regression-suite",
  title: "고친 것을 되돌리지 마라",
  rules: [
    "기존 동작을 바꾸기 전에 그것이 왜 그렇게 되어 있는지 먼저 찾아보라 — 과거의 수정일 수 있다.",
    "되돌아갈 위험이 있는 변경이면 확인할 기존 테스트를 보고에 적어라 — 실행은 Vibisual 검증 정책이 켜져 있으면 최신 [검증 권한] 범위 안에서만, 꺼져 있으면 사용자의 직접 지시와 작업 범위에 맞춰 하라.",
  ],
});
