/**
 * compaction-watch — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 *
 * ⚠ 둘째 줄은 원래 "지시를 기억에 의존하지 말고 원문을 다시 읽어라"였는데, `instruction-drift` 의
 * 규칙과 계기만 다른 같은 말이었다(어절 겹침 0.50). 지시 재확인은 그 카드에 두고, 여기서는 이 카드의
 * 주제 — **압축이 일어났다는 사실 자체를 사용자가 알게 하는 것** — 을 맡는다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "compaction-watch",
  title: "압축 손실 대비",
  rules: [
    "압축되면 구체적인 값(경로·수치·id)이 먼저 사라진다 — 중요한 값은 파일이나 보고에 적어 둬라.",
    "압축이 일어났으면 그 사실을 보고에 적어라 — 그 뒤 답이 얕아진 이유를 사용자가 알 수 있어야 한다.",
  ],
});
