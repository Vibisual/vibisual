import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "benchmark-hygiene",
  title: "직접 측정한 것만",
  rules: [
    "성능·품질을 주장할 때는 이 프로젝트에서 **직접 측정한 수치**만 근거로 써라.",
    "측정 조건(무엇을·몇 번·어떤 설정)을 함께 적어라. 못 재면 \"안 쟀다\"고 말하라.",
  ],
});
