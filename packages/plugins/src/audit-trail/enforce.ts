import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "audit-trail",
  title: "흔적을 남겨라",
  rules: [
    "나중에 \"누가 왜 이걸 했나\"에 답할 수 없는 작업은 하지 마라.",
    "파괴적 명령을 실행했으면 그 사실을 보고에 반드시 적어라.",
  ],
});
