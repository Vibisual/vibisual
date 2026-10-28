/**
 * §5.23 「더블클릭」 — "이 창에 iframe 탭 줄이 있는가" 표식 시험. 셸 마운트에 세우고 언마운트에 내린다 — StrictMode 의 두 번 마운트에도
 * 셈이 맞고, 같은 내리기를 두 번 불러도 다른 셸의 표식까지 내려가지 않는다.
 */
import { describe, expect, it } from 'vitest';
import { hasIframeTabHost, registerIframeTabHost } from './iframeTabHost.js';

describe('iframeTabHost', () => {
  it('세우면 있고, 내리면 없다', () => {
    expect(hasIframeTabHost()).toBe(false);
    const release = registerIframeTabHost();
    expect(hasIframeTabHost()).toBe(true);
    release();
    expect(hasIframeTabHost()).toBe(false);
  });

  it('StrictMode 의 두 번 마운트(세우기·내리기·세우기)에도 셈이 맞는다', () => {
    const first = registerIframeTabHost();
    first();
    const second = registerIframeTabHost();
    expect(hasIframeTabHost()).toBe(true);
    second();
    expect(hasIframeTabHost()).toBe(false);
  });

  it('같은 내리기를 두 번 불러도 다른 셸의 표식은 남는다', () => {
    const a = registerIframeTabHost();
    const b = registerIframeTabHost();
    a();
    a();
    expect(hasIframeTabHost()).toBe(true);
    b();
    expect(hasIframeTabHost()).toBe(false);
  });
});
