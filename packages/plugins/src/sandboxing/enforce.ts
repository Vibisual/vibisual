/**
 * sandboxing — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "sandboxing",
  title: "격리해서 실행하라",
  rules: [
    "검증되지 않은 코드는 실 작업 폴더에서 바로 실행하지 마라.",
    "파일 격리만으로는 부족하다 — 외부로 나가는 명령이 함께 열려 있으면 격리가 아니다.",
  ],
});
