/**
 * Keep reporting and scope boundaries consistent across HTTP, terminal markers, and the optional rules document.
 * Wording may change; a successful-card shortcut must never hide a failed report or authorize extra work.
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_INTENT_FIRST_RULES,
  CARD_RULES_DOCUMENT,
  buildAgentCardCommonRules,
  buildAgentQuestionRules,
  buildAgentReportRules,
  buildAgentReviewRules,
  buildCmdCardProtocolRules,
  buildSessionGoalProtocol,
  buildSessionGoalState,
  parseStageBlockBody,
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
  ['질문 — 멈춰 서야 할 때만, 없으면 보내지 않는다', /멈춰 서야만 하는 질문일 때만[\s\S]*질문이 없으면 보내지 마라/],
  ['질문 — 지시 안에 이미 있는 답을 되묻지 않는다', /지시 안에 이미 답이 있는 것을 되묻지 마라/],
  ['질문 — 이미 받은 승인은 되묻지 않는다', /받은 승인을 되묻지 말고/],
  ['질문 — 승인되지 않은 외부 작업은 먼저 묻는다', /물어도 되는 것[^\n]*아직 승인되지 않은 삭제·배포·과금·외부 전송/],
  ['질문 — prompts 는 사용자가 1인칭으로 보낼 답', /1인칭으로/],
  ['질문 — 선택형은 실제 대안을 모두 포함', /선택형은 실제 대안을 모두 포함하라\(A\/B 질문에 A만 금지\)/],
  // ↓ §4 질문 카드 — 답을 골라 보내는 카드다. "사용자만 아는 값은 `prompts: []`" 로 되돌리면
  //   질문마다 답이 비어 카드가 입력칸이 된다(아래 '돌아오지 않는다' 검사).
  ['질문 — 질문마다 고를 답 2~4개, 비우지 않는다', /질문마다 2~4개 — 비우지 마라/],
  ['질문 — 의도를 물어도 그럴듯한 답을 초안으로', /의도를 물어도 그럴듯한 답을 초안으로/],
  ['질문 — 비밀값은 지어내지 않고 주는 방법을 답으로', /비밀값은 지어내지 말고 주는 방법을 답으로/],
  ['질문 — 질문은 짧게, 배경은 note', /질문은 짧게, 배경은 `note`/],
  ['검수 — 결과 확인이 필요할 때만', /결과를 확인해야 할 때만/],
  ['검수 — changes 가 비면 보내지 않는다', /changes\[\][\s\S]*이게 비면 보내지 마라/],
  ['검수 — 필드 3종', /instruction\?[\s\S]*changes\[\][\s\S]*checkpoints\[\]/],
  ['공통 — 본문 먼저, 카드는 마지막 동작 1회', /본문\(짧은 결론\)을 먼저 쓰고[\s\S]*맨 마지막 동작으로 1회 호출/],
  ['공통 — 발송 사실 보고 금지', /발송 사실 보고 금지/],
  ['공통 — 작업 도중 미리 보내지 않는다', /작업 도중에 미리 보내지 마라/],
  ['공통 — 한 턴에 카드는 하나', /한 턴에 카드는 하나/],
  ['공통 — 토큰 헤더', /x-vibisual-hook-token/],
  ['공통 — 애매하면 문서를 읽는 예비 경로', /Read 하라/],
  ['의도 — 도구 전에 첫 말로 의도·할 일', /도구를 쓰기 전에, 그 턴의 첫 말로[\s\S]*말하라/],
  // ↓ §5.5 #17-12 ①-1 — "1~2문장" 고정 상한이 긴 지시의 70% 를 조용히 버리던 자리. 아래 셋이 재발 방지다.
  //   상한을 다시 고정으로 되돌리면(=아래 셋 중 하나라도 지우면) 같은 사고가 그대로 돌아온다.
  ['의도 — 길이는 요구 개수를 따라간다', /길이는 사용자가 말한 요구의 개수를 따라간다/],
  ['의도 — 여러 개면 요구마다 한 줄, 하나도 빼지 않는다', /여러 개면 요구마다 한 줄씩 빠짐없이 되짚어라[\s\S]*하나도 빼지 마라/],
  ['의도 — 모르겠는 항목·안 할 항목도 적는다', /모르겠는 항목·이번에 안 할 항목도 그 목록에 적어라/],
  ['의도 — 여러 단계면 첫 말과 함께 계획을 설명한다', /여러 단계면 그 첫 말과[^\n]{0,10}함께[^\n]{0,20}계획을 세워라/],
  ['의도 — 목표 갱신은 현재 세션에 제공된 규약이 있을 때만', /이 세션에 아래 목표 창 규약이 제공된 경우에만 그 블록으로 갱신/],
  ['의도 — 되짚은 요구가 그대로 단계가 된다', /되짚은 요구가 그대로 단계가 된다/],
  ['의도 — 말한 계획과 실제가 달라지면 안 된다', /말한 계획과 실제로 하는 일이 달라지면 안 된다/],
  ['의도 — 한 줄 대화에서는 생략 가능', /생략해도 된다/],
  // ↓ §5.5 #17-17 ㉑·㉓ — 목표 규약에서 남긴 결론의 전부. 이 아래로 더 줄이면 목표 창이 서지 않는다.
  //   ㉓ 로 **시점**이 결론에 들어왔다: "이 턴에" 만으로는 턴 끝도 이 턴이라, 모델이 규약을 어기지 않고도
  //   늘 늦었다(실측: 14분 세션에서 블록이 끝나기 37초 전에 딱 한 번).
  ['목표 — 목록은 도구 쓰기 전 첫 답에서 세운다', /도구를 쓰기 전에 이 턴 첫 답에서 세우고/],
  ['목표 — 단계를 끝낼 때마다 그 자리에서 옮긴다', /단계를 끝낼 때마다 그 자리에서 옮겨라/],
  ['목표 — 마지막에 한 번 적는 것은 적지 않은 것과 같다', /마지막에 한 번 적는 것은 적지 않은 것과 같다/],
  ['목표 — 작업 장부를 써도 같은 목록으로 흐른다', /TaskCreate[\s\S]{0,16}TaskUpdate[\s\S]{0,20}같은 목록으로 흐른다/],
  ['목표 — 갱신은 답 안의 코드블록', /답 안에 코드블록으로/],
  ['목표 — 목록은 통째로, 본문·표식은 그대로', /목록은 통째로 적고 본문·표식[\s\S]{0,24}그대로 옮긴다/],
  ['목표 — 같은 본문 = 같은 항목', /같은 본문 = 같은 항목/],
  ['목표 — 실제로 끝난 것만', /실제로 끝난 것만/],
  ['목표 — 바뀐 게 없으면 적지 않는다', /바뀐 게 없으면 적지 마라/],
  ['목표 — 표시 전용', /표시 전용이다/],
  ['목표 — 사용자의 방금 명령이 목표보다 우선', /사용자가 방금 보낸 명령이 목표보다 우선이다/],
  ['작업 — 설명만으로 끝내지 않고 승인된 수정·검증을 마친다', /확인·원인 설명·계획 제시만으로 끝내지 마라[\s\S]*승인된 범위의 수정과 필요한 검증까지/],
  ['작업 — 후속 질문은 원래 요청의 취소가 아니다', /후속 질문·상태 문의·정정은 기존 요청의 취소가 아니다/],
  ['작업 — 조사만 요청하면 범위를 넓히지 않는다', /조사·검토만 요청했다면 그 범위를 넘겨 수정하지 마라/],
  ['카드 — 최종 보고 형식이 작업 종료 조건이 되지 않는다', /카드는 최종 보고 형식이지 작업 종료 조건이 아니다/],
  ['목표 — 사용자가 고친 문장·사용자 추가 단계는 지우지 않는다', /사용자가 고친 문장[\s\S]{0,40}사용자 추가[\s\S]{0,30}지우지 말고/],
  // ↓ §5.5 #17-17 ⑪(i)(m) — 있는 종류 키를 먼저 써야 카드가 흩어져 서로를 휴지통으로 밀지 않는다.
  //   새 종류는 밑그림(`from`)으로(직접 그리기 절은 ㉑ 에서 뺐다, 파서는 읽는다).
  ['종류 — 있는 키를 먼저 쓴다', /있는 종류[\s\S]{0,30}먼저 쓴다/],
  ['종류 — 새 종류는 kind + from(밑그림) 으로 만든다', /kind 키: 이름[\s\S]{0,40}from: 밑그림/],
  ['종류 — blurb 는 들어설 때 뜨는 한 줄', /blurb: 들어설 때 뜨는 한 줄/],
  // ↓ §5.5 #17-17 ⑰(b) — 나란히 놓인 행. 이 둘이 빠지면 모델은 `∥` 를 모르거나(행이 그냥 순서로 읽힌다)
  //   갈래마다 따로 보고한다. "그대로 옮긴다"는 위 "본문·표식은 그대로" 가 맡는다.
  ['나란히 — ∥ 는 앞 단계와 같은 행 = 병렬', /∥ 앞 단계와 같은 행 = 병렬/],
  ['나란히 — 갈라 돌리고, 행이 다 끝나면 한 번에 보고', /갈라 돌리고, 행이 다 끝나면 한 번에 보고/],
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

  it('CMD 질문도 고를 답을 질문마다 2~4개 싣고, 대안을 빠뜨리지 않는다', () => {
    const cmd = buildCmdCardProtocolRules();
    expect(cmd).toContain('선택형은 실제 대안을 모두 포함하라(A/B 질문에 A만 금지)');
    expect(cmd).toContain('**질문마다 2~4개 — 비우지 마라**');
    expect(cmd).toContain('의도를 물어도 그럴듯한 답을 초안으로');
    expect(cmd).toContain('비밀값은 지어내지 말고 주는 방법을 답으로');
    // HTTP 판본과 한 벌 — 판본마다 다르게 적으면 카드 모양이 에이전트 종류에 따라 갈린다.
    const http = buildAgentQuestionRules(ARGS);
    const sameTail = cmd.slice(cmd.indexOf('`prompts` 는 사용자가'), cmd.indexOf('주는 방법을 답으로.'));
    expect(sameTail.length).toBeGreaterThan(40);
    expect(http).toContain(sameTail);
    expect(cmd).toContain('질문은 짧게, 배경은 `note`');
    expect(cmd).not.toContain('이 순서로 진행할까요?');
  });

  it('§4 질문 카드 — "빈 prompts 로 직접 입력을 받아라"는 결론은 어느 판본에도 돌아오지 않는다', () => {
    // 이 결론이 실리자 에이전트가 의도·경험을 묻는 질문마다 답을 비워, 카드가 고를 답 없이 입력칸만 남았다.
    const EMPTY_PROMPTS = /prompts: \[\]|직접 답변 입력으로 받는다/;
    expect(PROMPT).not.toMatch(EMPTY_PROMPTS);
    expect(buildCmdCardProtocolRules()).not.toMatch(EMPTY_PROMPTS);
    expect(CARD_RULES_DOCUMENT).not.toMatch(EMPTY_PROMPTS);
    // 이유는 문서에 남는다(프롬프트에는 결론만).
    expect(CARD_RULES_DOCUMENT).toContain('질문 카드는 사용자가 네 답을 골라 그대로 보내려고 있는 것이다');
  });

  it('문서 경로가 없으면 "읽어라" 줄 자체가 빠진다(없는 파일을 가리키지 않는다)', () => {
    const withoutDoc = buildAgentCardCommonRules({ ...ARGS, docPath: undefined });
    expect(withoutDoc).not.toContain('Read 하라');
  });

  it('HTTP와 CMD 모두 카드 뒤 침묵을 요구하지 않는다', () => {
    const SILENT = /아무 말(?:도)? (?:없이|하지 말고) (?:그대로 )?끝내라/;
    expect(PROMPT).not.toMatch(SILENT);
    // 판본마다 다르게 적으면 화면 모양이 에이전트 종류에 따라 갈린다(⑦-4 와 같은 이유).
    const cmd = buildCmdCardProtocolRules();
    expect(cmd).not.toMatch(SILENT);
    expect(cmd).toContain('작업·질문·검수·번호 목록 카드에 적용한다(iframe 제외)');
    expect(cmd).toContain('iframe은 카드 `id`를 반환하지 않는다');
    expect(cmd).toContain('일반 답변에 확인한 URL을 안내한다');
  });

  it('성공·실패와 승인·목표 적용 조건을 포함해 규약 총량을 제한한다', () => {
    // Measured at 4,731 characters after making failure recovery and authorization explicit.
    // Keep little headroom: the optional explanation document must not move into every prompt.
    expect(PROMPT.length).toBeLessThan(4_800);
  });
});

describe('카드 전송 결과에 따라 보고 방식이 달라진다', () => {
  it.each([
    ['HTTP Bash', buildAgentCardCommonRules(ARGS)],
    ['HTTP PowerShell', buildAgentCardCommonRules({ ...ARGS, shell: 'powershell' })],
    ['CMD', buildCmdCardProtocolRules()],
    ['참고 문서', CARD_RULES_DOCUMENT],
  ])('%s는 확인된 접수에만 고정 문장을 쓰고 실패·미확인은 일반 답변으로 복구한다', (_name, rules) => {
    const plain = rules.replace(/\*\*|`/g, '').replace(/\s+/g, ' ');
    expect(plain).toMatch(/접수 성공(?:을)? 확인(?:한 경우에만| 후에만) "카드를 확인해 주세요\."/);
    expect(plain).toContain('HTTP 2xx 응답의 ok:true와 카드 id');
    expect(plain).toMatch(/실패·시간 초과·성공 여부 불명확 시에는[^.]*고정 (?:종료 )?문장과 목록 중복 금지를 적용하지/);
    expect(plain).toMatch(/완료 내용·남은 일·\s*필요한 사용자 조치·질문·확인 방법을 일반 답변으로 전달/);
    // A shell command succeeding or printing a terminal marker does not acknowledge server receipt.
    expect(plain).toMatch(/(?:도구 실행·마커 인쇄 성공만으로 접수 성공을 단정하지 마라|마커 인쇄나 도구 실행 성공만으로는 접수를 확인할 수 없다)/);
  });

  it.each([
    ['HTTP', buildAgentCardCommonRules(ARGS)],
    ['CMD', buildCmdCardProtocolRules()],
    ['참고 문서', CARD_RULES_DOCUMENT],
  ])('%s는 전송 실패를 무시하거나 확인 없이 종료시키지 않는다', (_name, rules) => {
    expect(rules).not.toMatch(/실패(?:\([^)]*\))?해도 무시/);
    expect(rules).not.toMatch(/호출 뒤에는 \*\*"카드를 확인해 주세요\." 한 문장만/);
    expect(rules).not.toMatch(/인쇄한 뒤에는 \*\*"카드를 확인해 주세요\." 한 문장만/);
    expect(rules).not.toContain('카드 신고는 화면 표시만 바꾼다');
  });

  it.each([
    ['질문 지침', buildAgentQuestionRules(ARGS)],
    ['CMD', buildCmdCardProtocolRules()],
    ['참고 문서', CARD_RULES_DOCUMENT],
  ])('%s는 승인 범위 안의 독립 작업만 계속하고 승인·입력 의존 작업은 기다린다', (_name, rules) => {
    const plain = rules.replace(/\*\*/g, '').replace(/\s+/g, ' ');
    expect(plain).toContain('이미 승인된 작업 범위 안에서만');
    expect(plain).toMatch(/질문과 독립적인 승인된 작업은 계속/);
    expect(plain).toMatch(/필요한 승인·입력에 의존하는 작업은 답을 받을 때까지 실행하지/);
    expect(rules).not.toContain('되돌릴 수 있는 것은 물을 값이 없다');
    expect(rules).not.toContain('그래서 그쪽만 묻는다');
    expect(rules).not.toContain('묻더라도 멈추지 마라');
    expect(rules).not.toContain('손을 놓는 것은 **막혔을 때뿐**');
  });

  it('보고 필드가 기억의 생성·재검증·보관까지 수행한다고 안내하지 않는다', () => {
    const report = buildAgentReportRules(ARGS);
    expect(report).toContain('ID는 실제 제공받은 경우만 적고 없으면 생략');
    expect(report).toContain('신고 기록에만 보존되며 기억 생성·평가·삭제는 하지 않는다');
    const reportRules = report + CARD_RULES_DOCUMENT;
    expect(reportRules).not.toContain('Project Brain 기억 카드로 저장된다');
    expect(reportRules).not.toContain('시스템이 다시 유효로 되돌린다');
    expect(reportRules).not.toContain('표시만 바뀌고 반복되면 보관된다');
  });

  it.each([
    ['HTTP', buildAgentCardCommonRules(ARGS)],
    ['CMD', buildCmdCardProtocolRules()],
    ['참고 문서', CARD_RULES_DOCUMENT],
  ])('%s는 보고 기록 저장과 기억 생성·평가를 구별한다', (_name, rules) => {
    const plain = rules.replace(/\*\*/g, '').replace(/\s+/g, ' ');
    expect(plain).toMatch(/화면 표시[^.]*세션 복원을 위해 저장/);
    expect(plain).toMatch(/기억 관련 필드[^.]*신고 기록에만 보존/);
    expect(plain).toMatch(/별도 기억 생성·\s*평가에는 (?:반영되지|사용하지) 않는다/);
  });

  it('참고 문서가 꺼진 목표 기능이나 없는 도구 사용을 다시 요구하지 않는다', () => {
    const goalSection = CARD_RULES_DOCUMENT.split('## 목표 목록 안내는 언제 적용되는가')[1]?.split('\n## ')[0];
    expect(goalSection).toBeDefined();
    const plain = goalSection!.replace(/\*\*|`/g, '').replace(/\s+/g, ' ');
    expect(plain).toContain('Vibisual 목표 추적이 켜져 있고 현재 세션에 목표 창 규약이 제공된 경우에만');
    expect(plain).toMatch(/꺼진 세션에서는 목표 블록이나 목표 API로 갱신하지 말고 일반 답변으로 계획과 진행을 설명/);
    expect(plain).toContain('제공된 vibisual 코드블록 규약');
    expect(plain).toContain('작업 장부 도구는 실제 세션에 제공된 경우에만 사용');
    expect(plain).toMatch(/네이티브 목표·계획 도구와 Vibisual 목표가 자동으로 연결된다고 가정하거나[^.]*없는 도구를 호출하거나 목표 기능을 켜지 마라/);
    expect(CARD_RULES_DOCUMENT).not.toContain('왜 목표 목록을 비워 두면 안 되는가');
    expect(goalSection).not.toMatch(/`steps`|`status`|`done`/);
  });
});

describe('§5.5 #17-17 ㉑ — 목표 규약은 한 절, 상태는 목록뿐', () => {
  const FOUR = [
    { text: '서버', status: 'done' as const, kind: 'locate' },
    { text: '클라', status: 'in_progress' as const, kind: 'change' },
    { text: '빌드', status: 'in_progress' as const, kind: 'change', parallel: true },
    { text: '검증', status: 'pending' as const, authoredBy: 'user' as const },
  ];

  it('규약은 세 절이 아니라 한 절이고, 걷은 것들이 되돌아오지 않았다', () => {
    const p = buildSessionGoalProtocol(GOAL);
    expect(p.length).toBeLessThan(900);
    expect((p.match(/^# /gm) ?? []).length).toBe(1);
    expect((p.match(/```vibisual/g) ?? []).length).toBe(1);
    // 글리프·장면을 직접 그리라는 절 · 화면 골격 목록 · REST 폴백 — ㉑ 로 걷었다(파서는 여전히 읽는다).
    expect(p).not.toMatch(/glyph|scene|surface|api\/session-goal/);
    expect(p).not.toContain(GOAL.serverBase);
    // 밑그림 이름은 남는다 — 새 종류를 만드는 유일하게 가르치는 길이다.
    expect(p).toMatch(/window·branch·flow[\s\S]*spark/);
  });

  it('상태에는 규칙 문장이 없다 — 값과 표지뿐이고, 규칙은 규약이 말한다', () => {
    const s = buildSessionGoalState({ ...GOAL, steps: FOUR, authoredBy: 'user', revision: 2, note: '절반', percent: 25, kinds: ['locate', 'change'] });
    expect(s).not.toMatch(/지우지 말고|갈라 돌리고|새로 만들어라|먼저 써라|목록부터 세워라/);
    expect(s).toContain('- [~] ∥ 빌드 @change');
    expect(s).toContain('- [ ] 검증 [사용자 추가]');
    expect(s).toContain('종류: locate · change');
    expect(s).toContain('진행률: 25% · 메모: 절반');
    expect(s).toContain('(사용자가 고친 문장 — 그대로 · 목표 문장 2회 수정)');
    expect(s).not.toContain('지금 문장만 유효');
    expect(s.length).toBeLessThan(300);
    expect(buildSessionGoalProtocol(GOAL)).toContain('갈라 돌리고');
  });

  it('빈 목록은 괄호 한 줄이다 — ㉓ 로 그 한 줄이 "언제"까지 말한다', () => {
    const s = buildSessionGoalState(GOAL);
    expect(s).toContain('(목록 없음 — 도구 쓰기 전에 지금 세워라)');
    expect(s.length).toBeLessThan(200);
  });

  it('목록 줄을 그대로 블록에 옮기면 같은 단계로 되읽힌다 — 표지는 본문에 섞이지 않는다', () => {
    const s = buildSessionGoalState({ ...GOAL, steps: FOUR });
    const lines = s.split('\n').filter((l) => l.startsWith('- ['));
    expect(lines).toHaveLength(4);
    expect(parseStageBlockBody(lines.join('\n'))?.steps).toEqual([
      { text: '서버', status: 'done', kind: 'locate' },
      { text: '클라', status: 'in_progress', kind: 'change' },
      { text: '빌드', status: 'in_progress', kind: 'change', parallel: true },
      { text: '검증', status: 'pending' },
    ]);
  });

  it('`**목표**:` 줄은 제목 닻이라 모양을 지키고, 표지는 그 줄에 섞이지 않는다(sessionTitle.ts)', () => {
    const s = buildSessionGoalState({ ...GOAL, goalText: '보험 팝업을 세 눈금으로 나눈다', authoredBy: 'user', revision: 1 });
    expect(s).toMatch(/^\*\*목표\*\*: 보험 팝업을 세 눈금으로 나눈다$/m);
  });
});

describe('§5.5 #17-17 ⑰(b) — 나란히 놓인 행은 매 턴 상태에 ∥ 표식으로 실린다', () => {
  it('둘째 이후 단계의 parallel 만 ∥ 가 붙고, 첫 단계는 붙지 않는다(앞 단계가 없다)', () => {
    const state = buildSessionGoalState({
      ...GOAL,
      steps: [
        { text: '서버', status: 'in_progress', parallel: true },
        { text: '클라', status: 'in_progress', parallel: true },
        { text: '빌드', status: 'pending' },
      ],
    });
    expect(state).toContain('[~] ∥ 클라');
    expect(state).not.toContain('∥ 서버');
    expect(state).not.toContain('∥ 빌드');
  });

  it('행이 없으면 ∥ 도 실리지 않는다 — 매 턴 비용은 쓸 때만 낸다', () => {
    const state = buildSessionGoalState({ ...GOAL, steps: [{ text: 'a', status: 'pending' }, { text: 'b', status: 'pending' }] });
    expect(state).not.toContain('∥');
  });
});

/**
 * §5.5 #17-17 ㉓ — 신고 시점. "언제"가 없으면 모델이 규약을 다 지키고도 끝난 뒤에 목록을 낸다(실측: 14분 턴의 끝나기 37초 전에 6단계·5완료가 한꺼번에)
 * — 시점 문장이 빠지면 이 기능은 켜져 있어도 도착하지 않는다.
 */
describe('§5.5 #17-17 ㉓ — 목록은 끝이 아니라 첫 답에서 선다', () => {
  it('규약과 매 턴 상태가 같은 시점을 가리킨다(둘 중 하나만 말하면 다른 쪽이 면제로 읽힌다)', () => {
    expect(buildSessionGoalProtocol(GOAL)).toContain('도구를 쓰기 전에 이 턴 첫 답에서 세우고');
    expect(buildSessionGoalState(GOAL)).toContain('도구 쓰기 전에');
  });

  it('죽은 도구 이름은 프롬프트 어디에도 없다 — 없는 도구에 면제를 걸면 목록이 영영 안 선다', () => {
    // 설치본 CLI 에서 `TodoWrite` 는 발화하지 않는다(실측: 최근 40 세션 tool_use 0건 · `--tools` 에
    //   이름을 실어 스폰한 세션의 도구 목록에도 없다). ⑨ 가 고친 병이 도구가 사라지는 쪽으로 재발한 자리라,
    //   되돌아오는지를 여기서 지킨다.
    expect(PROMPT).not.toContain('TodoWrite');
  });

  it('면제는 특정 도구 이름이 아니라 "덤"으로만 걸린다 — 블록이 언제나 1차 창구다', () => {
    const p = buildSessionGoalProtocol(GOAL);
    // 장부는 "써도 같은 목록으로 흐른다"(덤)이지, "있으면 블록을 안 써도 된다"(면제)가 아니다.
    expect(p).toMatch(/TaskCreate[\s\S]{0,16}TaskUpdate[\s\S]{0,20}같은 목록으로 흐른다/);
    expect(p).not.toMatch(/있으면 그것으로 충분/);
  });

  it('목표 연속성 규칙을 포함해 규약과 매 턴 상태의 주입 예산을 제한한다', () => {
    expect(buildSessionGoalProtocol(GOAL).length).toBeLessThan(900);
    expect(buildSessionGoalState(GOAL).length).toBeLessThan(200);
  });
});
