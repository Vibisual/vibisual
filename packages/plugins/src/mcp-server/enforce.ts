/**
 * mcp-server — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "mcp-server",
  title: "밖으로 열지 마라",
  rules: [
    "이 프로젝트를 외부 클라이언트가 붙을 수 있는 도구로 노출하지 마라(범위 밖).",
    "포트를 여는 변경이 필요하면 실행하지 말고 먼저 사용자에게 물어라.",
  ],
});
