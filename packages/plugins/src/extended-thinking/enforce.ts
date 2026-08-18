/**
 * extended-thinking — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "extended-thinking",
  title: "생각은 필요한 만큼만",
  rules: [
    "계획·디버깅·다단계 추론일 때만 깊게 생각하고, 단순 작업에서는 바로 실행하라.",
    "생각이 길어지면 그만큼 창을 먹는다 — 결론이 서면 더 굴리지 말고 실행하라.",
  ],
});
