import { describe, it, expect } from 'vitest';
import { shallowEqualData } from './flowBuilder.js';

describe('shallowEqualData', () => {
  it('같은 키·값이면 true', () => {
    expect(shallowEqualData({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
  });

  it('값이 다르면 false', () => {
    expect(shallowEqualData({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('키 개수가 다르면 false', () => {
    expect(shallowEqualData({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(shallowEqualData({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('중첩 객체는 참조로 비교 — 같은 참조면 true', () => {
    const pos = { x: 1, y: 2 };
    expect(shallowEqualData({ p: pos }, { p: pos })).toBe(true);
  });

  it('중첩 객체가 다른 참조면(값이 같아도) false', () => {
    expect(shallowEqualData({ p: { x: 1, y: 2 } }, { p: { x: 1, y: 2 } })).toBe(false);
  });

  it('undefined 값과 키 부재를 구분 — 키 개수로 걸러냄', () => {
    expect(shallowEqualData({ a: undefined }, {})).toBe(false);
  });

  it('빈 객체끼리는 true', () => {
    expect(shallowEqualData({}, {})).toBe(true);
  });

  it('NaN 값은 Object.is 로 동등 취급', () => {
    expect(shallowEqualData({ a: NaN }, { a: NaN })).toBe(true);
  });
});
