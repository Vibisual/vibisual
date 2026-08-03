import { describe, it, expect } from 'vitest';
import { pairTerminalCards } from './IDETerminalCardRail.js';
import type { TerminalCard } from './terminalCardSniffer.js';

/**
 * §5.5 #17-12 — 인터랙티브 터미널(CMD) 카드 레일도 "한 턴에 카드는 한 장" 규칙을 따라야 한다.
 * 신고 바로 뒤에 온 검수는 별도 카드로 쌓지 않고 그 신고 카드로 합친다.
 */
const report = (id: string): TerminalCard => ({
  kind: 'report', id, did: ['한 일'], userActions: ['할 일'], nextSteps: [], createdAt: 1,
} as TerminalCard);
const review = (id: string): TerminalCard => ({
  kind: 'review', id, changes: ['고친 것'], checkpoints: ['확인'], createdAt: 2,
} as TerminalCard);
const list = (id: string): TerminalCard => ({
  kind: 'list', id, items: ['a', 'b'], createdAt: 3,
} as TerminalCard);

describe('pairTerminalCards', () => {
  it('신고 뒤에 붙은 검수는 한 장으로 합쳐진다', () => {
    const out = pairTerminalCards([report('r1'), review('v1')]);
    expect(out).toHaveLength(1);
    expect(out[0]!.card.id).toBe('r1');
    expect(out[0]!.review?.id).toBe('v1');
  });

  it('짝 없는 검수는 독립 카드로 남는다', () => {
    const out = pairTerminalCards([review('v1'), list('l1')]);
    expect(out.map((e) => e.card.id)).toEqual(['v1', 'l1']);
    expect(out.every((e) => e.review === undefined)).toBe(true);
  });

  it('검수가 신고 바로 뒤가 아니면 합치지 않는다', () => {
    const out = pairTerminalCards([report('r1'), list('l1'), review('v1')]);
    expect(out.map((e) => e.card.id)).toEqual(['r1', 'l1', 'v1']);
    expect(out[0]!.review).toBeUndefined();
  });

  it('신고 두 장이 이어져도 각자 자기 뒤의 검수만 흡수한다', () => {
    const out = pairTerminalCards([report('r1'), review('v1'), report('r2'), review('v2')]);
    expect(out).toHaveLength(2);
    expect(out[0]!.review?.id).toBe('v1');
    expect(out[1]!.review?.id).toBe('v2');
  });

  it('빈 목록은 빈 목록', () => {
    expect(pairTerminalCards([])).toEqual([]);
  });
});
