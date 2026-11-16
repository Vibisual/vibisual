import { useEffect, useRef } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useGraphStore, selectEffectiveProject } from '../../stores/graphStore.js';
import { useCanvasMemoLinks } from '../IDE/useCanvasMemoLinks.js';
import { SessionMemoLayer } from '../IDE/SessionMemoLayer.js';
import { CANVAS_MEMO_DROP_EVENT, canvasMemoExitPoint, type CanvasMemoDropRequest } from '../IDE/canvasMemoTransfer.js';

const consume = (): void => {};

export function CanvasMemoLayer(): React.JSX.Element | null {
  const project = useGraphStore(selectEffectiveProject);
  const folderId = useGraphStore((s) => s.currentFolderId);
  const interiorView = useGraphStore((s) => s.interiorView);
  const { screenToFlowPosition } = useReactFlow();
  const { x, y, zoom } = useViewport();
  const canvasLinkHost = useCanvasMemoLinks(project);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const drop = (event: Event): void => {
      if (!(event instanceof CustomEvent) || !project || interiorView) return;
      const detail = (event as CustomEvent<CanvasMemoDropRequest>).detail;
      const canvas = ref.current?.closest('.react-flow');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const probe = detail.exit
        ? canvasMemoExitPoint(detail.exit, { x: rect.left, y: rect.top, w: rect.width, h: rect.height })
        : detail.pointer;
      if (!probe) return;
      const hit = document.elementFromPoint(probe.x, probe.y);
      if (!hit || (hit.closest('.react-flow') !== canvas && hit !== detail.exit?.backdrop)) return;
      const point = screenToFlowPosition(detail.position);
      detail.destination = { project, folderId, ...point };
    };
    window.addEventListener(CANVAS_MEMO_DROP_EVENT, drop);
    return () => window.removeEventListener(CANVAS_MEMO_DROP_EVENT, drop);
  }, [project, folderId, interiorView, screenToFlowPosition]);
  if (!project || interiorView) return null;
  return (
    // 확대되는 viewport 안에 넣으면 카드·글자까지 커진다. 위치만 화면 좌표로 바꾼다.
    <div ref={ref} className="pointer-events-none absolute z-[4] nodrag nopan" style={{ left: x, top: y }} data-canvas-memo-surface="">
      <SessionMemoLayer key={project} agentId="" sessionId={null} containerRef={ref}
        spawnAt={null} onSpawnConsumed={consume} spreadRequest={null} onSpreadConsumed={consume}
        canvasLinkHost={canvasLinkHost} canvas={{ project, folderId, scale: zoom }} />
    </div>
  );
}
