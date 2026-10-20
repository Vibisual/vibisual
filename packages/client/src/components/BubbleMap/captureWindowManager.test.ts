import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { answerAppDialog, confirmDialog, getAppDialog, installAppDialogKeyboardGuard } from '../../utils/appDialog.js';
import { selectShellImmersive, useProjectImmersionStore } from '../../stores/projectImmersion.js';
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
  beforeEach(() => {
    __resetCaptureWindowsForTest();
    useProjectImmersionStore.getState().exit();
  });
  afterEach(() => {
    __resetCaptureWindowsForTest();
    useProjectImmersionStore.getState().exit();
    vi.unstubAllGlobals();
  });

  it.each(['project', 'ide'])('lets %s immersion handle Escape before closing a previously registered window', (kind) => {
    const browser = new EventTarget();
    vi.stubGlobal('window', browser);
    const close = vi.fn();
    registerCaptureWindow(close);
    if (kind === 'project') useProjectImmersionStore.getState().toggle('project');
    else useProjectImmersionStore.getState().enterIDE('project', 'pane');
    // The shell installs its listener after the existing floating window has registered.
    browser.addEventListener('keydown', (event) => {
      if (!selectShellImmersive(useProjectImmersionStore.getState())) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      useProjectImmersionStore.getState().exit();
    }, true);
    const escape = (): Event => {
      const event = new Event('keydown', { cancelable: true });
      Object.defineProperty(event, 'key', { value: 'Escape' });
      browser.dispatchEvent(event);
      return event;
    };

    expect(escape().defaultPrevented).toBe(true);
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(escape().defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it('consumes the Escape that opens a discard dialog before other window capture listeners can close background UI', async () => {
    const browser = new EventTarget();
    vi.stubGlobal('window', browser);
    installAppDialogKeyboardGuard(browser as unknown as Window);
    let answer: Promise<boolean> | undefined;
    registerCaptureWindow(() => { answer = confirmDialog('Discard edits?'); });
    const backgroundClose = vi.fn();
    browser.addEventListener('keydown', backgroundClose, true);

    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value: 'Escape' });
    browser.dispatchEvent(event);
    expect(getAppDialog()?.message).toBe('Discard edits?');
    expect(event.defaultPrevented).toBe(true);
    expect(backgroundClose).not.toHaveBeenCalled();
    answerAppDialog(getAppDialog()!.id, false);
    await expect(answer).resolves.toBe(false);
  });

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

  it('hidden project windows are skipped by Escape and regain their place when shown', () => {
    const closeVisible = vi.fn();
    const closeOtherProject = vi.fn();
    const visible = registerCaptureWindow(closeVisible);
    let showing = true;
    const otherProject = registerCaptureWindow(closeOtherProject, () => showing);
    expect(topCaptureWindowUid()).toBe(otherProject.uid);
    showing = false;
    expect(topCaptureWindowUid()).toBe(visible.uid);
    expect(closeTopCaptureWindow()).toBe(true);
    expect(closeVisible).toHaveBeenCalledOnce();
    expect(closeOtherProject).not.toHaveBeenCalled();
    showing = true;
    expect(topCaptureWindowUid()).toBe(otherProject.uid);
  });

  it('all hidden windows leave Escape available to the current tab', () => {
    const close = vi.fn();
    registerCaptureWindow(close, () => false);
    expect(topCaptureWindowUid()).toBe(-1);
    expect(closeTopCaptureWindow()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});
