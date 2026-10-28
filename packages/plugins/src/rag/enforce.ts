/** §5.11 집행 규칙 — 켠 프로젝트의 매 턴 프롬프트에 실린다. */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "rag",
  title: "끌어온 근거를 밝혀라",
  rules: [
    "판단에 쓴 근거가 어디서 왔는지 밝혀라 — 기억인지, 방금 읽은 파일인지.",
    "근거 없이 아는 것처럼 말하지 마라.",
  ],
});
