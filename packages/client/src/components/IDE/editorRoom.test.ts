import { describe, it, expect } from 'vitest';
import { growSpanRight, shrinkSpanBack } from '@vibisual/shared';

/**
 * §5.5 #17-27 ①-1 — 편집창이 열릴 때 창을 오른쪽으로 넓히고 닫으면 되돌리는 가로 자리 계산.
 * 앱 안의 떠 있는 창과 독립 OS 창(main)이 이 둘을 함께 쓰므로, 여기서 한 번 고정해 두면 두 자리가 같이 선다.
 */

describe('growSpanRight', () => {
  const screen = { x: 0, w: 1920 };

  it('오른쪽에 자리가 있으면 왼쪽 변은 그대로, 오른쪽 변만 늘어난다', () => {
    expect(growSpanRight({ x: 100, w: 480 }, 520, screen)).toEqual({ x: 100, w: 1000 });
  });

  it('화면 오른쪽 끝에 닿으면 넘친 만큼 왼쪽으로 물러선다', () => {
    expect(growSpanRight({ x: 1400, w: 480 }, 520, screen)).toEqual({ x: 920, w: 1000 });
  });

  it('화면보다 넓어질 수는 없다 — 폭은 화면 폭까지, 자리는 화면 왼쪽 끝', () => {
    expect(growSpanRight({ x: 300, w: 1500 }, 520, screen)).toEqual({ x: 0, w: 1920 });
  });

  it('둘째 모니터처럼 원점이 0 이 아닌 작업영역에서도 그 영역 안에 앉는다', () => {
    expect(growSpanRight({ x: 2500, w: 600 }, 520, { x: 1920, w: 1280 })).toEqual({ x: 2080, w: 1120 });
  });

  it('넓힐 양이 없거나 수가 아니면 그대로다', () => {
    expect(growSpanRight({ x: 10, w: 480 }, 0, screen)).toEqual({ x: 10, w: 480 });
    expect(growSpanRight({ x: 10, w: 480 }, -50, screen)).toEqual({ x: 10, w: 480 });
    expect(growSpanRight({ x: 10, w: 480 }, Number.NaN, screen)).toEqual({ x: 10, w: 480 });
  });

  it('이미 화면보다 넓은 창을 줄이지는 않는다(넓히는 함수다)', () => {
    expect(growSpanRight({ x: 0, w: 2000 }, 520, screen).w).toBe(2000);
  });
});

describe('shrinkSpanBack', () => {
  const growth = { before: { x: 1400, w: 480 }, after: { x: 920, w: 1000 } };

  it('손대지 않았으면 넓히기 전 자리·폭 그대로 돌아간다', () => {
    expect(shrinkSpanBack({ x: 920, w: 1000 }, growth)).toEqual({ x: 1400, w: 480 });
  });

  it('자리만 옮겼으면 그 자리에서 폭만 되돌린다', () => {
    expect(shrinkSpanBack({ x: 600, w: 1000 }, growth)).toEqual({ x: 600, w: 480 });
  });

  it('폭을 사용자가 바꿨으면 손대지 않는다(null)', () => {
    expect(shrinkSpanBack({ x: 920, w: 900 }, growth)).toBeNull();
    expect(shrinkSpanBack({ x: 920, w: 1200 }, growth)).toBeNull();
  });

  it('OS 배율 반올림 1px 은 손댄 것으로 치지 않는다', () => {
    expect(shrinkSpanBack({ x: 921, w: 1001 }, growth)).toEqual({ x: 1400, w: 480 });
  });
});
