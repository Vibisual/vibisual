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
