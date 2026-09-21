import { useCallback, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import { getViewportForBounds, type Node, type ReactFlowInstance, type Viewport } from '@xyflow/react';
import { CanvasViewMemory, type CanvasViewSnapshot } from './canvasViewMemory.js';

interface CanvasViewportOptions {
  viewKey: string | null;
  ready: boolean;
  mobileZoom: boolean;
  flow: MutableRefObject<ReactFlowInstance | null>;
  nodes: MutableRefObject<Node[]>;
  container: MutableRefObject<HTMLDivElement | null>;
}

const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
const VIEW_FIT = { duration: 0, padding: 0.25, maxZoom: 2 };
const MOBILE_MAX_ZOOM = 1.2;
const MIN_ZOOM = 0.5;
const MOBILE_MIN_ZOOM = 0.1;
interface ViewFitOptions { duration: number; padding: number }

interface CanvasViewportActions {
  memory: CanvasViewMemory;
  restore: (key: string, saved: CanvasViewSnapshot | undefined, expectedIds: string[], fitOptions?: ViewFitOptions) => void;
  cancelRestore: () => void;
  rememberViewport: (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void;
}

/** Window-local camera memory; a loading/abandoned view never owns another view's camera. */
export function useCanvasViewport({ viewKey, ready, mobileZoom, flow, nodes, container }: CanvasViewportOptions): CanvasViewportActions {
  const memoryRef = useRef<CanvasViewMemory>();
  if (!memoryRef.current) memoryRef.current = new CanvasViewMemory();
  const memory = memoryRef.current;
  const latest = useRef({ viewKey, ready, mobileZoom });
  latest.current = { viewKey, ready, mobileZoom };
  const frames = useRef({ outer: 0, inner: 0, generation: 0 });
  const pending = useRef<{ key: string; expectedIds: string[] } | null>(null);

  const cancelRestore = useCallback((): void => {
    cancelAnimationFrame(frames.current.outer);
    cancelAnimationFrame(frames.current.inner);
    frames.current.generation += 1;
    pending.current = null;
  }, []);

  const restore = useCallback((key: string, saved: CanvasViewSnapshot | undefined, expectedIds: string[], fitOptions: ViewFitOptions = VIEW_FIT): void => {
    // Live snapshots can arrive every frame. Update the target nodes without restarting the
    // two-frame wait, otherwise a busy project could postpone its camera restore forever.
    if (pending.current?.key === key && fitOptions === VIEW_FIT) {
      pending.current.expectedIds = expectedIds;
      return;
    }
    cancelRestore();
    const request = { key, expectedIds };
    pending.current = request;
    const generation = frames.current.generation;
    const isCurrent = (): boolean => generation === frames.current.generation
      && latest.current.viewKey === key && latest.current.ready && memory.key === key;
    // ReactFlow must first commit the new nodes and observe the canvas size after dock changes.
    const apply = (): void => {
      if (!isCurrent()) {
        if (pending.current === request) pending.current = null;
        return;
      }
      const instance = flow.current;
      const element = container.current;
      const rendered = instance?.getNodes().filter((node) => !node.hidden) ?? [];
      const renderedIds = new Set(rendered.map((node) => node.id));
      // Wait for actual commit/measurement, not a timer guessing when remote data will arrive.
      if (!instance || !element?.clientWidth || !element.clientHeight
        || request.expectedIds.some((id) => !renderedIds.has(id))
        || (!saved && rendered.some((node) => !(node.measured?.width ?? node.width) || !(node.measured?.height ?? node.height)))) {
        frames.current.inner = requestAnimationFrame(apply);
        return;
      }
      const viewport = saved?.viewport ?? (rendered.length === 0 ? INITIAL_VIEWPORT : getViewportForBounds(
        instance.getNodesBounds(rendered), element.clientWidth, element.clientHeight,
        latest.current.mobileZoom ? MOBILE_MIN_ZOOM : MIN_ZOOM,
        latest.current.mobileZoom ? MOBILE_MAX_ZOOM : VIEW_FIT.maxZoom, fitOptions.padding,
      ));
      // fitView queues a later fit inside ReactFlow. Compute now so an abandoned view cannot
      // move the camera after this generation has been cancelled.
      void instance.setViewport(viewport, { duration: saved ? 0 : fitOptions.duration }).then((applied) => {
        if (pending.current === request) pending.current = null;
        if (!applied || !isCurrent()) return;
        memory.settle(key);
        memory.remember(instance.getViewport(), nodes.current);
      }).catch((error: unknown) => {
        if (pending.current === request) pending.current = null;
        console.error('[canvasViewport] restore failed', error);
      });
    };
    frames.current.outer = requestAnimationFrame(() => {
      frames.current.inner = requestAnimationFrame(apply);
    });
  }, [cancelRestore, container, flow, memory, nodes]);

  const rememberViewport = useCallback((event: MouseEvent | TouchEvent | null, viewport: Viewport): void => {
    const current = latest.current;
    if (!current.ready || !current.viewKey || current.viewKey !== memory.key) return;
    if (event) {
      // A deliberate pan/zoom wins over an automatic restore queued in this same frame.
      cancelRestore();
      memory.settle(current.viewKey);
    }
    memory.remember(viewport, nodes.current);
  }, [cancelRestore, memory, nodes]);

  useLayoutEffect(() => () => {
    cancelRestore();
    // Layout cleanup runs before ReactFlow tears down its viewport (preview/stub tab switch).
    memory.leave(flow.current?.getViewport(), nodes.current);
  }, [cancelRestore, flow, memory, nodes]);

  return { memory, restore, cancelRestore, rememberViewport };
}
