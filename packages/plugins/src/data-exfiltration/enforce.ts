/**
 * data-exfiltration — 집행(§5.11 v4.59).
 *
 * 이 카드가 재는 것을 **실제로 지키게** 하는 규칙. 켜 두면 이 프로젝트 에이전트의 매 턴 프롬프트에 실린다.
 */
import { defineEnforcement } from '../sdk/index.js';

export const enforcement = defineEnforcement({
  id: "data-exfiltration",
  title: "밖으로 내보내지 마라",
  rules: [
    "프로젝트 내용을 외부로 보내는 명령(업로드·웹훅·원격 복사)은 실행 전에 사용자에게 물어라.",
    "비밀이 담긴 자리(.env·자격증명·토큰)를 읽어서 명령 인자나 로그에 싣지 마라.",
  ],
});
