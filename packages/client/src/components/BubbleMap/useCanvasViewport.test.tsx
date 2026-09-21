import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { Node, ReactFlowInstance, Viewport } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { canvasViewKey, type CanvasViewSnapshot } from './canvasViewMemory.js';
import { useCanvasViewport } from './useCanvasViewport.js';

type Camera = ReturnType<typeof useCanvasViewport>;
interface Harness {
  key: string; api: Camera; viewport: Viewport; rendered: Node[]; nodes: { current: Node[] };
  setViewport: Mock<(viewport: Viewport, options: { duration: number }) => Promise<boolean>>;
  fitView: Mock;
  render: (key: string, ready?: boolean, duringRender?: () => void) => void;
  unmount: () => void;
}
const frames = new Map<number, FrameRequestCallback>();
const renderers = new Set<ReactTestRenderer>();
let frameId = 0;
let projectId = 0;
const SAVED_VIEW = { x: 240, y: -180, zoom: 3.5 };
function saved(viewport: Viewport = SAVED_VIEW): CanvasViewSnapshot {
  return { viewport, positions: new Map([['node', { x: 10, y: 20 }]]) };
}
function node(measured = true): Node {
  return { id: 'node', position: { x: 10, y: 20 }, data: {}, ...(measured ? { measured: { width: 100, height: 50 } } : {}) };
}
function nextKey(): string { return canvasViewKey(`/tests/camera-${++projectId}`, null, null)!; }

beforeEach(() => {
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    frames.set(++frameId, callback); return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => { frames.delete(id); });
});
afterEach(() => {
  act(() => { for (const renderer of renderers) renderer.unmount(); });
  renderers.clear();
  vi.unstubAllGlobals();
});
async function tick(count = 1): Promise<void> {
  for (let i = 0; i < count; i++) await act(async () => {
    const batch = [...frames.values()]; frames.clear();
    for (const callback of batch) callback(0);
    await Promise.resolve();
  });
}
function mount(key = nextKey(), ready = true): Harness {
  let renderer: ReactTestRenderer;
  let camera: Camera;
  const h: Harness = {
    key, get api(): Camera { return camera; }, viewport: { x: 0, y: 0, zoom: 1 },
    rendered: [node()], nodes: { current: [node()] },
    setViewport: vi.fn(async (viewport: Viewport, _options: { duration: number }): Promise<boolean> => {
      h.viewport = { ...viewport }; return true;
    }),
    fitView: vi.fn(),
    render: (next: string, dataReady = true, duringRender?: () => void): void => {
      h.key = next;
      act(() => renderer.update(createElement(Probe, { viewKey: next, ready: dataReady, duringRender })));
    },
    unmount: (): void => { act(() => renderer.unmount()); renderers.delete(renderer); },
  };
  // Only these ReactFlow methods and container dimensions are observed by the real hook.
  const flow = { current: {
    getViewport: (): Viewport => h.viewport, getNodes: (): Node[] => h.rendered,
    getNodesBounds: (): { x: number; y: number; width: number; height: number } => ({ x: 10, y: 20, width: 100, height: 50 }),
    setViewport: h.setViewport, fitView: h.fitView,
  } as unknown as ReactFlowInstance };
  const container = { current: { clientWidth: 800, clientHeight: 600 } as HTMLDivElement };
  function Probe(props: { viewKey: string; ready: boolean; duringRender?: () => void }): null {
    camera = useCanvasViewport({ ...props, mobileZoom: false, flow, nodes: h.nodes, container });
    props.duringRender?.();
    return null;
  }
  act(() => { renderer = create(createElement(Probe, { viewKey: key, ready })); renderers.add(renderer); });
  h.api.memory.enter(key, h.viewport, h.nodes.current);
  return h;
}

describe('useCanvasViewport scheduling', () => {
  it('카메라 적용 도중 로딩으로 돌아가도 준비 후 복원을 다시 예약할 수 있다', async () => {
    const h = mount();
    let complete!: (applied: boolean) => void;
    h.setViewport.mockImplementationOnce(() => new Promise<boolean>((resolve) => { complete = resolve; }));
    h.api.restore(h.key, saved(), ['node']);
    await tick(2);
    expect(h.setViewport).toHaveBeenCalledTimes(1);
    h.render(h.key, false);
    await act(async () => { complete(true); });
    expect(h.api.memory.settled).toBe(false);
    expect(h.api.memory.read(h.key)).toBeUndefined();
    h.render(h.key, true);
    h.api.restore(h.key, saved(), ['node']);
    await tick(2);
    expect(h.setViewport).toHaveBeenCalledTimes(2);
    expect(h.api.memory.settled).toBe(true);
    expect(h.api.memory.read(h.key)?.viewport).toEqual(SAVED_VIEW);
  });
  it('같은 뷰가 매 프레임 갱신되어도 두 프레임 뒤 복원을 마친다', async () => {
    const h = mount();
    h.api.restore(h.key, saved(), ['node']);
    for (let i = 0; i < 2; i++) {
      h.render(h.key); h.api.restore(h.key, saved(), ['node']); await tick();
    }
    expect(h.setViewport).toHaveBeenCalledTimes(1);
    expect(h.api.memory.settled).toBe(true);
  });
  it('대기 중 대상 목록이 바뀌면 사라진 노드를 더 기다리지 않는다', async () => {
    const h = mount();
    h.api.restore(h.key, undefined, ['removed-node']);
    await tick(2);
    expect(h.setViewport).not.toHaveBeenCalled();
    h.api.restore(h.key, undefined, ['node']);
    await tick();
    expect(h.setViewport).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });
  it('스냅샷이 준비되기 전에는 저장 카메라도 적용하지 않는다', async () => {
    const h = mount(undefined, false);
    h.api.restore(h.key, saved(), ['node']);
    await tick(3);
    expect(h.setViewport).not.toHaveBeenCalled();
    expect(h.api.memory.settled).toBe(false);
    h.render(h.key, true);
    h.api.restore(h.key, saved(), ['node']);
    await tick(2);
    expect(h.setViewport).toHaveBeenCalledTimes(1);
    expect(h.api.memory.settled).toBe(true);
  });

  it('새 노드가 커밋되고 실측될 때까지 기다린 뒤 한 번만 직접 정렬한다', async () => {
    const h = mount();
    h.rendered = [];
    h.api.restore(h.key, undefined, ['node']);
    await tick(2);
    expect(h.setViewport).not.toHaveBeenCalled();
    h.rendered = [node(false)];
    await tick();
    expect(h.setViewport).not.toHaveBeenCalled();
    h.rendered = [node()];
    await tick(3);
    expect(h.setViewport).toHaveBeenCalledTimes(1);
    expect(h.fitView).not.toHaveBeenCalled();
    expect(h.api.memory.read(h.key)?.viewport).toEqual(h.viewport);
    expect(frames.size).toBe(0);
  });

  it('저장된 위치와 2를 넘는 확대율도 그대로 복원한다', async () => {
    const h = mount();
    h.api.restore(h.key, saved(), ['node']);
    await tick(2);
    expect(h.setViewport).toHaveBeenCalledWith(SAVED_VIEW, { duration: 0 });
    expect(h.api.memory.read(h.key)).toEqual(saved());
    expect(h.fitView).not.toHaveBeenCalled();
  });

  it('A → B 전환의 effect 정리 전이나 취소 후 늦게 실행된 A 예약도 카메라를 옮기지 못한다', async () => {
    const h = mount();
    h.api.restore(h.key, saved(), ['node']);
    await tick();
    const abandoned = [...frames.values()][0]!;
    const b = nextKey();
    // Render has declared B, while the caller has not yet cancelled A or entered B's memory.
    h.render(b, true, () => abandoned(0));
    expect(h.setViewport).not.toHaveBeenCalled();
    h.api.memory.enter(b, h.viewport, h.nodes.current);
    const bView = { x: -50, y: 80, zoom: 0.8 };
    h.api.restore(b, saved(bView), ['node']);
    abandoned(0);
    await tick(2);
    expect(h.setViewport).toHaveBeenCalledTimes(1);
    expect(h.setViewport).toHaveBeenCalledWith(bView, { duration: 0 });
  });

  it('사용자가 직접 이동하면 대기 중 복원을 취소하고 그 자리를 기억한다', async () => {
    const h = mount();
    h.api.restore(h.key, saved(), ['node']);
    await tick();
    const abandoned = [...frames.values()][0]!;
    h.viewport = { x: -90, y: 110, zoom: 0.6 };
    h.api.rememberViewport(new Event('mouseup') as MouseEvent, h.viewport);
    abandoned(0);
    await tick(2);
    expect(h.setViewport).not.toHaveBeenCalled();
    expect(h.api.memory.read(h.key)?.viewport).toEqual(h.viewport);
    expect(h.api.memory.settled).toBe(true);
  });

  it('자동 이동 이벤트는 아직 복원되지 않은 화면을 저장하지 않는다', async () => {
    const h = mount();
    h.api.restore(h.key, saved(), ['node']);
    h.api.rememberViewport(null, h.viewport);
    expect(h.api.memory.read(h.key)).toBeUndefined();
    await tick(2);
    expect(h.setViewport).toHaveBeenCalledWith(SAVED_VIEW, { duration: 0 });
  });

  it('언마운트가 예약을 취소하며 마지막 화면은 재마운트해도 남는다', async () => {
    const h = mount();
    h.api.restore(h.key, saved(), ['node']);
    await tick(2);
    h.viewport = { x: 500, y: -400, zoom: 1.6 };
    h.api.restore(h.key, saved(), ['node']);
    await tick();
    const abandoned = [...frames.values()][0]!;
    h.unmount();
    abandoned(0);
    await tick(2);
    expect(h.setViewport).toHaveBeenCalledTimes(1);
    const remounted = mount(h.key);
    const restored = remounted.api.memory.read(h.key);
    expect(restored?.viewport).toEqual(h.viewport);
    remounted.api.restore(h.key, restored, ['node']);
    await tick(2);
    expect(remounted.setViewport).toHaveBeenCalledWith(h.viewport, { duration: 0 });
  });
});
