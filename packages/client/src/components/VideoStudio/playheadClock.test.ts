import { describe, expect, it, vi } from 'vitest';

import { createPlayheadClock } from './playheadClock.js';

describe('§5.13 (X) 39-6 재생 머리 시계', () => {
  it('값을 옮기면 구독자만 깨운다 · 같은 값이면 깨우지 않는다', () => {
    const clock = createPlayheadClock(0);
    const listener = vi.fn();
    const off = clock.subscribe(listener);
    clock.set(0);
    expect(listener).not.toHaveBeenCalled();
    clock.set(1.5);
    expect(clock.get()).toBe(1.5);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    clock.set(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clock.get()).toBe(2);
  });

  it('구독자가 깨어나는 도중에 구독을 풀어도 나머지는 그대로 깨어난다', () => {
    const clock = createPlayheadClock();
    const second = vi.fn();
    let offFirst: () => void = () => undefined;
    offFirst = clock.subscribe(() => offFirst());
    clock.subscribe(second);
    clock.set(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
