/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "verifier-critic",
  title: "쓴 사람과 보는 사람을 나눠라",
  rules: [
    "자기가 쓴 것을 자기가 검토했다고 하지 마라 — 실행 검증은 Vibisual 검증 정책이 켜져 있으면 최신 [검증 권한] 범위 안에서만, 꺼져 있으면 사용자의 직접 지시와 작업 범위에 맞춰 하고, 안 했으면 안 했다고 밝혀라.",
    "검토 에이전트 실행에도 같은 최신 정책 상태와 권한 범위를 적용하라 — 띄우지 않았으면 반대 가설로 한 번 읽어 확인하라.",
  ],
});
