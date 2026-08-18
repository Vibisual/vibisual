/**
 * chunking — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "chunking",
  title: "한 조각 = 한 뜻",
  rules: [
    "기억·문서를 나눌 때 한 조각은 혼자 읽어도 뜻이 통하는 단위로 하라.",
    "한 조각에 여러 주제를 섞지 마라.",
  ],
});
