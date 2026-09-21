/**
 * §5.3 #10-4 — 오케스트라(지휘 모드) 서버 런타임의 **순수 판정**.
 *
 * `index.ts` 의 가로채기(`POST /api/commands`)·지휘 턴 덮어쓰기(`processNextCommand`)·킥오프·멤버 등록
 * (`/api/create-custom-agent`)·완료 정산(`setOnComplete`)이 여기 함수를 부른다. 판정을 라우트 안에 흩어
 * 두면 "가로채는 조건"과 "지휘 턴이 받는 설정"이 자리마다 조금씩 달라진다 — 그래서 한 곳에 모으고
 * 시험으로 고정한다.
 *
 * 이 파일은 fs·시간·플랫폼을 모른다. 시각은 부르는 쪽이 `now` 를 넘기고, 경로 비교(프로젝트가 같은가)는
 * 부르는 쪽이 `samePath` 로 재서 boolean 으로 넘긴다(대소문자 규칙이 OS 마다 다르다 — §멀티플랫폼 1축).
 */
import {
  AUTO_AGENT_BUILDER_INTERVIEW_TOOL,
  ORCHESTRA_CONDUCTOR_DISALLOWED_TOOLS,
  ORCHESTRA_CONDUCTOR_TOOLS,
  resolveOrchestraConductorPermission,
  resolveOrchestraMaxMembers,
  resolveOrchestraMemberEngine,
  orchestraEnginePreparation,
} from '@vibisual/shared';
import type {
  AgentConfig,
  AgentProviderKind,
  ExecutionMode,
  OrchestraRun,
  OrchestraSettings,
  OrchestraPreparation,
  OrchestraReadiness,
  QueuedCommand,
  TaskEdge,
} from '@vibisual/shared';
import { DISPATCH_USER_STOPPED_PREFIX, isDispatchJobSucceeded } from './taskEdgeDispatchJobs.js';
import type { DispatchJob } from './taskEdgeDispatchJobs.js';

/** 지휘할 수 있는 엔진 — 로컬 모델은 빠진다(편성 절차가 Bash 로 loopback REST 를 치는 것을 전제로 한다). */
export type OrchestraEngine = 'claude' | 'codex';

/** 그 에이전트 설정이 어느 엔진으로 도는가. 지휘할 수 없는 엔진(로컬)이면 null. */
export function orchestraEngineOf(config: Pick<AgentConfig, 'provider'> | null | undefined): OrchestraEngine | null {
  const kind = config?.provider?.kind;
  if (kind === undefined) return 'claude';
  if (kind === 'codex-cli') return 'codex';
  return null;
}

/** 가로채기 판정에 필요한 사정 — 라우트가 모아 넘긴다. */
export interface OrchestraInterceptInput {
  /** 에이전트가 loopback 으로 넣은 명령인가(킥오프·자기 호출). 사용자 입력만 가로챈다. */
  fromLoopback: boolean;
  customCreated: boolean;
  /** Auto Agent 버블인가 — 그 버블은 #10-2 하네스 빌더가 이미 지휘한다. */
  isAutoBubble: boolean;
  executionMode: ExecutionMode | undefined;
  engine: OrchestraEngine | null;
  text: string;
  silent: boolean;
  /** `resolveOrchestraEnabled(settings, agentId)`. */
  enabled: boolean;
  /** 엣지로 들어온 명령인가(`edgeId`). */
  edgeCommand: boolean;
}

/**
 * 이 명령을 지휘 턴으로 돌릴까 — **전부 참일 때만**(§5.3 #10-4 가로채기 조건).
 * 하나라도 어긋나면 이 기능이 없던 때와 똑같이 흐른다.
 */
export function shouldInterceptOrchestra(i: OrchestraInterceptInput): boolean {
  if (!i.enabled) return false;
  if (i.fromLoopback || i.edgeCommand) return false;
  if (!i.customCreated || i.isAutoBubble) return false;
  if (i.executionMode === 'interactive-terminal') return false;
  if (i.engine === null) return false;
  if (i.silent) return false;
  const text = i.text.trim();
  if (text === '' || text.startsWith('/')) return false;
  return true;
}

function setValue(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/**
 * 지휘 턴 **한 번**에 쓸 설정 — 저장된 `AgentConfig` 는 건드리지 않는다(그 턴의 사본이다).
 *
 * - 도구는 `ORCHESTRA_CONDUCTOR_TOOLS`(+ 설정이 켜면 `AskUserQuestion`). `stripped` 는 STRICT 엣지가 빼앗은
 *   도구 — 사용자가 건 제약이라 지휘 턴에서도 뺀다.
 * - 쓰기 도구는 에이전트 원래 차단 목록에 **더한다**(원래 막아 둔 것을 풀지 않는다).
 * - 권한은 설정이 `bypass` 면 `bypassPermissions`, `inherit` 면 그 에이전트 값 그대로.
 * - 모델·강도는 설정 칸이 비어 있지 않을 때만 갈아 끼운다. Claude 모델을 갈면 `modelVersion` 핀을 뗀다 —
 *   `buildConfigArgs` 가 핀을 모델보다 먼저 쓰므로, 남겨 두면 사용자가 고른 지휘자 모델이 무시된다.
 */
export function buildConductorTurnConfig(
  base: AgentConfig,
  settings: OrchestraSettings | null | undefined,
  engine: OrchestraEngine,
  stripped: ReadonlySet<string> = new Set(),
): AgentConfig {
  const tools = [...ORCHESTRA_CONDUCTOR_TOOLS];
  if (settings?.askQuestions === true && !tools.includes(AUTO_AGENT_BUILDER_INTERVIEW_TOOL)) {
    tools.push(AUTO_AGENT_BUILDER_INTERVIEW_TOOL);
  }
  const disallowed = [...new Set([...(base.disallowedTools ?? []), ...ORCHESTRA_CONDUCTOR_DISALLOWED_TOOLS])];
  const next: AgentConfig = {
    ...base,
    tools: tools.filter((t) => !stripped.has(t)),
    disallowedTools: disallowed,
  };
  if (resolveOrchestraConductorPermission(settings) === 'bypass') next.permissionMode = 'bypassPermissions';

  if (engine === 'claude') {
    const model = setValue(settings?.conductorClaudeModel);
    if (model) {
      next.model = model;
      delete next.modelVersion;
    }
    const effort = setValue(settings?.conductorClaudeEffort);
    if (effort) next.effort = effort;
  } else if (base.provider) {
    // 코덱스는 도구 이름 목록(`tools`·`disallowedTools`)을 읽지 않는다 — 같은 뜻의 칸은 `codexTools.edit` 다.
    //   나머지 도구 칸은 사용자가 정한 그대로 둔다(지휘 턴에 필요한 shell·read 를 막아 뒀으면 그것도 사용자의 뜻이다).
    const model = setValue(settings?.conductorCodexModel);
    const reasoning = setValue(settings?.conductorCodexReasoning);
    next.provider = {
      ...base.provider,
      codexTools: { ...(base.provider.codexTools ?? {}), edit: 'deny' },
      ...(model ? { modelId: model } : {}),
      ...(reasoning ? { reasoningEffort: reasoning } : {}),
    };
  }
  return next;
}

/**
 * 끝난 명령의 토큰을 어느 런에 적을까.
 * - `orchestraRunId` 가 찍힌 명령(지휘 명령·킥오프) → 그 런.
 * - 엣지 명령(`edgeId`) → 그 에이전트를 멤버로 가진 **가장 최근** 런(명령보다 먼저 시작한 것만).
 * - 사용자가 멤버에게 직접 친 명령은 어느 런에도 적지 않는다 — 오케스트라가 쓴 토큰이 아니다.
 */
export function orchestraRunIdForCommand(
  runs: readonly OrchestraRun[],
  cmd: Pick<QueuedCommand, 'orchestraRunId' | 'edgeId' | 'timestamp'>,
  agentId: string | null | undefined,
): string | null {
  if (cmd.orchestraRunId) return runs.some((r) => r.runId === cmd.orchestraRunId) ? cmd.orchestraRunId : null;
  if (!cmd.edgeId || !agentId) return null;
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (!r || r.startedAt > cmd.timestamp) continue;
    if (r.memberAgentIds.includes(agentId)) return r.runId;
  }
  return null;
}

/** 런에 토큰을 더한다 — 0 이면 같은 객체를 돌려준다(저장 표식을 올리지 않게). */
export function addOrchestraRunTokens(run: OrchestraRun, input: number, output: number): OrchestraRun {
  const i = Number.isFinite(input) && input > 0 ? Math.round(input) : 0;
  const o = Number.isFinite(output) && output > 0 ? Math.round(output) : 0;
  if (i === 0 && o === 0) return run;
  return { ...run, inputTokens: run.inputTokens + i, outputTokens: run.outputTokens + o };
}

/** 같은 지휘 세션이 실제로 위임하고 끝난 결과를 받았는지 판정할 장부 증거. */
export type OrchestraDispatchEvidence = Pick<DispatchJob,
  'sourceAgentId' | 'targetAgentId' | 'requesterSubAgentId' | 'createdAt'
  | 'status' | 'usageLimit' | 'deliveredAt' | 'cancelRequestedAt'>;

/**
 * 지휘 턴의 끝을 정산한다. 계획 신고(`dispatched`)는 완료가 아니다 — 같은 세션이 이번 런에서
 * 엔트리에 위임한 증거가 있고, 그 세션의 모든 위임 결과를 성공적으로 받은 뒤에만 `completed`다.
 * 계획 신고 뒤의 실패·중지도 `error`로 닫는다. 첫 정산은 뒤늦게 온 콜백으로 뒤집지 않는다.
 */
export function settleConductorTurn(
  run: OrchestraRun,
  cmd: Pick<QueuedCommand, 'id' | 'status'> & Partial<Pick<QueuedCommand, 'subAgentId' | 'stopReason' | 'result'>>,
  now: number,
  dispatchJobs: readonly OrchestraDispatchEvidence[] = [],
): OrchestraRun {
  if (cmd.id !== run.commandId || run.endedAt !== undefined) return run;
  if (cmd.status !== 'completed' && cmd.status !== 'error') return run;
  let phase = run.phase;
  if (cmd.status === 'error'
    || (cmd.stopReason !== undefined && cmd.stopReason !== 'end_turn')
    || cmd.result?.startsWith(DISPATCH_USER_STOPPED_PREFIX)) {
    phase = 'error';
  } else if (phase === 'conducting') {
    phase = 'unreported';
  } else if (phase === 'dispatched') {
    // 주인을 모르는 증거·다른 세션·이전 런의 결과로 이번 런을 성공시켜서는 안 된다.
    const relevant = cmd.subAgentId ? dispatchJobs.filter((job) =>
      job.sourceAgentId === run.agentId && job.requesterSubAgentId === cmd.subAgentId
      && job.createdAt >= run.startedAt) : [];
    const entryDispatched = !!run.plan?.entryAgentId
      && relevant.some((job) => job.targetAgentId === run.plan?.entryAgentId);
    phase = entryDispatched && relevant.every((job) => isDispatchJobSucceeded(job)
      && job.deliveredAt !== undefined && job.cancelRequestedAt === undefined) ? 'completed' : 'error';
  }
  return { ...run, phase, endedAt: now };
}

/**
 * 규칙에 실을 **기존 멤버** — 이 지휘자가 이전 런들에서 쓴 멤버, 최근 것부터, 겹침 없이.
 * 지휘자 자신은 뺀다. 프로젝트에 아직 있는지는 부르는 쪽이 그래프로 거른다.
 */
export function collectOrchestraMemberIds(runs: readonly OrchestraRun[], conductorId: string): string[] {
  const out: string[] = [];
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i];
    if (!r || r.agentId !== conductorId) continue;
    for (let j = r.memberAgentIds.length - 1; j >= 0; j--) {
      const id = r.memberAgentIds[j];
      if (id && id !== conductorId && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** 런에 멤버를 더한다 — 이미 있으면 같은 객체. `created` 면 새로 만든 수를 하나 올린다. */
export function addOrchestraMember(run: OrchestraRun, agentId: string, created: boolean): OrchestraRun {
  const has = run.memberAgentIds.includes(agentId);
  if (has && !created) return run;
  return {
    ...run,
    memberAgentIds: has ? run.memberAgentIds : [...run.memberAgentIds, agentId],
    ...(created ? { createdMemberCount: (run.createdMemberCount ?? 0) + 1 } : {}),
  };
}

/** REST 가 그대로 돌려줄 판정. */
export type OrchestraCheck =
  | { ok: true }
  | { ok: false; status: number; error: string; limit?: number; current?: number; ids?: string[]; preparation?: OrchestraPreparation };

/**
 * 신고한 멤버에게 실제 작업이 닿는가. 에이전트 존재·프로젝트 소유 검사는 라우트가 먼저 한다.
 * command는 소스→대상, critique는 작업자 완료가 감시자를 부르므로 대상→소스로 따라간다.
 * 반환·재작업 자매 엣지나 참가하지 않은 에이전트를 경유해 고립된 편성을 정상으로 보지 않는다.
 */
export function checkOrchestraPlanGraph(
  run: OrchestraRun,
  plan: NonNullable<OrchestraRun['plan']>,
  reusedAgentIds: readonly string[],
  edges: readonly Pick<TaskEdge, 'sourceAgentId' | 'targetAgentId' | 'kind' | 'bundleRole'>[],
): OrchestraCheck {
  if (plan.topology === 'none') return { ok: true };
  const entry = plan.entryAgentId;
  if (!entry) return { ok: false, status: 400, error: 'orchestra-entry-required' };
  if (entry === run.agentId) return { ok: false, status: 400, error: 'orchestra-entry-conductor' };
  const members = new Set([...run.memberAgentIds, ...reusedAgentIds, entry]);
  members.delete(run.agentId);
  const routes = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.bundleRole !== undefined && edge.bundleRole !== 'primary') continue;
    const kind = edge.kind ?? 'command';
    if (kind !== 'command' && kind !== 'critique') continue;
    const [source, target] = kind === 'critique'
      ? [edge.targetAgentId, edge.sourceAgentId] : [edge.sourceAgentId, edge.targetAgentId];
    if (!members.has(source) || !members.has(target)) continue;
    const targets = routes.get(source) ?? [];
    targets.push(target);
    routes.set(source, targets);
  }
  const reached = new Set([entry]);
  const pending = [entry];
  for (let index = 0; index < pending.length; index++) {
    for (const target of routes.get(pending[index]!) ?? []) {
      if (reached.has(target)) continue;
      reached.add(target);
      pending.push(target);
    }
  }
  const ids = [...members].filter((id) => !reached.has(id));
  return ids.length ? { ok: false, status: 400, error: 'orchestra-plan-disconnected', ids } : { ok: true };
}

/** 킥오프(`POST /api/commands/:sessionId?orchestraRunId=`) 검사에 필요한 사정. */
export interface OrchestraKickoffInput {
  /** loopback 유입인가 — 킥오프 표식은 지휘자(= 앱 안 자식)만 찍는다. */
  fromLoopback: boolean;
  targetAgentId: string | null;
  targetCustomCreated: boolean;
  /** 대상 에이전트의 프로젝트가 런의 프로젝트와 같은가(`samePath`). */
  sameProject: boolean;
}

/**
 * 킥오프 검사. loopback 이 아닌 곳에서 온 표식은 **무시할 것**이므로 부르는 쪽이 먼저 거른다 —
 * 여기 오는 것은 loopback 킥오프뿐이다(그래도 방어로 한 번 더 본다).
 */
export function checkOrchestraKickoff(run: OrchestraRun | undefined, i: OrchestraKickoffInput): OrchestraCheck {
  if (!i.fromLoopback) return { ok: false, status: 403, error: 'orchestra-kickoff-loopback-only' };
  if (!run) return { ok: false, status: 404, error: 'orchestra-run-not-found' };
  if (run.phase !== 'conducting' && run.phase !== 'dispatched') {
    return { ok: false, status: 409, error: 'orchestra-run-settled' };
  }
  if (!i.targetAgentId || !i.targetCustomCreated) return { ok: false, status: 400, error: 'orchestra-kickoff-target' };
  if (i.targetAgentId === run.agentId) return { ok: false, status: 400, error: 'orchestra-kickoff-conductor' };
  if (!i.sameProject) return { ok: false, status: 400, error: 'orchestra-project-mismatch' };
  return { ok: true };
}

/** 멤버 엔진 설정과 새로 만들 멤버의 프로바이더가 맞는가. 로컬은 어느 설정에도 맞지 않는다. */
export function orchestraMemberProviderAllowed(
  settings: OrchestraSettings | null | undefined,
  providerKind: AgentProviderKind | undefined,
  conductorEngine: OrchestraEngine = 'claude',
): boolean {
  if (providerKind === 'local-llama') return false;
  const engine = resolveOrchestraMemberEngine(settings, conductorEngine);
  if (engine === 'claude') return providerKind === undefined;
  if (engine === 'codex') return providerKind === 'codex-cli';
  return providerKind === undefined || providerKind === 'codex-cli';
}

/** 멤버 생성(`/api/create-custom-agent` + `orchestraRunId`) 검사에 필요한 사정. */
export interface OrchestraMemberCreateInput {
  /** 요청의 프로젝트가 런의 프로젝트와 같은가(`samePath`). 요청이 프로젝트를 안 밝혔으면 true. */
  sameProject: boolean;
  providerKind: AgentProviderKind | undefined;
  readiness?: OrchestraReadiness;
}

/** 멤버 생성 검사 — 상한은 이 런이 **새로 만든** 수로 잰다(재사용은 자리를 깎지 않는다). */
export function checkOrchestraMemberCreate(
  run: OrchestraRun | undefined,
  settings: OrchestraSettings | null | undefined,
  i: OrchestraMemberCreateInput,
): OrchestraCheck {
  if (!run) return { ok: false, status: 404, error: 'orchestra-run-not-found' };
  if (run.phase !== 'conducting') return { ok: false, status: 409, error: 'orchestra-run-settled' };
  if (!i.sameProject) return { ok: false, status: 400, error: 'orchestra-project-mismatch' };
  if (!orchestraMemberProviderAllowed(settings, i.providerKind, run.engine)) {
    return { ok: false, status: 400, error: 'orchestra-member-engine' };
  }
  if (i.readiness) {
    const preparation = orchestraEnginePreparation(i.providerKind === 'codex-cli' ? 'codex' : 'claude', i.readiness);
    if (preparation) return { ok: false, status: 409, error: 'orchestra-engine-not-ready', preparation };
  }
  const limit = resolveOrchestraMaxMembers(settings);
  const current = run.createdMemberCount ?? 0;
  if (current >= limit) return { ok: false, status: 429, error: 'orchestra-member-limit', limit, current };
  return { ok: true };
}

/** 계획 신고가 받아들여진 뒤의 런 — 단계·시각·계획·재사용 멤버를 한 번에 적는다. */
export function applyOrchestraPlan(
  run: OrchestraRun,
  plan: NonNullable<OrchestraRun['plan']>,
  reusedAgentIds: readonly string[],
  now: number,
): OrchestraRun {
  const members = [...run.memberAgentIds];
  const participating = plan.entryAgentId ? [...reusedAgentIds, plan.entryAgentId] : reusedAgentIds;
  for (const id of participating) if (id !== run.agentId && !members.includes(id)) members.push(id);
  return {
    ...run,
    plan,
    phase: plan.topology === 'none' ? 'answered' : 'dispatched',
    planAt: now,
    memberAgentIds: members,
  };
}
