/**
 * renderer 진단 잡음 필터 테스트.
 *
 * "ResizeObserver loop completed with undelivered notifications." 는 코드 버그가 아니라
 * 브라우저가 스펙대로 내는 알림인데, window error 핸들러가 모든 ErrorEvent 를 잡는 탓에
 * DebugPanel 에 RENDERER 오류로 쌓였다. 그 한 종류만 걸러내고 진짜 오류는 그대로 통과하는지 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { isIgnoredRendererMessage } from './diagnostics.js';

describe('isIgnoredRendererMessage', () => {
  it('ResizeObserver 루프 알림을 걸러낸다', () => {
    expect(isIgnoredRendererMessage('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isIgnoredRendererMessage('ResizeObserver loop limit exceeded')).toBe(true);
  });

  it('브라우저가 접두어를 붙여도 걸러낸다', () => {
    expect(
      isIgnoredRendererMessage('Uncaught Error: ResizeObserver loop completed with undelivered notifications.'),
    ).toBe(true);
  });

  it('진짜 오류는 통과시킨다', () => {
    expect(isIgnoredRendererMessage('Cannot read properties of undefined')).toBe(false);
    expect(isIgnoredRendererMessage('ResizeObserver is not defined')).toBe(false);
    expect(isIgnoredRendererMessage('')).toBe(false);
  });
});
