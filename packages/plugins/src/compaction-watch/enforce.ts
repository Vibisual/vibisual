/**
 * §5.11 집행 규칙(매 턴 프롬프트에 실린다). "지시를 기억에 의존하지 말고 원문을 다시 읽어라"류를 넣지 마라 — `instruction-drift` 규칙과 같은 말이다(어절 겹침 0.50).
 * 여기서는 압축이 일어났다는 사실을 사용자가 알게 하는 것만 맡는다.
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
