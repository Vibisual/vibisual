import { useCallback } from 'react';
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
 * §5.4 #31 (K) — React Flow with the selection focus applied.
 *
 * **Why a separate component**: the focus listens to the selection ring, the double-click wait and the
 * link phase, all of which change on a single click or hover. Subscribed inside `BubbleMap`, each of them
 * re-ran the whole canvas body (node assembly included) right as the fade had to start — the same reason
 * `LinkFocusHint` lives on its own. Here only this wrapper and React Flow wake up.
 */
export function SelectionFocusFlow({
  nodes, edges, onNodesChange, onSelectionStart, onPaneClick, onNodeDragStart, onKeyDownCapture,
  ...rest
}: SelectionFocusFlowProps): React.JSX.Element {
  const focused = useSelectionFocus(nodes ?? NO_NODES, edges ?? NO_EDGES);
  const handleSelectionStart = useCallback<NonNullable<ReactFlowProps['onSelectionStart']>>((event) => {
    // React Flow calls this when a marquee actually starts moving, not on a bubble click. Native
    // selected flags also change during clicks, so they cannot reliably identify a marquee instead.
    clearSelectionFocus();
    onSelectionStart?.(event);
  }, [onSelectionStart]);
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
    onSelectionStart={handleSelectionStart} onPaneClick={handlePaneClick} onNodeDragStart={handleNodeDragStart}
    onKeyDownCapture={handleKeyDownCapture} />;
}
