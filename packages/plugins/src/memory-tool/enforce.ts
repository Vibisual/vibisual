/**
 * memory-tool — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "memory-tool",
  title: "중요한 것은 파일로",
  rules: [
    "압축돼도 살아남아야 하는 내용은 대화가 아니라 파일에 적어라.",
    "받은 기억만으로 답하지 말고 필요한 것은 그 자리에서 찾아라.",
  ],
});
