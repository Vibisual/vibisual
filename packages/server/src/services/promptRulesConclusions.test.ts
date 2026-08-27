/**
 * §5.5 #17-28 ⑧(f) — **결론이 하나라도 빠지면 실패**.
 *
 * ⑧(f) 는 규약에서 *이유*를 걷어 문서(`CARD_RULES_DOCUMENT`)로 내리고 프롬프트에는 결론만 남겼다.
 * 그 압축은 한 번으로 끝나지 않는다 — 다음에 누군가 "여기도 줄일 수 있겠는데" 하고 한 줄을 더 지우면
 * 그때부터 카드가 조용히 이상해진다(도배되거나, 본문 위로 뒤집히거나, 빈 신고가 늘거나).
 * 그런 회귀는 화면을 오래 봐야 겨우 눈치채므로, **줄여도 되는 것과 안 되는 것의 경계**를 여기 못박는다.
 *
 * 판정 규칙은 하나다: 아래 목록의 각 결론은 **프롬프트에 실리는 문자열 안에** 있어야 한다.
 * 문서에만 있으면 실패다 — 문서는 읽기를 강제하지 않는 예비 경로이기 때문이다(⑧(f)).
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_INTENT_FIRST_RULES,
  CARD_RULES_DOCUMENT,
  buildAgentCardCommonRules,
  buildAgentQuestionRules,
  buildAgentReportRules,
  buildAgentReviewRules,
  buildSessionGoalProtocol,
  buildSessionGoalState,
} from '@vibisual/shared';

const ARGS = {
  serverBase: 'http://127.0.0.1:51360',
  serverToken: 'test-token',
  agentId: 'agent-1',
  subAgentId: 'sub-1',
  docPath: 'C:/work/demo-app/.vibisual/rules/cards.md',
};
const GOAL = { ...ARGS, goalText: '목표', percent: 0, steps: [], authoredBy: 'session' as const, revision: 0 };

/** 한 턴의 프롬프트에 실제로 실리는 규약 전량(카드 4줄 + 의도 + 목표 규약 + 목표 상태). */
const PROMPT = [
  buildAgentCardCommonRules(ARGS),
  buildAgentReportRules(ARGS),
  buildAgentQuestionRules(ARGS),
  buildAgentReviewRules(ARGS),
  AGENT_INTENT_FIRST_RULES,
  buildSessionGoalProtocol(GOAL),
  buildSessionGoalState(GOAL),
].join('\n');

/** 결론 한 줄 → 그것이 살아 있음을 확인하는 패턴. 이름은 실패 메시지에 그대로 뜬다. */
const CONCLUSIONS: [string, RegExp][] = [
  ['작업신고 — 사용자가 직접 해야 할 일이 생겼을 때만', /사용자가 직접 해야 할 일이 실제로 생긴/],
  ['작업신고 — 단순 완료·조사 보고에는 보내지 않는다', /단순 완료·일상 대화·질문 답변·조사 보고에는 보내지 마라/],
  ['작업신고 — userActions 가 비면 보내지 않는다', /이게 비면 보내지 마라/],
  ['작업신고 — 필드 6종', /did\[\][\s\S]*userActions\[\][\s\S]*nextSteps\[\][\s\S]*learned\[\][\s\S]*helpfulMemoryIds\[\][\s\S]*staleMemoryIds\[\]/],
  ['작업신고 — learned 는 최대 3개', /최대 3/],
  ['작업신고 — staleMemoryIds 는 삭제되지 않는다', /삭제되지 않으니/],
  ['질문 — 답을 기다릴 때만, 없으면 보내지 않는다', /사용자 답을 기다리는 질문이 있을 때만[\s\S]*질문이 없으면 보내지 마라/],
  ['질문 — prompts 는 사용자가 1인칭으로 보낼 답', /1인칭으로/],
  ['검수 — 결과 확인이 필요할 때만', /결과를 확인해야 할 때만/],
  ['검수 — changes 가 비면 보내지 않는다', /changes\[\][\s\S]*이게 비면 보내지 마라/],
  ['검수 — 필드 3종', /instruction\?[\s\S]*changes\[\][\s\S]*checkpoints\[\]/],
  ['공통 — 본문 먼저, 카드는 마지막 동작 1회', /본문\(짧은 결론\)을 먼저 쓰고[\s\S]*맨 마지막 동작으로 1회 호출/],
  ['공통 — 호출 뒤 본문을 더 붙이지 않는다', /호출 뒤에는 본문을 더 붙이지 마라/],
  ['공통 — 발송 사실 보고 금지', /발송 사실 보고 금지/],
  ['공통 — 덧붙일 맥락 없으면 침묵', /아무 말 없이 끝내라/],
  ['공통 — 작업 도중 미리 보내지 않는다', /작업 도중에 미리 보내지 마라/],
  ['공통 — 한 턴에 카드는 하나', /한 턴에 카드는 하나/],
  ['공통 — 카드 목록을 본문에 다시 나열하지 않는다', /본문에 다시 나열하지 마라/],
  ['공통 — 표시 전용, 실패해도 보고는 진행', /표시 전용[\s\S]*실패해도 무시하고 보고는 그대로 진행/],
  ['공통 — 토큰 헤더', /x-vibisual-hook-token/],
  ['공통 — 애매하면 문서를 읽는 예비 경로', /Read 하라/],
  ['의도 — 도구 전에 첫 말로 1~2문장', /그 턴의 첫 말로[\s\S]*1~2문장 말하라/],
  ['의도 — 여러 단계면 TodoWrite 로 계획', /여러 단계면[\s\S]*TodoWrite/],
  ['의도 — 말한 계획과 실제가 달라지면 안 된다', /말한 계획과 실제로 하는 일이 달라지면 안 된다/],
  ['의도 — 한 줄 대화에서는 생략 가능', /생략해도 된다/],
  ['목표 — 목록을 비워 두지 않는다', /비워 두지 마라/],
  ['목표 — ① 넣고 ② 끝내면 done', /지금 할 일을 목록에 넣는다[\s\S]*done.{0,4} 으로 옮긴다/],
  ['목표 — TodoWrite 우선, 없으면 steps', /TodoWrite.{0,4} 가 있으면[\s\S]*없으면 아래 .steps. 로/],
  ['목표 — 사용자의 방금 명령이 목표보다 우선', /사용자가 방금 보낸 명령이 목표보다 우선이다/],
  ['목표 — 사용자가 고친 문장은 건드리지 않는다', /사용자가 직접 고친 문장이라고 표시돼 있으면 건드리지 마라/],
  ['목표 — steps 는 목록 전체를 통째로', /목록 전체.{0,4}를 통째로/],
  ['목표 — 실제로 끝난 것만 done', /실제로 끝난 것만/],
  ['목표 — 바뀐 게 없으면 보내지 않는다', /바뀐 게 없으면 보내지 마라/],
  ['목표 — 표시 전용', /표시 전용이라 결과엔 영향이 없다/],
];

describe('§5.5 #17-28 ⑧(f) — 규약을 줄여도 결론은 남는다', () => {
  it.each(CONCLUSIONS)('프롬프트에 살아 있다: %s', (_name, re) => {
    expect(re.test(PROMPT)).toBe(true);
  });

  it('문서는 프롬프트에 실리지 않는다(읽기는 강제되지 않는 예비 경로)', () => {
    expect(PROMPT).not.toContain(CARD_RULES_DOCUMENT);
    // 대신 경로 한 줄로만 가리킨다.
    expect(buildAgentCardCommonRules(ARGS)).toContain(ARGS.docPath);
  });

  it('문서 경로가 없으면 "읽어라" 줄 자체가 빠진다(없는 파일을 가리키지 않는다)', () => {
    const withoutDoc = buildAgentCardCommonRules({ ...ARGS, docPath: undefined });
    expect(withoutDoc).not.toContain('Read 하라');
  });

  it('압축분 — 규약 총량이 다시 부풀지 않는다(⑧(f) 시점 1,900 토큰대)', () => {
    // 상한만 못박는다(줄이는 것은 언제든 환영, 늘리는 것만 눈에 띄면 된다).
    expect(PROMPT.length).toBeLessThan(4_500);
  });
});
