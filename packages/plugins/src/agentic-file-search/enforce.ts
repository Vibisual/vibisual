/**
 * agentic-file-search — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "agentic-file-search",
  title: "지금 파일을 직접 본다",
  rules: [
    "코드베이스에서 무언가 찾을 때 기억이나 색인에 의존하지 말고 Grep/Glob 으로 **현재 파일**을 검색하라.",
    "\"아마 여기 있을 것\"으로 단정하지 말고 찾은 경로를 근거로 대라.",
  ],
});
