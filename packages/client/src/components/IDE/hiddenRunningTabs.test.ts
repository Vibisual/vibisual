import { describe, it, expect } from 'vitest';
import { findHiddenRunningTabs, sameHiddenRunningTabs, noHiddenRunningTabs, type TabBox } from './hiddenRunningTabs.js';

/**
 * §5.5 #17-9 ④(b) v5.03 — 가려진 실행 중 탭 판정 회귀.
 *
 * 고정하는 약속: 보이는 창 **완전히 밖**에 있는 실행 중 탭만 세고, 각 목록의 `[0]` 은 그 방향으로
 * 처음 만나는(가장 가까운) 탭이다. 이게 어긋나면 "눌러서 이동"이 엉뚱한 탭으로 튄다.
 */

// 탭 100px 씩 6개 — 창은 250px 만 보인다.
const boxes: TabBox[] = [
  { id: 'a', left: 0, right: 100 },
  { id: 'b', left: 100, right: 200 },
  { id: 'c', left: 200, right: 300 },
  { id: 'd', left: 300, right: 400 },
  { id: 'e', left: 400, right: 500 },
  { id: 'f', left: 500, right: 600 },
];

const running = (...ids: string[]): Set<string> => new Set(ids);

describe('findHiddenRunningTabs — 보이는 창 밖의 실행 중 탭', () => {
  it('실행 중이 하나도 없으면 아무것도 가려지지 않았다고 본다', () => {
    expect(findHiddenRunningTabs(boxes, running(), 0, 250)).toEqual({ left: [], right: [] });
  });

  it('보이는 탭이 도는 것은 세지 않는다', () => {
    expect(findHiddenRunningTabs(boxes, running('a', 'b'), 0, 250)).toEqual({ left: [], right: [] });
  });

  it('오른쪽으로 밀려난 실행 탭을 오른쪽 목록에 담는다', () => {
    expect(findHiddenRunningTabs(boxes, running('e', 'f'), 0, 250)).toEqual({ left: [], right: ['e', 'f'] });
  });

  it('왼쪽으로 지나간 실행 탭을 왼쪽 목록에 담는다', () => {
    expect(findHiddenRunningTabs(boxes, running('a', 'b'), 300, 250)).toEqual({ left: ['b', 'a'], right: [] });
  });

  it('왼쪽 목록은 가까운 순 — [0] 이 화면에 가장 가까운 탭이다', () => {
    const hidden = findHiddenRunningTabs(boxes, running('a', 'b'), 300, 250);
    expect(hidden.left[0]).toBe('b');
  });

  it('오른쪽 목록도 가까운 순 — [0] 이 화면에 가장 가까운 탭이다', () => {
    const hidden = findHiddenRunningTabs(boxes, running('d', 'e', 'f'), 0, 250);
    expect(hidden.right[0]).toBe('d');
  });

  it('양쪽이 동시에 가려질 수 있다', () => {
    expect(findHiddenRunningTabs(boxes, running('a', 'f'), 250, 200)).toEqual({ left: ['a'], right: ['f'] });
  });

  it('창에 걸친 탭은 가려진 것으로 치지 않는다', () => {
    // c(200~300)는 창(250~450)에 절반 걸쳐 있다 — 조금이라도 보이면 세지 않는다.
    expect(findHiddenRunningTabs(boxes, running('c'), 250, 200)).toEqual({ left: [], right: [] });
  });

  it('탭이 넘치지 않으면(창이 전부를 담으면) 가려진 것이 없다', () => {
    expect(findHiddenRunningTabs(boxes, running('a', 'f'), 0, 600)).toEqual({ left: [], right: [] });
  });

  it('폭을 아직 못 잰 시점(clientWidth 0)은 판정을 보류한다', () => {
    expect(findHiddenRunningTabs(boxes, running('a'), 0, 0)).toEqual({ left: [], right: [] });
  });

  it('가려진 게 없으면 매번 같은 참조를 돌려준다', () => {
    const a = findHiddenRunningTabs(boxes, running('a'), 0, 600);
    const b = findHiddenRunningTabs(boxes, running('b'), 0, 600);
    expect(a).toBe(b);
    expect(a).toBe(noHiddenRunningTabs());
  });
});

describe('sameHiddenRunningTabs — DOM 을 다시 쓸지 판단', () => {
  it('같은 내용이면 같다고 본다', () => {
    expect(sameHiddenRunningTabs({ left: ['a'], right: ['b'] }, { left: ['a'], right: ['b'] })).toBe(true);
  });

  it('한쪽 길이가 다르면 다르다', () => {
    expect(sameHiddenRunningTabs({ left: ['a'], right: [] }, { left: ['a', 'b'], right: [] })).toBe(false);
  });

  it('순서가 다르면 다르다 — 눌렀을 때 갈 탭이 바뀐다', () => {
    expect(sameHiddenRunningTabs({ left: ['a', 'b'], right: [] }, { left: ['b', 'a'], right: [] })).toBe(false);
  });
});
