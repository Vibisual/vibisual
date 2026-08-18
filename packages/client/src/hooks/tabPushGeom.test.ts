import { describe, it, expect } from 'vitest';
import {
  TAB_PUSH,
  applyLocalOrder,
  crossedTabMidpoint,
  moveKeyToward,
  planTabPush,
  resolveTabReorder,
  sameMembers,
  sameOrder,
} from './tabPushGeom.js';

// §5.4 #14 — 밀어내기 손맛은 DOM 없이 검증한다(좌표·순서만 받는 순수 함수).

/** 폭 100px 탭이 왼쪽부터 붙어 있는 가상의 탭바. */
function laneOf(keys: readonly string[], width = 100): Map<string, number> {
  return new Map(keys.map((key, i) => [key, i * width]));
}

describe('resolveTabReorder — 중앙선을 넘어야 자리가 바뀐다', () => {
  const order = ['a', 'b', 'c'];
  const target = { targetLeft: 100, targetWidth: 100 }; // b 의 자리

  it('오른쪽으로 끌 때 중앙선 앞이면 그대로 둔다', () => {
    expect(resolveTabReorder({
      order, movedKey: 'a', targetKey: 'b', pointerX: 149, ...target,
    })).toBeNull();
  });

  it('오른쪽으로 끌어 중앙선을 넘으면 대상 뒤로 간다', () => {
    expect(resolveTabReorder({
      order, movedKey: 'a', targetKey: 'b', pointerX: 151, ...target,
    })).toEqual(['b', 'a', 'c']);
  });

  it('왼쪽으로 끌 때는 반대 — 중앙선 뒤면 그대로, 넘으면 대상 앞으로', () => {
    expect(resolveTabReorder({
      order, movedKey: 'c', targetKey: 'b', pointerX: 151, ...target,
    })).toBeNull();
    expect(resolveTabReorder({
      order, movedKey: 'c', targetKey: 'b', pointerX: 149, ...target,
    })).toEqual(['a', 'c', 'b']);
  });

  it('자기 자신·모르는 키 위에서는 아무 일도 없다', () => {
    expect(resolveTabReorder({ order, movedKey: 'a', targetKey: 'a', pointerX: 0, ...target })).toBeNull();
    expect(resolveTabReorder({ order, movedKey: 'a', targetKey: 'z', pointerX: 999, ...target })).toBeNull();
  });

  it('중앙선 정확히 위는 넘은 것으로 친다(양방향 모두 반응)', () => {
    expect(crossedTabMidpoint({ pointerX: 150, targetLeft: 100, targetWidth: 100, movingRight: true })).toBe(true);
    expect(crossedTabMidpoint({ pointerX: 150, targetLeft: 100, targetWidth: 100, movingRight: false })).toBe(true);
  });
});

describe('moveKeyToward — 숨은 탭이 사이에 껴 있어도 보이는 순서가 맞는다', () => {
  it('오른쪽 이동은 대상 뒤, 왼쪽 이동은 대상 앞', () => {
    expect(moveKeyToward(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveKeyToward(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('별창으로 빠진(화면에 없는) 키가 사이에 있어도 대상과의 앞뒤가 지켜진다', () => {
    // hidden 은 화면에 없지만 순서 배열엔 남아 있다 — a 는 c 바로 뒤에 앉아야 한다.
    expect(moveKeyToward(['a', 'hidden', 'b', 'c'], 'a', 'c')).toEqual(['hidden', 'b', 'c', 'a']);
  });

  it('바꿀 게 없으면 같은 순서를 돌려준다', () => {
    expect(moveKeyToward(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
    expect(moveKeyToward(['a', 'b'], 'z', 'b')).toEqual(['a', 'b']);
  });
});

describe('planTabPush — 옛 좌표와 새 좌표의 차이가 곧 밀려난 거리', () => {
  const order = ['b', 'a', 'c'];

  it('자리를 맞바꾼 두 탭만 서로 반대 방향으로 밀린다', () => {
    const steps = planTabPush({
      previous: laneOf(['a', 'b', 'c']),
      next: laneOf(order),
      leadKey: 'a',
      order,
    });
    const shift = new Map(steps.map((s) => [s.key, s.shiftPx]));
    expect(shift.get('a')).toBe(-100); // a 는 오른쪽으로 갔으니 왼쪽에서 밀려 들어온다
    expect(shift.get('b')).toBe(100);
    expect(shift.has('c')).toBe(false); // 자리가 그대로면 대상이 아니다
  });

  it('끌고 있는 탭은 짧고 튕김 없이, 이웃은 넘겼다 앉는 곡선으로', () => {
    const steps = planTabPush({
      previous: laneOf(['a', 'b', 'c']),
      next: laneOf(order),
      leadKey: 'a',
      order,
    });
    const lead = steps.find((s) => s.key === 'a');
    const pushed = steps.find((s) => s.key === 'b');
    expect(lead).toMatchObject({ durationMs: TAB_PUSH.leadDurationMs, easing: TAB_PUSH.leadEasing, delayMs: 0 });
    expect(pushed).toMatchObject({ durationMs: TAB_PUSH.settleDurationMs, easing: TAB_PUSH.settleEasing });
  });

  it('손에서 먼 탭일수록 늦게 출발하되 상한을 넘지 않는다', () => {
    const keys = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];
    const previous = laneOf(keys);
    // 전부 한 칸씩 밀린 상황을 만들어(좌표만 옮김) 거리별 지연만 본다.
    const next = new Map([...previous].map(([key, left]) => [key, left + 100]));
    const steps = planTabPush({ previous, next, leadKey: 't0', order: keys });
    const delay = new Map(steps.map((s) => [s.key, s.delayMs]));
    expect(delay.get('t0')).toBe(0);                       // 끌고 있는 탭
    expect(delay.get('t1')).toBe(0);                       // 바로 옆은 곧장
    expect(delay.get('t2')).toBe(TAB_PUSH.staggerMs);
    expect(delay.get('t6')).toBe(TAB_PUSH.maxStaggerMs);   // 멀어도 상한에서 멈춘다
  });

  it('달리던 이동량(carry)을 이어 붙여 중간에 끊기지 않는다', () => {
    const steps = planTabPush({
      previous: laneOf(['a', 'b', 'c']),
      next: laneOf(order),
      carry: new Map([['b', 40]]),
      leadKey: 'a',
      order,
    });
    expect(steps.find((s) => s.key === 'b')?.shiftPx).toBe(140);
  });

  it('새로 붙은 탭과 눈에 안 보이는 이동은 재생하지 않는다', () => {
    const steps = planTabPush({
      previous: new Map([['a', 0]]),
      next: new Map([['a', 0.2], ['fresh', 100]]),
      leadKey: null,
      order: ['a', 'fresh'],
    });
    expect(steps).toEqual([]);
  });

  it('끌고 있는 탭이 없으면(탭이 닫혀 옆이 메워질 때) 전부 이웃으로 본다', () => {
    const steps = planTabPush({
      previous: laneOf(['a', 'b', 'c']),
      next: laneOf(['a', 'c']),
      leadKey: null,
      order: ['a', 'c'],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ key: 'c', shiftPx: 100, delayMs: 0, easing: TAB_PUSH.settleEasing });
  });
});

/** 'cubic-bezier(x1, y1, x2, y2)' 의 y1 — 1 을 넘으면 제자리를 **지나쳤다** 돌아온다는 뜻이다. */
function overshootOf(easing: string): number {
  const inner = easing.slice(easing.indexOf(String.fromCharCode(40)) + 1, easing.lastIndexOf(String.fromCharCode(41)));
  return Number(inner.split(',')[1]);
}

// 손맛 수치의 **불변식** — 값은 취향껏 조정해도 되지만, 이 관계가 깨지면 "밀렸다"가 눈에 안 읽힌다.
// (처음 값 260ms · 오버슈트 1.28 이 너무 옅어 "밀어내기가 없어졌다"는 신고로 돌아온 적이 있다.)
describe('TAB_PUSH — 밀림이 눈에 읽히기 위한 불변식', () => {
  it('끌고 있는 탭이 이웃보다 먼저 앉는다 — 손이 먼저 도착해야 내가 민 것으로 읽힌다', () => {
    expect(TAB_PUSH.leadDurationMs).toBeLessThan(TAB_PUSH.settleDurationMs);
  });

  it('이웃 곡선은 제자리를 지나쳤다 앉는다(오버슈트) — 지나침이 없으면 그냥 이동으로 보인다', () => {
    expect(overshootOf(TAB_PUSH.settleEasing)).toBeGreaterThan(1);
  });

  it('끌고 있는 탭 곡선은 튕기지 않는다 — 손끝이 흔들려 보이면 안 된다', () => {
    expect(overshootOf(TAB_PUSH.leadEasing)).toBeLessThanOrEqual(1);
  });

  it('연쇄가 보일 만큼 늦게 출발하되, 끝 탭이 하염없이 기다리지 않는다', () => {
    expect(TAB_PUSH.staggerMs).toBeGreaterThan(0);
    expect(TAB_PUSH.maxStaggerMs).toBeGreaterThanOrEqual(TAB_PUSH.staggerMs * 2);
    expect(TAB_PUSH.maxStaggerMs).toBeLessThan(TAB_PUSH.settleDurationMs);
  });

  it('재생이 끝난 뒤에야 인라인 스타일을 걷는다(여유가 양수)', () => {
    expect(TAB_PUSH.cleanupSlackMs).toBeGreaterThan(0);
  });
});

describe('로컬 순서 덧씌우기 — 커밋 왕복 동안 화면이 되돌아가지 않는다', () => {
  const subs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const keyOf = (s: { id: string }): string => s.id;

  it('로컬 순서대로 정렬한다', () => {
    expect(applyLocalOrder(subs, ['c', 'a', 'b'], keyOf).map(keyOf)).toEqual(['c', 'a', 'b']);
  });

  it('드래그 중 새로 생긴 탭은 뒤에 원래 순서대로 붙는다', () => {
    const withNew = [...subs, { id: 'new' }];
    expect(applyLocalOrder(withNew, ['c', 'a', 'b'], keyOf).map(keyOf)).toEqual(['c', 'a', 'b', 'new']);
  });

  it('서버가 같은 순서를 돌려주면 덧씌울 게 없다(비교로 판정)', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameMembers(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameMembers(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(sameMembers(['a'], ['a', 'b'])).toBe(false);
  });
});
