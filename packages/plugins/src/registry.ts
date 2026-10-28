/**
 * §5.11 — 플러그인 등록부. **플러그인 추가 = 이 파일에 한 줄**(코드젠·자동 스캔 ❌ — 무엇이 빌드에 들었는지 한눈에 보여야 한다).
 * 매니페스트(선언)만 둔다 — 구현은 `client.ts`/`server.ts` 배럴이 모아, PluginsWindow 가 비활성 구현을 안 건드리고 목록을 그린다.
 */
import type { PluginManifest } from '@vibisual/shared';
import type { PluginDataNeed } from './types.js';
import { PLUGIN_ID_PATTERN, PLUGIN_SUPPORTED_CONTRIBUTIONS } from '@vibisual/shared';
// 경로 대소문자 정책 SSOT(`shared/pathCase.ts`) — win32/darwin 만 접고 linux 는 접지 않는다.
import { legacyLowerPathKey, pathKey, type PlatformName } from '@vibisual/shared';
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

/** 호스트가 채워 주는 데이터 축의 단일 출처 — 축 추가는 여기 한 줄 + 호스트 `usePluginData` 한 줄(유니온·검증을 따로 두면 한쪽을 빠뜨린다). */
export const PLUGIN_DATA_NEEDS: readonly PluginDataNeed[] = [
  'agentEvents',
  'subAgents',
  'runningTasks',
  'agentReports',
  'agentReviews',
  // ⑲ — 되풀이가 절차로 굳은 정도. 폐기된 `brain` 축이 앉아 있던 자리다(통폐합).
  'autoGoal',
  'taskEdges',
  'captureBubbles',
  'bashCommands',
  // 집행이 프로젝트 파일을 훑어 낸 실측 — 카드가 집행과 같은 것을 세는 유일한 통로.
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
 * `enabledPlugins` 가 undefined(Plugins 창을 안 건드림)일 때의 기본 활성 집합 — 한 번 저장되면 그 배열이 진실이다.
 * 등록부에 없는 id 는 걸러낸다 — 안 거르면 켠 개수가 등록 수를 넘고(`112 / 111`) 서버 관문이 없는 플러그인을 켜짐으로 읽는다.
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

// ── 프로젝트별 활성 (§5.11) ──

/** 켬/끔의 출처 — `UserDefaults` 중 이 판정에 필요한 두 필드만 구조적으로 받는다(전체를 알면 테스트가 무거워진다). */
export interface PluginEnablementSource {
  /** 프로젝트 절대경로 → 켠 플러그인 id 목록. */
  enabledPluginsByProject?: Record<string, string[]>;
  /** @deprecated 구 전역 목록 — 아직 프로젝트별 설정이 없는 프로젝트의 시드로만 읽는다. */
  enabledPlugins?: string[];
}

/**
 * 원본 배열(해석 전) — `프로젝트별 → 구 전역 시드 → undefined(=기본값)`. 시드는 프로젝트별 설정 이전에 켠 것을 판올림에 잃지 않게 둔다.
 * 프로젝트 키가 한 번 저장되면 시드는 안 본다("전부 끔"이 서게). `projectId` 가 없으면 시드만(안 매인 켬/끔을 만들지 않는다).
 */
export function selectProjectEnabledList(
  source: PluginEnablementSource | null | undefined,
  projectId: string | null | undefined,
  platform?: PlatformName,
): string[] | undefined {
  const byProject = source?.enabledPluginsByProject;
  if (projectId && byProject) {
    if (Object.prototype.hasOwnProperty.call(byProject, projectId)) return byProject[projectId];
    // 같은 폴더인데 대소문자·역슬래시만 다른 경로가 들어오는 경우(Windows). 클라는 스냅샷의 `path` 를
    // 그대로 쓰지만 서버 관문은 appState 에서 온 경로를 쓰므로, 여기서 한 번 눅여 주지 않으면
    // **같은 프로젝트가 두 칸으로 갈려** 창에서 켠 것이 서버에서 꺼진 것으로 읽힌다.
    const key = normalizeProjectKey(projectId, platform);
    for (const [k, v] of Object.entries(byProject)) {
      if (normalizeProjectKey(k, platform) === key) return v;
    }
    // 하위호환 — 옛 저장분은 플랫폼 무관 소문자 키다. 정확 일치가 없고 칸 자체가 소문자일 때만 본다(섞인 칸은 새 방식의 남의 칸)
    // — 없으면 업그레이드한 linux 사용자의 켠 플러그인이 꺼진 것으로 읽힌다.
    const legacy = legacyLowerPathKey(projectId);
    for (const [k, v] of Object.entries(byProject)) {
      if (isLegacyLowerKey(k) && k === legacy) return v;
    }
  }
  return source?.enabledPlugins;
}

/**
 * `normalizeProjectKey`(아래): `/` 통일 + 끝 슬래시 제거 + 플랫폼이 실제로 무시할 때만 소문자(Linux 는 `Feature-X` ≠ `feature-x`).
 * 브라우저에서도 로드돼 `process.platform` 을 못 읽는다 — 인자를 생략하면 무조건 접고, 서버는 `process.platform` 을 넘긴다.
 */

/**
 * 옛 방식(플랫폼 무관 소문자) 키일 수 있는가 — 읽기 폴백 대상. 대소문자 섞인 키는 제외한다
 * — 안 그러면 linux 에서 `feature-x` 조회가 `Feature-X` 칸을 집어 케이스만 다른 두 프로젝트가 다시 합쳐진다.
 */
function isLegacyLowerKey(k: string): boolean {
  return k === legacyLowerPathKey(k);
}

function normalizeProjectKey(p: string, platform?: PlatformName): string {
  if (platform !== undefined) return pathKey(p, platform);
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

/** 저장에 쓸 실제 키 — 같은 폴더를 가리키는 칸(옛 소문자 키 포함)이 있으면 그 이름을 쓴다. 못 찾으면 부분 저장(한 칸 PUT)이 새 칸을 만들어 기존 설정이 밀린다. */
export function resolveProjectKey(
  source: PluginEnablementSource | null | undefined,
  projectId: string,
  platform?: PlatformName,
): string {
  const keys = Object.keys(source?.enabledPluginsByProject ?? {});
  const key = normalizeProjectKey(projectId, platform);
  const hit = keys.find((k) => normalizeProjectKey(k, platform) === key);
  if (hit !== undefined) return hit;
  const legacy = legacyLowerPathKey(projectId);
  return keys.find((k) => isLegacyLowerKey(k) && k === legacy) ?? projectId;
}

/** 프로젝트 하나에 대한 활성 집합. 창·클라 호스트·서버 관문이 **모두** 이 함수를 통과한다. */
export function resolveEnabledPluginsFor(
  source: PluginEnablementSource | null | undefined,
  projectId: string | null | undefined,
  platform?: PlatformName,
): Set<string> {
  return resolveEnabledPlugins(selectProjectEnabledList(source, projectId, platform));
}

/** 프로젝트 하나에서 이 플러그인이 켜져 있는가. 서버 관문(409)이 쓰는 판정. */
export function isPluginEnabledFor(
  id: string,
  source: PluginEnablementSource | null | undefined,
  projectId: string | null | undefined,
  platform?: PlatformName,
): boolean {
  return resolveEnabledPluginsFor(source, projectId, platform).has(id);
}

/**
 * §5.5 #17-44 ⑧(d) — 켬/끔 손잡이가 이 기능 자신의 화면에 있는가(그런 카드는 Plugins 목록에 안 서고 집행·카드 호스트가 켬 집합 없이 통과시킨다).
 * **판정은 여기 하나뿐** — 그래야 목록·집행·카드가 같은 답을 말한다.
 */
export function hasOwnToggle(manifest: PluginManifest | undefined): boolean {
  return manifest?.ownToggle === true;
}

/** 한 프로젝트 목록만 갈아 끼운 새 맵(다른 칸은 그대로) — 저장 경로를 여기 하나로 모아 "한 칸만 보냈는데 나머지가 날아갔다"(§4 agent-config PUT 강등)를 막는다. */
export function withProjectEnabled(
  source: PluginEnablementSource | null | undefined,
  projectId: string,
  enabled: string[],
  platform?: PlatformName,
): Record<string, string[]> {
  const prev = source?.enabledPluginsByProject ?? {};
  // 읽는 쪽과 같은 함수로 칸을 고른다(옛 소문자 키 폴백 포함) — 아니면 켠 것이 다른 칸에 적혀 꺼진 것으로 읽힌다.
  return { ...prev, [resolveProjectKey(source, projectId, platform)]: enabled };
}

/** 매니페스트가 선언했지만 호스트가 아직 슬롯을 열지 않은 기여들 — PluginsWindow 가 "미지원"으로 표시. */
export function unsupportedContributions(manifest: PluginManifest): string[] {
  return manifest.contributes.filter((c) => !PLUGIN_SUPPORTED_CONTRIBUTIONS.includes(c));
}

/** 등록부 자체 검증(id 규약 위반·중복). 던지지 않고 문제 목록을 돌려준다 — 플러그인 하나 때문에 앱이 못 뜨면 안 된다. */
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
