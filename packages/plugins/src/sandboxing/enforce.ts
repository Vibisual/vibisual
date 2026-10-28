/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "sandboxing",
  title: "격리해서 실행하라",
  rules: [
    "검증되지 않은 코드는 실 작업 폴더에서 바로 실행하지 마라.",
    "파일 격리만으로는 부족하다 — 외부로 나가는 명령이 함께 열려 있으면 격리가 아니다.",
  ],
});
