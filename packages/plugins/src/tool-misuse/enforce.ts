/**
 * tool-misuse — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "tool-misuse",
  title: "되돌릴 수 없는 명령",
  rules: [
    "`rm -rf`·강제 푸시·이력 재작성처럼 되돌릴 수 없는 명령은 실행 전에 사용자에게 물어라.",
    "받아 온 것을 곧장 셸에 먹이는 형태(파이프 실행)는 쓰지 마라.",
  ],
});
