import { memo, useEffect, useRef, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  type Node,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
  MarkerType,
} from '@xyflow/react';
import type { EdgeTypes } from '@xyflow/react';
import type { BubbleData, ActivityEdge } from '@vibisual/shared';
import { BUBBLE_COLORS, EDGE_STYLE } from '@vibisual/shared';
import { BubbleNode } from '../BubbleMap/BubbleNode.js';
import { CurvedEdge } from '../BubbleMap/CurvedEdge.js';
import { calcBubbleSize } from '../../utils/sizeCalc.js';
import { useGraphStore } from '../../stores/graphStore.js';

const nodeTypes: NodeTypes = { bubble: BubbleNode };
const edgeTypes: EdgeTypes = { curved: CurvedEdge };

interface DebugPanelProps {
  onClose: () => void;
}

function formatClockTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/** 렌더 FPS 실시간 측정 — requestAnimationFrame 프레임을 1초 창으로 집계. 표시 전용(성능에 영향 없음). */
function useRenderFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const loop = (now: number): void => {
      frames += 1;
      const elapsed = now - last;
      if (elapsed >= 1000) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

function buildEdge(e: ActivityEdge, allBubbles: BubbleData[]): Edge {
  const find = (id: string): BubbleData | undefined => allBubbles.find((b) => b.id === id);
  const srcB = find(e.source);
  const tgtB = find(e.target);
  const color = srcB ? BUBBLE_COLORS[srcB.bubbleType] : '#64748b';
  const strokeColor = e.isActive ? `${color}${EDGE_STYLE.activeOpacity}` : EDGE_STYLE.inactiveColor;
  const strokeWidth = e.isActive ? EDGE_STYLE.activeWidth : EDGE_STYLE.inactiveWidth;
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: 'src',
    targetHandle: 'tgt',
    type: 'curved',
    animated: e.isActive,
    label: e.label,
    labelStyle: { fill: e.isActive ? '#e2e8f0' : '#64748b', fontSize: 9, fontWeight: e.isActive ? 600 : 400 },
    labelBgStyle: { fill: '#0f172a', fillOpacity: 0.9 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 3,
    data: { sourceRadius: srcB ? calcBubbleSize(srcB) / 2 : 30, targetRadius: tgtB ? calcBubbleSize(tgtB) / 2 : 30 },
    style: { stroke: strokeColor, strokeWidth },
    markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor, width: 10, height: 10 },
  };
}

function DebugPanelImpl({ onClose }: DebugPanelProps): React.JSX.Element {
  const { t } = useTranslation();
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const fps = useRenderFps();
  const storeAgents = useGraphStore((s) => s.agents);
  const storeTopFolders = useGraphStore((s) => s.topFolders);
  const storeEdges = useGraphStore((s) => s.edges);
  const activeProject = useGraphStore((s) => s.activeProject);
  const currentProject = useGraphStore((s) => s.currentProject);
  const agentProjects = useGraphStore((s) => s.agentProjects);
  const nodeProjects = useGraphStore((s) => s.nodeProjects);
  // §4 v1.98 — 진단 에러 로그 (renderer·main·server 통합). 서버가 SSOT, 여기선 표시만.
  const diagnosticLog = useGraphStore((s) => s.diagnosticLog);

  const { nodes, edges, counts } = useMemo(() => {
    const agentList = storeAgents.filter((a) => !activeProject || agentProjects[a.id] === activeProject);
    const nodeList = storeTopFolders.filter((n) => !activeProject || nodeProjects[n.id] === activeProject);
    const nodeIdSet = new Set([...agentList.map((a) => a.id), ...nodeList.map((n) => n.id)]);
    const edgeList = storeEdges.filter((e) => nodeIdSet.has(e.source) || nodeIdSet.has(e.target));
    const counts = { agents: agentList.length, nodes: nodeList.length, edges: edgeList.length };

    if (agentList.length === 0 && nodeList.length === 0) return { nodes: [] as Node[], edges: [] as Edge[], counts };

    const allBubbles = [...agentList, ...nodeList];
    const cx = 300;
    const cy = 300;

    const agentNodes: Node[] = agentList.map((a, i) => {
      const angle = (2 * Math.PI * i) / Math.max(agentList.length, 1) - Math.PI / 2;
      const r = agentList.length > 1 ? 60 : 0;
      const size = calcBubbleSize(a);
      const fallback = { x: cx + Math.cos(angle) * r - size / 2, y: cy + Math.sin(angle) * r - size / 2 };
      const saved = a.position && (a.position.x !== 0 || a.position.y !== 0) ? a.position : undefined;
      return {
        id: a.id,
        type: 'bubble',
        position: saved ?? fallback,
        data: { ...a },
      };
    });

    const orbitR = 150 + nodeList.length * 15;
    const fileNodes: Node[] = nodeList.map((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(nodeList.length, 1) - Math.PI / 2;
      const size = calcBubbleSize(n);
      const fallback = { x: cx + Math.cos(angle) * orbitR - size / 2, y: cy + Math.sin(angle) * orbitR - size / 2 };
      const saved = n.position && (n.position.x !== 0 || n.position.y !== 0) ? n.position : undefined;
      return {
        id: n.id,
        type: 'bubble',
        position: saved ?? fallback,
        data: { ...n },
      };
    });

    const flowEdges = edgeList.map((e) => buildEdge(e, allBubbles));
    return { nodes: [...agentNodes, ...fileNodes], edges: flowEdges, counts };
  }, [storeAgents, storeTopFolders, storeEdges, activeProject, agentProjects, nodeProjects]);

  useEffect(() => {
    if (!rfRef.current || nodes.length === 0) return;
    requestAnimationFrame(() => rfRef.current?.fitView({ padding: 0.15, duration: 0 }));
  }, [nodes.length]);

  // 최신이 위로 — diagnosticLog 는 append 순(오래된 것이 앞).
  const logNewestFirst = useMemo(() => [...diagnosticLog].reverse(), [diagnosticLog]);

  const fpsColor = fps >= 50 ? 'text-emerald-400' : fps >= 30 ? 'text-amber-400' : fps > 0 ? 'text-red-400' : 'text-gray-500';

  return (
    <aside className="flex h-full w-80 flex-shrink-0 flex-col border-r border-gray-800 bg-gray-900">
      {/* Header (fixed) */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-800 px-4 py-3">
        <h2 className="text-sm font-bold text-gray-100">{t('panel.debugPanel.title')}</h2>
        <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-800 hover:text-gray-200" aria-label={t('panel.debugPanel.close')}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">

      {/* Project & Performance frame — 현재 프로젝트 메타 + 실시간 렌더 FPS */}
      <div className="flex flex-col gap-2 border-b border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">{t('panel.debugPanel.project')}</span>
          <span className={`flex items-center gap-1 font-mono text-[10px] ${fpsColor}`} title={t('panel.debugPanel.fpsTip')}>
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
            <span className="tabular-nums">{fps}</span>
            <span className="uppercase tracking-wide text-gray-500">{t('panel.debugPanel.fps')}</span>
          </span>
        </div>

        <div className="rounded border border-gray-800 bg-gray-950 p-3">
          {activeProject ? (
            <dl className="flex flex-col gap-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="flex-shrink-0 text-gray-500">{t('panel.debugPanel.projectName')}</dt>
                <dd className="truncate font-mono text-gray-200">{currentProject?.name ?? activeProject}</dd>
              </div>
              {currentProject?.path && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex-shrink-0 text-gray-500">{t('panel.debugPanel.projectPath')}</dt>
                  <dd className="truncate font-mono text-gray-400" title={currentProject.path}>{currentProject.path}</dd>
                </div>
              )}
              <div className="mt-1 grid grid-cols-3 gap-2 border-t border-gray-800/60 pt-2 text-center">
                <div>
                  <div className="font-mono text-sm tabular-nums text-gray-200">{counts.agents}</div>
                  <div className="text-[9px] uppercase tracking-wide text-gray-500">{t('panel.debugPanel.agents')}</div>
                </div>
                <div>
                  <div className="font-mono text-sm tabular-nums text-gray-200">{counts.nodes}</div>
                  <div className="text-[9px] uppercase tracking-wide text-gray-500">{t('panel.debugPanel.nodes')}</div>
                </div>
                <div>
                  <div className="font-mono text-sm tabular-nums text-gray-200">{counts.edges}</div>
                  <div className="text-[9px] uppercase tracking-wide text-gray-500">{t('panel.debugPanel.edges')}</div>
                </div>
              </div>
            </dl>
          ) : (
            <p className="py-2 text-center text-[11px] text-gray-600">{t('panel.debugPanel.noProject')}</p>
          )}
        </div>
      </div>

      {/* §4 v1.98 — Error Log (renderer · main · server 통합) */}
      <div className="flex flex-col gap-1.5 border-b border-gray-800 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">{t('panel.debugPanel.errorLog')}</span>
          {logNewestFirst.length > 0 && (
            <span className="font-mono text-[10px] text-gray-600">{logNewestFirst.length}</span>
          )}
        </div>

        <div className="scrollbar-thin max-h-80 overflow-y-auto rounded border border-gray-800 bg-gray-950">
          {logNewestFirst.length === 0 ? (
            <p className="px-3 py-4 text-center text-[11px] text-gray-600">{t('panel.debugPanel.noErrors')}</p>
          ) : (
            logNewestFirst.map((e) => (
              <div key={e.id} className="border-b border-gray-800/60 px-2.5 py-1.5 last:border-b-0">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${e.level === 'error' ? 'bg-red-500' : 'bg-amber-400'}`} />
                  <span className="rounded bg-gray-800 px-1 font-mono text-[9px] uppercase text-gray-400">{e.source}</span>
                  <span className="font-mono text-[9px] text-gray-600">{formatClockTime(e.ts)}</span>
                </div>
                <p className={`mt-0.5 break-words font-mono text-[11px] leading-snug ${e.level === 'error' ? 'text-red-300' : 'text-amber-200'}`}>
                  {e.message}
                </p>
                {e.stack && (
                  <pre className="scrollbar-thin mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-1.5 font-mono text-[9px] leading-snug text-gray-500">
                    {e.stack}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* State Bubble Map */}
      <div className="p-4">
        <div className="aspect-square w-full overflow-hidden rounded border border-gray-800 bg-gray-950">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(i) => { rfRef.current = i; i.fitView({ padding: 0.15 }); }}
          defaultEdgeOptions={{ style: { stroke: EDGE_STYLE.inactiveColor, strokeWidth: EDGE_STYLE.inactiveWidth }, type: 'curved' }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          className="bg-gray-950"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e293b" />
        </ReactFlow>
        </div>
      </div>

      </div>
    </aside>
  );
}

/**
 * onClose 는 App 에서 useCallback 으로 안정 참조를 넘기므로, memo 가 App 의 잦은 리렌더 전파를 끊는다.
 * DebugPanel 은 자체 store 구독으로만 갱신 → 켜져 있을 때의 발발거림 완화. 꺼지면 App 이 언마운트(비용 0).
 */
export const DebugPanel = memo(DebugPanelImpl);
