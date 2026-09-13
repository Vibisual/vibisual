import { describe, it, expect } from 'vitest';
import { lastPassedIndex, owningCommandId, VIEWED_TOP_MARGIN } from './streamViewedCommand.js';

/** 항목 래퍼의 컨테이너 상단 기준 top(px) 배열 → 측정 함수. 실제 DOM 대신 이 배열로 재현한다. */
function topsOf(tops: readonly number[]): (i: number) => number {
  return (i) => tops[i]!;
}

describe('lastPassedIndex — 화면 맨 위를 채운 항목 찾기', () => {
  it('상단(+여백)을 지난 마지막 항목을 고른다', () => {
    // 0,1 은 화면 위로 지나갔고 2 는 상단 바로 아래 → 맨 위를 채운 것은 1 번.
    expect(lastPassedIndex(4, topsOf([-900, -120, 60, 400]), VIEWED_TOP_MARGIN)).toBe(1);
  });

  it('여백(24px) 안쪽까지는 지난 것으로 본다', () => {
    expect(lastPassedIndex(2, topsOf([-100, 24]), VIEWED_TOP_MARGIN)).toBe(1);
    expect(lastPassedIndex(2, topsOf([-100, 25]), VIEWED_TOP_MARGIN)).toBe(0);
  });

  it('아무것도 못 지났으면 -1 (리스트 맨 위)', () => {
    expect(lastPassedIndex(3, topsOf([40, 300, 700]), VIEWED_TOP_MARGIN)).toBe(-1);
  });

  it('전부 지났으면 마지막 항목', () => {
    expect(lastPassedIndex(3, topsOf([-800, -500, -100]), VIEWED_TOP_MARGIN)).toBe(2);
  });

  it('항목이 없으면 -1', () => {
    expect(lastPassedIndex(0, topsOf([]), VIEWED_TOP_MARGIN)).toBe(-1);
  });

  it('이분 탐색이라 측정 횟수가 항목 수에 비례하지 않는다', () => {
    const tops = Array.from({ length: 1024 }, (_, i) => -20_000 + i * 40);
    let calls = 0;
    const idx = lastPassedIndex(tops.length, (i) => { calls++; return tops[i]!; }, VIEWED_TOP_MARGIN);
    expect(idx).toBe(500); // top = 0 인 항목(다음 항목은 40 > 24)
    expect(calls).toBeLessThanOrEqual(11); // log2(1024) + 1
  });
});

describe('owningCommandId — 맨 위 항목이 속한 턴의 명령', () => {
  const items = [
    { id: 'cmd-A' },
    { id: 'text-a1' },
    { id: 'tool-a2' },
    { id: 'cmd-B' },
    { id: 'text-b1' },
  ];
  const isCommand = (it: { id: string }): boolean => it.id.startsWith('cmd-');

  it('명령 항목 자신이 맨 위면 그 명령', () => {
    expect(owningCommandId(items, isCommand, 'cmd-B')).toBe('cmd-B');
  });

  it('응답 한복판이 맨 위면 그 턴을 연 명령 — 명령 블록이 미렌더여도 배열로 되짚는다', () => {
    // 이것이 이번 수정의 핵심: 위로 올려 cmd-B 말풍선을 지나치면 즉시 cmd-A 로 바뀌어야 한다.
    expect(owningCommandId(items, isCommand, 'tool-a2')).toBe('cmd-A');
    expect(owningCommandId(items, isCommand, 'text-b1')).toBe('cmd-B');
  });

  it('첫 명령보다 위(세션 서두)면 첫 명령을 가리킨다', () => {
    const withPreamble = [{ id: 'system-0' }, ...items];
    expect(owningCommandId(withPreamble, isCommand, 'system-0')).toBe('cmd-A');
  });

  it('명령이 하나도 없으면 null', () => {
    expect(owningCommandId([{ id: 'text-1' }], isCommand, 'text-1')).toBeNull();
  });

  it('맨 위 항목이 없거나 배열에서 사라졌으면 null (부르는 쪽이 종전 판정으로 폴백)', () => {
    expect(owningCommandId(items, isCommand, null)).toBeNull();
    expect(owningCommandId(items, isCommand, 'text-gone')).toBeNull();
  });
});
