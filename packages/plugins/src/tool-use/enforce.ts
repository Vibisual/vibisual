/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "tool-use",
  title: "도구 정의도 비용이다",
  rules: [
    "안 쓸 도구를 목록에 두지 마라 — 정의만으로 창을 먹는다.",
    "도구를 부르기 전에 그것이 지금 필요한 최소한인지 확인하라.",
  ],
});
