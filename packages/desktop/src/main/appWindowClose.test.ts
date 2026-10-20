import { describe, expect, it, vi } from 'vitest';
import { createAppWindowClose } from './appWindowClose';

function setup() {
  let destroyed = false;
  const event = { preventDefault: vi.fn() };
  const win = {
    isDestroyed: () => destroyed,
    close: vi.fn(() => lifecycle.onClose(event)),
    hide: vi.fn(),
    webContents: { isDestroyed: () => destroyed, send: vi.fn(), setBackgroundThrottling: vi.fn() },
  };
  const lifecycle = createAppWindowClose(win);
  return { win, lifecycle, event, destroy: () => { destroyed = true; } };
}

describe('native retained editor close', () => {
  it('routes an OS close through renderer confirmation and keeps the native document alive when hidden', () => {
    const { win, lifecycle, event } = setup();
    expect(lifecycle.setRetention(true)).toBe(true);
    win.close();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(win.webContents.send).toHaveBeenCalledWith('vibisual:app:close-requested');
    expect(win.webContents.setBackgroundThrottling).toHaveBeenCalledWith(false);
    expect(win.hide).not.toHaveBeenCalled();
    expect(lifecycle.hide()).toBe(true);
    expect(win.hide).toHaveBeenCalledOnce();
    expect(win.close).toHaveBeenCalledOnce();
  });

  it('allows explicit owner teardown and acknowledged transfer without another human question', () => {
    const { win, lifecycle, event } = setup();
    lifecycle.setRetention(true);
    expect(lifecycle.close()).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.webContents.send).not.toHaveBeenCalled();
    win.close();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('leaves ordinary close behavior intact and rejects destroyed or nonretained hides', () => {
    const { win, lifecycle, event, destroy } = setup();
    expect(lifecycle.hide()).toBe(false);
    win.close(); expect(event.preventDefault).not.toHaveBeenCalled();
    lifecycle.setRetention(true); lifecycle.setRetention(false);
    expect(win.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    win.close(); expect(event.preventDefault).not.toHaveBeenCalled();
    destroy();
    expect(lifecycle.setRetention(true)).toBe(false);
    expect(lifecycle.close()).toBe(false);
    expect(lifecycle.hide()).toBe(false);
  });
});
