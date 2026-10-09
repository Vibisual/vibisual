import { createElement, Fragment, useState } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { ProjectInfo } from '@vibisual/shared';

import { AppWindow, AppWindowHost } from './AppWindow.js';
import { useAppWindowsStore, type AppWindow as AppWindowEntry } from './appWindows.js';
import type { AppHash } from './appHash.js';
import { useGraphStore } from '../stores/graphStore.js';
import { useCanvasVisibilityStore } from '../stores/canvasVisibility.js';
import { __resetCaptureWindowsForTest, closeTopCaptureWindow } from '../components/BubbleMap/captureWindowManager.js';

interface TestGraphState {
  activeProject: string | null;
  activeIframeId: string | null;
  projects: Record<string, ProjectInfo>;
  stubProjects: Record<string, { project: ProjectInfo }>;
}

const mocks = vi.hoisted(() => ({ hostSequence: 0, open: vi.fn() }));
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

function mountHost(): void {
  view = create(createElement(AppWindowHost), {
    createNodeMock: () => ({ getBoundingClientRect: () => ({ left: 100, top: 100, width: 600, height: 400 }) }),
  });
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
  mocks.open.mockReset().mockResolvedValue(true);
  listeners = new Map();
  vi.stubGlobal('window', {
    innerWidth: 1280, innerHeight: 900, screenX: 0, screenY: 0,
    api: { app: { open: mocks.open } },
    setTimeout, clearTimeout,
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
  __resetCaptureWindowsForTest();
});
afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  __resetCaptureWindowsForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('project-scoped internal app windows', () => {
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

  it('Escape skips a hidden window even when its retained z-index is higher', () => {
    const renderWindows = (showB: boolean) => createElement(Fragment, null,
      createElement(AppWindow, { win: windowA }),
      createElement(AppWindow, { win: windowB, visible: showB }),
    );
    act(() => { view = create(renderWindows(true)); });
    expect(shell(windowB.id).props.style.zIndex).toBeGreaterThan(shell(windowA.id).props.style.zIndex);
    act(() => view!.update(renderWindows(false)));
    expectHidden(windowB.id);
    expect(shell(windowB.id).props.style.zIndex).toBeGreaterThan(shell(windowA.id).props.style.zIndex);
    const stopPropagation = vi.fn();
    act(() => emit('keydown', { key: 'Escape', stopPropagation }));
    expect(useAppWindowsStore.getState().windows).toEqual([windowB]);
    expect(stopPropagation).toHaveBeenCalledOnce();
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
});
