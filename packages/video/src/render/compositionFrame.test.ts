import { describe, expect, it } from 'vitest';
import { isResizeObserverLoopNotice, parsePickedBox } from './compositionFrame.js';

describe('컴포지션 오류 수신 — ResizeObserver 루프 알림은 오류가 아니다', () => {
  it('루프 알림 두 문구를 걸러낸다', () => {
    expect(isResizeObserverLoopNotice('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isResizeObserverLoopNotice('ResizeObserver loop limit exceeded')).toBe(true);
  });

  it('ResizeObserver 를 언급하는 진짜 오류는 남긴다', () => {
    expect(isResizeObserverLoopNotice('ResizeObserver is not defined')).toBe(false);
    expect(isResizeObserverLoopNotice('TypeError: boom')).toBe(false);
  });
});

describe('§5.13 (V) 37-21 — 심이 읽어 준 상자 선언', () => {
  const rect = { x: 10, y: 20, width: 100, height: 40 };

  it('값 이름과 사각형·경로가 맞을 때만 받는다(선언한 축만 남는다)', () => {
    expect(parsePickedBox({ x: 'cardX', w: 'cardW', path: 'div#card', rect })).toEqual({ x: 'cardX', w: 'cardW', path: 'div#card', rect });
  });

  it('이름이 하나도 없거나 값 이름 모양이 아니면 선언이 아니다', () => {
    expect(parsePickedBox({ path: 'div#card', rect })).toBeNull();
    expect(parsePickedBox({ x: 'has space', y: 7, path: 'div#card', rect })).toBeNull();
    expect(parsePickedBox({ x: '1st', path: 'div#card', rect })).toBeNull();
  });

  it('사각형·경로가 없으면 버린다', () => {
    expect(parsePickedBox({ x: 'cardX', path: 'div#card' })).toBeNull();
    expect(parsePickedBox({ x: 'cardX', path: '', rect })).toBeNull();
    expect(parsePickedBox(null)).toBeNull();
  });
});
