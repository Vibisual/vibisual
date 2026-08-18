/**
 * §5.11 v4.58 — 플러그인 문자열 배럴.
 *
 * 각 플러그인은 자기 폴더 안 `strings.ts` 에 12개 로케일을 통째로 들고 있다(자립 규약 ④). 호스트는
 * 여기서 그것을 모아 `panel.plugins.<camelId>` 지붕 아래로 넣는다 — **키 네임스페이스는 고정 6개
 * 규칙 그대로**이고, 바뀐 것은 그 문자열이 **어느 파일에 사는가**뿐이다.
 *
 * 등록은 자동 스캔이 아니라 **한 줄씩 명시**다(§5.11) — 무엇이 빌드에 들어가 있는지가 한눈에 보여야 한다.
 *
 * ⚠ import 별칭에 `s` 접두사를 붙인다. 플러그인 id 중에는 `eval` 처럼 **식별자로 못 쓰는 낱말**이 있어
 * 이름을 그대로 쓰면 그 한 줄 때문에 패키지 전체가 파싱 단계에서 무너진다.
 */
import { strings as sA2a } from './a2a/strings.js';
import { strings as sAcpAnp } from './acp-anp/strings.js';
import { strings as sAdrPresence } from './adr-presence/strings.js';
import { strings as sAgentCard } from './agent-card/strings.js';
import { strings as sAgentHarness } from './agent-harness/strings.js';
import { strings as sAgenticEngineering } from './agentic-engineering/strings.js';
import { strings as sAgenticFileSearch } from './agentic-file-search/strings.js';
import { strings as sAgenticRag } from './agentic-rag/strings.js';
import { strings as sAgenticSupplyChain } from './agentic-supply-chain/strings.js';
import { strings as sAgentLoop } from './agent-loop/strings.js';
import { strings as sAgentRegistry } from './agent-registry/strings.js';
import { strings as sAgentSkills } from './agent-skills/strings.js';
import { strings as sAgentsMd } from './agents-md/strings.js';
import { strings as sAllowlist } from './allowlist/strings.js';
import { strings as sAtomicWrite } from './atomic-write/strings.js';
import { strings as sAuditTrail } from './audit-trail/strings.js';
import { strings as sAutonomyLevel } from './autonomy-level/strings.js';
import { strings as sBackpressure } from './backpressure/strings.js';
import { strings as sBenchmarkHygiene } from './benchmark-hygiene/strings.js';
import { strings as sBlastRadius } from './blast-radius/strings.js';
import { strings as sCascadingFailure } from './cascading-failure/strings.js';
import { strings as sChunking } from './chunking/strings.js';
import { strings as sCompactionWatch } from './compaction-watch/strings.js';
import { strings as sComputerUse } from './computer-use/strings.js';
import { strings as sContainment } from './containment/strings.js';
import { strings as sContextEditing } from './context-editing/strings.js';
import { strings as sContextEngineering } from './context-engineering/strings.js';
import { strings as sContextPollution } from './context-pollution/strings.js';
import { strings as sContextRot } from './context-rot/strings.js';
import { strings as sContextWindow } from './context-window/strings.js';
import { strings as sCostPerTask } from './cost-per-task/strings.js';
import { strings as sDataExfiltration } from './data-exfiltration/strings.js';
import { strings as sDurableExecution } from './durable-execution/strings.js';
import { strings as sEpisodicMemory } from './episodic-memory/strings.js';
import { strings as sEval } from './eval/strings.js';
import { strings as sEvalDrivenDevelopment } from './eval-driven-development/strings.js';
import { strings as sEventDriven } from './event-driven/strings.js';
import { strings as sExtendedThinking } from './extended-thinking/strings.js';
import { strings as sFanOut } from './fan-out/strings.js';
import { strings as sForgettingPolicy } from './forgetting-policy/strings.js';
import { strings as sGoalHijack } from './goal-hijack/strings.js';
import { strings as sGoldenSet } from './golden-set/strings.js';
import { strings as sGracefulDegradation } from './graceful-degradation/strings.js';
import { strings as sGrounding } from './grounding/strings.js';
import { strings as sGuardrails } from './guardrails/strings.js';
import { strings as sHallucinationGuard } from './hallucination-guard/strings.js';
import { strings as sHandoffPacket } from './handoff-packet/strings.js';
import { strings as sHookLifecycle } from './hook-lifecycle/strings.js';
import { strings as sHumanInTheLoop } from './human-in-the-loop/strings.js';
import { strings as sHybridSearch } from './hybrid-search/strings.js';
import { strings as sHybridWorkflow } from './hybrid-workflow/strings.js';
import { strings as sIdempotency } from './idempotency/strings.js';
import { strings as sInstructionDrift } from './instruction-drift/strings.js';
import { strings as sKillSwitch } from './kill-switch/strings.js';
import { strings as sLeastPrivilege } from './least-privilege/strings.js';
import { strings as sLethalTrifecta } from './lethal-trifecta/strings.js';
import { strings as sLlmAsJudge } from './llm-as-judge/strings.js';
import { strings as sLongHorizon } from './long-horizon/strings.js';
import { strings as sMcpClientInventory } from './mcp-client-inventory/strings.js';
import { strings as sMcpServer } from './mcp-server/strings.js';
import { strings as sMemoryConsolidation } from './memory-consolidation/strings.js';
import { strings as sMemoryDrift } from './memory-drift/strings.js';
import { strings as sMemoryInvalidation } from './memory-invalidation/strings.js';
import { strings as sMemoryPoisoning } from './memory-poisoning/strings.js';
import { strings as sMemoryTool } from './memory-tool/strings.js';
import { strings as sModelRouting } from './model-routing/strings.js';
import { strings as sMultiHop } from './multi-hop/strings.js';
import { strings as sNonHumanIdentity } from './non-human-identity/strings.js';
import { strings as sObservability } from './observability/strings.js';
import { strings as sOrchestrator } from './orchestrator/strings.js';
import { strings as sOwaspAsi } from './owasp-asi/strings.js';
import { strings as sPlanAndExecute } from './plan-and-execute/strings.js';
import { strings as sPreCommitGate } from './pre-commit-gate/strings.js';
import { strings as sProceduralMemory } from './procedural-memory/strings.js';
import { strings as sProgressiveDisclosure } from './progressive-disclosure/strings.js';
import { strings as sPromptCaching } from './prompt-caching/strings.js';
import { strings as sPromptInjection } from './prompt-injection/strings.js';
import { strings as sQueryRewriting } from './query-rewriting/strings.js';
import { strings as sRag } from './rag/strings.js';
import { strings as sReactPattern } from './react-pattern/strings.js';
import { strings as sReasoningEffort } from './reasoning-effort/strings.js';
import { strings as sReflexion } from './reflexion/strings.js';
import { strings as sRegressionSuite } from './regression-suite/strings.js';
import { strings as sReranking } from './reranking/strings.js';
import { strings as sRescueEngineering } from './rescue-engineering/strings.js';
import { strings as sReviewGate } from './review-gate/strings.js';
import { strings as sRogueAgent } from './rogue-agent/strings.js';
import { strings as sSandboxing } from './sandboxing/strings.js';
import { strings as sScaffold } from './scaffold/strings.js';
import { strings as sSchemaEvolution } from './schema-evolution/strings.js';
import { strings as sScopeCreep } from './scope-creep/strings.js';
import { strings as sSemanticMemory } from './semantic-memory/strings.js';
import { strings as sSeparationOfConcerns } from './separation-of-concerns/strings.js';
import { strings as sSpecDriven } from './spec-driven/strings.js';
import { strings as sSsotDrift } from './ssot-drift/strings.js';
import { strings as sStructuredOutput } from './structured-output/strings.js';
import { strings as sSubagent } from './subagent/strings.js';
import { strings as sSupersede } from './supersede/strings.js';
import { strings as sSystemPrompt } from './system-prompt/strings.js';
import { strings as sTestTimeCompute } from './test-time-compute/strings.js';
import { strings as sTokenBudget } from './token-budget/strings.js';
import { strings as sToolMisuse } from './tool-misuse/strings.js';
import { strings as sToolSearch } from './tool-search/strings.js';
import { strings as sToolUse } from './tool-use/strings.js';
import { strings as sTraceSpan } from './trace-span/strings.js';
import { strings as sTrajectoryEval } from './trajectory-eval/strings.js';
import { strings as sVectorDb } from './vector-db/strings.js';
import { strings as sVerifierCritic } from './verifier-critic/strings.js';
import { strings as sVibeCoding } from './vibe-coding/strings.js';
import { strings as sWorkingMemory } from './working-memory/strings.js';
import { strings as sWorktreeIsolation } from './worktree-isolation/strings.js';

/** 로케일 → 그 로케일의 문자열 묶음. */
export type PluginStrings = Readonly<Record<string, unknown>>;

const TABLE: Record<string, Readonly<Record<string, PluginStrings>>> = {
  a2a: sA2a,
  acpAnp: sAcpAnp,
  adrPresence: sAdrPresence,
  agentCard: sAgentCard,
  agentHarness: sAgentHarness,
  agenticEngineering: sAgenticEngineering,
  agenticFileSearch: sAgenticFileSearch,
  agenticRag: sAgenticRag,
  agenticSupplyChain: sAgenticSupplyChain,
  agentLoop: sAgentLoop,
  agentRegistry: sAgentRegistry,
  agentSkills: sAgentSkills,
  agentsMd: sAgentsMd,
  allowlist: sAllowlist,
  atomicWrite: sAtomicWrite,
  auditTrail: sAuditTrail,
  autonomyLevel: sAutonomyLevel,
  backpressure: sBackpressure,
  benchmarkHygiene: sBenchmarkHygiene,
  blastRadius: sBlastRadius,
  cascadingFailure: sCascadingFailure,
  chunking: sChunking,
  compactionWatch: sCompactionWatch,
  computerUse: sComputerUse,
  containment: sContainment,
  contextEditing: sContextEditing,
  contextEngineering: sContextEngineering,
  contextPollution: sContextPollution,
  contextRot: sContextRot,
  contextWindow: sContextWindow,
  costPerTask: sCostPerTask,
  dataExfiltration: sDataExfiltration,
  durableExecution: sDurableExecution,
  episodicMemory: sEpisodicMemory,
  eval: sEval,
  evalDrivenDevelopment: sEvalDrivenDevelopment,
  eventDriven: sEventDriven,
  extendedThinking: sExtendedThinking,
  fanOut: sFanOut,
  forgettingPolicy: sForgettingPolicy,
  goalHijack: sGoalHijack,
  goldenSet: sGoldenSet,
  gracefulDegradation: sGracefulDegradation,
  grounding: sGrounding,
  guardrails: sGuardrails,
  hallucinationGuard: sHallucinationGuard,
  handoffPacket: sHandoffPacket,
  hookLifecycle: sHookLifecycle,
  humanInTheLoop: sHumanInTheLoop,
  hybridSearch: sHybridSearch,
  hybridWorkflow: sHybridWorkflow,
  idempotency: sIdempotency,
  instructionDrift: sInstructionDrift,
  killSwitch: sKillSwitch,
  leastPrivilege: sLeastPrivilege,
  lethalTrifecta: sLethalTrifecta,
  llmAsJudge: sLlmAsJudge,
  longHorizon: sLongHorizon,
  mcpClientInventory: sMcpClientInventory,
  mcpServer: sMcpServer,
  memoryConsolidation: sMemoryConsolidation,
  memoryDrift: sMemoryDrift,
  memoryInvalidation: sMemoryInvalidation,
  memoryPoisoning: sMemoryPoisoning,
  memoryTool: sMemoryTool,
  modelRouting: sModelRouting,
  multiHop: sMultiHop,
  nonHumanIdentity: sNonHumanIdentity,
  observability: sObservability,
  orchestrator: sOrchestrator,
  owaspAsi: sOwaspAsi,
  planAndExecute: sPlanAndExecute,
  preCommitGate: sPreCommitGate,
  proceduralMemory: sProceduralMemory,
  progressiveDisclosure: sProgressiveDisclosure,
  promptCaching: sPromptCaching,
  promptInjection: sPromptInjection,
  queryRewriting: sQueryRewriting,
  rag: sRag,
  reactPattern: sReactPattern,
  reasoningEffort: sReasoningEffort,
  reflexion: sReflexion,
  regressionSuite: sRegressionSuite,
  reranking: sReranking,
  rescueEngineering: sRescueEngineering,
  reviewGate: sReviewGate,
  rogueAgent: sRogueAgent,
  sandboxing: sSandboxing,
  scaffold: sScaffold,
  schemaEvolution: sSchemaEvolution,
  scopeCreep: sScopeCreep,
  semanticMemory: sSemanticMemory,
  separationOfConcerns: sSeparationOfConcerns,
  specDriven: sSpecDriven,
  ssotDrift: sSsotDrift,
  structuredOutput: sStructuredOutput,
  subagent: sSubagent,
  supersede: sSupersede,
  systemPrompt: sSystemPrompt,
  testTimeCompute: sTestTimeCompute,
  tokenBudget: sTokenBudget,
  toolMisuse: sToolMisuse,
  toolSearch: sToolSearch,
  toolUse: sToolUse,
  traceSpan: sTraceSpan,
  trajectoryEval: sTrajectoryEval,
  vectorDb: sVectorDb,
  verifierCritic: sVerifierCritic,
  vibeCoding: sVibeCoding,
  workingMemory: sWorkingMemory,
  worktreeIsolation: sWorktreeIsolation,
};

/**
 * 이 로케일에서 `panel.plugins` 아래에 얹을 카드 문자열 전부.
 * 없는 로케일은 `en` 으로 떨어진다(i18next 폴백과 같은 방향).
 */
export function pluginLocaleResources(locale: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [camelId, byLocale] of Object.entries(TABLE)) {
    out[camelId] = byLocale[locale] ?? byLocale['en'];
  }
  return out;
}
