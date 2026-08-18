/**
 * adr-presence — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "adr-presence",
  title: "결정 기록",
  rules: [
    "설계 결정을 내리면 채택안뿐 아니라 **버린 안과 그 이유**를 함께 남겨라.",
    "기존 설계를 바꾸기 전에 그 결정이 이미 기록돼 있는지 찾고, 있으면 이유를 먼저 읽어라.",
    "\"왜 이렇게 했는지\"를 한 줄로 답할 수 없는 변경은 하지 마라.",
  ],
});
