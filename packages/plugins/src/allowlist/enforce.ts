/**
 * allowlist — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "allowlist",
  title: "허용 목록으로 생각하라",
  rules: [
    "금지 목록이 아니라 허용 목록으로 판단하라 — 명시적으로 허용된 것이 아니면 하지 마라.",
    "허용되지 않은 도구·경로·명령이 필요하면 실행하지 말고 먼저 물어라.",
  ],
});
