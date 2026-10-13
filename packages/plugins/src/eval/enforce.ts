/**
 * eval — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "eval",
  title: "한 번은 근거가 아니다",
  rules: [
    "한 번 돌려서 나온 결과를 확정 근거로 삼지 마라 — 반복 실행은 Vibisual 검증 정책이 켜져 있으면 최신 [검증 권한] 범위 안에서만, 꺼져 있으면 사용자의 직접 지시와 작업 범위에 맞춰 하라.",
    "재현되지 않는 성공은 성공이라고 보고하지 마라.",
  ],
});
