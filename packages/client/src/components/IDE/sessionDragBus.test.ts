import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activePointerSessionDrag,
  beginPointerSessionDrag,
  cancelPointerSessionDrag,
  endPointerSessionDrag,
  movePointerSessionDrag,
  registerSessionDropTarget,
  type PointerSessionDrag,
  type SessionDropTarget,
} from './sessionDragBus.js';

// §5.5 #17-34 / §5.4 #14-2 — 포인터로 끄는 세션이 어느 자리에 떨어지는가.
// 세션 탭이 네이티브 DnD 를 떠나면서 `stopPropagation` 이 해 주던 "가장 안쪽이 이긴다"를 여기서
// 다시 세운다 — 둘이 동시에 파란 박스를 띄우면 어디에 앉을지가 화면에서 갈린다.

interface Rect { left: number; top: number; right: number; bottom: number }

/** DOM 없이 도는 테스트(jsdom 미설치) — 버스가 실제로 만지는 세 가지만 흉내 낸다. */
function fakeEl(rect: Rect, descendants: HTMLElement[] = []): HTMLElement {
  const el = {
    isConnected: true,
    getBoundingClientRect: () => rect,
    contains: (other: unknown) => descendants.includes(other as HTMLElement),
  };
  return el as unknown as HTMLElement;
}

function spyTarget(el: HTMLElement): { target: SessionDropTarget; over: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn>; drop: ReturnType<typeof vi.fn> } {
  const over = vi.fn();
  const leave = vi.fn();
  const drop = vi.fn();
  return { target: { el, onOver: over, onLeave: leave, onDrop: drop }, over, leave, drop };
}

const DRAG: PointerSessionDrag = { sessionId: 'sub-1', agentId: 'agent-1', fromCellId: null };

describe('sessionDragBus', () => {
  beforeEach(() => { cancelPointerSessionDrag(); });

  it('끌고 있지 않으면 아무 자리도 반응하지 않는다', () => {
    const a = spyTarget(fakeEl({ left: 0, top: 0, right: 100, bottom: 100 }));
    const off = registerSessionDropTarget(a.target);
    movePointerSessionDrag(50, 50);
    expect(a.over).not.toHaveBeenCalled();
    expect(endPointerSessionDrag(50, 50)).toBe(false);
    off();
  });

  it('좌표를 품은 자리에만 알린다', () => {
    const inside = spyTarget(fakeEl({ left: 0, top: 0, right: 100, bottom: 100 }));
    const outside = spyTarget(fakeEl({ left: 200, top: 0, right: 300, bottom: 100 }));
    const offA = registerSessionDropTarget(inside.target);
    const offB = registerSessionDropTarget(outside.target);

    beginPointerSessionDrag(DRAG);
    expect(activePointerSessionDrag()).toEqual(DRAG);
    movePointerSessionDrag(50, 50);
    expect(inside.over).toHaveBeenCalledWith(DRAG, 50, 50);
    expect(outside.over).not.toHaveBeenCalled();

    offA(); offB();
  });

  it('겹친 자리에서는 **가장 깊은 것**이 이긴다 — 칸 안의 칸', () => {
    const innerEl = fakeEl({ left: 40, top: 40, right: 90, bottom: 90 });
    // 바깥칸은 안쪽칸을 품는다(`contains`).
    const outerEl = fakeEl({ left: 0, top: 0, right: 100, bottom: 100 }, [innerEl]);
    const inner = spyTarget(innerEl);
    const outer = spyTarget(outerEl);
    const offOuter = registerSessionDropTarget(outer.target);
    const offInner = registerSessionDropTarget(inner.target);

    beginPointerSessionDrag(DRAG);
    movePointerSessionDrag(50, 50);
    expect(inner.over).toHaveBeenCalledTimes(1);
    expect(outer.over).not.toHaveBeenCalled();

    offOuter(); offInner();
  });

  it('자리를 옮기면 떠난 쪽이 먼저 걷힌다 — 파란 박스가 둘 남지 않게', () => {
    const a = spyTarget(fakeEl({ left: 0, top: 0, right: 100, bottom: 100 }));
    const b = spyTarget(fakeEl({ left: 100, top: 0, right: 200, bottom: 100 }));
    const offA = registerSessionDropTarget(a.target);
    const offB = registerSessionDropTarget(b.target);

    beginPointerSessionDrag(DRAG);
    movePointerSessionDrag(50, 50);
    movePointerSessionDrag(150, 50);
    expect(a.leave).toHaveBeenCalledTimes(1);
    expect(b.over).toHaveBeenCalledWith(DRAG, 150, 50);

    offA(); offB();
  });

  it('손을 뗀 자리가 받는다 — 미리보기는 그 전에 걷힌다', () => {
    const a = spyTarget(fakeEl({ left: 0, top: 0, right: 100, bottom: 100 }));
    const off = registerSessionDropTarget(a.target);

    beginPointerSessionDrag(DRAG);
    movePointerSessionDrag(50, 50);
    expect(endPointerSessionDrag(60, 60)).toBe(true);
    expect(a.leave).toHaveBeenCalled();
    expect(a.drop).toHaveBeenCalledWith(DRAG, 60, 60);
    // 끝났으니 다음 움직임은 아무 일도 하지 않는다.
    expect(activePointerSessionDrag()).toBeNull();
    off();
  });

  it('자리 밖에서 놓으면 아무도 받지 않는다 — 탭바 안에서 놓은 경우가 그렇다', () => {
    const a = spyTarget(fakeEl({ left: 0, top: 100, right: 100, bottom: 200 }));
    const off = registerSessionDropTarget(a.target);

    beginPointerSessionDrag(DRAG);
    movePointerSessionDrag(50, 150);
    // 탭 줄(y<100)에서 손을 뗐다 — 본문 칸은 그 좌표를 품지 않는다.
    expect(endPointerSessionDrag(50, 20)).toBe(false);
    expect(a.drop).not.toHaveBeenCalled();
    // 떠난 자리의 미리보기는 걷혔다.
    expect(a.leave).toHaveBeenCalled();
    off();
  });

  it('취소하면 미리보기를 걷고 끌기가 끝난다', () => {
    const a = spyTarget(fakeEl({ left: 0, top: 0, right: 100, bottom: 100 }));
    const off = registerSessionDropTarget(a.target);

    beginPointerSessionDrag(DRAG);
    movePointerSessionDrag(50, 50);
    cancelPointerSessionDrag();
    expect(a.leave).toHaveBeenCalled();
    expect(a.drop).not.toHaveBeenCalled();
    expect(activePointerSessionDrag()).toBeNull();
    off();
  });

  it('해제된 자리는 더 이상 받지 않는다 — 칸이 닫혀도 유령이 남지 않게', () => {
    const a = spyTarget(fakeEl({ left: 0, top: 0, right: 100, bottom: 100 }));
    const off = registerSessionDropTarget(a.target);
    off();

    beginPointerSessionDrag(DRAG);
    movePointerSessionDrag(50, 50);
    expect(a.over).not.toHaveBeenCalled();
    expect(endPointerSessionDrag(50, 50)).toBe(false);
  });

  it('문서에서 떨어진 자리는 셈에서 빠진다', () => {
    const el = fakeEl({ left: 0, top: 0, right: 100, bottom: 100 });
    (el as unknown as { isConnected: boolean }).isConnected = false;
    const a = spyTarget(el);
    const off = registerSessionDropTarget(a.target);

    beginPointerSessionDrag(DRAG);
    movePointerSessionDrag(50, 50);
    expect(a.over).not.toHaveBeenCalled();
    off();
  });
});
