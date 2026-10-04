import { ReactFlow, type Edge, type Node, type ReactFlowProps } from '@xyflow/react';
import { useSelectionFocus } from './useSelectionFocus.js';

const NO_NODES: Node[] = [];
const NO_EDGES: Edge[] = [];

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
export function SelectionFocusFlow({ nodes, edges, onNodesChange, ...rest }: SelectionFocusFlowProps): React.JSX.Element {
  const focused = useSelectionFocus(nodes ?? NO_NODES, edges ?? NO_EDGES);
  return <ReactFlow {...rest} nodes={focused.nodes} edges={focused.edges} onNodesChange={onNodesChange} />;
}
