import { describe, expect, it } from 'vitest';
import {
  POINTER_DRAG,
  autoScrollDirection,
  ghostOffset,
  pressSurvivesMove,
  slotAtPointer,
  type DragSlot,
} from './pointerDragGeom.js';

// §5.4 #14-2 / §5.5 #16-1 (E) — 꾹 눌러 집어 드는 손짓의 순수 기하.
// 활동바(세로)와 두 탭바(가로)가 **같은 판정**을 쓰는 것이 이 회귀의 요지다 — 한쪽만 고쳐져
// 손맛이 갈리는 것을 막는다.

describe('pressSurvivesMove — 길게 누르기가 살아 있나', () => {
  it('세로 줄(활동바)은 세로 이동만 취소로 센다', () => {
    // 가로로 아무리 떨려도 살아 있다 — 폭 48px 짜리 한 줄에는 가로로 할 일이 없다.
    expect(pressSurvivesMove({ axis: 'y', startX: 100, startY: 100, x: 400, y: 100 })).toBe(true);
    // 세로로 slop 을 넘기면 그건 목록을 끈 것이다.
    expect(pressSurvivesMove({ axis: 'y', startX: 100, startY: 100, x: 100, y: 111 })).toBe(false);
    // 경계값은 살아 있다(같으면 아직 안 넘긴 것).
    expect(pressSurvivesMove({ axis: 'y', startX: 100, startY: 100, x: 100, y: 110 })).toBe(true);
  });

  it('가로 줄(탭바)은 가로 이동만 취소로 센다 — 세로로 내리는 손짓은 별창 분리다', () => {
    expect(pressSurvivesMove({ axis: 'x', startX: 100, startY: 100, x: 100, y: 600 })).toBe(true);
    expect(pressSurvivesMove({ axis: 'x', startX: 100, startY: 100, x: 111, y: 100 })).toBe(false);
  });

  it('slop 은 호출부가 바꿀 수 있다', () => {
    expect(pressSurvivesMove({ axis: 'x', startX: 0, startY: 0, x: 5, y: 0, slopPx: 3 })).toBe(false);
    expect(pressSurvivesMove({ axis: 'x', startX: 0, startY: 0, x: 5, y: 0, slopPx: 20 })).toBe(true);
  });
});

describe('slotAtPointer — 커서 아래가 어느 칸인가', () => {
  const slots: DragSlot[] = [
    { key: 'a', start: 0, size: 40 },
    { key: 'b', start: 44, size: 40 },
    { key: 'c', start: 88, size: 40 },
  ];

  it('칸 안이면 그 칸', () => {
    expect(slotAtPointer(slots, 10)?.key).toBe('a');
    expect(slotAtPointer(slots, 50)?.key).toBe('b');
    expect(slotAtPointer(slots, 127)?.key).toBe('c');
  });

  it('줄 밖으로 벗어나면 가장 가까운 끝 칸 — 맨 끝자리에 놓는 손짓은 줄 밖에서 끝난다', () => {
    expect(slotAtPointer(slots, -500)?.key).toBe('a');
    expect(slotAtPointer(slots, 5000)?.key).toBe('c');
  });

  it('칸 사이 틈에서는 중심이 가장 가까운 칸', () => {
    // 41 은 a(중심 20)와 b(중심 64) 사이 — a 가 가깝다.
    expect(slotAtPointer(slots, 41)?.key).toBe('a');
    // 43 도 여전히 a 쪽(거리 23 vs 21) — b 가 가깝다.
    expect(slotAtPointer(slots, 43)?.key).toBe('b');
  });

  it('빈 줄이면 아무것도 겨누지 않는다', () => {
    expect(slotAtPointer([], 10)).toBeNull();
  });
});

describe('autoScrollDirection — 가장자리에 닿았나', () => {
  it('앞 가장자리면 -1, 뒤 가장자리면 1, 가운데면 0', () => {
    expect(autoScrollDirection({ pointer: 105, viewStart: 100, viewEnd: 500 })).toBe(-1);
    expect(autoScrollDirection({ pointer: 495, viewStart: 100, viewEnd: 500 })).toBe(1);
    expect(autoScrollDirection({ pointer: 300, viewStart: 100, viewEnd: 500 })).toBe(0);
  });

  it('줄이 가장자리 두 개보다 좁으면 흐르지 않는다 — 어디에 놓아도 양쪽이 동시에 켜진다', () => {
    const tiny = POINTER_DRAG.autoScrollEdgePx;
    expect(autoScrollDirection({ pointer: 10, viewStart: 0, viewEnd: tiny })).toBe(0);
  });
});

describe('ghostOffset — 잡은 지점 그대로 붙어 온다', () => {
  it('잡은 지점을 빼고 정수로 떨어진다', () => {
    expect(ghostOffset({ x: 120.4, y: 60.6 }, { x: 20, y: 10 })).toEqual({ x: 100, y: 51 });
  });

  it('칸 왼쪽 끝을 잡았으면 고스트 왼쪽 끝이 커서에 온다', () => {
    expect(ghostOffset({ x: 300, y: 40 }, { x: 0, y: 0 })).toEqual({ x: 300, y: 40 });
  });
});
