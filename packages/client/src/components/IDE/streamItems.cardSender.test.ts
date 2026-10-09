/**
 * streamItems.cardSender.test.ts — §5.5 #17-18 ⑦-7
 *
 * 카드는 그 카드를 보낸 도구 호출이 도는 동안 만들어진다. 그런데 코덱스는 명령 시작 줄을 그 명령이 이미
 * 카드를 보낸 **뒤**에 내보내는 일이 잦아(실측 47장 중 32장 · 최대 294ms), 카드를 보낸 PowerShell 줄 하나가
 * 카드 **밑에** 깔렸다(사용자 보고 — "꼭 저렇게 하나가 아래에 깔린다"). 화면은 결론 → 도구 줄 → 카드로
 * 끝나야 하고, 클로드처럼 이미 그렇게 서 있는 순서는 한 글자도 바뀌면 안 된다 — 양쪽을 함께 고정한다.
 */
import { describe, it, expect } from 'vitest';
import type { AgentReport, AgentReview, QueuedCommand } from '@vibisual/shared';
import {
  CARD_SENDER_LATE_START_MS,
  cardPlacementTs,
  isCardSenderCandidate,
  mergeCardsIntoItems,
  type BaseItemsResult,
  type CardSenderCall,
  type StreamItemFull,
} from './streamItems.js';

const REVIEW_CURL = 'curl -s -X POST "$VIBISUAL_BASE/api/agent-review" --data-binary @-';
// 사용자 화면의 그 줄 — 코덱스가 Windows 에서 감싸 부르는 PowerShell 판본.
const REVIEW_PWSH = '"C:\\\\WINDOWS\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'$ErrorActionPreference = "Stop"; Invoke-RestMethod -Method Post -Uri "$B/api/agent-review" -Headers $H\'';

const text = (id: string, content: string, timestamp: number): StreamItemFull =>
  ({ kind: 'text', id, content, timestamp });
const tool = (id: string, timestamp: number, input: string, output = '', toolName = 'Bash'): StreamItemFull =>
  ({ kind: 'tool', id, toolName, input, output, timestamp, isActive: output === '' });
const review = (id: string, createdAt: number): AgentReview =>
  ({ id, agentId: 'A', subAgentId: 'S', changes: ['고쳤다'], checkpoints: ['눌러 보라'], createdAt });
const report = (id: string, createdAt: number): AgentReport =>
  ({ id, agentId: 'A', subAgentId: 'S', did: ['했다'], userActions: ['재시작'], createdAt } as AgentReport);
const base = (items: StreamItemFull[], sortTimestamps?: ReadonlyMap<string, number>): BaseItemsResult =>
  ({ items, agentBusy: false, thinkingLive: null, ...(sortTimestamps ? { sortTimestamps } : {}) });
const ids = (items: readonly StreamItemFull[]): string[] => items.map((i) => i.id);
const okBody = (cardId: string): string => `exit 0\n{\r\n    "ok":  true,\r\n    "id":  "${cardId}"\r\n}\r\n`;

describe('mergeCardsIntoItems — 카드는 자기를 보낸 도구 줄 아래에 선다', () => {
  it('코덱스: 명령 시작 줄이 카드보다 늦게 와도 결론 → 명령 줄 → 카드 순서다(사용자 화면 그대로)', () => {
    // 실측 값 그대로 — 결론 961940 · 카드 990089 · 명령 시작 990213 · 닫는 문장 992113.
    const out = mergeCardsIntoItems(
      base([
        text('t0', '요청하신 한 폴더·한 실행 파일 구조로 정리했습니다.', 961_940),
        tool('x1', 990_213, REVIEW_PWSH, okBody('rv1')),
        text('t1', '카드를 확인해 주세요.', 992_113),
      ]),
      undefined, undefined, undefined, [review('rv1', 990_089)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['t0', 'x1', 'review-rv1']);
  });

  it('코덱스: 결과가 아직 안 온(도는 중) 명령 줄도 카드 위에 선다 — 결과가 와도 자리가 흔들리지 않는다', () => {
    const inFlight = mergeCardsIntoItems(
      base([text('t0', '결론', 80), tool('x1', 105, REVIEW_CURL)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(inFlight)).toEqual(['t0', 'x1', 'review-rv1']);
    const done = mergeCardsIntoItems(
      base([text('t0', '결론', 80), tool('x1', 105, REVIEW_CURL, okBody('rv1'))]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(done)).toEqual(ids(inFlight));
  });

  it('클로드: 도구 시작 줄이 이미 카드 앞이면 순서는 그대로다', () => {
    const out = mergeCardsIntoItems(
      base([text('t0', '결론', 80), tool('x1', 90, REVIEW_CURL, okBody('rv1')), text('t1', '다음 턴 본문', 200)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['t0', 'x1', 'review-rv1', 't1']);
  });

  it('옮겨도 카드의 시각은 그대로다(표시 순서만 바뀐다)', () => {
    const out = mergeCardsIntoItems(
      base([tool('x1', 105, REVIEW_CURL)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    const card = out.find((i) => i.kind === 'review');
    expect(card?.timestamp).toBe(100);
  });

  it('카드 뒤 닫는 문장은 여전히 걷힌다(도구 줄 → 카드 → 닫는 문장)', () => {
    const out = mergeCardsIntoItems(
      base([text('t0', '결론', 80), tool('x1', 105, REVIEW_CURL, okBody('rv1')), text('t1', '카드를 확인해 주세요.', 120)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['t0', 'x1', 'review-rv1']);
  });

  it('카드는 다음 명령 말풍선을 넘지 않는다', () => {
    const cmd: QueuedCommand = { id: 'c2', text: '다음', timestamp: 500, startedAt: 500, status: 'executing', subAgentId: 'S' };
    const out = mergeCardsIntoItems(
      base([tool('x1', 105, REVIEW_CURL), { kind: 'command', id: 'cmd-c2', prompt: '다음', result: '', status: 'executing', timestamp: 500 }]),
      [cmd], undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['x1', 'review-rv1', 'cmd-c2']);
  });

  it('턴 경계로 보정된 도구 자리(sortTimestamps)를 따른다', () => {
    const out = mergeCardsIntoItems(
      base([text('t0', '결론', 140), tool('x1', 105, REVIEW_CURL)], new Map([['x1', 150]])),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['t0', 'x1', 'review-rv1']);
  });

  it('신고 카드도 같은 규칙이다(작업 신고 창구)', () => {
    const out = mergeCardsIntoItems(
      base([text('t0', '결론', 80), tool('x1', 104, 'curl -s -X POST "$B/api/agent-report" --data-binary @-')]),
      undefined, [report('rp1', 100)], undefined, undefined, undefined, undefined,
    );
    expect(ids(out)).toEqual(['t0', 'x1', 'report-rp1']);
  });
});

describe('mergeCardsIntoItems — 발신자가 아닌 도구 줄은 카드를 끌고 가지 않는다', () => {
  it('다른 창구를 부른 줄은 발신자가 아니다', () => {
    const out = mergeCardsIntoItems(
      base([tool('x1', 105, 'curl -s -X POST "$B/api/agent-report"')]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['review-rv1', 'x1']);
  });

  it('창구 경로 뒤에 낱말이 더 붙으면 다른 경로다', () => {
    const out = mergeCardsIntoItems(
      base([tool('x1', 105, 'curl -s "$B/api/agent-reviews"')]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['review-rv1', 'x1']);
  });

  it('파일 도구는 본문에 창구 경로가 적혀 있어도 발신자가 아니다', () => {
    const out = mergeCardsIntoItems(
      base([tool('x1', 105, '{"file_path":"a.ts","content":"fetch(\'/api/agent-review\')"}', 'ok', 'Write')]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['review-rv1', 'x1']);
  });

  it('상한(3초)보다 늦게 시작한 줄은 이 카드를 보낸 줄이 아니다', () => {
    const late = mergeCardsIntoItems(
      base([tool('x1', 100 + CARD_SENDER_LATE_START_MS + 1, REVIEW_CURL)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(late)).toEqual(['review-rv1', 'x1']);
    const edge = mergeCardsIntoItems(
      base([tool('x1', 100 + CARD_SENDER_LATE_START_MS, REVIEW_CURL)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(edge)).toEqual(['x1', 'review-rv1']);
  });

  it('앞에서 보낸 줄이 더 가까우면 그쪽이 발신자다 — 뒤의 같은 창구 줄로 끌려가지 않는다', () => {
    const out = mergeCardsIntoItems(
      base([tool('x0', 99, REVIEW_CURL), tool('x1', 1_500, REVIEW_CURL)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['x0', 'review-rv1', 'x1']);
  });
});

describe('cardPlacementTs — 판정 함수', () => {
  const call = (at: number, input = REVIEW_CURL, output = '', sortTs = at): CardSenderCall => ({ at, sortTs, input, output });
  const card = { id: 'rv1', createdAt: 100 };

  it('후보가 없으면 신고 시각 그대로다', () => {
    expect(cardPlacementTs('review', card, undefined)).toBe(100);
    expect(cardPlacementTs('review', card, [])).toBe(100);
    expect(cardPlacementTs('review', card, [call(105, 'curl "$B/api/agent-list"')])).toBe(100);
  });

  it('뒤에 시작한 발신 줄이면 그 줄 바로 아래(+0.5)다', () => {
    expect(cardPlacementTs('review', card, [call(105)])).toBe(105.5);
    // 묶음 안이면 묶음의 자리 기준.
    expect(cardPlacementTs('review', card, [call(105, REVIEW_CURL, '', 103)])).toBe(103.5);
  });

  it('결과에 카드 id 가 찍힌 쪽이 거리보다 먼저다', () => {
    // 거리로는 앞(99)이 가깝지만, 뒤 줄의 결과에 이 카드 id 가 있다.
    expect(cardPlacementTs('review', card, [call(99), call(900, REVIEW_CURL, okBody('rv1'))])).toBe(900.5);
    // 거리로는 뒤(101)가 가깝지만, 앞 줄의 결과에 이 카드 id 가 있다.
    expect(cardPlacementTs('review', card, [call(20, REVIEW_CURL, okBody('rv1')), call(101)])).toBe(100);
  });

  it('같은 밀리초에 시작한 발신 줄보다도 카드가 아래다', () => {
    expect(cardPlacementTs('review', card, [call(100)])).toBe(100.5);
  });

  it('질문·목록 창구도 각자 경로로 가린다', () => {
    expect(cardPlacementTs('question', card, [call(102, 'curl "$B/api/agent-questions"')])).toBe(102.5);
    expect(cardPlacementTs('question', card, [call(102, REVIEW_CURL)])).toBe(100);
    expect(cardPlacementTs('list', card, [call(102, 'curl "$B/api/agent-list"')])).toBe(102.5);
  });

  it('isCardSenderCandidate — 창구 경로가 있고 파일 도구가 아닌 호출만', () => {
    expect(isCardSenderCandidate('Bash', REVIEW_CURL)).toBe(true);
    expect(isCardSenderCandidate('PowerShell', REVIEW_PWSH)).toBe(true);
    expect(isCardSenderCandidate(undefined, REVIEW_CURL)).toBe(true);
    expect(isCardSenderCandidate('Bash', 'pnpm test')).toBe(false);
    expect(isCardSenderCandidate('Edit', REVIEW_CURL)).toBe(false);
    expect(isCardSenderCandidate('Read', REVIEW_CURL)).toBe(false);
  });
});
