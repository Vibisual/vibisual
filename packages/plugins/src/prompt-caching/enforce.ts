/**
 * prompt-caching — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "prompt-caching",
  title: "앞부분을 흔들지 마라",
  rules: [
    "매 요청 앞부분에 시각·난수처럼 매번 바뀌는 값을 넣지 마라 — 재사용이 통째로 깨진다.",
    "고정 지시는 앞에, 바뀌는 내용은 뒤에 두어라.",
  ],
});
