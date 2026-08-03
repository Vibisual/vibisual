/**
 * §5.11 v4.04 — 패널 카드 정렬·접힘 규칙 고정 테스트.
 *
 * 카드가 111종이 되면서 "켠 것을 등록 순서대로 전부 펼치기"가 못 쓰게 됐다. 호스트가 문제부터 위로
 * 올리고 조용한 카드를 접는데, 그 규칙이 흔들리면 사용자는 **경고를 스크롤 아래에서 찾게 된다**.
 * 규칙만 순수 함수로 떼어 여기서 못 박는다.
 */
import { describe, it, expect } from 'vitest';
import { orderPanelSections, QUIET_COLLAPSE_THRESHOLD } from './panelOrder.js';

const s = (id: string, severity: 'bad' | 'warn' | 'neutral' | 'good') => ({ id, severity });

describe('패널 카드 정렬', () => {
  it('심각한 것부터 위로 온다', () => {
    const out = orderPanelSections([s('a', 'good'), s('b', 'bad'), s('c', 'neutral'), s('d', 'warn')], false);
    expect(out.shown.map((x) => x.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('같은 등급끼리는 원래 순서를 지킨다 — 켤 때마다 자리가 바뀌면 못 찾는다', () => {
    const out = orderPanelSections([s('a', 'warn'), s('b', 'warn'), s('c', 'warn')], false);
    expect(out.shown.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('조용한 카드 접힘', () => {
  it('조용한 카드가 문턱 이하면 접지 않는다', () => {
    const list = Array.from({ length: QUIET_COLLAPSE_THRESHOLD }, (_, i) => s(`q${i}`, 'good'));
    const out = orderPanelSections(list, false);
    expect(out.hidden).toBe(0);
    expect(out.shown).toHaveLength(list.length);
  });

  it('문턱을 넘으면 넘는 만큼만 접는다', () => {
    const list = Array.from({ length: QUIET_COLLAPSE_THRESHOLD + 4 }, (_, i) => s(`q${i}`, 'good'));
    const out = orderPanelSections(list, false);
    expect(out.hidden).toBe(4);
    expect(out.shown).toHaveLength(QUIET_COLLAPSE_THRESHOLD);
  });

  it('경고 카드는 몇 장이든 절대 접지 않는다 — 접히면 보라고 만든 이유가 사라진다', () => {
    const list = [
      ...Array.from({ length: 8 }, (_, i) => s(`w${i}`, 'warn')),
      ...Array.from({ length: 8 }, (_, i) => s(`q${i}`, 'good')),
    ];
    const out = orderPanelSections(list, false);
    expect(out.shown.filter((x) => x.severity === 'warn')).toHaveLength(8);
    expect(out.hidden).toBe(8 - QUIET_COLLAPSE_THRESHOLD);
  });

  it('펼친 상태에서는 전부 보이고 접을 것이 남는다', () => {
    const list = Array.from({ length: 10 }, (_, i) => s(`q${i}`, 'good'));
    const out = orderPanelSections(list, true);
    expect(out.hidden).toBe(0);
    expect(out.shown).toHaveLength(10);
    expect(out.collapsible).toBe(true);
  });

  it('접을 것이 없으면 접기 버튼도 내지 않는다', () => {
    const out = orderPanelSections([s('a', 'bad'), s('b', 'good')], true);
    expect(out.collapsible).toBe(false);
  });
});
