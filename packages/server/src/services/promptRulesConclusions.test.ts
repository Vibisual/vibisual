/**
 * §5.5 #17-28 ⑧(f) — **결론이 하나라도 빠지면 실패**.
 *
 * ⑧(f) 는 규약에서 *이유*를 걷어 문서(`CARD_RULES_DOCUMENT`)로 내리고 프롬프트에는 결론만 남겼다.
 * 그 압축은 한 번으로 끝나지 않는다 — 다음에 누군가 "여기도 줄일 수 있겠는데" 하고 한 줄을 더 지우면
 * 그때부터 카드가 조용히 이상해진다(도배되거나, 본문 위로 뒤집히거나, 빈 신고가 늘거나).
 * 그런 회귀는 화면을 오래 봐야 겨우 눈치채므로, **줄여도 되는 것과 안 되는 것의 경계**를 여기 못박는다.
 *
 * §5.5 #17-17 ㉑ — 목표 규약도 같은 규율로 한 번 더 줄였다(세 절 1,956자 → 한 절 687자 · 매 턴 상태는
 * 규칙 문장 없이 목록만). 아래 "목표·종류·나란히" 결론이 그 뒤에도 남아야 하는 것의 전부다.
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
  ['작업신고 — staleMemoryIds 는 삭제되지 않는다', /삭제되지 않으니/],
  ['질문 — 멈춰 서야 할 때만, 없으면 보내지 않는다', /멈춰 서야만 하는 질문일 때만[\s\S]*질문이 없으면 보내지 마라/],
  ['질문 — 지시 안에 이미 있는 답을 되묻지 않는다', /지시 안에 이미 답이 있는 것을 되묻지 마라/],
  ['질문 — 뻔한 질문 예시(고칠까요·원인이면 다 고친다)', /묻지 말고 그냥 하라[\s\S]*원인이면 다 고친다/],
  ['질문 — 물어도 되는 것은 되돌리기 어려운 일', /되돌리기 어렵거나 바깥에 나가는 일/],
  ['질문 — 물어도 멈추지 않는다(골라 끝낸 뒤 묻는다)', /묻더라도 멈추지 마라[\s\S]*골라 끝낸 뒤/],
  ['질문 — 손을 놓는 것은 막혔을 때뿐', /손을 놓는 것은 \*\*막혔을 때뿐\*\*/],
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
  ['의도 — 도구 전에 첫 말로 의도·할 일', /도구를 쓰기 전에, 그 턴의 첫 말로[\s\S]*말하라/],
  // ↓ §5.5 #17-12 ①-1 — "1~2문장" 고정 상한이 긴 지시의 70% 를 조용히 버리던 자리. 아래 셋이 재발 방지다.
  //   상한을 다시 고정으로 되돌리면(=아래 셋 중 하나라도 지우면) 같은 사고가 그대로 돌아온다.
  ['의도 — 길이는 요구 개수를 따라간다', /길이는 사용자가 말한 요구의 개수를 따라간다/],
  ['의도 — 여러 개면 요구마다 한 줄, 하나도 빼지 않는다', /여러 개면 요구마다 한 줄씩 빠짐없이 되짚어라[\s\S]*하나도 빼지 마라/],
  ['의도 — 모르겠는 항목·안 할 항목도 적는다', /모르겠는 항목·이번에 안 할 항목도 그 목록에 적어라/],
  // §5.5 #17-17 ㉓ — 죽은 도구(`TodoWrite`) 대신 **첫 말과 같은 시점**을 가리킨다. 이 줄이 도구 이름으로
  //   되돌아가면 "여러 단계면 계획을 세워라"가 다시 없는 도구를 가리켜 늘 괄호 폴백으로 떨어진다.
  ['의도 — 여러 단계면 첫 말과 함께 목표 창 블록으로', /여러 단계면 그 첫 말과[\s\S]{0,10}함께[\s\S]{0,20}목표 창 블록으로 계획을 세워라/],
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
  ['목표 — 사용자가 고친 문장·사용자 추가 단계는 지우지 않는다', /사용자가 고친 문장[\s\S]{0,40}사용자 추가[\s\S]{0,30}지우지 말고/],
  // ↓ §5.5 #17-17 ⑪(i)(m) — 무대가 읽는 축. 있는 키를 먼저 쓰지 않으면 카드가 흩어져 서로를 휴지통으로 민다.
  //   새 종류는 밑그림(`from`)으로 만든다 — 글리프·장면을 직접 그리라는 절은 ㉑ 로 걷었다(파서는 여전히 읽는다).
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

  it('문서 경로가 없으면 "읽어라" 줄 자체가 빠진다(없는 파일을 가리키지 않는다)', () => {
    const withoutDoc = buildAgentCardCommonRules({ ...ARGS, docPath: undefined });
    expect(withoutDoc).not.toContain('Read 하라');
  });

  it('압축분 — 규약 총량이 다시 부풀지 않는다(⑧(f) 시점 1,900 토큰대 · ⑰(b) 시점 4,771자 · ㉑ 시점 3,535자)', () => {
    // 상한만 못박는다(줄이는 것은 언제든 환영, 늘리는 것만 눈에 띄면 된다).
    // §5.5 #17-17 ㉑ — 목표 규약 세 절(1,956자)을 한 절(687자)로 줄여 3,500 대로 내려왔다. 다음 증가는 여기서 걸린다.
    expect(PROMPT.length).toBeLessThan(3_800);
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
    expect(p.length).toBeLessThan(800);
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
    expect(s).toContain('(사용자가 고친 문장 — 그대로 · 2번 바뀜 — 지금 문장만 유효)');
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
 * §5.5 #17-17 ㉓ — **신고 시점**. ㉑ 까지의 규약은 "무엇을 어떻게 적는가"만 말했고 "언제"를 말하지 않아,
 * 모델이 규약을 하나도 어기지 않고도 늘 일이 끝난 뒤에 목록을 냈다(실측 `sub-mtuugn2x` 직전 세션:
 * 14분 · 스트림 154줄 중 150번째 · 끝나기 37초 전에 6단계·5완료가 한꺼번에). 그 시점의 계획은 사용자가
 * 멈출지 판단할 재료가 아니므로, 시점 문장이 빠지면 이 기능은 켜져 있어도 도착하지 않는다.
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

  it('㉑ 의 주입 예산은 그대로다 — 늘어난 것은 "언제" 한 문장뿐', () => {
    expect(buildSessionGoalProtocol(GOAL).length).toBeLessThan(800);
    expect(buildSessionGoalState(GOAL).length).toBeLessThan(200);
  });
});
