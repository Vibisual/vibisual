import { describe, it, expect, beforeEach } from 'vitest';
import {
  listFloatPushPanes,
  moveFloatPushPane,
  registerFloatPushPane,
  resetFloatPushPanes,
  settleFloatPushPane,
  type FloatPushPane,
} from './ideFloatPush.js';

// (판올림 번호 발급 대기) §5.5 #17-1 — 등록소는 얇지만, 여기가 틀리면 **남의 창이 어긋난 채 남는다**
// (transform 만 걸리고 자리는 안 옮겨진 상태). 세 규약을 못 박는다: 못 미는 창은 목록에서 빠진다 ·
// 자기 자신은 밀지 않는다 · 해제된 창에 말을 걸어도 조용히 넘어간다.

function stub(over: Partial<FloatPushPane> = {}): FloatPushPane & { moves: Array<[number, number]>; settles: Array<[number, number]> } {
  const moves: Array<[number, number]> = [];
  const settles: Array<[number, number]> = [];
  return {
    moves,
    settles,
    rect: () => ({ x: 100, y: 100, w: 500, h: 340 }),
    move: (dx, dy) => { moves.push([dx, dy]); },
    settle: (dx, dy) => { settles.push([dx, dy]); },
    ...over,
  };
}

describe('밀기 등록소(ideFloatPush)', () => {
  beforeEach(() => resetFloatPushPanes());

  it('밀 수 있다고 답한 창만 목록에 든다 — 못 민다(null)면 셈에서 통째로 빠진다', () => {
    registerFloatPushPane('a', stub());
    registerFloatPushPane('b', stub({ rect: () => null }));
    const list = listFloatPushPanes(null);
    expect(list.map((p) => p.key)).toEqual(['a']);
  });

  it('자기 자신은 밀지 않는다', () => {
    registerFloatPushPane('a', stub());
    registerFloatPushPane('b', stub());
    expect(listFloatPushPanes('a').map((p) => p.key)).toEqual(['b']);
  });

  it('끄는 동안은 move, 손을 떼면 settle 로 갈린다', () => {
    const a = stub();
    registerFloatPushPane('a', a);
    moveFloatPushPane('a', 12, 0);
    settleFloatPushPane('a', 24, 0);
    expect(a.moves).toEqual([[12, 0]]);
    expect(a.settles).toEqual([[24, 0]]);
  });

  it('해제된 창에 말을 걸어도 터지지 않는다 — 끄는 도중에 창이 닫힐 수 있다', () => {
    const a = stub();
    const off = registerFloatPushPane('a', a);
    off();
    expect(listFloatPushPanes(null)).toEqual([]);
    expect(() => moveFloatPushPane('a', 5, 5)).not.toThrow();
    expect(() => settleFloatPushPane('a', 5, 5)).not.toThrow();
    expect(a.moves).toEqual([]);
  });

  it('같은 키를 새 창이 이어받았으면 옛 창의 해제가 그 등록을 지우지 않는다', () => {
    const older = stub();
    const off = registerFloatPushPane('a', older);
    const newer = stub();
    registerFloatPushPane('a', newer);
    off();
    expect(listFloatPushPanes(null).map((p) => p.key)).toEqual(['a']);
    moveFloatPushPane('a', 3, 0);
    expect(newer.moves).toEqual([[3, 0]]);
    expect(older.moves).toEqual([]);
  });
});
