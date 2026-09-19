/**
 * 재연결 뒤 **끊겨 있던 동안의 스트림 줄을 다시 채운다** (`hooks/reconnectResync.ts` 가 부른다).
 *
 * 스트림 줄은 WS 로만 흐르고 새 연결은 스냅샷만 받으므로, 끊긴 사이의 줄은 다시 오지 않는다. 버퍼는
 * 끊기기 전 줄 다음에 다시 붙은 뒤의 줄이 곧장 이어져 **가운데가 빈다** — 폰 화면을 껐다 켜면 글이
 * 중간에서 끊겨 멈춘 것처럼 보이던 까닭이다. 그리는 자리마다 다시 받는 길이 다르다.
 *
 * 1) 창의 활성 세션 — 깊은 복원 표식을 내리면 창(`AgentIDEOverlay`)이 스스로 다시 받는다
 *    (`mergeDeepWindow` 가 가운데를 메운다).
 * 2) 메인 탭(전 세션 합본) — 에이전트 벌크를 다시 받는다. 얕은 적재가 빠진 줄을 서버 순서대로 끼운다.
 * 3) 분할의 초점 밖 칸 — 창은 활성 세션만 챙기므로 그 세션의 깊은 창을 여기서 받는다.
 *
 * 무엇을 받을지 고르는 판정은 순수 함수(`streamResyncTargets`)라 DOM 없이 시험한다.
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
  const targets = streamResyncTargets({
    overlays: Object.values(st.ideOverlays),
    renderedPaneKeys: new Set(selectRenderedIDEPanes(st).map((o) => o.paneKey)),
    splits: st.ideSplits,
    isCustomAgent: (id) => st.nodeMap[id]?.customCreated === true,
  });
  for (const agentId of targets.bulkAgentIds) {
    fetch(`/api/subagent-streams/${encodeURIComponent(agentId)}`)
      .then((r) => r.json())
      .then((data: { streams?: Record<string, SubAgentStreamEvent[]> }) => {
        if (data.streams) useGraphStore.getState().loadStreamBuffers(data.streams, 'shallow');
      })
      .catch(() => {});
  }
  for (const cell of targets.deepCells) resyncDeepWindow(cell.agentId, cell.sessionId);
}
