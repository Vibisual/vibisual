/**
 * §5.11 v3.88 — 클라이언트 기여 배럴.
 *
 * 플러그인 추가 시 여기에 한 줄. 호스트(`client/src/plugins/host.tsx`)는 이 배열만 보고 슬롯을 채운다.
 */
import type { PluginClientModule } from './types.js';
import { lethalTrifectaClient } from './lethal-trifecta/client/index.js';
import { leastPrivilegeClient } from './least-privilege/index.js';
import { blastRadiusClient } from './blast-radius/index.js';
import { autonomyLevelClient } from './autonomy-level/index.js';
import { longHorizonClient } from './long-horizon/index.js';
import { rogueAgentClient } from './rogue-agent/index.js';
import { guardrailsClient } from './guardrails/index.js';
import { humanInTheLoopClient } from './human-in-the-loop/index.js';
import { allowlistClient } from './allowlist/index.js';
import { sandboxingClient } from './sandboxing/index.js';
import { nonHumanIdentityClient } from './non-human-identity/index.js';
import { containmentClient } from './containment/index.js';
import { auditTrailClient } from './audit-trail/index.js';
import { contextRotClient } from './context-rot/index.js';
import { costPerTaskClient } from './cost-per-task/index.js';
import { modelRoutingClient } from './model-routing/index.js';
import { reasoningEffortClient } from './reasoning-effort/index.js';
import { toolUseClient } from './tool-use/index.js';
import { tokenBudgetClient } from './token-budget/index.js';
import { systemPromptClient } from './system-prompt/index.js';
import { subagentClient } from './subagent/index.js';
import { fanOutClient } from './fan-out/index.js';
import { orchestratorClient } from './orchestrator/index.js';
import { planAndExecuteClient } from './plan-and-execute/index.js';
import { reactPatternClient } from './react-pattern/index.js';
import { scopeCreepClient } from './scope-creep/index.js';
import { reviewGateClient } from './review-gate/index.js';
import { structuredOutputClient } from './structured-output/index.js';
import { instructionDriftClient } from './instruction-drift/index.js';
import { semanticMemoryClient } from './semantic-memory/index.js';
import { memoryInvalidationClient } from './memory-invalidation/index.js';
import { forgettingPolicyClient } from './forgetting-policy/index.js';
import { supersedeClient } from './supersede/index.js';
import { memoryDriftClient } from './memory-drift/index.js';
import { memoryConsolidationClient } from './memory-consolidation/index.js';
import { episodicMemoryClient } from './episodic-memory/index.js';
import { proceduralMemoryClient } from './procedural-memory/index.js';
import { workingMemoryClient } from './working-memory/index.js';
import { memoryToolClient } from './memory-tool/index.js';
import { progressiveDisclosureClient } from './progressive-disclosure/index.js';
import { contextPollutionClient } from './context-pollution/index.js';
import { agentHarnessClient } from './agent-harness/index.js';
import { scaffoldClient } from './scaffold/index.js';
import { agentLoopClient } from './agent-loop/index.js';
import { handoffPacketClient } from './handoff-packet/index.js';
import { verifierCriticClient } from './verifier-critic/index.js';
import { hookLifecycleClient } from './hook-lifecycle/index.js';
import { contextWindowClient } from './context-window/index.js';
import { testTimeComputeClient } from './test-time-compute/index.js';
import { extendedThinkingClient } from './extended-thinking/index.js';
import { reflexionClient } from './reflexion/index.js';
import { contextEngineeringClient } from './context-engineering/index.js';
import { agentSkillsClient } from './agent-skills/index.js';
import { trajectoryEvalClient } from './trajectory-eval/index.js';
import { evalClient } from './eval/index.js';
import { goldenSetClient } from './golden-set/index.js';
import { regressionSuiteClient } from './regression-suite/index.js';
import { traceSpanClient } from './trace-span/index.js';
import { observabilityClient } from './observability/index.js';
import { llmAsJudgeClient } from './llm-as-judge/index.js';
import { evalDrivenDevelopmentClient } from './eval-driven-development/index.js';
import { hallucinationGuardClient } from './hallucination-guard/index.js';
import { worktreeIsolationClient } from './worktree-isolation/index.js';
import { vibeCodingClient } from './vibe-coding/index.js';
import { agenticEngineeringClient } from './agentic-engineering/index.js';
import { ragClient } from './rag/index.js';
import { agenticRagClient } from './agentic-rag/index.js';
import { groundingClient } from './grounding/index.js';
import { agenticFileSearchClient } from './agentic-file-search/index.js';
import { vectorDbClient } from './vector-db/index.js';
import { gracefulDegradationClient } from './graceful-degradation/index.js';
import { idempotencyClient } from './idempotency/index.js';
import { separationOfConcernsClient } from './separation-of-concerns/index.js';
import { eventDrivenClient } from './event-driven/index.js';
import { backpressureClient } from './backpressure/index.js';
import { durableExecutionClient } from './durable-execution/index.js';
import { atomicWriteClient } from './atomic-write/index.js';
import { promptInjectionClient } from './prompt-injection/index.js';
import { owaspAsiClient } from './owasp-asi/index.js';
import { goalHijackClient } from './goal-hijack/index.js';
import { memoryPoisoningClient } from './memory-poisoning/index.js';
import { agenticSupplyChainClient } from './agentic-supply-chain/index.js';
import { cascadingFailureClient } from './cascading-failure/index.js';
import { agentCardClient } from './agent-card/index.js';
import { toolSearchClient } from './tool-search/index.js';
import { compactionWatchClient } from './compaction-watch/index.js';
import { contextEditingClient } from './context-editing/index.js';
import { specDrivenClient } from './spec-driven/index.js';
import { preCommitGateClient } from './pre-commit-gate/index.js';
import { ssotDriftClient } from './ssot-drift/index.js';
import { adrPresenceClient } from './adr-presence/index.js';
import { schemaEvolutionClient } from './schema-evolution/index.js';
import { mcpClientInventoryClient } from './mcp-client-inventory/index.js';
import { a2aClient } from './a2a/index.js';
import { acpAnpClient } from './acp-anp/index.js';
import { agentsMdClient } from './agents-md/index.js';
import { computerUseClient } from './computer-use/index.js';
import { chunkingClient } from './chunking/index.js';
import { rerankingClient } from './reranking/index.js';
import { hybridSearchClient } from './hybrid-search/index.js';
import { multiHopClient } from './multi-hop/index.js';
import { queryRewritingClient } from './query-rewriting/index.js';
import { benchmarkHygieneClient } from './benchmark-hygiene/index.js';
import { hybridWorkflowClient } from './hybrid-workflow/index.js';
import { rescueEngineeringClient } from './rescue-engineering/index.js';
import { promptCachingClient } from './prompt-caching/index.js';
import { toolMisuseClient } from './tool-misuse/index.js';
import { dataExfiltrationClient } from './data-exfiltration/index.js';
import { mcpServerClient } from './mcp-server/index.js';
import { killSwitchClient } from './kill-switch/index.js';
import { agentRegistryClient } from './agent-registry/index.js';

export const PLUGIN_CLIENT_MODULES: readonly PluginClientModule[] = [
  lethalTrifectaClient,
  leastPrivilegeClient,
  blastRadiusClient,
  autonomyLevelClient,
  longHorizonClient,
  rogueAgentClient,
  guardrailsClient,
  humanInTheLoopClient,
  allowlistClient,
  sandboxingClient,
  nonHumanIdentityClient,
  containmentClient,
  auditTrailClient,
  contextRotClient,
  costPerTaskClient,
  modelRoutingClient,
  reasoningEffortClient,
  toolUseClient,
  tokenBudgetClient,
  systemPromptClient,
  subagentClient,
  fanOutClient,
  orchestratorClient,
  planAndExecuteClient,
  reactPatternClient,
  scopeCreepClient,
  reviewGateClient,
  structuredOutputClient,
  instructionDriftClient,
  semanticMemoryClient,
  memoryInvalidationClient,
  forgettingPolicyClient,
  supersedeClient,
  memoryDriftClient,
  memoryConsolidationClient,
  episodicMemoryClient,
  proceduralMemoryClient,
  workingMemoryClient,
  memoryToolClient,
  progressiveDisclosureClient,
  contextPollutionClient,
  agentHarnessClient,
  scaffoldClient,
  agentLoopClient,
  handoffPacketClient,
  verifierCriticClient,
  hookLifecycleClient,
  contextWindowClient,
  testTimeComputeClient,
  extendedThinkingClient,
  reflexionClient,
  contextEngineeringClient,
  agentSkillsClient,
  trajectoryEvalClient,
  evalClient,
  goldenSetClient,
  regressionSuiteClient,
  traceSpanClient,
  observabilityClient,
  llmAsJudgeClient,
  evalDrivenDevelopmentClient,
  hallucinationGuardClient,
  worktreeIsolationClient,
  vibeCodingClient,
  agenticEngineeringClient,
  ragClient,
  agenticRagClient,
  groundingClient,
  agenticFileSearchClient,
  vectorDbClient,
  gracefulDegradationClient,
  idempotencyClient,
  separationOfConcernsClient,
  eventDrivenClient,
  backpressureClient,
  durableExecutionClient,
  atomicWriteClient,
  promptInjectionClient,
  owaspAsiClient,
  goalHijackClient,
  memoryPoisoningClient,
  agenticSupplyChainClient,
  cascadingFailureClient,
  agentCardClient,
  toolSearchClient,
  compactionWatchClient,
  contextEditingClient,
  specDrivenClient,
  preCommitGateClient,
  ssotDriftClient,
  adrPresenceClient,
  schemaEvolutionClient,
  mcpClientInventoryClient,
  a2aClient,
  acpAnpClient,
  agentsMdClient,
  computerUseClient,
  chunkingClient,
  rerankingClient,
  hybridSearchClient,
  multiHopClient,
  queryRewritingClient,
  benchmarkHygieneClient,
  hybridWorkflowClient,
  rescueEngineeringClient,
  promptCachingClient,
  toolMisuseClient,
  dataExfiltrationClient,
  mcpServerClient,
  killSwitchClient,
  agentRegistryClient,
];

export function getClientModule(id: string): PluginClientModule | undefined {
  return PLUGIN_CLIENT_MODULES.find((m) => m.manifest.id === id);
}
