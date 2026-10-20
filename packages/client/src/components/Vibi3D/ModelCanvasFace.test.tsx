import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreationDoc } from '@vibisual/shared';
import type { AppCanvasFaceProps } from '../../apps/registry.js';
import { ModelCanvasFace } from './ModelCanvasFace.js';
import { createModelCanvasMirrorPublisher, MODEL_MIRROR_INTERVAL_MS, type ModelCanvasMirrorPublisher, type ModelCanvasMirrorTarget } from './modelCanvasMirror.js';
import type { useModelCanvasView } from './useModelCanvasView.js';

const mocks = vi.hoisted(() => ({ document: vi.fn(), visible: vi.fn(), view: vi.fn() }));
vi.mock('./useModelCanvasDocument.js', () => ({ useModelCanvasDocument: mocks.document, useModelCanvasVisible: mocks.visible }));
vi.mock('./useModelCanvasView.js', () => ({ useModelCanvasView: mocks.view }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const target = { projectId: 'project', workRef: 'model-a' };
const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
const props: AppCanvasFaceProps = {
  ...target, file: '', version: 1, width: 280, height: 180, glow: '#a78bfa', icon: 'model',
  thumb: { kind: 'picture', url: 'blob:thumbnail' }, thumbLoading: false,
};
const document: CreationDoc = {
  schemaVersion: 1, id: target.workRef, appId: 'vibi3d', revision: 1, title: 'Model', payload: {},
  parameters: {}, lockedPaths: [], links: [], createdAt: 1, updatedAt: 1, label: '', author: 'agent',
};
const actions = { beginDrag: vi.fn(), moveDrag: vi.fn(), endDrag: vi.fn(), toggleSpin: vi.fn(), resetView: vi.fn() };
let fallback: Pick<ReturnType<typeof useModelCanvasView>, 'phase' | 'spinning' | 'snapshot' | 'shownDocument'>;
let component: ReactTestRenderer | undefined;
let publisher: ModelCanvasMirrorPublisher;
let frameUrl: string;
let now: number;
let capture: ReturnType<typeof vi.fn>;

function render(next: Partial<AppCanvasFaceProps> = {}): void {
  act(() => {
    const face = createElement(ModelCanvasFace, { ...props, ...next });
    if (component) component.update(face); else component = create(face);
  });
}
function publish(next: ModelCanvasMirrorTarget = target, url = 'data:image/jpeg;base64,editor'): void {
  frameUrl = url;
  now += MODEL_MIRROR_INTERVAL_MS;
  act(() => publisher.publish(next, canvas));
}
function imageUrl(): string | undefined { return component!.root.findAllByType('img')[0]?.props.src as string | undefined; }
function viewEnabled(): boolean { return (mocks.view.mock.lastCall![0] as Parameters<typeof useModelCanvasView>[0]).enabled; }
function button(label: 'spin' | 'frame'): ReactTestInstance {
  return component!.root.findByProps({ 'aria-label': `panel.vibi3d.${label}` });
}
function click(label: 'spin' | 'frame'): void { act(() => button(label).props.onClick({ stopPropagation: vi.fn() })); }
function dragSurface(): ReactTestInstance {
  return component!.root.findAllByType('div').find(node => typeof node.props.onPointerDown === 'function')!;
}
function pointer(x = 20, y = 40) {
  return { button: 0, pointerId: 1, clientX: x, clientY: y, stopPropagation: vi.fn(),
    currentTarget: { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() } };
}

beforeEach(() => {
  now = 0;
  frameUrl = '';
  publisher = createModelCanvasMirrorPublisher();
  capture = vi.fn();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0,
    getContext: () => ({ drawImage: capture }), toDataURL: () => frameUrl }) });
  Object.values(actions).forEach(action => action.mockReset());
  mocks.visible.mockReset().mockReturnValue(true);
  mocks.document.mockReset().mockReturnValue({ document, loading: false, failed: false });
  fallback = { phase: 'still', spinning: false, snapshot: 'blob:fallback', shownDocument: document };
  mocks.view.mockReset().mockImplementation(({ enabled }: Parameters<typeof useModelCanvasView>[0]) => ({
    ...fallback,
    // Capture the enabled value from each render: a stale callback loses the first gesture.
    beginDrag: (x: number, y: number) => actions.beginDrag(enabled, x, y),
    moveDrag: (x: number, y: number) => actions.moveDrag(enabled, x, y),
    endDrag: () => actions.endDrag(enabled),
    toggleSpin: () => actions.toggleSpin(enabled),
    resetView: () => actions.resetView(enabled),
  }));
});
afterEach(() => {
  act(() => component?.unmount());
  component = undefined;
  publisher.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('model canvas face editor mirror', () => {
  it('presents the actual editor frame before its own snapshot and disables the duplicate renderer', () => {
    render();
    expect(imageUrl()).toBe('blob:fallback');
    expect(viewEnabled()).toBe(true);
    publish();
    expect(imageUrl()).toBe('data:image/jpeg;base64,editor');
    expect(viewEnabled()).toBe(false);
    expect(capture).toHaveBeenCalledOnce();
    publish(target, 'data:image/jpeg;base64,updated');
    expect(imageUrl()).toBe('data:image/jpeg;base64,updated');
    expect(viewEnabled()).toBe(false);
  });

  it.each(['tooLarge', 'failed', 'empty'] as const)('keeps an available editor preview usable when the fallback phase is %s', phase => {
    fallback.phase = phase;
    render();
    publish();
    expect(imageUrl()).toBe('data:image/jpeg;base64,editor');
    expect(button('spin').props.disabled).toBe(false);
    expect(button('frame').props.disabled).toBe(false);
    expect(component!.root.findAllByType('span').some(node => node.children.includes('panel.apps.canvas.dragRotate'))).toBe(true);
  });

  it('returns to the fallback when the editor stops publishing and releases capture while hidden', () => {
    render();
    publish();
    act(() => publisher.clear());
    expect(imageUrl()).toBe('blob:fallback');
    expect(viewEnabled()).toBe(true);
    publish();
    mocks.visible.mockReturnValue(false);
    render();
    expect(imageUrl()).toBe('blob:fallback');
    expect(viewEnabled()).toBe(false);
    const captureCount = capture.mock.calls.length;
    publish();
    expect(capture).toHaveBeenCalledTimes(captureCount);
  });

  it('starts rotation on the first click after enabling its own renderer, then reset resumes the mirror', () => {
    render();
    publish();
    click('spin');
    expect(viewEnabled()).toBe(true);
    expect(actions.toggleSpin).toHaveBeenCalledExactlyOnceWith(true);
    expect(imageUrl()).toBe('blob:fallback');
    publish(target, 'data:image/jpeg;base64,ignored');
    expect(imageUrl()).toBe('blob:fallback');
    expect(capture).toHaveBeenCalledOnce();
    click('frame');
    expect(actions.resetView).toHaveBeenCalledExactlyOnceWith(true);
    publish(target, 'data:image/jpeg;base64,resumed');
    expect(imageUrl()).toBe('data:image/jpeg;base64,resumed');
    expect(viewEnabled()).toBe(false);
  });

  it('starts dragging on the first pointer down after enabling its own renderer and releases the pointer', () => {
    render();
    publish();
    const start = pointer();
    act(() => dragSurface().props.onPointerDown(start));
    expect(start.currentTarget.setPointerCapture).toHaveBeenCalledWith(1);
    expect(actions.beginDrag).toHaveBeenCalledExactlyOnceWith(true, 20, 40);
    expect(viewEnabled()).toBe(true);
    act(() => dragSurface().props.onPointerMove(pointer(50, 70)));
    expect(actions.moveDrag).toHaveBeenCalledExactlyOnceWith(true, 50, 70);
    act(() => dragSurface().props.onPointerUp(start));
    expect(actions.endDrag).toHaveBeenCalledExactlyOnceWith(true);
    expect(start.currentTarget.releasePointerCapture).toHaveBeenCalledWith(1);
    click('frame');
    publish();
    expect(imageUrl()).toBe('data:image/jpeg;base64,editor');
    expect(viewEnabled()).toBe(false);
  });

  it('does not apply a cancelled pending drag after the mirror yields', () => {
    render();
    publish();
    act(() => {
      dragSurface().props.onPointerDown(pointer());
      dragSurface().props.onPointerCancel();
    });
    expect(actions.beginDrag).not.toHaveBeenCalled();
    expect(actions.endDrag).toHaveBeenCalledOnce();
  });

  it('does not carry manual control to a different document or retain it after returning', () => {
    render();
    publish();
    click('spin');
    render({ workRef: 'model-b' });
    publish({ ...target, workRef: 'model-b' }, 'data:image/jpeg;base64,model-b');
    expect(imageUrl()).toBe('data:image/jpeg;base64,model-b');
    expect(viewEnabled()).toBe(false);
    render();
    publish();
    expect(imageUrl()).toBe('data:image/jpeg;base64,editor');
    expect(viewEnabled()).toBe(false);
    expect(actions.toggleSpin).toHaveBeenCalledOnce();
  });

  it('isolates manual control by project and by legacy file version', () => {
    render();
    publish();
    click('spin');
    render({ projectId: 'other-project' });
    publish({ ...target, projectId: 'other-project' });
    expect(viewEnabled()).toBe(false);
    render({ workRef: undefined, file: 'model.glb' });
    publish({ projectId: target.projectId, file: 'model.glb' });
    click('spin');
    expect(viewEnabled()).toBe(true);
    render({ workRef: undefined, file: 'model.glb', version: 2 });
    publish({ projectId: target.projectId, file: 'model.glb' });
    expect(imageUrl()).toBe('data:image/jpeg;base64,editor');
    expect(viewEnabled()).toBe(false);
  });
});
