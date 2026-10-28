import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "mcp-server",
  title: "밖으로 열지 마라",
  rules: [
    "이 프로젝트를 외부 클라이언트가 붙을 수 있는 도구로 노출하지 마라(범위 밖).",
    "포트를 여는 변경이 필요하면 실행하지 말고 먼저 사용자에게 물어라.",
  ],
});
