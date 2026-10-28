import { useCallback, useEffect, useState } from 'react';
import { ReactFlow, type Edge, type Node, type ReactFlowProps } from '@xyflow/react';
import { useGraphStore } from '../../stores/graphStore.js';
import { cancelDeferredBubbleSelect } from './bubbleSelectGesture.js';
import { selectionIdentityIds } from './selectionFocus.js';
import { useSelectionFocus } from './useSelectionFocus.js';

const NO_NODES: Node[] = [];
const NO_EDGES: Edge[] = [];

function clearSelectionFocus(): void {
  useGraphStore.getState().setSelectIntent(null);
  cancelDeferredBubbleSelect();
}

/**
 * The focus hands React Flow re-wrapped node objects, so the measured sizes must keep coming back
 * through `onNodesChange` — without it the handles lose their bounds and the edges vanish
 * (§5.5 #17-17 ⑳(g)). Required here so no caller can drop it.
 */
type SelectionFocusFlowProps = ReactFlowProps & Required<Pick<ReactFlowProps, 'onNodesChange'>>;

/**
 * §5.4 #31 (K) — React Flow with the selection focus applied. A separate component because its inputs (selection ring, double-click wait,
 * link phase) change on every click or hover; inside `BubbleMap` they re-ran the whole canvas body as the fade started (same reason as `LinkFocusHint`).
 */
export function SelectionFocusFlow({
  nodes, edges, onNodesChange, onSelectionStart, onSelectionEnd, onPaneClick, onNodeDragStart, onKeyDownCapture,
  ...rest
}: SelectionFocusFlowProps): React.JSX.Element {
  /**
   * §6 — 박스 선택 중에만 RF 가 노드를 고른다(`marquee`). `onSelectionEnd` 는 창 밖에서 떼거나 포커스를 잃으면 안 올 수 있어
   * 손을 뗀 모든 순간에 함께 내린다(굳으면 클릭마다 RF 가 스스로 고른다).
   */
  const [marquee, setMarquee] = useState(false);
  useEffect(() => {
    if (!marquee || typeof window === 'undefined') return;
    const end = (): void => setMarquee(false);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
    };
  }, [marquee]);
  const focused = useSelectionFocus(nodes ?? NO_NODES, edges ?? NO_EDGES, marquee);
  const handleSelectionStart = useCallback<NonNullable<ReactFlowProps['onSelectionStart']>>((event) => {
    // React Flow calls this when a marquee actually starts moving, not on a bubble click. Native
    // selected flags also change during clicks, so they cannot reliably identify a marquee instead.
    clearSelectionFocus();
    setMarquee(true);
    onSelectionStart?.(event);
  }, [onSelectionStart]);
  const handleSelectionEnd = useCallback<NonNullable<ReactFlowProps['onSelectionEnd']>>((event) => {
    setMarquee(false);
    onSelectionEnd?.(event);
  }, [onSelectionEnd]);
  const handlePaneClick = useCallback<NonNullable<ReactFlowProps['onPaneClick']>>((event) => {
    clearSelectionFocus();
    onPaneClick?.(event);
  }, [onPaneClick]);
  const handleNodeDragStart = useCallback<NonNullable<ReactFlowProps['onNodeDragStart']>>((event, node, dragged) => {
    const state = useGraphStore.getState();
    // Dragging another bubble selects it natively without ever completing the click gesture.
    // Keep the current focus when its own bubble (or satellite/preview) is being moved.
    if (selectionIdentityIds([node], state.selectIntentId, state.currentFolderId).length === 0) clearSelectionFocus();
    onNodeDragStart?.(event, node, dragged);
  }, [onNodeDragStart]);
  const handleKeyDownCapture = useCallback<NonNullable<ReactFlowProps['onKeyDownCapture']>>((event) => {
    onKeyDownCapture?.(event);
    const target = event.target as HTMLElement;
    // React Flow's keyboard selection runs on the node wrapper itself. Editing text or pressing a
    // button inside a bubble must not clear focus. Native keyboard selection owns its own highlight.
    if (!event.defaultPrevented && !rest.disableKeyboardA11y && rest.elementsSelectable !== false
      && (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape')
      && target.matches?.('.react-flow__node.selectable')) clearSelectionFocus();
  }, [onKeyDownCapture, rest.disableKeyboardA11y, rest.elementsSelectable]);
  return <ReactFlow {...rest} nodes={focused.nodes} edges={focused.edges} onNodesChange={onNodesChange}
    onSelectionStart={handleSelectionStart} onSelectionEnd={handleSelectionEnd} onPaneClick={handlePaneClick}
    onNodeDragStart={handleNodeDragStart} onKeyDownCapture={handleKeyDownCapture} />;
}
