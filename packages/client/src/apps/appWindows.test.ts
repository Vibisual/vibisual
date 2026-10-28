import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { canPopOutAppWindow, openAppWindow, useAppWindowsStore } from './appWindows.js';
import { INTERNAL_APPS, appShellParams } from './registry.js';
import { registerAppWindowTransferGuard } from './appWindowTransfer.js';

/** §5.13 (S) — 앱 안 창 먼저, 꺼낼 때만 밖: ① 두 번 열어도 창 하나 ② 꺼내면 `InternalApp.open()` 을 지나고 앱 안 창은 닫힌다 ③ 미등록 앱은 열지 않는다(다른 길로 가게). */

const APP = INTERNAL_APPS[0]!;
const PROJECT = 'C:/proj';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function reset(): void {
  useAppWindowsStore.setState({ windows: [], outside: [] });
}

describe('앱 안 창 store', () => {
  beforeEach(reset);
  it('reopens the same source-less draft without merging two different new models', () => {
    const appId = 'vibi3d';
    openAppWindow({ appId, projectId: PROJECT, draftKey: 'local:first' });
    const first = useAppWindowsStore.getState().windows[0]!;
    openAppWindow({ appId, projectId: PROJECT, draftKey: 'local:second' });
    openAppWindow({ appId, projectId: PROJECT, draftKey: 'local:first' });
    expect(useAppWindowsStore.getState().windows).toHaveLength(2);
    expect(useAppWindowsStore.getState().windows[0]?.id).toBe(first.id);
  });

  it('열면 창이 하나 선다', () => {
    expect(openAppWindow({ appId: APP.id, projectId: PROJECT })).toBe(true);
    const windows = useAppWindowsStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]?.appId).toBe(APP.id);
  });

  it('같은 것을 또 열면 두 벌이 되지 않고 앞으로 온다', () => {
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' });
    const first = useAppWindowsStore.getState().windows[0]!;
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1', title: '내 영상' });

    const windows = useAppWindowsStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]?.id).toBe(first.id);
    // 이름은 최신 것으로 — 버블 이름을 바꾼 뒤 다시 열었을 때 옛 이름이 남지 않게.
    expect(windows[0]?.title).toBe('내 영상');
    expect(windows[0]?.focusAt).toBeGreaterThanOrEqual(first.focusAt);
  });

  it('prepares one background editor and reveals that same editor only on an explicit open', () => {
    const args = { appId: APP.id, projectId: PROJECT, ref: 'doc-1' };
    expect(openAppWindow(args, { background: true })).toBe(true);
    const prepared = useAppWindowsStore.getState().windows[0]!;
    expect(prepared).toMatchObject({ background: true, focusAt: 0 });
    openAppWindow(args, { background: true });
    expect(useAppWindowsStore.getState().windows).toEqual([prepared]);

    openAppWindow({ ...args, title: 'My model' });
    expect(useAppWindowsStore.getState().windows).toHaveLength(1);
    expect(useAppWindowsStore.getState().windows[0]).toMatchObject({ id: prepared.id, background: false, title: 'My model' });
    expect(useAppWindowsStore.getState().windows[0]?.focusAt).toBeGreaterThan(0);
  });

  it('leaves an already visible editor and its focus unchanged during background preparation', () => {
    const args = { appId: APP.id, projectId: PROJECT, ref: 'doc-1' };
    openAppWindow({ ...args, title: 'Current work' });
    const visible = useAppWindowsStore.getState().windows[0]!;
    openAppWindow(args, { background: true });
    expect(useAppWindowsStore.getState().windows[0]).toBe(visible);
    expect(visible.background).not.toBe(true);
  });

  it('reuses the prepared document when its bubble still carries the original import file', () => {
    const args = { appId: APP.id, projectId: PROJECT, ref: 'doc-1' };
    openAppWindow(args, { background: true });
    const prepared = useAppWindowsStore.getState().windows[0]!;
    openAppWindow({ ...args, file: 'original.glb', bubbleId: 'bubble-1' });
    expect(useAppWindowsStore.getState().windows).toHaveLength(1);
    expect(useAppWindowsStore.getState().windows[0]).toMatchObject({ id: prepared.id, background: false, bubbleId: 'bubble-1' });
    expect(useAppWindowsStore.getState().windows[0]?.file).toBeUndefined();
    openAppWindow({ ...args, file: 'original.glb', bubbleId: 'bubble-1' });
    expect(useAppWindowsStore.getState().windows).toHaveLength(1);
    expect(useAppWindowsStore.getState().windows[0]?.id).toBe(prepared.id);
  });

  it('does not duplicate a visible document whose exported file differs from background preparation', () => {
    const args = { appId: APP.id, projectId: PROJECT, ref: 'doc-1' };
    openAppWindow({ ...args, file: 'exported.glb' });
    const visible = useAppWindowsStore.getState().windows[0]!;
    openAppWindow(args, { background: true });
    expect(useAppWindowsStore.getState().windows).toEqual([visible]);
  });

  it('does not focus or duplicate an outside editor during background preparation', () => {
    const focus = vi.fn();
    vi.stubGlobal('window', { api: { app: { focus } } });
    try {
      useAppWindowsStore.setState({ outside: [{ windowId: 4, appId: APP.id, projectId: PROJECT, ref: 'doc-1', file: 'exported.glb' }] });
      expect(openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' }, { background: true })).toBe(true);
      expect(focus).not.toHaveBeenCalled();
      expect(useAppWindowsStore.getState().windows).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });

  it('reveals the existing outside document even when the source bubble retains its old import file', async () => {
    const focus = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('window', { api: { app: { focus } } });
    try {
      useAppWindowsStore.setState({ outside: [{ windowId: 4, appId: APP.id, projectId: PROJECT, ref: 'doc-1', file: 'exported.glb' }] });
      expect(openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1', file: 'original.glb' })).toBe(true);
      await Promise.resolve();
      expect(focus).toHaveBeenCalledWith(APP.id, 4);
      expect(useAppWindowsStore.getState().windows).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });

  it('가리키는 것이 다르면 창도 다르다', () => {
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' });
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-2' });
    openAppWindow({ appId: APP.id, projectId: PROJECT, file: 'a/b.mp4' });
    expect(useAppWindowsStore.getState().windows).toHaveLength(3);
  });

  it('등록되지 않은 앱은 열지 않는다 — 부르는 쪽이 다른 길로 갈 수 있어야 한다', () => {
    expect(openAppWindow({ appId: 'nope', projectId: PROJECT })).toBe(false);
    expect(useAppWindowsStore.getState().windows).toHaveLength(0);
  });

  it('닫으면 그 창만 사라진다', () => {
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' });
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-2' });
    const first = useAppWindowsStore.getState().windows[0]!;
    useAppWindowsStore.getState().close(first.id);
    const windows = useAppWindowsStore.getState().windows;
    expect(windows).toHaveLength(1);
    expect(windows[0]?.ref).toBe('doc-2');
  });
});

describe('밖으로 꺼내기', () => {
  const cleanups: Array<() => void> = [];
  beforeEach(reset);
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
  });
  it('keeps a saved editor quiesced while native open is pending and releases only when open fails', async () => {
    const native = deferred<boolean>(); const release = vi.fn();
    vi.spyOn(APP, 'open').mockReturnValue(native.promise);
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'held-doc' });
    const win = useAppWindowsStore.getState().windows[0]!;
    cleanups.push(registerAppWindowTransferGuard(win.id, async () => true, release));
    const transfer = useAppWindowsStore.getState().popOut(win.id);
    await Promise.resolve(); await Promise.resolve(); expect(release).not.toHaveBeenCalled();
    native.resolve(false); expect(await transfer).toBe(false); expect(release).toHaveBeenCalledOnce();
    expect(useAppWindowsStore.getState().windows[0]?.id).toBe(win.id);
  });
  it('passes the most recently saved local draft identity through native open and shell params', async () => {
    const app = INTERNAL_APPS.find(item => item.id === 'vibi3d')!;
    const open = vi.spyOn(app, 'open').mockResolvedValue(true);
    openAppWindow({ appId: app.id, projectId: PROJECT });
    const win = useAppWindowsStore.getState().windows[0]!;
    const draftKey = 'local:12345678-1234-4234-8234-123456789abc';
    useAppWindowsStore.getState().updateTarget(win.id, { draftKey });
    expect(await useAppWindowsStore.getState().popOut(win.id)).toBe(true);
    expect(open).toHaveBeenCalledWith({ projectId: PROJECT, ref: undefined, file: undefined, draftKey });
    expect(appShellParams(app, open.mock.calls[0]![0])).toEqual({ projectId: PROJECT, draftKey });
  });

  it('편집 화면에서 고른 최신 문서로 별도 창을 연다', async () => {
    const open = vi.spyOn(APP, 'open').mockResolvedValue(true);
    openAppWindow({ appId: APP.id, projectId: PROJECT, file: 'old.wav' });
    const win = useAppWindowsStore.getState().windows[0]!;
    useAppWindowsStore.getState().updateReference(win.id, 'current-doc');
    expect(await useAppWindowsStore.getState().popOut(win.id)).toBe(true);
    expect(open).toHaveBeenCalledWith({ projectId: PROJECT, ref: 'current-doc', file: undefined });
  });

  it('종전의 OS 창 경로를 그대로 지나고, 앱 안 창은 닫힌다', async () => {
    const open = vi.spyOn(APP, 'open').mockResolvedValue(true);
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1', file: 'a/b.mp4' });
    const win = useAppWindowsStore.getState().windows[0]!;

    expect(await useAppWindowsStore.getState().popOut(win.id)).toBe(true);

    expect(open).toHaveBeenCalledWith({ projectId: PROJECT, ref: 'doc-1', file: 'a/b.mp4' });
    expect(useAppWindowsStore.getState().windows).toHaveLength(0);
  });

  it('없는 창을 꺼내라고 해도 아무 일도 하지 않는다', async () => {
    const open = vi.spyOn(APP, 'open').mockResolvedValue(true);
    expect(await useAppWindowsStore.getState().popOut('appwin-없음')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['refused', 'rejected'] as const)('keeps the source window when opening is %s and allows retry', async (failure) => {
    const open = vi.spyOn(APP, 'open');
    if (failure === 'refused') open.mockResolvedValueOnce(false);
    else open.mockRejectedValueOnce(new Error('Native window unavailable'));
    open.mockResolvedValueOnce(true);
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'unsaved-doc', title: 'Current work' });
    const original = useAppWindowsStore.getState().windows[0]!;

    expect(await useAppWindowsStore.getState().popOut(original.id)).toBe(false);
    expect(useAppWindowsStore.getState().windows).toEqual([original]);
    expect(await useAppWindowsStore.getState().popOut(original.id)).toBe(true);
    expect(open).toHaveBeenCalledTimes(2);
    expect(useAppWindowsStore.getState().windows).toEqual([]);
  });

  it('keeps the source while saving and opening, ignores duplicate attempts, and uses the saved target', async () => {
    const save = deferred<boolean>();
    const target = deferred<boolean>();
    const open = vi.spyOn(APP, 'open').mockReturnValue(target.promise);
    openAppWindow({ appId: APP.id, projectId: PROJECT, file: 'draft.wav', title: 'My draft' });
    const original = useAppWindowsStore.getState().windows[0]!;
    const guard = vi.fn(() => save.promise);
    cleanups.push(registerAppWindowTransferGuard(original.id, guard));
    const placement = { x: 240, y: 80, width: 960, height: 640 };

    const pending = useAppWindowsStore.getState().popOut(original.id, placement);
    expect(useAppWindowsStore.getState().windows).toEqual([original]);
    expect(open).not.toHaveBeenCalled();
    expect(await useAppWindowsStore.getState().popOut(original.id)).toBe(false);
    expect(guard).toHaveBeenCalledTimes(1);

    useAppWindowsStore.getState().updateReference(original.id, 'saved-doc');
    save.resolve(true);
    await vi.waitFor(() => { expect(open).toHaveBeenCalledTimes(1); });
    expect(open).toHaveBeenCalledWith({ projectId: PROJECT, ref: 'saved-doc', file: undefined, title: 'My draft', placement });
    expect(useAppWindowsStore.getState().windows).toHaveLength(1);
    expect(await useAppWindowsStore.getState().popOut(original.id)).toBe(false);

    target.resolve(true);
    expect(await pending).toBe(true);
    expect(useAppWindowsStore.getState().windows).toEqual([]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each(['refused', 'rejected'] as const)('preserves the source when the save guard is %s', async (failure) => {
    const open = vi.spyOn(APP, 'open').mockResolvedValue(true);
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'unsaved-doc' });
    const original = useAppWindowsStore.getState().windows[0]!;
    const guard = failure === 'refused'
      ? async (): Promise<boolean> => false
      : async (): Promise<boolean> => { throw new Error('Save failed'); };
    const unregister = registerAppWindowTransferGuard(original.id, guard);
    cleanups.push(unregister);

    expect(await useAppWindowsStore.getState().popOut(original.id)).toBe(false);
    expect(useAppWindowsStore.getState().windows).toEqual([original]);
    expect(open).not.toHaveBeenCalled();
    unregister();
    expect(await useAppWindowsStore.getState().popOut(original.id)).toBe(true);
  });

  it('does not reopen a source closed while its save guard was pending', async () => {
    const save = deferred<boolean>();
    const open = vi.spyOn(APP, 'open').mockResolvedValue(true);
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' });
    const original = useAppWindowsStore.getState().windows[0]!;
    cleanups.push(registerAppWindowTransferGuard(original.id, () => save.promise));

    const pending = useAppWindowsStore.getState().popOut(original.id);
    useAppWindowsStore.getState().close(original.id);
    save.resolve(true);
    expect(await pending).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(useAppWindowsStore.getState().windows).toEqual([]);
  });
});

// §5.13 (S-11) — 이미 밖에 떠 있는 문서를 다시 열면 그 창을 앞으로 세운다(IDE (H-13) 과 같다). 그 사이 닫혔으면 앱 안에 연다.
describe('이미 밖에 떠 있는 문서를 다시 열면 — 포커싱', () => {
  beforeEach(() => {
    reset();
    useAppWindowsStore.setState({ outside: [{ windowId: 7, appId: APP.id, projectId: PROJECT, ref: 'doc-1' }] });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('앱 안에 한 벌 더 세우지 않고 밖의 그 창을 앞으로 세운다', async () => {
    const focus = vi.fn(async () => true);
    vi.stubGlobal('window', { api: { app: { open: vi.fn(), focus } } });

    expect(openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1', title: '내 영상' })).toBe(true);
    expect(focus).toHaveBeenCalledExactlyOnceWith(APP.id, 7);
    await Promise.resolve();
    expect(useAppWindowsStore.getState().windows).toEqual([]);
  });

  it.each(['gone', 'failed'] as const)('밖의 창이 그 사이 사라졌으면(%s) 종전대로 앱 안에 연다', async (outcome) => {
    const focus = outcome === 'gone' ? vi.fn(async () => false) : vi.fn(async () => { throw new Error('closed'); });
    vi.stubGlobal('window', { api: { app: { open: vi.fn(), focus } } });

    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' });
    await vi.waitFor(() => { expect(useAppWindowsStore.getState().windows).toHaveLength(1); });
    expect(useAppWindowsStore.getState().windows[0]).toMatchObject({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' });
  });

  it('다른 문서·되돌아오는 길·세울 수 없는 판은 종전대로 곧바로 앱 안에 연다', () => {
    const focus = vi.fn(async () => true);
    vi.stubGlobal('window', { api: { app: { open: vi.fn(), focus } } });
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-2' });
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' }, { redock: true });
    expect(focus).not.toHaveBeenCalled();
    expect(useAppWindowsStore.getState().windows.map((w) => w.ref)).toEqual(['doc-2', 'doc-1']);

    reset();
    useAppWindowsStore.setState({ outside: [{ windowId: 7, appId: APP.id, projectId: PROJECT, ref: 'doc-1' }] });
    vi.stubGlobal('window', { api: { app: { open: vi.fn() } } });
    openAppWindow({ appId: APP.id, projectId: PROJECT, ref: 'doc-1' });
    expect(useAppWindowsStore.getState().windows).toHaveLength(1);
  });
});

describe('꺼낼 수 있는 판인가', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('브라우저가 아닌 판(서버 렌더·테스트)에서도 터지지 않는다', () => {
    expect(canPopOutAppWindow()).toBe(false);
  });

  it('창을 못 여는 판에서는 손짓·손잡이를 띄우지 않는다', () => {
    vi.stubGlobal('window', {});
    expect(canPopOutAppWindow()).toBe(false);
  });

  it('데스크톱 렌더러면 꺼낼 수 있다', () => {
    vi.stubGlobal('window', { api: { app: { open: (): void => undefined } } });
    expect(canPopOutAppWindow()).toBe(true);
  });
});
