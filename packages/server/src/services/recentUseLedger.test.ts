import { describe, expect, it } from 'vitest';
import { RecentUseLedger } from './recentUseLedger.js';

const all = (): boolean => true;
const entries = (m: Map<string, number>): Array<[string, number]> => [...m].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));

describe('§5.1 #3-5 최근 사용 장부', () => {
  it('가장 최근 쓰임이 0, 개수 밖은 빠진다', () => {
    const led = new RecentUseLedger({ sameUseMs: 10, max: 50 });
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((p, i) => led.touch('A', p, 1000 + i * 100));
    expect(entries(led.ranks('A', 5, all))).toEqual([['f', 0], ['e', 1], ['d', 2], ['c', 3], ['b', 4]]);
    expect(led.ranks('A', 0, all).size).toBe(0);
  });

  it('한 번의 쓰임에 잇달아 만진 파일과 조상 폴더는 같은 순위다', () => {
    const led = new RecentUseLedger({ sameUseMs: 10, max: 50 });
    led.touch('A', 'packages', 1000);
    led.touch('A', 'packages/x.ts', 1001);
    led.touch('A', 'docs', 2000);
    led.touch('A', 'docs/y.md', 2003);
    expect(entries(led.ranks('A', 5, all))).toEqual([['docs', 0], ['docs/y.md', 0], ['packages', 1], ['packages/x.ts', 1]]);
  });

  it('빠르게 이어지는 접촉도 쓰임 하나가 끝없이 늘어나지 않는다(시작 시각 기준)', () => {
    const led = new RecentUseLedger({ sameUseMs: 10, max: 50 });
    for (let i = 0; i < 6; i += 1) led.touch('A', `p${i}`, 1000 + i * 6);
    const ranks = led.ranks('A', 12, all);
    expect(ranks.get('p5')).toBe(0);
    expect(ranks.get('p0')).toBeGreaterThan(0);
  });

  it('다시 쓰면 맨 앞으로 오고, 에이전트마다 따로 센다', () => {
    const led = new RecentUseLedger({ sameUseMs: 10, max: 50 });
    led.touch('A', 'shared', 1000);
    led.touch('B', 'shared', 1100);
    led.touch('A', 'mine', 1200);
    led.touch('B', 'other', 1300);
    led.touch('A', 'shared', 1400);
    expect(led.ranks('A', 5, all).get('shared')).toBe(0);
    expect(led.ranks('A', 5, all).get('mine')).toBe(1);
    expect(led.ranks('B', 5, all).get('shared')).toBe(1);
  });

  it('살아 있지 않은 경로는 자리를 차지하지 않는다', () => {
    const led = new RecentUseLedger({ sameUseMs: 10, max: 50 });
    ['a', 'b', 'c'].forEach((p, i) => led.touch('A', p, 1000 + i * 100));
    expect(entries(led.ranks('A', 2, (p) => p !== 'c'))).toEqual([['b', 0], ['a', 1]]);
  });

  it('물려받기는 새 쓰임이 아니다 — 자손의 도장만 옮긴다', () => {
    const led = new RecentUseLedger({ sameUseMs: 10, max: 50 });
    led.touch('A', 'child', 1000);
    led.touch('A', 'later', 2000);
    led.inherit('A', 'child', 'junction');
    const ranks = led.ranks('A', 5, all);
    expect(ranks.get('junction')).toBe(ranks.get('child'));
    expect(ranks.get('later')).toBe(0);
    led.inherit('A', 'missing', 'x');
    expect(led.ranks('A', 5, all).has('x')).toBe(false);
  });

  it('장부는 상한을 넘으면 오래된 경로부터 버린다', () => {
    const led = new RecentUseLedger({ sameUseMs: 10, max: 3 });
    ['a', 'b', 'c', 'd'].forEach((p, i) => led.touch('A', p, 1000 + i * 100));
    expect([...led.ranks('A', 10, all).keys()].sort()).toEqual(['b', 'c', 'd']);
    led.forgetAgent('A');
    expect(led.ranks('A', 10, all).size).toBe(0);
  });
});
