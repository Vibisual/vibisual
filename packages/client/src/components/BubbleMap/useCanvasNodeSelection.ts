import { useMemo } from 'react';
import { useStoreApi } from '@xyflow/react';
import { useGraphStore } from '../../stores/graphStore.js';
import { canvasSelectionChanges, type CanvasSelectMode } from './canvasMultiSelect.js';

/** 노드 하나가 캔버스 묶음을 바꾸는 손잡이 두 개(§6). */
export interface CanvasNodeSelection {
  /** 보통 클릭 — 묶음을 이 노드 하나로 바꾼다. */
  readonly replace: () => void;
  /**
   * 수식 키 클릭 — 이 노드를 묶음에 넣거나 뺀다. 빼는 노드가 선택 링(`selectIntentId`)을 들고 있었으면
   * 링도 내린다 — 묶음에서 나간 버블에 "지금 고른 것" 표시가 남지 않게.
   */
  readonly toggle: () => void;
}

/**
 * 노드 컴포넌트가 **자기가 그려진 캔버스의** React Flow 스토어로 묶음을 바꾼다.
 *
 * 변경은 박스 선택과 같은 꼴(`select`)로 `onNodesChange` 에 실려 캔버스가 한 창구에서 받는다 — 일반
 * 버블은 노드 배열에, store 가 좌표를 쥔 노드는 캔버스의 묶음 집합에 들어간다(`BubbleMap`).
 * 스토어는 React Flow 가 노드를 그리는 그 인스턴스의 것이라, 오버레이 위젯·디버그 판처럼 다른 캔버스에
 * 그려진 같은 버블이 메인 캔버스의 묶음을 건드리지 않는다.
 *
 * @param nodeId React Flow 노드 id(위성은 `sat-` 그대로). `null` 이면 두 손잡이가 아무것도 하지 않는다.
 * @param ringId 이 노드의 선택 링 id(`selectIntentId` 와 같은 모양 — 위성은 `sat-` 를 뗀 것).
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
