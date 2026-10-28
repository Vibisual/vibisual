/** Orchestra uses the existing task-edge round trip, including its result ledger. */
import { TASK_EDGE_DEFAULTS } from '@vibisual/shared';
import type { OrchestraRun, QueuedCommand, TaskEdge, TaskEdgeCommandMode } from '@vibisual/shared';

interface OrchestraEdgeGraph {
  getTaskEdgesSnapshot(): Record<string, TaskEdge>;
  createTaskEdge(source: string, target: string, command: string, mode: 'manual', template: null,
    options: { kind: 'command'; returnFormat: 'both'; commandMode: TaskEdgeCommandMode }): TaskEdge;
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
    // commandMode 를 비워 두면 resolveEdgeCommandMode 의 후방호환 폴백이 delegationPolicy='strict'
    // 로 읽어 'tool-delegation'(부모 도구 박탈)이 된다. 지휘 턴의 Read·Grep·Glob 이 걷히므로 명시한다.
    'manual', null, { kind: 'command', returnFormat: 'both', commandMode: TASK_EDGE_DEFAULTS.commandMode });
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

/** 막 끝난 작업자 명령들 중 어느 런의 검수를 발사할지. `plainFallback` 은 오케스트라 밖 평소 검수. */
export interface OrchestraCritiqueFiring {
  runId: string;
  /** 검수자에게 붙여 줄 직전 결과(없으면 null). */
  result: string | null;
  /** 재작업 응답이 아니라 새 검수 주기인가 — 런당 재작업 예산을 세는 쪽이 쓴다. */
  freshCycle: boolean;
}

/** 검수는 신고(`reusedAgentIds`)가 아니라 참가 사실로 발사한다 — 신고를 빠뜨리면 검수 0건으로 `completed` 가 된다. 런당 한 번. */
export function orchestraCritiqueFirings(
  done: readonly QueuedCommand[],
  workerAgentId: string,
  lookup: {
    findRun(runId: string): Pick<OrchestraRun, 'agentId'> | undefined;
    findEdge(edgeId: string | undefined): Pick<TaskEdge, 'kind' | 'bundleRole'> | undefined;
    isUserStopped(cmd: QueuedCommand): boolean;
  },
): { firings: OrchestraCritiqueFiring[]; plainFallback: boolean } {
  const firings: OrchestraCritiqueFiring[] = [];
  const seen = new Set<string>();
  let sawLiveRun = false;
  for (const cmd of done) {
    const runId = cmd.orchestraRunId;
    if (!runId) continue;
    const owner = lookup.findRun(runId);
    if (!owner) continue; // 사라진 런의 꼬리표엔 검수를 가질 주인이 없다.
    sawLiveRun = true;
    // 감독 제 턴은 검수 대상이 아니고, 사용자가 멈춘 명령은 결과가 아니다.
    if (owner.agentId === workerAgentId || lookup.isUserStopped(cmd)) continue;
    const edge = lookup.findEdge(cmd.edgeId);
    if ((edge?.kind ?? 'command') === 'critique') continue; // 검수 응답 자체는 다시 검수하지 않는다.
    if (seen.has(runId)) continue;
    seen.add(runId);
    firings.push({ runId, result: cmd.result ?? null, freshCycle: edge?.bundleRole !== 'auto-rework' });
  }
  return { firings, plainFallback: firings.length === 0 && !sawLiveRun };
}
