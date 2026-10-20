import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectImmersionStore } from '../stores/projectImmersion.js';
import { useProjectImmersion } from './useProjectImmersion.js';
import { useKeymapStore } from '../stores/keymap.js';
import { __resetCommandRegistry, setKeyCaptureSink } from './useCommand.js';

class TestElement {
  tagName = 'TEXTAREA';
  isContentEditable = false;
  closest(): null { return null; }
}

interface KeyInit {
  key?: string;
  code?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: TestElement;
  isComposing?: boolean;
  keyCode?: number;
  prevented?: boolean;
}

class TestKeyEvent extends Event {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
  propagationStopped = false;

  constructor(input: KeyInit | string = {}, nativeInit: KeyInit = {}) {
    const init = typeof input === 'string' ? nativeInit : input;
    super('keydown', { cancelable: true });
    this.key = init.key ?? 'Escape';
    this.code = init.code ?? this.key;
    this.repeat = init.repeat ?? false;
    this.ctrlKey = init.ctrlKey ?? false;
    this.metaKey = init.metaKey ?? false;
    this.altKey = init.altKey ?? false;
    this.shiftKey = init.shiftKey ?? false;
    this.isComposing = init.isComposing ?? false;
    this.keyCode = init.keyCode ?? 0;
    if (init.prevented) this.preventDefault();
    if (init.target) Object.defineProperty(this, 'target', { value: init.target });
  }

  override stopPropagation(): void {
    this.propagationStopped = true;
    super.stopPropagation();
  }

  override stopImmediatePropagation(): void {
    this.propagationStopped = true;
    super.stopImmediatePropagation();
  }
}

// Node's EventTarget has no DOM tree or capture phase. Keep each phase's real
// listener behavior, and dispatch capture first even when bubble registered first.
class TestWindow {
  private readonly capture = new EventTarget();
  private readonly bubble = new EventTarget();

  private target(options?: boolean | EventListenerOptions): EventTarget {
    return (typeof options === 'boolean' ? options : options?.capture) ? this.capture : this.bubble;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void {
    this.target(options).addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    this.target(options).removeEventListener(type, listener);
  }

  dispatchEvent(event: TestKeyEvent): void {
    this.capture.dispatchEvent(event);
    if (!event.propagationStopped) this.bubble.dispatchEvent(event);
  }
}

let renderer: ReactTestRenderer | undefined;
// useCommand installs one window listener per renderer; retain that same window between cases.
const view = new TestWindow();
let immersive: boolean;

function Probe({ project }: { project: string | null }): null {
  immersive = useProjectImmersion(project);
  return null;
}

function render(project: string | null = 'project-a'): void {
  act(() => {
    if (renderer) renderer.update(<Probe project={project} />);
    else renderer = create(<Probe project={project} />);
  });
}

function toggle(project = 'project-a'): void {
  act(() => { useProjectImmersionStore.getState().toggle(project); });
}

function press(init: KeyInit = {}): TestKeyEvent {
  const event = new TestKeyEvent(init);
  act(() => { view.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  vi.stubGlobal('window', Object.assign(view, { api: undefined }));
  vi.stubGlobal('HTMLElement', TestElement);
  vi.stubGlobal('KeyboardEvent', TestKeyEvent);
  useKeymapStore.getState().applyOverrides({});
  __resetCommandRegistry();
  useProjectImmersionStore.getState().exit();
});

afterEach(() => {
  act(() => { renderer?.unmount(); });
  renderer = undefined;
  useProjectImmersionStore.getState().exit();
  __resetCommandRegistry();
  vi.unstubAllGlobals();
});

describe('project immersion lifecycle', () => {
  it('uses F11 and the button store action interchangeably, including while typing', () => {
    render();
    expect(press({ key: 'F11', target: new TestElement() }).defaultPrevented).toBe(true);
    expect(immersive).toBe(true);
    toggle();
    expect(immersive).toBe(false);

    toggle();
    expect(press({ key: 'F11' }).defaultPrevented).toBe(true);
    expect(immersive).toBe(false);
  });

  it('consumes held F11 without toggling repeatedly', () => {
    render();
    press({ key: 'F11' });
    expect(press({ key: 'F11', repeat: true }).defaultPrevented).toBe(true);
    expect(immersive).toBe(true);
    press({ key: 'F11' });
    expect(immersive).toBe(false);
  });

  it.each([
    { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    { isComposing: true }, { keyCode: 229 }, { prevented: true },
  ] satisfies KeyInit[])('does not toggle immersion for modified or composing F11: %j', (init) => {
    render();
    press({ key: 'F11', ...init });
    expect(immersive).toBe(false);
  });

  it('honors remapping, unbinding and shortcut capture', () => {
    render();
    useKeymapStore.getState().applyOverrides({ 'global.projectImmersion': 'F10' });
    expect(press({ key: 'F11' }).defaultPrevented).toBe(false);
    expect(press({ key: 'F10' }).defaultPrevented).toBe(true);
    expect(immersive).toBe(true);
    const capture = vi.fn();
    setKeyCaptureSink(capture);
    press({ key: 'F10' });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(immersive).toBe(true);
    setKeyCaptureSink(null);
    useKeymapStore.getState().applyOverrides({ 'global.projectImmersion': null });
    expect(press({ key: 'F10' }).defaultPrevented).toBe(false);
    expect(press({ key: 'F11' }).defaultPrevented).toBe(false);
    expect(immersive).toBe(true);
  });

  it('does not enable immersion without a project, and uses the current project after a switch', () => {
    render(null);
    expect(press({ key: 'F11' }).defaultPrevented).toBe(false);
    expect(immersive).toBe(false);
    render('project-b');
    press({ key: 'F11' });
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-b');
  });

  it('routes native F11 through the same keymap and removes the subscription on unmount', () => {
    let nativeShortcut: (() => void) | undefined;
    const off = vi.fn();
    Object.assign(view, { api: { window: {
      setImmersiveSelf: vi.fn().mockResolvedValue(undefined),
      onImmersionShortcut: (callback: () => void): (() => void) => { nativeShortcut = callback; return off; },
    } } });
    vi.stubGlobal('document', { activeElement: null });
    render();
    act(() => { nativeShortcut?.(); });
    expect(immersive).toBe(true);
    toggle();
    expect(immersive).toBe(false);
    useKeymapStore.getState().applyOverrides({ 'global.projectImmersion': null });
    act(() => { nativeShortcut?.(); });
    expect(immersive).toBe(false);
    act(() => { renderer?.unmount(); });
    renderer = undefined;
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('hides shell chrome for the third IDE stage and Escape restores chrome without closing the IDE', () => {
    const closeIde = vi.fn();
    view.addEventListener('keydown', closeIde);
    render();
    act(() => { useProjectImmersionStore.getState().enterIDE('project-a', 'pane-a'); });
    expect(immersive).toBe(true);
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();

    expect(press().defaultPrevented).toBe(true);
    expect(immersive).toBe(false);
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(closeIde).not.toHaveBeenCalled();
  });

  it('releases an IDE owner when switching projects and never revives it on return', () => {
    render();
    act(() => { useProjectImmersionStore.getState().enterIDE('project-a', 'pane-a'); });
    render('project-b');
    expect(immersive).toBe(false);
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    render('project-a');
    expect(immersive).toBe(false);
  });

  it('exiting an IDE owner does not clear independently enabled project immersion', () => {
    render();
    toggle();
    act(() => { useProjectImmersionStore.getState().enterIDE('project-a', 'pane-a'); });
    press();
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-a');
    expect(immersive).toBe(true);
    press();
    expect(immersive).toBe(false);
  });

  it('enters for the current project and restores the shell when toggled again', () => {
    render();
    expect(immersive).toBe(false);

    toggle();
    expect(immersive).toBe(true);
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-a');

    toggle();
    expect(immersive).toBe(false);
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
    expect(press().defaultPrevented).toBe(false);
  });

  it('captures Escape before an existing IDE listener, then releases subsequent Escape presses', () => {
    const closeIde = vi.fn();
    view.addEventListener('keydown', closeIde);
    render();
    toggle();

    const event = press();
    expect(event.defaultPrevented).toBe(true);
    expect(closeIde).not.toHaveBeenCalled();
    expect(immersive).toBe(false);
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();

    expect(press().defaultPrevented).toBe(false);
    expect(closeIde).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['IME composition', { isComposing: true }],
    ['IME process key', { keyCode: 229 }],
    ['already handled Escape', { prevented: true }],
    ['another key', { key: 'Enter' }],
  ] satisfies Array<[string, KeyInit]>)('leaves immersion active for %s', (_name, init: KeyInit) => {
    render();
    toggle();

    const event = press(init);
    expect(immersive).toBe(true);
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-a');
    expect(event.defaultPrevented).toBe(init.prevented ?? false);
    expect(event.propagationStopped).toBe(false);
  });

  it.each(['project-b', null])('clears immersion when leaving for %s and does not reenter on return', (nextProject) => {
    render();
    toggle();

    render(nextProject);
    expect(immersive).toBe(false);
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
    expect(press().defaultPrevented).toBe(false);

    render();
    expect(immersive).toBe(false);
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
  });

  it('forgets immersion and removes its Escape listener on unmount', () => {
    render();
    toggle();
    act(() => { renderer?.unmount(); });
    renderer = undefined;
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();

    const downstream = vi.fn();
    view.addEventListener('keydown', downstream);
    expect(press().defaultPrevented).toBe(false);
    expect(downstream).toHaveBeenCalledTimes(1);

    render();
    expect(immersive).toBe(false);
  });
});
