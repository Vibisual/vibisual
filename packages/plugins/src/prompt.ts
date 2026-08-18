/**
 * §5.11 v4.57 → v4.59 — **집행 기여 배럴** (서버 전용).
 *
 * v4.57 이 집행 슬롯을 열었을 때 여기 실린 카드는 하나뿐이었다. 그래서 나머지는 켜도 화면 한 칸이
 * 느는 것이 전부였고, 사용자가 그대로 지적했다 — "켜면 우리 프로젝트에 **영향력을 행사**해야 한다.
 * 각자 SSOT 처럼 강제할 수 있는 핵심이 있을 거 아니냐." v4.59 에서 **111종 전부**가 여기 실린다.
 *
 * 규율 넷을 배럴이 강제한다.
 *  ① **켠 프로젝트에서만** — 판정은 다른 곳과 같은 `resolveEnabledPluginsFor` 하나를 통과한다.
 *  ② **낼 말이 있을 때만** — `buildBlock` 이 빈 값을 주면 아무것도 붙지 않는다.
 *  ③ **한 카드가 죽어도 턴은 산다** — 블록 조립 실패는 그 카드만 건너뛴다.
 *  ④ 각 카드의 집행 내용은 **자기 폴더의 `enforce.ts`** 에 있다(자립 규약 — 폴더를 복사하면 집행도 간다).
 *
 * React 를 물지 않는다(카드 모듈 import 금지) — 서버가 프롬프트 한 줄 만들려고 렌더 트리를 끌어오면 안 된다.
 * 별칭에 `e` 접두사를 붙이는 이유는 id 중 `eval` 처럼 **식별자로 못 쓰는 낱말**이 있기 때문이다.
 */
import type { PluginFactMap, PluginPromptContext, PluginPromptModule } from './types.js';
import { getPluginManifest, resolveEnabledPluginsFor, type PluginEnablementSource } from './registry.js';
import { enforcement as eA2a } from './a2a/enforce.js';
import { enforcement as eAcpAnp } from './acp-anp/enforce.js';
import { enforcement as eAdrPresence } from './adr-presence/enforce.js';
import { enforcement as eAgentCard } from './agent-card/enforce.js';
import { enforcement as eAgentHarness } from './agent-harness/enforce.js';
import { enforcement as eAgentLoop } from './agent-loop/enforce.js';
import { enforcement as eAgentRegistry } from './agent-registry/enforce.js';
import { enforcement as eAgentSkills } from './agent-skills/enforce.js';
import { enforcement as eAgenticEngineering } from './agentic-engineering/enforce.js';
import { enforcement as eAgenticFileSearch } from './agentic-file-search/enforce.js';
import { enforcement as eAgenticRag } from './agentic-rag/enforce.js';
import { enforcement as eAgenticSupplyChain } from './agentic-supply-chain/enforce.js';
import { enforcement as eAgentsMd } from './agents-md/enforce.js';
import { enforcement as eAllowlist } from './allowlist/enforce.js';
import { enforcement as eAtomicWrite } from './atomic-write/enforce.js';
import { enforcement as eAuditTrail } from './audit-trail/enforce.js';
import { enforcement as eAutonomyLevel } from './autonomy-level/enforce.js';
import { enforcement as eBackpressure } from './backpressure/enforce.js';
import { enforcement as eBenchmarkHygiene } from './benchmark-hygiene/enforce.js';
import { enforcement as eBlastRadius } from './blast-radius/enforce.js';
import { enforcement as eCascadingFailure } from './cascading-failure/enforce.js';
import { enforcement as eChunking } from './chunking/enforce.js';
import { enforcement as eCompactionWatch } from './compaction-watch/enforce.js';
import { enforcement as eComputerUse } from './computer-use/enforce.js';
import { enforcement as eContainment } from './containment/enforce.js';
import { enforcement as eContextEditing } from './context-editing/enforce.js';
import { enforcement as eContextEngineering } from './context-engineering/enforce.js';
import { enforcement as eContextPollution } from './context-pollution/enforce.js';
import { enforcement as eContextRot } from './context-rot/enforce.js';
import { enforcement as eContextWindow } from './context-window/enforce.js';
import { enforcement as eCostPerTask } from './cost-per-task/enforce.js';
import { enforcement as eDataExfiltration } from './data-exfiltration/enforce.js';
import { enforcement as eDurableExecution } from './durable-execution/enforce.js';
import { enforcement as eEpisodicMemory } from './episodic-memory/enforce.js';
import { enforcement as eEval } from './eval/enforce.js';
import { enforcement as eEvalDrivenDevelopment } from './eval-driven-development/enforce.js';
import { enforcement as eEventDriven } from './event-driven/enforce.js';
import { enforcement as eExtendedThinking } from './extended-thinking/enforce.js';
import { enforcement as eFanOut } from './fan-out/enforce.js';
import { enforcement as eForgettingPolicy } from './forgetting-policy/enforce.js';
import { enforcement as eGoalHijack } from './goal-hijack/enforce.js';
import { enforcement as eGoldenSet } from './golden-set/enforce.js';
import { enforcement as eGracefulDegradation } from './graceful-degradation/enforce.js';
import { enforcement as eGrounding } from './grounding/enforce.js';
import { enforcement as eGuardrails } from './guardrails/enforce.js';
import { enforcement as eHallucinationGuard } from './hallucination-guard/enforce.js';
import { enforcement as eHandoffPacket } from './handoff-packet/enforce.js';
import { enforcement as eHookLifecycle } from './hook-lifecycle/enforce.js';
import { enforcement as eHumanInTheLoop } from './human-in-the-loop/enforce.js';
import { enforcement as eHybridSearch } from './hybrid-search/enforce.js';
import { enforcement as eHybridWorkflow } from './hybrid-workflow/enforce.js';
import { enforcement as eIdempotency } from './idempotency/enforce.js';
import { enforcement as eInstructionDrift } from './instruction-drift/enforce.js';
import { enforcement as eKillSwitch } from './kill-switch/enforce.js';
import { enforcement as eLeastPrivilege } from './least-privilege/enforce.js';
import { enforcement as eLethalTrifecta } from './lethal-trifecta/enforce.js';
import { enforcement as eLlmAsJudge } from './llm-as-judge/enforce.js';
import { enforcement as eLongHorizon } from './long-horizon/enforce.js';
import { enforcement as eMcpClientInventory } from './mcp-client-inventory/enforce.js';
import { enforcement as eMcpServer } from './mcp-server/enforce.js';
import { enforcement as eMemoryConsolidation } from './memory-consolidation/enforce.js';
import { enforcement as eMemoryDrift } from './memory-drift/enforce.js';
import { enforcement as eMemoryInvalidation } from './memory-invalidation/enforce.js';
import { enforcement as eMemoryPoisoning } from './memory-poisoning/enforce.js';
import { enforcement as eMemoryTool } from './memory-tool/enforce.js';
import { enforcement as eModelRouting } from './model-routing/enforce.js';
import { enforcement as eMultiHop } from './multi-hop/enforce.js';
import { enforcement as eNonHumanIdentity } from './non-human-identity/enforce.js';
import { enforcement as eObservability } from './observability/enforce.js';
import { enforcement as eOrchestrator } from './orchestrator/enforce.js';
import { enforcement as eOwaspAsi } from './owasp-asi/enforce.js';
import { enforcement as ePlanAndExecute } from './plan-and-execute/enforce.js';
import { enforcement as ePreCommitGate } from './pre-commit-gate/enforce.js';
import { enforcement as eProceduralMemory } from './procedural-memory/enforce.js';
import { enforcement as eProgressiveDisclosure } from './progressive-disclosure/enforce.js';
import { enforcement as ePromptCaching } from './prompt-caching/enforce.js';
import { enforcement as ePromptInjection } from './prompt-injection/enforce.js';
import { enforcement as eQueryRewriting } from './query-rewriting/enforce.js';
import { enforcement as eRag } from './rag/enforce.js';
import { enforcement as eReactPattern } from './react-pattern/enforce.js';
import { enforcement as eReasoningEffort } from './reasoning-effort/enforce.js';
import { enforcement as eReflexion } from './reflexion/enforce.js';
import { enforcement as eRegressionSuite } from './regression-suite/enforce.js';
import { enforcement as eReranking } from './reranking/enforce.js';
import { enforcement as eRescueEngineering } from './rescue-engineering/enforce.js';
import { enforcement as eReviewGate } from './review-gate/enforce.js';
import { enforcement as eRogueAgent } from './rogue-agent/enforce.js';
import { enforcement as eSandboxing } from './sandboxing/enforce.js';
import { enforcement as eScaffold } from './scaffold/enforce.js';
import { enforcement as eSchemaEvolution } from './schema-evolution/enforce.js';
import { enforcement as eScopeCreep } from './scope-creep/enforce.js';
import { enforcement as eSemanticMemory } from './semantic-memory/enforce.js';
import { enforcement as eSeparationOfConcerns } from './separation-of-concerns/enforce.js';
import { enforcement as eSpecDriven } from './spec-driven/enforce.js';
import { enforcement as eSsotDrift } from './ssot-drift/enforce.js';
import { enforcement as eStructuredOutput } from './structured-output/enforce.js';
import { enforcement as eSubagent } from './subagent/enforce.js';
import { enforcement as eSupersede } from './supersede/enforce.js';
import { enforcement as eSystemPrompt } from './system-prompt/enforce.js';
import { enforcement as eTestTimeCompute } from './test-time-compute/enforce.js';
import { enforcement as eTokenBudget } from './token-budget/enforce.js';
import { enforcement as eToolMisuse } from './tool-misuse/enforce.js';
import { enforcement as eToolSearch } from './tool-search/enforce.js';
import { enforcement as eToolUse } from './tool-use/enforce.js';
import { enforcement as eTraceSpan } from './trace-span/enforce.js';
import { enforcement as eTrajectoryEval } from './trajectory-eval/enforce.js';
import { enforcement as eVectorDb } from './vector-db/enforce.js';
import { enforcement as eVerifierCritic } from './verifier-critic/enforce.js';
import { enforcement as eVibeCoding } from './vibe-coding/enforce.js';
import { enforcement as eWorkingMemory } from './working-memory/enforce.js';
import { enforcement as eWorktreeIsolation } from './worktree-isolation/enforce.js';

/** 집행 기여를 가진 플러그인들 — 등록된 111종 전부. 새 플러그인 = 여기 한 줄 + 그 폴더의 enforce.ts. */
export const PLUGIN_PROMPT_MODULES: readonly PluginPromptModule[] = [
  eA2a,
  eAcpAnp,
  eAdrPresence,
  eAgentCard,
  eAgentHarness,
  eAgentLoop,
  eAgentRegistry,
  eAgentSkills,
  eAgenticEngineering,
  eAgenticFileSearch,
  eAgenticRag,
  eAgenticSupplyChain,
  eAgentsMd,
  eAllowlist,
  eAtomicWrite,
  eAuditTrail,
  eAutonomyLevel,
  eBackpressure,
  eBenchmarkHygiene,
  eBlastRadius,
  eCascadingFailure,
  eChunking,
  eCompactionWatch,
  eComputerUse,
  eContainment,
  eContextEditing,
  eContextEngineering,
  eContextPollution,
  eContextRot,
  eContextWindow,
  eCostPerTask,
  eDataExfiltration,
  eDurableExecution,
  eEpisodicMemory,
  eEval,
  eEvalDrivenDevelopment,
  eEventDriven,
  eExtendedThinking,
  eFanOut,
  eForgettingPolicy,
  eGoalHijack,
  eGoldenSet,
  eGracefulDegradation,
  eGrounding,
  eGuardrails,
  eHallucinationGuard,
  eHandoffPacket,
  eHookLifecycle,
  eHumanInTheLoop,
  eHybridSearch,
  eHybridWorkflow,
  eIdempotency,
  eInstructionDrift,
  eKillSwitch,
  eLeastPrivilege,
  eLethalTrifecta,
  eLlmAsJudge,
  eLongHorizon,
  eMcpClientInventory,
  eMcpServer,
  eMemoryConsolidation,
  eMemoryDrift,
  eMemoryInvalidation,
  eMemoryPoisoning,
  eMemoryTool,
  eModelRouting,
  eMultiHop,
  eNonHumanIdentity,
  eObservability,
  eOrchestrator,
  eOwaspAsi,
  ePlanAndExecute,
  ePreCommitGate,
  eProceduralMemory,
  eProgressiveDisclosure,
  ePromptCaching,
  ePromptInjection,
  eQueryRewriting,
  eRag,
  eReactPattern,
  eReasoningEffort,
  eReflexion,
  eRegressionSuite,
  eReranking,
  eRescueEngineering,
  eReviewGate,
  eRogueAgent,
  eSandboxing,
  eScaffold,
  eSchemaEvolution,
  eScopeCreep,
  eSemanticMemory,
  eSeparationOfConcerns,
  eSpecDriven,
  eSsotDrift,
  eStructuredOutput,
  eSubagent,
  eSupersede,
  eSystemPrompt,
  eTestTimeCompute,
  eTokenBudget,
  eToolMisuse,
  eToolSearch,
  eToolUse,
  eTraceSpan,
  eTrajectoryEval,
  eVectorDb,
  eVerifierCritic,
  eVibeCoding,
  eWorkingMemory,
  eWorktreeIsolation,
];

/** 이 프로젝트에서 켜져 있고 집행 기여를 가진 모듈들. 등록부에 없는 id 는 걸러낸다. */
export function activePromptModules(
  source: PluginEnablementSource | null | undefined,
  projectId: string | null | undefined,
): PluginPromptModule[] {
  const enabled = resolveEnabledPluginsFor(source, projectId);
  return PLUGIN_PROMPT_MODULES.filter((m) => enabled.has(m.id) && getPluginManifest(m.id) !== undefined);
}

/**
 * 켠 플러그인들의 지시 블록을 이어 붙인다. 하나도 없으면 **빈 문자열** — 호출부가 그대로 더해도 프롬프트가
 * 한 글자도 늘지 않는다(플러그인을 안 켠 프로젝트는 이 기능이 없던 때와 완전히 같아야 한다).
 */
export function buildPluginPromptBlocks(
  source: PluginEnablementSource | null | undefined,
  projectId: string | null | undefined,
  ctx: PluginPromptContext,
  onError?: (id: string, err: unknown) => void,
): string {
  return buildPluginPromptParts(source, projectId, ctx, onError).map((p) => p.block).join('');
}

/**
 * §5.5 #17-28 — 위와 같은 조립이지만 **플러그인별로 갈라서** 돌려준다.
 *
 * 주입원 통제 화면이 "어느 플러그인이 몇 자를 실었는지"를 한 줄씩 보여 주고, 사용자가 그중 하나만
 * 끌 수 있으려면 합쳐지기 **전**의 조각이 필요하다. 이어 붙이면 위 함수와 완전히 같은 문자열이므로
 * 두 경로가 갈라지지 않는다.
 */
export function buildPluginPromptParts(
  source: PluginEnablementSource | null | undefined,
  projectId: string | null | undefined,
  ctx: PluginPromptContext,
  onError?: (id: string, err: unknown) => void,
): { id: string; block: string }[] {
  const out: { id: string; block: string }[] = [];
  for (const mod of activePromptModules(source, projectId)) {
    try {
      const block = mod.buildBlock(ctx);
      if (typeof block === 'string' && block.trim() !== '') out.push({ id: mod.id, block });
    } catch (err) {
      onError?.(mod.id, err);
    }
  }
  return out;
}

/**
 * §5.11 v4.65 — 켠 집행 모듈들의 **실측**을 모은다(카드가 같은 값을 그리게 하기 위한 것).
 *
 * `buildPluginPromptBlocks` 와 같은 관문(`activePromptModules`)을 통과하므로 **켠 프로젝트의 것만**
 * 나오고, 실측을 안 내는 모듈은 키 자체가 없다. 한 장이 던져도 나머지는 산다 — 이 값은 표시용이라
 * 여기서 던져 프롬프트 조립을 막을 이유가 전혀 없다.
 */
export function collectPluginFacts(
  source: PluginEnablementSource | null | undefined,
  projectId: string | null | undefined,
  ctx: PluginPromptContext,
  onError?: (id: string, err: unknown) => void,
): Record<string, PluginFactMap> {
  const out: Record<string, PluginFactMap> = {};
  for (const mod of activePromptModules(source, projectId)) {
    if (!mod.survey) continue;
    try {
      const facts = mod.survey(ctx);
      if (facts && Object.keys(facts).length > 0) out[mod.id] = facts;
    } catch (err) {
      onError?.(mod.id, err);
    }
  }
  return out;
}
