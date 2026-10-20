import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectShellImmersive, useProjectImmersionStore } from '../stores/projectImmersion.js';
import { useImmersiveWindow } from './useImmersiveWindow.js';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class TestDocument extends EventTarget {
  fullscreenElement: object | null = null;
  documentElement = {
    requestFullscreen: vi.fn<() => Promise<void>>(() => {
      this.change(this.documentElement);
      return Promise.resolve();
    }),
  };
  exitFullscreen = vi.fn<() => Promise<void>>(() => {
    this.change(null);
    return Promise.resolve();
  });
  change(element: object | null): void {
    this.fullscreenElement = element;
    this.dispatchEvent(new Event('fullscreenchange'));
  }
}

function nativeApi() {
  const listeners = new Set<(state: { immersive: boolean }) => void>();
  const off = vi.fn((): void => { listeners.clear(); });
  const api = {
    setImmersiveSelf: vi.fn<(enabled: boolean) => Promise<void>>().mockResolvedValue(undefined),
    onImmersiveState: vi.fn((callback: (state: { immersive: boolean }) => void) => {
      listeners.add(callback);
      return off;
    }),
  };
  vi.stubGlobal('window', { api: { window: api } });
  return {
    ...api,
    off,
    emit(immersive: boolean): void {
      for (const callback of listeners) callback({ immersive });
    },
  };
}

let renderer: ReactTestRenderer | undefined;
let doc: TestDocument;

function Probe(): null {
  useImmersiveWindow(useProjectImmersionStore(selectShellImmersive));
  return null;
}
async function render(): Promise<void> {
  await act(async () => { renderer = create(<Probe />); });
}
async function enter(): Promise<void> {
  await act(async () => { useProjectImmersionStore.getState().toggle('project-a'); });
}
async function exit(): Promise<void> {
  await act(async () => { useProjectImmersionStore.getState().exit(); });
}
async function unmount(): Promise<void> {
  await act(async () => { renderer?.unmount(); });
  renderer = undefined;
}
function immersive(): boolean {
  return selectShellImmersive(useProjectImmersionStore.getState());
}

beforeEach(() => {
  useProjectImmersionStore.getState().exit();
  doc = new TestDocument();
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', doc);
});
afterEach(async () => {
  await unmount();
  useProjectImmersionStore.getState().exit();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('native immersive window connection', () => {
  it('sends initial restoration, entry and exit to the native window without browser fullscreen', async () => {
    const native = nativeApi();
    await render();
    await enter();
    await exit();
    expect(native.setImmersiveSelf.mock.calls).toEqual([[false], [true], [false]]);
    expect(native.onImmersiveState).toHaveBeenCalledTimes(1);
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it('clears both project and IDE immersion after an external native exit', async () => {
    const native = nativeApi();
    await render();
    await enter();
    await act(async () => { useProjectImmersionStore.getState().enterIDE('project-a', 'pane-a'); });
    await act(async () => { native.emit(false); });
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(native.setImmersiveSelf).toHaveBeenLastCalledWith(false);
  });

  it('does not let a pending old false notification cancel a newer successful entry', async () => {
    const native = nativeApi();
    await render();
    const request = deferred();
    native.setImmersiveSelf.mockImplementationOnce(() => request.promise);
    await enter();
    act(() => { native.emit(false); });
    expect(immersive()).toBe(true);
    await act(async () => { native.emit(true); request.resolve(); });
    expect(immersive()).toBe(true);
    await act(async () => { native.emit(false); });
    expect(immersive()).toBe(false);
  });

  it('applies an external exit that arrived before the entry request settled', async () => {
    const native = nativeApi();
    await render();
    const request = deferred();
    native.setImmersiveSelf.mockImplementationOnce(() => request.promise);
    await enter();
    act(() => { native.emit(false); });
    await act(async () => { request.resolve(); });
    expect(immersive()).toBe(false);
    expect(native.setImmersiveSelf).toHaveBeenLastCalledWith(false);
  });

  it('ignores a failed old request after a newer entry has begun', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const native = nativeApi();
    await render();
    const oldRequest = deferred();
    native.setImmersiveSelf.mockImplementationOnce(() => oldRequest.promise);
    await enter();
    await exit();
    const currentRequest = deferred();
    native.setImmersiveSelf.mockImplementationOnce(() => currentRequest.promise);
    await enter();
    await act(async () => { oldRequest.reject(new Error('old entry rejected')); });
    expect(immersive()).toBe(true);
    await act(async () => { native.emit(true); currentRequest.resolve(); });
    expect(immersive()).toBe(true);
  });

  it('restores the shell when the current native entry fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const native = nativeApi();
    await render();
    native.setImmersiveSelf.mockRejectedValueOnce(new Error('fullscreen unavailable'));
    await enter();
    expect(immersive()).toBe(false);
    expect(native.setImmersiveSelf).toHaveBeenLastCalledWith(false);
  });

  it('unsubscribes and restores the native window on unmount', async () => {
    const native = nativeApi();
    await render();
    await enter();
    await unmount();
    expect(native.off).toHaveBeenCalledTimes(1);
    expect(native.setImmersiveSelf).toHaveBeenLastCalledWith(false);
    native.emit(false);
    expect(immersive()).toBe(true);
  });
});

describe('browser immersive window fallback', () => {
  it('enters root fullscreen and restores it on normal immersion exit', async () => {
    await render();
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    await enter();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(doc.fullscreenElement).toBe(doc.documentElement);
    await exit();
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(doc.fullscreenElement).toBeNull();
  });

  it('uses browser fullscreen when an older preload has no immersive method', async () => {
    vi.stubGlobal('window', { api: { window: {} } });
    await render();
    await enter();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    await exit();
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it.each(['root', 'other element'])('preserves fullscreen already owned by %s', async (owner) => {
    const original = owner === 'root' ? doc.documentElement : {};
    doc.fullscreenElement = original;
    await render();
    await enter();
    await exit();
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    expect(doc.fullscreenElement).toBe(original);
  });

  it('clears immersion after the browser exits fullscreen externally', async () => {
    await render();
    await enter();
    await act(async () => { doc.change(null); });
    expect(immersive()).toBe(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it('does not exit a different fullscreen element that took over during immersion', async () => {
    await render();
    await enter();
    const video = {};
    doc.change(video);
    await exit();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    expect(doc.fullscreenElement).toBe(video);
  });

  it('restores a late fullscreen grant when immersion exited while the request was pending', async () => {
    const request = deferred();
    doc.documentElement.requestFullscreen.mockImplementationOnce(() => request.promise);
    await render();
    await enter();
    await exit();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    await act(async () => { doc.change(doc.documentElement); request.resolve(); });
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(doc.fullscreenElement).toBeNull();
    expect(immersive()).toBe(false);
  });

  it('keeps ownership across re-entry between a late fullscreen event and its promise completion', async () => {
    const request = deferred();
    doc.documentElement.requestFullscreen.mockImplementationOnce(() => request.promise);
    await render();
    await enter();
    await exit();
    // The browser reports the grant before fulfilling its asynchronous request.
    // The new effect must inherit this owned root fullscreen, not treat it as
    // fullscreen that existed independently before the whole immersive session.
    doc.change(doc.documentElement);
    await enter();
    await act(async () => { request.resolve(); });
    expect(immersive()).toBe(true);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
    await exit();
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(doc.fullscreenElement).toBeNull();
  });

  it('restores owned fullscreen and removes its listener on unmount', async () => {
    const remove = vi.spyOn(doc, 'removeEventListener');
    await render();
    await enter();
    await unmount();
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));
    // Hook cleanup only restores native/browser state; shell store lifecycle is
    // owned by useProjectImmersion. A removed listener cannot clear the store.
    expect(immersive()).toBe(true);
  });

  it('restores a late fullscreen grant after the last hook unmounts', async () => {
    const request = deferred();
    doc.documentElement.requestFullscreen.mockImplementationOnce(() => request.promise);
    await render();
    await enter();
    await unmount();
    await act(async () => { doc.change(doc.documentElement); request.resolve(); });
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(doc.fullscreenElement).toBeNull();
  });

  it('restores shell controls when the current browser request is rejected', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    doc.documentElement.requestFullscreen.mockRejectedValueOnce(new Error('user activation required'));
    await render();
    await enter();
    expect(immersive()).toBe(false);
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });

  it('ignores a rejected browser request from an earlier immersion session', async () => {
    const oldRequest = deferred();
    doc.documentElement.requestFullscreen.mockImplementationOnce(() => oldRequest.promise);
    await render();
    await enter();
    await exit();
    await enter();
    await act(async () => { oldRequest.reject(new Error('old request rejected')); });
    expect(immersive()).toBe(true);
    expect(doc.fullscreenElement).toBe(doc.documentElement);
  });
});
