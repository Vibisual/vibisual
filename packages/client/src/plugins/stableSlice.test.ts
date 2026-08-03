/**
 * §5.11 v4.38 — 안정 슬라이스 비교 규칙 고정.
 *
 * 이 비교가 너무 헐거우면(내용이 달라졌는데 같다고 하면) 카드가 **낡은 값을 계속 보여 준다**.
 * 너무 빡빡하면(같은데 다르다고 하면) 원래 문제인 전면 재계산이 그대로 돌아온다. 양쪽 다 조용하다.
 */
import { describe, it, expect } from 'vitest';
import { sameSliceItems, pickStable } from './stableSlice.js';

describe('안정 슬라이스 비교', () => {
  it('길이가 다르면 다르다', () => {
    expect(sameSliceItems([1, 2], [1, 2, 3])).toBe(false);
    expect(sameSliceItems([1, 2, 3], [1, 2])).toBe(false);
  });

  it('같은 항목이 같은 순서면 같다 — 배열 신원이 달라도 내용이 같으면 다시 계산할 이유가 없다', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    expect(sameSliceItems([a, b], [a, b])).toBe(true);
  });

  it('순서가 다르면 다르다 — 화면에 그리는 순서가 곧 내용이다', () => {
    const a = { id: 'a' };
    const b = { id: 'b' };
    expect(sameSliceItems([a, b], [b, a])).toBe(false);
  });

  it('내용이 같아도 항목이 새 객체면 다르다고 본다', () => {
    // 스토어는 항목을 제자리에서 고치지 않고 교체한다(§3.2 불변 갱신).
    // 그러니 새 객체 = 실제로 바뀐 것이고, 얕은 비교로 충분하다.
    expect(sameSliceItems([{ id: 'a' }], [{ id: 'a' }])).toBe(false);
  });

  it('둘 다 비면 같다 — 아무 일도 없던 버블이 매번 다시 계산되면 안 된다', () => {
    expect(sameSliceItems([], [])).toBe(true);
  });

  it('한쪽만 비면 다르다', () => {
    expect(sameSliceItems([], [{ id: 'a' }])).toBe(false);
    expect(sameSliceItems([{ id: 'a' }], [])).toBe(false);
  });
});

describe('무엇을 쓸지 고르기', () => {
  it('내용이 같으면 **지난 배열을 그대로** 준다 — 신원이 유지돼야 카드 계산이 안 돈다', () => {
    const a = { id: 'a' };
    const prev = [a];
    const next = [a];                  // 통짜 구독 때문에 새로 만들어진 같은 내용
    expect(pickStable(prev, next)).toBe(prev);
  });

  it('내용이 달라지면 새 배열을 준다 — 여기서 옛것을 붙들면 카드가 낡은 값을 보여 준다', () => {
    const prev = [{ id: 'a' }];
    const next = [{ id: 'a' }, { id: 'b' }];
    expect(pickStable(prev, next)).toBe(next);
  });

  it('처음에는 그냥 새것을 쓴다', () => {
    const next = [{ id: 'a' }];
    expect(pickStable(undefined, next)).toBe(next);
  });

  it('축을 아무도 요청하지 않으면 undefined 를 유지한다', () => {
    expect(pickStable([{ id: 'a' }], undefined)).toBeUndefined();
    expect(pickStable(undefined, undefined)).toBeUndefined();
  });

  it('빈 배열끼리도 신원을 유지한다 — 아무 일 없는 버블이 매번 다시 계산되면 안 된다', () => {
    const prev: unknown[] = [];
    expect(pickStable(prev, [])).toBe(prev);
  });
});
