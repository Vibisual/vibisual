import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from './Header.js';
import { endTitlebarDrag, installTitlebarPressCatch, isDragRegionTarget } from '../../utils/titlebarPress.js';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/graphStore.js', () => ({
  selectEffectiveProject: () => null,
  useGraphStore: (select: (state: object) => unknown) => select({
    agents: [], agentProjects: {}, subAgents: {}, queuedCommands: {},
    runningSubagentTasks: {}, projectAgentCounts: {},
  }),
}));
vi.mock('../../transport/index.js', () => ({ isPackagedDesktop: () => true }));
vi.mock('../../utils/platform.js', () => ({ isMac: () => false }));
vi.mock('./headerAgentCounts.js', () => ({
  resolveHeaderAgentCounts: () => ({ agents: 0, sessions: 0, running: 0, completed: 0, limited: 0 }),
}));
vi.mock('./FileMenu.js', () => ({ FileMenu: () => null }));
vi.mock('./TabBar.js', () => ({ TabBar: () => null }));
vi.mock('./HeaderLanguageSlot.js', () => ({ HeaderLanguageSlot: () => null }));
vi.mock('./UpdateButton.js', () => ({ UpdateButton: () => null }));
vi.mock('../../plugins/host.js', () => ({ PluginHeaderSlot: () => null }));
vi.mock('./OverlayToggleButton.js', () => ({ OverlayToggleButton: () => null }));
vi.mock('./IDEWindowsMenu.js', () => ({ IDEWindowsMenu: () => null }));
vi.mock('./UsagePill.js', () => ({ UsagePill: () => null }));
vi.mock('./AuditPill.js', () => ({ AuditPill: () => null }));
vi.mock('../Panel/ServerLogPopup.js', () => ({ ServerLogPopup: () => null }));

type Phase = 'start' | 'move' | 'end';
type Point = { x: number; y: number };
type LogoPart = 'wrapper' | 'icon' | 'text';
const LOGO_PARTS: LogoPart[] = ['wrapper', 'icon', 'text'];
type Listener = { type: string; fn: (event: object) => void; capture: boolean };

/** Renderer ancestry supplies the classes: this fake only implements the DOM's closest lookup. */
class TestElement {
  readonly classList: { contains: (name: string) => boolean };
  constructor(classes: string, readonly parent: TestElement | null) {
    const names = new Set(classes.split(/\s+/));
    this.classList = { contains: (name) => names.has(name) };
  }
  closest(selector: string): TestElement | null {
    const names = selector.split(',').map((part) => part.trim().slice(1));
    for (let node: TestElement | null = this; node; node = node.parent) {
      if (names.some((name) => node.classList.contains(name))) return node;
    }
    return null;
  }
}

let view: ReactTestRenderer | undefined;
let uninstall: (() => void) | undefined;

afterEach(() => {
  endTitlebarDrag();
  act(() => view?.unmount());
  view = undefined;
  uninstall?.();
  uninstall = undefined;
  vi.unstubAllGlobals();
});

function setup(options: { api?: boolean } = {}) {
  const listeners: Listener[] = [];
  const bodyClasses = new Set<string>();
  const moveSelf = vi.fn((_phase: Phase, _point?: Point): Promise<boolean> => Promise.resolve(true));
  let maximized = false;
  const toggleMaximizeSelf = vi.fn(async () => { maximized = !maximized; });
  vi.stubGlobal('Element', TestElement);
  vi.stubGlobal('document', { body: { classList: {
    contains: (name: string) => bodyClasses.has(name),
    add: (name: string) => { bodyClasses.add(name); },
    remove: (name: string) => { bodyClasses.delete(name); },
  } } });
  vi.stubGlobal('window', {
    api: options.api === false ? undefined : { window: { moveSelf, toggleMaximizeSelf } },
    addEventListener: (type: string, fn: Listener['fn'], capture: boolean) => {
      listeners.push({ type, fn, capture });
    },
    removeEventListener: (type: string, fn: Listener['fn'], capture: boolean) => {
      const index = listeners.findIndex((entry) => entry.type === type && entry.fn === fn && entry.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
  });
  uninstall = installTitlebarPressCatch();
  act(() => { view = create(<Header connectionStatus="connected" agentPhase="waiting" />); });

  const text = view!.root.findByProps({ children: 'header.logo.name' });
  const wrapper = text.parent!;
  const header = view!.root.findByType('header');
  const icon = wrapper.children.find((child) => typeof child !== 'string' && child.type === 'div') as ReactTestInstance;
  const targets: Record<LogoPart, ReactTestInstance> = { wrapper, icon, text };
  const elements = new Map<ReactTestInstance, TestElement>();
  function element(node: ReactTestInstance): TestElement {
    const existing = elements.get(node);
    if (existing) return existing;
    let parent = node.parent;
    while (parent && typeof parent.type !== 'string') parent = parent.parent;
    const result = new TestElement(String(node.props.className ?? ''), parent ? element(parent) : null);
    elements.set(node, result);
    return result;
  }
  function emitWindow(type: string, event: object): void {
    for (const listener of listeners.filter((entry) => entry.type === type)) listener.fn(event);
  }

  /**
   * react-test-renderer does not dispatch DOM events. Walk its rendered host tree explicitly,
   * running actual window capture and React capture/bubble handlers in propagation order.
   * This checks handler coverage and IPC routing; native Electron hit testing is outside this test.
   */
  function dispatch(part: LogoPart, type: 'MouseDown' | 'DoubleClick', button = 0) {
    const target = targets[part];
    expect(target, `missing logo ${part}`).toBeDefined();
    const path: ReactTestInstance[] = [];
    for (let node: ReactTestInstance | null = target!; node; node = node.parent) {
      if (typeof node.type === 'string') path.unshift(node);
    }
    const event = {
      target: element(target!), currentTarget: null as TestElement | null,
      button, buttons: button === 0 ? 1 : 2, screenX: 30, screenY: 18,
      defaultPrevented: false, propagationStopped: false,
      preventDefault: vi.fn(() => { event.defaultPrevented = true; }),
      stopPropagation: vi.fn(() => { event.propagationStopped = true; }),
    };
    const invoked: Array<{ node: ReactTestInstance; handler: string }> = [];
    function invoke(node: ReactTestInstance, handler: string): void {
      const fn = node.props[handler] as ((value: typeof event) => void) | undefined;
      if (!fn) return;
      invoked.push({ node, handler });
      event.currentTarget = element(node);
      fn(event);
    }
    act(() => {
      if (type === 'MouseDown') emitWindow('mousedown', event);
      for (const node of path) {
        if (event.propagationStopped) break;
        invoke(node, `on${type}Capture`);
      }
      for (const node of [...path].reverse()) {
        if (event.propagationStopped) break;
        invoke(node, `on${type}`);
      }
    });
    return { event, invoked };
  }
  return {
    header, wrapper, targets, moveSelf, toggleMaximizeSelf, listeners, bodyClasses, dispatch, emitWindow,
    isMaximized: () => maximized,
    isNativeDragTarget: (part: LogoPart) => isDragRegionTarget(element(targets[part]!) as unknown as EventTarget),
  };
}

describe('Header logo uses the shared native titlebar and DOM fallback', () => {
  it('has no no-drag cover or logo-specific gesture handlers competing with the native caption', () => {
    const rig = setup();
    for (const node of rig.wrapper.findAll((candidate) => typeof candidate.type === 'string')) {
      expect(String(node.props.className ?? '').split(/\s+/)).not.toContain('app-nodrag');
      expect(node.props.onMouseDown).toBeUndefined();
      expect(node.props.onMouseDownCapture).toBeUndefined();
      expect(node.props.onDoubleClick).toBeUndefined();
      expect(node.props.onDoubleClickCapture).toBeUndefined();
    }
    expect(rig.wrapper.findAllByProps({ 'aria-hidden': 'true' })).toHaveLength(0);
  });

  it.each(LOGO_PARTS)('%s starts exactly one shared fallback move sequence when a press reaches the DOM', (part) => {
    const rig = setup();
    // Native caption presses normally do not reach the DOM. If one does, the boot-time
    // fallback handles the whole logo, including a descendant target, exactly once.
    expect(rig.isNativeDragTarget(part)).toBe(true);
    const down = rig.dispatch(part, 'MouseDown');
    expect(down.invoked).toEqual([]);
    expect(down.event.preventDefault).toHaveBeenCalledOnce();
    expect(down.event.stopPropagation).toHaveBeenCalledOnce();
    expect(rig.bodyClasses.has('vib-titlebar-drag')).toBe(true);
    // Restoring a maximized window can cancel pointer capture without releasing the mouse.
    rig.emitWindow('pointercancel', {});
    rig.emitWindow('lostpointercapture', {});
    rig.emitWindow('mousemove', { buttons: 1 });
    rig.emitWindow('mouseup', { button: 0, buttons: 0, screenX: 100, screenY: 70 });
    rig.emitWindow('mouseup', { button: 0, buttons: 0, screenX: 100, screenY: 70 });
    expect(rig.moveSelf.mock.calls).toEqual([
      ['start', { x: 30, y: 18 }], ['move', undefined], ['end', { x: 100, y: 70 }],
    ]);
    expect(rig.bodyClasses.has('vib-titlebar-drag')).toBe(false);
    expect(rig.listeners.map(({ type }) => type)).toEqual(['mousedown']);
  });

  it.each(LOGO_PARTS)('%s DOM double-click maximizes then restores through Header once each', (part) => {
    const rig = setup();
    for (const expectedMaximized of [true, false]) {
      for (let click = 0; click < 2; click += 1) {
        rig.dispatch(part, 'MouseDown');
        rig.emitWindow('mouseup', { button: 0, buttons: 0, screenX: 30, screenY: 18 });
      }
      const doubleClick = rig.dispatch(part, 'DoubleClick');
      expect(doubleClick.invoked).toEqual([{ node: rig.header, handler: 'onDoubleClick' }]);
      expect(rig.isMaximized()).toBe(expectedMaximized);
      expect(rig.toggleMaximizeSelf).toHaveBeenCalledTimes(expectedMaximized ? 1 : 2);
    }
    expect(rig.moveSelf.mock.calls.map(([phase]) => phase)).toEqual([
      'start', 'end', 'start', 'end', 'start', 'end', 'start', 'end',
    ]);
  });

  it.each(LOGO_PARTS)('%s right-button press is neither moved nor consumed', (part) => {
    const rig = setup();
    const { event } = rig.dispatch(part, 'MouseDown', 2);
    expect(rig.moveSelf).not.toHaveBeenCalled();
    expect(rig.toggleMaximizeSelf).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(rig.bodyClasses.size).toBe(0);
  });

  it.each(LOGO_PARTS)('%s press without desktop API is left untouched', (part) => {
    const rig = setup({ api: false });
    const { event } = rig.dispatch(part, 'MouseDown');
    expect(rig.moveSelf).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(rig.bodyClasses.size).toBe(0);
    expect(rig.listeners.map(({ type }) => type)).toEqual(['mousedown']);
  });
});
