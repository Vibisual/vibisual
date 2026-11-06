/**
 * §5.3 #10-6 (A)(C)(D) — 오케스트라 런에서 짓는 파생값(순수). 저장하지 않는다 — 런·엣지에서 언제든 다시 짓는다.
 * 사슬 줄의 역할, 조율/작업 토큰, 의도 × 편성 성적표, 정리 제안(합칠 후보·오래 안 쓴 멤버).
 */
import { ORCHESTRA_IDLE_MEMBER_DAYS, ORCHESTRA_SUGGESTIONS_MAX } from './constants.js';
import { isOrchestraRunSettled, isOrchestraRunVerified } from './orchestraScope.js';
import type {
  OrchestraFoldPair,
  OrchestraIdleMember,
  OrchestraRun,
  OrchestraRunHopRole,
  OrchestraScoreRow,
  OrchestraSuggestions,
  TaskEdge,
} from './types.js';

/** 사슬 줄 역할을 정하는 데 필요한 명령·엣지 사정. */
export interface OrchestraHopRoleInput {
  commandId: string;
  agentId: string;
  /** 그 명령이 탄 엣지(없으면 지휘·직접 하기·킥오프). */
  edge?: Pick<TaskEdge, 'kind' | 'bundleRole'> | null;
}

/**
 * 끝난 명령이 이 런의 사슬에서 무슨 역할이었나. 지휘 턴·직접 하기가 먼저고, 엣지 종류(검수·재작업), 그다음 엔트리.
 * 엔트리의 판정은 계획의 `entryAgentId` 로만 한다 — 엣지로 짐작하면 같은 멤버가 두 역할을 맡을 때 갈린다.
 */
export function orchestraHopRole(
  run: Pick<OrchestraRun, 'commandId' | 'selfCommandId' | 'plan'>,
  input: OrchestraHopRoleInput,
): OrchestraRunHopRole {
  if (input.commandId === run.commandId) return 'conductor';
  if (run.selfCommandId !== undefined && input.commandId === run.selfCommandId) return 'self';
  if (input.edge?.bundleRole === 'auto-rework') return 'rework';
  if (input.edge?.kind === 'critique') return 'review';
  if (run.plan?.entryAgentId !== undefined && input.agentId === run.plan.entryAgentId) return 'entry';
  return 'member';
}

/** 조율/작업 토큰 — 기록된 줄 기준. `recorded` 가 런 합계와 다르면 화면이 "기록된 줄 기준"이라고 밝힌다. */
export interface OrchestraTokenSplit {
  coordination: number;
  work: number;
  /** 사슬 줄의 합(조율 + 작업). */
  recorded: number;
  /** 런에 적힌 합계(입력 + 출력). */
  total: number;
}

/** 조율 = 지휘 턴 + `parallel` 이면 엔트리(허브). 나머지는 작업이다(직접 하기·검수·재작업 포함). */
export function orchestraTokenSplit(run: Pick<OrchestraRun, 'hops' | 'plan' | 'inputTokens' | 'outputTokens'>): OrchestraTokenSplit {
  let coordination = 0;
  let work = 0;
  const hubIsCoordination = run.plan?.topology === 'parallel';
  for (const hop of run.hops ?? []) {
    const tokens = hop.inputTokens + hop.outputTokens;
    if (hop.role === 'conductor' || (hubIsCoordination && hop.role === 'entry')) coordination += tokens;
    else work += tokens;
  }
  return { coordination, work, recorded: coordination + work, total: run.inputTokens + run.outputTokens };
}

/** 성적표 한 줄의 열쇠 — 계획이 없으면 `unplanned` 한 줄로 모은다. */
function scoreKey(run: OrchestraRun): { intent: OrchestraScoreRow['intent']; topology: OrchestraScoreRow['topology'] } {
  return run.plan ? { intent: run.plan.intent, topology: run.plan.topology } : { intent: 'unplanned', topology: 'unplanned' };
}

/**
 * §5.3 #10-6 (C) — 의도 × 편성 성적표. 끝난 런만 평균에 넣는다(도는 런은 `runs` 수에만).
 * 줄 순서는 런이 많은 것부터, 같으면 의도·편성 이름 순(화면이 매번 같은 차례로 그리게).
 */
export function orchestraScorecard(runs: readonly OrchestraRun[]): OrchestraScoreRow[] {
  const rows = new Map<string, OrchestraScoreRow & { tokenSum: number; settled: number; durationSum: number; durationCount: number }>();
  for (const run of runs) {
    const key = scoreKey(run);
    const id = `${key.intent}\u0000${key.topology}`;
    let row = rows.get(id);
    if (!row) {
      row = {
        intent: key.intent, topology: key.topology,
        runs: 0, completed: 0, verified: 0, answered: 0, unreported: 0, error: 0, avgTokens: 0,
        tokenSum: 0, settled: 0, durationSum: 0, durationCount: 0,
      };
      rows.set(id, row);
    }
    row.runs += 1;
    if (run.phase === 'completed') row.completed += 1;
    if (run.phase === 'answered') row.answered += 1;
    if (run.phase === 'unreported') row.unreported += 1;
    if (run.phase === 'error') row.error += 1;
    if (isOrchestraRunVerified(run)) row.verified += 1;
    if (isOrchestraRunSettled(run.phase)) {
      row.settled += 1;
      row.tokenSum += run.inputTokens + run.outputTokens;
      if (run.endedAt !== undefined && run.endedAt >= run.startedAt) {
        row.durationSum += run.endedAt - run.startedAt;
        row.durationCount += 1;
      }
    }
  }
  return [...rows.values()]
    .map((r) => {
      const out: OrchestraScoreRow = {
        intent: r.intent, topology: r.topology,
        runs: r.runs, completed: r.completed, verified: r.verified, answered: r.answered,
        unreported: r.unreported, error: r.error,
        avgTokens: r.settled > 0 ? Math.round(r.tokenSum / r.settled) : 0,
      };
      if (r.durationCount > 0) out.avgDurationMs = Math.round(r.durationSum / r.durationCount);
      return out;
    })
    .sort((a, b) => b.runs - a.runs || String(a.intent).localeCompare(String(b.intent)) || String(a.topology).localeCompare(String(b.topology)));
}

/** 정리 제안이 보는 엣지 모양. */
export type OrchestraSuggestionEdge = Pick<TaskEdge, 'id' | 'sourceAgentId' | 'targetAgentId' | 'kind' | 'bundleRole'>;

/**
 * §5.3 #10-6 (D) — 정리 제안(목록만 — 자동 조치 ❌).
 *  - 합칠 후보: 런에 함께 나온 command 짝 A→B 중 B 로 들어오는 command 엣지가 A 하나뿐이고 B 에서 나가는 command 엣지가 없는 것.
 *  - 오래 안 쓴 멤버: 런 멤버였던 에이전트 중 마지막 런 참가가 `ORCHESTRA_IDLE_MEMBER_DAYS` 일을 넘었고 아직 프로젝트에 있는 것.
 * 제안이 하나도 없으면 `undefined`(스냅샷 칸을 늘리지 않는다).
 */
export function orchestraSuggestions(
  runs: readonly OrchestraRun[],
  edges: readonly OrchestraSuggestionEdge[],
  liveAgentIds: ReadonlySet<string>,
  now: number,
): OrchestraSuggestions | undefined {
  const primaryCommand = edges.filter((e) => (e.kind ?? 'command') === 'command' && (e.bundleRole ?? 'primary') === 'primary');
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, number>();
  for (const e of primaryCommand) {
    incoming.set(e.targetAgentId, [...(incoming.get(e.targetAgentId) ?? []), e.sourceAgentId]);
    outgoing.set(e.sourceAgentId, (outgoing.get(e.sourceAgentId) ?? 0) + 1);
  }

  const foldPairs: OrchestraFoldPair[] = [];
  for (const e of primaryCommand) {
    if (!liveAgentIds.has(e.sourceAgentId) || !liveAgentIds.has(e.targetAgentId)) continue;
    const sources = incoming.get(e.targetAgentId) ?? [];
    if (sources.length !== 1 || (outgoing.get(e.targetAgentId) ?? 0) > 0) continue;
    // 지휘자 → 엔트리 연결은 오케스트라가 만든 것이라 제안하지 않는다(지휘자를 접으라는 말이 된다).
    const together = runs.filter((r) => r.agentId !== e.sourceAgentId
      && r.memberAgentIds.includes(e.sourceAgentId) && r.memberAgentIds.includes(e.targetAgentId)).length;
    if (together === 0) continue;
    foldPairs.push({ fromAgentId: e.targetAgentId, intoAgentId: e.sourceAgentId, edgeId: e.id, runs: together });
  }
  foldPairs.sort((a, b) => b.runs - a.runs || a.edgeId.localeCompare(b.edgeId));

  const lastUsed = new Map<string, { at: number; runs: number }>();
  for (const r of runs) {
    const at = r.endedAt ?? r.planAt ?? r.startedAt;
    for (const id of r.memberAgentIds) {
      const cur = lastUsed.get(id);
      lastUsed.set(id, { at: Math.max(cur?.at ?? 0, at), runs: (cur?.runs ?? 0) + 1 });
    }
  }
  const threshold = now - ORCHESTRA_IDLE_MEMBER_DAYS * 24 * 60 * 60_000;
  const idleMembers: OrchestraIdleMember[] = [...lastUsed.entries()]
    .filter(([id, v]) => liveAgentIds.has(id) && v.at < threshold)
    .map(([agentId, v]) => ({ agentId, lastUsedAt: v.at, runs: v.runs }))
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt || a.agentId.localeCompare(b.agentId));

  if (foldPairs.length === 0 && idleMembers.length === 0) return undefined;
  return {
    foldPairs: foldPairs.slice(0, ORCHESTRA_SUGGESTIONS_MAX),
    idleMembers: idleMembers.slice(0, ORCHESTRA_SUGGESTIONS_MAX),
  };
}
