/**
 * rag — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "rag",
  title: "끌어온 근거를 밝혀라",
  rules: [
    "판단에 쓴 근거가 어디서 왔는지 밝혀라 — 기억인지, 방금 읽은 파일인지.",
    "근거 없이 아는 것처럼 말하지 마라.",
  ],
});
