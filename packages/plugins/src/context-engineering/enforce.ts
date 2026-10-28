/** §5.11 집행 규칙(매 턴 프롬프트에 실린다). "안 쓰는 도구는 목록에서 빼라"류를 넣지 마라 — `tool-use` 규칙과 같은 문장이다. 여기서는 무엇을 어떤 순서로 넣는가만 맡는다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "context-engineering",
  title: "색인 먼저, 본문은 나중",
  rules: [
    "통째로 밀어 넣지 말고 색인을 먼저 보고 필요한 본문만 읽어라.",
    "무엇을 왜 넣었는지 말할 수 없는 내용은 넣지 마라 — 채우는 것이 아니라 고르는 것이다.",
  ],
});
