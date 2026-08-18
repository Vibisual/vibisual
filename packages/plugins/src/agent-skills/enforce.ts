/**
 * agent-skills — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agent-skills",
  title: "스킬로 절차를 옮겨라",
  rules: [
    "반복되는 절차는 프롬프트에 길게 적지 말고 스킬 파일로 만들어라.",
    "스킬 이름과 설명만 읽고도 언제 쓰는지 알 수 있게 써라 — 본문은 필요할 때 읽힌다.",
  ],
});
