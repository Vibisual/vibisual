/**
 * streamItems.cardEcho.test.ts — §5.5 #17-18 ⑦-5
 *
 * 카드를 발행한 **직후**에 붙는 "~카드로 보냈습니다" 한 줄만 화면에서 빠지고, 같은 자리에 온
 * **실제 결론 문장은 살아남는지**를 못박는다. 이 판정이 넓어지면 사용자가 읽어야 할 마지막 본문이
 * 조용히 사라지므로(그쪽이 훨씬 나쁘다), 경계 사례를 양쪽에서 모두 고정한다.
 *
 * ⑦-6 — 지시문이 카드 뒤를 비우지 말고 "카드를 확인해 주세요." 한 문장으로 닫게 바뀐 뒤로, 그 문장
 * (목표 창 블록이 섞여 와도)까지 빠져 화면이 "본문 → 카드"로 끝나는지를 함께 고정한다.
 */
import { describe, it, expect } from 'vitest';
import type { AgentReview } from '@vibisual/shared';
import {
  isCardEchoText,
  isInvisibleStreamText,
  dropCardEchoTexts,
  mergeCardsIntoItems,
  type StreamItemFull,
  type BaseItemsResult,
} from './streamItems.js';

const text = (id: string, content: string, timestamp = 100): StreamItemFull =>
  ({ kind: 'text', id, content, timestamp });
const tool = (id: string, timestamp = 90): StreamItemFull =>
  ({ kind: 'tool', id, toolName: 'Bash', input: 'curl -s -X POST "$VIBI_BASE/api/agent-review"', output: '{"ok":true}', timestamp, isActive: false });
const system = (id: string, timestamp = 95): StreamItemFull =>
  ({ kind: 'system', id, content: 'note', timestamp });
const review = (id: string, createdAt: number): AgentReview =>
  ({ id, agentId: 'A', changes: ['고쳤다'], checkpoints: ['눌러 보라'], createdAt });
const reviewItem = (id: string, timestamp = 99): StreamItemFull =>
  ({ kind: 'review', id: `review-${id}`, review: review(id, timestamp), timestamp });

describe('isCardEchoText — 발송 사실 보고 한 줄', () => {
  it('카드를 보냈다는 한 줄은 발송 보고로 본다', () => {
    for (const s of [
      '검수 카드로 확인 지점을 정리해 보냈습니다.',
      '검수 카드로 확인 지점을 정리해 보냈습니다',
      '작업 신고 카드로 사용자가 할 일을 보냈습니다.',
      '질문 카드로 선택지를 띄웠습니다.',
      '번호 목록 카드로 정리해 올렸습니다.',
      '검수 카드로 신고했습니다',
      '결과는 검수 카드로 보내 드렸습니다.',
      'Sent the review card with the checkpoints.',
      'Posted a report card with what you need to do.',
    ]) {
      expect(isCardEchoText(s), s).toBe(true);
    }
  });

  it('정보가 담긴 본문은 건드리지 않는다', () => {
    for (const s of [
      // 문장이 둘 이상 = 뒤에 정보가 붙었다.
      '검수 카드로 보냈습니다. 실패하면 호스트 로그의 거절 사유를 알려 주세요.',
      // 카드를 가리키는 낱말이 없다.
      '빌드를 다시 돌려 보냈습니다',
      // 발행·전송 동사가 없다.
      '검수 카드에 확인 지점을 담았습니다',
      '이 카드 렌더 코드가 원인이었습니다',
      // 본문 구조물(목록·헤딩·인용·코드)로 시작한다.
      '- 검수 카드로 보냈습니다',
      '> 검수 카드로 보냈습니다',
      '`카드`를 보냈습니다',
      // 여러 줄이면 한 줄짜리 꼬리가 아니다.
      '검수 카드로 보냈습니다\n확인 부탁드립니다',
      // 빈 줄.
      '   ',
    ]) {
      expect(isCardEchoText(s), s).toBe(false);
    }
  });

  it('길면(200자 초과) 발송 보고로 보지 않는다', () => {
    expect(isCardEchoText(`검수 카드로 ${'확인 지점을 '.repeat(30)}보냈습니다`)).toBe(false);
  });
});

describe('dropCardEchoTexts — 자리 조건(바로 앞이 카드)', () => {
  it('카드 바로 뒤의 한 줄은 뺀다', () => {
    const out = dropCardEchoTexts([reviewItem('r1'), text('t1', '검수 카드로 확인 지점을 정리해 보냈습니다.')]);
    expect(out.map((i) => i.kind)).toEqual(['review']);
  });

  it('도구 줄·시스템 줄이 사이에 껴 있어도 카드 바로 뒤로 본다', () => {
    const out = dropCardEchoTexts([
      reviewItem('r1'),
      tool('x1', 101),
      system('s1', 102),
      text('t1', '검수 카드로 확인 지점을 정리해 보냈습니다.', 103),
    ]);
    expect(out.map((i) => i.kind)).toEqual(['review', 'tool', 'system']);
  });

  it('앞에 카드가 없으면 같은 문장이라도 남긴다', () => {
    const items = [text('t0', '앞선 본문'), text('t1', '검수 카드로 확인 지점을 정리해 보냈습니다.')];
    expect(dropCardEchoTexts(items)).toHaveLength(2);
  });

  it('카드와 사이에 다른 본문이 있으면(직전 "말"이 본문) 남긴다', () => {
    const items = [reviewItem('r1'), text('t0', '원인은 포트가 바뀐 것이었습니다'), text('t1', '검수 카드로 보냈습니다')];
    expect(dropCardEchoTexts(items)).toHaveLength(3);
  });

  it('뺄 것이 없으면 입력 배열을 그대로 돌려준다(항목 참조 안정)', () => {
    const items = [reviewItem('r1'), text('t1', '원인은 포트가 바뀐 것이었습니다')];
    expect(dropCardEchoTexts(items)).toBe(items);
  });
});

describe('mergeCardsIntoItems — 카드 합류 뒤에 걷힌다', () => {
  const base = (items: StreamItemFull[]): BaseItemsResult => ({ items, agentBusy: false, thinkingLive: null });

  it('curl 도구 줄 → 카드 → 발송 보고 순서에서 마지막 한 줄이 빠진다', () => {
    const out = mergeCardsIntoItems(
      base([tool('x1', 90), text('t1', '검수 카드로 확인 지점을 정리해 보냈습니다.', 110)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(out.map((i) => i.kind)).toEqual(['tool', 'review']);
  });

  it('카드 앞의 설명 본문은 그대로 남는다(맥락 → 카드 순서 유지)', () => {
    const out = mergeCardsIntoItems(
      base([text('t0', '원인은 포트가 바뀐 것이었습니다', 80), tool('x1', 90), text('t1', '검수 카드로 보냈습니다', 110)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(out.map((i) => i.kind)).toEqual(['text', 'tool', 'review']);
    expect((out[0] as { content: string }).content).toBe('원인은 포트가 바뀐 것이었습니다');
  });
});

/**
 * §5.5 #17-18 ⑦-6 — 카드 뒤를 비워 두면 CLI 의 "no visible output" 재촉이 보고를 카드 아래에 통째로
 * 다시 쓰게 했다(카드가 한참 위로 밀리고 같은 내용을 또 읽는다). 지시문은 정해진 한 문장으로 닫게 하고,
 * 화면은 그 한 문장까지 걷는다 — 같은 자리의 실제 정보는 여전히 남아야 한다.
 */
describe('⑦-6 — 카드 뒤를 닫는 한 문장', () => {
  const GOAL_BLOCK = '```vibisual\n- [x] 원인 고치기 @change\n- [x] 테스트 @test\n```';
  const base = (items: StreamItemFull[]): BaseItemsResult => ({ items, agentBusy: false, thinkingLive: null });

  it('정해 준 문장과 그 흔한 변형은 걷을 대상이다', () => {
    for (const s of [
      '카드를 확인해 주세요.',
      '카드를 확인해주세요',
      '위 카드를 확인해 주세요.',
      '위의 검수 카드를 확인해 주세요.',
      '질문 카드를 확인해 주세요!',
      '카드 확인 부탁드립니다.',
      'Please check the card.',
      'Please review the card above.',
    ]) {
      expect(isCardEchoText(s), s).toBe(true);
    }
  });

  it('카드 종류가 아닌 낱말이 붙거나 정보가 더 붙으면 남긴다', () => {
    for (const s of [
      '결제 카드를 확인해 주세요.',
      '카드를 확인해 주세요. 테스트 1건은 아직 실패합니다.',
      '카드를 확인해 주세요 — 설정 파일도 함께 바뀌었습니다',
      '빌드 로그를 확인해 주세요.',
      '카드를 확인해 주세요\n그리고 앱을 다시 켜 주세요',
    ]) {
      expect(isCardEchoText(s), s).toBe(false);
    }
  });

  it('목표 창 블록이 같은 답에 섞여 와도 보이는 글로 판정한다', () => {
    expect(isCardEchoText(`${GOAL_BLOCK}\n\n카드를 확인해 주세요.`)).toBe(true);
    expect(isCardEchoText(`${GOAL_BLOCK.replace(/\n/g, '\r\n')}\r\n\r\n카드를 확인해 주세요.`)).toBe(true);
    // 블록 밖에 두 문단이 보이면 한 줄짜리 꼬리가 아니다.
    expect(isCardEchoText(`원인은 캐시였습니다.\n\n${GOAL_BLOCK}\n\n카드를 확인해 주세요.`)).toBe(false);
    // 블록뿐인 본문은 대상이 아니다(원래 화면에 안 그려진다).
    expect(isCardEchoText(GOAL_BLOCK)).toBe(false);
    // 무대 블록이 아닌 코드블록은 걷지 않는다.
    expect(isCardEchoText('```bash\npnpm test\n```\n\n카드를 확인해 주세요.')).toBe(false);
  });

  it('isInvisibleStreamText — 비었거나 무대 블록뿐인 본문만 참', () => {
    expect(isInvisibleStreamText('')).toBe(true);
    expect(isInvisibleStreamText('  \n ')).toBe(true);
    expect(isInvisibleStreamText(GOAL_BLOCK)).toBe(true);
    // 스트리밍 중 아직 안 닫힌 블록도 렌더가 숨긴다.
    expect(isInvisibleStreamText('```vibisual\n- [~] 도는 중')).toBe(true);
    expect(isInvisibleStreamText(`${GOAL_BLOCK}\n\n카드를 확인해 주세요.`)).toBe(false);
    expect(isInvisibleStreamText('```bash\npnpm test\n```')).toBe(false);
  });

  it('카드 → 닫는 문장: 화면은 카드로 끝난다(블록이 섞인 답도, 블록만 따로 온 답이 사이에 껴도)', () => {
    expect(dropCardEchoTexts([reviewItem('r1'), text('t1', '카드를 확인해 주세요.')]).map((i) => i.kind)).toEqual(['review']);
    const mixed = dropCardEchoTexts([reviewItem('r1'), tool('x1', 101), text('t1', `${GOAL_BLOCK}\n\n카드를 확인해 주세요.`, 102)]);
    expect(mixed.map((i) => i.kind)).toEqual(['review', 'tool']);
    const split = dropCardEchoTexts([reviewItem('r1'), text('g1', GOAL_BLOCK, 101), text('t1', '카드를 확인해 주세요.', 102)]);
    expect(split.map((i) => i.id)).toEqual(['review-r1', 'g1']);
  });

  it('카드 뒤의 실제 정보·카드 없는 자리의 같은 문장은 남는다', () => {
    const info = [text('t0', '원인은 캐시였습니다', 80), reviewItem('r1'), text('t1', '카드를 확인해 주세요. 재시작이 필요합니다.', 102)];
    expect(dropCardEchoTexts(info)).toBe(info);
    const noCard = [text('t0', '앞선 본문'), text('t1', '카드를 확인해 주세요.')];
    expect(dropCardEchoTexts(noCard)).toBe(noCard);
  });

  it('mergeCardsIntoItems — 결론 → curl 도구 줄 → 카드 → (블록 + 닫는 문장)에서 마지막 답만 빠진다', () => {
    const out = mergeCardsIntoItems(
      base([text('t0', '원인은 캐시였습니다', 80), tool('x1', 90), text('t1', `${GOAL_BLOCK}\n\n카드를 확인해 주세요.`, 110)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(out.map((i) => i.kind)).toEqual(['text', 'tool', 'review']);
    expect((out[0] as { content: string }).content).toBe('원인은 캐시였습니다');
  });
});
