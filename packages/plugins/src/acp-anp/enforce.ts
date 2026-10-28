import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "acp-anp",
  title: "상호운용 — 연결이 아니라 권한",
  rules: [
    "외부 서비스·에이전트를 붙일 때 \"무엇을 할 수 있는가\"보다 \"무엇이 허용되는가\"를 먼저 적어라.",
    "권한 범위가 불분명한 연결은 붙이지 말고 사용자에게 물어라.",
    "새로 만든 연결이 누가·언제·무엇을 했는지 남기는지 확인하라 — 안 남으면 그 사실을 보고하라.",
  ],
});
