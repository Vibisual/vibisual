import { createElement, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetachedAppWindow } from './DetachedAppWindow.js';
import { AppShellHost } from './AppShellHost.js';
import { WindowControls } from '../components/Layout/WindowControls.js';
import type { AppHash } from './appHash.js';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(), redock: vi.fn(), startDrag: vi.fn(), endDrag: vi.fn(), maximize: vi.fn(), ackTarget: vi.fn(),
  subscribeDrag: vi.fn(), offDrag: vi.fn(), offTarget: vi.fn(), hostSequence: 0,
  showTarget: null as ((payload: { appId: string; hash: string; requestId?: string }) => void) | null,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./registry.js', () => ({ getInternalApp: (id: string) => ({ id, name: 'Editor' }) }));
vi.mock('./appWindowTransfer.js', () => ({ prepareAppWindowTransfer: mocks.prepare }));
vi.mock('./useAppWindowRedock.js', () => ({ subscribeAppWindowDragRelease: mocks.subscribeDrag }));
vi.mock('../components/Layout/WindowControls.js', () => ({ WindowControls: () => null }));
vi.mock('./AppShellHost.js', () => ({ AppShellHost: ({ hash }: { hash: AppHash }) => {
  const [instance] = useState(() => ++mocks.hostSequence);
  return createElement('div', { 'data-host-instance': instance, 'data-host-target': JSON.stringify(hash) });
} }));

let view: ReactTestRenderer | undefined;
const initial: AppHash = { appId: 'vibi3d', mode: 'main', params: { projectId: '/project', file: 'first.glb', _windowTitle: 'My model' } };
let listeners: Map<string, Set<(event: unknown) => void>>;
function mount(hash = initial): void { view = create(createElement(DetachedAppWindow, { initial: hash })); }
function titlebar() { return view!.root.findByProps({ 'data-app-window-titlebar': '' }); }
function mergeButton() { return view!.root.findByProps({ title: 'panel.apps.window.redock' }); }
function emit(type: string, event: unknown): void { for (const callback of [...listeners.get(type) ?? []]) callback(event); }
function beginDrag(button = 0, control = false): void {
  titlebar().props.onMouseDown({ button, clientX: 10, clientY: 10, target: { closest: () => control ? {} : null }, preventDefault: vi.fn() });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.hostSequence = 0; mocks.showTarget = null; listeners = new Map();
  mocks.prepare.mockReset().mockResolvedValue(true); mocks.redock.mockReset().mockResolvedValue(true);
  mocks.startDrag.mockReset().mockResolvedValue(true); mocks.endDrag.mockResolvedValue(true);
  mocks.ackTarget.mockReset().mockResolvedValue(true);
  mocks.subscribeDrag.mockReturnValue(mocks.offDrag);
  vi.stubGlobal('window', {
    api: { app: { redock: mocks.redock, startDrag: mocks.startDrag, endDrag: mocks.endDrag, ackTarget: mocks.ackTarget,
      onShowTarget: (callback: typeof mocks.showTarget) => { mocks.showTarget = callback; return mocks.offTarget; } },
      window: { toggleMaximizeSelf: mocks.maximize } },
    addEventListener: (type: string, callback: (event: unknown) => void) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(callback); },
    removeEventListener: (type: string, callback: (event: unknown) => void) => listeners.get(type)?.delete(callback),
  });
});
afterEach(() => { act(() => view?.unmount()); view = undefined; vi.unstubAllGlobals(); });

describe('detached internal app chrome and handoff', () => {
  it('renders one native control group and hosts the editor below the custom title', () => {
    act(() => mount());
    expect(view!.root.findAllByType(WindowControls)).toHaveLength(1);
    expect(titlebar().findByType('span').children).toEqual(['My model']);
    expect(view!.root.findByType(AppShellHost).props).toMatchObject({ fill: true, hash: { params: { appWindowHosted: '1', appWindowAppId: 'vibi3d' } } });
    act(() => titlebar().props.onDoubleClick({ target: { closest: () => null } }));
    expect(mocks.maximize).toHaveBeenCalledOnce();
    act(() => titlebar().props.onDoubleClick({ target: { closest: () => ({}) } }));
    expect(mocks.maximize).toHaveBeenCalledOnce();
  });

  it('waits for transfer preparation before merging and disables repeated clicks', async () => {
    const pending = deferred<boolean>(); mocks.prepare.mockReturnValueOnce(pending.promise);
    act(() => mount());
    act(() => mergeButton().props.onClick());
    expect(mergeButton().props.disabled).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledWith('@detached'); expect(mocks.redock).not.toHaveBeenCalled();
    act(() => mergeButton().props.onClick());
    expect(mocks.prepare).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(true); });
    expect(mocks.redock).toHaveBeenCalledOnce();
    expect(view!.root.findAllByProps({ role: 'alert' })).toHaveLength(0);
  });

  it.each(['guard', 'native', 'rejection'] as const)('keeps the editor visible after %s merge failure', async (failure) => {
    if (failure === 'guard') mocks.prepare.mockResolvedValueOnce(false);
    if (failure === 'native') mocks.redock.mockResolvedValueOnce(false);
    if (failure === 'rejection') mocks.redock.mockRejectedValueOnce(new Error('unavailable'));
    act(() => mount());
    await act(async () => { mergeButton().props.onClick(); });
    expect(view!.root.findByProps({ role: 'alert' }).children).toEqual(['panel.apps.window.transferFailed']);
    expect(view!.root.findByType(AppShellHost)).toBeDefined();
    expect(mergeButton().props.disabled).toBe(false);
    if (failure === 'guard') expect(mocks.redock).not.toHaveBeenCalled();
  });

  it('remounts the editor for an acknowledged target in the same app and ignores unrelated targets', async () => {
    act(() => mount());
    expect(mocks.hostSequence).toBe(1);
    await act(async () => mocks.showTarget!({ appId: 'vibi3d', hash: '#app=vibi3d&mode=main&projectId=%2Fother&file=second.glb', requestId: 'next' }));
    expect(mocks.ackTarget).toHaveBeenCalledWith('next', true);
    expect(mocks.hostSequence).toBe(2);
    expect(view!.root.findByType(AppShellHost).props.hash.params).toMatchObject({ projectId: '/other', file: 'second.glb' });
    await act(async () => mocks.showTarget!({ appId: 'vibisound', hash: '#app=vibisound&projectId=%2Fother', requestId: 'other' }));
    expect(mocks.ackTarget).toHaveBeenCalledWith('other', false);
    expect(mocks.hostSequence).toBe(2);
    expect(view!.root.findByType(AppShellHost).props.hash.appId).toBe('vibi3d');
  });

  it('preserves the live editor until its transfer guard accepts the replacement', async () => {
    const pending = deferred<boolean>(); mocks.prepare.mockReturnValueOnce(pending.promise);
    act(() => mount());
    act(() => mocks.showTarget!({ appId: 'vibi3d', hash: '#app=vibi3d&projectId=%2Fother&file=second.glb', requestId: 'next' }));
    expect(mocks.hostSequence).toBe(1); expect(mocks.ackTarget).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(false); });
    expect(mocks.ackTarget).toHaveBeenCalledWith('next', false);
    expect(mocks.hostSequence).toBe(1);
    expect(view!.root.findByType(AppShellHost).props.hash.params.file).toBe('first.glb');
    expect(view!.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
  });

  it('does not remount after a prepared target request expires or the host unmounts', async () => {
    mocks.ackTarget.mockResolvedValueOnce(false);
    act(() => mount());
    await act(async () => mocks.showTarget!({ appId: 'vibi3d', hash: '#app=vibi3d&file=expired.glb', requestId: 'expired' }));
    expect(mocks.hostSequence).toBe(1);
    const pending = deferred<boolean>(); mocks.prepare.mockReturnValueOnce(pending.promise);
    act(() => mocks.showTarget!({ appId: 'vibi3d', hash: '#app=vibi3d&file=late.glb', requestId: 'late' }));
    act(() => view!.unmount()); view = undefined;
    await act(async () => { pending.resolve(true); });
    expect(mocks.ackTarget).toHaveBeenCalledWith('late', false);
    expect(mocks.hostSequence).toBe(1);
  });

  it('starts native dragging only after a primary-button movement crosses the threshold', async () => {
    act(() => mount());
    act(() => beginDrag(2)); expect(listeners.get('mousemove')?.size ?? 0).toBe(0);
    act(() => beginDrag(0, true)); expect(listeners.get('mousemove')?.size ?? 0).toBe(0);
    act(() => beginDrag());
    await act(async () => emit('mousemove', { buttons: 1, clientX: 12, clientY: 12 }));
    expect(mocks.prepare).not.toHaveBeenCalled();
    await act(async () => emit('mousemove', { buttons: 1, clientX: 14, clientY: 10 }));
    expect(mocks.prepare).toHaveBeenCalledOnce(); expect(mocks.startDrag).toHaveBeenCalledOnce();
    await act(async () => emit('mousemove', { buttons: 1, clientX: 30, clientY: 10 }));
    expect(mocks.startDrag).toHaveBeenCalledOnce();
    await act(async () => emit('mouseup', { button: 0 }));
    expect(mocks.endDrag).toHaveBeenCalledOnce(); expect(listeners.get('mousemove')?.size).toBe(0);
  });

  it('never starts native dragging if the mouse is released while the guard is saving', async () => {
    const pending = deferred<boolean>(); mocks.prepare.mockReturnValueOnce(pending.promise);
    act(() => mount()); act(() => beginDrag());
    act(() => emit('mousemove', { buttons: 1, clientX: 20, clientY: 10 }));
    act(() => emit('mouseup', { button: 0 }));
    await act(async () => { pending.resolve(true); });
    expect(mocks.startDrag).not.toHaveBeenCalled(); expect(mocks.endDrag).not.toHaveBeenCalled();
  });

  it('blocks native dragging when the guard refuses and cleans up listeners on unmount', async () => {
    mocks.prepare.mockResolvedValueOnce(false);
    act(() => mount()); act(() => beginDrag());
    await act(async () => emit('mousemove', { buttons: 1, clientX: 20, clientY: 10 }));
    expect(mocks.startDrag).not.toHaveBeenCalled(); expect(listeners.get('mousemove')?.size).toBe(0);
    expect(view!.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
    act(() => beginDrag()); act(() => view!.unmount()); view = undefined;
    expect(listeners.get('mousemove')?.size).toBe(0);
    expect(mocks.offTarget).toHaveBeenCalledOnce(); expect(mocks.offDrag).toHaveBeenCalledOnce();
  });

  it('leaves rendering stages at their original dimensions without chrome', () => {
    const stage = { ...initial, mode: 'render' };
    act(() => mount(stage));
    expect(view!.root.findAllByType(WindowControls)).toHaveLength(0);
    expect(view!.root.findByType(AppShellHost).props.hash).toEqual(stage);
    expect(view!.root.findByType(AppShellHost).props.fill).toBeUndefined();
  });
});
