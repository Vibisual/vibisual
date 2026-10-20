import type { ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectImmersionStore } from '../../stores/projectImmersion.js';
import { ImmersiveExitControl } from './ImmersiveExitControl.js';

const portal = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('react-dom', () => ({
  createPortal: (children: ReactNode, target: unknown) => { portal.render(target); return children; },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

let renderer: ReactTestRenderer | undefined;
let doc: EventTarget & { body: object };
let win: EventTarget & { innerWidth: number; innerHeight: number };
let inside: object;
let regionNode: { contains: (node: unknown) => boolean };
class MockElement {}

function render(): void {
  act(() => {
    renderer = create(<ImmersiveExitControl />, {
      createNodeMock: () => regionNode,
    });
  });
}

function region(): ReactTestInstance {
  return renderer!.root.findByProps({ 'data-immersive-exit-control': '' });
}

function button(): ReactTestInstance {
  return renderer!.root.findByType('button');
}

function pointer(type: string, pointerType = 'mouse'): void {
  act(() => { region().props[type]({ pointerType, stopPropagation: vi.fn() }); });
}

function clickExit(): void {
  act(() => { button().props.onClick({ stopPropagation: vi.fn() }); });
}

function focus(): void {
  act(() => { region().props.onFocusCapture(); });
}

function blur(relatedTarget: object | null): void {
  act(() => { region().props.onBlurCapture({ currentTarget: regionNode, relatedTarget }); });
}

function press(target: object): void {
  const event = new Event('pointerdown');
  Object.defineProperties(event, {
    target: { value: target },
    clientX: { value: 100 },
    clientY: { value: 100 },
  });
  act(() => { win.dispatchEvent(event); });
}

function release(): void {
  act(() => { win.dispatchEvent(new Event('pointerup')); });
}

function outsideTap(target: object): void {
  press(target);
  release();
}

function expectRevealed(value: boolean): void {
  expect(region().props['data-revealed']).toBe(value);
  expect(region().props.style.height).toBe(value ? 80 : 12);
  expect(button().props.style).toMatchObject({ opacity: value ? 1 : 0, pointerEvents: value ? 'auto' : 'none' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useProjectImmersionStore.getState().exit();
  doc = Object.assign(new EventTarget(), { body: {} });
  win = Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 720 });
  inside = new MockElement();
  regionNode = { contains: (node) => node === inside || node === regionNode };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', win);
  vi.stubGlobal('Element', MockElement);
});

afterEach(() => {
  act(() => { renderer?.unmount(); });
  renderer = undefined;
  useProjectImmersionStore.getState().exit();
  vi.unstubAllGlobals();
});

describe('immersive exit control', () => {
  it('renders nothing outside immersion and resets the reveal state on reentry', () => {
    render();
    expect(renderer!.toJSON()).toBeNull();
    expect(portal.render).not.toHaveBeenCalled();

    act(() => { useProjectImmersionStore.getState().toggle('project-a'); });
    expectRevealed(false);
    expect(portal.render).toHaveBeenLastCalledWith(doc.body);
    pointer('onPointerEnter');
    expectRevealed(true);

    act(() => { useProjectImmersionStore.getState().exit(); });
    expect(renderer!.toJSON()).toBeNull();
    act(() => { useProjectImmersionStore.getState().toggle('project-a'); });
    expectRevealed(false);
  });

  it('reveals from the top hotspot, keeps a continuous path to X, and hides on leaving the whole area', () => {
    useProjectImmersionStore.getState().toggle('project-a');
    render();
    expectRevealed(false);
    expect(button().props.style.transform).toBe('translateY(-72px)');

    pointer('onPointerEnter');
    expectRevealed(true);
    expect(button().props.style.transform).toBe('translateY(0)');
    expect(region().findByType('button')).toBe(button());
    expect(button().props.onPointerLeave).toBeUndefined();
    pointer('onPointerLeave');
    expectRevealed(false);
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-a');
  });

  it('reveals for keyboard focus, retains focus inside the control, and hides after focus leaves', () => {
    useProjectImmersionStore.getState().toggle('project-a');
    render();
    expect(button().props['aria-label']).toBe('canvas.controls.exitImmersiveMode');
    expect(button().props.disabled).not.toBe(true);
    expect(button().props.tabIndex).not.toBe(-1);

    focus();
    expectRevealed(true);
    pointer('onPointerLeave');
    expectRevealed(true);
    blur(inside);
    expectRevealed(true);
    blur(null);
    expectRevealed(false);
  });

  it('reveals on the first touch, stays after lifting, and hides on a tap outside', () => {
    useProjectImmersionStore.getState().toggle('project-a');
    render();
    pointer('onPointerEnter', 'touch');
    expectRevealed(false);
    pointer('onPointerDown', 'touch');
    pointer('onPointerLeave', 'touch');
    expectRevealed(true);
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-a');
    outsideTap(inside);
    expectRevealed(true);
    press(inside);
    press(new MockElement());
    expectRevealed(true);
    release();
    outsideTap(new MockElement());
    expectRevealed(false);

    pointer('onPointerDown', 'touch');
    clickExit();
    expect(renderer!.toJSON()).toBeNull();
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
  });

  it('exits IDE immersion first while preserving independent project immersion, then exits the project', () => {
    useProjectImmersionStore.getState().toggle('project-a');
    useProjectImmersionStore.getState().enterIDE('project-a', 'pane-a');
    render();
    pointer('onPointerEnter');
    clickExit();
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(useProjectImmersionStore.getState().immersiveProject).toBe('project-a');
    expect(renderer!.toJSON()).not.toBeNull();

    clickExit();
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
    expect(renderer!.toJSON()).toBeNull();
  });

  it('is available for IDE-only immersion without introducing project immersion', () => {
    useProjectImmersionStore.getState().enterIDE('project-a', 'pane-a');
    render();
    focus();
    clickExit();
    expect(useProjectImmersionStore.getState().immersiveIDE).toBeNull();
    expect(useProjectImmersionStore.getState().immersiveProject).toBeNull();
    expect(renderer!.toJSON()).toBeNull();
  });
});
