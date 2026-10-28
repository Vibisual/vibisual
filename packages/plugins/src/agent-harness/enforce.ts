/**
 * §5.11 집행 규칙(매 턴 프롬프트에 실린다). "권한을 늘려야 하면 승인을 받아라"류를 넣지 마라 — `least-privilege` 규칙과 어절 겹침 0.58 이라 함께 켜면 같은 지시가 두 번 실린다.
 * 여기서는 이 카드 고유의 각도(무엇을 바꿔서 달라졌는지 남기기)만 맡는다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agent-harness",
  title: "하네스 우선",
  rules: [
    "결과가 나쁘면 모델부터 바꾸지 마라 — 도구·권한·격리·스킬·규칙을 먼저 점검하라.",
    "하네스를 손봐서 결과가 달라졌으면 무엇을 바꿔 달라졌는지 남겨라 — 다음에 같은 상황에서 처음부터 헤매지 않도록.",
  ],
});
