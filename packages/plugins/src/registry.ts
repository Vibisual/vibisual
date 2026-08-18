/**
 * §5.11 v3.88 — 플러그인 등록부.
 *
 * **플러그인 추가 = 이 파일에 한 줄.** 코드젠·자동 스캔을 쓰지 않는 이유는 언리얼과 같다 —
 * 무엇이 빌드에 들어가 있는지가 한눈에 보여야 하고, 등록되지 않은 채 도는 플러그인이 없어야 한다.
 *
 * 여기 있는 것은 **매니페스트(선언)뿐**이다. 구현 모듈은 `client.ts` / `server.ts` 배럴이 따로 모은다 —
 * PluginsWindow 가 비활성 플러그인의 구현을 건드리지 않고도 목록을 그릴 수 있어야 하기 때문.
 */
import type { PluginManifest } from '@vibisual/shared';
import type { PluginDataNeed } from './types.js';
import { PLUGIN_ID_PATTERN, PLUGIN_SUPPORTED_CONTRIBUTIONS } from '@vibisual/shared';
import { lethalTrifectaManifest } from './lethal-trifecta/manifest.js';
import { leastPrivilegeManifest } from './least-privilege/index.js';
import { blastRadiusManifest } from './blast-radius/index.js';
import { autonomyLevelManifest } from './autonomy-level/index.js';
import { longHorizonManifest } from './long-horizon/index.js';
import { rogueAgentManifest } from './rogue-agent/index.js';
import { guardrailsManifest } from './guardrails/index.js';
import { humanInTheLoopManifest } from './human-in-the-loop/index.js';
import { allowlistManifest } from './allowlist/index.js';
import { sandboxingManifest } from './sandboxing/index.js';
import { nonHumanIdentityManifest } from './non-human-identity/index.js';
import { containmentManifest } from './containment/index.js';
import { auditTrailManifest } from './audit-trail/index.js';
import { contextRotManifest } from './context-rot/index.js';
import { costPerTaskManifest } from './cost-per-task/index.js';
import { modelRoutingManifest } from './model-routing/index.js';
import { reasoningEffortManifest } from './reasoning-effort/index.js';
import { toolUseManifest } from './tool-use/index.js';
import { tokenBudgetManifest } from './token-budget/index.js';
import { systemPromptManifest } from './system-prompt/index.js';
import { subagentManifest } from './subagent/index.js';
import { fanOutManifest } from './fan-out/index.js';
import { orchestratorManifest } from './orchestrator/index.js';
import { planAndExecuteManifest } from './plan-and-execute/index.js';
import { reactPatternManifest } from './react-pattern/index.js';
import { scopeCreepManifest } from './scope-creep/index.js';
import { reviewGateManifest } from './review-gate/index.js';
import { structuredOutputManifest } from './structured-output/index.js';
import { instructionDriftManifest } from './instruction-drift/index.js';
import { semanticMemoryManifest } from './semantic-memory/index.js';
import { memoryInvalidationManifest } from './memory-invalidation/index.js';
import { forgettingPolicyManifest } from './forgetting-policy/index.js';
import { supersedeManifest } from './supersede/index.js';
import { memoryDriftManifest } from './memory-drift/index.js';
import { memoryConsolidationManifest } from './memory-consolidation/index.js';
import { episodicMemoryManifest } from './episodic-memory/index.js';
import { proceduralMemoryManifest } from './procedural-memory/index.js';
import { workingMemoryManifest } from './working-memory/index.js';
import { memoryToolManifest } from './memory-tool/index.js';
import { progressiveDisclosureManifest } from './progressive-disclosure/index.js';
import { contextPollutionManifest } from './context-pollution/index.js';
import { agentHarnessManifest } from './agent-harness/index.js';
import { scaffoldManifest } from './scaffold/index.js';
import { agentLoopManifest } from './agent-loop/index.js';
import { handoffPacketManifest } from './handoff-packet/index.js';
import { verifierCriticManifest } from './verifier-critic/index.js';
import { hookLifecycleManifest } from './hook-lifecycle/index.js';
import { contextWindowManifest } from './context-window/index.js';
import { testTimeComputeManifest } from './test-time-compute/index.js';
import { extendedThinkingManifest } from './extended-thinking/index.js';
import { reflexionManifest } from './reflexion/index.js';
import { contextEngineeringManifest } from './context-engineering/index.js';
import { agentSkillsManifest } from './agent-skills/index.js';
import { trajectoryEvalManifest } from './trajectory-eval/index.js';
import { evalManifest } from './eval/index.js';
import { goldenSetManifest } from './golden-set/index.js';
import { regressionSuiteManifest } from './regression-suite/index.js';
import { traceSpanManifest } from './trace-span/index.js';
import { observabilityManifest } from './observability/index.js';
import { llmAsJudgeManifest } from './llm-as-judge/index.js';
import { evalDrivenDevelopmentManifest } from './eval-driven-development/index.js';
import { hallucinationGuardManifest } from './hallucination-guard/index.js';
import { worktreeIsolationManifest } from './worktree-isolation/index.js';
import { vibeCodingManifest } from './vibe-coding/index.js';
import { agenticEngineeringManifest } from './agentic-engineering/index.js';
import { ragManifest } from './rag/index.js';
import { agenticRagManifest } from './agentic-rag/index.js';
import { groundingManifest } from './grounding/index.js';
import { agenticFileSearchManifest } from './agentic-file-search/index.js';
import { vectorDbManifest } from './vector-db/index.js';
import { gracefulDegradationManifest } from './graceful-degradation/index.js';
import { idempotencyManifest } from './idempotency/index.js';
import { separationOfConcernsManifest } from './separation-of-concerns/index.js';
import { eventDrivenManifest } from './event-driven/index.js';
import { backpressureManifest } from './backpressure/index.js';
import { durableExecutionManifest } from './durable-execution/index.js';
import { atomicWriteManifest } from './atomic-write/index.js';
import { promptInjectionManifest } from './prompt-injection/index.js';
import { owaspAsiManifest } from './owasp-asi/index.js';
import { goalHijackManifest } from './goal-hijack/index.js';
import { memoryPoisoningManifest } from './memory-poisoning/index.js';
import { agenticSupplyChainManifest } from './agentic-supply-chain/index.js';
import { cascadingFailureManifest } from './cascading-failure/index.js';
import { agentCardManifest } from './agent-card/index.js';
import { toolSearchManifest } from './tool-search/index.js';
import { compactionWatchManifest } from './compaction-watch/index.js';
import { contextEditingManifest } from './context-editing/index.js';
import { specDrivenManifest } from './spec-driven/index.js';
import { preCommitGateManifest } from './pre-commit-gate/index.js';
import { ssotDriftManifest } from './ssot-drift/index.js';
import { adrPresenceManifest } from './adr-presence/index.js';
import { schemaEvolutionManifest } from './schema-evolution/index.js';
import { mcpClientInventoryManifest } from './mcp-client-inventory/index.js';
import { a2aManifest } from './a2a/index.js';
import { acpAnpManifest } from './acp-anp/index.js';
import { agentsMdManifest } from './agents-md/index.js';
import { computerUseManifest } from './computer-use/index.js';
import { chunkingManifest } from './chunking/index.js';
import { rerankingManifest } from './reranking/index.js';
import { hybridSearchManifest } from './hybrid-search/index.js';
import { multiHopManifest } from './multi-hop/index.js';
import { queryRewritingManifest } from './query-rewriting/index.js';
import { benchmarkHygieneManifest } from './benchmark-hygiene/index.js';
import { hybridWorkflowManifest } from './hybrid-workflow/index.js';
import { rescueEngineeringManifest } from './rescue-engineering/index.js';
import { promptCachingManifest } from './prompt-caching/index.js';
import { toolMisuseManifest } from './tool-misuse/index.js';
import { dataExfiltrationManifest } from './data-exfiltration/index.js';
import { mcpServerManifest } from './mcp-server/index.js';
import { killSwitchManifest } from './kill-switch/index.js';
import { agentRegistryManifest } from './agent-registry/index.js';

/**
 * 호스트가 실제로 채워 주는 데이터 축의 **단일 출처**.
 *
 * 이 목록을 손으로 두 곳(타입 유니온 + 검증)에 두면 축을 늘릴 때 한쪽을 빠뜨린다 — 실제로 5차 배치에서
 * `brain` 축을 더하고 검증 목록을 안 고쳐 테스트가 걸렸다. 축 추가는 여기 한 줄 + 호스트 `usePluginData` 한 줄.
 */
export const PLUGIN_DATA_NEEDS: readonly PluginDataNeed[] = [
  'agentEvents',
  'subAgents',
  'runningTasks',
  'agentReports',
  'agentReviews',
  'brain',
  'brainInjections',
  'taskEdges',
  'captureBubbles',
  'bashCommands',
  // v4.65 — 집행이 프로젝트 파일을 훑어 낸 실측. 카드가 집행과 같은 것을 세게 하는 유일한 통로다.
  'pluginFacts',
];

export const PLUGIN_MANIFESTS: readonly PluginManifest[] = [
  lethalTrifectaManifest,
  leastPrivilegeManifest,
  blastRadiusManifest,
  autonomyLevelManifest,
  longHorizonManifest,
  rogueAgentManifest,
  guardrailsManifest,
  humanInTheLoopManifest,
  allowlistManifest,
  sandboxingManifest,
  nonHumanIdentityManifest,
  containmentManifest,
  auditTrailManifest,
  contextRotManifest,
  costPerTaskManifest,
  modelRoutingManifest,
  reasoningEffortManifest,
  toolUseManifest,
  tokenBudgetManifest,
  systemPromptManifest,
  subagentManifest,
  fanOutManifest,
  orchestratorManifest,
  planAndExecuteManifest,
  reactPatternManifest,
  scopeCreepManifest,
  reviewGateManifest,
  structuredOutputManifest,
  instructionDriftManifest,
  semanticMemoryManifest,
  memoryInvalidationManifest,
  forgettingPolicyManifest,
  supersedeManifest,
  memoryDriftManifest,
  memoryConsolidationManifest,
  episodicMemoryManifest,
  proceduralMemoryManifest,
  workingMemoryManifest,
  memoryToolManifest,
  progressiveDisclosureManifest,
  contextPollutionManifest,
  agentHarnessManifest,
  scaffoldManifest,
  agentLoopManifest,
  handoffPacketManifest,
  verifierCriticManifest,
  hookLifecycleManifest,
  contextWindowManifest,
  testTimeComputeManifest,
  extendedThinkingManifest,
  reflexionManifest,
  contextEngineeringManifest,
  agentSkillsManifest,
  trajectoryEvalManifest,
  evalManifest,
  goldenSetManifest,
  regressionSuiteManifest,
  traceSpanManifest,
  observabilityManifest,
  llmAsJudgeManifest,
  evalDrivenDevelopmentManifest,
  hallucinationGuardManifest,
  worktreeIsolationManifest,
  vibeCodingManifest,
  agenticEngineeringManifest,
  ragManifest,
  agenticRagManifest,
  groundingManifest,
  agenticFileSearchManifest,
  vectorDbManifest,
  gracefulDegradationManifest,
  idempotencyManifest,
  separationOfConcernsManifest,
  eventDrivenManifest,
  backpressureManifest,
  durableExecutionManifest,
  atomicWriteManifest,
  promptInjectionManifest,
  owaspAsiManifest,
  goalHijackManifest,
  memoryPoisoningManifest,
  agenticSupplyChainManifest,
  cascadingFailureManifest,
  agentCardManifest,
  toolSearchManifest,
  compactionWatchManifest,
  contextEditingManifest,
  specDrivenManifest,
  preCommitGateManifest,
  ssotDriftManifest,
  adrPresenceManifest,
  schemaEvolutionManifest,
  mcpClientInventoryManifest,
  a2aManifest,
  acpAnpManifest,
  agentsMdManifest,
  computerUseManifest,
  chunkingManifest,
  rerankingManifest,
  hybridSearchManifest,
  multiHopManifest,
  queryRewritingManifest,
  benchmarkHygieneManifest,
  hybridWorkflowManifest,
  rescueEngineeringManifest,
  promptCachingManifest,
  toolMisuseManifest,
  dataExfiltrationManifest,
  mcpServerManifest,
  killSwitchManifest,
  agentRegistryManifest,
];

export function getPluginManifest(id: string): PluginManifest | undefined {
  return PLUGIN_MANIFESTS.find((m) => m.id === id);
}

/**
 * 사용자가 아직 Plugins 창을 건드리지 않았을 때(=`enabledPlugins` 가 undefined) 적용할 기본 활성 집합.
 * 배열이 한 번이라도 저장되면 **그 배열이 진실**이고 기본값은 더 보지 않는다.
 *
 * **등록부에 없는 id 는 걸러낸다.** 저장된 목록에는 이제 없는 카드의 id 가 남을 수 있다 — 이름이 바뀌었거나,
 * 빠졌거나, 새 판에서 켠 뒤 옛 판으로 되돌아간 경우다. 거르지 않으면 켠 개수 표시가 등록 수를 넘어서고
 * (`112 / 111`), 서버 관문도 존재하지 않는 플러그인을 "켜짐"으로 읽는다.
 *
 * 걸러진 id 는 사용자가 다음에 무언가를 토글할 때 저장소에서도 사라진다 — 어차피 켤 대상이 없으므로
 * 잃는 것이 없다. 플러그인은 컴파일 시점에 등록되므로 "잠깐 안 보이는" 상태란 것이 존재하지 않는다.
 */
export function resolveEnabledPlugins(enabled: string[] | undefined): Set<string> {
  const known = new Set(PLUGIN_MANIFESTS.map((m) => m.id));
  if (enabled === undefined) {
    return new Set(PLUGIN_MANIFESTS.filter((m) => m.enabledByDefault).map((m) => m.id));
  }
  return new Set(enabled.filter((id) => known.has(id)));
}

export function isPluginEnabled(id: string, enabled: string[] | undefined): boolean {
  return resolveEnabledPlugins(enabled).has(id);
}

// ─── 프로젝트별 활성 (§5.11 v4.54) ───

/**
 * 켬/끔의 출처 — `UserDefaults` 중 이 판정에 필요한 두 필드만 구조적으로 받는다.
 * 플러그인 패키지가 `UserDefaults` 전체를 알 필요는 없고, 알면 테스트가 무거워진다.
 */
export interface PluginEnablementSource {
  /** 프로젝트 절대경로 → 켠 플러그인 id 목록 (v4.54 SSOT). */
  enabledPluginsByProject?: Record<string, string[]>;
  /** @deprecated 구 전역 목록 — 아직 프로젝트별 설정이 없는 프로젝트의 시드로만 읽는다. */
  enabledPlugins?: string[];
}

/**
 * 이 프로젝트에 적용할 **원본 배열**(해석 전)을 고른다.
 *
 * 순서는 `프로젝트별 → 구 전역 시드 → undefined(=기본값 적용)`. 시드를 남기는 이유는 v4.54 이전에
 * 켜 둔 것이 판올림 한 번에 전부 꺼지면 사용자가 무엇을 잃었는지조차 알 수 없기 때문이다. 프로젝트
 * 키가 한 번이라도 저장되면 그 뒤로 시드는 보지 않는다 — 그래야 "이 프로젝트에서 전부 끔"이 성립한다.
 *
 * `projectId` 가 없으면(프로젝트 미선택) 시드만 본다. 아무 프로젝트에도 안 매인 켬/끔을 새로 만들지 않는다.
 */
export function selectProjectEnabledList(
  source: PluginEnablementSource | null | undefined,
  projectId: string | null | undefined,
): string[] | undefined {
  const byProject = source?.enabledPluginsByProject;
  if (projectId && byProject) {
    if (Object.prototype.hasOwnProperty.call(byProject, projectId)) return byProject[projectId];
    // 같은 폴더인데 대소문자·역슬래시만 다른 경로가 들어오는 경우(Windows). 클라는 스냅샷의 `path` 를
    // 그대로 쓰지만 서버 관문은 appState 에서 온 경로를 쓰므로, 여기서 한 번 눅여 주지 않으면
    // **같은 프로젝트가 두 칸으로 갈려** 창에서 켠 것이 서버에서 꺼진 것으로 읽힌다.
    const key = normalizeProjectKey(projectId);
    for (const [k, v] of Object.entries(byProject)) {
      if (normalizeProjectKey(k) === key) return v;
    }
  }
  return source?.enabledPlugins;
}

/** 프로젝트 키 비교용 정규화 — forward slash + 소문자 + 끝 슬래시 제거(서버 `normPath` 와 같은 규칙). */
function normalizeProjectKey(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/**
 * 저장할 때 쓸 **실제 키** — 이미 같은 폴더를 가리키는 칸이 있으면 그 이름을 그대로 쓴다.
 * 부분 저장(한 칸만 PUT)이 기존 칸을 갱신하지 않고 새 칸을 만드는 것을 막는다.
 */
export function resolveProjectKey(source: PluginEnablementSource | null | undefined, projectId: string): string {
  const prev = source?.enabledPluginsByProject ?? {};
  const key = normalizeProjectKey(projectId);
  return Object.keys(prev).find((k) => normalizeProjectKey(k) === key) ?? projectId;
}

/** 프로젝트 하나에 대한 활성 집합. 창·클라 호스트·서버 관문이 **모두** 이 함수를 통과한다. */
export function resolveEnabledPluginsFor(
  source: PluginEnablementSource | null | undefined,
  projectId: string | null | undefined,
): Set<string> {
  return resolveEnabledPlugins(selectProjectEnabledList(source, projectId));
}

/** 프로젝트 하나에서 이 플러그인이 켜져 있는가. 서버 관문(409)이 쓰는 판정. */
export function isPluginEnabledFor(
  id: string,
  source: PluginEnablementSource | null | undefined,
  projectId: string | null | undefined,
): boolean {
  return resolveEnabledPluginsFor(source, projectId).has(id);
}

/**
 * 한 프로젝트의 목록만 갈아 끼운 새 맵을 만든다 — **다른 프로젝트 칸은 그대로 둔다.**
 *
 * 저장 경로가 이 함수 하나로 모이면 "한 칸만 보냈는데 나머지가 날아갔다"(§4 agent-config PUT 강등)
 * 계열의 사고가 구조적으로 안 생긴다.
 */
export function withProjectEnabled(
  source: PluginEnablementSource | null | undefined,
  projectId: string,
  enabled: string[],
): Record<string, string[]> {
  const prev = source?.enabledPluginsByProject ?? {};
  const key = normalizeProjectKey(projectId);
  // 대소문자만 다른 칸이 이미 있으면 그 칸을 쓴다 — 안 그러면 같은 폴더가 두 줄로 남아
  // 읽는 쪽(정규화 비교)과 쓰는 쪽이 다른 칸을 보게 된다.
  const existing = Object.keys(prev).find((k) => normalizeProjectKey(k) === key);
  return { ...prev, [existing ?? projectId]: enabled };
}

/** 매니페스트가 선언했지만 호스트가 아직 슬롯을 열지 않은 기여들 — PluginsWindow 가 "미지원"으로 표시. */
export function unsupportedContributions(manifest: PluginManifest): string[] {
  return manifest.contributes.filter((c) => !PLUGIN_SUPPORTED_CONTRIBUTIONS.includes(c));
}

/**
 * 등록부 자체 검증 — id 규약 위반·중복은 개발 중에 즉시 드러나야 한다.
 * 던지지 않고 문제 목록을 돌려준다(플러그인 하나 때문에 앱이 못 뜨는 일은 없어야 하므로).
 */
export function validateRegistry(manifests: readonly PluginManifest[] = PLUGIN_MANIFESTS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const m of manifests) {
    if (!PLUGIN_ID_PATTERN.test(m.id)) problems.push(`invalid plugin id: ${m.id}`);
    if (seen.has(m.id)) problems.push(`duplicate plugin id: ${m.id}`);
    seen.add(m.id);
  }
  return problems;
}
