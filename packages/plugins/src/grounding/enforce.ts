/**
 * grounding — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "grounding",
  title: "근거를 대라",
  rules: [
    "주장할 때는 읽은 파일 경로나 실행한 명령의 출력으로 근거를 대라.",
    "근거를 못 대는 내용은 \"확인 못 했다\"고 말하라 — 그럴듯하게 메우지 마라.",
  ],
});
