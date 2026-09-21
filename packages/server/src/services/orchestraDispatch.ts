/** Orchestra uses the existing task-edge round trip, including its result ledger. */
import type { OrchestraRun, QueuedCommand, TaskEdge } from '@vibisual/shared';

interface OrchestraEdgeGraph {
  getTaskEdgesSnapshot(): Record<string, TaskEdge>;
  createTaskEdge(source: string, target: string, command: string, mode: 'manual', template: null,
    options: { kind: 'command'; returnFormat: 'both' }): TaskEdge;
  updateTaskEdge(id: string, updates: { returnFormat: 'both' }): TaskEdge | null;
}

/** Old plans used summary-only edges, which bypassed the existing result-receipt guard. */
export function ensureOrchestraMemberReturns(graph: OrchestraEdgeGraph, memberAgentIds: readonly string[]): void {
  const members = new Set(memberAgentIds);
  for (const edge of Object.values(graph.getTaskEdgesSnapshot())) {
    if (!members.has(edge.sourceAgentId) || !members.has(edge.targetAgentId)
      || (edge.kind ?? 'command') !== 'command' || (edge.bundleRole ?? 'primary') !== 'primary') continue;
    graph.updateTaskEdge(edge.id, { returnFormat: 'both' });
  }
}

/** Reuse a real return-capable edge; never overwrite an unrelated user edge's contract. */
export function ensureOrchestraEntryEdge(graph: OrchestraEdgeGraph, run: Pick<OrchestraRun, 'agentId'>, entryAgentId: string): TaskEdge {
  const existing = Object.values(graph.getTaskEdgesSnapshot()).find((edge) =>
    edge.sourceAgentId === run.agentId && edge.targetAgentId === entryAgentId
    && (edge.kind ?? 'command') === 'command' && (edge.bundleRole ?? 'primary') === 'primary'
    && edge.forwardMode === 'manual' && edge.returnFormat === 'both');
  const edge = existing ?? graph.createTaskEdge(run.agentId, entryAgentId,
    'Complete the delegated task, collect all worker results, and return the outcome and verification evidence to the conductor.',
    'manual', null, { kind: 'command', returnFormat: 'both' });
  // Also repairs a missing return sister after a partially restored old graph.
  graph.updateTaskEdge(edge.id, { returnFormat: 'both' });
  return edge;
}

/** Inherit the exact calling turn's run, never the newest run sharing a worker. */
export function orchestraRunForDispatch(
  queues: Iterable<readonly QueuedCommand[]>,
  requesterSubAgentId: string | undefined,
): string | undefined {
  if (!requesterSubAgentId) return undefined;
  for (const queue of queues) {
    const command = queue.find((cmd) => cmd.subAgentId === requesterSubAgentId && cmd.status === 'executing');
    if (command) return command.orchestraRunId;
  }
  return undefined;
}
