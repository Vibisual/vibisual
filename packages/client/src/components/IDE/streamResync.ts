/**
 * 재연결 뒤 끊긴 동안의 스트림 줄을 다시 채운다(`hooks/reconnectResync.ts`). 새 연결은 스냅샷만 받아 그 사이 줄이 다시 오지 않는다.
 * 창 활성 세션은 깊은 복원 표식으로 창이 스스로 · 메인 탭은 에이전트 벌크 · 분할 초점 밖 칸은 여기서 그 세션 깊은 창을 받는다(`streamResyncTargets`).
 */
import type { SubAgentStreamEvent } from '@vibisual/shared';
import {
  useGraphStore,
  selectRenderedIDEPanes,
  type IDEOverlayState,
  type IDESplitState,
} from '../../stores/graphStore.js';
import { listCells } from './splitLayout.js';
import { resyncDeepWindow } from './streamHistory.js';
import { restoreStreamWindow } from './streamRestore.js';

export interface StreamResyncTargets {
  /** 메인 탭을 그리는 에이전트 — 에이전트 벌크(`GET /api/subagent-streams/:agentId`)를 다시 받는다. */
  bulkAgentIds: string[];
  /** 분할의 초점 밖 칸이 그리는 세션 — 그 세션의 깊은 창을 다시 받는다. */
  deepCells: { agentId: string; sessionId: string }[];
}

export function streamResyncTargets(input: {
  overlays: readonly Pick<IDEOverlayState, 'paneKey' | 'agentId' | 'activeSessionId'>[];
  /** 지금 화면에 그려지는 창. 안 그려지는 창은 다시 그려질 때 제 메인 탭 벌크를 스스로 받는다. */
  renderedPaneKeys: ReadonlySet<string>;
  splits: Readonly<Record<string, Pick<IDESplitState, 'agentId' | 'layout'>>>;
  isCustomAgent: (agentId: string) => boolean;
}): StreamResyncTargets {
  const bulk = new Set<string>();
  const deep = new Map<string, { agentId: string; sessionId: string }>();
  for (const ov of input.overlays) {
    const agentId = ov.agentId;
    if (!agentId) continue;
    // 메인 탭은 훅 버블에만 있다(`IDETabBar`). 커스텀 버블은 열리자마자 첫 세션이 골라진다.
    const drawsMainTab = input.renderedPaneKeys.has(ov.paneKey) && !input.isCustomAgent(agentId);
    if (drawsMainTab && ov.activeSessionId === null) bulk.add(agentId);
    const split = input.splits[ov.paneKey];
    // 창이 다른 버블로 갈아 끼워졌으면 남은 분할은 남의 것이다(`IDESplitView` 와 같은 판정).
    if (!split || split.agentId !== agentId) continue;
    for (const cell of listCells(split.layout)) {
      if (cell.sessionId === null) {
        if (drawsMainTab) bulk.add(agentId);
        continue;
      }
      // 창의 활성 세션은 창의 깊은 복원이 표식을 보고 다시 받는다 — 겹쳐 받지 않는다.
      if (cell.sessionId === ov.activeSessionId) continue;
      deep.set(cell.sessionId, { agentId, sessionId: cell.sessionId });
    }
  }
  return { bulkAgentIds: [...bulk], deepCells: [...deep.values()] };
}

export function resyncOpenStreams(): void {
  const st = useGraphStore.getState();
  st.markStreamsStale();
  const epoch = useGraphStore.getState().streamRestoreEpoch;
  const targets = streamResyncTargets({
    overlays: Object.values(st.ideOverlays),
    renderedPaneKeys: new Set(selectRenderedIDEPanes(st).map((o) => o.paneKey)),
    splits: st.ideSplits,
    isCustomAgent: (id) => st.nodeMap[id]?.customCreated === true,
  });
  for (const agentId of targets.bulkAgentIds) {
    fetch(`/api/subagent-streams/${encodeURIComponent(agentId)}`)
      .then((r) => r.json())
      .then(async (data: { streams?: Record<string, SubAgentStreamEvent[]> }) => {
        await Promise.all(Object.entries(data.streams ?? {}).map(([sid, events]) =>
          restoreStreamWindow(agentId, sid, events, { epoch, depth: 'shallow' })));
      })
      .catch(() => {});
  }
  for (const cell of targets.deepCells) resyncDeepWindow(cell.agentId, cell.sessionId);
}
