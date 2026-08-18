/**
 * streamItems.cardEcho.test.ts — §5.5 #17-18 ⑦-5
 *
 * 카드를 발행한 **직후**에 붙는 "~카드로 보냈습니다" 한 줄만 화면에서 빠지고, 같은 자리에 온
 * **실제 결론 문장은 살아남는지**를 못박는다. 이 판정이 넓어지면 사용자가 읽어야 할 마지막 본문이
 * 조용히 사라지므로(그쪽이 훨씬 나쁘다), 경계 사례를 양쪽에서 모두 고정한다.
 */
import { describe, it, expect } from 'vitest';
import type { AgentReview } from '@vibisual/shared';
import {
  isCardEchoText,
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
