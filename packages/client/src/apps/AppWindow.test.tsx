import { createElement, Fragment, useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { ProjectInfo } from '@vibisual/shared';

import { AppWindow, AppWindowHost } from './AppWindow.js';
import { openAppWindow, useAppWindowsStore, type AppWindow as AppWindowEntry } from './appWindows.js';
import type { AppHash } from './appHash.js';
import { useGraphStore } from '../stores/graphStore.js';
import { useCanvasVisibilityStore } from '../stores/canvasVisibility.js';
import { useProjectImmersionStore } from '../stores/projectImmersion.js';
import { __resetCaptureWindowsForTest, closeTopCaptureWindow } from '../components/BubbleMap/captureWindowManager.js';
import { WINDOW_PULL_OUT } from '../hooks/floatingWindowGeom.js';
import { registerAppWindowCloseGuard } from './appWindowCloseGuard.js';
import { registerAppWindowCloseRetention } from './appWindowCloseRetention.js';

interface TestGraphState {
  activeProject: string | null;
  activeIframeId: string | null;
  projects: Record<string, ProjectInfo>;
  stubProjects: Record<string, { project: ProjectInfo }>;
}

const mocks = vi.hoisted(() => ({ hostSequence: 0, hostRenders: 0, open: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-dom', () => ({ createPortal: (children: React.ReactNode) => children }));
vi.mock('../stores/graphStore.js', async () => {
  const { create: createStore } = await import('zustand');
  return { useGraphStore: createStore<TestGraphState>(() => ({ activeProject: null, activeIframeId: null, projects: {}, stubProjects: {} })) };
});
vi.mock('./useAppWindowRedock.js', () => ({ useAppWindowRedock: () => undefined }));
vi.mock('./registry.js', () => {
  const app = { id: 'editor', name: 'Editor', nameKey: 'editor', icon: () => null, color: '#334455', glow: '#667788', open: mocks.open };
  return {
    getInternalApp: () => app,
    appShellParams: (_app: unknown, args: Record<string, unknown>) => args,
  };
});
vi.mock('./AppShellHost.js', () => ({ AppShellHost: ({ hash }: { hash: AppHash }) => {
  mocks.hostRenders += 1;
  const [instance] = useState(() => ++mocks.hostSequence);
  const [draft, setDraft] = useState('');
  return createElement('textarea', {
    'data-editor': hash.params.appWindowId,
    'data-host-instance': instance,
    value: draft,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
  });
} }));

const graph = useGraphStore as unknown as UseBoundStore<StoreApi<TestGraphState>>;
const windowA: AppWindowEntry = {
  id: 'window-a', appId: 'editor', projectId: '/projects/a', ref: 'document-a', focusAt: 1,
  geometry: { x: 100, y: 100, w: 600, h: 400 },
};
const windowB: AppWindowEntry = {
  id: 'window-b', appId: 'editor', projectId: '/projects/b', ref: 'document-b', focusAt: 2,
  geometry: { x: 150, y: 150, w: 600, h: 400 },
};
let view: ReactTestRenderer | undefined;
let listeners: Map<string, Set<(event: unknown) => void>>;
/** §5.13 (S-11) 머리줄 자리(앱이 포털로 머리줄을 그리는 칸) — 창 틀이 네이티브로 다는 리스너를 창마다 모은다. */
let slots: Array<{ node: object; listeners: Map<string, Set<(event: unknown) => void>> }>;

function mountHost(): void {
  view = create(createElement(AppWindowHost), {
    createNodeMock: (element) => {
      if ((element.props as Record<string, unknown>)['data-app-chrome-slot'] === undefined) {
        return { getBoundingClientRect: () => ({ left: 100, top: 100, width: 600, height: 400 }) };
      }
      const slotListeners = new Map<string, Set<(event: unknown) => void>>();
      const node = {
        addEventListener: (type: string, listener: (event: unknown) => void) => {
          if (!slotListeners.has(type)) slotListeners.set(type, new Set());
          slotListeners.get(type)!.add(listener);
        },
        removeEventListener: (type: string, listener: (event: unknown) => void) => slotListeners.get(type)?.delete(listener),
      };
      slots.push({ node, listeners: slotListeners });
      return node;
    },
  });
}
/** 머리줄 자리에서 네이티브 이벤트 하나 — 앱이 그린 머리줄 위의 누름은 React 가 아니라 이 길로만 창 틀에 닿는다. */
function emitSlot(type: string, event: unknown): void {
  for (const slot of slots) for (const listener of [...slot.listeners.get(type) ?? []]) listener(event);
}
function shell(id: string): ReactTestInstance {
  return view!.root.findAllByProps({ 'data-app-window': '' }).find(node => node.findAllByProps({ 'data-editor': id }).length > 0)!;
}
function editor(id: string): ReactTestInstance { return view!.root.findByProps({ 'data-editor': id }); }
function emit(type: string, event: unknown): void { for (const listener of [...listeners.get(type) ?? []]) listener(event); }
function expectHidden(id: string): void {
  expect(shell(id).props.style.display).toBe('none');
  expect(shell(id).props['aria-hidden']).toBe(true);
  expect(shell(id).props.inert).toBe('');
}
function expectVisible(id: string): void {
  expect(shell(id).props.style.display).not.toBe('none');
  expect(shell(id).props['aria-hidden']).not.toBe(true);
  expect(shell(id).props.inert).toBeUndefined();
}

beforeEach(() => {
  mocks.hostSequence = 0;
  mocks.hostRenders = 0;
  mocks.open.mockReset().mockResolvedValue(true);
  listeners = new Map();
  slots = [];
  vi.stubGlobal('window', {
    innerWidth: 1280, innerHeight: 900, screenX: 0, screenY: 0,
    api: { app: { open: mocks.open } },
    setTimeout, clearTimeout, setInterval, clearInterval,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => listeners.get(type)?.delete(listener),
  });
  vi.stubGlobal('document', { body: {} });
  graph.setState({
    activeProject: 'project-a', activeIframeId: null,
    projects: {
      'project-a': { name: 'project-a', path: '/projects/a' },
      'project-b': { name: 'project-b', path: '/projects/b' },
    },
    stubProjects: {},
  });
  useAppWindowsStore.setState({ windows: [windowA, windowB] });
  useCanvasVisibilityStore.setState({ covers: [], covered: false });
  useProjectImmersionStore.getState().exit();
  __resetCaptureWindowsForTest();
});
afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  useProjectImmersionStore.getState().exit();
  __resetCaptureWindowsForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('project-scoped internal app windows', () => {
  it.each(['project', 'ide'])('restores the same unsaved fullscreen editor after %s immersion', (kind) => {
    act(mountHost);
    const instance = editor(windowA.id).props['data-host-instance'];
    act(() => editor(windowA.id).props.onChange({ target: { value: 'Unsaved immersion draft' } }));
    act(() => shell(windowA.id).findByProps({ title: 'panel.apps.window.maximize' }).props.onClick());
    expect(useCanvasVisibilityStore.getState().covered).toBe(true);

    act(() => {
      if (kind === 'project') useProjectImmersionStore.getState().toggle('project-a');
      else useProjectImmersionStore.getState().enterIDE('project-a', 'pane-a');
    });
    expect(shell(windowA.id).props.style.visibility).toBe('hidden');
    expect(shell(windowA.id).props.style.display).not.toBe('none');
    expect(shell(windowA.id).props.inert).toBe('');
    expect(useCanvasVisibilityStore.getState().covered).toBe(false);
    expect(closeTopCaptureWindow()).toBe(false);
    expect(useAppWindowsStore.getState().windows).toHaveLength(2);

    act(() => useProjectImmersionStore.getState().exit());
    expectVisible(windowA.id);
    expect(shell(windowA.id).props.style.visibility).toBeUndefined();
    expect(shell(windowA.id).findByProps({ title: 'panel.apps.window.restore' })).toBeDefined();
    expect(useCanvasVisibilityStore.getState().covers).toEqual(['app-window:window-a']);
    expect(editor(windowA.id).props['data-host-instance']).toBe(instance);
    expect(editor(windowA.id).props.value).toBe('Unsaved immersion draft');
  });

  it.each(['titlebar', 'escape'])('hides retained editor through %s and reopens the same unsaved scene', async (via) => {
    const offGuard = registerAppWindowCloseGuard(windowA.id, () => true);
    const offRetention = registerAppWindowCloseRetention(windowA.id, () => true);
    try {
      act(mountHost);
      const instance = editor(windowA.id).props['data-host-instance'];
      act(() => editor(windowA.id).props.onChange({ target: { value: 'Agent work' } }));
      await act(async () => {
        if (via === 'escape') expect(closeTopCaptureWindow()).toBe(true);
        else shell(windowA.id).findByProps({ 'aria-label': 'panel.apps.window.close' }).props.onClick();
      });
      expect(shell(windowA.id).props.style.visibility).toBe('hidden');
      expect(shell(windowA.id).props.style.display).not.toBe('none');
      expect(editor(windowA.id).props['data-host-instance']).toBe(instance);
      expect(closeTopCaptureWindow()).toBe(false);
      act(() => { openAppWindow({ appId: windowA.appId, projectId: windowA.projectId, ref: windowA.ref }); });
      expectVisible(windowA.id);
      expect(editor(windowA.id).props.value).toBe('Agent work');
      expect(editor(windowA.id).props['data-host-instance']).toBe(instance);
    } finally { offGuard(); offRetention(); }
  });

  it('keeps an agent renderer mounted with layout but no visible or focusable window until explicitly opened', () => {
    useAppWindowsStore.setState({ windows: [{ ...windowA, background: true }] });
    act(mountHost);
    const instance = editor(windowA.id).props['data-host-instance'];
    expect(shell(windowA.id).props.style).toMatchObject({ visibility: 'hidden' });
    expect(shell(windowA.id).props.style.display).not.toBe('none');
    expect(shell(windowA.id).props['aria-hidden']).toBe(true);
    expect(shell(windowA.id).props.inert).toBe('');
    expect(useCanvasVisibilityStore.getState().covered).toBe(false);
    expect(closeTopCaptureWindow()).toBe(false);
    act(() => editor(windowA.id).props.onChange({ target: { value: 'Agent work' } }));

    act(() => graph.setState({ activeProject: 'project-b' }));
    act(() => { openAppWindow({ appId: windowA.appId, projectId: windowA.projectId, ref: windowA.ref }, { background: true }); });
    expect(useAppWindowsStore.getState().windows).toHaveLength(1);
    expect(shell(windowA.id).props.style.visibility).toBe('hidden');
    expect(editor(windowA.id).props['data-host-instance']).toBe(instance);
    act(() => graph.setState({ activeProject: 'project-a' }));

    act(() => { openAppWindow({ appId: windowA.appId, projectId: windowA.projectId, ref: windowA.ref }); });
    expectVisible(windowA.id);
    expect(shell(windowA.id).props.style.visibility).toBeUndefined();
    expect(editor(windowA.id).props['data-host-instance']).toBe(instance);
    expect(editor(windowA.id).props.value).toBe('Agent work');
    expect(mocks.hostSequence).toBe(1);
  });

  it('shows only the active project and preserves both editors and unsaved drafts across A → B → A', () => {
    act(mountHost);
    expectVisible(windowA.id);
    expectHidden(windowB.id);
    const instanceA = editor(windowA.id).props['data-host-instance'];
    const instanceB = editor(windowB.id).props['data-host-instance'];
    act(() => editor(windowA.id).props.onChange({ target: { value: 'Unsaved A' } }));

    act(() => graph.setState({ activeProject: 'project-b' }));
    expectHidden(windowA.id);
    expectVisible(windowB.id);
    act(() => editor(windowB.id).props.onChange({ target: { value: 'Unsaved B' } }));

    act(() => graph.setState({ activeProject: 'project-a' }));
    expectVisible(windowA.id);
    expectHidden(windowB.id);
    expect(editor(windowA.id).props.value).toBe('Unsaved A');
    expect(editor(windowB.id).props.value).toBe('Unsaved B');
    expect(editor(windowA.id).props['data-host-instance']).toBe(instanceA);
    expect(editor(windowB.id).props['data-host-instance']).toBe(instanceB);
    expect(mocks.hostSequence).toBe(2);
    expect(useAppWindowsStore.getState().windows).toEqual([windowA, windowB]);
  });

  it.each([
    { label: 'no project', next: { activeProject: null } },
    { label: 'an iframe tab', next: { activeIframeId: 'iframe-preview' } },
  ])('hides every app window on $label without discarding the editors', ({ next }) => {
    act(mountHost);
    act(() => graph.setState(next));
    expectHidden(windowA.id);
    expectHidden(windowB.id);
    expect(closeTopCaptureWindow()).toBe(false);
    expect(mocks.hostSequence).toBe(2);
    expect(useAppWindowsStore.getState().windows).toHaveLength(2);
  });

  it('uses a stub project path before its full graph is loaded', () => {
    graph.setState({ activeProject: 'project-b', projects: {}, stubProjects: { 'project-b': { project: { name: 'project-b', path: '/projects/b' } } } });
    act(mountHost);
    expectHidden(windowA.id);
    expectVisible(windowB.id);
  });

  it('Escape skips a hidden window even when its retained z-index is higher', async () => {
    const renderWindows = (showB: boolean) => createElement(Fragment, null,
      createElement(AppWindow, { win: windowA }),
      createElement(AppWindow, { win: windowB, visible: showB }),
    );
    act(() => { view = create(renderWindows(true)); });
    expect(shell(windowB.id).props.style.zIndex).toBeGreaterThan(shell(windowA.id).props.style.zIndex);
    act(() => view!.update(renderWindows(false)));
    expectHidden(windowB.id);
    expect(shell(windowB.id).props.style.zIndex).toBeGreaterThan(shell(windowA.id).props.style.zIndex);
    const stopImmediatePropagation = vi.fn();
    const preventDefault = vi.fn();
    await act(async () => emit('keydown', { key: 'Escape', stopImmediatePropagation, preventDefault }));
    expect(useAppWindowsStore.getState().windows).toEqual([windowB]);
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('releases a hidden fullscreen window’s canvas cover and restores its mode on return', () => {
    act(mountHost);
    act(() => shell(windowA.id).findByProps({ title: 'panel.apps.window.maximize' }).props.onClick());
    expect(useCanvasVisibilityStore.getState().covers).toEqual(['app-window:window-a']);

    act(() => graph.setState({ activeProject: 'project-b' }));
    expect(useCanvasVisibilityStore.getState().covered).toBe(false);
    expectHidden(windowA.id);
    expect(shell(windowA.id).findByProps({ title: 'panel.apps.window.restore' })).toBeDefined();

    act(() => graph.setState({ activeProject: 'project-a' }));
    expect(useCanvasVisibilityStore.getState().covers).toEqual(['app-window:window-a']);
    expect(shell(windowA.id).findByProps({ title: 'panel.apps.window.restore' })).toBeDefined();
    act(() => view!.unmount());
    view = undefined;
    expect(useCanvasVisibilityStore.getState().covered).toBe(false);
  });

  it.each([
    { gesture: 'armed outside-viewport drag', clientX: 1400 },
    { gesture: 'pending edge dwell', clientX: 1279 },
  ])('cancels $gesture when switching projects', async ({ clientX }) => {
    vi.useFakeTimers();
    act(mountHost);
    const titlebar = shell(windowA.id).find(node => node.type === 'div' && typeof node.props.onDoubleClick === 'function');
    act(() => titlebar.props.onMouseDown({
      button: 0, clientX: 120, clientY: 120, screenX: 120, screenY: 120,
      target: { closest: () => null }, preventDefault: vi.fn(),
    }));
    expect(listeners.get('mousemove')?.size).toBe(1);
    act(() => emit('mousemove', { clientX, clientY: 120, screenX: clientX, screenY: 120 }));
    act(() => graph.setState({ activeProject: 'project-b' }));
    expect(listeners.get('mousemove')?.size).toBe(0);
    expect(listeners.get('mouseup')?.size).toBe(0);
    const position = { left: shell(windowA.id).props.style.left, top: shell(windowA.id).props.style.top };
    await act(async () => {
      vi.advanceTimersByTime(1000);
      emit('mousemove', { clientX: 900, clientY: 800, screenX: 900, screenY: 800 });
      emit('mouseup', { button: 0 });
    });
    expect(shell(windowA.id).props.style).toMatchObject(position);
    expect(mocks.open).not.toHaveBeenCalled();
    expect(useAppWindowsStore.getState().windows).toEqual([windowA, windowB]);
  });

  // §5.13 (S-10) — 밖으로 끄는 동안 본체는 숨고 **선(가상 창)** 이 손을 따라간다(IDE 창과 같다).
  //   main 의 선 다리가 없는 이 판에서는 앱 안 윤곽선이 그 일을 한다.
  it('hides the body behind an outline while pulling out, and restores it in place when opening fails', async () => {
    mocks.open.mockResolvedValue(false);
    act(mountHost);
    const titlebar = shell(windowA.id).find(node => node.type === 'div' && typeof node.props.onDoubleClick === 'function');
    act(() => titlebar.props.onMouseDown({
      button: 0, clientX: 120, clientY: 120, screenX: 120, screenY: 120,
      target: { closest: () => null }, preventDefault: vi.fn(),
    }));
    act(() => emit('mousemove', { clientX: 1400, clientY: 120, screenX: 1400, screenY: 120 }));

    // 본체는 숨고(잘린 창이 남지 않는다), 같은 크기의 윤곽선이 손을 따라간다 — 앱 경계에서 멈추지 않는다.
    expect(shell(windowA.id).props.style.opacity).toBe(0);
    const ghost = view!.root.findByProps({ 'data-app-window-ghost': '' });
    expect(ghost.props.style).toMatchObject({ left: 1380, width: 600, height: 400 });

    await act(async () => {
      emit('mouseup', { button: 0 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.open.mock.calls[0]![0]).toMatchObject({ placement: { width: 600, height: 400 } });
    // 못 열었다 — 선을 걷고 창은 앱 안 제자리(화면 안으로 되돌린 자리)에 다시 나타난다.
    expect(view!.root.findAllByProps({ 'data-app-window-ghost': '' })).toHaveLength(0);
    expect(shell(windowA.id).props.style.opacity).toBe(1);
    expect(shell(windowA.id).props.style.left).toBeLessThanOrEqual(1280 - 80);
    expect(useAppWindowsStore.getState().windows).toEqual([windowA, windowB]);
  });

  // §5.13 (S-10) ⑧~⑩ — 사용자 지시(2026-10-11): "왼쪽 벽에 붙으면 가상의 창이 나오게, IDE 창이랑 똑같이".
  //   앱을 최대화한 단일 모니터에서 커서는 왼쪽 벽(clientX 0)에 막힌다 — 거기서 잠깐 버티면 IDE 창처럼 선이
  //   뜨고 본체는 숨는다. 끄는 동안 앱 화면은 다시 그리지 않는다(IDE (H-6) ② 와 같은 까닭).
  it('shows the outline at the left wall after a short hold, like the IDE window, without re-rendering the app screen', () => {
    vi.useFakeTimers();
    // 위 `window` 흉내는 진짜 시계를 쥐고 있다 — 버팀 시계가 가짜 시계로 돌게 갈아 끼운다.
    Object.assign(window, { setTimeout, clearTimeout, setInterval, clearInterval });
    act(mountHost);
    const rendersBefore = mocks.hostRenders;
    const titlebar = shell(windowA.id).find(node => node.type === 'div' && typeof node.props.onDoubleClick === 'function');
    act(() => titlebar.props.onMouseDown({
      button: 0, clientX: 120, clientY: 120, screenX: 120, screenY: 120,
      target: { closest: () => null }, preventDefault: vi.fn(),
    }));
    act(() => emit('mousemove', { clientX: 0, clientY: 300, screenX: 0, screenY: 300 }));
    // 벽에 닿은 그 순간은 아직이다 — 스쳐 지나간 손에 선이 번쩍이면 안 된다.
    expect(view!.root.findAllByProps({ 'data-app-window-ghost': '' })).toHaveLength(0);
    expect(shell(windowA.id).props.style.opacity).toBe(1);

    act(() => { vi.advanceTimersByTime(WINDOW_PULL_OUT.EDGE_GHOST_MS + WINDOW_PULL_OUT.EDGE_TICK_MS); });
    // 선이 뜨고 본체는 숨는다 — 선은 창 크기 그대로, 왼쪽 벽 밖으로 걸쳐 선다.
    const ghost = view!.root.findByProps({ 'data-app-window-ghost': '' });
    expect(ghost.props.style).toMatchObject({ width: 600, height: 400 });
    expect(ghost.props.style.left).toBeLessThan(0);
    expect(shell(windowA.id).props.style.opacity).toBe(0);
    // (⑨) 흐려지는 것은 숨을 때만이다.
    expect(shell(windowA.id).props.className).toContain('duration-120');

    act(() => { vi.advanceTimersByTime(WINDOW_PULL_OUT.EDGE_DWELL_MS); });
    // 다 버텼다 — 선이 밝아진다(지금 놓으면 밖으로 나간다).
    expect(view!.root.findByProps({ 'data-app-window-ghost': '' }).props.className).toContain('border-violet-300/95');

    // 벽을 떠나 앱 안으로 돌아오면(앱 밖을 밟은 적은 없다) 선이 꺼지고 본체가 곧바로 손 아래에 선다.
    act(() => emit('mousemove', { clientX: 400, clientY: 300, screenX: 400, screenY: 300 }));
    expect(view!.root.findAllByProps({ 'data-app-window-ghost': '' })).toHaveLength(0);
    expect(shell(windowA.id).props.style.opacity).toBe(1);
    expect(shell(windowA.id).props.className).not.toContain('transition-opacity');

    act(() => emit('mouseup', { button: 0 }));
    expect(mocks.open).not.toHaveBeenCalled();
    // (⑩) 끄는 내내 앱 화면은 한 번도 다시 그려지지 않았다.
    expect(mocks.hostRenders).toBe(rendersBefore);
  });

  // §5.13 (S-11) — 사용자 보고: 영상 스튜디오 창이 "IDE 창처럼 드래그해도 안 움직인다". 앱은 머리줄을 창 타이틀바의 빈
  //   자리에 **포털**로 그리는데, React 이벤트는 React 트리를 따르므로 그 위의 누름이 타이틀바 손잡이에 닿지 않았다.
  //   창 틀이 그 자리에서 네이티브로 받아 같은 손잡이에 넘긴다 — 끌기·밖으로 빼기·두 번 눌러 최대화가 모두 같다.
  const pressInHeader = (target: unknown = { closest: () => null }) => ({
    button: 0, clientX: 300, clientY: 120, screenX: 300, screenY: 120, target, preventDefault: vi.fn(),
  });

  it('moves the window when the app header drawn into the title bar slot is dragged', () => {
    act(mountHost);
    expect(slots.length).toBeGreaterThan(0);
    act(() => emitSlot('mousedown', pressInHeader()));
    // 숨은 창(다른 프로젝트)은 끌리지 않는다 — 끌기는 보이는 창 하나만 시작한다.
    expect(listeners.get('mousemove')?.size).toBe(1);
    act(() => emit('mousemove', { clientX: 400, clientY: 220, screenX: 400, screenY: 220 }));
    act(() => emit('mouseup', { button: 0 }));
    expect(shell(windowA.id).props.style).toMatchObject({ left: 200, top: 200 });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('leaves the app’s own controls alone, and leaves a press on the bare slot to the title bar itself', () => {
    act(mountHost);
    act(() => emitSlot('mousedown', pressInHeader({ closest: () => ({}) })));
    expect(listeners.get('mousemove')?.size ?? 0).toBe(0);
    // 자리 자체(앱이 덮지 않은 칸)는 React 가 타이틀바로 보낸다 — 여기서도 받으면 한 누름이 끌기를 두 번 시작한다.
    for (const slot of slots) {
      act(() => { for (const listener of [...slot.listeners.get('mousedown') ?? []]) listener(pressInHeader(slot.node)); });
    }
    expect(listeners.get('mousemove')?.size ?? 0).toBe(0);
  });

  it('toggles maximize on a double click in the app header, but not on its own controls', () => {
    act(mountHost);
    act(() => emitSlot('dblclick', { target: { closest: () => ({}) } }));
    expect(shell(windowA.id).findAllByProps({ title: 'panel.apps.window.restore' })).toHaveLength(0);
    act(() => emitSlot('dblclick', { target: { closest: () => null } }));
    expect(shell(windowA.id).findByProps({ title: 'panel.apps.window.restore' })).toBeDefined();
  });

  it('pulls the window out of the app when its header is dragged past the edge — the same gesture as the title bar', async () => {
    act(mountHost);
    act(() => emitSlot('mousedown', pressInHeader()));
    act(() => emit('mousemove', { clientX: 1400, clientY: 120, screenX: 1400, screenY: 120 }));
    // 본체는 숨고 선(가상 창)이 손을 따라간다 — 타이틀바로 끌 때와 같다(S-10).
    expect(shell(windowA.id).props.style.opacity).toBe(0);
    expect(view!.root.findAllByProps({ 'data-app-window-ghost': '' })).toHaveLength(1);
    await act(async () => {
      emit('mouseup', { button: 0 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mocks.open).toHaveBeenCalledOnce();
  });
});
