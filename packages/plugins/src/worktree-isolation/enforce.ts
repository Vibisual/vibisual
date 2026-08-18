/**
 * worktree-isolation — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "worktree-isolation",
  title: "같은 폴더를 동시에 만지지 마라",
  rules: [
    "여러 작업이 동시에 돌면 같은 폴더에서 겹쳐 일하지 말고 격리된 사본에서 하라.",
    "병합 전에 남의 변경을 덮어쓰지 않는지 확인하라.",
  ],
});
