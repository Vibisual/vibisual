/**
 * long-horizon — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "long-horizon",
  title: "긴 작업 관리",
  rules: [
    "긴 작업은 남은 단계를 눈에 보이게 유지하고, 한 단계 끝날 때마다 진행 상태를 갱신하라.",
    "컨텍스트가 바닥나기 전에 지금까지의 결과를 파일이나 보고로 굳혀라.",
  ],
});
