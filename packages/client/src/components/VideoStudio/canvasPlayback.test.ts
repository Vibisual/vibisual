import { afterEach, describe, expect, it, vi } from 'vitest';

import { __resetCanvasPlaybackForTest, canvasPlaybackHeld, claimCanvasPlayback } from './canvasPlayback.js';

/** §5.4 #36 (J) ⑦ — 캔버스에서 동시에 도는 영상은 하나: 새로 잡으면 앞 것이 멈춘다. */
describe('§5.4 #36 (J) ⑦ 캔버스 재생 자리', () => {
  afterEach(() => __resetCanvasPlaybackForTest());

  it('다른 화면이 재생을 잡으면 앞 화면의 stop 이 한 번 불린다', () => {
    const a = vi.fn();
    const b = vi.fn();
    claimCanvasPlayback(a);
    claimCanvasPlayback(b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('늦게 놓은 앞 화면이 새 화면의 자리를 비우지 않는다', () => {
    const releaseA = claimCanvasPlayback(vi.fn());
    const b = vi.fn();
    const releaseB = claimCanvasPlayback(b);
    releaseA();
    expect(canvasPlaybackHeld()).toBe(true);
    const c = vi.fn();
    claimCanvasPlayback(c);
    expect(b).toHaveBeenCalledTimes(1);
    releaseB();
    expect(canvasPlaybackHeld()).toBe(true); // c 가 잡고 있다
  });

  it('놓으면 비고, 그 뒤에 잡는 화면은 아무것도 멈추지 않는다', () => {
    const a = vi.fn();
    const release = claimCanvasPlayback(a);
    release();
    expect(canvasPlaybackHeld()).toBe(false);
    claimCanvasPlayback(vi.fn());
    expect(a).not.toHaveBeenCalled();
  });

  it('앞 화면의 정리가 던져도 새 재생은 자리를 잡는다', () => {
    claimCanvasPlayback(() => { throw new Error('boom'); });
    expect(() => claimCanvasPlayback(vi.fn())).not.toThrow();
    expect(canvasPlaybackHeld()).toBe(true);
  });
});
