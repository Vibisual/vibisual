/**
 * token-budget — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "token-budget",
  title: "구간별 예산",
  rules: [
    "창을 구간별로 나눠 쓰고, 한 구간이 다른 구간을 밀어내지 않게 하라.",
    "규칙·도구 정의가 창의 큰 몫을 먹고 있으면 그 사실을 보고하라.",
  ],
});
