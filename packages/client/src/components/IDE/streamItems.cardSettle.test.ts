/** §5.5 #17-18 ⑦-8 — 카드를 보낸 뒤 이어 쓴 결론은 카드 위로, 카드는 그 아래. 도구·명령을 만나면 더 따라가지 않는다. */
import { describe, it, expect } from 'vitest';
import type { AgentReview } from '@vibisual/shared';
import {
  mergeCardsIntoItems,
  settleCardsBelowTrailingText,
  type StreamItemFull,
  type BaseItemsResult,
  type CardSettleRole,
} from './streamItems.js';

const text = (id: string, content: string, timestamp: number): StreamItemFull =>
  ({ kind: 'text', id, content, timestamp });
const tool = (id: string, timestamp: number): StreamItemFull =>
  ({ kind: 'tool', id, toolName: 'Bash', input: 'curl -s -X POST "$VIBI_BASE/api/agent-review"', output: '{"ok":true}', timestamp, isActive: false });
const step = (id: string, timestamp: number): StreamItemFull =>
  ({ kind: 'step', id, phase: 'thinking', timestamp, endedAt: timestamp + 1, chars: 10 } as unknown as StreamItemFull);
const review = (id: string, createdAt: number): AgentReview =>
  ({ id, agentId: 'A', changes: ['고쳤다'], checkpoints: ['눌러 보라'], createdAt });
const base = (items: StreamItemFull[]): BaseItemsResult => ({ items, agentBusy: false, thinkingLive: null });
const ids = (out: StreamItemFull[]): string[] => out.map((i) => i.id);

describe('mergeCardsIntoItems — 카드 뒤에 쓴 결론은 카드 위로', () => {
  it('도구 줄 → 카드 → 결론이면 결론이 카드 위로 올라온다', () => {
    const out = mergeCardsIntoItems(
      base([tool('x1', 90), text('t1', '이제 이 오류가 뜨지 않도록 고쳤습니다.\n\n카드를 확인해 주세요.', 110)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['x1', 't1', 'review-rv1']);
  });

  it('자국을 사이에 둔 여러 문단도 함께 넘는다', () => {
    const out = mergeCardsIntoItems(
      base([tool('x1', 90), step('s1', 105), text('t1', '첫 문단', 110), text('t2', '둘째 문단', 120)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['x1', 's1', 't1', 't2', 'review-rv1']);
  });

  it('도구 줄을 만나면 멈춘다 — 그 뒤 출력은 카드 아래(바닥 붙박이 없음)', () => {
    const out = mergeCardsIntoItems(
      base([tool('x1', 90), text('t1', '중간 설명', 110), tool('x2', 120), text('t2', '이어서 한 일', 130)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['x1', 't1', 'review-rv1', 'x2', 't2']);
  });

  it('발송 보고 한 줄은 여전히 걷힌다', () => {
    const out = mergeCardsIntoItems(
      base([tool('x1', 90), text('t1', '검수 카드로 보냈습니다.', 110)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['x1', 'review-rv1']);
  });

  it('뒤에 본문이 없으면 그대로', () => {
    const out = mergeCardsIntoItems(
      base([text('t0', '결론', 80), tool('x1', 90)]),
      undefined, undefined, undefined, [review('rv1', 100)], undefined, undefined,
    );
    expect(ids(out)).toEqual(['t0', 'x1', 'review-rv1']);
  });
});

describe('settleCardsBelowTrailingText — 판정 함수', () => {
  type N = { r: CardSettleRole; id: string; owner?: string };
  const role = (n: N): CardSettleRole => n.r;
  it('옮길 게 없으면 같은 배열을 돌려준다', () => {
    const items: N[] = [{ r: 'text', id: 'a' }, { r: 'card', id: 'c' }, { r: 'stop', id: 'b' }];
    expect(settleCardsBelowTrailingText(items, role)).toBe(items);
  });
  it('이어진 카드 둘은 함께 결론 아래로', () => {
    const items: N[] = [{ r: 'card', id: 'c1' }, { r: 'card', id: 'c2' }, { r: 'text', id: 't' }, { r: 'skip', id: 's' }];
    expect(settleCardsBelowTrailingText(items, role).map((n) => n.id)).toEqual(['t', 'c1', 'c2', 's']);
  });
  it('다른 주인의 본문은 넘지 않는다', () => {
    const items: N[] = [{ r: 'card', id: 'c', owner: 'A' }, { r: 'text', id: 't', owner: 'B' }];
    expect(settleCardsBelowTrailingText(items, role, (c, t) => c.owner === t.owner)).toBe(items);
  });
});
