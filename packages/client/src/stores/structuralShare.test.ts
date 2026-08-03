import { describe, it, expect } from 'vitest';
import { structuralShare } from './structuralShare.js';

describe('structuralShare', () => {
  it('내용이 같으면 prev 참조를 그대로 돌려준다', () => {
    const prev = { a: [1, 2], b: { c: 'x' } };
    const next = { a: [1, 2], b: { c: 'x' } };
    expect(structuralShare(prev, next)).toBe(prev);
  });

  it('바뀐 가지만 새 참조가 되고 안 바뀐 형제는 참조가 유지된다', () => {
    const prev = { subA: [{ id: 1 }], subB: [{ id: 2 }] };
    const next = { subA: [{ id: 1 }, { id: 3 }], subB: [{ id: 2 }] };
    const out = structuralShare(prev, next);

    expect(out).not.toBe(prev);          // 루트는 바뀜
    expect(out.subB).toBe(prev.subB);    // 안 바뀐 형제는 옛 참조 유지 → 구독자 조용
    expect(out.subA).not.toBe(prev.subA);
    expect(out.subA).toEqual([{ id: 1 }, { id: 3 }]);
  });

  it('배열에 append 되어도 기존 원소 참조는 유지된다', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    const next = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const out = structuralShare(prev, next);

    expect(out).not.toBe(prev);
    expect(out[0]).toBe(prev[0]);
    expect(out[1]).toBe(prev[1]);
    expect(out[2]).toEqual({ id: 'c' });
  });

  it('값이 바뀌면 그 경로만 새 참조가 된다', () => {
    const prev = { x: { deep: { v: 1 } }, y: { keep: true } };
    const next = { x: { deep: { v: 2 } }, y: { keep: true } };
    const out = structuralShare(prev, next);

    expect(out.y).toBe(prev.y);
    expect(out.x).not.toBe(prev.x);
    expect(out.x.deep.v).toBe(2);
  });

  it('키가 삭제되면 무변화로 오판하지 않는다', () => {
    const prev = { a: 1, b: 2 };
    const next = { a: 1 };
    const out = structuralShare(prev, next);
    expect(out).not.toBe(prev);
    expect(out).toEqual({ a: 1 });
  });

  it('배열이 짧아지면 무변화로 오판하지 않는다', () => {
    const prev = [{ id: 'a' }, { id: 'b' }];
    const next = [{ id: 'a' }];
    const out = structuralShare(prev, next);
    expect(out).not.toBe(prev);
    expect(out).toEqual([{ id: 'a' }]);
    expect(out[0]).toBe(prev[0]);
  });

  it('타입이 바뀌면 next 를 그대로 쓴다', () => {
    expect(structuralShare({ a: 1 }, [1])).toEqual([1]);
    expect(structuralShare([1], { a: 1 })).toEqual({ a: 1 });
    expect(structuralShare({ a: 1 }, null)).toBeNull();
    expect(structuralShare(null, { a: 1 })).toEqual({ a: 1 });
  });

  it('원시값·빈 컨테이너를 안전하게 다룬다', () => {
    expect(structuralShare(1, 1)).toBe(1);
    expect(structuralShare(1, 2)).toBe(2);
    expect(structuralShare('a', 'b')).toBe('b');
    const emptyPrev: Record<string, never> = {};
    expect(structuralShare(emptyPrev, {})).toBe(emptyPrev);
    const arrPrev: never[] = [];
    expect(structuralShare(arrPrev, [])).toBe(arrPrev);
  });

  it('빈 맵으로 교체되는 경우(카드 전부 삭제 등)를 무변화로 삼키지 않는다', () => {
    const prev = { p1: { count: 3 } };
    const out = structuralShare(prev, {} as typeof prev);
    expect(out).not.toBe(prev);
    expect(out).toEqual({});
  });
});
