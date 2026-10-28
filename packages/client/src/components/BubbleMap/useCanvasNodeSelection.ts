import { useMemo } from 'react';
import { useStoreApi } from '@xyflow/react';
import { useGraphStore } from '../../stores/graphStore.js';
import { canvasSelectionChanges, type CanvasSelectMode } from './canvasMultiSelect.js';

/** 노드 하나가 캔버스 묶음을 바꾸는 손잡이 두 개(§6). */
export interface CanvasNodeSelection {
  /** 보통 클릭 — 묶음을 이 노드 하나로 바꾼다. */
  readonly replace: () => void;
  /** 빼는 노드가 선택 링(`selectIntentId`)을 들고 있었으면 링도 내린다 — 묶음에서 나간 버블에 "고른 것" 표시가 남지 않게. */
  readonly toggle: () => void;
}

/**
 * 노드가 **자기가 그려진 캔버스의** React Flow 스토어로 묶음을 바꾼다 — 다른 캔버스(오버레이·디버그)의 같은 버블이 메인 묶음을 건드리지 않게.
 * 변경은 박스 선택과 같은 `select` 꼴로 `onNodesChange` 에 실린다.
 * @param nodeId React Flow 노드 id(위성은 `sat-` 그대로). `null` 이면 아무것도 하지 않는다.
 * @param ringId 선택 링 id(`selectIntentId` 모양 — 위성은 `sat-` 를 뗀 것).
 */
export function useCanvasNodeSelection(nodeId: string | null, ringId: string | null = nodeId): CanvasNodeSelection {
  const store = useStoreApi();
  return useMemo(() => {
    const apply = (mode: CanvasSelectMode): void => {
      if (nodeId === null) return;
      const s = store.getState();
      const wasSelected = s.nodeLookup.get(nodeId)?.selected === true;
      const changes = canvasSelectionChanges(s.nodeLookup.values(), s.edgeLookup.values(), nodeId, mode);
      // 클릭으로 고르면 박스 선택이 남긴 묶음 상자 상태를 내린다 — React Flow 가 노드 클릭에서 하는 것과 같다.
      store.setState({ nodesSelectionActive: false });
      if (changes.nodes.length > 0) s.triggerNodeChanges(changes.nodes);
      if (changes.edges.length > 0) s.triggerEdgeChanges(changes.edges);
      if (mode === 'toggle' && wasSelected && ringId !== null) {
        const g = useGraphStore.getState();
        if (g.selectIntentId === ringId) g.setSelectIntent(null);
      }
    };
    return { replace: () => apply('replace'), toggle: () => apply('toggle') };
  }, [store, nodeId, ringId]);
}
