import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppWindowListWire, PackagedAppApi } from '../transport/install-packaged-transport.js';
import { useAppWindowsStore } from './appWindows.js';
import { INTERNAL_APPS } from './registry.js';
import { receiveAppWindow, subscribeAppWindowDragRelease, subscribeOutsideAppWindows } from './useAppWindowRedock.js';

function appApi(overrides: Partial<PackagedAppApi> = {}): PackagedAppApi {
  return {
    open: vi.fn(async () => ({ windowId: 1, reused: false })),
    close: vi.fn(async () => true),
    invoke: vi.fn(async () => undefined),
    onShowTarget: vi.fn(() => () => undefined),
    ackRedock: vi.fn(async () => true),
    ...overrides,
  };
}

describe('receiving an app window back in the workspace', () => {
  beforeEach(() => { useAppWindowsStore.setState({ windows: [] }); });

  it.each(INTERNAL_APPS)('restores $id using its declared document key before acknowledging', (app) => {
    const geometry = { x: 250, y: 110, w: 920, h: 640 };
    const expected = { appId: app.id, projectId: 'C:/project', ref: 'current-doc', file: 'media/current.file', title: 'Current edit', geometry };
    const ackRedock = vi.fn(async () => {
      expect(useAppWindowsStore.getState().windows).toHaveLength(1);
      expect(useAppWindowsStore.getState().windows[0]).toMatchObject(expected);
      return true;
    });
    const api = appApi({ ackRedock });

    expect(receiveAppWindow(api, {
      requestId: `redock-${app.id}`, appId: app.id, geometry,
      params: { projectId: 'C:/project', [app.refKey]: 'current-doc', file: 'media/current.file', _windowTitle: 'Current edit' },
    })).toBe(true);
    expect(useAppWindowsStore.getState().windows[0]).toMatchObject(expected);
    expect(ackRedock).toHaveBeenCalledExactlyOnceWith(`redock-${app.id}`);
  });

  it.each<{ name: string; appId: string; params: Record<string, string> }>([
    { name: 'unknown app', appId: 'unknown', params: { projectId: 'C:/project' } },
    { name: 'missing project', appId: INTERNAL_APPS[0]!.id, params: {} },
    { name: 'empty project', appId: INTERNAL_APPS[0]!.id, params: { projectId: '' } },
  ])('does not open or acknowledge $name', ({ appId, params }) => {
    const api = appApi();
    expect(receiveAppWindow(api, { requestId: 'invalid', appId, params })).toBe(false);
    expect(useAppWindowsStore.getState().windows).toEqual([]);
    expect(api.ackRedock).not.toHaveBeenCalled();
  });

  it('keeps the source responsible when the receiver cannot acknowledge', () => {
    const api = appApi();
    delete api.ackRedock;
    expect(receiveAppWindow(api, { requestId: 'legacy', appId: INTERNAL_APPS[0]!.id, params: { projectId: 'C:/project' } })).toBe(false);
    expect(useAppWindowsStore.getState().windows).toEqual([]);
  });

  it('focuses an existing matching window instead of duplicating it on repeated delivery', () => {
    const app = INTERNAL_APPS[0]!;
    const api = appApi();
    const payload = { requestId: 'same-request', appId: app.id, params: { projectId: 'C:/project', [app.refKey]: 'doc-1' } };
    expect(receiveAppWindow(api, payload)).toBe(true);
    const firstId = useAppWindowsStore.getState().windows[0]!.id;
    expect(receiveAppWindow(api, payload)).toBe(true);
    expect(useAppWindowsStore.getState().windows).toHaveLength(1);
    expect(useAppWindowsStore.getState().windows[0]!.id).toBe(firstId);
  });

  it('keeps the restored window if acknowledgement fails', async () => {
    const api = appApi({ ackRedock: vi.fn(async () => { throw new Error('Receiver disconnected'); }) });
    expect(receiveAppWindow(api, { requestId: 'ack-failed', appId: INTERNAL_APPS[0]!.id, params: { projectId: 'C:/project' } })).toBe(true);
    await Promise.resolve();
    expect(useAppWindowsStore.getState().windows).toHaveLength(1);
  });
});

describe('cross-window drag release', () => {
  const cleanups: Array<() => void> = [];
  let events: EventTarget;
  let updateDrag!: Parameters<NonNullable<PackagedAppApi['onDragState']>>[0];
  const unsubscribe = vi.fn();

  beforeEach(() => {
    events = new EventTarget();
    // Node 22 does not remove capture listeners when passed the browser's boolean shorthand.
    vi.stubGlobal('window', {
      addEventListener: (type: string, callback: EventListener, capture: boolean) => {
        events.addEventListener(type, callback, { capture });
      },
      removeEventListener: (type: string, callback: EventListener, capture: boolean) => {
        events.removeEventListener(type, callback, { capture });
      },
    });
    unsubscribe.mockClear();
  });
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.unstubAllGlobals();
  });

  function subscribe(): PackagedAppApi {
    const api = appApi({
      endDrag: vi.fn(async () => true),
      onDragState: callback => { updateDrag = callback; return unsubscribe; },
    });
    cleanups.push(subscribeAppWindowDragRelease(api));
    return api;
  }

  function mouseup(button = 0): void {
    events.dispatchEvent(Object.assign(new Event('mouseup'), { button }));
  }

  it('commits only an active left-button release, once', () => {
    const api = subscribe();
    mouseup();
    expect(api.endDrag).not.toHaveBeenCalled();
    updateDrag({ appId: 'vibistudio', dragging: true, armed: true });
    mouseup(2);
    expect(api.endDrag).not.toHaveBeenCalled();
    mouseup();
    mouseup();
    expect(api.endDrag).toHaveBeenCalledExactlyOnceWith(undefined, 'vibistudio');
  });

  it('cancels an active drag with Escape and ignores the subsequent release', () => {
    const api = subscribe();
    updateDrag({ appId: 'vibisound', dragging: true, armed: false });
    const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    events.dispatchEvent(escape);
    mouseup();
    expect(escape.defaultPrevented).toBe(true);
    expect(api.endDrag).toHaveBeenCalledExactlyOnceWith(false, 'vibisound');
  });

  it('ignores releases after the desktop ends a drag and removes all listeners on cleanup', () => {
    const api = subscribe();
    updateDrag({ appId: 'vibi3d', dragging: true, armed: false });
    updateDrag({ appId: 'vibi3d', dragging: false, armed: false });
    mouseup();
    expect(api.endDrag).not.toHaveBeenCalled();

    updateDrag({ appId: 'vibi3d', dragging: true, armed: false });
    cleanups.pop()!();
    mouseup();
    events.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    expect(api.endDrag).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

// §5.13 (S-11) — main 이 든 "밖에 떠 있는 앱 창" 목록을 이 창의 store 에 비춘다. 이 목록이 있어야 그 문서를 다시 열 때
//   앱 안에 한 벌 더 세우지 않고 밖의 그 창을 앞으로 세운다.
describe('outside app window list mirror', () => {
  const app = INTERNAL_APPS[0]!;
  beforeEach(() => { useAppWindowsStore.setState({ windows: [], outside: [] }); });
  afterEach(() => {
    useAppWindowsStore.setState({ windows: [], outside: [] });
    vi.unstubAllGlobals();
  });

  it('maps each app’s declared document key and follows every push until unsubscribed', () => {
    let push!: (list: AppWindowListWire) => void;
    const off = vi.fn();
    const api = appApi({
      list: vi.fn(() => new Promise<AppWindowListWire>(() => undefined)),
      onList: (callback) => { push = callback; return off; },
    });
    const unsubscribe = subscribeOutsideAppWindows(api);
    push([{ windowId: 4, appId: app.id, params: { projectId: 'C:/project', [app.refKey]: 'doc-1', _windowTitle: 'Demo' } }]);
    expect(useAppWindowsStore.getState().outside).toEqual([{ windowId: 4, appId: app.id, projectId: 'C:/project', ref: 'doc-1' }]);
    push([]);
    expect(useAppWindowsStore.getState().outside).toEqual([]);
    unsubscribe();
    expect(off).toHaveBeenCalledOnce();
  });

  it('fills the list from the first answer, but a late answer never overwrites a newer push', async () => {
    let answer!: (list: AppWindowListWire) => void;
    let push!: (list: AppWindowListWire) => void;
    subscribeOutsideAppWindows(appApi({
      list: vi.fn(() => new Promise<AppWindowListWire>((done) => { answer = done; })),
      onList: (callback) => { push = callback; return () => undefined; },
    }));
    push([]);
    answer([{ windowId: 4, appId: app.id, params: { projectId: 'C:/project' } }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 방금 닫힌 창을 "떠 있다"로 되살리지 않는다.
    expect(useAppWindowsStore.getState().outside).toEqual([]);

    subscribeOutsideAppWindows(appApi({
      list: vi.fn(async () => [{ windowId: 5, appId: app.id, params: { projectId: 'C:/project' } }]),
      onList: () => () => undefined,
    }));
    await vi.waitFor(() => {
      expect(useAppWindowsStore.getState().outside).toEqual([{ windowId: 5, appId: app.id, projectId: 'C:/project' }]);
    });
  });

  it('brings a window back inside even while the closing outside window is still listed', () => {
    const focus = vi.fn(async () => true);
    vi.stubGlobal('window', { api: { app: { open: vi.fn(), focus } } });
    useAppWindowsStore.setState({ outside: [{ windowId: 4, appId: app.id, projectId: 'C:/project', ref: 'doc-1' }] });
    expect(receiveAppWindow(appApi(), {
      requestId: 'back', appId: app.id, params: { projectId: 'C:/project', [app.refKey]: 'doc-1' },
    })).toBe(true);
    expect(focus).not.toHaveBeenCalled();
    expect(useAppWindowsStore.getState().windows).toHaveLength(1);
  });
});
