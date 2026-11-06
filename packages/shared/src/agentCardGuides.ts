import type { AgentRuleShell } from './agentRuleShell.js';
import {
  buildAgentCardCommonRules, buildAgentCardRequest, buildAgentQuestionRules, buildAgentReportRules, buildAgentReviewRules,
} from './constants.js';

export const AGENT_CARD_KINDS = ['report', 'question', 'review'] as const;
type CardKind = typeof AGENT_CARD_KINDS[number];
type CardArgs = Parameters<typeof buildAgentCardCommonRules>[0];

const CARD_BUILDERS = {
  report: buildAgentReportRules,
  question: buildAgentQuestionRules,
  review: buildAgentReviewRules,
};
/** Static guides contain no launch identity or credential; the current prompt supplies those values. */
export function buildAgentCardCommonGuide(shell: AgentRuleShell): string {
  const args = { serverBase: '<serverBase>', serverToken: '', agentId: '<agentId>', subAgentId: '<subAgentId>', shell };
  return `# Vibisual 카드 실행 규칙 — 공통
현재 공통 지침의 신원 JSON을 그대로 복사(null 포함)하고 선택한 카드 필드를 추가한다. <serverBase>는 현재 주소, <엔드포인트>는 카드별 문서의 API 이름으로 대입한다. 다른 세션 값·추측 금지.
${buildAgentCardRequest(args)}
- 카드는 최종 보고 형식이지 작업 종료 조건이 아니다. 답 없이 가능한 승인된 작업·검증을 먼저 마친다. 중간 답변이나 작업 범위를 줄이지 마라.
- 본문에 짧은 결론 1~2문장을 먼저 쓰고 보고의 마지막 동작으로 1회 호출한다. 작업 도중 미리 보내지 마라. 한 턴에 카드 하나, 직접 할 일이 있으면 작업 신고 우선.
- 접수 성공은 HTTP 2xx 응답의 ok:true와 카드 id, 또는 실제 화면 표시로 확인한다. 도구 실행·마커 인쇄 성공만으로 단정하지 마라.
- 성공 확인 후에만 "카드를 확인해 주세요." 한 문장으로 끝낸다(사용자 언어). 목록 재나열·발송 사실 보고 금지. 본문을 비우지 마라.
- 실패·시간 초과·성공 여부 불명확 시에는 고정 문장·중복 금지를 적용하지 말고 완료 내용·남은 일·필요한 사용자 조치·질문·확인 방법을 일반 답변으로 전달한다. "no visible output" 재촉에도 같다.
- 카드는 작업 결과·실행 권한을 바꾸지 않으며 화면 표시·세션 복원을 위해 저장된다. 기억 관련 필드는 신고 기록에만 보존되며 별도 기억 생성·평가에 쓰지 않는다.
`;
}

export function buildAgentCardGuide(kind: CardKind, shell: AgentRuleShell): string {
  return CARD_BUILDERS[kind]({ serverBase: '', serverToken: '', agentId: '', shell });
}

/** The same parts feed both the context inventory and the actual prompt. */
export function buildAgentCardPromptParts(args: CardArgs & { guideDir?: string }): {
  common: string; report: string; question: string; review: string;
} {
  if (!args.guideDir) {
    return {
      common: buildAgentCardCommonRules(args),
      report: buildAgentReportRules(args),
      question: buildAgentQuestionRules(args),
      review: buildAgentReviewRules(args),
    };
  }
  const identity = JSON.stringify({ agentId: args.agentId, subAgentId: args.subAgentId ?? null });
  return {
    common: `

# Vibisual 카드
카드는 최종 보고에 한 턴 하나만, 직접 조치가 있으면 작업 신고 우선.
아래 조건이 생기면 전송 전에 common.md와 해당 파일만 한 번에 Read하여 따른다. 문맥에 남은 규칙은 재독하지 말고 유실되면 다시 읽는다. 평소에는 읽지 마라.
규칙 폴더: ${JSON.stringify(args.guideDir)}
신원: ${identity}
주소: ${args.serverBase}
읽기·전송 실패나 접수 미확인은 일반 답변으로 결과·조치·질문을 전한다. 확인 없이 카드 안내 금지.`,
    report: '\n\n## 작업 신고\n대신 못 해 사용자가 직접 해야 할 일이 생긴 완료 보고만 → report.md. userActions가 비면 보내지 마라.',
    question: '\n\n## 질문 카드\n승인·사용자만 아는 값·의도·큰 갈림길로 막혔을 때만 → question.md. 받은 승인은 되묻지 마라. 독립적인 승인 작업은 먼저 마치고, 답에 의존하는 작업은 기다린다.',
    review: '\n\n## 검수 카드\n지시받은 수정·기능 변경을 완료해 결과 확인이 필요할 때만 → review.md. 단순 완료·일상 대화·질문 답변·조사 보고에는 보내지 마라.',
  };
}
