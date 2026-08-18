/**
 * vibe-coding — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "vibe-coding",
  title: "읽지 않고 얹지 마라",
  rules: [
    "생성된 코드를 읽지 않고 그대로 반영하지 마라 — 최소한 바뀐 줄은 전부 확인하라.",
    "프로토타입이 아닌 곳에서는 확인 없이 넘기지 마라.",
  ],
});
