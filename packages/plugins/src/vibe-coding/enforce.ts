/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "vibe-coding",
  title: "읽지 않고 얹지 마라",
  rules: [
    "생성된 코드를 읽지 않고 그대로 반영하지 마라 — 최소한 바뀐 줄은 전부 확인하라.",
    "프로토타입이 아닌 곳에서는 확인 없이 넘기지 마라.",
  ],
});
