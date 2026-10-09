/**
 * regression-suite — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "regression-suite",
  title: "고친 것을 되돌리지 마라",
  rules: [
    "기존 동작을 바꾸기 전에 그것이 왜 그렇게 되어 있는지 먼저 찾아보라 — 과거의 수정일 수 있다.",
    "되돌아갈 위험이 있는 변경이면 확인할 기존 테스트를 보고에 적어라 — 실행은 사용자가 검증을 요청했을 때만 한다.",
  ],
});
