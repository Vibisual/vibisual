/**
 * context-engineering — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 *
 * ⚠ 둘째 줄은 원래 "안 쓰는 도구는 목록에서 빼라 — 정의만으로 창을 먹는다"였는데, 근거 절까지 포함해
 * `tool-use` 의 규칙과 사실상 같은 문장이었다. 도구 목록은 그 카드의 주제이므로 거기에 두고, 여기서는
 * 이 카드의 주제 — **무엇을 어떤 순서로 넣는가** — 를 맡는다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "context-engineering",
  title: "색인 먼저, 본문은 나중",
  rules: [
    "통째로 밀어 넣지 말고 색인을 먼저 보고 필요한 본문만 읽어라.",
    "무엇을 왜 넣었는지 말할 수 없는 내용은 넣지 마라 — 채우는 것이 아니라 고르는 것이다.",
  ],
});
