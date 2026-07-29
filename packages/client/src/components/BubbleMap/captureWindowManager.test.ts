import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerCaptureWindow,
  topCaptureWindowUid,
  closeTopCaptureWindow,
  __resetCaptureWindowsForTest,
} from './captureWindowManager.js';

/**
 * §5.9 v3.34 캡처 버블 앱 내부 멀티 윈도우 매니저.
 * 핵심 계약: 마지막 등록/클릭한 창이 맨 앞(z 최대), Escape 는 그 최상단 창 하나만 닫는다.
 */
describe('captureWindowManager', () => {
  beforeEach(() => __resetCaptureWindowsForTest());

  it('여러 창을 등록하면 나중 등록이 맨 앞(top)이고 z 가 더 크다', () => {
    const a = registerCaptureWindow(() => {});
    const b = registerCaptureWindow(() => {});
    expect(b.initialZ).toBeGreaterThan(a.initialZ);
    expect(topCaptureWindowUid()).toBe(b.uid);
  });

  it('bringToFront 는 뒤에 있던 창을 맨 앞으로 올리고 더 큰 z 를 반환한다', () => {
    const a = registerCaptureWindow(() => {});
    const b = registerCaptureWindow(() => {});
    const raised = a.bringToFront();
    expect(topCaptureWindowUid()).toBe(a.uid);
    expect(raised).toBeGreaterThan(b.initialZ);
  });

  it('Escape(=closeTopCaptureWindow) 는 최상단 창 하나만 닫는다', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    registerCaptureWindow(closeA);
    registerCaptureWindow(closeB); // 맨 앞
    expect(closeTopCaptureWindow()).toBe(true);
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
  });

  it('bringToFront 후 closeTopCaptureWindow 는 새 최상단을 닫는다', () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    const a = registerCaptureWindow(closeA);
    registerCaptureWindow(closeB);
    a.bringToFront(); // a 를 맨 앞으로
    closeTopCaptureWindow();
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
  });

  it('열린 창이 없으면 closeTopCaptureWindow 는 false', () => {
    expect(closeTopCaptureWindow()).toBe(false);
  });

  it('release 후 top 이 갱신되고, 전부 release 되면 -1', () => {
    const a = registerCaptureWindow(() => {});
    const b = registerCaptureWindow(() => {});
    b.release();
    expect(topCaptureWindowUid()).toBe(a.uid);
    a.release();
    expect(topCaptureWindowUid()).toBe(-1);
  });

  it('cascadeOffset 은 창마다 다른 계단식 오프셋을 준다', () => {
    const a = registerCaptureWindow(() => {});
    const b = registerCaptureWindow(() => {});
    expect(a.cascadeOffset).not.toBe(b.cascadeOffset);
  });
});
