import { agentRuleShell, isShellToolName } from '@vibisual/shared';
import { readCodexUsage } from './services/codexUsageService.js';
import express from 'express';
import cors from 'cors';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { getAppNodeRuntime } from './services/appNodeRuntime.js';
import { computeDelegationStrip, applyDelegationStrip, resolveEdgeCommandMode, resolveEffectiveDelegationPolicy, hasUsableTools, type DelegationStripDecision } from './services/taskEdgeDelegation.js';
import { randomUUID } from 'node:crypto';
import { exec, execFile, spawn, type ChildProcess } from 'node:child_process';
import multer from 'multer';
import { DEFAULT_PORT, SESSION_SCAN_INTERVAL, FILE_EXISTENCE_CHECK_INTERVAL, SATELLITE_TYPES, IFRAME_PROXY_PATH, AGENT_IDLE_THRESHOLD_MS, AGENT_IDLE_SWEEP_INTERVAL_MS, INTERRUPT_RECONCILE_INTERVAL_MS, ZOMBIE_EXECUTING_GRACE_MS, SUBAGENT_DORMANT_IDLE_MS, SESSION_PROBE_INTERVAL_MS, TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS, TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT, TASK_EDGE_DEFAULTS, TASK_EDGE_AUTO_REWORK_COMMAND_LABEL, SUPPORTED_UI_LOCALES, CONTI_AGENT_RULES, RULES_HISTORY_MAX, CANVAS_CLIPBOARD_SCHEMA_VERSION, AGENT_INTENT_FIRST_RULES, buildAgentCardCommonRules, AGENT_CARD_ENV_BASE, AGENT_CARD_ENV_TOKEN, buildAgentReportRules, buildAgentQuestionRules, buildAgentReviewRules, buildAgentFeedbackBlock, AGENT_FEEDBACK_SUMMARY_ITEM_MAX, CLAUDE_USAGE_POLL_INTERVAL_MS, CLAUDE_AUTH_POLL_INTERVAL_MS, CLAUDE_AUTO_UPDATE_BOOT_DELAY_MS, HOOK_TRANSPORT_REFRESH_DELAY_MS, SESSION_GOAL_TEXT_MAX, SESSION_GOAL_STEP_SKILLS_MAX, buildSessionGoalRules, buildSessionGoalState, buildSessionGoalProtocol, CONTEXT_SOURCE_IDS, CONTEXT_PLUGIN_ID_PREFIX, CONTEXT_PREVIEW_MAX_CHARS, CONTEXT_SCOPE_LEVELS, estimateTokens, VERIFICATION_VERDICT_SCHEMA_GUIDE, COST_MAP_SWEEP_INTERVAL_MS, normalizeTodoStatus, BUILTIN_SLASH_COMMANDS,
} from '@vibisual/shared';
import type { HookEventPayload, WSMessage, SubAgentStreamEvent, QueuedCommand, SessionTokenData, PipelineType, AgentConfig, TaskEdge, TaskEdgeForwardMode, TaskEdgeKind, TaskEdgeMessageFormat, TaskEdgeReturnFormat, TaskEdgePriority, TaskEdgeCritiqueTiming, TaskEdgeCritiqueAuthority, TaskEdgeCommandMode, SubAgentHistoryItem, UiLocale, PermissionDecision, RulesHistoryEntry, Conti, CanvasClipboardPayload, CanvasPasteResponse, AskUserQuestionDecision, AskUserQuestionAnswer, AskUserQuestionOption, AskUserQuestionItem, AskUserQuestionToolInput, AgentReport, AgentQuestions, AgentQuestionItem, AgentReview, AgentList, AgentFeedback, AgentFeedbackTargetType, AgentFeedbackVerdict, ClaudeUsageInfo, ClaudeAuthStatus, VerificationVerdict, VerificationKind, VerificationAttempt, EscalationReason, AutoAgentRun, ShelfItemKind, ChatCommandTarget, ChatCommandSession } from '@vibisual/shared';
import { LOCAL_MODEL_CATALOG_SORTS } from '@vibisual/shared';
// §4 (설정 3층) — 빠진 칸을 상수로 메우지 않기 위한 기준선(내장 + 설정 창).
import { resolveAgentDefaults } from '@vibisual/shared';
// §4 (첫 실행 온보딩) ③ — 폴더를 고르기 전 생성 요청을 서버도 같은 코드로 거절한다.
import { NO_PROJECT_FOLDER_ERROR } from '@vibisual/shared';
// §4 (CMD 터미널 업그레이드) — pane 트리 정합 + 임베디드 PTY 제어(⑤⑥).
import { sanitizeCmdPaneTree, CMD_CLI_KINDS, sanitizeSessionMemos } from '@vibisual/shared';
import type { CmdTerminalSignal, CmdCliKind, AgentDefinition } from '@vibisual/shared';
import { readCmdTerminal, sendCmdTerminal, waitCmdTerminal, getCmdTerminalController } from './services/cmdTerminalController.js';
// §7.10 — 워크트리 삭제 직전 회수(그 안에서 돌던 프로세스·에이전트).
import { reapWorktree, selectWorktreeAgents, EMPTY_REAP, type WorktreeReapResult } from './services/worktreeReaper.js';

/**
 * §4 — loopback 으로 들어온 termId 가 우리가 발급하는 모양인지 검사한다(형식 밖 값을 PTY 맵 키로 쓰지 않는다).
 * `term:<agentId>:<session>[#pane]` 과 실행 런처 `run:<agentId>:<configId>` 두 모양만 통과.
 */
function isCmdTermId(v: string): boolean {
  return /^(?:term|run):[\w.-]{1,64}:[\w.-]{1,64}(?:#[\w-]{1,32})?$/.test(v);
}
import { WORKSPACE_SITE_PATH, WORKSPACE_SITE_REWRITE_MAX_BYTES, workspaceSiteMime, workspaceSiteBase, parseWorkspaceSitePath, rewriteWorkspaceSiteHtml, rewriteWorkspaceSiteCss, injectWorkspaceSiteAgents, annotateWorkspaceSiteSource, workspaceSiteRewriteKind, WORKSPACE_IMAGE_MAX_BYTES, WORKSPACE_MEDIA_MAX_BYTES, workspaceMediaMime } from '@vibisual/shared';
// §3.2.3 보존 정책 — 상한·기본값은 shared 한 곳, 파일 정리·실측은 storageRetention.
import { RETENTION_LIMITS, DEFAULT_RETENTION_SETTINGS, BG_TASK_PROBE_LIMITS, BG_TASK_PROBE_MODELS, DEFAULT_BG_TASK_PROBE_SETTINGS, type BackgroundTaskProbeSettings } from '@vibisual/shared';
// §6 단축키 SSOT — 기본 바인딩 표 + 식별자 검증(서버는 받은 값을 믿지 않는다).
import { defaultKeymap, isCommandId } from '@vibisual/shared';
// §2.4 — 세션 생존 판정 설정(위 백그라운드 판정과 같은 계약).
import { SESSION_PROBE_LIMITS, SESSION_PROBE_MODELS, DEFAULT_SESSION_PROBE_SETTINGS, type SessionLivenessProbeSettings } from '@vibisual/shared';
import { PROCESS_GUARD_LIMITS, DEFAULT_PROCESS_GUARD_SETTINGS, formatProcessGuardNotice, type ProcessGuardSettings } from '@vibisual/shared';
import { processGuard } from './services/processGuard.js';
// §2.1 (B) — 최상위 외부 폴더 예산의 범위·기본값(설정 UI 와 서버가 같은 표를 본다).
import { EXTERNAL_TOP_BUDGET_BOUNDS, EXTERNAL_TOP_BUDGET_DEFAULT } from '@vibisual/shared';
// §5.23 웹 버블 묶기 — 옵션창의 "되돌리기"·범위가 쓰는 기본값과 경계(정본은 shared 상수).
import { WEB_GROUP_DEFAULTS, WEB_GROUP_MAX_BOUNDS, WEB_OPEN_TARGET_DEFAULT } from '@vibisual/shared';
// §5.13 (Q) 대본 → 콘티 → 렌더.
import { normalizeStoryboardPresetId, CONTI_SCRIPT_EXCERPT_MAX } from '@vibisual/shared';
import type { ContiRenderLink, ContiRenderStatus } from '@vibisual/shared';
import type { StorageCleanupResult, ProjectInfo } from '@vibisual/shared';
import { scanStorageUsage, runStorageCleanup, listTrash, restoreFromTrash } from './services/storageRetention.js';
// §5.5 #17-20 ⑥ — MCP 프리셋 검증(모르는 id 는 설정에 남기지 않는다).
import { findMcpPreset, normalizeAgentProvider, normalizeAgentMemoryScope, normalizeSubagentDepth, normalizeBashTimeoutMs, normalizePluginDirs, AVAILABLE_SETTING_SOURCES, AVAILABLE_AUTOCOMPACT_VALUES } from '@vibisual/shared';
// §5.5 #17-20 ⑫ — 디버그 포트 기본값(비어 있는 자리 찾기의 출발점)
import { DEBUG_PORT_BASE } from '@vibisual/shared';
import { REVIEW_FILES_MAX, REVIEW_DIFF_MAX_BYTES } from '@vibisual/shared';
import { createReviewDecisionHandler } from './services/reviewDecisionRoute.js';
// §5.5 #17-11 — 세션 반복 실행(루프).
import type { SessionLoop, SessionLoopMode, SessionLoopContextMode, SessionGoalStatus, SessionGoalProgressSource, SessionGoalStepStatus } from '@vibisual/shared';
import { TOKEN_SAVER_LIMITS, DEFAULT_TOKEN_SAVER_SETTINGS, normalizeTokenSaverSettings, TOKEN_SAVER_PRESET_VALUES, capMapSize, capSetSize, SESSION_KEYED_MAP_MAX, SESSION_LOOP_MAX_ITERATIONS, SESSION_LOOP_DEFAULT_TOTAL, SESSION_LOOP_DEFAULT_INTERVAL_MS, SESSION_LOOP_MAX_INTERVAL_MS, SESSION_LOOP_COMMAND_MAX, SESSION_LOOP_COMPACT_COMMAND, SESSION_LOOP_CLEAR_COMMAND, SESSION_LOOP_PATH_MAX, SESSION_LOOP_MAX_COST_USD_LIMIT, SESSION_LOOP_MAX_DURATION_LIMIT_MS, AGENT_COMPACT_COMMAND, buildAgentSelfCompactRule, shouldCompactAfterTurn, planSilentPreCompact, silentPreCompactHeirs, heirCutByImmediate, isInternalSlashCommand, withoutSlashCommandFlag } from '@vibisual/shared';
// §5.5 #17-11 ⑫(a)(g) — 루프 회차 프롬프트 합성(순수 모듈) + 누적 비용 추정(모델 레지스트리 가격).
import { composeLoopRoundText } from './services/sessionLoopPrompt.js';
import { sessionsNeedingKick } from './services/queueWatchdog.js';
import { mountAgentCardTaskRoutes } from './services/agentCardTasks.js';
import { captureAgentWorkCommandIds, hasUnfinishedCommandDependencies, followsWaitingSessionCommand } from './services/agentWorkDependencies.js';
// §5.5 #17-35 — 검증(Verify): 프롬프트 조립·판정 해석은 화면 없이 시험되는 순수 모듈에 있다.
import {
  buildVerifyReworkPrompt,
  parseVerificationVerdict,
  recordedSkillRecipe,
  summarizePlayRecipe,
  NO_RECIPE,
} from './services/verificationPrompt.js';
import type { VerifyRecipeInfo } from './services/verificationPrompt.js';
import { createVerificationFrameUpload } from './services/verificationFrameUpload.js';
import { verificationScopeError } from './services/verificationScope.js';
import { VerificationAutomationService, buildVerificationAutomationPrompt, verificationToolHandler } from './services/verificationAutomation.js';
import { getVerificationAutomationAdapter } from './services/verificationAutomationAdapter.js';
export { setVerificationAutomationAdapter } from './services/verificationAutomationAdapter.js';
export type { VerificationAutomationAdapter, VerificationObservation } from './services/verificationAutomationAdapter.js';
import { parseVerificationTarget, parseVerificationAction, parseVerificationCheck, type VerificationTarget } from '@vibisual/shared';
import { resolveVerificationDemoFrames } from './services/verificationFrames.js';
import { calculateTokenCost, resolveAliasToLatest } from '@vibisual/shared';
// §5.5 #17-18 — 덧말 처리 방식(대기/합치기/즉시).
import type { CommandDispatchMode } from '@vibisual/shared';
// §5.13 (R-10) — 명령 한 건의 턴·시간 상한(제작 앱의 '빠른 초안 / 정교하게').
import { normalizeRunLimits } from './services/commandRunLimits.js';
import { normalizeExecutionRequirements } from './services/commandExecutionRequirements.js';
import { normalizeAppNodeIds } from '@vibisual/shared';
import {
  DEFAULT_COMMAND_DISPATCH_MODE,
  normalizeCommandDispatchMode,
  isReadOnlyHookAgent,
  READ_ONLY_HOOK_AGENT_ERROR,
  VERIFICATION_FOCUS_MAX,
  VERIFICATION_REASON_MAX,
  VERIFY_RECORDED_SKILL_PATH,
  VERIFICATION_DEMO_DIR,
  VERIFICATION_DEMO_FRAMES_MAX,
  VERIFICATION_DEMO_LABEL_MAX,
  VERIFICATION_DEMO_EXPECTED_MAX,
  VERIFICATION_DEMO_STEPS_MAX,
  VERIFICATION_DEMO_STEP_TEXT_MAX,
} from '@vibisual/shared';
import type { VerificationRun, VerificationDemo, VerificationDemoStep } from '@vibisual/shared';
import { absorbMergeFollowUps } from './services/followUpMerge.js';
import { permissionBroker } from './services/permissionBroker.js';
// §5.3 #12-1-B — 카드의 답 넷("항상"이 적히는 칸)과 세션 기억.
import { permissionSessionGrants } from './services/permissionSessionGrants.js';
import { isToolDisallowed, PERMISSION_CHOICES, foldPermissionChoice, applyToolListAlways, permissionDecisionSource, codexToolGroup } from '@vibisual/shared';
import type { PermissionChoice, PermissionRequest } from '@vibisual/shared';
// §5.22 — 권한·감사 경계. 위험 판정은 shared 순수 함수 한 곳(서버·클라 같은 답).
import { shouldEscalateRisk, normalizeAuditBoundary } from '@vibisual/shared';
// §5.22 — 위험 판정은 호스트 값(플랫폼·홈)을 물린 이 창구 하나로. 승인 카드와 타임라인이 같은 답을 본다.
import { classifyToolRiskOnHost } from './services/auditLog.js';
import { CodexApprovalMemory, codexApprovalKey, codexPermissionHooksRequired, planCodexPermission, type CodexPermissionHookEvent } from './services/codexPermissionPolicy.js';
// §5.3 #12-3 — 자물쇠. 판정은 shared 한 벌, 호스트 값·엔진에 돌려줄 사유는 이 모듈 한 곳.
import { findToolLockHitsOnHost, lockDenyReason, lockHitsForCard, unmanagedLockAnswer } from './services/pathLockGate.js';
// §5.3 #12-4 — 검증은 시킬 때만 돈다. 분류·요청 해석·판정은 shared 한 벌, 호스트 값은 판정 객체가 물려 준다.
import {
  appRunVerificationScope,
  buildVerificationPolicyRules,
  buildVerificationStateLine,
  buttonVerificationScope,
  hasVerificationGrant,
  inheritVerificationScope,
  isVerificationGateEnabled,
  mergeVerificationScopes,
  verificationScopeFromText,
  VERIFICATION_DENY_REASON,
  VERIFICATION_REQUEST_PROMPT_MAX,
  type CommandVerificationSummary,
  type VerificationScope,
} from '@vibisual/shared';
import { VerificationGate } from './services/verificationGate.js';
import { normalizePathLockTarget, PATH_LOCK_MAX_PER_PROJECT } from '@vibisual/shared';
import type { PathLockHit, PathLockTarget } from '@vibisual/shared';
import type { AuditDecisionSource, AuditBoundaryConfig } from '@vibisual/shared';
import { askUserQuestionBroker } from './services/askUserQuestionBroker.js';
import { AutoAgentRuntime } from './services/autoAgentRuntime.js';
import { BUBBLE_COLORS, READ_TOOLS, shouldAskForTool, applyIngressPermissionGuard, LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE, redactSecrets, CUSTOM_AGENT_MAX_PER_PROJECT, COMMAND_QUEUE_MAX_PER_SESSION, WS_BATCH_INTERVAL, WS_BATCH_INTERVAL_MAX, WS_BATCH_BACKOFF_FACTOR, CHECKPOINT_BATCH_INTERVAL, CHECKPOINT_BATCH_INTERVAL_MAX, CHECKPOINT_QUIET_SWEEP_MS, PROJECT_IDLE_UNLOAD_MS, PROJECT_IDLE_UNLOAD_SWEEP_MS, PROJECT_IDLE_UNLOAD_PRESSURE_MS } from '@vibisual/shared';
import { broadcast } from './broadcastBus.js';
import { graphManager } from './services/projectGraphManager.js';
import { parseConversationSearchTerms, searchSessionConversations } from './services/sessionConversationSearch.js';
import { modelRegistryService } from './services/modelRegistryService.js';
import { userDefaultsService } from './services/userDefaultsService.js';
// §4 앱 테마 — 사용자 테마 폴더(`~/.vibisual/themes`) 목록과 창 색. 고른 id 는 위 user-defaults 가 든다.
import { appThemeService } from './services/appThemeService.js';
import { resolveAgentMemoryDirOverride } from './services/agentMemoryService.js';
import {
  mountPluginRoutes, buildPluginPromptSection, buildPluginPromptSectionParts, getPluginFactsForProjects,
  // §5.11 정독 게이트 — 판정·게이트 창구(판정 자체는 플러그인 순수 함수 하나가 한다).
  getSpecReadingStates, specStopGate, specWriteGate, verifySpecCitationsFrom,
} from './services/pluginHost.js';
import { normalizeSpecSettings, buildSpecSystemRules, SPEC_DRIVEN_ID } from '@vibisual/plugins';
// §5.5 #17-44 ⑧ — 켬/끔 3층. 층 하나만 갈아 끼우는 순수 함수와 층 목록은 shared 가 소유한다.
import { SPEC_SCOPE_ORDER, withSpecReadingScope } from '@vibisual/shared';
// §5.10 자동 목표 — 3층 켬/끔 + 되풀이 절차를 스킬로 굳히는 창구.
import {
  AUTO_GOAL_SCOPE_ORDER,
  normalizeAutoGoalSettings,
  withAutoGoalDismissed,
  withAutoGoalScope,
  type AutoGoalScope,
} from '@vibisual/shared';
import {
  deleteAutoGoalSkill,
  getAutoGoalState,
  listAutoGoalSkills,
  readAutoGoalSkillBody,
  buildAutoGoalPromptBlock,
} from './services/autoGoalService.js';
import { buildAutoGoalAgentProtocol } from './services/autoGoalAgentProtocol.js';
import { mountAutoGoalLifecycleRoutes } from './services/autoGoalLifecycleRoutes.js';
import { buildAutoGoalHookContext } from './services/autoGoalHookContext.js';
// §5.3 #10-4 오케스트라(지휘 모드) — 켬/끔 2층 · 세부 설정 · 지휘 규칙은 shared, 판정은 orchestraRuntime.
import {
  ORCHESTRA_SCOPE_ORDER,
  applyOrchestraSettingsPatch,
  buildOrchestraConductorRules,
  clipOrchestraRequest,
  normalizeOrchestraSettings,
  orchestraEnginePreparation,
  orchestraMemberBirthConfig,
  orchestraPreparationForRequest,
  orchestraReadyEngines,
  resolveOrchestraEnabled,
  validateOrchestraPlan,
  withOrchestraScope,
  type BubbleData,
  type OrchestraEdgeRef,
  type OrchestraMemberRef,
  type OrchestraCliEngine,
  type OrchestraRun,
  type OrchestraScope,
  CONFIG_TRIM_SCOPE_ORDER,
  applyConfigTrimSettingsPatch,
  computeConfigTrim,
  configTrimContextOf,
  normalizeConfigTrimSettings,
  resolveConfigTrimEnabled,
  withConfigTrimScope,
  type ConfigTrimRun,
  type ConfigTrimScope,
} from '@vibisual/shared';
import {
  addOrchestraMember,
  addOrchestraRunTokens,
  applyOrchestraPlan,
  buildConductorTurnConfig,
  checkOrchestraKickoff,
  checkOrchestraMemberCreate,
  checkOrchestraPlanGraph,
  collectOrchestraMemberIds,
  orchestraEngineOf,
  orchestraMemberProviderAllowed,
  orchestraRunIdForCommand,
  settleConductorTurn,
  shouldInterceptOrchestra,
  type OrchestraCheck,
} from './services/orchestraRuntime.js';
import { ensureOrchestraEntryEdge, ensureOrchestraMemberReturns, orchestraCritiqueFirings, orchestraRunForDispatch } from './services/orchestraDispatch.js';
import { OrchestraResultCollector } from './services/orchestraResultCollector.js';
import type { SpecReadingScope, SpecReadingSettings } from '@vibisual/shared';
import { specReadingService } from './services/specReadingService.js';
import { patchSpecReadingPreferences } from './services/specReadingSettingsPatch.js';

/** §5.11 정독 게이트 — "이 파일을 건드렸다"로 세는 도구들(경로 축 라우팅의 재료). */
const SPEC_TOUCH_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// §5.5 #17-28 — 컨텍스트 주입원: 계측(인벤토리) + 최종 게이트 + spawn 스위치.
import type { ContextInventory, ContextScopeLevel } from '@vibisual/shared';
import {
  buildContextInventory,
  isContextSourceOn,
  buildSpawnContextSwitches,
  collectInventoryFilePaths,
  readContextSourceFile,
  CONTEXT_UNREADABLE_SOURCE_IDS,
  type MeasuredPart,
} from './services/contextInventory.js';
import { ensureCardRulesDoc } from './services/cardRulesDoc.js';
// §5.11 훅 세션 집행 판정 — 라우트 클로저 밖에 둬야 테스트가 그 행동을 잡는다.
import { buildHookEnforcementBlock as buildHookBlock } from './services/hookEnforcement.js';
import {
  recordInstructionsLoaded,
  getInstructionsLoaded,
  summarizeInstructionsLoaded,
} from './services/instructionsLoadedService.js';
// §5.26 (B) — 팀원 이름 추출(판본마다 자리가 달라 넓게 받는다).
import { extractTeammateNames } from './services/insuranceLedger.js';
// §5.26 (E) — 복원 브리핑 문구 조립(요약이 안 실은 것만 · 한 턴 한정).
import { buildRecoveryBlock, hasNotCarried } from './services/compactDiff.js';
import {
  recordSubagentStatusLine,
  getSubagentStatusLine,
  listSubagentStatusLines,
} from './services/subagentStatusLineService.js';
import { mountAppBodyParsers, mountAppRoutes } from './services/appHost.js';
import { mountHookIngressBodyParser } from './services/hookIngressBody.js';
import { sessionMemoBodyParser } from './services/sessionMemoBodyParser.js';
import { distillFeedbackToRules } from './services/feedbackDistillService.js';
import { isPortAlive, killByPort, respawn, setVibisualOwnPorts } from './services/processChecker.js';
// §5.14 — 플레이 버블(이 프로젝트를 켜는 버튼).
import type { PlayBubble, PlayRecipe, SpecDoc } from '@vibisual/shared';
import type { ReviewFileChange, ReviewFileChangeType } from '@vibisual/shared';
import { SPEC_BUBBLE_DEFAULT_HEIGHT, SPEC_BUBBLE_DEFAULT_WIDTH, SPEC_ITEM_TEXT_MAX, SPEC_RULES_BEGIN, SPEC_RULES_END, SPEC_TASK_GAP_Y, SPEC_TASK_LABEL_MAX, SPEC_TASK_OFFSET_X, buildSpecTaskRules } from '@vibisual/shared';
import { LAB_BUBBLE_DEFAULT_HEIGHT, LAB_BUBBLE_DEFAULT_WIDTH, LAB_CARD_GAP_Y, LAB_CARD_OFFSET_X, LAB_RULES_BEGIN, LAB_RULES_END, LAB_VARIANT_LABEL_MAX, LAB_WORKTREE_PREFIX, WORKTREE_REAP_SETTLE_MS, buildLabVariantRules, estimateLabCostUsd, getModelPricing, DEFAULT_AGENT_CONFIG, SHELF_BUBBLE_DEFAULT_WIDTH, SHELF_BUBBLE_DEFAULT_HEIGHT, SHELF_CARD_OFFSET_X, SHELF_LABEL_MAX, SHELF_RUN_OUTPUT_MAX_CHARS, SHELF_RUN_TIMEOUT_MS, normalizeShelfIcon, normalizeShelfColor, normalizeShelfImport } from '@vibisual/shared';
import type { LabResultStatus, LabVariant, LabVariantConfig } from '@vibisual/shared';
import { PLAY_ALIVE_SWEEP_MS, PLAY_BUBBLE_DEFAULT_HEIGHT, PLAY_BUBBLE_DEFAULT_WIDTH, PLAY_PREVIEW_DEFAULT_HEIGHT, PLAY_PREVIEW_DEFAULT_WIDTH, PLAY_PREVIEW_GAP, buildPlayRecipeAskPrompt } from '@vibisual/shared';
import { detectPlayRecipes } from './services/playRecipeDetector.js';
import { isPlayAlive, startPlay, stopAllPlays, stopPlay } from './services/playRunner.js';
import { discoverProjectMetas, hasProjectSaveData, migrateLegacy, migrateLegacySaveRootToProjectDirs, pruneOrphanWorktreeDirs, SaveScheduler, writeCheckpoint } from './services/statePersistence.js';
import {
  invalidateWorktreeLiveness,
  beginWorktreeCreation,
  endWorktreeCreation,
  isWorktreeUnderConstruction,
} from './services/worktreeLiveness.js';
import { listWorkspaceDir, resolveWorkspacePath, statExternalPath, statWorkspacePath } from './services/workspaceExplorer.js';
import { resolveWorkspaceFileRead, resolveWorkspaceMediaRead, setWorkspaceMediaReadGuards, type WorkspaceMediaReadGuards } from './services/workspaceMediaRead.js';
// §5.5 #17-27 ⑱ — 판 쪽에서 그 갈래의 파일을 찾는다(빈 탭의 파일 고르기).
import { findWorkspaceFiles } from './services/workspaceFind.js';
import { WORKSPACE_FIND_PATH, isEditorPaneFileKind, parseClaimedExtensions } from '@vibisual/shared';
import { readWorkspaceFile, readWorkspaceImage, writeWorkspaceFile, writeWorkspaceImage } from './services/workspaceFile.js';
// §5.5 #17-19 ⑦⑧ — 탐색기가 내는 쓰기 넷(만들기·이름 바꾸기·삭제·옮기기). 가드는 조회 쪽과 같은 것 하나.
import {
  createWorkspaceEntry,
  deleteWorkspaceEntry,
  isWorkspaceTrashAvailable,
  moveWorkspaceEntry,
  renameWorkspaceEntry,
  type WorkspaceMutateError,
} from './services/workspaceMutate.js';
import type {
  WorkspaceEntryCreateRequest,
  WorkspaceEntryDeleteRequest,
  WorkspaceEntryMoveRequest,
  WorkspaceEntryRenameRequest,
} from '@vibisual/shared';
// §5.5 #17-33 ⑦ / #17-2·#17-4 — 플러그인 갱신 + "이 스킬이 실제로 실리는가" 판정.
import type { AvailableSkill, ClaudePluginInventory, ClaudePluginPlacement } from '@vibisual/shared';
import { normalizePluginRefreshSettings, placementAppliesHere } from '@vibisual/shared';
// §5.5 #17-20 — 디버그·실행 런처(실행 구성 스캔 + 외부 디버거 위임).
import { scanRunConfigs } from './services/runConfigScanner.js';
import { listExternalDebuggers, launchExternalDebugger } from './services/externalDebuggerService.js';
import { scanMcpInventory, setMcpServerEnabled } from './services/mcpInventoryService.js';
import { scanHookInventory, setHookEnabled } from './services/hookInventoryService.js';
import { noteHookFired } from './services/hookFireBroadcaster.js';
import {
  scanClaudePlugins,
  setClaudePluginEnabled,
  installClaudePlugin,
  uninstallClaudePlugin,
  addClaudeMarketplace,
  removeClaudeMarketplace,
  updateClaudeMarketplaces,
  updateClaudePlugin,
  type PluginMutationResult,
} from './services/claudePluginService.js';
// §5.5 #17-33 ⑦ — 손으로 하던 갱신을 앱이 대신하는 자리(마켓 클론 + 뒤처진 설치본).
import {
  runClaudePluginRefresh,
  startClaudePluginAutoRefresh,
  onClaudePluginRefreshed,
  isClaudePluginRefreshRunning,
} from './services/claudePluginRefresh.js';
import { attachDebuggerToEditor } from './services/unrealProjectService.js';
// §5.5 #17-20 ⑩ — 공통 디버그 층(런타임 무관 중단점·스텝·변수)
import { debugSessionManager, findFreePort, type DebugControlAction } from './services/debug/debugSessionManager.js';
import { listDebugAdapters, findPidByCommandLine, commandFingerprint } from './services/debug/adapterProbe.js';
import { releaseWaitingNodeProcess } from './services/debug/cdpClient.js';
import { loadAppState, publicAppState, saveAppState, patchAppState, appStateAddOpenProject, appStateRemoveOpenProject, appStatePruneStaleProjectNames, appStateGetSkillOrder, appStateSetSkillOrder, appStateRemoveSkillFromOrder, appStateGetSkillFavorites, appStateSetSkillFavorites, appStateGetRetention, appStateSetRetention, appStateGetTokenSaver, appStateSetTokenSaver, appStateGetBgTaskProbe, appStateSetBgTaskProbe, appStateGetSessionProbe, appStateSetSessionProbe, appStateGetProcessGuard, appStateSetProcessGuard, appStateGetExternalTopBudget, appStateSetExternalTopBudget, appStateGetWebGroup, appStateSetWebGroup, appStateGetWebOpenTarget, appStateSetWebOpenTarget, appStateGetKeymap, appStateSetKeymap, appStateResetKeymap, appStateGetIDEActivityBar, appStateSetIDEActivityBar, appStateResetIDEActivityBar, appStateGetClaudePluginRefresh, appStateSetClaudePluginRefresh, appStateGetClosedTabs, appStatePushClosedTab, appStateTakeClosedTab, appStateClearClosedTabs, appStatePruneMissingClosedTabs, appStateReorderOpenProjects } from './services/appState.js';
import { ensureHooksInstalledEverywhere, installHooksIntoNewCoworkHomes } from './services/hookInstaller.js';
// §3.6 (판올림 번호 발급 대기) — 훅 이벤트 생명주기 분류(순수 모듈 + 단위 테스트).
//   라우트 안에 부등호로 흩어져 있으면 새 이벤트를 등록할 때마다 조용히 틀린다.
import {
  isTurnEndEventName,
  isSessionEndEvent,
  marksActivity,
  raisesAwaitingInput,
  clearsAwaitingInput,
  endsCompaction,
  needsSnapshotRefresh,
  isTaskLedgerEvent,
} from './services/hookEventClass.js';
import { readUsageCollectorStatus } from './services/statusLineInstaller.js';
import { keepVibisualHooksInPlace, setCodexHooksEnabled, setUsageCollectorEnabled } from './services/hookLifetime.js';
import { buildClaudeUsage } from './services/claudeUsageService.js';
import { probeClaudeUsage, readCachedUsageSnapshot } from './services/claudeUsageProbe.js';
import { apiCreditService } from './services/apiCreditService.js';
import { API_CREDIT_CONTINUE_PROMPT, API_CREDIT_CONSOLE_MIN_INTERVAL_MS, API_CREDIT_CONSOLE_REFRESH_MS } from '@vibisual/shared';
import type { UsageProbeFailure, UsageProbeSnapshot } from './services/claudeUsageProbe.js';
import { getMemoryDiagnostics, startMemoryMonitor, pressureLevelOf, sampleMemory } from './services/memoryMonitor.js';
import { claudeAuthService } from './services/claudeAuthService.js';
import { claudeSetupService } from './services/claudeSetupService.js';
import { codexAuthService } from './services/codexAuthService.js';
import { codexSetupService, getCodexInstallsInfo } from './services/codexSetupService.js';
import { invalidateCodexBinCache } from './services/codexCli.js';
import { managedEngineService } from './services/managedEngineService.js';
import { codexModelService } from './services/codexModelService.js';
import { codexInventoryService } from './services/codexInventoryService.js';
import { SkillSharingService } from './services/skillSharingService.js';
import { mountSkillSharingRoutes } from './services/skillSharingRoutes.js';
import { buildCodexContextArgs, readCodexDeveloperInstructions } from './services/codexContextSources.js';
import { readCodexEffectiveConfigFor } from './services/codexConfigService.js';
import { codexReviewService } from './services/codexReviewService.js';
import { isCodexImageFile } from './services/codexStreamMap.js';
import type { CodexReviewMode } from '@vibisual/shared';
import { getCodexHookState } from './services/codexHookInstaller.js';
import { invalidateClaudeBinCache, setClaudeBinOverrideWriter } from './services/claudeBin.js';
import { isAgentViewEnabled, reconcileOnBoot as agentViewReconcileOnBoot } from './services/claudeAgentViewService.js';
import type { AgentProvider } from '@vibisual/shared';
import { getEngineState, getInflightEngineInstall, installEngine, uninstallEngine } from './services/localEngineService.js';
// §5.5 #17-38 ⑫ — 오프라인 받아쓰기(설치·엔진 수명). 오디오 표본은 여기를 지나가지 않는다.
import {
  cancelVoiceInstall,
  getVoiceAsrState,
  installVoiceAsr,
  removeVoiceAsr,
} from './services/voiceAsrService.js';
import {
  ensureVoiceEngine,
  holdVoiceEngine,
  releaseVoiceEngine,
  stopVoiceEngine,
} from './services/voiceRecognizerService.js';
import { getLocalHardware, invalidateLocalHardware } from './services/localHardwareService.js';
import { toLocalHookPayload } from './services/localHookPayload.js';
import { prepareLocalModelSelection } from './services/localModelConfig.js';
import { cancelDownload, deleteModel, downloadModel, listDownloads, listModels, listRepoFiles, searchCatalog, setModelDownloadedHook } from './services/localModelService.js';
import { listLoadedModels, verifyModelOutput } from './services/localRunner.js';
import { getLocalSampling } from './services/localSamplingService.js';
import { getClaudeVersionInfo, getClaudeInstallsInfo, installLatestClaude, getInflightInstall, invalidateLatestCache, autoUpdateClaudeIfEnabled, onClaudeInstallSettled } from './services/claudeVersionService.js';
import { agentTracker, setSnapshotScheduler as setAgentTrackerSnapshotScheduler } from './services/agentTracker.js';
import { discoverSessions, findPidBySession, isProcessAlive, readContextInfo, readSessionTokenData, setLivenessProbeListener } from './services/sessionDiscovery.js';
import { SessionLifecycleManager } from './services/sessionLifecycle.js';
import { subAgentManager, recordCmdTermSession, buildVerificationGateEnv } from './services/subAgentManager.js';
// §4 엔진 다리 — 우리가 띄운 세션에 실린 Claude Code 모드의 신고(턴·생존·사용량).
import { engineBridge } from './services/engineBridge.js';
import { parseEngineBridgeReport, rateLimitsFromEngine, ENGINE_BRIDGE_HEARTBEAT_MS } from '@vibisual/shared';
// §5.3 #10-2 (위임 결과 복구) — dispatch 결과를 대기 소켓과 따로 쥐는 장부 · 대기 허브 · 소유권 판정.
import {
  createDispatchJobRegistry,
  createDispatchWaiterHub,
  dispatchOutcomeFromCommand,
  dispatchRequestFingerprint,
  isDispatchJobSucceeded,
  isDispatchRequestKeyConflict,
  isTerminalDispatchJobStatus,
  parseDispatchRequestKey,
  dispatchStatusGrantInstructions,
  parseDispatchStatusGrants,
  parseDispatchStatusWaitMs,
  parseDispatchWait,
  resolveDispatchRequester,
  toDispatchJobView,
  undeliveredDispatchResultInstructions,
  waitForDispatchStatus,
  type DispatchJob,
  type DispatchJobOutcome,
} from './services/taskEdgeDispatchJobs.js';
// §5.5 #17-17 ⑪(l) — 에이전트가 답 안에 끼워 넣은 무대 블록을 스트림에서 수확한다(새 창구 ❌).
import { StageBlockIngest } from './services/stageBlockIngest.js';
// §5.5 #17-9 ⑦ — 자식 도구 한 줄 요약 · Task 결과 본문 추출(판본 흔들림을 흡수하는 순수 함수).
import { describeToolTarget, extractTaskResultText } from './services/subagentActivity.js';
import { reapOrphanedPidsFromPreviousRun, registerSpawnedPid, terminateChildTree, unregisterSpawnedPid } from './services/processTree.js';
import { validatePathWithinRoot } from './services/pathValidator.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다(`shared/pathCase.ts`).
import { CASE_INSENSITIVE_FS, HOST_PLATFORM, pathKey, samePath } from './services/pathKey.js';
import { findReferencedCommandAttachment } from './services/commandAttachmentOwnership.js';
import { openFile, openFileAtSearch, openFolder, openWithDefaultApp } from './services/editorLauncher.js';
import { isMicSettingsOpenable, openMicSettings, micSettingsHintKey } from './services/micSettingsOpener.js';
// §5.13 (R-8) — 못 읽는 영상·소리를 우리 안에서 열기 위한 변환 레일.
import { detectMediaTools, installMediaTools } from './services/mediaTools.js';
import { mediaConvertService } from './services/mediaConvert.js';
import { iframeProxyHandler } from './services/iframeProxy.js';
import { gitStatusService, type WorktreeResolveInfo } from './services/gitStatusService.js';
import { generateContiFrames, generateContiFramesFromScript, patchContiElement, createEmptyConti, contiId, parseContiResponse, type ContiContextInput } from './services/contiManager.js';
import { logger } from './logger.js';
import { hasForeignSubAgent, subAgentOwnerGuard, subAgentBodyOwnerGuard } from './services/subAgentOwnerGuard.js';
import { discardSessionQueuedCommands } from './services/sessionCommandDiscard.js';
import { enableAsyncDiskWrites, flushPendingDiskWritesSync } from './services/diskWriteQueue.js';
import { CheckpointCoalescer, setActiveCheckpointCoalescer } from './services/checkpointCoalescer.js';
import { diagnosticService, recordDiagnostic } from './services/diagnosticService.js';
import { createSnapshotBroadcastScheduler } from './services/snapshotBroadcastScheduler.js';
import { deferStartupJob } from './services/startupJobs.js';
import { reportBootProgress } from './services/bootProgress.js';

// §3.7 — desktop in-process 진입점이 server 코어를 라이브러리로 쓰기 위한 re-export.
// `@vibisual/server` 단일 import 지점에서 코어 API를 모두 가져갈 수 있게 한다.
export { setBroadcastSink, broadcast, type BroadcastSink } from './broadcastBus.js';
// §3.7 · §9 「창이 뜬 직후의 메인 스레드」 ② — 본체 창이 처음 보이면 desktop main 이 부른다. 그때부터
// 부팅 한 번짜리 확인(설치·로그인·사용량·코덱스·훅 전송)이 원래 순서대로 한 칸씩 돈다.
export { releaseStartupJobs } from './services/startupJobs.js';
// §3.7 · §9 「시작 화면(스플래시)」 — 스플래시가 떠 있으면 desktop main 이 줄을 먼저 풀고(`'splash'`), 남은 수가
// 0 이 된 뒤에 본체 창을 보인다. 부팅 진척은 스플래시 문구용이다(표시 전용).
export { pendingStartupJobCount, type StartupJobRelease } from './services/startupJobs.js';
export { setBootProgressSink } from './services/bootProgress.js';
// §9 — 체크포인트 디스크 쓰기 워커. desktop main 의 before-quit 가 남은 쓰기를 마무리하고 워커를 내린다.
export { shutdownDiskWriteQueue, flushPendingDiskWritesSync, getDiskWriteQueueStats } from './services/diskWriteQueue.js';
// §9 — 코얼레스된 체크포인트 창. desktop main 의 before-quit 가 디스크 큐를 내리기 **직전에**
// 이걸 불러 미저장분을 동기로 마무리한다(§3.2.1 내구성 — `app.exit(0)` 은 'exit' 를 안 돌린다).
export { flushPendingCheckpointSave, hasPendingCheckpointSave } from './services/checkpointCoalescer.js';
export { flushAll as flushPendingStreamWrites } from './services/streamBufferStore.js';
export {
  handleClientMessage,
  handleClientDisconnect,
  buildConnectionMessages,
  shutdownIframeLogStreamer,
  shutdownServerLogService,
  type ClientConnection,
} from './websocket.js';
// desktop in-process 모드는 hook 전용 loopback 리스너 포트로 직접 훅을 설치한다.
export { ensureClaudeHooksInstalled, ensureHooksInstalledEverywhere } from './services/hookInstaller.js';
export type { HookInstallAllResult } from './services/hookInstaller.js';
// §4 — 사용량 수집기(statusLine). desktop main 이 부팅 시 이미 설치된 경우에만 포트·토큰을 갱신한다.
export { refreshStatusLineIfInstalled } from './services/statusLineInstaller.js';
// §3.6 「수명」 · §5.7 #24-3 — 훅은 앱이 켜져 있는 동안만 둔다. desktop main 이 켤 때(상태 줄 켬 동기화)·
//   끌 때(정상 종료·OS 종료)·제거기 정리 모드에서 부른다.
export { retireVibisualHooks, removeVibisualHooksForUninstall, syncUsageCollectorAtBoot, syncCodexHooksAtBoot } from './services/hookLifetime.js';
export type { HookRetireSummary } from './services/hookLifetime.js';
// §4 — 진단 에러 로그: desktop main 이 자기 프로세스 에러를 recordDiagnostic 으로 적재.
export { recordDiagnostic, diagnosticService } from './services/diagnosticService.js';
// Persistent SubAgent child — desktop main 의 before-quit 핸들러가
// `subAgentManager.shutdownAllPersistentChildren()` 으로 long-lived claude 자식들을 깨끗이 종료.
// §4 API 크레딧 — 데스크톱 main 이 키를 OS 보안 저장소(safeStorage)로 감싸는 손을 꽂는다.
export { setApiCreditCipher, type ApiCreditCipher } from './services/apiCreditService.js';
export { subAgentManager, buildInteractiveClaudeArgs, buildInteractiveCliPrefill, parseCmdTermId, buildBashTimeoutEnv, buildAgentTokenSaverEnv, buildVerificationGateEnv, prepareInteractiveRulesDir, recordCmdTermSession, getCmdResumeSession } from './services/subAgentManager.js';
// §5.11 — CMD 세션에도 집행 플러그인의 지시를 싣는다(desktop 터미널 매니저가 rules 파일에 함께 기록).
export { buildInteractivePluginBlockForAgent } from './services/pluginHost.js';
// § 프로세스 트리 누수 — desktop 의 PTY(cmd.exe→claude) 종료 시 Windows 트리 전체를 회수하는 데 재사용.
export { killTree } from './services/processTree.js';
// §5.3 #9-2 — desktop 이 koffi 로 지은 Windows 묶음 바인딩을 넣고(`runServer()` 앞), CMD 터미널 PTY 를 같은 감시에 등록한다.
export {
  processGuard,
  setProcessContainmentBackend,
  type ContainmentBackend,
  type ContainmentHandle,
  type ContainmentLimits,
  type ContainmentEvent,
  type ProcessGuardOwner,
} from './services/processGuard.js';
/** desktop main 이 직접 띄우는 네이티브 대화상자·OS 알림의 언어. main 에서는 i18next 를 못 쓰므로 언어만 읽어 `main/strings.ts` 표에서 문구를 고른다. */
export function getUiLocale(): UiLocale {
  return graphManager.getUiLocale();
}
/**
 * §4 앱 테마 — desktop main 이 칠하는 창 바탕·제목줄 버튼 색. `getUiLocale()` 과 같은 얇은 주입이다
 * (desktop main 은 설정 저장소도 테마 폴더도 직접 알지 못한다). 화면과 같은 해석을 거친 값이다.
 */
export { currentAppThemeChrome as getAppThemeChrome, subscribeAppThemeChrome } from './services/appThemeService.js';
/**
 * §4 메신저 브리지 — 폰에서 고를 수 있는 명령 대상 전량(프로젝트 → 에이전트 → 세션).
 * 팬아웃 스냅샷을 쓰지 마라 — §9 스코프드라 창이 선언하지 않은 프로젝트의 `agents`·`subAgents` 가 빠져, 열린 탭에 따라 폰 목록에서 에이전트가 사라진다(§9 ④ 전역 집계는 항상 전량).
 * 그래서 이 조회만 `getSnapshot()`(범위 미적용·서버 내부용)에서 만든다. desktop main 은 `graphManager` 를 직접 알지 못한다.
 */
export function listChatCommandTargets(): ChatCommandTarget[] {
  const snap = graphManager.getSnapshot();
  const out: ChatCommandTarget[] = [];
  for (const agent of snap.agents) {
    // §5.5 #17-29 — 훅 버블은 읽기 전용이라 목록에도 올리지 않는다(골라도 서버가 403 이다).
    if (agent.customCreated !== true || typeof agent.path !== 'string' || !agent.path) continue;
    const sessions: ChatCommandSession[] = subAgentManager.getAllSubs(agent.id).map((sub) => ({
      id: sub.id,
      label: sub.label,
      status: sub.status,
      ...(sub.lastCommand ? { lastCommand: sub.lastCommand } : {}),
      ...(sub.dormant ? { dormant: true } : {}),
      ...(sub.blocked ? { blocked: true } : {}),
    }));
    out.push({
      agentId: agent.id,
      label: agent.label,
      sessionId: agent.path,
      project: snap.agentProjects[agent.id] ?? '',
      queued: (snap.commandQueues[agent.id] ?? []).length,
      sessions,
    });
  }
  return out;
}
/**
 * §5.5 #17-20 ⑩ — 앱이 접힐 때 붙어 있던 디버그 세션을 정리한다.
 * 남겨 두면 어댑터 자식 프로세스와 소켓이 그대로 살아 다음 실행에서 포트를 물고 있다.
 */
export { debugSessionManager } from './services/debug/debugSessionManager.js';
// Desktop's pre-start consent record needs the same durable write before the server is running.
export { atomicWriteFileSync } from './services/statePersistence.js';
// §3.5 — 버블 생명주기 진단 로그 위치. 프로젝트 데이터가 아니라 앱 진단이므로 desktop main 이
// 부팅 시 userData/logs 로 고정한다(미주입 시 cwd 상대 폴백 — 서버 단독 실행 호환).
export { setDebugLogDir } from './services/debugLog.js';

// §5.5 #17-19 ⑦ — 탐색기 삭제가 쓸 **OS 휴지통** 통로. 세 OS 의 휴지통 규약이 전부 다르므로
// 이미 옳게 다루는 Electron `shell.trashItem` 을 desktop main 이 부팅 때 꽂는다(주입 없으면 영구 삭제).
export { setWorkspaceTrash, isWorkspaceTrashAvailable, type WorkspaceTrashItem } from './services/workspaceMutate.js';

// §5.5 #17-38 ⑮ — OS 마이크 설정 창을 여는 통로. 여는 대상이 파일이 아니라 `ms-settings:` 같은
// 설정 URI 라 경로 가드를 쓰는 `/api/open-external` 로는 갈 수 없다(임의 URI 문을 열게 된다).
// 휴지통과 같은 규율으로 desktop main 이 `shell.openExternal` 을 부팅 때 꽂는다.
export { setMicSettingsOpener } from './services/micSettingsOpener.js';

// §5.13 (T-11) ① — 내부 앱의 서버 몫이 같은 앱의 main 몫을 부르는 통로. desktop main 이 부팅 때 한 번 꽂는다
//   (앱 이름을 모르는 함수 하나 — 어느 앱인지는 앱 호스트가 묶는다).
export { setAppMainInvoker, resolveAppMediaFile, type AppMainInvoker } from './services/appHost.js';
// §5.13 40-1 — 코어 미디어 창구의 읽기를 데스크톱 main 의 vibproxy 미디어 갈래가 흘려 보낼 때 낼 파일(라우트와 같은 판정).
export { resolveWorkspaceMediaStreamFile } from './services/workspaceMediaRead.js';

// §5.14 — 앱 종료 시 플레이 버블이 띄운 서버·정적 호스트 정리(main 이 before-quit 에서 호출).
export { stopAllPlays } from './services/playRunner.js';
// §5.19 — 앱 종료 시 로컬 엔진 자식(llama-server) 정리. 안 내리면 모델이 메모리를 물고 남는다.
export { unloadAllLocalModels } from './services/localRunner.js';
export { closeStaticHost } from './services/playStaticHost.js';
// §4 — desktop 임베디드 터미널이 인터랙티브 claude 를 띄울 때 버전 체크·헤드리스 스폰과 같은 바이너리를 쓰도록 resolver 를 노출.
export { resolveClaudeBin, getClaudeBin, invalidateClaudeBinCache, claudeManagedEnvFor, claudeSpawnEnv } from './services/claudeBin.js';
// §4 (앱 전용 엔진) — CMD 터미널이 앱 전용 코덱스 경로를 셸에 넣고, 앱 전용 claude 에 갱신 끄기를 얹을 때 쓴다.
export { findManagedBin, isManagedEngineBin } from './services/managedEngineLayout.js';
// §4 (앱 전용 엔진) ④ — CMD 코덱스가 사용자가 Version 탭에서 보조로 고른 실행본을 먼저 띄울 때 쓴다.
export { codexBinOverride } from './services/codexCli.js';
export { knownBinDirs } from './services/binLocator.js';

// §4 (CMD 터미널 업그레이드 ⑥) — 임베디드 PTY 제어 주입 지점. desktop main 이 terminalManager 를
// 이 인터페이스로 감싸 넣으면 loopback REST(`/api/cmd/*`)가 터미널을 읽고 prefill 할 수 있다.
export { setCmdTerminalController, getCmdTerminalController, readCmdTerminal, sendCmdTerminal, waitCmdTerminal, stripTerminalAnsi } from './services/cmdTerminalController.js';
export type { CmdTerminalController } from './services/cmdTerminalController.js';

// §3.7 — hook loopback 리스너 포트. 외부 `claude` 프로세스(hook curl·위임 엣지 dispatch)가 in-process 서버에 닿는 유일한 포트다(desktop main 이 startHookListener 직후 주입).
// 위임 엣지 dispatch curl URL 은 반드시 이 포트를 쓴다 — DEFAULT_PORT(4800)에는 listen 소켓이 없다(`buildOutboundEdgesRulesSection`).
let hookListenerPort: number | null = null;
export function setHookListenerPort(port: number): void {
  hookListenerPort = port;
  // §7.11 — 감지 폴백이 **우리 자신**을 "에이전트가 띄운 서버"로 오인하지 않게 알려 둔다.
  //   에이전트는 카드 엔드포인트를 `curl http://127.0.0.1:<이 포트>` 로 수시로 치므로, 걸러 두지
  //   않으면 세션마다 Vibisual 자신의 프리뷰 버블이 생긴다.
  setVibisualOwnPorts([port, DEFAULT_PORT]);
}

// §5.3 #10-2 — loopback 리스너 per-launch 토큰. desktop main 의 hookToken 을 받아 하네스 빌더 rules 의 curl 헤더(x-vibisual-hook-token)에 싣는다(§3.7).
let hookListenerToken: string | null = null;
export function setHookListenerToken(token: string): void {
  hookListenerToken = token;
}

/**
 * §4 — CMD 세션이 `blocked` 로 전이할 때 부를 알림 콜백. Electron `Notification` 은 desktop main 만 띄운다(§3.4 — server 는 desktop 을 import 하지 않는다).
 * 주입이 없으면(웹·테스트) 아무 일도 없다. 스팸 방지(백그라운드·opt-out)는 창 포커스와 설정을 아는 main 쪽에서 한다.
 */
export interface CmdBlockedNotice {
  termId: string;
  agentId: string;
  subAgentId: string;
  /** 세션 탭 라벨(예: `Sub #3`). */
  label: string;
  /** 막혔다고 본 근거 한 줄(마지막 화면 꼬리 발췌). */
  reason?: string;
}

let cmdBlockedNotifier: ((notice: CmdBlockedNotice) => void) | null = null;

export function setCmdBlockedNotifier(fn: ((notice: CmdBlockedNotice) => void) | null): void {
  cmdBlockedNotifier = fn;
}

// §4 — hook 신원 파일(hook-listener.json) 절대 경로(forward-slash). desktop main 이 주입하고, 미주입(서버 단독)이면 상수 폴백.
// 카드 엔드포인트 curl 이 dispatch 시점 상수가 아니라 호출 시점에 이 파일의 포트·토큰을 읽게 한다 — 재기동으로 포트가 바뀐 뒤 resume 된 옛 세션도 카드가 닿는다.
let hookListenerIdentityFile: string | null = null;
export function setHookListenerIdentityFile(filePath: string): void {
  hookListenerIdentityFile = filePath;
}

// §4 — hooks/handler.mjs 절대 경로(desktop main 이 훅 설치와 같은 값을 주입).
// statusLine 수집기는 팝업에서 켤 때 REST 로 설치되므로 그때 `node <handlerPath> --statusline …` 를 조립할 경로가 필요하다.
let hookHandlerPath: string | null = null;
export function setHookHandlerPath(filePath: string): void {
  hookHandlerPath = filePath;
}

/**
 * §4 엔진 다리 — 동봉 모드 폴더(앱 리소스의 `mods/vibisual-bridge`). desktop main 이 주입한다.
 * 훅 설치를 건너뛰는 실행(격리 인스턴스 등)에서도 주입한다 — 모드는 그 인스턴스의 루프백으로만 신고한다.
 */
export function setEngineBridgeSourceDir(dir: string): void {
  engineBridge.setSourceDir(dir);
}

/**
 * §5.25 (I) — 코덱스 훅 설치에 필요한 값(포트·핸들러 경로·토큰). desktop main 이 클로드 훅을
 * 설치하는 그 자리에서 함께 주입한다. **설치는 여기서 자동으로 돌지 않는다** — 코덱스 훅은
 * 기본 꺼짐이고 사용자가 켤 때만 REST 로 깔린다(남의 전역 설정을 말없이 건드리지 않는다).
 */
let codexHookContext: { port: number; handlerPath: string; token: string } | null = null;
export function setCodexHookContext(ctx: { port: number; handlerPath: string; token: string }): void {
  codexHookContext = ctx;
}

export interface RunServerHandle { app: import('express').Express; }

export async function runServer(): Promise<RunServerHandle> {
  // 크래시(before-quit 미발동)로 지난 런의 claude 트리가 고아로 남았으면 부팅 시 회수(§ 프로세스 트리 누수).
  void reapOrphanedPidsFromPreviousRun();

  // §9 "디스크 쓰기는 워커 스레드로" — 실제 구동 경로에서만 켠다(테스트·도구는 동기 그대로).
  enableAsyncDiskWrites();

  // §4 (실행본 자가 복구) — 확장 자동 갱신으로 override 가 낡았을 때 `claudeBin` 이 이어받은 새 경로를
  //   사용자 설정에 되쓰는 창구. `claudeBin` 은 초기화 순서 때문에 서비스를 import 하지 않으므로
  //   여기서 배선한다(미배선이어도 승계 자체는 동작 — 되쓰기만 생략된다).
  setClaudeBinOverrideWriter((nextPath) => {
    void userDefaultsService.update({ claudeBinPath: nextPath }).catch(() => {});
  });

  /** cwd에서 위로 올라가며 pnpm-workspace.yaml 있는 디렉토리 = 프로젝트 루트 */
  function findProjectRoot(start: string): string {
    let dir = path.resolve(start);
    while (true) {
      if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return start; // fallback
      dir = parent;
    }
  }

  /** Type guard — validates that an unknown value matches HookEventPayload shape */
  function isHookEventPayload(data: unknown): data is HookEventPayload {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj['session_id'] === 'string' &&
      typeof obj['hook_event_name'] === 'string'
    );
  }

  /** 도구 사용 이벤트인지 (PreToolUse / PostToolUse) */
  function isToolEvent(payload: HookEventPayload): boolean {
    return typeof payload.tool_name === 'string' &&
      typeof payload.tool_input === 'object' &&
      payload.tool_input !== null;
  }

  /**
   * §4 — Notification 서브타입 분류. `type` 필드(permission_prompt | idle_prompt | auth_success | elicitation_dialog, 2026-04~ 실림)를 우선하고, 구버전 페이로드는 `message` heuristic 으로 폴백한다.
   * awaiting_permission = 도구 권한 요청 · other = 그 밖(시각 상태 변경 없음).
   * idle_prompt·입력 대기는 별도 상태로 올리지 않는다 — `--resume` 으로 늘 이어지는 세션에 모래시계가 끊김으로 보인다.
   */
  function classifyNotification(
    type: string | undefined,
    message: string | undefined,
  ): 'awaiting_permission' | 'other' {
    if (type === 'permission_prompt') return 'awaiting_permission';
    if (type === 'idle_prompt' || type === 'auth_success' || type === 'elicitation_dialog') return 'other';

    if (typeof message === 'string') {
      if (/permission|approve|allow/i.test(message)) return 'awaiting_permission';
    }
    return 'other';
  }

  /**
   * 3-Layer 세션 생명주기 — entrypoint(cli/vscode) 무관. 활성 = claude.exe 가 매칭 PID 로 실행 중 OR 세션 JSONL 이 잠겨 있음.
   * 둘 다 아니면 onDead 로 즉시 제거한다 — VSCode 를 다시 열면 SessionStart 훅으로 재등록되므로 손실 없다.
   */
  // §9 「창이 뜬 직후의 메인 스레드」 ③ — 걷은 세션마다가 아니라 주기 끝에 한 번 저장한다(부팅 직후 죽은 세션 여럿을
  //   걷을 때 그 수만큼 전 프로젝트 재구축·직렬화가 메인 스레드를 막는다).
  let deadRemovedSinceSave = false;
  const lifecycle = new SessionLifecycleManager({
    onDead: (sessionId) => {
      if (graphManager.removeAgentBySession(sessionId)) {
        deadRemovedSinceSave = true;
        broadcastSnapshot();
      }
    },
    onDeadSettled: () => {
      if (!deadRemovedSinceSave) return;
      deadRemovedSinceSave = false;
      saveCheckpoint();
    },
    onVSCodeClosed: (sessionId) => {
      // 현재 정책에서는 호출되지 않지만 콜백 시그니처 호환 유지.
      agentTracker.markForceStop(sessionId);
    },
    onMetaChange: () => {
      broadcastSnapshot();
    },
    listAgentSessionIds: () => graphManager.getSessionIds(),
  });
  graphManager.setLifecycleSnapshotProvider(() => ({
    sessionSources: lifecycle.getSourcesSnapshot(),
    sessionStatuses: lifecycle.getStatusesSnapshot(),
  }));
  graphManager.setGitDirtyProvider(() => gitStatusService.getDirtyMap());
  // §5.11 — 집행 플러그인이 무엇을 보고 판단했는지를 카드가 그릴 수 있게 스냅샷에 실어 보낸다.
  //   열려 있는 프로젝트만 묻고, 켠 집행 모듈이 없으면 undefined 라 필드 자체가 생기지 않는다.
  graphManager.setPluginFactsProvider(() => getPluginFactsForProjects(graphManager.getProjectRoots()));
  // §5.11 정독 게이트 — 세션별 정독 상태도 같은 provider 방식으로 한 곳에서 얹는다(방송 지점 누락 방지).
  graphManager.setSpecReadingProvider(() => getSpecReadingStates());
  graphManager.setOnMutated(() => broadcastSnapshot());
  gitStatusService.setChangeListener(() => broadcastSnapshot());
  // §9 — agentTracker 의 Stop/dismiss 스냅샷 송신도 디바운스 경로로 보낸다.
  setAgentTrackerSnapshotScheduler(() => broadcastSnapshot());

  // §4 — 모델 레지스트리 부팅 시 비동기 refresh(시드는 이미 적재됨). 결과와 무관하게 WS 푸시는 listener 가 한다.
  modelRegistryService.refreshIfStale().catch((err) => {
    logger.warn(`[modelRegistry] refresh error: ${err instanceof Error ? err.message : String(err)}`);
  });
  modelRegistryService.subscribe((reg) => {
    broadcast({ type: 'model_registry_updated', timestamp: Date.now(), payload: reg });
    // 시드 → api-merged 전환 시 snapshot 의 modelRegistry 도 갱신해야 하므로 그래프 한 번 푸시.
    broadcastSnapshot();
  });

  // §4 — 사용자 옵션 갱신 broadcast(다른 창·탭 즉시 반영)
  userDefaultsService.subscribe((d) => {
    broadcast({ type: 'user_defaults_updated', timestamp: Date.now(), payload: d });
  });

  // §4 앱 테마 — 사용자 테마 폴더를 다시 읽어 **내용이 바뀌었을 때만** 다른 창에도 같은 목록을 민다
  //   (한 창에서 [다시 읽기]·[새로 만들기]를 누르면 별창·지휘통제실 창의 테마도 함께 따라간다).
  appThemeService.subscribe((catalog) => {
    broadcast({ type: 'app_themes_updated', timestamp: Date.now(), payload: catalog });
  });

  /** 프로세스 부팅 시각 — Debug 패널 "Restart Server"가 startedAt 증가로 재시작 여부 확인 */
  const SERVER_STARTED_AT = Date.now();

  const app = express();
  // iframe 프록시에서 본문을 재작성하므로 Express 자동 ETag 비활성화
  // (ETag가 남으면 브라우저가 304로 재작성 전 버전을 캐시 재사용할 수 있음)
  app.set('etag', false);
  // In-process IPC-only era: no external origin needs CORS — DNS-rebinding surface removed.
  app.use(cors({ origin: false }));

  // Iframe 프록시 — express.json() 보다 앞에 마운트 (raw body 전달 필요)
  app.use(IFRAME_PROXY_PATH, (req, res) => { void iframeProxyHandler(req, res); });

  // Scene metadata and a viewport capture can exceed the default JSON limit; keep this scoped to Vibi3D.
  app.use('/api/app/vibi3d', express.json({ limit: '8mb' }));
  mountAppBodyParsers(app);
  app.use('/api/session-memos', sessionMemoBodyParser);
  // §3.7 「훅 입구의 본문 상한」 — 훅 본문은 CLI 가 도구 내용을 통째로 싣는다. 전역 파서의 기본 100KB 가 큰 파일을
  //   고친 신고를 413 으로 버렸다(3주 2,100건). 문이 받은 크기를 그대로 받도록 전역 파서보다 **앞에** 건다.
  mountHookIngressBodyParser(app);
  app.use(express.json());
  // Task Edge dispatch raw-text 경로용 — instruction 원문을 손escape 없이 stdin 으로 받기 위함.
  // express.json() 은 application/json 만, express.text() 는 text/* 만 처리 → 상호 간섭 없음.
  // (JSON 본문은 후방호환 유지, 신규 호출은 raw text + ?edgeId= 사용 — heredoc escape 실패 원천 차단)
  app.use(express.text({ type: ['text/*'], limit: '8mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // §4 — 사용자 글로벌 옵션(Options 창 SSOT)
  app.get('/api/codex-usage', async (_req, res) => {
    try { res.json(await readCodexUsage()); } catch { res.status(500).json({ windows: [], fetchedAt: Date.now(), error: 'unavailable' }); }
  });
  app.get('/api/user-defaults', (_req, res) => {
    res.json(userDefaultsService.get());
  });
  app.put('/api/user-defaults', async (req, res) => {
    try {
      // §4 (설정 3층) — 카테고리 안의 `null` 은 "그 칸을 비운다"는 뜻이다(설정 창이 그렇게 보낸다).
      const patch = req.body as import('@vibisual/shared').UserDefaultsPatch;
      if (!patch || typeof patch !== 'object') {
        res.status(400).json({ ok: false, error: 'invalid body' });
        return;
      }
      const next = await userDefaultsService.update(patch);
      // §4 — 실행본 override 가 바뀌면 캐시된 해석 결과를 버린다(해석이 지연 캐시라 즉시 반영된다).
      if ('claudeBinPath' in patch) {
        invalidateClaudeBinCache();
        void claudeSetupService.refresh().catch(() => {});
      }
      // §4 (앱 전용 엔진) ④ — 코덱스 보조 선택도 같은 규칙: 저장 즉시 다음 스폰부터 그 실행본(재시작 불필요).
      if ('codexBinPath' in patch) {
        invalidateCodexBinCache();
        void codexSetupService.refresh().catch(() => {});
      }
      res.json({ ok: true, userDefaults: next });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * §4 앱 테마 — 사용자 테마 폴더. 세 라우트 모두 렌더러 전용이다 — hook 리스너 허용 목록에 넣지 마라(바깥 claude 가 디스크에 쓰거나 탐색기를 띄울 이유가 없다).
   * 고른 테마는 `PUT /api/user-defaults {appearance:{themeId}}` 로 저장한다.
   * GET — 마지막으로 읽은 목록. `?rescan=1` 이면 폴더를 다시 읽는다(바뀌었으면 WS 로도 민다).
   */
  app.get('/api/app-themes', (req, res) => {
    try {
      res.json(req.query['rescan'] === '1' ? appThemeService.rescan() : appThemeService.list());
    } catch (err) {
      logger.error('GET /api/app-themes failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST — [지금 테마로 새로 만들기]. body `{ baseId?, name }` → 견본 파일을 쓰고 새 id 를 돌려준다. */
  app.post('/api/app-themes', (req, res) => {
    try {
      const body = (req.body ?? {}) as { baseId?: unknown; name?: unknown };
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        res.status(400).json({ ok: false, error: 'name required' });
        return;
      }
      const baseId = typeof body.baseId === 'string' && body.baseId ? body.baseId : undefined;
      const created = appThemeService.createFromTheme(baseId, name);
      res.json({ ok: true, ...created, catalog: appThemeService.list() });
    } catch (err) {
      logger.error('POST /api/app-themes failed', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** POST — [폴더 열기]. 없으면 만들고 연다. 여는 실행부는 `openFolder` 하나다(Windows `explorer` · macOS `open` · 그 밖 `xdg-open`). */
  app.post('/api/app-themes/open-folder', (_req, res) => {
    try {
      const dir = appThemeService.ensureDir();
      openFolder(dir);
      res.json({ ok: true, dir });
    } catch (err) {
      logger.error('POST /api/app-themes/open-folder failed', err);
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // §5.11 — 플러그인 기여 라우트(`/api/plugins/*`). 코어가 아는 것은 이 한 줄뿐.
  mountPluginRoutes(app);

  // §5.13 (O) — 내부 앱 라우트. 앱이 늘어도 코어가 아는 것은 이 한 줄뿐이다.
  mountAppRoutes(app);

  app.put('/api/ui-locale', (req, res) => {
    const locale = (req.body as { locale?: string } | undefined)?.locale;
    if (!locale || !SUPPORTED_UI_LOCALES.includes(locale as UiLocale)) {
      res.status(400).json({ error: 'invalid locale', supported: SUPPORTED_UI_LOCALES });
      return;
    }
    const changed = graphManager.setUiLocale(locale as UiLocale);
    if (changed) {
      broadcastSnapshot();
      // §4 — 고른 언어를 그 자리에서 디스크에 앉힌다(다음 저장까지 메모리에만 두면 온보딩 중 앱이 죽을 때 사라진다).
      saveCheckpoint();
    }
    res.json({ ok: true, uiLocale: locale });
  });



  app.post('/api/session-start', (req, res) => {
    try {
      const body = req.body as {
        sessionId?: unknown;
        pid?: unknown;
        cwd?: unknown;
      };
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null;
      const cwd = typeof body.cwd === 'string' ? body.cwd : null;
      const pid = typeof body.pid === 'number' ? body.pid : null;
      if (!sessionId || !cwd) {
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }
      // 우리가 스폰한 sub(커스텀 에이전트 워커 등)의 SessionStart 는 독립 훅 버블로 등록하지 않는다 — 활동은 명령 흐름으로 부모 커스텀 버블에 귀속된다.
      // 이 가드가 없으면 워커 세션이 "Continue from where you left.." 훅 버블로 증식한다. 사용자 인터랙티브 세션은 managed 가 아니라 영향 없다.
      if (subAgentManager.isManagedSession(sessionId)) {
        res.json({ ok: true, managed: true, restored: 0 });
        return;
      }
      lifecycle.registerFromHook({ sessionId, pid, cwd });
      // hook 으로 처음 감지된 프로젝트도 SessionStart 에서 AppState openProjects 에 넣는다(tool 이벤트까지 미루면 그 전에 재시작될 때 사라진다). 등록은 idempotent.
      // §3.5 — 훅 cwd 는 열린 프로젝트의 하위 폴더일 수 있다. 새 프로젝트로 세우지 않게 훅 전용 문으로 연다.
      try { graphManager.registerProjectForHookCwd(cwd); } catch (err) {
        logger.warn(`session-start: registerProject("${cwd}") failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      // §5.7 #24 — VSCode 재오픈 시 같은 cwd 로 잠들어 있던 에이전트를 복원한다.
      const restored = graphManager.restoreDormantForCwd(cwd);
      if (restored.length > 0) {
        logger.info(
          `SessionStart: restored ${restored.length} dormant agent(s) for cwd ${cwd} ` +
          `(sessions: ${restored.map((s) => s.slice(0, 8)).join(',')})`,
        );
        broadcastSnapshot();
        saveCheckpoint();
      }
      res.json({ ok: true, restored: restored.length });
    } catch (err) {
      logger.error('POST /api/session-start failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.11 — 훅 세션에 실을 집행 블록. 판정은 `services/hookEnforcement.ts` 에 둔다(테스트가 닿게) — 여기서는 그래프·호스트를 연결만 한다. */
  function buildHookEnforcementBlock(body: HookEventPayload): string {
    return buildHookBlock(body, {
      agentBySession: (sessionId) => {
        const agent = graphManager.getAgentBySession(sessionId);
        return agent ? { id: agent.id, label: agent.label, customCreated: Boolean(agent.customCreated) } : null;
      },
      projectPathForAgent: (agentId) => graphManager.getProjectPathForAgent(agentId) ?? null,
      agentCwd: (sessionId) => graphManager.getAgentCwd(sessionId) ?? null,
      buildSection: (req) => buildPluginPromptSection(req),
      log: (message, err) => logger.warn(message, err as Error),
    });
  }

  app.post('/api/hook-event', (req, res) => {
    try {
      const body: unknown = req.body;

      if (!isHookEventPayload(body)) {
        logger.warn('Invalid hook event payload received');
        res.status(400).json({ error: 'Invalid HookEventPayload', continue: true });
        return;
      }

      /*
       * §3.6 — HTTP 훅 이벤트의 env 보강. HTTP 훅은 CLI 가 원문 JSON 을 POST 해 본문을 손댈 수 없지만 헤더에 `$VAR` 를 쓸 수 있다 — 헤더 값을 본문 필드로 되돌려 아래 로직이 `handler.mjs` 경로와 똑같이 돌게 한다.
       * 풀리지 않은 env 는 빈 문자열이 되므로 빈 값은 "없음"으로 읽는다 — 그대로 실으면 소유자 조회가 빈 id 로 빗나가 CMD 버블 귀속이 깨진다.
       */
      const headerValue = (name: string): string | undefined => {
        const v = req.headers[name];
        const s = Array.isArray(v) ? v[0] : v;
        return typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
      };
      // §4 — 사용량 probe(`claude -p "/usage"`)가 띄운 세션은 캔버스에 유령 버블을 남기면 안 된다.
      //   command 경로에서는 handler.mjs 가 먼저 빠져나가지만, HTTP 경로에는 그 관문이 없다.
      if (headerValue('x-vibisual-usage-probe') === '1') {
        res.json({ continue: true });
        return;
      }
      if (!body._vibisualOwnerAgentId) {
        const ownerAgentId = headerValue('x-vibisual-owner-agent-id');
        if (ownerAgentId) body._vibisualOwnerAgentId = ownerAgentId;
      }
      if (!body._vibisualOwnerTermId) {
        const ownerTermId = headerValue('x-vibisual-owner-term-id');
        if (ownerTermId) body._vibisualOwnerTermId = ownerTermId;
      }
      // §5.1 #1-1 (D) — 이 이벤트를 낸 우리 sub(env `VIBISUAL_SUBAGENT_ID`). 아래 소유자 태그 재작성이 세션 키를 주인 버블
      //   것으로 바꿔도 앱 작업 귀속이 그 sub 를 잃지 않게 명시로 싣는다. 빈 값은 "없음"(안 잡힌 env 는 빈 문자열이 된다).
      if (!body._vibisualSubAgentId) {
        const subAgentId = headerValue('x-vibisual-subagent-id');
        if (subAgentId) body._vibisualSubAgentId = subAgentId;
      }
      // §4 — CMD(인터랙티브 터미널) 소유자 태그면 상태·그래프 귀속을 그 CMD 버블 세션으로 모은다 — markActive/markStop·Notification·processHookEvent 가 모두 CMD 버블을 가리켜 Hook 에이전트와 같은 라이프사이클을 탄다.
      // lifecycle 만은 OS 세션 liveness 추적이라 claude 원본 session(`claudeSessionId`)을 그대로 쓴다.
      const claudeSessionId = body.session_id;
      if (body._vibisualOwnerAgentId) {
        const ownerSession = graphManager.findSessionByAgentId(body._vibisualOwnerAgentId);
        if (ownerSession) body.session_id = ownerSession;
      }

      // 서브에이전트(Task/Agent)가 끝날 때 오는 Stop(`SubagentStop`, 구버전은 `agent_id`/`parent_tool_use_id` 를 단 Stop)은 부모 세션의 턴 종료가 아니다.
      // 부모 CMD 버블로 귀속된 채 종료로 읽으면 markStop·서브-도트가 부모를 서브 종료 시점에 완료로 튕긴다(감독관 버블 조기 완료).
      const isSubagentStop =
        body.hook_event_name === 'SubagentStop' ||
        typeof body.agent_id === 'string' ||
        typeof body.parent_tool_use_id === 'string';
      // §3.6 — `StopFailure` 는 API 오류로 턴이 끝난 것이라 **종료의 일종**이다.
      //   분기에 안 넣으면 아래 `markActive` 로 떨어져 그 세션이 영영 active 로 남는다.
      const isTurnEndEvent = isTurnEndEventName(body.hook_event_name);
      /*
       * §3.6 — `SessionEnd` 는 턴이 아니라 세션 자체의 끝이다. 분기가 없으면 `markActive` 로 떨어져 끝난 세션이 영영 도는 것처럼 보인다. `/clear`·`/resume` 도 같게 취급(`reason` 은 표시용).
       * `isTurnEndEvent` 에는 넣지 않는다 — 그 변수는 서브에이전트 종료를 가르는 데 쓰이고, 세션 종료는 언제나 부모의 끝이다.
       */
      const isSessionEnd = isSessionEndEvent(body.hook_event_name);
      // 부모(감독관) 세션의 자기 턴이 실제로 끝났는가 — 서브에이전트 종료는 제외.
      const isOwnStop = (isTurnEndEvent && !isSubagentStop) || isSessionEnd;
      // §5.3 #12-1 — 배경 서브에이전트 대차대조. 부모 턴이 끝나도 자식 Task/Agent 가 백단에서 도는 동안 부모 버블이 completed 로 강등되지 않게 pending 을 센다: PreToolUse(Task|Agent) ↑ / SubagentStop ↓ / 그 외는 quiet-window 신호.
      // managed·CMD 소유 세션만 해석된다. 세션 탭(sub) 도트도 이 대차대조를 따르도록 그 세션의 sub 를 함께 넘긴다.
      // §5.5 #17-9 ③(c) — CMD 세션은 JSONL 파이프가 없어 `sub.sessionId` 가 비어 있다 — 훅의 termId(끝 토큰 = sub.id)로 폴백한다(없으면 그 탭의 서브에이전트가 소유 미상으로 걸러진다).
      const bgOwnerSub = subAgentManager.findSubBySessionId(claudeSessionId)
        ?? (body._vibisualOwnerTermId ? subAgentManager.findSubByTermId(body._vibisualOwnerTermId) : undefined);
      const bgOwnerAgentId = body._vibisualOwnerAgentId ?? bgOwnerSub?.parentAgentId;
      // §5.1 #1-1 (D) — 훅이 sub 를 못 실어 왔으면(옛 훅 블록 · 헤더 env 를 막는 정책) 여기서 찾은 sub 로 채운다.
      if (!body._vibisualSubAgentId && bgOwnerSub) body._vibisualSubAgentId = bgOwnerSub.id;

      // §5.5 #17-32 ⑤ — 이 이벤트가 왔다면 같은 이벤트에 걸린 다른 훅들도 그 순간 돌았다. 불 켤 줄은 화면이 `hookMatcherMatches` 로 고르므로 이벤트·도구 이름만 흘린다.
      // 짧은 창으로 모아 자체 메시지로만 보낸다 — graph_snapshot·체크포인트는 건드리지 마라(§9 폭주 경로 위다).
      noteHookFired(
        bgOwnerAgentId ?? graphManager.getAgentBySession(body.session_id)?.id,
        bgOwnerSub?.id,
        body.hook_event_name,
        typeof body.tool_name === 'string' ? body.tool_name : undefined,
      );

      if (bgOwnerAgentId) {
        const isSubagentSpawn = body.hook_event_name === 'PreToolUse'
          && (body.tool_name === 'Task' || body.tool_name === 'Agent');
        const isSubagentEnd = body.hook_event_name === 'SubagentStop'
          || (isTurnEndEvent && isSubagentStop);
        if (isSubagentSpawn) {
          // §5.5 #17-9 — IDE 에 무슨 내용인지 띄우도록 대차대조 항목에 tool_input 메타를 싣는다(표시 전용, 판정에 관여하지 않는다).
          const ti = body.tool_input;
          const pickStr = (k: string): string | undefined => {
            const v = ti?.[k];
            return typeof v === 'string' && v.trim() ? v.trim() : undefined;
          };
          const meta = {
            description: pickStr('description'),
            subagentType: pickStr('subagent_type'),
            prompt: pickStr('prompt')?.slice(0, 200),
            // §5.5 #17-9 ⑧ — 배경 스폰이면 뒤따르는 PostToolUse 는 접수증이라 완료로 읽으면 안 된다.
            //   (현 CLI 의 `Agent` 도구는 이 값이 **기본 참**이다.)
            background: ti?.['run_in_background'] === true,
          };
          // 대차대조 크기는 그대로여도(이미 active) 표시용 목록은 늘었으므로 항상 broadcast.
          subAgentManager.noteSubagentTaskStart(bgOwnerAgentId, body.tool_use_id, bgOwnerSub?.id, meta);
          broadcastSnapshot();
        } else if (isSubagentEnd) {
          // §5.5 #17-9 ⑦(b) — `SubagentStop` 은 자식의 마지막 말(`last_assistant_message`)을 달고 온다.
          //   부모가 실제로 받아 든 보고는 뒤따르는 PostToolUse(Task) 의 `tool_response` 라 그쪽이 더 정확하지만,
          //   그 이벤트가 유실되는 판본을 대비한 폴백으로 여기서 먼저 담아 둔다.
          const lastMessage = extractTaskResultText(body.last_assistant_message);
          const { drained } = subAgentManager.noteSubagentTaskStop(
            bgOwnerAgentId, body.parent_tool_use_id, lastMessage,
          );
          // 마지막 자식 종료 — 부모가 재호출되지 않으면 이 시점이 진짜 완료. 즉시 재계산해 반영.
          if (drained) graphManager.recomputeCustomAgentStatus(bgOwnerAgentId);
          // §5.5 #17-9 — 상태 변화가 없어도 실행 중 목록이 한 건 줄었으므로 항상 broadcast
          //   (마지막 항목이 끝나면 클라 활동바 아이콘·배지·패널이 이 스냅샷으로 사라진다).
          broadcastSnapshot();
        } else if (
          body.hook_event_name === 'PostToolUse'
          && (body.tool_name === 'Task' || body.tool_name === 'Agent')
        ) {
          // §5.5 #17-9 ⑦(b) — 자식의 최종 보고가 **부모에게 도착한** 순간. 이미 내려간 항목에 결과를 붙인다.
          //   ⑧ — 단, 배경 스폰이면 이건 최종 보고가 아니라 "띄웠다" 접수증이다(항목을 내리지 않는다).
          const result = extractTaskResultText(body.tool_response);
          const spawnedInBackground = body.tool_input?.['run_in_background'] === true;
          if (subAgentManager.noteSubagentTaskResult(bgOwnerAgentId, body.tool_use_id, result, spawnedInBackground)) {
            broadcastSnapshot();
          }
        } else if (typeof body.agent_id === 'string' && body.hook_event_name === 'PreToolUse') {
          // §5.5 #17-9 ⑦(a) — **자식 안에서** 난 도구 호출(공통 필드 `agent_id` 는 서브에이전트 안에서만 존재).
          //   그 자식의 카드에 "지금 무슨 도구를 무엇에 대고 쓰는지"를 얹는다. 대차대조 증감은 건드리지 않는다.
          const changed = subAgentManager.noteSubagentChildActivity(bgOwnerAgentId, {
            ...(body.agent_id ? { agentId: body.agent_id } : {}),
            ...(typeof body.agent_type === 'string' && body.agent_type ? { agentType: body.agent_type } : {}),
            ...(body.tool_name ? { toolName: body.tool_name } : {}),
            ...(body.tool_name
              ? (() => {
                  const target = describeToolTarget(body.tool_name, body.tool_input);
                  return target ? { toolTarget: target } : {};
                })()
              : {}),
          });
          // 도구 이벤트는 아래 공통 경로가 어차피 코얼레스 broadcast 를 태우므로(§9) 여기서
          // 따로 즉시 발사하지 않는다 — 자식 도구는 폭주 경로다.
          if (!changed) subAgentManager.noteSubagentSignal(bgOwnerAgentId);
        } else {
          subAgentManager.noteSubagentSignal(bgOwnerAgentId);
        }
      }

      // §5.5 #17-17 ① — 세션이 `TodoWrite` 로 세운 계획이 곧 목표 카드다(문장 = 지금 명령, 단계 = 그 계획). 계획이 갱신될 때마다 체크리스트가 따라간다.
      // §9 — 훅 경로라 인라인 broadcast·동기 saveCheckpoint 를 하지 않는다. 공통 경로의 코얼레스 broadcast + scheduleCheckpoint 에 얹힌다(폭주 시 프리즈 방지).
      if (body.hook_event_name === 'PreToolUse' && body.tool_name === 'TodoWrite' && bgOwnerSub) {
        const steps = parsePlanStepsFromTodos((body.tool_input as { todos?: unknown } | undefined)?.todos);
        if (steps.length > 0) {
          graphManager.syncSessionGoalFromPlan(bgOwnerSub.id, {
            agentId: bgOwnerSub.parentAgentId,
            ...(bgOwnerSub.lastCommand ? { command: bgOwnerSub.lastCommand } : {}),
            steps,
          });
        }
      }

      // §4 — CMD 터미널 연속성: 인터랙티브 claude 대화의 원본 sessionId(rewrite 전)를 termId 별로 기록한다.
      // 재시작 후 같은 termId 로 터미널을 열면 terminalManager 가 이 값으로 `claude --resume <id>` 를 prefill 한다.
      if (body._vibisualOwnerTermId && claudeSessionId) {
        recordCmdTermSession(body._vibisualOwnerTermId, claudeSessionId);
        // §4 — CMD 세션 탭(sub) 도트 연속 동기화: tool 이벤트→active, Stop→idle(녹색).
        //   termId 끝 토큰이 곧 sub.id 라 그 탭만 정확히 구동한다(부모 버블은 위 markActive/markStop 담당).
        //   서브에이전트 Stop 은 이 터미널의 자기 턴 종료가 아니므로 idle 로 매기지 않는다.
        const subChanged = subAgentManager.markCmdSubActivity(
          body._vibisualOwnerTermId,
          isOwnStop,
        );
        if (subChanged) broadcastSnapshot();
      }

      // Stop → 즉시 completed, 그 외 → active. 단 서브에이전트 종료는 부모 라이프사이클을 건드리지 않는다 —
      // 부모의 실제 턴 종료 Stop(서브 마커 없음)만 markStop 한다. 서브 재개 후 부모가 내는 tool 이벤트/
      // 자기 Stop 이 이어서 상태를 올바로 매긴다.
      if (isOwnStop) {
        agentTracker.markStop(body.session_id);
      } else if (marksActivity(body.hook_event_name)) {
        agentTracker.markActive(body.session_id);
      }
      // sessionLifecycle에 활동 신호 전파 (PID는 여기서 알 수 없으므로 null)
      if (claudeSessionId && body.cwd) {
        lifecycle.registerFromToolUse(claudeSessionId, body.cwd, null);
      }

      // §4 — Notification 서브타입 → 버블 시각 신호(`type` 필드 우선, 없으면 message heuristic). 시각화 전용 — permission 차단은 PreToolUse 경로가 한다.
      if (body.hook_event_name === 'Notification') {
        const subtype = classifyNotification(body.type, body.message);
        if (subtype === 'awaiting_permission') {
          graphManager.setAgentNotificationStatus(body.session_id, subtype);
          broadcastSnapshot();
        }
      }

      // §4 — PostToolUse `duration_ms` 캡처(2026-04 부터 실리는 필드).
      if (
        body.hook_event_name === 'PostToolUse'
        && typeof body.tool_name === 'string'
        && typeof body.duration_ms === 'number'
      ) {
        graphManager.recordToolDuration(body.session_id, body.tool_name, body.duration_ms);
        // broadcast 는 도구 이벤트 처리부에서 이미 일어나므로 별도 호출 불필요.
      }

      // §5.26 (B) — 팀 구성은 압축이 통째로 지우는 축인데 그래프에는 남는 자리가 없다.
      //   훅이 지나갈 때 이름을 합집합으로 모아 두면 압축 마커에 그대로 실려 나간다.
      if (body.hook_event_name === 'TeammateIdle' || body.hook_event_name === 'SubagentStart') {
        const names = extractTeammateNames(body as unknown as Record<string, unknown>);
        if (names.length > 0) graphManager.noteTeammates(body.session_id, names);
      }

      // §4 — PreCompact 카운터 증가.
      // §5.26 (B) 1단계 — 같은 자리에서 압축 직전 사본을 뜬다. 놓치면 되찾을 길이 없다: 컨텍스트 눈금은 훅에 안 실리고(claude-code#44790) 압축 뒤엔 원문 자리에 요약이 앉는다.
      if (body.hook_event_name === 'PreCompact') {
        graphManager.recordCompact(body.session_id);
        const ownerAgentId = bgOwnerAgentId ?? graphManager.getAgentBySession(body.session_id)?.id;
        const runningTasks = ownerAgentId
          ? (subAgentManager.getRunningSubagentTasks()?.[ownerAgentId] ?? [])
            .map((t) => t.description ?? t.subagentType ?? t.agentType ?? '')
            .filter((t): t is string => t.length > 0)
          : [];
        const marker = graphManager.recordCompactMarker({
          sessionId: body.session_id,
          ...(body.transcript_path ? { transcriptPath: body.transcript_path } : {}),
          ...(body.trigger ? { trigger: body.trigger } : {}),
          ...(bgOwnerSub?.id ? { subAgentId: bgOwnerSub.id } : {}),
          ...(body.cwd ? { cwd: body.cwd } : {}),
          ...(runningTasks.length > 0 ? { runningTasks } : {}),
          ...(body.last_assistant_message ? { lastAssistantTail: body.last_assistant_message } : {}),
        });
        // 미러 복사는 응답을 보낸 뒤에 돈다 — `PreCompact` 는 막을 수 있는 훅이라 여기서 파일을 긁으면 압축이 우리 I/O 만큼 늦고, 비정상 종료면 압축이 통째로 취소된다.
        // JSONL 은 append-only 라 늦게 떠도 같은 바이트다(§5.26 (B)).
        if (marker) setImmediate(() => graphManager.mirrorCompactMarker(marker));
        // §5.5 #17-24 ⑥ — 라이브 1줄의 "압축 중". 스트림 `status:"compacting"` 과 겹치면 먼저 온 쪽이 세운다
        //   (agent-view 처럼 status 줄이 없는 경로는 이 훅이 유일한 시작 신호다).
        if (bgOwnerSub) subAgentManager.noteCompactionHook(bgOwnerSub.id, 'start');
        broadcastSnapshot();
        saveCheckpoint(); // compactCounts + §5.26 보험 색인은 영속화 대상
      }

      if (body.hook_event_name === 'PostCompact') {
        /*
         * §5.26 (D) — 압축이 끝났다는 CLI 자신의 신고. 이것이 있어야 스윕이 "요약을 못 읽었다"(계속 일하면 됨)와 "압축이 안 됐다"(`/clear` 밖에 없는 교착)를 가른다.
         * 표식만 남기고 대조는 스윕에 맡긴다 — 지금 읽으면 요약이 아직 파일에 안 내려가 빈 꼬리를 요약으로 읽는다.
         */
        if (graphManager.notePostCompact(body.session_id)) saveCheckpoint();
      }

      // §5.5 #17-24 ⑥ — "압축 중" 표식을 걷는 훅. PostCompact 하나만 믿지 않는다 — 오지 않은 압축이 실제로
      //   있다(§5.26 (D)). 압축 뒤에 반드시 오는 사건(SessionStart — 압축 뒤 source "compact" 로 다시 온다 ·
      //   턴 끝 · 새 프롬프트 · 세션 끝)도 끝 신호다. 스트림을 읽는 경로는 줄 단위로 따로 걷는다.
      if (bgOwnerSub && endsCompaction(body.hook_event_name)) {
        subAgentManager.noteCompactionHook(bgOwnerSub.id, 'end');
      }

      /*
       * §3.6 — 훅 표시 처리. 판정은 `hookEventClass.ts` 한 곳 — 라우트 안에 흩으면 새 이벤트를 등록할 때마다 조용히 틀린다.
       * - `PermissionRequest`·`Elicitation`(MCP 가 도구 도중 되묻는다) — 승인 대기 표시. 표시 전용, 실제 판정은 §5.3 #12-1 동기 `PreToolUse` 게이트.
       * - `PermissionDenied`(상태는 markActive 가 되돌렸다 — 대기 표시에 멈추지 않게)·`PostCompact`·`ElicitationResult` — 재방송만.
       * - `PreModelSwitch`·`PostModelSwitch`·`WorktreeCreate`·`WorktreeRemove`·`ConfigChange`·`CwdChanged`·`DirectoryAdded`·`SessionEnd` — 버블 내용이 바뀌어 재방송(없으면 다음 도구 호출까지 옛 값).
       * - `MessageDisplay`·`PostToolBatch`·`UserPromptExpansion`·`Setup`·`FileChanged` — 표시 없음(빈도는 `hookEventClass` 주석).
       */
      if (raisesAwaitingInput(body.hook_event_name)) {
        graphManager.setAgentNotificationStatus(body.session_id, 'awaiting_permission');
        broadcastSnapshot();
      } else if (clearsAwaitingInput(body.hook_event_name) || needsSnapshotRefresh(body.hook_event_name)) {
        broadcastSnapshot();
      }

      // §5.5 #17-17 — 작업 장부(`TaskCreate`/`TaskUpdate`)가 낸 훅을 세션 목표 단계로 흘린다.
      //   목표 창이 지금까지 REST 로 흉내 내던 것의 **원본**이다.
      if (isTaskLedgerEvent(body.hook_event_name)) {
        ingestTaskLedgerHook(body, bgOwnerAgentId ?? null, bgOwnerSub?.id ?? null);
      }
      // §3.6-1 — 어떤 CLAUDE.md·rules 가 실제로 로드됐는지 계측(표시 전용, 영속화하지 않는다).
      if (body.hook_event_name === 'InstructionsLoaded') {
        recordInstructionsLoaded(body.session_id, body as unknown as Record<string, unknown>);
      }

      // 도구 사용 이벤트만 그래프 처리 (Notification/Stop은 상태 전환만)
      if (isToolEvent(body)) {
        const result = graphManager.processHookEvent(body);

        // PostToolUse Bash 후 파일 존재 확인(삭제/rename 감지).
        // §9 — Bash 폭주 시 전 노드 existsSync 스윕이 이벤트마다 돌지 않게 최소 간격으로 스로틀한다(miss 임계 `FILE_EXISTENCE_MISS_THRESHOLD` 의미는 그대로).
        let ghosted = 0;
        let pruned = 0;
        if (
          body.hook_event_name === 'PostToolUse' && isShellToolName(body.tool_name)
          && Date.now() - lastExistenceSweepAt >= EXISTENCE_SWEEP_MIN_INTERVAL_MS
        ) {
          lastExistenceSweepAt = Date.now();
          ghosted = graphManager.checkFileExistence();
          pruned = graphManager.pruneDisappearing();
        }

        // §9 — 모델 도구 사용 빈도로 도착하는 폭주 경로다. 인라인 broadcast(getSnapshot())로 디바운스를 우회하지 마라 — 방송은 디바운스, 체크포인트는 코얼레스 저장(그 외 지점은 즉시 저장).
        if (ghosted > 0 || pruned > 0 || result) {
          broadcastSnapshot();
        }
        scheduleCheckpoint();
      }

      /*
       * §5.1 #2-1 (B) — 묶음의 이번 턴 장부. 사람이 친 문장이 그 에이전트의 새 턴을 열고(CMD 터미널·바깥 세션 — 헤드리스는 발송
       *   자리가 이미 열었다), 그 세션의 자기 턴 끝(`Stop`·`SessionEnd` — 서브에이전트 종료 제외)이 "턴 도중"을 내린다.
       *   그래프 처리 뒤라 첫 문장에 막 생긴 바깥 세션의 버블도 찾는다.
       */
      const turnAgentId = bgOwnerAgentId ?? graphManager.getAgentBySession(body.session_id)?.id;
      if (turnAgentId) {
        if (body.hook_event_name === 'UserPromptSubmit') {
          if (graphManager.beginAgentPromptTurn(turnAgentId, bgOwnerSub?.id)) {
            broadcastSnapshot();
            scheduleCheckpoint();
          }
        } else if (isOwnStop) {
          graphManager.endAgentPromptTurn(turnAgentId);
        }
      }

      /*
       * §5.3 #12-4 (E) ④ — 우리 CMD 터미널의 턴 = 사람이 친 문장(`UserPromptSubmit`) → 그 턴의 끝. 검증 권한은
       *   그 문장에서만 서고 턴이 끝나면 만료된다(다음 턴으로 승계 ❌). 서브에이전트의 Stop 은 턴 끝이 아니다.
       *   터미널 id 가 없는 세션(우리 헤드리스·외부 훅 세션)은 여기 해당하지 않는다.
       */
      const cmdTurnSub = body._vibisualOwnerTermId ? bgOwnerSub : undefined;
      if (cmdTurnSub) {
        if (body.hook_event_name === 'UserPromptSubmit' && typeof body.prompt === 'string') {
          verificationGate.beginCmdTurn(cmdTurnSub.id, body.prompt);
        } else if ((isTurnEndEvent && !isSubagentStop) || isSessionEnd) {
          verificationGate.endCmdTurn(cmdTurnSub.id);
        }
      }

      /*
       * §5.11 정독 게이트 — 읽기 영수증은 여기서만 쌓인다. 도구 호출 이력이 서버에 닿는 자리가 이 훅 하나라, 우리 세션과 바깥 에디터 세션이 같은 원장을 쓴다.
       * 판정은 하지 않는다(절 자르기·커버율은 플러그인 순수 함수 몫) — 무엇을 열었는지만 남긴다.
       */
      const specSubId = bgOwnerSub?.id;
      const specAgentId = bgOwnerAgentId ?? graphManager.getAgentBySession(body.session_id)?.id;
      const specProject = specAgentId ? graphManager.getProjectPathForAgent(specAgentId) : null;
      if (specSubId && specProject) {
        const at = Date.now();
        if (body.hook_event_name === 'UserPromptSubmit' && typeof body.prompt === 'string') {
          // 턴이 새로 시작했으므로 지난 턴의 되돌림 횟수도 함께 되돌린다 — 안 그러면 한 세션에서 한 번만 막을 수 있다.
          // 우리가 띄운 세션의 본문은 조립 시점(`processNextCommand`)에 이미 적혔다 — 훅이 주는 것은 앞말이 붙은
          //   조립본이라 그대로 담으면 지난 정독 블록이 이번 라우팅 재료가 된다. 조립본이 아닐 때만 여기서 적는다.
          specReadingService.notePromptFromHook(specSubId, specProject, body.prompt, at);
          specReadingService.resetStopRetries(specSubId);
        }
        if (body.hook_event_name === 'PostToolUse' && typeof body.tool_name === 'string') {
          specReadingService.noteToolUse(specSubId, specProject, body.tool_name, body.tool_input, body.tool_response, at);
          if (SPEC_TOUCH_TOOLS.has(body.tool_name)) {
            const target = body.tool_input?.['file_path'] ?? body.tool_input?.['notebook_path'];
            if (typeof target === 'string') specReadingService.noteTouched(specSubId, specProject, target, at);
          }
        }
        // 턴을 끝내며 낸 글에서 인용을 뽑아 **원문과 대조**한다. 이 축이 없으면 인용도 지어낼 수 있다.
        if (isTurnEndEvent && typeof body.last_assistant_message === 'string') {
          verifySpecCitationsFrom(specSubId, body.last_assistant_message, specProject);
        }
      }

      /*
       * §5.11 정독 게이트 — 강도 `경고`의 집행 자리: 안 연 필수 절을 남긴 채 턴을 끝내려 하면 `Stop` 을 되돌린다.
       * 되돌림은 상한에 닿으면 더 막지 않는다 — 끝내지 못하는 세션이 최악의 결과다. 서브에이전트·세션 종료는 대상이 아니다.
       */
      if (isTurnEndEvent && !isSubagentStop && !isSessionEnd && specSubId && specProject) {
        const gate = specStopGate(specSubId, specProject);
        if (gate.block && gate.reason) {
          broadcastSnapshot();
          res.json({ decision: 'block', reason: gate.reason });
          return;
        }
      }

      /*
       * §5.11 — 집행의 네 번째 주입 지점: 훅으로 붙은 외부 세션(나머지 셋은 첫 스폰 `contextSummary` · 이어지는 턴 `livePreamble` · CMD `CLAUDE.md`).
       * `UserPromptSubmit` 응답의 `additionalContext` 가 그 턴 맥락에 들어간다(§5.10 파일 경고의 `PostToolUse` 와 같은 방식).
       * 우리가 띄운 세션에는 붙이지 마라 — 프롬프트에 이미 실려 같은 블록이 매 턴 두 번 실린다.
       */
      if (body.hook_event_name === 'UserPromptSubmit') {
        // §5.5 #17-28 — 이 줄도 주입원 창의 한 항목이다. 그 세션이 속한 프로젝트에서 껐으면
        //   여기서도 안 나간다("여기가 최종"이 우리가 띄운 세션에만 해당하면 반쪽짜리다).
        const hookAgent = graphManager.getAgentBySession(body.session_id);
        const hookProjectKey = hookAgent ? graphManager.getAgentProjectName(hookAgent.id) : null;
        const ctxScope = { projectKey: hookProjectKey, agentId: hookAgent?.id ?? null, subAgentId: null };
        const overrides = graphManager.getContextOverrides();
        const enforcement = isContextSourceOn(overrides, ctxScope, CONTEXT_SOURCE_IDS.hookEnforcement)
          ? buildHookEnforcementBlock(body)
          : '';
        /*
         * §5.26 (E) 3단계 — 훅으로 붙은 외부 세션에도 복원 브리핑을 보낸다(그쪽은 프롬프트를 조립해 주지 않아 이 응답이 유일한 통로).
         * 집행 블록과 스위치를 나눈다 — 묶으면 플러그인 집행을 끌 때 복원까지 꺼진다.
         * 고르기와 못 박기를 한 동작(`take`)으로 한다 — 조립과 발송 사이에 표를 재는 경로가 끼어들 수 없게.
         */
        let recovery = '';
        if (isContextSourceOn(overrides, ctxScope, CONTEXT_SOURCE_IDS.compactRecovery)) {
          const marker = graphManager.takeCompactBriefing(body.session_id);
          if (marker?.outcome && hasNotCarried(marker.outcome.notCarried)) {
            recovery = buildRecoveryBlock(marker.outcome.notCarried);
          }
        }
        const procedures = buildAutoGoalHookContext(body, {
          agentBySession: (sessionId) => graphManager.getAgentBySession(sessionId),
          isManagedSession: (sessionId) => Boolean(subAgentManager.findSubBySessionId(sessionId)),
          rootForAgent: (agentId) => {
            const root = graphManager.getProjectPathForAgent(agentId);
            return root ? graphManager.resolveAutoGoalRoot(root) : null;
          },
          settings: (root) => graphManager.getAutoGoalSettings(root),
          contextEnabled: (agentId, sessionId) => isContextSourceOn(overrides, {
            projectKey: graphManager.getAgentProjectName(agentId), agentId, subAgentId: sessionId,
          }, CONTEXT_SOURCE_IDS.autoGoalSkills),
          ...(hookListenerIdentityFile ? { identityFile: hookListenerIdentityFile } : {}),
          log: (error) => logger.warn('[auto-goal] external hook context failed', error as Error),
        });
        // §5.3 #12-4 (G) — CMD도 매 턴 현재 정책을 받는다(끔이면 이전 제한의 해제 안내).
        const verificationLine = cmdTurnSub && isContextSourceOn(overrides, ctxScope, CONTEXT_SOURCE_IDS.verificationPolicy)
          ? verificationGate.cmdTurnStateLine(cmdTurnSub.id).trim()
          : '';
        const additionalContext = [enforcement, recovery, procedures, verificationLine].filter(Boolean).join('\n\n');
        if (additionalContext) {
          res.json({
            continue: true,
            hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext },
          });
          return;
        }
      }
      res.json({ continue: true });
    } catch (err) {
      logger.error('POST /api/hook-event failed', err);
      res.status(500).json({ error: 'Internal server error', continue: true });
    }
  });

  /**
   * §4 — `subagentStatusLine` 수집기 ingress. 핸들러가 `--subagent-statusline` 모드로 틱마다 보이는 서브에이전트 행 전체를 넘긴다.
   * 계측 전용 — 판정 로직은 이 값을 읽지 않고, 응답도 화면에 영향을 주지 않는다.
   */
  app.post('/api/subagent-statusline', (req, res) => {
    try {
      const body = req.body as { sessionId?: unknown; cwd?: unknown; tasks?: unknown };
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
      const cwd = typeof body?.cwd === 'string' ? body.cwd : undefined;
      const stored = recordSubagentStatusLine(sessionId, body?.tasks, cwd);
      res.json({ ok: true, stored });
    } catch (err) {
      logger.error('POST /api/subagent-statusline failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §4 — 수집된 서브에이전트 행 조회(세션 지정 시 그 세션, 없으면 전체). */
  app.get('/api/subagent-statusline/:sessionId?', (req, res) => {
    try {
      const sessionId = (req.params as Record<string, string | undefined>)['sessionId'];
      if (sessionId) {
        res.json(getSubagentStatusLine(sessionId) ?? { sessionId, tasks: [] });
        return;
      }
      res.json({ sessions: listSubagentStatusLines() });
    } catch (err) {
      logger.error('GET /api/subagent-statusline failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §3.6-1 — `InstructionsLoaded` 계측 조회. 세션 지정 시 그 세션의 로드 기록(오래된 것부터), 없으면 전체 요약.
   * 표시 전용 — 어떤 판정 로직도 이 값을 읽지 않는다.
   */
  app.get('/api/instructions-loaded/:sessionId?', (req, res) => {
    try {
      const sessionId = (req.params as Record<string, string | undefined>)['sessionId'];
      if (sessionId) {
        res.json({ sessionId, entries: getInstructionsLoaded(sessionId) });
        return;
      }
      res.json(summarizeInstructionsLoaded());
    } catch (err) {
      logger.error('GET /api/instructions-loaded failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §4 — Claude.ai 한도 사용률 푸시. 외부 statusline 스크립트가 5h/7d 윈도우 사용률을 보고한다. 한도는 사용자 단위라 글로벌 1건만 둔다.
   * Body: { used5h?, resetAt5h?, used7d?, resetAt7d? } — used*: 퍼센트(0~100), resetAt*: 리셋 epoch ms.
   * 0~1 을 비율로 추측하지 마라 — 값 1 은 1% 와 100% 둘 다 되어 부풀려 보인다.
   */
  app.post('/api/rate-limits', (req, res) => {
    try {
      const body = req.body as Record<string, unknown> | null;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Body required' });
        return;
      }
      const payload: Record<string, number> = {};
      for (const key of ['used5h', 'resetAt5h', 'used7d', 'resetAt7d'] as const) {
        const v = body[key];
        if (typeof v === 'number' && Number.isFinite(v)) payload[key] = v;
      }
      if (Object.keys(payload).length === 0) {
        res.status(400).json({ error: 'No valid fields' });
        return;
      }
      const changed = applyRateLimitPayload(payload);
      res.json({ ok: true, changed });
    } catch (err) {
      logger.error('POST /api/rate-limits failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * 한도 사용률을 한 자리에 쓴다 — statusLine 수집기(`/api/rate-limits`)와 §4 엔진 다리가 같은 길을 탄다.
   * statusLine 은 최대 300ms 주기로 돌 수 있어, 값이 실제로 바뀐 때만 사용량을 다시 만들고 방송한다(updatedAt 만 바뀌면 흡수 — 핸들러 쪽 스로틀과 2중 방어).
   * @returns 값이 실제로 바뀌었는가.
   */
  function applyRateLimitPayload(payload: Partial<Record<'used5h' | 'resetAt5h' | 'used7d' | 'resetAt7d', number>>): boolean {
    const before = graphManager.getRateLimits();
    const changed = (['used5h', 'resetAt5h', 'used7d', 'resetAt7d'] as const).some(
      (k) => payload[k] !== undefined && payload[k] !== before?.[k],
    );
    graphManager.setRateLimits(payload);
    if (changed) refreshClaudeUsage();
    return changed;
  }

  /**
   * §4 엔진 다리 — POST /api/engine-bridge
   *
   * 우리가 띄운 클로드 세션에 실린 모드(`hooks/mods/vibisual-bridge`)의 신고. 루프백 허용 목록(§3.7)·토큰
   * 필수. 모드는 사실만 올리고 판정은 서버가 한다(§3.1). 생존 판정·유휴 강등·잠듦 회수는
   * `subAgentManager` 가 `engineBridge` 상태를 직접 읽고, 여기서는 CMD 탭 상태와 한도 칸만 반영한다.
   */
  app.post('/api/engine-bridge', (req, res) => {
    try {
      const report = parseEngineBridgeReport(req.body);
      if (!report) {
        res.status(400).json({ ok: false, error: 'invalid report' });
        return;
      }
      const reply = { ok: true, heartbeatMs: ENGINE_BRIDGE_HEARTBEAT_MS };
      // 우리가 띄운 세션만 받는다 — 살아 있는 세션 탭과 대조한다. CMD 는 터미널 칸의 주인까지 맞아야 한다.
      const sub = subAgentManager.getSub(report.identity.subAgentId);
      const termId = report.identity.termId;
      if (!sub || (termId && subAgentManager.findSubByTermId(termId)?.id !== sub.id)) {
        res.json({ ...reply, ignored: true });
        return;
      }
      const now = Date.now();
      const result = engineBridge.ingest(report, now);
      if (!result.accepted) {
        res.json({ ...reply, ignored: true });
        return;
      }
      // CMD 탭 — 턴 가장자리마다, 그리고 턴이 도는 동안의 생존 신호마다 훅과 **같은 함수**로 세운다.
      //   분할 pane 은 하나라도 돌면 active 다. Esc 로 끊은 턴(Stop 훅이 오지 않는다)도 여기서 내린다.
      if (termId) {
        const running = engineBridge.isTurnRunning(sub.id, now);
        if (result.edges.length > 0 || running) {
          if (subAgentManager.markCmdSubActivity(termId, !running)) broadcastSnapshot();
        }
      }
      // 한도 — `/api/rate-limits` 와 같은 저장 자리(statusLine 수집기를 안 켠 사용자의 한도 칸도 채운다).
      const limits = rateLimitsFromEngine(report.usage?.rateLimits);
      if (limits) applyRateLimitPayload(limits);
      res.json(reply);
    } catch (err) {
      logger.error('POST /api/engine-bridge failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** §4 엔진 다리 — 옵션창 상태 줄(스위치·판올림·지금 붙은 세션 수). 렌더러 전용(루프백 허용 목록 밖). */
  app.get('/api/engine-bridge', (_req, res) => {
    try {
      res.json(engineBridge.status(Date.now()));
    } catch (err) {
      logger.error('GET /api/engine-bridge failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 — 한도가 리셋되는 순간 한 번 더 받아온다: 가장 이른 리셋 시각 + 10초에 일회성 타이머(리셋 뒤엔 서버가 새 창 값을 줘 0% 로 떨어진다).
   * 5분 폴링만 두면 리셋 뒤에도 화면이 최대 5분 100% 로 남고, 폴링이 멎으면 영구히 남는다.
   */
  let claudeUsageResetTimer: NodeJS.Timeout | null = null;
  function scheduleResetRefresh(info: ClaudeUsageInfo): void {
    if (claudeUsageResetTimer) clearTimeout(claudeUsageResetTimer);
    claudeUsageResetTimer = null;
    const now = Date.now();
    const next = info.limits
      .map((l) => l.resetsAt)
      .filter((v): v is number => typeof v === 'number' && v > now)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    // 상한 6시간 — setTimeout 은 24.8일을 넘기면 즉시 발사되고, 주간 창(7일)이 그 범위다.
    const delay = Math.min(next - now + 10_000, 6 * 60 * 60 * 1000);
    claudeUsageResetTimer = setTimeout(() => { void probeAndRefreshClaudeUsage(); }, delay);
  }

  /**
   * statusLine 이 보고한 창(`rateLimits`)에서 표시용 사용량을 다시 만든다. 네트워크 호출 없는 순수 파생 — `rateLimits` 갱신·리셋 시각 경과 때 다시 부른다.
   * Promise 가 아니어도 호출부가 여럿이라 반환값만 돌려주고 호출부의 `void`·`await` 는 그대로 둔다.
   */
  /**
   * §4 — `/usage` probe 로 받아 둔 마지막 스냅샷과 그 실패 사유.
   * 부팅 때는 디스크 캐시(직전 실행분)를 먼저 넣어 헤더 필이 곧바로 값을 들고 뜬다(probe 결과가 몇 초 뒤 덮어쓴다).
   */
  let usageProbeSnapshot: UsageProbeSnapshot | null = readCachedUsageSnapshot();
  let usageProbeFailure: UsageProbeFailure | undefined;
  /** 동시 호출 합류 — 주기·리셋 타이머·팝업 새로고침이 겹쳐도 CLI 는 한 번만 돈다. */
  let usageProbeInflight: Promise<ClaudeUsageInfo> | null = null;

  /**
   * `claude -p "/usage"` 를 돌려 값을 새로 받고 표시값을 다시 조립한다.
   *
   * 모델 호출이 0턴이라 과금이 없다(§ claudeUsageProbe 주석의 실측). 실패해도 throw 하지 않고
   * 마지막 성공값을 유지한 채 사유만 실어 보낸다.
   */
  function probeAndRefreshClaudeUsage(): Promise<ClaudeUsageInfo> {
    if (usageProbeInflight) return usageProbeInflight;
    usageProbeInflight = probeClaudeUsage()
      .then((result) => {
        if (result.snapshot) usageProbeSnapshot = result.snapshot;
        usageProbeFailure = result.failure;
        return refreshClaudeUsage();
      })
      .catch((err: unknown) => {
        logger.warn(`[claudeUsage] probe 실패: ${err instanceof Error ? err.message : String(err)}`);
        return refreshClaudeUsage();
      })
      .finally(() => {
        usageProbeInflight = null;
      });
    return usageProbeInflight;
  }

  function refreshClaudeUsage(): ClaudeUsageInfo {
    // 값이 비었을 때 "수집기를 켜라" 와 "켜져 있으니 첫 값을 기다리는 중" 을 화면이 구분해
    // 말하려면 설치 여부가 필요하다(settings.json 1회 읽기 — 이 함수는 갱신 때만 돈다).
    const info = buildClaudeUsage(
      graphManager.getRateLimits(),
      Date.now(),
      readUsageCollectorStatus().installed,
      usageProbeSnapshot,
      usageProbeFailure,
    );
    const before = graphManager.getClaudeUsage();
    graphManager.setClaudeUsage(info);
    scheduleResetRefresh(info);

    // 값이 그대로면 브로드캐스트하지 않는다(주기 재조립이 스냅샷을 흔들지 않게).
    const changed =
      before === undefined ||
      before.error !== info.error ||
      before.plan !== info.plan ||
      JSON.stringify(before.limits) !== JSON.stringify(info.limits);
    if (changed) broadcastSnapshot();
    return info;
  }

  /**
   * §4 — Claude 사용량 직접 조회(Claude 앱 `/usage` 와 같은 원천). GET → 캐시 즉시(없으면 1회 조회) · POST → 강제 재조회.
   * 값은 `GraphSnapshot.claudeUsage` 로도 흐른다. 세션·주간 창은 `rateLimits` 에도 미러링해 DetailPanel 게이지가 statusLine 없이도 찬다.
   */
  app.get('/api/claude-usage', (_req, res) => {
    const cached = graphManager.getClaudeUsage();
    res.json(cached ?? refreshClaudeUsage());
  });

  app.post('/api/claude-usage/refresh', (_req, res) => {
    void probeAndRefreshClaudeUsage()
      .then((info) => res.json(info))
      .catch(() => res.json(refreshClaudeUsage()));
  });

  // 부팅 직후 1회 + 주기 probe + 리셋 시각 일회성(scheduleResetRefresh). probe 는 모델 호출 0턴이라 과금이 없다(실측).
  // statusLine 이 켜져 있으면 `POST /api/rate-limits` 가 그 사이를 더 촘촘히 메운다.
  // §9 「창이 뜬 직후의 메인 스레드」 ② — 부팅 1회분은 창이 보인 뒤 한 칸씩 도는 줄에 세운다(`startupJobs.ts`).
  deferStartupJob('claude-usage', 2_000, () => { void probeAndRefreshClaudeUsage(); });
  setInterval(() => { void probeAndRefreshClaudeUsage(); }, CLAUDE_USAGE_POLL_INTERVAL_MS);

  /**
   * §4 API 크레딧 — 구독 한도가 막히면 Console 크레딧으로 잇는다(금액·한도·잔액은 Console 이 정한다). 값은 `GraphSnapshot.apiCredits` 로도 흐른다.
   * **렌더러 IPC 전용** — loopback 리스너 허용 목록에 올리지 마라. 토큰을 쥔 에이전트가 키를 바꾸거나 거절 기억을 걷으면 사용자 몰래 크레딧이 쓰인다.
   * 구독 소진 판정 재료(`/usage` 표)는 여기서 주입한다 — 서비스가 다른 서비스를 끌어오지 않게.
   */
  apiCreditService.setSubscriptionSource(() => {
    const usage = graphManager.getClaudeUsage();
    return usage ? { limits: usage.limits, fetchedAt: usage.fetchedAt } : {};
  });
  // 클라우드 제공자로 도는 PC 면 크레딧 경로를 닫는다 — 그 판정의 한 근거가 CLI 가 말한 `apiProvider` 다.
  apiCreditService.setProviderSource(() => graphManager.getClaudeAuth()?.apiProvider);
  apiCreditService.setChangeListener(() => broadcastSnapshot());
  // Console 이번 달 지출 — 관리자 키가 있을 때만 읽는다(없으면 바로 돌아온다). 부팅 1회분은 창이 보인 뒤 한 칸씩
  //   도는 줄에 세우고(§9 「창이 뜬 직후의 메인 스레드」), 그 뒤로는 5분마다 — 자료는 보통 5분 안에 반영된다(공식 FAQ).
  deferStartupJob('api-credit-console', 4_000, () => { void apiCreditService.refreshConsole({ force: true }); });
  setInterval(() => {
    void apiCreditService.refreshConsole({ maxAgeMs: API_CREDIT_CONSOLE_REFRESH_MS - API_CREDIT_CONSOLE_MIN_INTERVAL_MS });
  }, API_CREDIT_CONSOLE_REFRESH_MS).unref?.();

  /** 지금 상태. 페이지를 열 때 부르므로 지출이 1분보다 오래됐으면 다시 읽기를 건다(응답은 기다리지 않는다). */
  app.get('/api/api-credits', (_req, res) => {
    void apiCreditService.refreshConsole({ maxAgeMs: API_CREDIT_CONSOLE_MIN_INTERVAL_MS });
    res.json(apiCreditService.getState());
  });

  /** 설정 부분 갱신 — 보낸 칸만 바뀐다(정규화는 shared `normalizeApiCreditSettings`). 금액 칸은 없다 — Console 이 정한다. */
  app.put('/api/api-credits/settings', (req, res) => {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const k of ['enabled', 'mode', 'autoContinue'] as const) {
      if (k in body) patch[k] = body[k];
    }
    res.json(apiCreditService.updateSettings(patch));
  });

  /** 키 저장 — 모양이 틀리면 400 + 사유. 저장 뒤 공개 `GET /v1/models` 로 확인이 비동기로 돈다. 키는 응답에 없다. */
  app.post('/api/api-credits/key', (req, res) => {
    const raw = typeof (req.body as { key?: unknown } | undefined)?.key === 'string' ? (req.body as { key: string }).key : '';
    const out = apiCreditService.setKey(raw);
    if (out.problem) {
      res.status(400).json({ ok: false, problem: out.problem, state: out.state });
      return;
    }
    res.json({ ok: true, state: out.state });
  });

  app.delete('/api/api-credits/key', (_req, res) => {
    res.json(apiCreditService.clearKey());
  });

  app.post('/api/api-credits/verify', (_req, res) => {
    void apiCreditService.verifyKey()
      .then(() => res.json(apiCreditService.getState()))
      .catch(() => res.json(apiCreditService.getState()));
  });

  /**
   * 지출 읽기용 관리자 키 저장 — 모양이 틀리면 400 + 사유. 저장하면 이번 달 지출 읽기가 비동기로 돈다(그 결과는
   * 스냅샷으로 온다 — 응답은 기다리지 않는다). 키는 응답에 없다.
   */
  app.post('/api/api-credits/admin-key', (req, res) => {
    const raw = typeof (req.body as { key?: unknown } | undefined)?.key === 'string' ? (req.body as { key: string }).key : '';
    const out = apiCreditService.setAdminKey(raw);
    if (out.problem) {
      res.status(400).json({ ok: false, problem: out.problem, state: out.state });
      return;
    }
    res.json({ ok: true, state: out.state });
  });

  app.delete('/api/api-credits/admin-key', (_req, res) => {
    res.json(apiCreditService.clearAdminKey());
  });

  /** [새로고침] — Console 이번 달 지출을 지금 다시 읽는다(연달아 눌러도 5초에 한 번까지). */
  app.post('/api/api-credits/console/refresh', (_req, res) => {
    void apiCreditService.refreshConsole({ force: true })
      .then(() => res.json(apiCreditService.getState()))
      .catch(() => res.json(apiCreditService.getState()));
  });

  /** [다시 시도] — Anthropic 거절 기억을 지금 걷는다(Console 에서 충전·한도를 바꾼 뒤). 다음 실행이 크레딧을 다시 묻는다. */
  app.post('/api/api-credits/retry', (_req, res) => {
    res.json(apiCreditService.clearBlock());
  });

  /**
   * §4 — 앱 안 Claude 로그인. 상태 판정·로그아웃은 CLI(`claude auth …`)에 위임하고, 로그인은 브라우저 왕복이 필요해 임베디드 PTY(desktop terminalManager)에서 돈다 — 이 REST 는 성패 확인 창구다.
   * 값은 `GraphSnapshot.claudeAuth` 로도 흐른다.
   */
  async function refreshClaudeAuth(): Promise<ClaudeAuthStatus> {
    const before = graphManager.getClaudeAuth();
    const status = await claudeAuthService.refresh();
    graphManager.setClaudeAuth(status);
    // 값이 그대로면 브로드캐스트하지 않는다(폴링이 스냅샷을 흔들지 않게 — 사용량과 같은 규약).
    const changed =
      before === undefined ||
      before.loggedIn !== status.loggedIn ||
      before.error !== status.error ||
      before.email !== status.email ||
      before.authMethod !== status.authMethod ||
      before.subscriptionType !== status.subscriptionType ||
      before.orgName !== status.orgName;
    if (changed) broadcastSnapshot();
    return status;
  }

  app.get('/api/auth/status', (_req, res) => {
    const cached = graphManager.getClaudeAuth();
    if (cached) { res.json(cached); return; }
    void refreshClaudeAuth()
      .then((status) => res.json(status))
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  app.post('/api/auth/status/refresh', (_req, res) => {
    void refreshClaudeAuth()
      .then((status) => res.json(status))
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  /** 옵션창 Account 의 [로그아웃]. 실행 후 재조회한 현재 상태를 함께 준다. */
  app.post('/api/auth/logout', (_req, res) => {
    void claudeAuthService.logout()
      .then((result) => {
        graphManager.setClaudeAuth(result.status);
        broadcastSnapshot();
        res.json(result);
      })
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  // 부팅 직후 1회 + 느슨한 폴링(밖에서 로그아웃한 것을 앱만 모르는 구간 제거). 실패해도 기동엔 무관.
  // §9 「창이 뜬 직후의 메인 스레드」 ② — 부팅 1회분은 창이 보인 뒤 한 칸씩 도는 줄에 세운다.
  deferStartupJob('claude-auth', 1_500, () => { void refreshClaudeAuth().catch(() => {}); });
  setInterval(
    () => { void refreshClaudeAuth().catch(() => {}); },
    CLAUDE_AUTH_POLL_INTERVAL_MS,
  );

  /**
   * §4 — `claude` CLI 자체가 없는 사람을 위한 설치 창구(로그인보다 한 단계 앞).
   * CLI 가 없으면 `claude auth status` 가 spawn 실패라 로그인 팝업이 안 뜬다(판정 불가는 모달로 막지 않는다) — 그래서 "없다"를 1급 상태로 세워 게이트가 뜨게 한다.
   * 값은 `GraphSnapshot.claudeSetup` 으로도 흐른다.
   */
  claudeSetupService.onChange((state) => {
    graphManager.setClaudeSetup(state);
    broadcastSnapshot();
    // 없다 → 쓸 수 있다로 바뀐 순간 CLI 파생 캐시를 다시 태운다 — 안 하면 방금 설치한 사용자가 다음 실행 전까지 로그인 창도 못 본다.
    // 첫 판정(`lastSetupPhase === null`)은 전이가 아니라 기준점이다 — 전이로 세면 CLI 가 깔린 사용자도 매 실행 부팅 직후 캐시를 헛되이 다시 태운다.
    const isFirstJudgement = lastSetupPhase === null;
    const becameReady = !isFirstJudgement && lastSetupPhase !== 'ready' && state.phase === 'ready';
    lastSetupPhase = state.phase;
    if (becameReady) void reprimeClaudeDerivedCaches('setup-ready');
  });

  /**
   * §4 — CLI 에서 파생된 캐시를 다시 태운다(앱을 켠 뒤 CLI 가 새로 깔리거나 갱신되면 "부팅 시 1회" 전제가 깨진다).
   * · `claudeAuth` — spawn 실패는 `error: 'cli-missing'` 로 캐시되고 재조회는 10분 주기다. `LoginWindow` 는 `error` 가 있으면 안 뜨므로, 안 태우면 설치 뒤 로그인 창이 최대 10분 안 뜬다.
   * · `modelRegistry` — 모델 목록·effort 등급을 `claude --help` 에서 긁으므로 CLI 없던 부팅에선 시드만 남는다.
   * 슬래시 내장 명령(`BUILTIN_SLASH_COMMANDS`)은 공개 문서 기반 정적 목록이라 대상이 아니다.
   */
  let lastSetupPhase: string | null = null;
  async function reprimeClaudeDerivedCaches(reason: string): Promise<void> {
    logger.info(`[claude-setup] re-priming CLI-derived caches (${reason})`);
    await Promise.allSettled([
      refreshClaudeAuth(),
      modelRegistryService.refreshIfStale(),
    ]);
    broadcastSnapshot();
  }

  /**
   * §3.6 — 마지막으로 **성공한** 설치 조건(전송 경로·CLI 판올림). 새로 생긴 Cowork 홈에도 같은 조건으로 깐다 —
   * 없으면 HTTP 승격 뒤 열린 Cowork 세션만 옛 command 블록을 받아 세션마다 전송 경로가 갈린다.
   */
  let lastHookInstallOptions: { transport: 'http' | 'command'; cliVersion: string | null } = {
    transport: 'command',
    cliVersion: null,
  };

  /** 지금 훅을 설치해도 되는가 — 되면 그 대상(포트·핸들러·토큰), 아니면 null(불리언이면 호출부의 타입 좁히기가 풀려 `as number` 를 쓰게 된다). */
  function hookInstallTarget(): { port: number; handlerPath: string; token: string } | null {
    const skip = process.env['VIBISUAL_SKIP_HOOK_INSTALL'];
    if (skip === '1' || skip === 'true') return null;
    if (process.env['VIBISUAL_HOME']?.trim()) return null;
    if (hookListenerPort === null || hookListenerToken === null || hookHandlerPath === null) return null;
    return { port: hookListenerPort, handlerPath: hookHandlerPath, token: hookListenerToken };
  }

  /**
   * 새로 나타난 Cowork 세션 홈에 훅을 심고, 이미 심은 홈(호스트 포함)은 **설정 파일이 바뀐 것만** 다시 맞춘다 —
   * 세션 스캔 스윕(10초)이 부른다. 뒤쪽은 §3.6 「수명」 ③ "켜져 있는 동안 지킨다"이다: Claude Code 가 settings.json
   * 을 다시 쓰며 표식을 떨어뜨리거나 우리 블록이 지워져도 10초 안에 돌아온다(그대로면 stat 한 번).
   */
  function installHooksIntoNewCoworkHomesIfReady(): void {
    const t = hookInstallTarget();
    if (!t) return;
    try {
      const n = installHooksIntoNewCoworkHomes(t.port, t.handlerPath, t.token, lastHookInstallOptions);
      if (n > 0) logger.info(`[hooks] cowork: ${n} new session home(s) hooked`);
    } catch (err) {
      logger.warn(`[hooks] cowork install sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const kept = keepVibisualHooksInPlace(t.port, t.handlerPath, t.token, lastHookInstallOptions);
      if (kept.rewritten.length > 0) logger.info(`[hooks] restored hooks in ${kept.rewritten.length} settings home(s) changed by someone else`);
    } catch (err) {
      logger.warn(`[hooks] keep-in-place sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * §3.6 — 훅 전송 경로를 HTTP 로 승격한다. 부팅 최초 설치(desktop main)는 CLI 판올림을 모르므로 command 로 깔고, 판올림을 확인한 뒤 여기서 다시 부른다(인스톨러는 idempotent).
   * 모르는 채 HTTP 훅을 깔지 마라 — 그 `type` 을 모르는 옛 CLI 가 훅을 통째로 버려 이벤트가 0건이 된다(앱이 죽은 것과 구별되지 않는다).
   * 승격되면 순수 전달 이벤트(33종)에서 `handler.mjs` 자식 프로세스가 사라진다.
   */
  async function refreshHookTransport(reason: string): Promise<void> {
    const t = hookInstallTarget();
    if (!t) return;
    try {
      const info = await getClaudeVersionInfo();
      // §4 엔진 다리 — 모드를 실을 수 있는 판인지는 같은 판올림으로 정한다(`--version` 을 두 번 띄우지 않는다).
      engineBridge.noteCliVersion(info.binPath, info.current);
      // §3.6 — 호스트 홈 + Cowork 세션 홈들에 같은 블록을 심는다. Cowork 는 설정 홈이 세션마다
      //   따로라 우리 `~/.claude/settings.json` 을 보지 않는다(#63360) — 그 홈에 심어야 발화한다.
      const all = ensureHooksInstalledEverywhere(t.port, t.handlerPath, t.token, {
        transport: 'http',
        cliVersion: info.current,
      });
      const r = all.host;
      // 요청값을 기억한다(결과값이 아니라) — 홈마다 `allowedHttpHookUrls` 가 다를 수 있어
      //   최종 판정은 각 홈에서 `resolveTransport` 가 다시 내려야 한다.
      if (!r.error) lastHookInstallOptions = { transport: 'http', cliVersion: info.current ?? null };
      if (all.coworkInstalled > 0) {
        logger.info(`[hooks] cowork: ${all.coworkInstalled}/${all.cowork.length} session home(s) updated (${reason})`);
      }
      if (r.error) {
        logger.warn(`[hooks] transport refresh failed (${reason}): ${r.error.message}`);
        return;
      }
      if (r.installed) {
        logger.info(`[hooks] transport=${r.transport} installed (${reason})`);
      } else if (r.transportFallbackReason) {
        logger.info(`[hooks] transport stays 'command' (${reason}) — ${r.transportFallbackReason}`);
      }
    } catch (err) {
      logger.warn(`[hooks] transport refresh error (${reason}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 부팅 직후 1회. 설치 판정(1.2s)보다 뒤에 두어 갓 설치한 실행본의 판올림도 잡히게 한다.
  // §9 「창이 뜬 직후의 메인 스레드」 ② — 창이 보인 뒤 한 칸씩 도는 줄에서도 이 순서는 그대로다.
  deferStartupJob('hook-transport', HOOK_TRANSPORT_REFRESH_DELAY_MS, () => { void refreshHookTransport('boot'); });

  // 자동/수동 업데이트로 실행본이 바뀐 뒤에도 같은 이유로 다시 태운다 — 새 버전이 추가한 모델·
  // effort 등급·슬래시 명령이 "다음 실행부터"가 아니라 그 자리에서 반영되게.
  onClaudeInstallSettled((progress) => {
    if (progress.status === 'done') {
      void reprimeClaudeDerivedCaches('cli-updated');
      // 판올림이 올라가면 HTTP 훅을 쓸 수 있게 됐을 수 있다.
      void refreshHookTransport('cli-updated');
    }
  });
  app.get('/api/claude-setup', (_req, res) => {
    const cached = graphManager.getClaudeSetup();
    if (cached) { res.json(cached); return; }
    void claudeSetupService.refresh()
      .then((state) => res.json(state))
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  app.post('/api/claude-setup/refresh', (_req, res) => {
    void claudeSetupService.refresh()
      .then((state) => res.json(state))
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  /**
   * 게이트의 [설치하기]. 공식 네이티브 인스톨러를 서버가 spawn 하고, 진행은 WS
   * `claude_setup_progress` 로 밀어 준다(REST 는 즉시 현재 진행 상태만 돌려준다).
   * 여러 창에서 눌러도 in-flight 세션 하나를 공유한다.
   */
  app.post('/api/claude-setup/install', (_req, res) => {
    try {
      const progress = claudeSetupService.startInstall();
      res.json({ ok: progress.status !== 'error', progress });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 부팅 직후 1회 판정. 로그인 판정보다 먼저 떠야 게이트 순서(설치 → 로그인)가 뒤집히지 않는다.
  // §9 「창이 뜬 직후의 메인 스레드」 ② — 창이 보인 뒤 한 칸씩 도는 줄에서도 이 순서는 그대로다.
  deferStartupJob('claude-setup', 1_200, () => { void claudeSetupService.refresh().catch(() => {}); });

  /** §5.25 — 코덱스 창구(설치·로그인·모델 목록·훅). 클로드 쪽과 같은 모양 — 상태는 스냅샷으로도 흐르고, REST 는 버튼을 눌렀을 때의 즉시 확인 창구다. */
  function refreshCodexCatalogAfterAuth(invalidate = true): void {
    // login status may omit account ids. Explicit login refresh/logout must still invalidate discovery.
    if (invalidate) codexModelService.invalidate();
    graphManager.setCodexModels({ models: [], checkedAt: Date.now(), stale: true });
    void codexModelService.publish((catalog) => {
      graphManager.setCodexModels(catalog);
      broadcastSnapshot();
    }).catch(() => {});
  }

  async function refreshCodexAuth(forceModels = false): Promise<import('@vibisual/shared').CodexAuthStatus> {
    const before = graphManager.getCodexAuth();
    const status = await codexAuthService.refresh();
    graphManager.setCodexAuth(status);
    // 값이 그대로면 브로드캐스트하지 않는다(폴링이 스냅샷을 흔들지 않게 — 클로드와 같은 규약).
    const changed =
      before === undefined ||
      before.loggedIn !== status.loggedIn ||
      before.error !== status.error ||
      before.authMethod !== status.authMethod ||
      before.account !== status.account;
    // A failed auth probe is unknown, not a new account: keep the last usable catalog.
    // get() detects a changed known identity but retains it across transient unknown probes.
    const explicitLoginRefresh = forceModels && status.loggedIn;
    const refreshModels = !status.error && (explicitLoginRefresh || !codexModelService.get());
    if (refreshModels) refreshCodexCatalogAfterAuth(explicitLoginRefresh);
    if (changed || refreshModels) broadcastSnapshot();
    return status;
  }

  codexSetupService.onChange((state) => {
    graphManager.setCodexSetup(state);
    broadcastSnapshot();
  });

  app.get('/api/codex-setup', (_req, res) => {
    const cached = graphManager.getCodexSetup();
    if (cached) { res.json(cached); return; }
    void codexSetupService.refresh()
      .then((state) => res.json(state))
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  app.post('/api/codex-setup/refresh', (_req, res) => {
    void codexSetupService.refresh()
      .then((state) => res.json(state))
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  app.post('/api/codex-setup/install', (_req, res) => {
    try {
      const progress = codexSetupService.startInstall();
      res.json({ ok: progress.status !== 'error', progress });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/codex-auth', (_req, res) => {
    const cached = graphManager.getCodexAuth();
    if (cached) { res.json(cached); return; }
    void refreshCodexAuth()
      .then((status) => res.json(status))
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  app.post('/api/codex-auth/refresh', (_req, res) => {
    void refreshCodexAuth(true)
      .then((status) => res.json(status))
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  app.post('/api/codex-auth/logout', (_req, res) => {
    void codexAuthService.logout()
      .then((result) => {
        graphManager.setCodexAuth(result.status);
        if (result.ok) refreshCodexCatalogAfterAuth();
        broadcastSnapshot();
        res.json(result);
      })
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  /**
   * §5.25 (M) — 인벤토리를 읽을 프로젝트 폴더. 버블을 주면 그 버블의 프로젝트, 아니면 지금 루트.
   * 폴더를 못 찾으면 `null` — 그때는 홈의 `AGENTS.md` 만 보고 프로젝트 자리는 아예 그리지 않는다.
   */
  const codexInventoryCwd = (agentIdParam: unknown): string | null => {
    const agentId = typeof agentIdParam === 'string' && agentIdParam.trim() ? agentIdParam.trim() : '';
    if (agentId) return graphManager.getProjectPathForAgent(agentId) ?? graphManager.getRoot() ?? null;
    return graphManager.getRoot() ?? null;
  };

  /** §5.25 (G) — 공식 model/list 조회. 일반 읽기는 TTL, 수동 새로고침은 즉시 재조회한다. */
  app.get('/api/codex-models', async (_req, res) => {
    try {
      await codexModelService.publish((catalog) => {
        if (graphManager.getCodexModels() !== catalog) {
          graphManager.setCodexModels(catalog);
          broadcastSnapshot();
        }
        res.json(catalog);
      });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/codex-models/refresh', async (_req, res) => {
    try {
      await codexModelService.publish((catalog) => {
        graphManager.setCodexModels(catalog);
        broadcastSnapshot();
        res.json(catalog);
      }, { force: true });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §4 (상태바 모델 칸 ③) — 클로드 모델 레지스트리 조회. 스냅샷·WS(`model_registry_updated`)가 이미 나르므로 WS 도착 전 빈 화면 방지용이다. */
  app.get('/api/models', (_req, res) => {
    res.json({ ok: true, registry: modelRegistryService.getRegistry() });
  });

  /**
   * §4 (상태바 모델 칸 ③) — 모델 창을 열 때의 "한 번 더 확인". 실행본이 바뀌었으면 강도 등급을 다시
   * 긁고, 키가 있으면 `/v1/models` 를 다시 받는다(하한 안이면 건너뜀). 끝난 레지스트리를 돌려준다 —
   * 내용이 바뀌었으면 서비스 구독이 이미 방송했으므로 여기서 한 번 더 쏘지 않는다.
   */
  app.post('/api/models/refresh', async (_req, res) => {
    try {
      const registry = await modelRegistryService.refreshNow();
      res.json({ ok: true, registry });
    } catch {
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /**
   * §5.25 (M) — 코덱스가 들고 있는 것들(MCP·스킬·플러그인·훅·`AGENTS.md`). **읽기만** 한다.
   *
   * `agentId` 를 주면 그 버블의 프로젝트 폴더에서 `AGENTS.md` 를 찾는다 — 다섯 갈래 중
   * 그것만 프로젝트마다 다르기 때문이다(나머지 넷은 기기 단위).
   */
  app.get('/api/codex-inventory', async (req, res) => {
    try {
      const cwd = codexInventoryCwd(req.query['agentId']);
      const inventory = codexInventoryService.getFor(cwd)
        ?? await codexInventoryService.refresh(cwd, codexHookContext?.handlerPath ?? null);
      graphManager.setCodexInventory(inventory);
      res.json(inventory);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/codex-inventory/refresh', async (req, res) => {
    try {
      const cwd = codexInventoryCwd(req.query['agentId']);
      const inventory = await codexInventoryService.refresh(cwd, codexHookContext?.handlerPath ?? null);
      // 모델 목록과 같은 이유로 스냅샷에도 실어 준다 — 이 목록을 보는 자리가 IDE 말고도 있다.
      graphManager.setCodexInventory(inventory);
      broadcastSnapshot();
      res.json(inventory);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.25 (G-2) — 코덱스가 그 버블의 작업 폴더에서 겹칠 설정 파일들. **읽기만** 한다.
   * 설정 창이 빈 선택지에 "지금 적용되는 값"을 적는 데 쓴다. 폴더를 못 찾으면 홈 기준(프로젝트 겹 없음).
   */
  app.get('/api/codex-config', (req, res) => {
    try {
      const projectPath = req.query['projectPath'];
      const selected = typeof projectPath === 'string' ? Object.values(graphManager.getProjects()).find(project => project.path === projectPath)?.path : undefined;
      if (projectPath !== undefined && !selected) { res.status(400).json({ error: 'Unknown project' }); return; }
      const cwd = req.query['scope'] === 'global' ? os.homedir() : selected ?? codexInventoryCwd(req.query['agentId']) ?? os.homedir();
      res.json(readCodexEffectiveConfigFor(cwd));
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.25 (N) — `codex review`. 검증 칸의 코덱스 대응물이며 **사용자가 누를 때만** 돈다
   * (모델을 부르는 일이라 비용이 사용자 것이다 — §5.5 #17-35 가 검증 자동 실행을 뺀 것과 같은 판단).
   *
   * 기다리지 않고 즉시 답한다 — 몇 분이 걸릴 수 있어, 끝나면 스냅샷으로 알린다.
   */
  app.post('/api/codex-review', (req, res) => {
    const body = req.body as { agentId?: unknown; mode?: unknown; target?: unknown };
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
    if (!agentId) {
      res.status(400).json({ error: 'agentId required' });
      return;
    }
    const cwd = graphManager.getAgentCwdByAgentId(agentId)
      ?? graphManager.getProjectPathForAgent(agentId)
      ?? graphManager.getRoot();
    if (!cwd) {
      res.status(400).json({ error: 'no project folder for this agent' });
      return;
    }
    const rawMode = body.mode;
    const mode: CodexReviewMode = rawMode === 'base' || rawMode === 'commit' ? rawMode : 'uncommitted';
    const target = typeof body.target === 'string' ? body.target : undefined;
    try {
      const run = codexReviewService.start({
        agentId,
        cwd,
        mode,
        ...(target ? { target } : {}),
        ...(((): { permissionMode?: string } => {
          const pm = graphManager.getAgentConfig(agentId)?.permissionMode;
          return pm ? { permissionMode: pm } : {};
        })()),
        onChange: () => {
          graphManager.setCodexReviews(codexReviewService.list());
          broadcastSnapshot();
        },
      });
      graphManager.setCodexReviews(codexReviewService.list());
      broadcastSnapshot();
      res.json(run);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/codex-review', (_req, res) => {
    try {
      res.json({ runs: codexReviewService.list() });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.25 (I) — 코덱스 훅. **기본 꺼짐**이라 사용자가 켤 때만 깔린다.
   * 설치 뒤에도 코덱스 자신의 훅 신뢰 절차가 한 번 더 남아 있으며, 우리는 그것을 우회하지 않는다.
   * §3.6 「수명」 — 끌 때 걷으므로 켜기·끄기는 켬 값(AppState)을 함께 적는다(`setCodexHooksEnabled`).
   */
  app.get('/api/codex-hooks', (_req, res) => {
    try {
      const state = getCodexHookState(codexHookContext?.handlerPath ?? null);
      graphManager.setCodexHooks(state);
      res.json(state);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/codex-hooks/install', (_req, res) => {
    const ctx = codexHookContext;
    if (!ctx) {
      res.status(503).json({ error: 'hook context not ready' });
      return;
    }
    try {
      const state = setCodexHooksEnabled(true, ctx);
      graphManager.setCodexHooks(state);
      broadcastSnapshot();
      res.json(state);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/codex-hooks/uninstall', (_req, res) => {
    const ctx = codexHookContext;
    if (!ctx) {
      res.status(503).json({ error: 'hook context not ready' });
      return;
    }
    try {
      const state = setCodexHooksEnabled(false, ctx);
      graphManager.setCodexHooks(state);
      broadcastSnapshot();
      res.json(state);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // 부팅 직후 1회 판정. 코덱스를 안 쓰는 사용자에게도 돈다 — 우클릭 메뉴가 "준비 안 됨"을
  //   말하려면 판정이 있어야 하고, 판정 자체는 `codex --version` 한 번이라 값이 싸다.
  // §9 「창이 뜬 직후의 메인 스레드」 ② — 창이 보인 뒤 한 칸씩 도는 줄에 세운다.
  deferStartupJob('codex-setup', 2_000, () => {
    void codexSetupService.refresh()
      .then((state) => {
        // 설치돼 있을 때만 로그인·모델·훅까지 본다(없는 CLI 에 세 번 더 묻지 않는다).
        if (state.phase !== 'ready') return;
        void refreshCodexAuth().catch(() => {});
        void codexModelService.publish((catalog) => {
          graphManager.setCodexModels(catalog);
          broadcastSnapshot();
        }).catch(() => { /* 조회 실패는 서비스가 오래된 목록/빈 목록으로 표시한다. */ });
        try {
          graphManager.setCodexHooks(getCodexHookState(codexHookContext?.handlerPath ?? null));
        } catch { /* 훅 파일 없음은 정상 */ }
      })
      .catch(() => {});
  });

  /**
   * §4 — 앱을 켤 때 1회 CLI 를 최신으로 맞춘다(기본 켬). 설치·로그인 판정보다 뒤에 둔다(안 깔린 사람은 설치 온보딩이 먼저, 갓 설치한 실행본은 이미 최신). 실패해도 기동엔 무관.
   * 앱 자동 업데이트(electron-updater, 항상 자동)와는 별개 축이다.
   */
  // §4 (앱 전용 엔진) — 같은 자리에서 코덱스 앱 전용 사본도 맞추고, 켜 둔 동안 6시간마다 두 엔진을 다시 본다.
  //   판을 바꾸는 권한이 앱에 있어(점검 통과 후 전환) 새 모델이 최신 CLI 를 요구해도 다음 실행까지 기다리지 않는다.
  //   각 엔진의 판단(스위치 · 그 엔진을 쓰는 PC 인가 · 이미 최신인가)은 그 서비스가 한다.
  const runEngineAutoUpdate = (engine: 'claude' | 'codex', when: 'boot' | 'periodic' | 'retry'): void => {
    const run = engine === 'claude' ? autoUpdateClaudeIfEnabled() : codexSetupService.autoUpdateIfEnabled();
    void run
      .then((r) => {
        if (!r.started && r.reason && r.reason !== 'up-to-date') {
          logger.info(`[${engine === 'claude' ? 'claudeVersionService' : 'codexSetup'}] auto-update skipped (${r.reason}, ${when})`);
        }
      })
      .catch(() => {});
  };
  const runEngineAutoUpdates = (when: 'boot' | 'periodic'): void => {
    runEngineAutoUpdate('claude', when);
    runEngineAutoUpdate('codex', when);
  };
  setTimeout(() => runEngineAutoUpdates('boot'), CLAUDE_AUTO_UPDATE_BOOT_DELAY_MS);
  managedEngineService.startPeriodic(() => runEngineAutoUpdates('periodic'));
  // 받기가 오류로 끝나면 6시간을 기다리지 않고 짧게 다시 해 본다(5분 → 15분 → 60분). 다시 할 때도 같은 판단을 탄다 —
  //   스위치를 껐거나 그 사이 최신이 깔렸으면 아무것도 하지 않는다.
  managedEngineService.setRetryHandler((engine) => runEngineAutoUpdate(engine, 'retry'));

  // 앱 전용 판이 바뀌거나(받기 끝 · 되돌리기) 받기가 시작 · 끝나면, 그 엔진의 판정을 다시 돌려 화면 상태
  //   (`codexSetup.managed` · `claudeSetup` 의 판)를 맞춘다. 받는 도중에는 다시 묻지 않는다(판은 아직 그대로다).
  managedEngineService.onChange((engine) => {
    if (managedEngineService.status(engine).updating) return;
    if (engine === 'codex') void codexSetupService.refresh().catch(() => {});
    else void claudeSetupService.refresh().catch(() => {});
  });

  /**
   * §4 (앱 전용 엔진) ⑦ — Version 탭 [이전 판으로]. 지금 판에 되돌림 표식을 달고 바로 앞 판을 쓴다(다음 스폰부터).
   * 렌더러 IPC 전용이다 — 루프백 리스너 화이트리스트에 없으므로 바깥 프로세스(에이전트)는 엔진 판을 바꿀 수 없다.
   */
  app.post('/api/managed-engines/:engine/rollback', (req, res) => {
    const engine = req.params.engine;
    if (engine !== 'claude' && engine !== 'codex') {
      res.status(400).json({ error: 'unknown engine' });
      return;
    }
    void managedEngineService.rollback(engine)
      .then((result) => {
        if (result.ok && engine === 'claude') {
          // 판이 바뀌면 그 판에서 나온 캐시(모델 · effort · 로그인 판정)와 훅 전송 방식도 다시 맞춘다.
          void reprimeClaudeDerivedCaches('cli-rollback');
          void refreshHookTransport('cli-updated');
        }
        res.status(result.ok ? 200 : 409).json(result);
      })
      .catch(() => res.status(500).json({ error: 'Internal server error' }));
  });

  /** §3.2.4 H축 — 힙 표본 + 캐시 점유 진단. 읽기 전용이라 언제 불러도 안전하다. */
  app.get('/api/diagnostics/memory', (_req, res) => {
    try {
      res.json(getMemoryDiagnostics());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // §3.2.4 H·I축 — 주기 표본 + 압력 대응 시작. 실패해도 기동엔 영향이 없다(계측일 뿐).
  try {
    startMemoryMonitor();
  } catch (err) {
    logger.warn(`memoryMonitor start failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  /**
   * §4 — 사용량 수집기(statusLine) 상태 / opt-in 토글. 한도 사용률은 statusLine stdin JSON 으로만 나와, `~/.claude/settings.json` `statusLine` 에
   * 우리 핸들러가 걸려야 `/api/rate-limits` 가 찬다. 훅(§3.6)과 달리 자동 설치하지 않는다 — 사용량 팝업 스위치로만.
   * GET → UsageCollectorStatus · POST { enable: boolean } → 설치/해제 후 UsageCollectorStatus
   */
  app.get('/api/usage-collector', (_req, res) => {
    try {
      res.json(readUsageCollectorStatus());
    } catch (err) {
      logger.error('GET /api/usage-collector failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/usage-collector', (req, res) => {
    try {
      const body = req.body as { enable?: unknown } | null;
      const enable = body?.enable === true;
      if (!enable) {
        // §3.6 「수명」 — 켬 여부를 함께 적는다(끌 때 상태 줄을 걷으므로 파일만으로는 다음 부팅이 알 수 없다).
        res.json(setUsageCollectorEnabled(false, null));
        return;
      }
      if (hookListenerPort === null || hookListenerToken === null || hookHandlerPath === null) {
        res.status(503).json({
          error: 'Hook listener is not ready yet — statusLine cannot be installed',
        });
        return;
      }
      res.json(setUsageCollectorEnabled(true, { port: hookListenerPort, handlerPath: hookHandlerPath, token: hookListenerToken }));
    } catch (err) {
      logger.error('POST /api/usage-collector failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/refresh-servers', async (_req, res) => {
    try {
      const servers = graphManager.getRunningServers();
      await Promise.all(
        servers.map(async (s) => {
          s.alive = s.port ? await isPortAlive(s.port) : false;
        }),
      );
      // §7.11 — 죽은 ServerEntry 를 즉시 제거하지 않는다. iframe 위성이 살아 있는 동안(고정핀 / grace 이내) 매칭 entry 가 남아야
      // IframeServerCard 의 Start/Restart 가 동작한다. 정리는 위성 grace 제거(checkIframesAlive)가 위성과 함께 한다.
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ servers: graphManager.getRunningServers() });
    } catch (err) {
      logger.error('POST /api/refresh-servers failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/iframe-tab-check?project=&satellite=&url= — §7.11 / §3.5 열어 둔 프리뷰 탭이 그 주소를 지금
   * 보여 줘도 되는가(`IframeTabVerdict`). 탭은 프로젝트 탭과 상관없이 공유되고 스냅샷은 구독한 프로젝트만
   * 실어서, 탭이 화면을 불러오기 직전(그리고 떠 있는 동안)에 서버에 직접 묻는다. 판정 불가는 `show`.
   */
  app.get('/api/iframe-tab-check', async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const url = typeof q['url'] === 'string' ? q['url'] : '';
    if (!url) {
      res.status(400).json({ error: 'url required' });
      return;
    }
    const project = typeof q['project'] === 'string' && q['project'] ? q['project'] : null;
    const satellite = typeof q['satellite'] === 'string' && q['satellite'] ? q['satellite'] : null;
    try {
      res.json(await graphManager.checkIframeTab(project, satellite, url));
    } catch (err) {
      logger.error('GET /api/iframe-tab-check failed', err);
      res.json({ action: 'show' });
    }
  });

  app.post('/api/stop-server', async (req, res) => {
    try {
      const { id } = req.body as { id?: string };
      if (typeof id !== 'string') {
        res.status(400).json({ error: 'id required' });
        return;
      }
      const servers = graphManager.getRunningServers();
      const target = servers.find((s) => s.id === id);
      if (!target || !target.port) {
        target && (target.alive = false);
        if (target) graphManager.markIframeStoppedByServerId(id);
        broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
        res.json({ killed: false, servers: graphManager.getRunningServers() });
        return;
      }
      // §7.11 / §3.5 — 그 서버의 주소가 **닿는 리스너만** 죽인다. 한 포트에 주인이 둘이면(옆 프로젝트
      // vite 가 `[::1]`, 우리 서버가 `::`) 포트 전체를 죽이면 남의 프로젝트 서버까지 내려간다.
      // 닿는 리스너가 다른 열린 프로젝트의 것이면 아예 죽이지 않는다.
      const scope = await graphManager.serverControlScope(id);
      if (scope?.foreign) {
        logger.warn(`Stop refused (port ${target.port}): the listener belongs to another open project`);
        res.json({ killed: false, refused: 'foreign', servers: graphManager.getRunningServers() });
        return;
      }
      // §7.11 포트 인계 — 죽이기 **전에** 기동 명령을 넘겨받는다. 프로세스가 사라지면 OS 어디에도
      // 그 명령이 남지 않아 Start 가 영영 못 열린다. 신고 시점 인계가 이미 성공했으면 no-op.
      if (target.reportedOnly) await graphManager.takeoverServerEntry(id);
      const killed = await killByPort(target.port, scope?.host ? { host: scope.host } : {});
      target.alive = false;
      // §7.11 — 매칭 iframe 위성 iframeAlive=false 즉시 반영(5초 스윕 대기 없이 active→idle)
      graphManager.markIframeStoppedByServerId(id);
      // §7.11 — 여기서 죽은 entry 를 지우지 않는다: iframe 위성(고정핀/grace)이 살아 있는 한 남아야 Start/Restart 의 serverId 매칭이 동작한다.
      logger.info(`Stop server port=${target.port} killed=${killed}`);
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ killed, servers: graphManager.getRunningServers() });
    } catch (err) {
      logger.error('POST /api/stop-server failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/restart-server', async (req, res) => {
    try {
      const { id } = req.body as { id?: string };
      if (typeof id !== 'string') {
        res.status(400).json({ error: 'id required' });
        return;
      }
      const servers = graphManager.getRunningServers();
      const target = servers.find((s) => s.id === id);
      if (!target) {
        res.status(404).json({ error: 'server not found' });
        return;
      }
      // §7.11 / §3.5 — 그 서버의 주소가 닿는 리스너가 다른 열린 프로젝트의 것이면 죽이지도 넘겨받지도
      // 않는다(남의 서버를 내리고 우리 명령을 그 포트에 띄우는 사고). 죽일 때도 그 주소의 리스너만.
      const scope = await graphManager.serverControlScope(id);
      if (scope?.foreign) {
        logger.warn(`Restart refused (port ${String(target.port ?? '?')}): the listener belongs to another open project`);
        res.status(409).json({ error: 'port held by another project', refused: 'foreign' });
        return;
      }
      // §7.11 포트 인계 — 에이전트가 켠 서버를 여기서 넘겨받는다. 신고 전용 entry 는 기동 명령을 모르지만, 그 프로세스가 살아 있다면
      // OS 프로세스 테이블에 명령이 그대로 있다. 읽어 내면 그때부터 우리 서버처럼 껐다 켤 수 있다.
      if (target.reportedOnly) await graphManager.takeoverServerEntry(id);
      // 인계에 실패했을 때만 거절한다. 여기서 kill 부터 하면 respawn 이 불가능해
      // 사용자의 서버만 죽는다 — kill 없이 거절한다(클라도 버튼 disabled).
      if (target.reportedOnly) {
        logger.warn(`Restart refused (port ${String(target.port ?? '?')}): takeover failed — start command unreadable`);
        // 인계 실패 표식(`takeoverFailed`)을 화면까지 흘려보낸다 — 안 보내면 버튼은 열려 있는데
        // 눌러도 아무 일이 없는 채로 남아 사용자가 이유를 알 길이 없다.
        broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
        res.status(409).json({ error: 'command unknown (takeover failed)', takeoverFailed: true });
        return;
      }
      // kill — 그 주소가 닿는 리스너만(§7.11 / §3.5 — 같은 포트의 다른 주인은 건드리지 않는다)
      if (target.port) await killByPort(target.port, scope?.host ? { host: scope.host } : {});
      // §7.11 — respawn cwd 는 포트 인계로 알아낸 그 프로세스의 실제 cwd → owning session 의 cwd 순이다.
      // 없으면 `node my-server.js` 같은 명령이 파일을 못 찾고 즉시 죽는다(하위 폴더에서 띄운 서버는 세션 cwd 로도 못 찾는다). windowsHide 는 respawn 내부에서 처리.
      const owner = graphManager.findServerOwnerSession(id);
      respawn(target.command, target.cwd ?? owner?.cwd);
      target.startedAt = Date.now();
      target.alive = true;
      // §7.11 — respawn 직후 매칭 iframe 위성의 owning-shell 을 끊는다. 우리 detached child 는 Claude JSONL 에 active 로 기록되지 않아,
      // 남겨 두면 owning-shell 검사가 늘 false → 포트가 살아도 idle 로 굳는다.
      graphManager.noteIframeRespawnedByServerId(id);
      logger.info(`Restart server port=${target.port ?? '?'} cwd="${owner?.cwd ?? '(default)'}" cmd="${target.command}"`);
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();

      // §7.11 — 5초 정기 sweep 외에 0.5s / 1.5s / 3s 추가 probe 로 빨리 수렴한다(listen 시점: Vite ~1s, python http.server 즉시, 무거운 node 2-3s).
      // fire-and-forget — 응답을 늦추지 않는다.
      for (const delayMs of [500, 1500, 3000]) {
        setTimeout(() => {
          void graphManager.checkIframesAlive().then((changed) => {
            if (changed) broadcastSnapshot();
          });
        }, delayMs);
      }

      res.json({ servers: graphManager.getRunningServers() });
    } catch (err) {
      logger.error('POST /api/restart-server failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * 열기 계열 엔드포인트 공용 경계 검사 — resolved 절대경로가 등록된 프로젝트 루트(또는 extraRoots 로 명시 허용한 디렉토리) 안인지 본다.
   * renderer IPC 는 신뢰되지만 opt-in 모바일 리스너로 페어링된 기기도 이 라우트에 닿는다 — 임의 절대경로가 에디터·탐색기로 열리지 않게 막는다.
   */
  function isWithinOpenableRoots(resolved: string, extraRoots: string[] = []): boolean {
    const roots: string[] = [];
    for (const r of extraRoots) roots.push(path.resolve(r));
    const primaryRoot = graphManager.getRoot();
    if (primaryRoot) roots.push(path.resolve(primaryRoot));
    for (const proj of Object.values(graphManager.getProjects())) {
      roots.push(path.resolve(proj.path));
    }
    // 대소문자는 그 플랫폼이 실제로 무시할 때만 접는다 — win32 만 보면 mac(APFS)에서 같은 폴더의 열기가 거절되고, linux 에서 접으면 남의 폴더가 통과한다.
    const rKey = pathKey(resolved);
    return roots.some((r) => {
      const rootKey = pathKey(r);
      return rKey === rootKey || rKey.startsWith(rootKey + '/');
    });
  }

  /** POST /api/open-in-editor — 절대 경로 + searchText로 에디터에서 열기 */
  app.post('/api/open-in-editor', (req, res) => {
    try {
      const { filePath, searchText } = req.body as { filePath?: string; searchText?: string };
      if (typeof filePath !== 'string') {
        res.status(400).json({ error: 'filePath required' });
        return;
      }

      // 절대경로 정규화 후 프로젝트 루트 내부인지 확인 (Windows 대소문자 무시)
      const resolved = path.resolve(filePath);
      if (!isWithinOpenableRoots(resolved)) {
        logger.warn(`Path traversal blocked: filePath="${filePath}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      openFileAtSearch(resolved, searchText);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`POST /api/open-in-editor failed: ${msg}`, err);
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/open-node-file — 노드 키로 파일 열기 (에디터).
   *  client가 absolutePath를 함께 보내면 그걸 우선 사용 — 프로젝트 컨텍스트 소실로 타 프로젝트 파일이 열리는 것 방지. */
  app.post('/api/open-node-file', (req, res) => {
    try {
      const { nodePath, absolutePath } = req.body as { nodePath?: string; absolutePath?: string | null };
      if (typeof nodePath !== 'string') {
        res.status(400).json({ error: 'nodePath required' });
        return;
      }
      const absPath = (typeof absolutePath === 'string' && absolutePath.length > 0)
        ? absolutePath
        : graphManager.resolveAbsolutePath(nodePath);
      if (!absPath) {
        res.status(404).json({ error: 'Cannot resolve absolute path' });
        return;
      }

      // 프로젝트 루트 안이거나, 루트 밖이라도 지금 버블로 그리고 있는 노드의 경로면 허용한다(§2.1 #5 — external_folder 와 그 위성은 정의상 루트 밖이다).
      // 화면에 없는 임의 절대경로는 막는다 — 페어링된 모바일 기기도 이 라우트에 닿는다.
      const resolved = path.resolve(absPath);
      if (!isWithinOpenableRoots(resolved) && !graphManager.hasNodeAbsolutePath(resolved)) {
        logger.warn(`open-node-file blocked (not a project root / known bubble path): "${absPath}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      openFile(resolved);
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/open-node-file failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/open-node-folder — 노드 키로 폴더 열기 / 파일 위치에서 선택 (탐색기).
   *  client가 absolutePath를 함께 보내면 그걸 우선 사용 (프로젝트 컨텍스트 보존). */
  app.post('/api/open-node-folder', (req, res) => {
    try {
      const { nodePath, absolutePath } = req.body as { nodePath?: string; absolutePath?: string | null };
      if (typeof nodePath !== 'string') {
        res.status(400).json({ error: 'nodePath required' });
        return;
      }
      const absPath = (typeof absolutePath === 'string' && absolutePath.length > 0)
        ? absolutePath
        : graphManager.resolveAbsolutePath(nodePath);
      if (!absPath) {
        res.status(404).json({ error: 'Cannot resolve absolute path' });
        return;
      }

      // 프로젝트 루트 안이거나, 루트 밖이라도 지금 버블로 그리고 있는 노드의 경로면 허용한다(§2.1 #5 — 외부 폴더를 OS 탐색기로 연다).
      // 화면에 없는 임의 절대경로는 막는다 — 페어링된 모바일 기기도 이 라우트에 닿는다.
      const resolved = path.resolve(absPath);
      if (!isWithinOpenableRoots(resolved) && !graphManager.hasNodeAbsolutePath(resolved)) {
        logger.warn(`open-node-folder blocked (not a project root / known bubble path): "${absPath}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      openFolder(resolved);
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/open-node-folder failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── 명령 대기열 API ───

  /** sessionId → 대기 명령 배열 (queued/executing만) */
  const commandQueues = new Map<string, QueuedCommand[]>();

  /** sessionId → 완료/에러 명령 아카이브 (Results 표시용) */
  const completedCommandArchive = new Map<string, QueuedCommand[]>();

  /**
   * §5.3 #12-4 — 이 탭에서 **지금 도는** 명령. 검증 권한은 이 명령에 찍힌 범위뿐이라, 명령이 끝나면
   * 여기서 못 찾게 되고 그대로 만료된다(다음 명령으로 승계 ❌). 큐는 훅 세션 id 키라 탭 id 로 훑는다.
   */
  function findExecutingCommandForSub(subAgentId: string): QueuedCommand | undefined {
    for (const queue of commandQueues.values()) {
      const cmd = queue.find((c) => c.status === 'executing' && c.subAgentId === subAgentId);
      if (cmd) return cmd;
    }
    return undefined;
  }

  /** §5.3 #12-4 — 아직 큐에 있거나 이미 끝난 명령까지 id 로 찾는다(위임·킥오프가 보낸 쪽 범위를 물려받을 때). */
  function findCommandById(commandId: string): QueuedCommand | undefined {
    for (const queue of commandQueues.values()) {
      const cmd = queue.find((c) => c.id === commandId);
      if (cmd) return cmd;
    }
    for (const archive of completedCommandArchive.values()) {
      const cmd = archive.find((c) => c.id === commandId);
      if (cmd) return cmd;
    }
    return undefined;
  }

  /**
   * §5.3 #12-4 (J) — 실행 전 차단이 켜져 있는가(옵션창 권한 탭, 기본 끔). 판정 객체·정책 문단·코덱스 훅 필수
   * 여부·호스팅 도구 끄기가 이 답 하나를 본다. 호출마다 읽으므로 [적용] 뒤 다음 도구 호출부터 따라간다.
   */
  function verificationGateOn(): boolean {
    return isVerificationGateEnabled(userDefaultsService.get());
  }

  /** §5.3 #12-4 — 실행 전 검증 판정 한 벌. 승인 창구 다섯이 이 객체를 부른다. */
  const verificationGate = new VerificationGate({ findExecutingCommand: findExecutingCommandForSub, isEnforced: verificationGateOn });

  /**
   * §5.3 #12-4 (D) — 이 세션이 Auto Agent 하네스의 멤버면, 그 하네스를 부른 가장 최근 빌더 명령(사람이 친 본문 그대로).
   * 하네스의 검증 런이 열려 있을 때만 찾는다 — 런이 닫혔으면 물려줄 것이 없다.
   */
  function findAutoAgentBuilderCommandFor(memberSessionId: string): QueuedCommand | undefined {
    for (const [autoAgentId, summary] of Object.entries(graphManager.getAutoAgentSummaries())) {
      if (!summary?.spawnedAgentIds?.includes(memberSessionId)) continue;
      if (!graphManager.getActiveAutoAgentRun(autoAgentId)) continue;
      const cmds = [...(commandQueues.get(autoAgentId) ?? []), ...(completedCommandArchive.get(autoAgentId) ?? [])];
      let latest: QueuedCommand | undefined;
      for (const c of cmds) if (!c.silent && (!latest || c.timestamp > latest.timestamp)) latest = c;
      return latest;
    }
    return undefined;
  }

  /**
   * §3.2.3 — 완료 명령(사용자 말풍선)을 아카이브에 넣는 유일한 창구 — 직접 `archive.push` 하지 마라(상한 검사가 여기만 있다).
   * 넘치면 오래된 것부터(배열 앞) 버린다. 설정값 `0` 이면 무제한.
   */
  function archiveCompletedCommands(sessionId: string, cmds: QueuedCommand[]): void {
    if (cmds.length === 0) return;
    // §5.3 #9-1 (P) — 이 아카이브는 **사용자 말풍선**이다. 우리가 끼운 조용한 압축은 사용자가
    //   넣은 적이 없으므로 여기 들어오지 않는다 — 화면에서 거르는 것보다 아예 안 쌓는 쪽이
    //   맞다(안 그러면 보이지도 않는 줄이 말풍선 상한을 먹어 진짜 대화가 앞에서 잘린다).
    const visible = cmds.filter((c) => !c.silent);
    if (visible.length === 0) return;
    let archive = completedCommandArchive.get(sessionId);
    if (!archive) { archive = []; completedCommandArchive.set(sessionId, archive); }
    archive.push(...visible);
    const cap = appStateGetRetention().completedCommandMaxPerSession;
    if (cap > 0 && archive.length > cap) archive.splice(0, archive.length - cap);
  }

  /** sessionId → 최근 pop된 명령 메타 (buildAgentEvents에서 source 매칭용) */
  interface PoppedCommand { text: string; queuedAt: number; poppedAt: number }
  const poppedCommands = new Map<string, PoppedCommand[]>();


  // ─── SubAgent 명령 실행 ───

  /**
   * 엣지의 타겟이 실제로 위임을 수행할 수 있는가.
   *  저장된 `AgentConfig.tools === []` 는 "모든 도구 제거"라 skip, cfg 가 undefined(저장된 적 없음)면 CLI 기본 툴셋 상속이라 skip 아님.
   */
  function isEdgeTargetViable(edgeTargetAgentId: string): boolean {
    return hasUsableTools(graphManager.getAgentConfig(edgeTargetAgentId));
  }

  /** §5.3 #12 — **대칭 viability.** 타겟만 보던 판정에 소스를 더한다. 소스 `tools` 가 명시적
   *  빈 배열이면 dispatch curl 조차 못 돌리므로 그 엣지는 박탈에도 안내에도 실리면 안 된다
   *  (타겟이 빈 배열이면 무효로 보던 것과 같은 이유 — 한쪽만 보면 비대칭이다). */
  function isTaskEdgeViable(edge: TaskEdge): boolean {
    if (!isEdgeTargetViable(edge.targetAgentId)) return false;
    return hasUsableTools(graphManager.getAgentConfig(edge.sourceAgentId));
  }

  /**
   * outbound Task Edge 자동 rules 섹션 — 스폰 직전 런타임 조회로 그 에이전트의 outbound 엣지 목록을 markdown 블록으로 조립한다.
   *  엣지 0개면 빈 문자열. 엣지 변경은 다음 호출에 반영된다. 타겟 도구가 빈 배열인 엣지는 viability 필터로 뺀다(삭제와 같다).
   */
  function buildOutboundEdgesRulesSection(agentId: string): string {
    const allOutbound = graphManager.getOutboundTaskEdges(agentId);
    const outbound = allOutbound.filter((e) => isTaskEdgeViable(e));
    // §5.3 #12 — 나가는 엣지가 있는데 전부 무효면 **빈 문자열로 삼키지 않는다.** 안내가 통째로
    //   사라지면 모델은 위임 경로가 있다는 사실조차 모른 채 혼자 하겠다고 턴을 끝낸다.
    if (outbound.length === 0) {
      if (allOutbound.length === 0) return '';
      return [
        '', '', '# 연결된 위임 엣지 (자동)', '',
        `연결된 엣지 ${allOutbound.length}개가 전부 **사용 불가** 상태입니다 — 양끝 중 한쪽의 도구 목록이 비어 있습니다. 이 턴에는 위임할 수 없으니 직접 처리하고, 사용자에게 두 에이전트의 Tools 설정을 확인해 달라고 알리세요.`,
      ].join('\n');
    }
    // §5.3 #12 — 배지는 실제 집행 결과를 따라간다(박탈이 안전선에 걸려 취소됐을 수 있다).
    const stripDecision = computeDelegationStripDecision(agentId);
    const allAgents = graphManager.getSnapshot().agents;
    // §3.7 — dispatch curl 은 외부 `claude` 프로세스가 실행하므로 hook loopback 리스너 포트(setHookListenerPort 주입)를 쓴다.
    // DEFAULT_PORT(4800)를 쓰지 마라 — listen 소켓이 없어 connection refused. 미주입 시 port 폴백(통합 모델에선 부팅 때 늘 주입된다).
    const serverBase = `http://127.0.0.1:${hookListenerPort ?? port}`;

    // 엣지별 policy — 같은 소스라도 엣지마다 다를 수 있어 엣지 목록에 각각 Policy 태그를 단다.
    const lines: string[] = [
      '',
      '',
      '# 연결된 위임 엣지 (자동)',
      '',
      '각 엣지마다 **Policy** 가 독립 설정됩니다:',
      '- **STRICT**: 이 엣지의 "용도" 와 매칭되는 작업은 **반드시 이 엣지로 위임**. 소스가 자체 Read/Grep/Glob 등으로 처리 **금지**. 예외는 타겟에 없는 도구(예: Write)가 꼭 필요한 경우만.',
      '- **AUTO**: 이 엣지는 **소스 판단 시 위임**. 탐색 3회+ 예상 / 용도 명확 매칭 / 더 적합한 타겟 모델일 때만. 간단 1~2회 Read 는 자체 처리 허용.',
      '',
      '## 호출 프로토콜 (전 언어 공통 — Bash heredoc, 파일 금지)',
      'instruction **원문을 그대로** heredoc 본문에 넣어 stdin 으로 보낸다. **JSON 손조립·escape 일절 없음** — `edgeId` 는 URL 쿼리로, instruction 은 raw 본문 전체로 서버가 받는다. 한글·일본어·중국어·아랍어·이모지·싱글쿼트·백슬래시·따옴표·여러 줄 전부 escape 없이 안전. **절대 파일로 쓰지 말 것** — `.tmp-*` 등 임시 파일 생성·`Write` 후 `--data @file` 우회 금지. heredoc stdin 만 사용(동시 dispatch 시 디스크 레이스 없음).',
      '',
      '```bash',
      `curl -s -X POST "\${${AGENT_CARD_ENV_BASE}:-${serverBase}}/api/task-edges/dispatch?edgeId=<id>" \\`,
      `  -H "x-vibisual-hook-token: \$${AGENT_CARD_ENV_TOKEN}" \\`,
      // §5.3 #10-2 — 이 턴(세션)에 결과를 묶는 표식. 결과를 받기 전에 턴이 완료로 끝나지 않게 서버가 이 id 로 묶는다.
      '  -H "x-vibisual-source-subagent: $VIBISUAL_SUBAGENT_ID" \\',
      '  -H \'Content-Type: text/plain; charset=utf-8\' \\',
      '  --data-binary @- <<\'VIBISUAL_EDGE_PAYLOAD_EOF\'',
      '<instruction 전문 — 그대로 붙여넣기, JSON·쉘 escape 불필요, 여러 줄 OK>',
      'VIBISUAL_EDGE_PAYLOAD_EOF',
      '```',
      '',
      `**인증 필수**: 위 \`x-vibisual-hook-token\` 헤더가 없으면 401 이다. 값은 환경변수 \`${AGENT_CARD_ENV_TOKEN}\` 에 이미 들어 있으니 위 예시를 그대로 쓰면 된다(카드 5경로와 같은 규약).`,
      '',
      // §5.3 #10-2 — 결과를 돌려받는 엣지에서 진행 중 응답은 "접수됨"이지 결과가 아니다. 다시 부르면 같은 일이 두 번 돈다.
      `**결과를 기다리던 응답이 \`"pending":true\`(202 \`timedOut\` 포함)이면**: 작업은 계속 돈다. 같은 일을 다시 dispatch 하지 말고 \`curl -s -H "x-vibisual-hook-token: \$${AGENT_CARD_ENV_TOKEN}" "\${${AGENT_CARD_ENV_BASE}:-${serverBase}}<statusUrl>&waitMs=60000"\` 를 status 가 completed·error·cancelled 가 될 때까지 되풀이한다. 결과를 받지 않고 끝낸 턴은 실패로 기록된다.`,
      '',
      // §5.3 #10-2 위임 조회 — 권한은 명시한 목록으로만 건너간다. 헤더 없이 "확인해 달라"고만 맡기면 대상은 403 이다.
      '**이미 띄운 작업의 결과 확인을 맡길 때**: 위 curl 에 `-H "x-vibisual-source-agent: $VIBISUAL_PARENT_AGENT_ID" -H "x-vibisual-status-cmd-ids: <cmdId>[,<cmdId>]"` 를 더한다. 대상은 이 위임이 도는 동안 그 cmdId 만 조회할 수 있다(취소 ❌). 이 헤더 없이 맡기면 대상의 조회는 403 이다.',
      '',
      '주의: `<id>` 자리에 아래 목록의 edgeId 를 그대로 넣는다(URL-safe, 인코딩 불필요). delimiter 는 싱글쿼트로 감싼 `<<\'VIBISUAL_EDGE_PAYLOAD_EOF\'` 형태 유지(쉘 변수·백틱 치환 차단). instruction 본문에 `VIBISUAL_EDGE_PAYLOAD_EOF` 가 한 줄로 등장할 가능성이 있으면 delimiter 만 다른 이름으로 변경. (기존 `{"edgeId":..,"instruction":..}` JSON 본문 방식도 서버가 후방호환 수용하지만, 신규 호출은 escape 불가능한 위 raw 방식만 쓴다.)',
      '',
      '## 엣지 목록',
    ];
    for (const edge of outbound) {
      const target = allAgents.find((a) => a.id === edge.targetAgentId);
      const cfg = graphManager.getAgentConfig(edge.targetAgentId);
      const targetLabel = target?.label ?? edge.targetAgentId;
      const modelStr = cfg?.provider?.kind === 'codex-cli' ? cfg.provider.modelId : cfg?.model ?? 'unknown';
      const toolsStr = cfg?.tools && cfg.tools.length > 0 ? cfg.tools.join(', ') : 'default';
      const returnFmt = edge.returnFormat ?? 'summary';
      // §5.3 #12 — **표시 = 집행.** 배지를 저장된 `delegationPolicy` 에서 뽑던 것을 strip 이 읽는
      //   것과 같은 해석 함수로 옮긴다. policy=auto + commandMode=tool-delegation 엣지가
      //   "판단 위임"으로 표시되면서 실제로는 도구가 걷히던 어긋남이 여기서 없어진다.
      const policy = resolveEffectiveDelegationPolicy(edge);
      const policyBadge = policy === 'strict' ? '**[Policy=STRICT — 의무 위임]**' : '**[Policy=AUTO — 판단 위임]**';
      // commandMode(kind='command' 한정) 안내 — mode-delegation 이면 도구를 갖고 있어도 이 작업은 반드시 위임해야 함을 명시한다.
      const cmdMode = resolveEdgeCommandMode(edge);
      // 박탈이 안전선에 걸려 취소됐으면 "박탈됨"이라고 말하지 않는다 — 있지도 않은 제약을 믿고
      //   모델이 제 도구를 안 쓰게 된다(그 상태가 곧 "계획만 말하고 끝나는 턴"이다).
      const stripApplied = stripDecision.applied && stripDecision.strippingEdgeIds.includes(edge.id);
      const cmdModeBadge = cmdMode === 'tool-delegation'
        ? (stripApplied
          ? '**[Mode=TOOL-DELEGATION — 부모에서 도구 박탈됨, dispatch 만 가능]**'
          : '**[Mode=TOOL-DELEGATION — 위임 의무는 유지, 단 이번 턴 도구 박탈은 미적용(박탈하면 부모에게 남는 도구가 없어짐)]**')
        : cmdMode === 'mode-delegation'
          ? '**[Mode=MODE-DELEGATION — 도구는 공유되지만 이 작업은 반드시 위임할 것]**'
          : cmdMode === 'shared'
            ? '**[Mode=SHARED — 자체 처리 또는 위임 자유]**'
            : '';
      const artifact = graphManager.getBundleArtifact(edge.id);
      const waitNote = artifact
        ? '결과를 기다려 반환받습니다 (동기).'
        : '즉시 dispatched 로만 반환되고 결과는 따로 전달되지 않습니다 (비동기).';
      lines.push(`- **→ ${targetLabel}** ${policyBadge}${cmdModeBadge ? ' ' + cmdModeBadge : ''} (model: ${modelStr}, tools: ${toolsStr})`);
      lines.push(`  - 용도: ${edge.command || '(미기재)'}`);
      lines.push(`  - returnFormat: ${returnFmt} — ${waitNote}`);
      // messageSchema 가 있으면 발신 본문(instruction) 양식을 강제한다. messageFormat='free' 거나 빈 값이면 생략.
      if (edge.messageFormat === 'schema' && edge.messageSchema && edge.messageSchema.trim().length > 0) {
        lines.push(`  - **메시지 스키마 (필수)**: 이 엣지로 보낼 때 \`instruction\` 본문은 아래 양식을 따르세요:`);
        lines.push('    ```');
        for (const sline of edge.messageSchema.split('\n')) lines.push(`    ${sline}`);
        lines.push('    ```');
      }
      lines.push(`  - edgeId: \`${edge.id}\``);
    }
    return lines.join('\n');
  }

  /**
   * 박탈 모드 outbound 엣지 기반 tools strip 결정. 후보 = 박탈 모드 엣지 타겟들의 agentConfig.tools 합집합(매 턴 재계산 — 엣지 삭제·모드 전환은 다음 턴에 반영).
   *  박탈 모드가 아닌 엣지는 도구를 바꾸지 않는다(프롬프트 권고만). 양끝 도구가 빈 엣지는 `isTaskEdgeViable` 로 skip.
   *  박탈 여부는 `commandMode` 이고 해석은 `resolveEdgeCommandMode` 한 곳에만 있다(프롬프트 배지도 같은 함수).
   *  §5.3 #12 — 안전선 둘은 `computeDelegationStrip` 안에 있다: ① 위임 수단(Bash) 불가침 ② 소스 도구가 전멸하면 박탈 통째 취소.
   *  없으면 타겟이 기본값(48종)일 때 소스가 `--tools ""`(도구 0개)로 스폰된다(Codex 소스는 `restrictedTools` 로 shell·web 까지 꺼진다).
   */
  function computeDelegationStripDecision(agentId: string): DelegationStripDecision {
    const sourceCfg = graphManager.getAgentConfig(agentId);
    const sourceViable = hasUsableTools(sourceCfg);
    return computeDelegationStrip({
      edges: graphManager.getOutboundTaskEdges(agentId),
      // 설정 미저장이면 스폰도 DEFAULT_AGENT_CONFIG 로 간다 — 전멸 판정도 같은 목록을 봐야 한다.
      sourceTools: sourceCfg?.tools ?? DEFAULT_AGENT_CONFIG.tools,
      targetToolsOf: (id) => graphManager.getAgentConfig(id)?.tools,
      isEdgeViable: (e) => sourceViable && isEdgeTargetViable(e.targetAgentId),
    });
  }

  /*
   * §5.10 — 기억 카드 브리핑·세션 리플렉션은 없다(기억·브레인 축 폐기).
   * 세션 끝마다 `claude -p` 자식을 띄우는 리플렉션을 되살리지 마라 — 끈 사람에게도 토큰이 샌다.
   * 되풀이한 절차를 굳히는 일은 `autoGoalService` 가 한다(LLM 을 부르지 않는다).
   */

  /**
   * §5.5 #17-18 — 즉시(immediate) 덧말: 지금 도는 턴을 끊는다. 덜 죽이는 것부터 셋이다:
   * ① 그 턴이 이미 답을 내고 봉인만 붙들려 있으면 봉인을 확정해 다음 턴으로 넘긴다(죽는 것 없음) ② 도는 턴이면 soft interrupt(프로세스·감시 유지)
   * ③ 못 보내면 하드 킬 — close 핸들러가 `[Stopped by user]` 로 봉합하고 `setOnComplete` 가 이 덧말을 `--resume` 으로 보낸다(대화 맥락 유지).
   * `stop-session` 과 달리 큐를 비우지 않는다 — 비우면 방금 친 덧말이 함께 사라진다.
   * @returns 끊었거나 봉인을 확정해 넘겼으면 true(호출자는 `processNextCommand` 를 다시 부르지 않는다), 대기 중이었으면 false.
   */
  function interruptForImmediateCommand(cmd: QueuedCommand, sessionId: string): boolean {
    const subId = cmd.subAgentId;
    if (!subId) return false;
    // 한 턴을 실제로 처리 중일 때만 — 명령 사이에 idle 로 살아 있는 persistent 자식은 끊을 이유가 없다.
    if (!subAgentManager.isSubProcessingCommand(subId)) return false;
    // §5.3 #9-1 (P)(b) — 도는 것이 조용한 압축이면 사용자에게 "도는 턴"은 그 진행을 물려받은 명령이다. 아래 세 갈래는 CLI 의 압축만 끊으므로,
    //   그 명령을 먼저 중지됨으로 봉합한다 — 안 하면 압축이 끝나자마자 그 명령이 맨 앞에서 나가 덧말이 뒤로 밀린다.
    sealHeirCutByImmediate(cmd, sessionId);
    // 그 턴이 이미 답을 내고 백단 여운 때문에 봉인만 붙들려 있으면 끊을 턴이 없다 — 붙든 봉인을 지금 확정해 이 덧말을 다음 턴으로 보낸다.
    //   여기에 인터럽트를 쏘지 마라 — 3초 뒤 하드 킬로 떨어져 감시까지 죽고, 닫힌 창구에 덧말을 쓰다 `write after end` 로 세션이 멈춘다.
    if (subAgentManager.sealHeldTurnNow(subId)) {
      logger.info(`[follow-up] held turn sealed sub=${subId} cmd=${cmd.id} — dispatched without killing the child`);
      return true;
    }
    // 먼저 **소프트 인터럽트**를 시도한다 — 프로세스를 죽이지 않으므로 그 세션이 띄워 둔 백그라운드
    //   감시(`Monitor` · `Bash run_in_background`)가 살아남는다(§5.5 #17-9 ⑩ 의 동반 사망 방지).
    //   보내지 못했을 때만 종전 하드 킬로 내려간다.
    if (subAgentManager.softInterrupt(subId)) {
      logger.info(`[follow-up] soft interrupt sub=${subId} cmd=${cmd.id} (watches kept alive)`);
      return true;
    }
    const stopped = subAgentManager.stop(subId);
    logger.info(`[follow-up] immediate interrupt sub=${subId} cmd=${cmd.id} stopped=${stopped}`);
    return stopped;
  }

  /**
   * §5.3 #9-1 (P)(b) — [즉시] 덧말이 끊을 턴이 조용한 압축을 물려받은 명령이면, 큐에서 빼 `[Stopped by user]` 로 봉합해 대화에 남긴다. 봉합했으면 true.
   * 고르는 규칙은 화면·두 [중지]와 같은 `silentPreCompactHeirs` 를 타는 `heirCutByImmediate` 한 곳. 위임 장부는 "나가기 전 취소"로 내린다(CLI 에 닿은 적이 없다).
   * 지휘(오케스트라) 명령은 런 정산이 따로 있어(`DELETE /api/commands`) 봉합하지 않는다.
   */
  function sealHeirCutByImmediate(cmd: QueuedCommand, sessionId: string): boolean {
    const queue = commandQueues.get(sessionId);
    if (!queue) return false;
    const cut = heirCutByImmediate(queue, cmd);
    if (!cut || cut.heir.orchestraRunId) return false;
    const idx = queue.indexOf(cut.heir);
    if (idx < 0) return false;
    queue.splice(idx, 1);
    settleDispatchCommand(cut.heir, { outcome: { status: 'cancelled', errorMessage: 'stopped by user before start' }, updateEdge: true, neverStarted: true });
    archiveCompletedCommands(sessionId, [sealStoppedHeir(cut.heir, cut.startedAt)]);
    logger.info(`[follow-up] immediate ${cmd.id} cut ${cut.heir.id} riding a silent compact — sealed as stopped (§5.3 #9-1 (P)(b))`);
    return true;
  }

  /**
   * §5.5 #17-28 — 이 세션 프롬프트에 실릴 조각 전부를 이름표와 함께 조립한다(부작용 없음).
   * `processNextCommand` 와 `GET /api/context-inventory` 가 같은 함수를 쓴다 — 두 벌로 가르면 화면 표와 실제 프롬프트가 어긋난다.
   * 켬/끔은 여기서 보지 않는다 — 목록은 존재하는 것 전부이고, 뺄 것은 호출부 게이트가 정한다.
   */
  function assembleContextParts(input: {
    agent: { id: string; label: string; customCreated?: boolean };
    cwd: string;
    agentConfig?: AgentConfig;
    subAgentId?: string;
    commandText: string;
    /** §5.3 #12-4 — 이번에 나가는 명령의 검증 범위·기록. 주입원 표를 잴 때는 없다(그때는 "권한 없음"으로 잰다). */
    verificationScope?: VerificationScope;
    verificationSummary?: CommandVerificationSummary;
  }): {
    parts: MeasuredPart[];
    projectRoot: string;
    /**
     * §5.5 #17-28 ⑧(c) — 목표 블록의 두 절반. 표(인벤토리)는 둘을 합쳐 한 줄로 재지만, 실제 발송은
     * 갈라진다 — 상태는 매 턴 프롬프트로, 규약은 스폰의 `--append-system-prompt` 로.
     */
    goalParts: { state: string; protocol: string };
    /**
     * §5.11 정독 게이트 — 안 변하는 규칙 한 벌. 목표 규약과 같은 자리(`--append-system-prompt`)로 나간다.
     * 정독 블록이 이 턴에 실릴 때만 비어 있지 않고, 주입원 창의 `plugin:spec-driven` 스위치를 따른다.
     */
    specSystemRules: string;
    /**
     * §5.3 #12-4 — 검증 정책의 두 절반. 표는 둘을 합쳐 한 줄로 재고, 발송은 갈라진다 — 안 변하는 정책 문단은
     * `--append-system-prompt`(압축에도 남는다)로, 이번 명령의 권한 한 줄은 매 턴 앞말로.
     */
    verificationParts: { rules: string; state: string };
    /**
     * §5.26 (E) — 이번 턴 복원 브리핑이 실렸다면 그 마커. **여기서 못 박지 않는다** —
     * 이 함수는 주입원 표를 재는 데도 쓰이므로(부작용 없음이 계약) 창 한 번 여는 것으로
     * 브리핑이 소모되면 안 된다. 실제로 보낸 호출부가 `markCompactBriefed()` 로 못 박는다.
     */
    recoveryMarker?: { projectName: string; id: string };
  } {
    const { agent, cwd, agentConfig, subAgentId } = input;
    const parts: MeasuredPart[] = [];
    const projectRoot = graphManager.getProjectPathForAgent(agent.id) ?? cwd;

    parts.push({
      id: CONTEXT_SOURCE_IDS.skillsPrefix,
      text: (agentConfig?.skills && agentConfig.skills.length > 0)
        ? agentConfig.skills.map((s) => `/${s}`).join('\n') + '\n\n'
        : '',
      detail: (agentConfig?.skills ?? []).join(', '),
    });
    parts.push({
      id: CONTEXT_SOURCE_IDS.agentRules,
      text: agentConfig?.rules?.trim() ? `\n\n# Agent Rules\n${agentConfig.rules.trim()}` : '',
    });
    // §4 (CLI 사양 추종) — 에이전트 자율 압축 창구. 켠 에이전트에게만 실리므로 끄면 바이트 0.
    //   `subAgentId` 가 없는 경로(첫 스폰 전 등)에서는 신고할 대상이 없으니 안내도 넣지 않는다
    //   — 부를 수 없는 창구를 알려 주는 것은 없는 손잡이를 그리는 것과 같다.
    if (agentConfig?.provider?.kind !== 'codex-cli') parts.push({
      id: CONTEXT_SOURCE_IDS.compactSelf,
      text: (agentConfig?.agentCanCompact === true && subAgentId)
        ? buildAgentSelfCompactRule(agent.id, subAgentId, agentRuleShell('claude', HOST_PLATFORM))
        : '',
    });
    // §5.26 (E) 3단계 — 압축 뒤 **딱 한 턴만** 실리는 복원 브리핑. 평소에는 빈 줄(0자)이다.
    //   마커는 Claude 세션 id 로 서 있으므로 우리 탭 id 가 아니라 그 세션 id 로 되짚는다.
    let recoveryBlock = '';
    let recoveryMarker: { projectName: string; id: string } | undefined;
    {
      const claudeSid = subAgentId ? subAgentManager.getSub(subAgentId)?.sessionId : undefined;
      const marker = claudeSid ? graphManager.peekCompactBriefing(claudeSid) : undefined;
      if (marker?.outcome && hasNotCarried(marker.outcome.notCarried)) {
        recoveryBlock = buildRecoveryBlock(marker.outcome.notCarried);
        if (recoveryBlock) recoveryMarker = { projectName: marker.projectName, id: marker.id };
      }
    }
    parts.push({ id: CONTEXT_SOURCE_IDS.compactRecovery, text: recoveryBlock });
    parts.push({ id: CONTEXT_SOURCE_IDS.edges, text: buildOutboundEdgesRulesSection(agent.id) });
    parts.push({
      id: CONTEXT_SOURCE_IDS.feedback,
      text: buildAgentFeedbackBlock(graphManager.getAgentFeedbacksForAgent(agent.id)),
    });

    // §5.11 — 켠 집행 플러그인은 **한 장씩** 선다(개별로 끌 수 있어야 하므로) + 그 위에 전체 스위치 하나.
    const pluginBlocks = buildPluginPromptSectionParts({
      projectPath: projectRoot,
      cwd,
      agentId: agent.id,
      agentLabel: agent.label,
      customCreated: Boolean(agent.customCreated),
      // §5.11 정독 게이트 — 원장 키. 있으면 호스트가 이 세션의 읽기 영수증을 컨텍스트에 채운다.
      ...(subAgentId ? { subAgentId } : {}),
      // §5.11 — 우리가 띄운 세션은 규칙 줄을 시스템 프롬프트에 따로 싣는다(아래 `specSystemRules`). 매 턴 블록은
      //   목록·강도만. 훅 세션은 시스템 프롬프트가 없어 종전대로 규칙까지 함께 실린다.
      ...(agent.customCreated ? { promptRulesInSystem: true } : {}),
    });
    // 정독 블록이 실릴 때만 규칙도 나간다 — 블록이 비면(꺼짐·기획 없음) 규칙만 홀로 서는 일이 없다.
    const specSystemRules = agent.customCreated && pluginBlocks.some((p) => p.id === SPEC_DRIVEN_ID && p.block.trim() !== '')
      ? buildSpecSystemRules()
      : '';
    parts.push({
      id: CONTEXT_SOURCE_IDS.plugins,
      text: '',
      defaultEnabled: pluginBlocks.length > 0,
      detail: String(pluginBlocks.length),
    });
    for (const p of pluginBlocks) {
      parts.push({ id: `${CONTEXT_PLUGIN_ID_PREFIX}${p.id}`, text: p.block, title: p.id });
    }

    // 아래는 커스텀/스폰 에이전트에만 실리는 것들(§4 하이브리드 경계) — 훅 에이전트는 빈 줄로 선다.
    const ruleArgs = {
      shell: agentRuleShell(agentConfig?.provider?.kind === 'codex-cli' ? 'codex' : 'claude', HOST_PLATFORM),
      serverBase: `http://127.0.0.1:${hookListenerPort ?? port}`,
      serverToken: hookListenerToken ?? '',
      agentId: agent.id,
      ...(hookListenerIdentityFile ? { identityFile: hookListenerIdentityFile } : {}),
      ...(subAgentId ? { subAgentId } : {}),
    };
    const custom = Boolean(agent.customCreated);
    parts.push({ id: CONTEXT_SOURCE_IDS.intentFirst, text: custom ? AGENT_INTENT_FIRST_RULES : '' });
    // §5.5 #17-28 ⑧(a) — 카드 5종이 공유하는 규칙 한 벌. 카드 블록들보다 **앞**에 선다(가리키는 쪽이 뒤).
    // §5.5 #17-28 ⑧(f) — 결론의 근거는 디스크 문서 한 장으로 내렸다. 경로가 없으면(쓰기 실패)
    //   "애매하면 읽어라" 줄 자체가 빠진다 — 없는 파일을 가리키면 그 턴을 헛되이 태운다.
    const cardDocPath = custom ? ensureCardRulesDoc() : undefined;
    parts.push({
      id: CONTEXT_SOURCE_IDS.cardCommon,
      text: custom ? buildAgentCardCommonRules({ ...ruleArgs, ...(cardDocPath ? { docPath: cardDocPath } : {}) }) : '',
    });
    parts.push({ id: CONTEXT_SOURCE_IDS.cardReport, text: custom ? buildAgentReportRules(ruleArgs) : '' });
    parts.push({ id: CONTEXT_SOURCE_IDS.cardQuestion, text: custom ? buildAgentQuestionRules(ruleArgs) : '' });
    parts.push({ id: CONTEXT_SOURCE_IDS.cardReview, text: custom ? buildAgentReviewRules(ruleArgs) : '' });

    // 세션 목표 — 그 탭에 active 목표가 있을 때만 실린다(없으면 빈 줄 = "해당 없음").
    let goalText = '';
    const goalParts = { state: '', protocol: '' };
    if (custom && subAgentId) {
      const goal = graphManager.getSessionGoal(subAgentId);
      if (goal && goal.status === 'active' && goal.text.trim()) {
        const goalArgs = {
          ...ruleArgs,
          subAgentId,
          goalText: goal.text.trim(),
          percent: goal.percent,
          ...(goal.steps.length > 0
            ? {
              // §5.5 #17-17 ⑪(d)(i) — `authoredBy`·`kind` 를 떨어뜨리지 않는다 — 빠지면 ⑪(d) 의 `[사용자 추가]`(지울 수 없는 단계) 표시가 주입 블록에 안 뜬다.
              //   `kind` 는 무대가 읽는 축이라 자기가 붙였던 종류를 봐야 같은 키를 이어 쓴다.
              steps: goal.steps.map((s, i) => ({
                text: s.text,
                status: s.status,
                ...(s.authoredBy ? { authoredBy: s.authoredBy } : {}),
                ...(s.kind ? { kind: s.kind } : {}),
                // ⑰(b) — 행 표식도 떨어뜨리지 않는다(첫 단계의 표식은 뜻이 없다).
                ...(i > 0 && s.parallel ? { parallel: true } : {}),
              })),
            }
            : {}),
          authoredBy: goal.authoredBy,
          ...(goal.note ? { note: goal.note } : {}),
          revision: goal.revision,
          // ⑪(i) — 있는 종류를 먼저 쓰게 한다(없으면 매번 새 키를 지어내 카드가 흩어진다).
          kinds: graphManager.getVisualKindKeysForSession(subAgentId),
        };
        goalParts.state = buildSessionGoalState(goalArgs);
        goalParts.protocol = buildSessionGoalProtocol(goalArgs);
        goalText = goalParts.state + goalParts.protocol;
      }
    }
    parts.push({ id: CONTEXT_SOURCE_IDS.goal, text: goalText });

    // §5.3 #12-4 — 검증 정책. 우리가 띄운 세션에만 싣는다(훅 세션은 우리 세션이 아니라 정책 밖이다).
    //   옵션을 끄면 제한 문단과 권한 없음 지시를 함께 걷고 이전 제한의 해제 안내만 보낸다.
    //   주입원 스위치는 안내만 제어하며 실행 전 판정은 같은 옵션을 호출마다 읽는다.
    const verificationOptions = { enforced: verificationGateOn() };
    const verificationParts = custom
      ? { rules: buildVerificationPolicyRules(verificationOptions), state: buildVerificationStateLine(input.verificationScope, input.verificationSummary, verificationOptions) }
      : { rules: '', state: '' };
    parts.push({ id: CONTEXT_SOURCE_IDS.verificationPolicy, text: verificationParts.rules + verificationParts.state });

    /*
     * §5.10 — 자동 목표: 이 프로젝트에서 되풀이해 온 절차 목록(이름과 한 줄 설명뿐). 꺼져 있으면 `undefined` 라 한 글자도 안 실린다.
     * 켬 판정은 shared 순수 함수 `resolveAutoGoalEnabled` 하나가 갖는다 — 화면과 집행이 같은 답을 봐야 한다.
     */
    // 같은 프로젝트 뿌리를 본다 — 절차는 프로젝트의 것이고, 뿌리가 갈리면 옆 프로젝트의 절차가 실린다.
    const autoGoalRoot = projectRoot;
    if (autoGoalRoot) {
      try {
        const procedureSessionId = subAgentId ?? graphManager.findSessionByAgentId(agent.id);
        const block = buildAutoGoalPromptBlock(
          autoGoalRoot,
          graphManager.getAutoGoalSettings(autoGoalRoot),
          { agentId: agent.id, subAgentId: procedureSessionId },
          input.commandText,
        );
        if (block) parts.push({
          id: CONTEXT_SOURCE_IDS.autoGoalSkills,
          text: procedureSessionId ? `${block}\n\n${buildAutoGoalAgentProtocol({
            root: autoGoalRoot, agentId: agent.id, subAgentId: procedureSessionId,
            ...(hookListenerIdentityFile ? { identityFile: hookListenerIdentityFile } : {}),
          })}` : block,
          defaultEnabled: true,
        });
      } catch (e) {
        // 절차 목록을 못 실었다고 명령이 멈추면 안 된다 — 다음 턴이 다시 시도한다.
        logger.warn('[auto-goal] prompt block failed', e as Error);
      }
    }

    // §5.11 — 훅으로 붙은 외부 세션의 주입 통로. 글자 수로 재는 블록이 아니라 경로 스위치라 0자여도 켜져 있는 것이 맞다(내용은 위 플러그인 줄들).
    //   우리가 띄운 세션(custom)에는 해당이 없으므로 줄 자체를 세우지 않는다.
    if (!custom) {
      parts.push({ id: CONTEXT_SOURCE_IDS.hookEnforcement, text: '', defaultEnabled: true });
    }

    return { parts, projectRoot, goalParts, specSystemRules, verificationParts, ...(recoveryMarker ? { recoveryMarker } : {}) };
  }

  /** 큐에서 dispatch 가능한 명령을 전부 실행.
   *  동일 subAgentId는 직렬(한 세션당 한 명령), 서로 다른 subAgentId끼리는 병렬로 시작.
   *  null subAgentId는 하나의 슬롯으로 묶어 기존 직렬 동작 유지. */
  // §5.3 #9-1 토큰 절약 런타임(N 동시 가동 상한 · O 스폰 시차 · P 턴 예산).
  // 셋 다 명령을 버리지 않고 미루기만 한다 — 거절된 명령은 `queued` 로 남아 슬롯이 비거나(N) 시차가 지나면(O) 같은 큐에서 나간다.

  /**
   * (O) 마지막 **첫 스폰** 시각. 세션이 아니라 **앱 단위**다 — 접두 캐시는 세션이 아니라 계정이
   * 공유하므로, 시차를 둬야 하는 상대는 "다른 세션의 첫 스폰"이다.
   */
  let lastFreshSpawnAt = 0;
  /** (O) 시차로 미뤄 둔 세션의 재시도 타이머. **세션당 하나** — 여러 개가 걸리면 같은 명령이 여러 번 나간다. */
  const staggerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** (P) sub 별 "마지막 압축 이후 턴 수". 압축이 큐에 들어가는 순간 0 으로 돌아간다. */
  const turnsSinceCompact = new Map<string, number>();

  /** (N) 지금 턴을 처리 중인 세션 수. 사람이 치는 CMD(PTY) 세션은 세지 않는다 — 세면 터미널 하나 열어 둔 것만으로 에이전트가 굶는다(§2.4 `cmdDrivenSubs` 제외와 같은 판단). */
  function countRunningTurns(): number {
    const running = new Set<string>();
    for (const [sid, queue] of commandQueues) {
      for (const c of queue) {
        if (c.status !== 'executing') continue;
        if (c.subAgentId) {
          const sub = subAgentManager.getSub(c.subAgentId);
          const cfg = sub ? graphManager.getAgentConfig(sub.parentAgentId) : undefined;
          if (cfg?.executionMode === 'interactive-terminal') continue;
          running.add(c.subAgentId);
        } else {
          running.add(`session:${sid}`);
        }
      }
    }
    return running.size;
  }

  /** (O) 이 명령이 **새 세션을 띄우는가** — `--resume` 턴은 이미 자기 캐시가 있어 시차 대상이 아니다. */
  function isFreshSpawn(cmd: QueuedCommand): boolean {
    if (!cmd.subAgentId) return true;
    const sub = subAgentManager.getSub(cmd.subAgentId);
    return !sub?.sessionId;
  }

  /** (O) 시차가 지난 뒤 그 세션을 다시 두드린다. 이미 예약돼 있으면 겹쳐 걸지 않는다. */
  function scheduleStaggerRetry(sessionId: string, waitMs: number): void {
    if (staggerTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      staggerTimers.delete(sessionId);
      processNextCommand(sessionId);
    }, Math.max(1, Math.min(waitMs, TOKEN_SAVER_LIMITS.spawnStaggerMs.max)));
    timer.unref?.();
    staggerTimers.set(sessionId, timer);
  }

  /**
   * (N·O) 이 명령을 지금 내보내도 되는가.
   *
   * **켠 축이 없으면 판정 자체를 건너뛴다** — 이 기능을 안 쓰는 사용자에게는 함수 호출 하나
   * 외에 아무 일도 일어나지 않는다(§5.3 #9-1 무변경 근거).
   */
  function tokenSaverAdmits(cmd: QueuedCommand, sessionId: string): boolean {
    const saver = appStateGetTokenSaver();
    if (saver.maxConcurrentAgents > 0 && countRunningTurns() >= saver.maxConcurrentAgents) {
      return false; // 슬롯 없음 — 턴이 끝날 때 `pumpTokenSaverQueues` 가 깨운다.
    }
    if (saver.spawnStaggerMs > 0 && isFreshSpawn(cmd)) {
      const wait = lastFreshSpawnAt + saver.spawnStaggerMs - Date.now();
      if (wait > 0) { scheduleStaggerRetry(sessionId, wait); return false; }
    }
    return true;
  }

  /**
   * (N) 슬롯이 비었다 — 상한에 걸려 기다리던 세션을 깨운다. 턴이 끝나는 자리에서만 부른다(새 주기 타이머 ❌, §2.4).
   * 슬롯이 다시 차면 즉시 멈춘다 — 한 바퀴에 상한을 넘겨 내보내면 상한이 무의미해진다.
   */
  function pumpTokenSaverQueues(): void {
    const saver = appStateGetTokenSaver();
    if (saver.maxConcurrentAgents <= 0) return;
    for (const [sid, queue] of [...commandQueues]) {
      if (countRunningTurns() >= saver.maxConcurrentAgents) break;
      if (!queue.some((c) => c.status === 'queued')) continue;
      processNextCommand(sid);
    }
  }

  /*
   * §5.3 #10-4 — 오케스트라 **지휘 턴의 덮어쓴 설정**. 키는 그 턴의 subAgentId(권한 훅이 보내는 값).
   *   권한 창구 두 곳(`/api/permission-check`·`/api/codex-tool-check`)은 원래 저장된 설정을 읽는데, 지휘 턴은
   *   도구·권한·모델을 **그 턴에만** 바꾼다. 이 표가 없으면 창구가 저장된 권한으로 다시 판정해 지휘자의
   *   curl 이 승인 카드에 걸려 멈추거나, Codex 지휘자의 편집 막기가 풀린다. 턴이 끝나면(`setOnComplete`)
   *   또는 명령을 지우면(DELETE) 그 명령의 항목을 내린다.
   */
  const orchestraTurnConfigs = new Map<string, { agentId: string; commandId: string; config: AgentConfig }>();

  /** 권한 창구가 볼 설정 — 그 세션이 지휘 턴 중이면 덮어쓴 설정, 아니면 저장된 설정. */
  /*
   * §5.3 #10-5 — 설정 덜어내기가 **이 턴에만** 깎은 사본. 키는 그 턴의 subAgentId.
   *   지휘 사본(위) 위에 얹히므로 권한 창구는 실제로 스폰된 설정과 같은 것을 본다.
   *   턴이 끝나거나 명령을 지우면 오케스트라 사본과 **같은 자리**에서 함께 내린다.
   */
  const configTrimTurnConfigs = new Map<string, { agentId: string; commandId: string; config: AgentConfig }>();

  function agentConfigForTurn(agentId: string, subAgentId: unknown): AgentConfig | undefined {
    const trimmed = typeof subAgentId === 'string' ? configTrimTurnConfigs.get(subAgentId) : undefined;
    if (trimmed && trimmed.agentId === agentId) return trimmed.config;
    const overlay = typeof subAgentId === 'string' ? orchestraTurnConfigs.get(subAgentId) : undefined;
    if (overlay && overlay.agentId === agentId) return overlay.config;
    return graphManager.getAgentConfig(agentId);
  }

  /** 설치·로그인 probe 캐시를 UI와 같은 준비 판정에 넘긴다. */
  function currentOrchestraReadiness() {
    return {
      claudeSetup: graphManager.getClaudeSetup(),
      claudeAuth: graphManager.getClaudeAuth(),
      codexSetup: graphManager.getCodexSetup(),
      codexAuth: graphManager.getCodexAuth(),
    };
  }

  /**
   * 준비 판정이 "모름"이면 그 엔진만 그 자리에서 한 번 다시 묻는다 — 탐침 한 번 실패(CLI 잠깐 못 찾음·타임아웃)로 캐시가 모름이 되면
   * 다음 폴링(10분)까지 편성·계획 신고가 막혀 런이 보고 없이 닫힌다.
   */
  async function reprobeOrchestraEngine(engine: OrchestraCliEngine): Promise<void> {
    const before = currentOrchestraReadiness();
    const setup = engine === 'codex' ? before.codexSetup : before.claudeSetup;
    // 설치 판정이 비어 있을 때만 CLI 재스캔까지 간다(평소엔 로그인 재조회 한 번이면 충분).
    if (!setup || setup.phase === 'unknown') {
      await (engine === 'codex' ? codexSetupService : claudeSetupService).refresh().catch(() => {});
    }
    await (engine === 'codex' ? refreshCodexAuth() : refreshClaudeAuth()).catch(() => {});
  }

  /** 오케스트라 판정 실패와 필요한 준비 단계를 REST로 돌려준다. */
  function respondOrchestraCheck(res: express.Response, check: Extract<OrchestraCheck, { ok: false }>): void {
    res.status(check.status).json({
      ok: false,
      error: check.error,
      ...(check.ids ? { ids: check.ids } : {}),
      ...(check.preparation ? { preparation: check.preparation } : {}),
      ...(check.limit !== undefined ? { limit: check.limit, current: check.current } : {}),
    });
  }

  /**
   * §5.3 #10-4 — 이 명령이 **지휘 턴**이면 그 턴의 설정·규칙을 만든다. 아니면 null(= 이 기능이 없던 때와 똑같다).
   * 런이 `conducting` 이고 그 런의 지휘 명령일 때만이다 — 킥오프(멤버 쪽)·엣지 명령은 지휘 턴이 아니다.
   * 규칙에는 이 지휘자가 이전 런들에서 쓴 멤버 중 **아직 캔버스에 있는 것**과 그들 사이의 엣지를 싣는다.
   */
  function prepareConductorTurn(
    agent: BubbleData,
    cmd: QueuedCommand,
    base: AgentConfig,
    stripped: ReadonlySet<string>,
  ): { config: AgentConfig; rules: string } | null {
    if (!cmd.orchestraRunId) return null;
    const run = graphManager.findOrchestraRun(cmd.orchestraRunId);
    if (!run || run.commandId !== cmd.id || run.agentId !== agent.id || run.phase !== 'conducting') return null;
    // 엔진은 **지금 설정**을 따른다(가로챈 뒤 사용자가 엔진을 바꿨을 수 있다). 로컬로 바뀌었으면 지휘하지 않는다.
    const engine = orchestraEngineOf(base);
    if (!engine) return null;
    const settings = graphManager.getOrchestraSettings(run.projectPath);
    const readyEngines = orchestraReadyEngines(currentOrchestraReadiness());
    const agents = graphManager.getSnapshot().agents;
    /*
     * 재사용 후보는 프로젝트 전체다 — ④ 계획 신고의 재사용 검사(`reused-agent-not-in-project`, 아래 plan 엔드포인트와 같은 술어)가 프로젝트 소속만 보므로,
     *   내 이전 런 멤버만 실으면 서버가 받아 줄 후보를 감춰 같은 검수자를 또 만들고 멤버 상한만 축낸다.
     *   순서는 내 것이 앞이고 표에는 `own` 으로 갈라 적는다.
     */
    const ownMemberIds = collectOrchestraMemberIds(graphManager.getOrchestraRuns(run.projectPath), agent.id);
    const ownMemberSet = new Set(ownMemberIds);
    const reuseCandidateIds = [
      ...ownMemberIds,
      ...agents
        .filter((a) => a.customCreated && a.id !== agent.id && !ownMemberSet.has(a.id)
          && samePath(graphManager.getOrchestraRootForAgent(a.id) ?? '', run.projectPath))
        .map((a) => a.id),
    ];
    const existingMembers: OrchestraMemberRef[] = [];
    for (const id of reuseCandidateIds) {
      const node = agents.find((a) => a.id === id);
      if (!node?.customCreated) continue; // 지워진 멤버는 싣지 않는다 — 없는 path 로 킥오프하게 된다.
      const cfg = graphManager.getAgentConfig(id);
      const memberEngine = orchestraEngineOf(cfg);
      if (!memberEngine || !readyEngines.includes(memberEngine)
        || !orchestraMemberProviderAllowed(settings, cfg?.provider?.kind, engine)) continue;
      const model = memberEngine === 'codex' ? cfg?.provider?.modelId : memberEngine === 'claude' ? cfg?.model : undefined;
      existingMembers.push({
        id,
        label: node.label,
        path: node.path,
        engine: memberEngine ?? 'local',
        ...(model ? { model } : {}),
        ...(ownMemberSet.has(id) ? { own: true } : {}),
      });
    }
    const memberSet = new Set([agent.id, ...existingMembers.map((m) => m.id)]);
    const existingEdges: OrchestraEdgeRef[] = Object.values(graphManager.getTaskEdgesSnapshot())
      .filter((e) => memberSet.has(e.sourceAgentId) && memberSet.has(e.targetAgentId))
      .map((e) => ({
        id: e.id,
        sourceAgentId: e.sourceAgentId,
        targetAgentId: e.targetAgentId,
        ...(e.kind ? { kind: e.kind } : {}),
        command: e.command,
      }));
    const rules = buildOrchestraConductorRules({
      serverBase: `http://127.0.0.1:${hookListenerPort ?? port}`,
      projectName: graphManager.getAgentProjectName(agent.id),
      runId: run.runId,
      conductorAgentId: agent.id,
      conductorSubAgentId: cmd.subAgentId ?? '',
      centerX: agent.position?.x ?? 0,
      centerY: agent.position?.y ?? 0,
      settings,
      existingMembers,
      existingEdges,
      conductorEngine: engine,
      readyEngines,
      // 절차의 셸 문법 — Windows 의 Codex 지휘자는 PowerShell 로 명령을 돌린다(`orchestraConductorShell`).
      platform: HOST_PLATFORM,
    });
    return { config: buildConductorTurnConfig(base, settings, engine, stripped), rules };
  }

  /**
   * §5.3 #10-5 — 설정 덜어내기가 켜져 있으면 이 턴 사본을 깎고 기록을 남긴다. 꺼져 있으면(기본) 아무것도 하지 않고 `null`.
   * 기록은 덜어낸 게 없어도 남긴다(배제 목록만 보여 주는 턴이 있다). 사본은 실제로 덜어낸 게 있을 때만 돌려준다.
   * 저장된 `AgentConfig` 는 이 함수 어디에서도 쓰이지 않는다(`computeConfigTrim` 이 얕은 사본을 판다).
   */
  function prepareConfigTrimTurn(
    agent: BubbleData,
    cmd: QueuedCommand,
    base: AgentConfig,
  ): { config: AgentConfig; run: ConfigTrimRun } | null {
    const root = graphManager.getConfigTrimRootForAgent(agent.id);
    if (!root) return null;
    const settings = graphManager.getConfigTrimSettings(root);
    const ids = { agentId: agent.id, subAgentId: cmd.subAgentId ?? undefined };
    if (!resolveConfigTrimEnabled(settings, ids)) return null;
    // 로컬 엔진은 CLI 인자 축이 없다 — 규칙 표의 전제(플래그 조립)가 성립하지 않으니 손대지 않는다.
    const engine = orchestraEngineOf(base);
    if (!engine) return null;
    const registry = modelRegistryService.getRegistry();
    const result = computeConfigTrim(base, configTrimContextOf({
      engine,
      config: base,
      // **확인된 목록일 때만** 넘긴다 — 공개 문서 시드로 모델 핀을 지우면 안 된다(모르면 두는 쪽).
      knownModelIds: registry.sourceMix === 'api-merged' ? registry.entries.map((e) => e.id) : undefined,
      // 설치된 CLI 도움말에서 읽어낸 등급만. 못 읽었으면 undefined → 그 규칙은 배제 목록으로 간다.
      knownEfforts: registry.effortLevels,
      disabledRules: settings?.disabledRules,
    }));
    const run: ConfigTrimRun = {
      runId: `ct_${cmd.id}`,
      agentId: agent.id,
      subAgentId: cmd.subAgentId ?? '',
      commandId: cmd.id,
      engine,
      startedAt: Date.now(),
      trimmed: result.trimmed,
      excluded: result.excluded,
    };
    if (graphManager.addConfigTrimRun(root, run)) scheduleCheckpoint();
    return result.trimmed.length > 0 ? { config: result.config, run } : null;
  }

  /**
   * §5.3 #10-4 — 끝난 명령의 오케스트라 정산. 지휘·킥오프·멤버 엣지 명령의 토큰을 그 런에 적고, 지휘 턴이면
   * 단계를 닫는다(신고 없이 끝났으면 `unreported`). 그 턴의 덮어쓴 설정도 여기서 내린다.
   */
  function settleOrchestraCommands(done: readonly QueuedCommand[], ownerAgentId: string | null): void {
    const orchestraRoot = ownerAgentId ? graphManager.getOrchestraRootForAgent(ownerAgentId) : null;
    const runs = orchestraRoot ? graphManager.getOrchestraRuns(orchestraRoot) : [];
    const now = Date.now();
    let changed = false;
    for (const cmd of done) {
      if (cmd.subAgentId && orchestraTurnConfigs.get(cmd.subAgentId)?.commandId === cmd.id) {
        orchestraTurnConfigs.delete(cmd.subAgentId);
      }
      // §5.3 #10-5 — 덜어낸 사본도 같은 자리에서 내린다(남겨 두면 다음 턴의 권한 판정이 옛 사본을 본다).
      if (cmd.subAgentId && configTrimTurnConfigs.get(cmd.subAgentId)?.commandId === cmd.id) {
        configTrimTurnConfigs.delete(cmd.subAgentId);
      }
      if (runs.length === 0) continue;
      const runId = orchestraRunIdForCommand(runs, cmd, ownerAgentId);
      if (!runId) continue;
      graphManager.updateOrchestraRun(runId, (r) => {
        const next = settleConductorTurn(addOrchestraRunTokens(r, cmd.inputTokens ?? 0, cmd.outputTokens ?? 0), cmd, now,
          cmd.subAgentId ? dispatchJobs.listForRequester(cmd.subAgentId) : []);
        if (next !== r) changed = true;
        return next;
      });
      const settled = graphManager.findOrchestraRun(runId);
      if (settled?.commandId === cmd.id && settled.phase === 'error') cancelOrchestraWork(runId, 'conductor ended before successful collection');
    }
    if (changed) scheduleCheckpoint();
  }

  function processNextCommand(sessionId: string): void {
    const queue = commandQueues.get(sessionId);
    if (!queue) return;

    // §5.3 #9-1 (P) — 아래에서 큐 스냅샷을 뜨기 **전에** 조용한 선행 압축을 끼운다. 뒤에 넣으면
    //   그 스냅샷에 없어 이번 라운드에 안 나가고, 사용자 명령이 먼저 실려 압축이 뒤로 밀린다.
    injectSilentPreCompact(queue, sessionId);

    const agent = graphManager.getAgentBySession(sessionId);
    if (!agent) return;

    const cwd = graphManager.getAgentCwd(sessionId);
    if (!cwd) return;

    const agentConfig = graphManager.getAgentConfig(agent.id);

    // §5.5 #17-28 — 주입원 통제: 이 창에서 끈 줄은 여기서 빠진다. 마지막 관문이라 다른 화면(플러그인 창·에이전트 설정)에서 켜져 있어도 여기서 정해진다.
    //   오버라이드가 없으면 전부 기본값(켜짐)이라 조립 결과가 바이트 단위로 같다.
    const contextOverrides = graphManager.getContextOverrides();
    const contextProjectKey = graphManager.getAgentProjectName(agent.id);

    // 박탈 모드 outbound 엣지가 있으면 타겟이 가진 도구를 소스 allowedTools 에서 뺀다(매 턴 재계산 — 엣지 삭제·모드 전환은 다음 턴에 복귀).
    // §5.3 #12 — 위임 수단(Bash)은 절대 걷지 않고, 박탈이 소스를 도구 0개로 만들면 통째로 취소한다.
    const stripDecision = computeDelegationStripDecision(agent.id);
    const stripSet = stripDecision.strip;
    const effectiveConfig = (agentConfig && stripDecision.applied)
      ? { ...agentConfig, tools: applyDelegationStrip(agentConfig.tools, stripDecision) }
      : agentConfig;

    // 이미 executing 중인 subAgentId들 — 이 슬롯은 점유 중
    const busy = new Set<string | null>();
    for (const c of queue) {
      if (c.status === 'executing') busy.add(c.subAgentId);
    }

    let dispatched = false;
    const waitsForEarlierWork = (command: QueuedCommand): boolean => hasUnfinishedCommandDependencies(
      command, commandQueues, sessionId, (id) => graphManager.findAgentIdBySession(id) ?? subAgentManager.findSubBySessionId(id)?.parentAgentId,
    );
    // §5.5 #17-18 — 합치기가 뒤엣것을 큐에서 지우므로 **스냅샷**을 순회한다(라이브 배열을
    //   splice 하며 돌면 항목을 건너뛴다). 지워진 항목은 아래 `queue.includes` 가 걸러낸다.
    for (const next of [...queue]) {
      if (next.status !== 'queued') continue;
      if (!queue.includes(next)) continue; // 앞선 명령에 흡수됨 — 이 턴에 이미 실려 나갔다.
      if (busy.has(next.subAgentId)) continue;
      if (waitsForEarlierWork(next) || followsWaitingSessionCommand(next, queue, waitsForEarlierWork)) continue;
      // §5.3 #9-1 (N·O) — 동시 가동 상한·스폰 시차. **부수효과보다 먼저** 본다(합치기·목표 시딩이
      //   돌고 난 뒤 미루면 그 일들이 다음 라운드에 또 돈다). 거절은 미룸이지 버림이 아니다.
      if (!tokenSaverAdmits(next, sessionId)) continue;
      const freshSpawn = isFreshSpawn(next);
      busy.add(next.subAgentId); // 같은 sub에 두 개 동시 dispatch 금지
      // §5.5 #17-18 — 뒤따르는 합치기 덧말을 이 명령에 흡수(= 한 턴에 함께 보낸다).
      //   프롬프트 조립(목표 시딩·브리핑)보다 **먼저** 해야 합쳐진 본문이 그 입력으로 쓰인다.
      const merged = absorbMergeFollowUps(queue, next);
      if (merged.length > 0) {
        logger.info(`[follow-up] merged ${merged.length} into ${next.id} (sub=${next.subAgentId ?? '-'})`);
        // §5.3 #12-4 (C) — 합쳐진 사람 명령들의 검증 범위를 합치고, 어느 하나라도 부정한 종류는 뺀다.
        //   본문을 다시 읽지 않는다 — 합쳐진 것 중에 에이전트가 넣은 명령(범위 없음)이 섞여도 권한이 생기지 않게.
        const mergedScope = mergeVerificationScopes([next.verificationScope, ...merged.map((m) => m.verificationScope)]);
        if (mergedScope) next.verificationScope = mergedScope;
      }
      // §5.5 #17-17 ⑨ — 목표 카드는 계획(TodoWrite)을 기다리지 않고 이 명령이 뜨는 순간 세운다(짧은 작업에서도 사이드바가 비지 않게).
      //   세션이 쓴 목표만 새 명령에 갈아타고 사용자가 고친 문장은 두는 판단은 전부 그래프 쪽에 있다.
      //   조각 조립보다 먼저 세워야 이번 턴 프롬프트에 실린다. 주입원 창에서 목표 블록을 꺼도 카드는 세운다(끈 것은 프롬프트 싣기다).
      if (agent.customCreated && next.subAgentId && next.text?.trim()) {
        graphManager.seedSessionGoalFromCommand(next.subAgentId, {
          agentId: agent.id,
          command: next.text,
        });
      }

      // §5.5 #17-28 — 이 턴에 실릴 수 있는 조각 전부를 이름표와 함께 받아, **게이트를 통과한 것만**
      //   순서대로 붙인다. 화면(`/api/context-inventory`)이 같은 함수를 쓰므로 표와 프롬프트가 어긋날 수 없다.
      // §5.11 정독 게이트 — 라우팅 재료는 **이번 턴 본문**이고, 조립보다 먼저 적혀야 이번 턴 블록이 그것으로
      //   절을 고른다. 훅(`UserPromptSubmit`)은 앞말이 붙은 조립본을 한 턴 늦게 주므로 재료로 쓰지 않는다.
      if (next.subAgentId && typeof next.text === 'string') {
        specReadingService.notePrompt(
          next.subAgentId,
          graphManager.getProjectPathForAgent(agent.id) ?? cwd,
          next.text,
          Date.now(),
          'assembly',
        );
      }
      const assembled = assembleContextParts({
        agent,
        cwd,
        ...(agentConfig ? { agentConfig } : {}),
        ...(next.subAgentId ? { subAgentId: next.subAgentId } : {}),
        commandText: next.text ?? '',
        ...(next.verificationScope ? { verificationScope: next.verificationScope } : {}),
        ...(next.verification ? { verificationSummary: next.verification } : {}),
      });
      const partText = new Map(assembled.parts.map((p) => [p.id, p.text]));
      // 층 셋을 다 넘긴다 — 하나라도 빠뜨리면 그 층에 걸어 둔 사용자의 뜻이 프롬프트에서 무시된다.
      const ctxScope = { projectKey: contextProjectKey, agentId: agent.id, subAgentId: next.subAgentId };
      /** 이 조각을 실을까 — 세션 층 > 에이전트 층 > 프로젝트 층 > 기본(켜짐). 끈 것은 빈 문자열이 된다. */
      const take = (id: string): string =>
        isContextSourceOn(contextOverrides, ctxScope, id) ? (partText.get(id) ?? '') : '';

      const edgesBlock = take(CONTEXT_SOURCE_IDS.edges);
      // 플러그인은 전체 스위치 하나 + 개별 스위치 여럿 — 둘 중 하나라도 끄면 그 조각이 빠진다.
      const pluginsOn = isContextSourceOn(contextOverrides, ctxScope, CONTEXT_SOURCE_IDS.plugins);
      const pluginBlock = pluginsOn
        ? assembled.parts
          .filter((p) => p.id.startsWith(CONTEXT_PLUGIN_ID_PREFIX))
          .map((p) => take(p.id))
          .join('')
        : '';
      // ⚠ 한 줄로 유지할 것 — `mounted.test.ts` 가 "집행 블록이 rulesBlock 에 들어가는가"를 이 줄의
      //   문자열로 확인한다(배선이 조용히 사라지는 사고를 막는 검사라 줄바꿈이 곧 오탐이 된다).
      const rulesBlock = take(CONTEXT_SOURCE_IDS.agentRules) + edgesBlock + take(CONTEXT_SOURCE_IDS.feedback) + pluginBlock;
      const contextSummary = `${take(CONTEXT_SOURCE_IDS.skillsPrefix)}You are a sub-agent working in project at: ${cwd}\nParent agent: ${agent.label}${rulesBlock}\n\nExecute the following task.`;

      // §4 — 커스텀/스폰 에이전트에만 "작업 신고" 지시문을 싣는다(Hook 에이전트 제외 = 하이브리드 경계). 토큰 인증 loopback 으로 POST /api/agent-report → IDE 색 구분 카드.
      //   agentId=부모 버블, subAgentId=이 세션(탭). §5.5 #17-12 — "의도 먼저" 규칙이 카드 지시문보다 앞에 온다(턴의 첫 출력이 의도 선언이 되게).
      // §5.5 #17-17 ② — 목표 상태는 live preamble 에도 싣는다 — `dispatchContext` 는 첫 스폰에만 쓰여, 거기만 넣으면 세션 첫 턴 1회로 끝나 단계가 비어 있다.
      // §5.5 #17-28 ⑧(c) — 안 변하는 의도 선언·목표 규약은 `--append-system-prompt` 로 프로세스당 한 벌 — 매 턴 사용자 메시지에 쌓지 마라(이력에 N벌, 실측 249 세션 4.6M 토큰).
      //   압축에도 쓸려 나가지 않는다. 매 턴 남는 것은 목표 상태(문장·진행률·단계)뿐 — 실측 154 토큰.
      const intentBlock = take(CONTEXT_SOURCE_IDS.intentFirst);
      const goalOn = !!take(CONTEXT_SOURCE_IDS.goal);
      const goalBlock = goalOn ? assembled.goalParts.state : '';
      const goalProtocolBlock = goalOn ? assembled.goalParts.protocol : '';
      // §5.11 — 정독 규칙 줄은 목표 규약과 같은 자리로 간다. 주입원 창에서 그 카드를 껐으면 규칙도 함께 빠진다
      //   (블록은 목록만 싣도록 이미 조립됐으므로, 여기서 빠뜨리면 규칙이 어디에도 없다 — 둘은 한 벌이다).
      const specRulesBlock = pluginsOn && take(`${CONTEXT_PLUGIN_ID_PREFIX}${SPEC_DRIVEN_ID}`) ? assembled.specSystemRules : '';
      // §5.3 #12-4 (G) — 검증 정책 문단은 시스템 프롬프트로(압축에도 남는다), 이번 명령의 권한 한 줄은 매 턴 앞말로.
      const verificationOn = !!take(CONTEXT_SOURCE_IDS.verificationPolicy);
      const verificationRulesBlock = verificationOn ? assembled.verificationParts.rules : '';
      const verificationStateBlock = verificationOn ? assembled.verificationParts.state : '';
      const appendSystemPrompt = intentBlock + goalProtocolBlock + specRulesBlock + verificationRulesBlock;
      // §5.3 #10-4 — 오케스트라 지휘 턴이면 **이 턴만** 설정을 덮어쓰고 편성 규칙을 시스템 프롬프트 뒤에 붙인다.
      //   저장된 설정은 그대로다(다음 턴은 평소대로). 권한 창구가 같은 설정으로 판정하도록 턴 동안 표에 올린다.
      const conductor = prepareConductorTurn(agent, next, effectiveConfig ?? DEFAULT_AGENT_CONFIG, stripSet);
      const baseTurnConfig = conductor?.config ?? effectiveConfig;
      // §5.3 #10-5 — 설정 덜어내기. **켜 둔 자리의 턴에만** 돈다. 저장된 설정은 손대지 않고 이 턴 사본만 깎는다.
      //   꺼져 있으면 null 이라 아래 대입이 그대로 이전 값이 된다 — 안 쓰는 사용자는 바이트 단위로 같다.
      const configTrim = baseTurnConfig ? prepareConfigTrimTurn(agent, next, baseTurnConfig) : null;
      const turnConfig = configTrim ? configTrim.config : baseTurnConfig;
      const turnAppendSystemPrompt = !conductor
        ? appendSystemPrompt
        : appendSystemPrompt.trim() ? `${appendSystemPrompt}\n\n${conductor.rules}` : conductor.rules;
      if (conductor && next.subAgentId) {
        orchestraTurnConfigs.set(next.subAgentId, { agentId: agent.id, commandId: next.id, config: conductor.config });
        logger.info(`[orchestra] conductor turn ${next.id} (run ${next.orchestraRunId ?? '-'}, sub=${next.subAgentId})`);
      }
      if (configTrim && next.subAgentId) {
        configTrimTurnConfigs.set(next.subAgentId, { agentId: agent.id, commandId: next.id, config: configTrim.config });
        logger.info('[configTrim] turn ' + next.id + ' trimmed ' + configTrim.run.trimmed.length + ' field(s) (sub=' + next.subAgentId + ')');
      }
      // §5.5 #17-28 ⑧(a) — 공통 규약은 카드가 하나라도 켜져 있을 때만 앞세운다(전부 끄면 함께 빠진다).
      // §5.5 #17-28 ⑧(d) — 번호 목록·서버 iframe 규약은 싣지 않는다 — 마크다운 렌더와 백그라운드 셸 포트 감지(§7.11)가 에이전트 없이 해낸다.
      //   엔드포인트(`/api/agent-list`·`/api/agent-iframe`)와 카드 렌더는 살아 있다.
      const cardBodies = take(CONTEXT_SOURCE_IDS.cardReport) + take(CONTEXT_SOURCE_IDS.cardQuestion)
        + take(CONTEXT_SOURCE_IDS.cardReview);
      const cardsRules = cardBodies ? take(CONTEXT_SOURCE_IDS.cardCommon) + cardBodies : '';
      // §5.26 (E) 3단계 — 압축 뒤 복원 브리핑. 평소에는 빈 문자열이고, 실릴 때도 **한 턴뿐**이다.
      //   `dispatchContext`(첫 스폰)와 `livePreamble`(이어지는 턴) 둘 다에 붙이지만 `execute` 가
      //   sessionId 유무로 갈라 쓰므로 한 턴에 두 번 실리지 않는다(집행 블록과 같은 자리·같은 이유).
      const recoveryBlock = take(CONTEXT_SOURCE_IDS.compactRecovery);
      // §5.3 #10-2 위임 조회 — 부모가 이 위임과 함께 넘긴 조회 목록. 위임이 끝났으면 비어 창구를 싣지 않는다.
      //   코덱스는 MCP `status` 도구로(아래 codexEdgeConfig), 클로드는 자기 id 로 부르는 GET 안내로 받는다.
      const statusGrantsForTurn = next.edgeId ? dispatchJobs.activeStatusGrantsFor(next.id) : [];
      const statusGrantBlock = agentConfig?.provider?.kind === 'codex-cli' ? '' : dispatchStatusGrantInstructions(statusGrantsForTurn);
      // §5.3 #10-2 — 이 세션이 띄우고 아직 받지 못한 결과. 턴 끝 가드(`failIfDispatchResultMissing`)와 같은 목록이라
      //   실패 사유에 적힌 cmdId 로 다음 턴이 다시 dispatch 하지 않고 이어 받는다. 코덱스는 codexEdgeConfig 로 간다.
      const undeliveredForTurn = next.subAgentId ? pendingDispatchResultsFor(next.subAgentId) : [];
      const undeliveredBlock = agentConfig?.provider?.kind === 'codex-cli' ? '' : undeliveredDispatchResultInstructions(undeliveredForTurn);
      const additionalContext = take(CONTEXT_SOURCE_IDS.compactSelf) + take(CONTEXT_SOURCE_IDS.autoGoalSkills);
      const dispatchContext = contextSummary + cardsRules + goalBlock + recoveryBlock + statusGrantBlock + undeliveredBlock + additionalContext + verificationStateBlock;

      // live preamble 은 resume 경로에서도 매 턴 앞에 붙는다 — 엣지가 생기거나 바뀌면 세션 재시작 없이 바로 알도록 edgesBlock 을 여기 싣는다.
      // 커스텀 에이전트면 customParent=true → execute 가 --bg 를 우회한다.
      // §5.11 — 집행 블록도 여기 싣는다: `contextSummary` 는 첫 스폰에만 쓰여 안 넣으면 이어지는 턴엔 한 글자도 안 실린다.
      //   첫 스폰 경로는 preamble 을 쓰지 않아 중복되지 않는다(`execute` 가 sessionId 유무로 갈라 쓴다).
      const livePreamble = edgesBlock + pluginBlock + goalBlock + recoveryBlock + statusGrantBlock + undeliveredBlock + additionalContext + verificationStateBlock;
      // §5.5 #17-28 — `control: 'spawn'` 으로 끈 줄(CLAUDE.md·자동 기억·스킬 등)은 CLI 인자·환경변수로
      //   나간다. 헤드리스는 매 턴 새 프로세스라 다음 프롬프트부터 그대로 먹는다.
      const codexTurn = turnConfig?.provider?.kind === 'codex-cli';
      const spawnSwitches = codexTurn
        ? { args: [], env: {} }
        : buildSpawnContextSwitches(contextOverrides, ctxScope);
      // §5.5 #17-28 ⑩ (c) — 우리가 쏘는 `/compact`·`/clear` 턴에는 슬래시 차단 플래그 하나만 뺀다 — 그 플래그는 CLI 내장 명령 등록까지 막아
      //   자동 압축이 꺼진다(실측: 322k 세션 24시간 `compact_boundary` 0건, 발사 2회 모두 거절).
      //   폭은 이 한 턴이다(헤드리스는 `--resume` 도 매 턴 새 프로세스). 그 턴은 명령 한 줄뿐이라 사용자 스킬이 낄 자리가 없다.
      const spawnArgs = isInternalSlashCommand(next.text)
        ? withoutSlashCommandFlag(spawnSwitches.args)
        : spawnSwitches.args;
      // §5.5 #17-28 ⑧(b) — 카드 curl 이 쓸 주소·토큰을 환경변수로 자식에게 넘긴다(프롬프트에 안 실린다).
      //   환경은 자식이 뜰 때 정해지므로 `--resume` 재스폰마다 최신값이다.
      const cardEnv: Record<string, string> = {
        [AGENT_CARD_ENV_BASE]: `http://127.0.0.1:${hookListenerPort ?? port}`,
        [AGENT_CARD_ENV_TOKEN]: hookListenerToken ?? '',
      };
      // Codex receives the freshly assembled full context every turn. Its full
      // context already includes the live blocks; appending them again doubles them.
      subAgentManager.execute(next, cwd, dispatchContext, turnConfig, codexTurn ? undefined : livePreamble, {
        ...(graphManager.getVerificationRuns(next.subAgentId ?? '').some((run) => run.target && run.pendingCommandId === next.id) ? {
          verificationConfig: {
            helperPath: path.join(path.dirname(hookHandlerPath ?? codexHookContext?.handlerPath ?? ''), 'verification-tools.mjs'),
            ...getAppNodeRuntime(),
          },
        } : {}),
        ...(codexTurn ? {
          codexContextArgs: buildCodexContextArgs(contextOverrides, ctxScope, cwd),
          codexEdgeInstructionsEnabled: isContextSourceOn(contextOverrides, ctxScope, CONTEXT_SOURCE_IDS.edges),
        } : {}),
        // §5.3 #10-4 — 지휘 턴은 `codexTools.edit = 'deny'` 를 얹은 **그 턴의 설정**으로 훅을 싣는다(평소엔 같은 값이다).
        ...(turnConfig?.provider?.kind === 'codex-cli' && hasCodexToolRestrictions(turnConfig.provider.codexTools) ? {
          codexToolHook: {
            helperPath: codexHookContext ? path.join(path.dirname(codexHookContext.handlerPath), 'codex-edges.mjs') : '',
            ...getAppNodeRuntime(),
            policy: turnConfig.provider.codexTools!,
          },
        } : {}),
        // §5.25 (H) — 권한 모드·감사 경계를 코덱스 턴에서 집행하는 훅. 승인 카드·원장은 클로드와 같은 창구다.
        //   커스텀 버블에만 싣는다 — 권한 창구는 훅으로 붙은 버블(view-only)의 호출을 막지 않는다.
        ...(turnConfig?.provider?.kind === 'codex-cli' && agent.customCreated ? {
          codexPermissionHook: {
            helperPath: codexHookContext ? path.join(path.dirname(codexHookContext.handlerPath), 'codex-edges.mjs') : '',
            ...getAppNodeRuntime(),
            required: codexPermissionHooksRequired(
              turnConfig.permissionMode,
              graphManager.getAuditBoundary(graphManager.getAgentProjectName(agent.id) ?? ''),
              // §5.3 #12-3 — 자물쇠가 하나라도 있으면 훅 없이 돌 수 없다(읽기 전용 샌드박스도 읽기는 연다).
              Object.keys(graphManager.getAllPathLocks()).length > 0,
              // §5.3 #12-4 — 실행 전 차단이 켜져 있으면 훅 없이 돌 수 없다(판정이 닿지 않는다 — fail-closed).
              //   (J) 옵션에서 꺼 두면(기본) 이 정책 때문에 필수가 되지는 않는다.
              verificationGateOn(),
            ),
          },
        } : {}),
        // §5.3 #12-4 (E) ② — 호스팅 브라우저·컴퓨터 도구는 훅 밖이다. 차단이 켜진 채 이 명령에 브라우저 확인 권한이
        //   없으면 끈다. (J) 차단을 꺼 두면 끄지 않는다 — 막지 않기로 한 것을 기능 스위치로 대신 막지 않는다.
        ...(codexTurn && verificationGateOn() && !next.verificationScope?.kinds.includes('browser') ? { codexHostedBrowserOff: true } : {}),
        // §5.3 #10-2 위임 조회 — 나가는 엣지가 없어도 조회를 넘겨받은 턴이면 다리를 싣는다(`status` 만, dispatch 는 숨는다).
        //   받지 못한 결과가 남은 턴도 같다 — 그 결과를 이어 받을 `status` 가 있어야 한다.
        ...(agentConfig?.provider?.kind === 'codex-cli' && (graphManager.getOutboundTaskEdges(agent.id).some((e) => isTaskEdgeViable(e)) || statusGrantsForTurn.length > 0 || undeliveredForTurn.length > 0) ? {
          codexEdgeConfig: {
            helperPath: codexHookContext ? path.join(path.dirname(codexHookContext.handlerPath), 'codex-edges.mjs') : '',
            ...getAppNodeRuntime(),
            edgeIds: graphManager.getOutboundTaskEdges(agent.id).filter((e) => isTaskEdgeViable(e)).map((e) => e.id),
            restrictedTools: [...stripSet],
            ...(statusGrantsForTurn.length ? { statusCmdIds: statusGrantsForTurn } : {}),
            ...(undeliveredForTurn.length ? { pendingResults: undeliveredForTurn.map(({ cmdId, status }) => ({ cmdId, status })) } : {}),
          },
        } : {}),
        customParent: !!agent.customCreated,
        ...(spawnArgs.length > 0 ? { extraArgs: spawnArgs } : {}),
        // §5.3 #12-4 (J) — 차단을 켠 채 띄우면 훅 안전망 표식(`VIBISUAL_VERIFICATION_GATE=1`)을 함께 싣는다(끄면 빈 객체).
        extraEnv: { ...cardEnv, ...spawnSwitches.env, ...buildVerificationGateEnv(), VIBISUAL_OWNER_AGENT_ID: agent.id, VIBISUAL_SUBAGENT_ID: next.subAgentId ?? '' },
        ...(turnAppendSystemPrompt.trim() ? { appendSystemPrompt: turnAppendSystemPrompt } : {}),
      });
      // §5.26 (E) — **실어 보낸 뒤에** 못 박는다. 조립 단계에서 찍으면 주입원 표를 여는 것만으로
      //   그 세션의 브리핑이 사라진다(같은 함수로 재기 때문에). 여기까지 왔다는 것은 자식에게
      //   실제로 넘어갔다는 뜻이다.
      if (recoveryBlock && assembled.recoveryMarker) {
        graphManager.markCompactBriefed(assembled.recoveryMarker.projectName, assembled.recoveryMarker.id);
      }
      // §5.3 #9-1 (O) — **실어 보낸 뒤에** 시계를 돌린다. 조립 중에 찍으면 게이트에 막혀 못 나간
      //   명령까지 시차를 소비해, 다음 차례가 이유 없이 한 칸 더 기다린다.
      if (freshSpawn) lastFreshSpawnAt = Date.now();
      dispatched = true;
    }

    if (dispatched) broadcastSnapshot();
  }

  // §5.5 #17-11 — 세션 반복 실행(루프) 런타임. 한 회차 = `POST /api/commands/:sessionId` 와 같은 모양의 QueuedCommand 를 그 세션 큐에 넣는 것뿐이다
  // (dispatch·스트림·중지·아카이브·과금이 직접 보낸 명령과 같은 길).
  // 자기 증식 방지: ① 회차는 직렬 — queued/executing 명령이 하나라도 있으면 쏘지 않는다 ② 다음 회차는 직전 `pendingCommandId` 완료 확인 뒤에만 예약
  // ③ [중지] 계열은 루프 자체를 끈다(아래 stop 라우트).
  const sessionLoopTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * §5.5 #17-11 ⑫(c)(f) — 루프가 가리키는 파일 경로를 그 에이전트의 작업 폴더 기준으로 푼다.
   * 프로젝트 밖(`..` 이탈·절대경로)은 거부한다 — 루프 설정 한 줄로 아무 파일이나 읽게 두지 않는다.
   */
  function resolveSessionLoopPath(agentId: string, relPath: string): string | null {
    const cwd = graphManager.getAgentCwdByAgentId(agentId);
    if (!cwd) return null;
    const root = path.resolve(cwd);
    const target = path.resolve(root, relPath);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return target;
  }

  /**
   * §5.5 #17-11 ⑫(f) — 이 회차에 쓸 본문. `commandFile` 이 있으면 매번 새로 읽고,
   * 읽지 못하면 **저장된 본문으로 계속한다**(파일이 잠깐 없다고 밤새 도는 루프가 끊기면 안 된다).
   */
  function readSessionLoopCommand(loop: SessionLoop): { text: string; error?: string } {
    if (!loop.commandFile) return { text: loop.command };
    const full = resolveSessionLoopPath(loop.agentId, loop.commandFile);
    if (!full) {
      return { text: loop.command, error: `command file outside project: ${loop.commandFile}` };
    }
    try {
      const raw = fs.readFileSync(full, 'utf8').trim();
      if (!raw) return { text: loop.command, error: `command file is empty: ${loop.commandFile}` };
      return { text: raw.slice(0, SESSION_LOOP_COMMAND_MAX) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { text: loop.command, error: `command file unreadable: ${msg.slice(0, 200)}` };
    }
  }

  /**
   * §5.5 #17-11 ⑫(a) — 끝난 명령 1건의 토큰·비용을 루프 누적에 더한다.
   *
   * 토큰은 `subAgentManager` 가 명령마다 채워 둔 증분(`inputTokens`/`outputTokens`)을 그대로 쓴다.
   * 비용은 **추정치** — 그 증분에 캐시 읽기/쓰기 구분이 남지 않아 전부 입력가로 환산하므로 실제보다
   * 크게 잡힌다(상한을 일찍 치는 쪽 = 보수적). 회차 명령과 컨텍스트 정리 명령 **둘 다** 센다.
   */
  function accrueSessionLoopUsage(loop: SessionLoop, cmd: QueuedCommand): { spentTokens: number; spentCostUsd: number } {
    const inTok = Math.max(0, cmd.inputTokens ?? 0);
    const outTok = Math.max(0, cmd.outputTokens ?? 0);
    if (inTok === 0 && outTok === 0) {
      return { spentTokens: loop.spentTokens, spentCostUsd: loop.spentCostUsd };
    }
    const registry = modelRegistryService.getRegistry();
    const configured = graphManager.getAgentConfig(loop.agentId)?.model;
    const model = resolveAliasToLatest(configured, registry) ?? configured;
    const cost = calculateTokenCost(inTok, outTok, 0, 0, model, registry).total;
    return {
      spentTokens: loop.spentTokens + inTok + outTok,
      spentCostUsd: loop.spentCostUsd + cost,
    };
  }

  /**
   * §5.5 #17-11 ⑫(a) — 예산 상한에 닿았는지. 닿았으면 사람이 읽을 사유 한 줄을 돌려준다.
   * **회차 경계에서만** 부른다 — 돌고 있는 회차를 중간에 끊지 않는다.
   */
  function sessionLoopBudgetExceeded(loop: SessionLoop, spentTokens: number, spentCostUsd: number): string | null {
    if (loop.maxCostUsd && spentCostUsd >= loop.maxCostUsd) {
      return `cost budget reached: ~$${spentCostUsd.toFixed(2)} / $${loop.maxCostUsd}`;
    }
    if (loop.maxTokens && spentTokens >= loop.maxTokens) {
      return `token budget reached: ${spentTokens} / ${loop.maxTokens}`;
    }
    if (loop.maxDurationMs && loop.cycleStartedAt) {
      const elapsed = Date.now() - loop.cycleStartedAt;
      if (elapsed >= loop.maxDurationMs) {
        return `time budget reached: ${Math.round(elapsed / 1000)}s / ${Math.round(loop.maxDurationMs / 1000)}s`;
      }
    }
    return null;
  }

  function clearSessionLoopTimer(subAgentId: string): void {
    const timer = sessionLoopTimers.get(subAgentId);
    if (timer) {
      clearTimeout(timer);
      sessionLoopTimers.delete(subAgentId);
    }
  }

  /** 루프 한 회차 발사. 실제로 큐에 넣었으면 true. */
  function fireSessionLoopIteration(subAgentId: string): boolean {
    const loop = graphManager.getSessionLoop(subAgentId);
    if (!loop || !loop.enabled) return false;

    // 탭이 이미 닫혔으면 루프도 함께 사라진다(좀비 루프 차단).
    if (!subAgentManager.getSub(subAgentId)) {
      clearSessionLoopTimer(subAgentId);
      graphManager.deleteSessionLoop(subAgentId);
      return false;
    }

    const sessionId = graphManager.findSessionByAgentId(loop.agentId);
    if (!sessionId) return false;

    let queue = commandQueues.get(sessionId);
    if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
    // 이 탭에 아직 안 끝난 명령이 있으면 겹쳐 쏘지 않는다(사용자가 직접 보낸 명령 포함 — 직렬 보장).
    if (queue.some((c) => c.subAgentId === subAgentId && (c.status === 'queued' || c.status === 'executing'))) {
      return false;
    }

    // §5.5 #17-11 ⑫(f) — 본문을 파일에서 읽는 루프면 **매 회차 새로 읽는다**(도는 중에 사람이
    //   파일만 고쳐도 다음 회차부터 반영). 읽기에 실패해도 루프를 죽이지 않고 저장된 본문으로 간다.
    const round = loop.completed + 1;
    const source = readSessionLoopCommand(loop);
    // 보낼 본문이 아예 없으면(파일도 못 읽고 저장된 본문도 비었다면) 빈 명령을 쏘지 않고 멈춘다 —
    // 빈 프롬프트는 세션에서 아무 의미 없는 턴만 태운다.
    if (!source.text.trim()) {
      clearSessionLoopTimer(subAgentId);
      graphManager.updateSessionLoop(subAgentId, {
        enabled: false, status: 'error', pendingCommandId: undefined, pendingCompactCommandId: undefined,
        nextRunAt: undefined, lastError: source.error ?? 'loop command is empty',
      });
      logger.warn(`[session-loop] empty command, loop stopped sub=${subAgentId}`);
      return false;
    }
    // §5.5 #17-11 ⑫(g) — 켠 규약만 순수 모듈이 붙인다(아무것도 안 켰으면 원문 그대로).
    const text = composeLoopRoundText({
      command: source.text,
      round,
      ...(loop.mode === 'count' && loop.total ? { total: loop.total } : {}),
      ...(loop.progressFile ? { progressFile: loop.progressFile } : {}),
      oneTaskPerRound: loop.oneTaskPerRound,
      commitEachRound: loop.commitEachRound,
    });

    // §5.3 #12-4 (C) — 루프의 검증 권한은 **사람이 루프 설정에 적은 본문**에서만 선다. 명령 파일에서 읽은
    //   회차는 읽지 않는다 — 그 파일은 에이전트가 고칠 수 있다(AI 가 쓴 글은 권한이 아니다).
    const loopScope = !loop.commandFile || source.error ? verificationScopeFromText(loop.command) : undefined;
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now()}-loop${round}`,
      text,
      timestamp: Date.now(),
      subAgentId,
      status: 'queued',
      ...(loopScope ? { verificationScope: loopScope } : {}),
    };
    queue.push(cmd);
    graphManager.recordSkillUsageFromCommandText(sessionId, cmd.text);
    clearSessionLoopTimer(subAgentId);
    graphManager.updateSessionLoop(subAgentId, {
      status: 'running',
      pendingCommandId: cmd.id,
      pendingCompactCommandId: undefined,
      lastRunAt: cmd.timestamp,
      nextRunAt: undefined,
      // §5.5 #17-11 ⑫(a) — 벽시계 상한의 기준점. 사이클 첫 회차에서만 찍힌다.
      ...(loop.cycleStartedAt === undefined ? { cycleStartedAt: cmd.timestamp } : {}),
      ...(source.error !== undefined ? { lastError: source.error } : {}),
    });
    logger.info(
      `[session-loop] iteration agent=${loop.agentId} sub=${subAgentId} n=${loop.completed + 1}` +
      `${loop.mode === 'count' ? `/${loop.total ?? '?'}` : '/∞'}`,
    );
    processNextCommand(sessionId);
    return true;
  }

  /**
   * §5.5 #17-11 ⑪·⑫(b) — 회차 사이 컨텍스트 정리 1건 발사(`contextMode ≠ 'none'` 인 루프만). 회차와 같은 큐에 얹는 `QueuedCommand` 한 건이다
   * — 입력창에 `/compact`(요약 유지)·`/clear`(완전 초기화)를 치는 것과 같은 길.
   * 이 명령이 끝나야 다음 회차를 예약하므로 대조용 id 를 남긴다. 큐에 넣었으면 true(못 넣으면 호출자가 곧바로 다음 회차를 예약한다).
   */
  function fireSessionLoopContextReset(subAgentId: string): boolean {
    const loop = graphManager.getSessionLoop(subAgentId);
    if (!loop || !loop.enabled || loop.contextMode === 'none') return false;
    if (!subAgentManager.getSub(subAgentId)) return false;

    const sessionId = graphManager.findSessionByAgentId(loop.agentId);
    if (!sessionId) return false;

    let queue = commandQueues.get(sessionId);
    if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
    // 그 탭에 아직 안 끝난 명령이 있으면 압축을 겹쳐 쏘지 않는다(직렬 보장 — 회차 발사와 동일 규약).
    if (queue.some((c) => c.subAgentId === subAgentId && (c.status === 'queued' || c.status === 'executing'))) {
      return false;
    }

    const cmd: QueuedCommand = {
      id: `cmd-${Date.now()}-${loop.contextMode}${loop.completed}`,
      text: loop.contextMode === 'clear' ? SESSION_LOOP_CLEAR_COMMAND : SESSION_LOOP_COMPACT_COMMAND,
      timestamp: Date.now(),
      subAgentId,
      status: 'queued',
    };
    queue.push(cmd);
    // §5.26 (F)(b) — **압축일 때만** 보낸 시각을 적는다. `/clear` 는 `PreCompact` 를 내지 않으므로
    //   여기까지 적으면 영영 오지 않을 것을 기다려 `rejected` 가 상주한다(늑대소년의 정확한 모양).
    if (loop.contextMode !== 'clear') {
      const loopSessionId = subAgentManager.getSub(subAgentId)?.sessionId;
      if (loopSessionId) graphManager.markCompactSent(loopSessionId, Date.now());
    }
    clearSessionLoopTimer(subAgentId);
    graphManager.updateSessionLoop(subAgentId, {
      status: 'running',
      pendingCommandId: undefined,
      pendingCompactCommandId: cmd.id,
      nextRunAt: undefined,
    });
    logger.info(`[session-loop] context ${loop.contextMode} between rounds agent=${loop.agentId} sub=${subAgentId} after=${loop.completed}`);
    processNextCommand(sessionId);
    return true;
  }

  /**
   * §4 — 에이전트가 스스로 요청한 압축의 대기표. `POST /api/agent-compact` 는 턴 도중에 들어와 겹쳐 쏠 수 없으므로,
   * 적어 두었다가 그 턴이 끝나는 자리에서 `maybeCompactAfterTurn` 이 소비한다(Set 이라 여러 번 불러도 한 번만).
   * 런타임 전용 — 재시작으로 잃으면 에이전트가 다음 턴에 다시 부르면 된다.
   */
  const compactRequestedSubs = new Set<string>();

  /**
   * §5.3 #9-1 (P) — 접기로 정해졌으나 아직 안 접은 세션(subAgentId). 판정은 턴 경계에서 하고 여기 적어 두기만 한다 —
   * 실제 압축은 그 세션의 다음 명령이 나가기 직전 `injectSilentPreCompact` 가 조용히 끼운다(사용자가 기다리는 턴 안으로 숨는다).
   * 턴 끝에서 바로 `/compact` 를 큐에 얹지 마라 — 결과를 받은 뒤 아무도 기다리지 않는 시간에 화면이 혼자 2~3분 돈다(실측 압축 1회 평균 150초).
   * 런타임 전용(영속 ❌) — 잃어도 다음 턴 끝에 같은 판정이 다시 나오고 턴 예산 카운터도 0부터 센다.
   */
  const pendingPreCompact = new Set<string>();

  /**
   * §4 — 이 세션 컨텍스트가 지금 몇 토큰 찼는가(창 크기와 함께). 화면 게이지(IDEStatusBar)와 같은 출처를 쓴다 — 판정과 표시가 어긋나지 않게.
   *  - claude CLI — 세션 JSONL 의 마지막 assistant 엔트리(증분 캐시라 매 턴 읽어도 싸다).
   *  - 로컬 모델(§5.19) — JSONL 이 없다. 엔진이 왕복마다 실은 값이 `AgentConfig.provider` 에 있다.
   * 둘 다 없으면 `null` — 모르면 쏘지 않는다(모르는 채 쏘면 매 턴 압축이 된다).
   */
  function readTurnEndContext(sub: { id: string; sessionId?: string }, config?: AgentConfig): { used: number; max?: number; floor?: number } | null {
    const local = config?.provider;
    if (local && typeof local.contextUsed === 'number' && local.contextUsed > 0) {
      return { used: local.contextUsed, ...(typeof local.contextLimit === 'number' && local.contextLimit > 0 ? { max: local.contextLimit } : {}) };
    }
    const subSessionId = sub.sessionId;
    if (!subSessionId) return null;
    const cwd = graphManager.getAgentCwd(subSessionId);
    if (!cwd) return null;
    const info = readContextInfo(cwd, subSessionId);
    if (!info || info.contextUsed <= 0) return null;
    return {
      used: info.contextUsed,
      ...(info.contextMax > 0 ? { max: info.contextMax } : {}),
      // §4 (CLI 사양 추종) (5) 창 하한 — 화면(`SubAgent.contextFloor`)과 같은 출처의 시작 문맥.
      ...(info.firstContextUsed > 0 ? { floor: info.firstContextUsed } : {}),
    };
  }

  /**
   * §4 — 턴이 끝났다. 압축을 걸어야 하면 큐에 얹지 않고 `pendingPreCompact` 에 적어만 둔다 — 다음 명령 직전 `injectSilentPreCompact` 가 조용한 `/compact` 를 끼운다(§5.3 #9-1 (P)).
   * 켜고 끄는 스위치는 없다 — 고르는 숫자는 자동 압축 값 하나, 접는 자리는 언제나 턴 경계. 발동 조건은 `shouldCompactAfterTurn`(shared) 한 곳: 에이전트가 이번 턴에 요청(`agentCanCompact`)했거나
   * 자동 압축 값의 80%(`turnCompactTriggerTokens`)를 넘긴 채 끝남. 그 창은 스폰에 싣지 않는다(작업 도중엔 CLI 가 모델 창 끝에서만 접는다). 80% 는 명령 사이 압축 자리를 바꾸지 않으려 둔 비율.
   * 안 적는 자리: 방금 끝난 것이 압축 자신(무한 고리) · 루프가 `contextMode` 로 압축을 맡음(회차 경계에서 두 번 돈다) · 컨텍스트를 못 잼.
   * 큐에 안 끝난 명령이 있어도 적는다 — 기다리는 명령이 곧 압축이 숨을 대기다.
   */
  function maybeCompactAfterTurn(cmd: QueuedCommand, sessionId: string): boolean {
    const subAgentId = cmd.subAgentId;
    if (!subAgentId) return false;

    // §5.3 #9-1 (P) — 턴 하나가 끝났다. **판정보다 먼저** 세어야 이번 턴이 예산에 포함된다.
    //   sub.id 가 키라 스폰할수록 늘므로 §3.2.4 F′축으로 묶는다(다시 만들 수 있는 파생물이다 —
    //   잃어도 카운트가 0부터 다시 셀 뿐 대화는 그대로다).
    const turnsNow = (turnsSinceCompact.get(subAgentId) ?? 0) + 1;
    turnsSinceCompact.set(subAgentId, turnsNow);
    capMapSize(turnsSinceCompact, SESSION_KEYED_MAP_MAX);

    const requested = compactRequestedSubs.delete(subAgentId);
    const sub = subAgentManager.getSub(subAgentId);
    if (!sub) return false;

    const agentId = graphManager.findAgentIdBySession(sessionId) ?? sub.parentAgentId;
    const config = agentId ? graphManager.getAgentConfig(agentId) : undefined;
    // 발동선 게이트 — 선은 자동 압축 창(3층 → 토큰 절약 Q → 창 하한)에서 파생된다. 스폰은 이 창을 싣지 않는다.
    //   컨텍스트 측정은 요청이 없을 때만 한다(요청은 발동선을 묻지 않으므로 읽을 이유가 없다).
    const ctx = requested ? null : readTurnEndContext(sub, config);
    if (!shouldCompactAfterTurn({
      requested,
      autoCompact: config?.autoCompact,
      userAutoCompact: userDefaultsService.get().agentConfig?.autoCompact,
      contextUsed: ctx?.used,
      contextMax: ctx?.max,
      // §5.3 #9-1 (P) — 턴 예산. 컨텍스트 축과 직교하며, 창이 커서 발동선에 영영 못 닿는
      //   세션(1M)에서도 이 축은 걸린다.
      turnsSinceCompact: turnsNow,
      turnBudget: appStateGetTokenSaver().sessionTurnBudget,
      // §5.3 #9-1 (Q) — 절약이 조인 창. 명령 사이 압축의 발동선만 조인다(스폰에는 안 실린다).
      tokenSaverAutoCompact: appStateGetTokenSaver().autoCompactWindow,
      // §4 (CLI 사양 추종) (5) 창 하한 — 이 세션 자신의 시작 문맥으로 하한을 건다(턴이 끝났으니 첫 응답이 있다).
      ...(ctx?.floor !== undefined ? { startupFloor: ctx.floor } : {}),
    })) return false;

    // 압축이 압축을 부르지 않게. 사용자가 직접 친 `/compact` 뒤에도 또 쏘지 않는다.
    const text = cmd.text.trim();
    if (text === AGENT_COMPACT_COMMAND || text === SESSION_LOOP_CLEAR_COMMAND) return false;

    // 루프가 이미 회차 경계 정리를 맡고 있으면 그쪽에 양보한다(두 벌 압축 방지).
    const loop = graphManager.getSessionLoop(subAgentId);
    if (loop?.enabled && loop.contextMode !== 'none') return false;

    // §5.3 #9-1 (P) — 이미 적혀 있으면 그만이다. 여러 턴이 잇따라 예산을 넘겨도 끼는 압축은 한 번뿐.
    if (pendingPreCompact.has(subAgentId)) return false;
    pendingPreCompact.add(subAgentId);
    capSetSize(pendingPreCompact, SESSION_KEYED_MAP_MAX);
    // §5.3 #9-1 (P) — 압축을 **걸기로 정한 순간** 카운터를 0 으로 돌린다. 실패해도 되돌리지
    //   않는다 — 되돌리면 거절당한 세션이 매 턴 압축을 재예약해 그 자체가 토큰 폭식이 된다.
    turnsSinceCompact.set(subAgentId, 0);
    logger.info(`[turn-compact] pending ${AGENT_COMPACT_COMMAND} before next command sub=${subAgentId} by=${requested ? 'agent' : 'config'}${ctx ? ` used=${ctx.used}` : ''}`);
    // `markCompactSent`(§5.26 (F)(b))는 여기서 찍지 않는다 — 아직 안 보냈다. 찍으면 다음 명령 전까지의 조용한 시간을 전부
    //   "보냈는데 `PreCompact` 가 안 온다"(거절)로 읽는다. 찍는 자리는 실제로 끼우는 순간이다.
    // 큐도 두드리지 않는다 — 기다리던 명령은 이 턴이 끝나는 기존 경로가 두드리고, 그 길이 `injectSilentPreCompact` 를 지난다.
    return true;
  }

  /**
   * §5.3 #9-1 (P) — 다음 명령이 나가기 직전 그 앞에 조용한 `/compact` 를 끼운다.
   * `processNextCommand` 가 큐 스냅샷을 뜨기 전에 돌아야 한다 — 뒤에 넣으면 이번 라운드에 안 나가고 사용자 명령이 먼저 실린다.
   * 끼우지 않는 자리: sub 가 이미 도는 중(그 턴이 끝나면 다시 지난다) · 앞에 설 명령이 내부 슬래시 명령(압축 앞 압축은 낭비) ·
   * 기다리는 명령이 없음(표식은 남아 다음 명령을 기다린다 — 더 안 쓰면 압축도 안 돈다).
   */
  function injectSilentPreCompact(queue: QueuedCommand[], sessionId: string): void {
    if (pendingPreCompact.size === 0) return;
    // 자리 판정은 shared 순수 함수가 소유한다(시험이 같은 함수를 부른다 — §5.3 #9-1 (P)).
    const { slots, drop } = planSilentPreCompact(queue, pendingPreCompact);
    for (const subAgentId of drop) pendingPreCompact.delete(subAgentId);
    // `slots` 는 index 내림차순 — 뒤에서부터 넣어야 앞 자리가 안 밀린다.
    for (const slot of slots) {
      pendingPreCompact.delete(slot.subAgentId);
      queue.splice(slot.index, 0, {
        id: `cmd-${Date.now()}-precompact`,
        text: AGENT_COMPACT_COMMAND,
        timestamp: Date.now(),
        subAgentId: slot.subAgentId,
        status: 'queued',
        // §5.5 #17-18 — 자기 턴(`wait`)으로 나간다. 합치기면 `absorbMergeFollowUps` 가 이 압축을 base 로 뒤에 선 사용자 명령을 흡수하고 큐에서 지워,
        //   CLI 가 맨 앞 `/compact` 만 읽고 그 턴의 사용자 명령이 통째로 사라진다. `followUpMerge` 쪽에도 같은 가드가 있다 — 둘 다 둔다.
        dispatchMode: 'wait',
        // §5.3 #9-1 (P) — 화면에는 그리지 않는다. 실행 경로는 다른 명령과 완전히 같다.
        silent: true,
      });
      // §5.26 (F)(b) — **이제** 보낸다. 이 줄이 없으면 CLI 가 명령을 거절해도(2.1.263 은
      //   `is_error: false` 로 돌려준다) 로그만 남아 성공처럼 지나간다.
      //   키는 CLI 세션 UUID 다(`subAgentId` 아님 — §5.26 (I)(c) "두 id 를 맞대지 않는다").
      const compactSessionId = subAgentManager.getSub(slot.subAgentId)?.sessionId;
      if (compactSessionId) graphManager.markCompactSent(compactSessionId, Date.now());
      // §5.3 #9-1 (P)(b) — 이 순간부터 사용자에게는 뒤에 선 명령이 도는 턴이다. 탭·세션 목록·명령 센터가
      //   읽는 "마지막 명령"도 그 명령의 글이어야 한다(압축의 `execute` 는 이 칸을 건드리지 않는다).
      const heir = queue[slot.index + 1];
      if (heir && heir.id === slot.beforeCommandId) subAgentManager.noteLastCommand(slot.subAgentId, heir.text);
      logger.info(`[turn-compact] injected silent ${AGENT_COMPACT_COMMAND} ahead of ${slot.beforeCommandId} sub=${slot.subAgentId} session=${sessionId}`);
    }
  }

  /** 다음 회차 예약. delay 0 이면 즉시 발사, 아니면 타이머 + `nextRunAt` 표기(스윕이 안전망). */
  function scheduleSessionLoop(subAgentId: string, delayMs: number): void {
    clearSessionLoopTimer(subAgentId);
    const wait = Math.min(Math.max(0, delayMs), SESSION_LOOP_MAX_INTERVAL_MS);
    graphManager.updateSessionLoop(subAgentId, {
      status: 'waiting',
      pendingCommandId: undefined,
      pendingCompactCommandId: undefined,
      nextRunAt: Date.now() + wait,
    });
    if (wait <= 0) {
      fireSessionLoopIteration(subAgentId);
      return;
    }
    const timer = setTimeout(() => {
      sessionLoopTimers.delete(subAgentId);
      if (fireSessionLoopIteration(subAgentId)) {
        broadcastSnapshot();
        saveCheckpoint();
      }
    }, wait);
    sessionLoopTimers.set(subAgentId, timer);
  }

  /** 루프 정지(설정은 남기고 끄기만). 사용자 중지·세션 중지·전체 중지 공용. */
  function stopSessionLoop(subAgentId: string, status: SessionLoop['status'], lastError?: string): boolean {
    const loop = graphManager.getSessionLoop(subAgentId);
    if (!loop) return false;
    clearSessionLoopTimer(subAgentId);
    if (!loop.enabled && loop.status === status) return false;
    graphManager.updateSessionLoop(subAgentId, {
      enabled: false,
      status,
      pendingCommandId: undefined,
      pendingCompactCommandId: undefined,
      nextRunAt: undefined,
      ...(lastError !== undefined ? { lastError } : {}),
    });
    // §5.5 #17-11 ⑦·⑧ — 정지도 종료다. 버블 완료 판정을 같은 틱에 당겨 한 스냅샷에 싣는다.
    graphManager.recomputeCustomAgentStatus(loop.agentId);
    return true;
  }

  /** 한 에이전트의 모든 루프 정지 (전체 중지). 멈춘 개수. */
  function stopSessionLoopsForAgent(agentId: string): number {
    let n = 0;
    for (const loop of graphManager.getSessionLoopsForAgent(agentId)) {
      if (stopSessionLoop(loop.subAgentId, 'stopped')) n++;
    }
    return n;
  }

  /**
   * 완료된 명령 1건을 루프 진행에 반영. `setOnComplete` 가 아카이브로 옮기기 전에 호출한다.
   * `pendingCommandId` 가 일치하는 회차만 인정 — 사용자가 중간에 직접 보낸 명령이 회차로
   * 오인 계수되지 않는다.
   */
  // §5.5 #17-35 — 검증(Verify). 기존 세션 큐가 양 엔진을 실행하고, 검수는 앱 소유 도구의 실제 조작·검사·PNG 기록으로 판정한다.
  // 대상 없는 구형 이력은 아래 완료 경로에서 기존 판정 파서로 읽는다.

  /**
   * 이 에이전트에 실어 보낼 실행법을 고른다: 우리 레시피 → 기록된 스킬 → 없음.
   *
   * 순서에 뜻이 있다 — 우리가 **구조화해 들고 있는** `PlayRecipe` 가 가장 정확하고(포트·URL까지 안다),
   * 그다음이 `/verify` 자신이 적어 둔 파일이며, 둘 다 없을 때만 스킬에게 맡긴다.
   */
  function resolveVerifyRecipe(agentId: string, projectName: string): VerifyRecipeInfo {
    try {
      const bubbles = (graphManager.getSnapshot().playBubbles ?? []).filter((b) => b.projectName === projectName);
      // 지금 실제로 떠 있는 것(주소를 아는 것)을 먼저 본다 — 가장 확실한 사실이다.
      const ranked = [...bubbles].sort((a, b) => {
        const score = (x: typeof a): number => (x.status === 'running' && x.url ? 2 : x.recipe ? 1 : 0);
        return score(b) - score(a);
      });
      for (const b of ranked) {
        const r = b.recipe;
        if (!r && !b.url) continue;
        const info = summarizePlayRecipe({
          kind: r?.kind === 'static' ? 'static' : 'command',
          ...(r?.command ? { command: r.command } : {}),
          ...(r?.cwd ? { cwd: r.cwd } : {}),
          ...(r?.root ? { root: r.root } : {}),
          ...(b.port ?? r?.port ? { port: (b.port ?? r?.port) as number } : {}),
          ...(b.url ? { url: b.url } : {}),
          ...(r?.openPath ? { openPath: r.openPath } : {}),
          ...(r?.label ? { label: r.label } : {}),
        });
        if (info.source === 'play-recipe') return info;
      }
    } catch (err) {
      logger.warn(`[verify] play recipe lookup failed agent=${agentId}`, err);
    }

    // `/verify` 가 스스로 적어 둔 레시피가 이미 있으면 **존재만 알린다** — 읽지도 고치지도 않는다.
    const root = graphManager.getProjectPathForAgent(agentId);
    if (root) {
      try {
        if (fs.existsSync(path.join(root, ...VERIFY_RECORDED_SKILL_PATH.split('/')))) return recordedSkillRecipe();
      } catch { /* 접근 불가면 없는 것으로 본다 — 검증을 막을 이유가 아니다 */ }
    }
    return NO_RECIPE;
  }

  // ─── §5.5 #17-35 ⑨ — 시연 프레임 파일 (디스크는 여기서만 만진다) ───

  /**
   * 그 시연의 프레임 폴더 절대 경로. 프로젝트를 못 찾으면 null(=그림 없이 절차만 실린다).
   *
   * 레코드에는 상대 경로만 담는다(⑨-3) — 절대 경로를 박아 두면 프로젝트를 다른 경로로 옮긴
   * 순간 전부 깨지고, 그 사실이 검증을 실제로 보낼 때까지 드러나지 않는다.
   */
  function demoFramesDir(agentId: string, demoId: string): string | null {
    const root = graphManager.getProjectPathForAgent(agentId);
    if (!root) return null;
    return path.join(root, '.vibisual', VERIFICATION_DEMO_DIR, demoId);
  }

  /**
   * 시연의 프레임을 있는 자리 그대로 가리킨다(⑨-4) — 경로 + 클립 안 시각.
   * 사본을 뜨지 않는다 — 첨부는 지워지지 않고 프레임 경로는 프롬프트 본문으로 나가므로, 사본은 검증마다 못 쓰는 그림만 쌓는다(§9).
   * 원본은 시연 레코드와 수명이 같다(`removeDemoFrames` 가 유일한 회수 지점).
   * 실제로 없는 파일이 하나라도 있으면 시작을 거절한다 — 원래 시연을 줄인 채 판정하면 안 된다.
   */
  function demoFrameRefsForCommand(demo: VerificationDemo): ReturnType<typeof resolveVerificationDemoFrames> {
    return resolveVerificationDemoFrames(demo, demoFramesDir(demo.agentId, demo.id), fs.existsSync);
  }

  /** 시연 하나의 프레임 폴더를 통째로 지운다(레코드가 사라지면 그림도 함께 사라진다). */
  function removeDemoFrames(demo: VerificationDemo): void {
    const dir = demoFramesDir(demo.agentId, demo.id);
    if (!dir) return;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // 실패해도 레코드는 이미 지워졌다 — 남은 폴더는 고아 파일일 뿐 화면에 영향이 없다.
      logger.warn(`[verify] demo frames rm failed (${demo.id}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 검증 한 건을 그 탭 큐에 넣는다. 실패 사유는 호출자(REST)가 사용자에게 그대로 돌려준다.
   *
   * 겹쳐 쏘지 않는다 — 그 탭에 안 끝난 명령(사용자가 직접 보낸 것 포함)이 있으면 거절한다.
   * 검증은 앱을 띄우는 일이라 같은 탭에서 둘이 동시에 돌면 서로의 포트를 밟는다.
   */
  const verificationAutomation = new VerificationAutomationService({
    findRun: (id) => graphManager.findVerificationRun(id),
    updateRun: (id, patch) => graphManager.updateVerificationRun(id, patch),
    projectRoot: (agentId) => graphManager.getProjectPathForAgent(agentId),
    isCommandActive: (run) => {
      const sessionId = graphManager.findSessionByAgentId(run.agentId);
      const cmd = sessionId ? commandQueues.get(sessionId)?.find((c) => c.id === run.pendingCommandId && c.subAgentId === run.subAgentId) : undefined;
      // §5.3 #12-4 (E) ⑤ — 전용 경로도 같은 판정을 본다. 그 명령에 사람이 [검증 실행]으로 연 범위가 있을 때만.
      return verificationGate.commandAllows(cmd, ['browser']);
    },
    changed: () => { broadcastSnapshot(); saveCheckpoint(); },
  });

  async function startVerificationRun(
    agentId: string, subAgentId: string, focus?: string, demoId?: string,
    selectedTarget?: VerificationTarget, expected?: string,
  ): Promise<{ ok: true; run: VerificationRun } | { ok: false; error: string }> {
    const demo = demoId ? graphManager.findVerificationDemo(demoId) : undefined;
    const scopeError = verificationScopeError({ agentId, subAgentId, sub: subAgentManager.getSub(subAgentId), demoId, demo });
    if (scopeError) return { ok: false, error: scopeError };
    if (graphManager.getActiveVerificationRun(subAgentId)) return { ok: false, error: 'already-running' };
    const sessionId = graphManager.findSessionByAgentId(agentId);
    if (!sessionId) return { ok: false, error: 'session-not-found' };
    if (!graphManager.getProjectPathForAgent(agentId)) return { ok: false, error: 'project-not-found' };
    let queue = commandQueues.get(sessionId);
    if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
    const busy = (): boolean => queue!.some((c) => c.subAgentId === subAgentId && (c.status === 'queued' || c.status === 'executing'));
    if (busy()) return { ok: false, error: 'session-busy' };
    const target = selectedTarget ?? parseVerificationTarget(demo?.target);
    if (!target) return { ok: false, error: 'verification-target-required' };
    const adapter = getVerificationAutomationAdapter();
    if (!adapter) return { ok: false, error: 'verification-tools-unavailable' };
    const helper = hookHandlerPath ?? codexHookContext?.handlerPath;
    if (!helper || !fs.existsSync(path.join(path.dirname(helper), 'verification-tools.mjs')) || !getAppNodeRuntime().nodeBin) return { ok: false, error: 'verification-bridge-unavailable' };
    const demoFrames = demo ? demoFrameRefsForCommand(demo) : { ok: true as const, frames: [] };
    if (!demoFrames.ok) return { ok: false, error: demoFrames.error };
    const timestamp = Date.now();
    const runId = 'ver-' + timestamp + '-' + randomUUID().slice(0, 8);
    const cmdId = 'cmd-' + timestamp + '-verify-' + randomUUID().slice(0, 8);
    const run: VerificationRun = {
      id: runId, agentId, subAgentId, projectName: graphManager.getAgentProjectName(agentId) ?? '',
      target, focus: focus?.trim().slice(0, VERIFICATION_FOCUS_MAX),
      expected: (expected?.trim() || demo?.expected)?.slice(0, VERIFICATION_DEMO_EXPECTED_MAX),
      recipeSource: target.kind === 'browser' ? 'play-recipe' : 'none',
      recipeLabel: target.kind === 'browser' ? target.url : target.sourceName,
      ...(demo ? { demoId: demo.id, demoLabel: demo.label, procedure: structuredClone(demo.steps), requiredSteps: demo.steps.length } : {}),
      status: 'running', verdict: 'unknown', attempts: [], toolEvents: [], evidence: [],
      pendingCommandId: cmdId, startedAt: timestamp,
    };
    // Reserve the session before awaiting the OS; simultaneous starts cannot open two targets.
    const previous = graphManager.getVerificationRuns(subAgentId);
    graphManager.addVerificationRun(run);
    for (const evicted of previous) if (!graphManager.findVerificationRun(evicted.id)) verificationAutomation.remove(evicted);
    try {
      const available = await adapter.probe(target);
      if (!available.available) throw new Error(available.reason || 'verification-target-unavailable');
      if (busy()) throw new Error('session-busy');
      if (graphManager.findVerificationRun(runId)?.status !== 'running') throw new Error('verification-stopped');
      await verificationAutomation.open(run, demoFrames.frames.map((f) => f.path));
      if (busy()) throw new Error('session-busy');
      if (graphManager.findVerificationRun(runId)?.status !== 'running') throw new Error('verification-stopped');
      const command: QueuedCommand = {
        id: cmdId, text: buildVerificationAutomationPrompt(run, demo, demoFrames.frames.map((f) => f.path)),
        timestamp, subAgentId, status: 'queued',
        ...(demoFrames.frames.length ? { attachments: demoFrames.frames.map((f) => f.path) } : {}),
        // §5.3 #12-4 (C) — 사람이 검증 뷰에서 [검증 실행]을 눌렀다. 이 명령 하나에만 앱 조작 검증이 열린다.
        verificationScope: appRunVerificationScope(),
      };
      queue.push(command);
      processNextCommand(sessionId);
      return { ok: true, run: graphManager.findVerificationRun(runId) ?? run };
    } catch (error) {
      verificationAutomation.close(runId);
      const reason = error instanceof Error ? error.message : String(error);
      const finishedAt = Date.now();
      const current = graphManager.findVerificationRun(runId);
      if (current?.status === 'running') graphManager.updateVerificationRun(runId, { status: 'error', verdict: 'unknown', reason, finishedAt, durationMs: finishedAt - timestamp, pendingCommandId: undefined });
      broadcastSnapshot(); saveCheckpoint();
      return { ok: false, error: reason };
    }
  }

  /**
   * 완료된 명령 1건을 검증에 반영. `setOnComplete` 가 아카이브로 옮기기 전에 호출한다.
   *
   * `pendingCommandId` 대조로 **그 검증이 낸 명령만** 인정한다 — 사용자가 중간에 직접 보낸 명령이
   * 검증 결과로 오인되지 않는다(루프의 같은 규약).
   */
  function advanceVerificationRun(cmd: QueuedCommand): void {
    if (!cmd.subAgentId) return;
    const run = graphManager.getVerificationRuns(cmd.subAgentId).find((r) => r.pendingCommandId === cmd.id);
    if (!run) return;
    if (run.target) {
      if (typeof cmd.result === 'string' && cmd.result.startsWith('[Stopped by user]')) {
        verificationAutomation.close(run.id);
        const finishedAt = Date.now();
        graphManager.updateVerificationRun(run.id, { status: 'stopped', verdict: 'unknown', pendingCommandId: undefined, finishedAt, durationMs: finishedAt - run.startedAt });
      } else {
        verificationAutomation.finish(run.id, 'held', cmd.status === 'error' ? String(cmd.result ?? 'Agent execution failed.') : 'The agent ended without finalizing its evidence-based verdict.');
      }
      return;
    }

    const finishedAt = Date.now();
    const base = {
      pendingCommandId: undefined,
      finishedAt,
      durationMs: Math.max(0, finishedAt - run.startedAt),
    };

    // 사람이 [중지]로 끊은 턴은 통과도 실패도 아니다 — 판정을 지어내지 않는다.
    if (typeof cmd.result === 'string' && cmd.result.startsWith('[Stopped by user]')) {
      graphManager.updateVerificationRun(run.id, { ...base, status: 'stopped', verdict: 'unknown' });
      return;
    }
    if (cmd.status === 'error') {
      graphManager.updateVerificationRun(run.id, {
        ...base,
        status: 'error',
        verdict: 'unknown',
        ...(typeof cmd.result === 'string' ? { reason: cmd.result.slice(0, VERIFICATION_REASON_MAX) } : {}),
      });
      return;
    }

    const parsed = parseVerificationVerdict(typeof cmd.result === 'string' ? cmd.result : '');
    graphManager.updateVerificationRun(run.id, {
      ...base,
      status: 'done',
      verdict: parsed.verdict,
      ...(parsed.reason ? { reason: parsed.reason } : {}),
      attempts: parsed.attempts,
    });
    logger.info(
      `[verify] ${parsed.verdict} agent=${run.agentId} sub=${cmd.subAgentId} attempts=${parsed.attempts.length}`,
    );
  }

  /**
   * §4 API 크레딧 — 한도로 멈춘 헤드리스 명령을 다른 결제 경로로 한 번 잇는다(설정 `autoContinue`, 기본 켬).
   * - 구독 한도로 멈췄고(§5.5 #17-47 표식이 이 명령 시작 뒤) 지금 판정이 크레딧 → 크레딧으로. 크레딧 실행이 거절됐고(`creditCap` — 잔액 부족·월 지출 한도) 구독이 살아 있음 → 구독으로.
   * 원래 명령은 다시 보내지 않고 이어가기 지시(`API_CREDIT_CONTINUE_PROMPT`)만 같은 세션에 넣는다. 이어가기가 다시 멈추면 또 잇지 않는다(`autoContinueOf`).
   * 사용자가 끊은 턴·다른 엔진은 잇지 않고, 그 탭에 기다리거나 도는 명령이 있으면 넣지 않는다(직렬 보장).
   */
  function maybeAutoContinueOnQuota(cmd: QueuedCommand, queue: QueuedCommand[]): boolean {
    if (!cmd.subAgentId || cmd.autoContinueOf || cmd.silent) return false;
    const settings = apiCreditService.settings();
    if (!settings.enabled || !settings.autoContinue) return false;
    if (typeof cmd.result === 'string' && cmd.result.startsWith('[Stopped by user]')) return false;
    const sub = subAgentManager.getSub(cmd.subAgentId);
    if (!sub) return false;
    if (graphManager.getAgentConfig(sub.parentAgentId)?.provider) return false; // 코덱스·로컬은 이 축 밖
    const startedAt = cmd.startedAt ?? cmd.timestamp;
    const bySubscription = cmd.billingRoute !== 'credits' && !!sub.usageLimit && sub.usageLimit.at >= startedAt;
    const byCredits = cmd.billingRoute === 'credits' && cmd.error?.code === 'creditCap';
    if (!bySubscription && !byCredits) return false;
    const next = apiCreditService.decide();
    if (bySubscription && next.route !== 'credits') return false;
    if (byCredits && (next.route !== 'subscription' || apiCreditService.subscriptionState().exhausted)) return false;
    if (queue.some((c) => c.subAgentId === cmd.subAgentId && (c.status === 'queued' || c.status === 'executing'))) return false;
    queue.push({
      id: `cmd-${Date.now()}-autocontinue`,
      text: API_CREDIT_CONTINUE_PROMPT,
      timestamp: Date.now(),
      subAgentId: cmd.subAgentId,
      status: 'queued',
      autoContinueOf: cmd.id,
    });
    logger.info(`[api-credit] auto-continue sub=${cmd.subAgentId} after cmd=${cmd.id} (${bySubscription ? 'subscription limit → credits' : 'credit cap → subscription'})`);
    return true;
  }

  function advanceSessionLoop(cmd: QueuedCommand): void {
    if (!cmd.subAgentId) return;
    const subAgentId = cmd.subAgentId;
    const loop = graphManager.getSessionLoop(subAgentId);

    // §5.5 #17-11 ⑪ — 회차 사이에 끼워 넣은 압축이 끝났다. 압축은 회차가 아니므로 `completed` 를
    //   올리지 않고, 실패해도 루프를 죽이지 않는다(`stopOnError` 는 사용자 명령의 실패에만 적용).
    //   단 사용자가 그 압축을 [중지]로 끊었으면 ③ 규칙대로 루프도 함께 멈춘다.
    if (loop && loop.pendingCompactCommandId === cmd.id) {
      // §5.5 #17-11 ⑫(a) — 정리 명령도 토큰을 쓴다. 예산은 실제로 나간 것을 전부 센다.
      const usage = accrueSessionLoopUsage(loop, cmd);
      const stoppedCompact = typeof cmd.result === 'string' && cmd.result.startsWith('[Stopped by user]');
      if (stoppedCompact) {
        clearSessionLoopTimer(subAgentId);
        graphManager.updateSessionLoop(subAgentId, {
          enabled: false, status: 'stopped', pendingCommandId: undefined,
          pendingCompactCommandId: undefined, nextRunAt: undefined, ...usage,
        });
        logger.info(`[session-loop] stopped by user during context reset sub=${subAgentId}`);
      // §5.5 #17-11 ⑦·⑧ — 루프가 꺼진 자리에서 버블 완료 판정을 **같은 틱에** 당긴다. 늦게 실리면
      //   클라가 「루프 종료」와 「버블 완료」를 서로 다른 스냅샷에서 보고 같은 종료를 두 번 알린다.
      graphManager.recomputeCustomAgentStatus(loop.agentId);
        return;
      }
      if (cmd.status === 'error') {
        logger.warn(`[session-loop] context reset failed (loop continues) sub=${subAgentId}`);
      }
      graphManager.updateSessionLoop(subAgentId, { pendingCompactCommandId: undefined, ...usage });
      scheduleSessionLoop(subAgentId, loop.intervalMs);
      return;
    }

    if (!loop || loop.pendingCommandId !== cmd.id) return;

    const completed = loop.completed + 1;
    // §5.5 #17-11 ⑫(a) — 이 회차가 쓴 토큰·추정 비용을 누적에 더한다(정지 갈래에도 함께 실어야
    //   "멈춘 시점까지 얼마 썼는지"가 화면에 남는다).
    const usage = accrueSessionLoopUsage(loop, cmd);
    const stoppedByUser = typeof cmd.result === 'string' && cmd.result.startsWith('[Stopped by user]');
    const failed = cmd.status === 'error';
    const errText = failed && typeof cmd.result === 'string' ? cmd.result.slice(0, 300) : undefined;

    // 사용자가 그 회차를 끊었으면 루프도 끝 — "중지를 눌렀는데 다음 명령이 또 나간다"를 만들지 않는다.
    if (stoppedByUser) {
      clearSessionLoopTimer(subAgentId);
      graphManager.updateSessionLoop(subAgentId, {
        completed, enabled: false, status: 'stopped', pendingCommandId: undefined, nextRunAt: undefined, ...usage,
      });
      logger.info(`[session-loop] stopped by user sub=${subAgentId} completed=${completed}`);
      graphManager.recomputeCustomAgentStatus(loop.agentId); // ⑦·⑧ 완료 판정을 같은 틱에
      return;
    }

    if (failed && loop.stopOnError) {
      clearSessionLoopTimer(subAgentId);
      graphManager.updateSessionLoop(subAgentId, {
        completed, enabled: false, status: 'error', pendingCommandId: undefined, nextRunAt: undefined,
        lastError: errText ?? 'error', ...usage,
      });
      logger.warn(`[session-loop] stopped on error sub=${subAgentId} completed=${completed}`);
      graphManager.recomputeCustomAgentStatus(loop.agentId); // ⑦·⑧ 완료 판정을 같은 틱에
      return;
    }

    if (loop.mode === 'count' && completed >= (loop.total ?? 0)) {
      clearSessionLoopTimer(subAgentId);
      graphManager.updateSessionLoop(subAgentId, {
        completed, enabled: false, status: 'done', pendingCommandId: undefined, nextRunAt: undefined,
        lastError: errText, ...usage,
      });
      logger.info(`[session-loop] done sub=${subAgentId} completed=${completed}/${loop.total}`);
      graphManager.recomputeCustomAgentStatus(loop.agentId); // ⑦·⑧ 완료 판정을 같은 틱에
      return;
    }

    // §5.5 #17-11 ⑫(a) — 예산 판정은 **회차 경계에서만**. 돌던 회차는 끝까지 돌려 보내고,
    //   다음 회차를 내지 않는 방식으로 멈춘다(작업 중간에 잘리는 것이 더 나쁘다).
    const overBudget = sessionLoopBudgetExceeded(loop, usage.spentTokens, usage.spentCostUsd);
    if (overBudget) {
      clearSessionLoopTimer(subAgentId);
      graphManager.updateSessionLoop(subAgentId, {
        completed, enabled: false, status: 'budget', pendingCommandId: undefined,
        pendingCompactCommandId: undefined, nextRunAt: undefined, lastError: errText, ...usage,
      });
      logger.info(`[session-loop] budget reached sub=${subAgentId} completed=${completed} (${overBudget})`);
      graphManager.recomputeCustomAgentStatus(loop.agentId); // ⑦·⑧ 완료 판정을 같은 틱에
      return;
    }

    graphManager.updateSessionLoop(subAgentId, { completed, lastError: errText, ...usage });
    // §5.5 #17-11 ⑪·⑫(b) — 루프가 계속될 때만 컨텍스트 정리를 끼운다(끝나는 회차 뒤엔 쏘지 않는다 —
    //   위 네 갈래에서 이미 return 했다). 큐에 넣었으면 그 명령이 끝난 뒤 다음 회차를 예약한다.
    if (loop.contextMode !== 'none' && fireSessionLoopContextReset(subAgentId)) return;
    scheduleSessionLoop(subAgentId, loop.intervalMs);
  }

  /**
   * 안전망 스윕 — 타이머가 없어도(서버 재시작 직후, 예약 유실) 예정 시각이 지난 루프를 다시 굴린다.
   * 기존 세션 스캔 주기에 얹으므로 새 폴링 레일 ❌. 발사한 개수를 돌려준다.
   */
  function sweepSessionLoops(): number {
    const now = Date.now();
    let fired = 0;
    for (const loop of graphManager.listSessionLoops()) {
      if (!loop.enabled) continue;
      if (loop.pendingCommandId) {
        // 회차가 아직 도는 중이면 그대로 둔다. 단 그 명령이 큐에서 사라졌다면(사용자가 대기 명령을
        // 지웠거나 pop 했다면) 영원히 기다리게 되므로, 계수 없이 다음 회차로 넘어간다.
        const sessionId = graphManager.findSessionByAgentId(loop.agentId);
        const queue = sessionId ? commandQueues.get(sessionId) : undefined;
        if (queue?.some((c) => c.id === loop.pendingCommandId)) continue;
        graphManager.updateSessionLoop(loop.subAgentId, { pendingCommandId: undefined, status: 'waiting' });
      } else if (loop.pendingCompactCommandId) {
        // §5.5 #17-11 ⑪ — 회차 사이 압축이 도는 중이면 기다린다. 그 명령이 큐에서 사라졌다면
        //   (사용자가 지웠거나 서버가 재시작했다면) 압축을 영원히 기다리지 않고 다음 회차로 넘어간다.
        const sessionId = graphManager.findSessionByAgentId(loop.agentId);
        const queue = sessionId ? commandQueues.get(sessionId) : undefined;
        if (queue?.some((c) => c.id === loop.pendingCompactCommandId)) continue;
        graphManager.updateSessionLoop(loop.subAgentId, { pendingCompactCommandId: undefined, status: 'waiting' });
      } else {
        if (sessionLoopTimers.has(loop.subAgentId)) continue; // 정확 예약이 이미 걸림
        if ((loop.nextRunAt ?? 0) > now) continue;
      }
      if (fireSessionLoopIteration(loop.subAgentId)) fired++;
    }
    return fired;
  }

  // §9 — graph_snapshot 16ms trailing 디바운스: mutation(setOnMutated)마다의 getSnapshot()+broadcast 를 창 1회로 합친다.
  // flush 시점에 getSnapshot() 을 읽어야 한다 — 스케줄 시점에 캡처하면 창 안의 변경이 빠진다.
  // 인라인 직송 broadcast 는 즉시 나가지만 trailing 이 뒤에 최신 상태를 다시 보내므로 stale 덮어쓰기가 없다.
  // 부하 적응형 창 — getSnapshot()+IPC 직렬화는 Electron 메인 스레드에서 돌아, flush 비용이 16ms 를 넘으면 다음 창을 비용 비례로 늘린다(상한 250ms, 경부하면 16ms 로 복귀).
  // [perf-snapshot] 계측은 VIBISUAL_PERF=1 일 때만.
  const PERF_SNAPSHOT = process.env.VIBISUAL_PERF === '1';
  const snapshotBroadcast = createSnapshotBroadcastScheduler({
    minDelayMs: WS_BATCH_INTERVAL,
    maxDelayMs: WS_BATCH_INTERVAL_MAX,
    backoffFactor: WS_BATCH_BACKOFF_FACTOR,
    flush: flushSnapshot,
    onError: (error: unknown): void => { logger.error('[snapshot] broadcast failed', error); },
  });

  /**
   * §4 (첫 실행 온보딩) ③ — "고른 프로젝트 폴더가 없다"로 생성 요청을 돌려보낸다.
   * 서버에서도 막아야 한다 — 이 REST 는 모바일 웹·원격조작·바깥 도구로도 들어와, 화면만 막으면 임시 작업 폴더에 매인 유령 버블이 생긴다.
   * 코드는 shared `NO_PROJECT_FOLDER_ERROR` 한 곳이고, 클라 생성 손잡이는 그 코드를 보고 폴더 선택 게이트를 연다.
   */
  function respondNoProjectFolder(res: express.Response, where: string): void {
    logger.info(`${where}: 열린 프로젝트 폴더가 없어 생성을 거절 — 폴더 선택으로 유도`);
    res.status(409).json({ ok: false, error: NO_PROJECT_FOLDER_ERROR });
  }

  function broadcastSnapshot(): void {
    snapshotBroadcast.request();
  }

  function flushSnapshot(snapshotBroadcastDelay: number): void {
    if (PERF_SNAPSHOT) {
      const t0 = performance.now();
      const snap = graphManager.getBroadcastSnapshot();
      const t1 = performance.now();
      const bytes = JSON.stringify(snap).length; // 직렬화 비용 계측용(broadcast 가 다시 직렬화하지만 PERF 시에만)
      const t2 = performance.now();
      const agents = Array.isArray(snap.agents) ? snap.agents.length : Object.keys(snap.agents ?? {}).length;
      const subs = Object.keys(snap.subAgents ?? {}).length;
      logger.warn(
        `[perf-snapshot] getSnapshot=${(t1 - t0).toFixed(1)}ms stringify=${(t2 - t1).toFixed(1)}ms ` +
        `bytes=${bytes} agents=${agents} subAgents=${subs} nextDelay=${snapshotBroadcastDelay.toFixed(0)}ms`,
      );
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: snap });
    } else {
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
    }
  }

  // §5.3 #10-2 — Auto Agent 런타임. 사용자 메시지 → 서브 군 자동 생성·dispatch.
  // enqueueCommand 는 기존 `commandQueues` Map 에 push + processNextCommand 즉시 발사.
  const autoAgentRuntime = new AutoAgentRuntime({
    graphManager,
    setAgentConfig: (agentId, config) => {
      // §4 (설정 3층) — 부분 입력이 와도 **빠진 칸이 지워지지 않게** 지금 값 위에 얹어 넘긴다.
      //   종전 주석은 "호출자가 머지 후 전달 가정" 이었는데, 가정을 지키는 쪽이 여기여야
      //   빌더가 한 칸만 바꿔도 나머지가 온전하다(PUT 핸들러가 `base` 를 두는 것과 같은 규율).
      const base = graphManager.getAgentConfig(agentId) ?? resolveAgentDefaults(userDefaultsService.get());
      const merged: AgentConfig = { ...base };
      for (const [key, value] of Object.entries(config)) {
        if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value;
      }
      graphManager.setAgentConfig(agentId, merged);
    },
    enqueueCommand: (sessionId, text) => {
      // 빌더는 auto-agent 버블(customCreated) 자기 세션의 sub 로 돈다. `POST /api/commands/:sessionId`
      // 의 customCreated 분기와 동일하게, dispatch 전에 정규 sub 를 해석/생성해 cmd.subAgentId 로 박는다.
      // 이 해석을 빠뜨리면 execute() 가 subAgentId=null 로 sub 를 못 찾아 "SubAgent not found" 후 즉시
      // return → 빌더가 아예 스폰되지 않고 진행 표시만 영원히 'building' 으로 돈다.
      const agentId = graphManager.findAgentIdBySession(sessionId);
      const subAgentId = agentId
        ? (subAgentManager.getPrimarySub(agentId) ?? subAgentManager.create(agentId)).id
        : null;
      let queue = commandQueues.get(sessionId);
      if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
      // §5.3 #12-4 (B) — 빌더 명령의 본문은 사용자가 Auto Agent 버블에 보낸 원문이다(그 창구는 loopback 에
      //   열려 있지 않다 — 사람만 부른다). 하네스 멤버의 첫 명령은 이 범위를 물려받기만 한다(아래 commands 창구).
      const builderScope = verificationScopeFromText(text);
      const cmd: QueuedCommand = {
        id: `cmd-${Date.now()}-${queue.length}`,
        text,
        timestamp: Date.now(),
        subAgentId,
        status: 'queued' as const,
        ...(builderScope ? { verificationScope: builderScope } : {}),
      };
      queue.push(cmd);
      processNextCommand(sessionId);
    },
    broadcastSnapshot,
    saveCheckpoint: () => saveCheckpoint(),
    // §5.3 #10-2 — 빌더가 curl 로 닿을 loopback 베이스. buildOutboundEdgesRulesSection 과 같은 근거
    // (외부 claude 프로세스는 hook 리스너 동적 포트로만 in-process 서버에 닿는다).
    getServerBase: () => `http://127.0.0.1:${hookListenerPort ?? port}`,
    getServerToken: () => hookListenerToken ?? '',
    broadcastAutoAgentProgress: (autoAgentId, summary) => {
      broadcast({
        type: 'auto_agent_progress',
        timestamp: Date.now(),
        payload: { autoAgentId, summary },
      });
    },
  });

  /** POST /api/layout-bounds/:projectName — 루트 캔버스 바운딩 박스 크기 저장 */
  app.post('/api/layout-bounds/:projectName', (req, res) => {
    const { projectName } = req.params;
    const body = req.body as { hw?: unknown; hh?: unknown };
    if (typeof body.hw !== 'number' || !Number.isFinite(body.hw)) {
      return res.status(400).json({ error: 'hw must be number' });
    }
    if (typeof body.hh !== 'number' || !Number.isFinite(body.hh)) {
      return res.status(400).json({ error: 'hh must be number' });
    }
    const hw = Math.min(8000, Math.max(300, Math.round(body.hw)));
    const hh = Math.min(8000, Math.max(300, Math.round(body.hh)));
    const changed = graphManager.setLayoutBounds(projectName, hw, hh);
    if (changed) broadcastSnapshot();
    res.json({ ok: true, hw, hh });
  });

  /** §5.5 #17-29 — agentId 로 버블을 찾아 훅(읽기 전용)인지 판정한다. 쓰기 REST 가드 공용.
   *  버블을 못 찾아도 훅으로 본다(`isReadOnlyHookAgent` 규약 — 모르면 쓰지 않는다). */
  const isReadOnlyHookAgentId = (agentId: string): boolean =>
    isReadOnlyHookAgent(graphManager.getSnapshot().agents.find((a) => a.id === agentId));

  /** GET /api/commands/:sessionId — 훅/스크립트에서 대기열 조회 */
  app.get('/api/commands/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const queue = commandQueues.get(sessionId) ?? [];
    res.json({ commands: queue });
  });

  /**
   * 에이전트 프롬프트 이미지 paste 업로드. sessionId 는 URL param 이다 — multer 가 body 를 이미지 다음에 파싱해 body 에 두면 destination 콜백에서 못 읽는다.
   * 저장: `<agentCwd>/.vibisual/attachments/<sessionId>/<uuid>.<ext>` 절대경로. 응답의 `path` 를 `QueuedCommand.attachments[]` 로 보내면 dispatch 때 프롬프트에 주입된다.
   */
  const attachmentsUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const raw = req.params['sessionId'];
        const sessionId = typeof raw === 'string' ? raw : '';
        if (!sessionId || sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
          return cb(new Error('invalid sessionId'), '');
        }
        const cwd = graphManager.getAgentCwd(sessionId);
        if (!cwd) return cb(new Error('agent not found for session'), '');
        const dir = path.join(cwd, '.vibisual', 'attachments', sessionId);
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
          return cb(err instanceof Error ? err : new Error('mkdir failed'), '');
        }
        cb(null, dir);
      },
      filename: (_req, file, cb) => {
        const rawExt = path.extname(file.originalname).toLowerCase();
        const safeExt = /^\.[a-z0-9]{1,8}$/.test(rawExt) ? rawExt : '.bin';
        cb(null, `${randomUUID()}${safeExt}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 }, // 10MB per file
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) {
        cb(new Error('only image/* mime types allowed'));
        return;
      }
      cb(null, true);
    },
  });

  app.post('/api/agent-attachments/:sessionId/upload', (req, res) => {
    attachmentsUpload.single('image')(req, res, (err?: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: msg });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'no file uploaded (field name must be "image")' });
        return;
      }
      res.json({ ok: true, path: req.file.path, filename: req.file.filename, size: req.file.size });
    });
  });

  /**
   * 업로드 취소/대기 중 삭제.
   * 제출 전 사용자가 썸네일을 제거하거나 팝업을 닫을 때 호출.
   * 제출 응답을 잃으면 복원된 초안에서도 호출될 수 있다. 큐/완료 기록의 첨부는 보존한다.
   */
  app.delete('/api/agent-attachments/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const { filePath } = req.body as { filePath?: string };
    if (!sessionId || sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
      res.status(400).json({ error: 'invalid sessionId' });
      return;
    }
    if (typeof filePath !== 'string' || !filePath) {
      res.status(400).json({ error: 'filePath required' });
      return;
    }
    const cwd = graphManager.getAgentCwd(sessionId);
    if (!cwd) {
      res.status(404).json({ error: 'agent not found for session' });
      return;
    }
    const expectedDir = path.resolve(path.join(cwd, '.vibisual', 'attachments', sessionId));
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(expectedDir + path.sep)) {
      res.status(403).json({ error: 'path outside attachments dir' });
      return;
    }
    const references = [...(commandQueues.get(sessionId) ?? []), ...(completedCommandArchive.get(sessionId) ?? [])];
    if (findReferencedCommandAttachment(resolvedPath, expectedDir, references)) {
      res.json({ ok: true, retained: true });
      return;
    }
    // Keep the reference check and deletion in one event-loop turn: a new command
    // must not acquire this file while an asynchronous unlink is still pending.
    try {
      fs.unlinkSync(resolvedPath);
    } catch (unlinkErr) {
      if ((unlinkErr as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`attachment unlink failed: ${resolvedPath} — ${unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr)}`);
        res.status(500).json({ error: 'unlink failed' });
        return;
      }
    }
    res.json({ ok: true });
  });

  /**
   * GET /api/agent-attachments/:sessionId/file?rel=<subId/uuid.ext | uuid.ext> — 디스크에 보존된 첨부 이미지를 서빙한다.
   *  메모리 blob URL 은 별창·새로고침·재시작에서 사라지므로 클라가 이 파일로 현재 document 에서 blob 을 다시 만든다.
   *  그 세션 attachments 디렉토리 안 파일만 허용(트래버설 차단). IPC 트랜스포트는 비텍스트 응답을 base64 로 무손실 전달한다.
   */
  app.get('/api/agent-attachments/:sessionId/file', (req, res) => {
    const { sessionId } = req.params;
    const rel = typeof req.query.rel === 'string' ? req.query.rel : '';
    if (!sessionId || sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
      res.status(400).json({ error: 'invalid sessionId' });
      return;
    }
    if (!rel) {
      res.status(400).json({ error: 'rel required' });
      return;
    }
    const cwd = graphManager.getAgentCwd(sessionId);
    if (!cwd) {
      res.status(404).json({ error: 'agent not found for session' });
      return;
    }
    const expectedDir = path.resolve(path.join(cwd, '.vibisual', 'attachments', sessionId));
    const resolvedPath = path.resolve(expectedDir, rel);
    if (!resolvedPath.startsWith(expectedDir + path.sep)) {
      res.status(403).json({ error: 'path outside attachments dir' });
      return;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!stat.isFile()) {
      res.status(404).json({ error: 'not a file' });
      return;
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const mime =
      ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.gif' ? 'image/gif'
      : ext === '.webp' ? 'image/webp'
      : ext === '.svg' ? 'image/svg+xml'
      : 'application/octet-stream';
    try {
      const buf = fs.readFileSync(resolvedPath);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(buf);
    } catch (err) {
      logger.warn(`attachment read failed: ${resolvedPath} — ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ error: 'read failed' });
    }
  });

  /**
   * POST /api/commands/:sessionId — 명령 추가.
   *  두 경로 수용: (1) JSON `{ text, subAgentId?, attachments?, dispatchMode? }`,
   *  (2) raw text/plain 본문 — 하네스 빌더(§5.3 #10-2)가 엔트리 노드를 escape-free 로 kickoff.
   *  §5.5 #17-18 — `dispatchMode` 미지정/알 수 없는 값이면 기본(합치기)으로 떨어진다.
   */
  app.post('/api/commands/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    let text: string | undefined;
    let subAgentId: string | null | undefined;
    let attachments: string[] | undefined;
    let dispatchMode: CommandDispatchMode = DEFAULT_COMMAND_DISPATCH_MODE;
    let runLimits: QueuedCommand['runLimits'];
    let executionRequirements: QueuedCommand['executionRequirements'];
    // §5.1 #2-1 (F) ① — 말풍선이 넣은 앱 노드. 이 명령 중 쓴 파일에 앱 꼬리표를 다는 열쇠다(모양이 맞는 id 만).
    let appNodeIds: string[] | undefined;
    // 말풍선에서 이어진 앱을 모두 뺀 명령 — 이 명령 중 쓴 파일은 앱 작업물이 아니다(폴백도 없다).
    let appNodesOff = false;
    let afterAgentWork = false;
    if (typeof req.body === 'string') {
      // express.text() 가 파싱한 raw 본문. 끝의 heredoc 잔여 개행만 정리.
      text = req.body.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    } else {
      const body = (req.body ?? {}) as { text?: string; subAgentId?: string | null; attachments?: string[]; dispatchMode?: unknown; runLimits?: unknown; executionRequirements?: unknown; afterAgentWork?: unknown; appNodeIds?: unknown; appNodesOff?: unknown };
      text = body.text;
      subAgentId = body.subAgentId;
      attachments = body.attachments;
      dispatchMode = normalizeCommandDispatchMode(body.dispatchMode);
      runLimits = normalizeRunLimits(body.runLimits);
      executionRequirements = normalizeExecutionRequirements(body.executionRequirements);
      appNodeIds = normalizeAppNodeIds(body.appNodeIds);
      appNodesOff = body.appNodesOff === true;
      afterAgentWork = body.afterAgentWork === true;
    }
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text required' });
      return;
    }

    const agentId = graphManager.findAgentIdBySession(sessionId);
    const agentBubble = graphManager.getAgentBySession(sessionId);

    if (subAgentId && hasForeignSubAgent((id) => subAgentManager.getSub(id), agentId ?? undefined, [subAgentId])) {
      res.status(404).json({ ok: false, error: 'session not found for agent' });
      return;
    }

    // §5.5 #17-29 — 훅 버블은 읽기 전용. 우리가 spawn 하지 않은 외부 세션이라 여기에 명령을 넣으면
    //   스폰 주입(컨텍스트 요약·카드 지시문·목표·집행 플러그인) 없이 매달리는 자식이 생긴다.
    //   클라 UI 를 우회한 curl 도 여기서 막힌다 — 화면이 아니라 서버가 경계의 권위다.
    if (isReadOnlyHookAgent(agentBubble)) {
      res.status(403).json({ error: READ_ONLY_HOOK_AGENT_ERROR });
      return;
    }

    // All Model은 이미지 입력을 지원하지 않는다. 첨부 이동·세션 생성 전에 거절한다.
    if (agentId && graphManager.getAgentConfig(agentId)?.provider?.kind === 'local-llama'
      && Array.isArray(attachments) && attachments.length > 0) {
      res.status(415).json({ error: 'local-images-unsupported' });
      return;
    }

    // §5.3 #10-4 — 킥오프 표식(`?orchestraRunId=`)은 **loopback 에서 온 것만** 읽는다. 지휘자는 앱이 띄운
    //   자식이라 loopback 으로만 닿는다 — 바깥에서 붙인 표식은 없던 것으로 보고 아래 가로채기 판정으로 흘린다.
    //   검사는 sub 를 고르기(= 새 sub 를 만들 수 있다) **전에** 한다 — 거절할 명령이 흔적을 남기지 않게.
    const fromLoopback = req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE;
    const kickoffRunId = fromLoopback && typeof req.query['orchestraRunId'] === 'string'
      ? req.query['orchestraRunId'].trim()
      : '';
    // 준비되지 않은 다른 엔진은 명령/첨부를 옮기기 전에 거절한다. 클라는 원 입력을 복원하고 준비 창을 연다.
    const orchestraRoot = agentId ? graphManager.getOrchestraRootForAgent(agentId) : null;
    const orchestraCfg = agentId ? graphManager.getAgentConfig(agentId) : undefined;
    const orchestraEngine = orchestraEngineOf(orchestraCfg);
    const intercept = !kickoffRunId && !!agentId && !!orchestraRoot && shouldInterceptOrchestra({
      fromLoopback,
      customCreated: !!agentBubble?.customCreated,
      isAutoBubble: !!graphManager.getAutoAgentSummary(sessionId),
      executionMode: orchestraCfg?.executionMode,
      engine: orchestraEngine,
      text,
      silent: false,
      enabled: resolveOrchestraEnabled(graphManager.getOrchestraSettings(orchestraRoot), agentId),
      edgeCommand: false,
    });
    if (intercept && orchestraRoot && orchestraEngine) {
      const preparation = orchestraPreparationForRequest(graphManager.getOrchestraSettings(orchestraRoot), orchestraEngine, currentOrchestraReadiness());
      if (preparation) {
        respondOrchestraCheck(res, { ok: false, status: 409, error: 'orchestra-engine-not-ready', preparation });
        return;
      }
    }
    if (kickoffRunId) {
      const kickoffRun = graphManager.findOrchestraRun(kickoffRunId);
      const kickoffRoot = agentId ? graphManager.getOrchestraRootForAgent(agentId) : null;
      const check = checkOrchestraKickoff(kickoffRun, {
        fromLoopback,
        targetAgentId: agentId,
        targetCustomCreated: !!agentBubble?.customCreated,
        sameProject: !!kickoffRun && !!kickoffRoot && samePath(kickoffRoot, kickoffRun.projectPath),
      });
      if (!check.ok) {
        respondOrchestraCheck(res, check);
        return;
      }
    }

    // subagent 결정: 지정된 ID 사용 → (커스텀: 정규 sub 1개 고정 재사용) → idle 재사용 → 새로 생성
    let resolvedSubId = subAgentId ?? null;
    if (!resolvedSubId && agentId) {
      if (agentBubble?.customCreated) {
        // 커스텀 에이전트 = 하나의 안정 대화: 정규 sub(대화 성립된 것 우선) 하나만 재사용한다.
        // 명령마다 새 sub 를 만들면 새 Claude 세션이 생겨 연속성을 잃고 새 훅 버블로 증식한다.
        // 진행 중이면 processNextCommand 의 busy 가드가 큐잉한다(동시 dispatch 방지).
        const primary = subAgentManager.getPrimarySub(agentId);
        resolvedSubId = (primary ?? subAgentManager.create(agentId)).id;
      } else {
        const idleSubs = subAgentManager.getIdleSubs(agentId);
        const lastIdle = idleSubs[idleSubs.length - 1];
        if (lastIdle) {
          resolvedSubId = lastIdle.id;
        } else {
          const newSub = subAgentManager.create(agentId);
          resolvedSubId = newSub.id;
        }
      }
    }

    // attachments 경로 검증: 그 세션 attachments 디렉토리 안만 허용(위조 경로로 CLI 에 임의 파일을 넣지 못하게).
    // 제출 확정 시 <agentPath>/<subId>/<uuid>.<ext> 로 옮겨 서브세션별로 격리한다. 이동 실패(권한/크로스 디바이스)면 원본 경로 유지.
    let resolvedAttachments: string[] | undefined;
    if (Array.isArray(attachments) && attachments.length > 0) {
      const cwd = graphManager.getAgentCwd(sessionId);
      if (cwd) {
        const expectedDir = path.resolve(path.join(cwd, '.vibisual', 'attachments', sessionId));
        const references = [...(commandQueues.get(sessionId) ?? []), ...(completedCommandArchive.get(sessionId) ?? [])];
        const owned = new Set<string>();
        const valid: string[] = [];
        for (const a of attachments) {
          if (typeof a !== 'string') continue;
          const resolved = path.resolve(a);
          if (!resolved.startsWith(expectedDir + path.sep)) continue;
          const exists = fs.existsSync(resolved);
          const reference = findReferencedCommandAttachment(resolved, expectedDir, references, !exists);
          // An accepted command may already have moved the upload before its
          // reply was lost. Recover through its record, never a directory scan.
          const candidate = reference ?? resolved;
          if (!exists && (!reference || !fs.existsSync(reference))) continue;
          valid.push(candidate);
          if (reference) owned.add(candidate);
        }
        if (valid.length > 0) {
          // resolvedSubId 가 있고 /, \\, .. 가 없으면 서브폴더로 이동.
          const safeSubId =
            resolvedSubId && !resolvedSubId.includes('/') && !resolvedSubId.includes('\\') && !resolvedSubId.includes('..')
              ? resolvedSubId
              : null;
          if (safeSubId) {
            const subDir = path.join(expectedDir, safeSubId);
            try { fs.mkdirSync(subDir, { recursive: true }); } catch { /* 실패해도 원본 경로로 fallback */ }
            const moved: string[] = [];
            for (const src of valid) {
              // Moving a shared file would invalidate the earlier command's path.
              if (owned.has(src)) { moved.push(src); continue; }
              const dest = path.join(subDir, path.basename(src));
              try {
                fs.renameSync(src, dest);
                moved.push(dest);
              } catch (err) {
                logger.warn(`attachment move failed: ${src} → ${dest} (${err instanceof Error ? err.message : String(err)})`);
                moved.push(src);
              }
            }
            resolvedAttachments = moved;
          } else {
            resolvedAttachments = valid;
          }
        }
      }
    }

    let queue = commandQueues.get(sessionId);
    if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
    /*
     * §5.3 #9 — 대기열 상한은 loopback 유입에만 건다. 에이전트가 자기 세션에 명령을 넣으면 Stop 훅이 꺼내 다시 띄우므로,
     *   상한이 없으면 "끝나면 나를 다시 불러라"가 끊기지 않는 고리가 된다.
     *   손으로 쌓는 명령(렌더러 IPC)은 막지 않는다 — 실측 한 자릿수이고 사람이 스스로 멈출 수 있다.
     */
    if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE
      && queue.filter((c) => c.status === 'queued').length >= COMMAND_QUEUE_MAX_PER_SESSION) {
      logger.warn(`commands(${sessionId}): loopback ingress refused — queue already at ${COMMAND_QUEUE_MAX_PER_SESSION} (§5.3 #9)`);
      res.status(429).json({ ok: false, error: 'command-queue-full', limit: COMMAND_QUEUE_MAX_PER_SESSION });
      return;
    }
    const waitForCommandIds = afterAgentWork
      ? captureAgentWorkCommandIds(commandQueues, sessionId, (id) => graphManager.findAgentIdBySession(id) ?? subAgentManager.findSubBySessionId(id)?.parentAgentId)
      : [];
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now()}-${queue.length}`,
      text: text.trim(),
      timestamp: Date.now(),
      subAgentId: resolvedSubId,
      status: 'queued' as const,
      ...(resolvedAttachments ? { attachments: resolvedAttachments } : {}),
      // §5.5 #17-18 — 항상 명시 저장. 화면의 [대기|합치기|즉시] 칩이 이 값을 그대로 그린다.
      dispatchMode,
      // §5.13 (R-10) — 제작 앱의 '빠른 초안 / 정교하게'가 실은 명령 한 건의 상한(실행할 때 엔진이 지원하면 건다).
      ...(runLimits ? { runLimits } : {}),
      ...(executionRequirements ? { executionRequirements } : {}),
      ...(appNodeIds ? { appNodeIds } : appNodesOff ? { appNodesOff: true as const } : {}),
      ...(waitForCommandIds.length ? { waitForCommandIds } : {}),
    };
    /*
     * §5.3 #12-4 (B) — 검증 권한은 **사람 창구로 들어온 본문에서만** 선다. loopback(에이전트가 토큰으로 넣은
     *   명령)은 읽지 않는다 — AI 가 쓴 계획·명령은 권한이 아니다. 요청 본문에 같은 이름 칸이 와도 읽지 않는다
     *   (서버만 찍는다 — `approved=true` 를 적어 권한을 만들 길이 없다).
     */
    if (!fromLoopback) {
      const scope = verificationScopeFromText(cmd.text);
      if (scope) cmd.verificationScope = scope;
    } else if (!kickoffRunId) {
      // §5.3 #12-4 (D) — Auto Agent 하네스의 킥오프(빌더가 loopback 으로 넣는 명령)는 그 하네스를 부른 사용자
      //   메시지(빌더 명령)의 범위를 물려받기만 한다. 본문은 읽지 않는다 — 빌더가 옮겨 적은 글은 AI 의 글이다.
      const builderCommand = findAutoAgentBuilderCommandFor(sessionId);
      const inherited = builderCommand
        ? inheritVerificationScope(builderCommand.verificationScope, builderCommand.verification, builderCommand.id)
        : undefined;
      if (inherited) cmd.verificationScope = inherited;
    }
    // §5.3 #10-4 — 오케스트라. 킥오프면 그 런에 묶고(토큰 귀속 · 덧말 합치기 경계), 아니면 가로채기 조건을
    //   **전부** 볼 때만 지휘 런을 연다. 하나라도 어긋나면 이 기능이 없던 때와 똑같이 흐른다.
    if (kickoffRunId) {
      cmd.orchestraRunId = kickoffRunId;
      // §5.3 #12-4 (D) — 멤버 킥오프는 지휘 런을 연 **사용자 명령**의 범위를 물려받기만 한다(넓히지 못한다).
      const rootCommandId = graphManager.findOrchestraRun(kickoffRunId)?.commandId;
      const rootCommand = rootCommandId ? findCommandById(rootCommandId) : undefined;
      const inherited = rootCommand ? inheritVerificationScope(rootCommand.verificationScope, rootCommand.verification, rootCommand.id) : undefined;
      if (inherited) cmd.verificationScope = inherited;
    } else if (agentId) {
      if (intercept && orchestraRoot && orchestraEngine) {
        const now = Date.now();
        const run: OrchestraRun = {
          runId: `orc-${now}-${Math.random().toString(36).slice(2, 8)}`,
          projectPath: orchestraRoot,
          agentId,
          commandId: cmd.id,
          userRequest: clipOrchestraRequest(cmd.text),
          engine: orchestraEngine,
          phase: 'conducting',
          startedAt: now,
          memberAgentIds: [],
          inputTokens: 0,
          outputTokens: 0,
        };
        if (graphManager.addOrchestraRun(run)) {
          cmd.orchestraRunId = run.runId;
          scheduleCheckpoint();
          logger.info(`[orchestra] run ${run.runId} opened on ${agentId} (${orchestraEngine})`);
        }
      }
    }
    queue.push(cmd);
    // §5.5 #17-18 — '즉시'면 도는 턴을 먼저 끊는다. 끊긴 뒤 close 핸들러 → setOnComplete 가
    //   이 명령을 `--resume` 으로 dispatch 하므로, 여기서 또 밀면 죽어가는 자식과 겹칠 수 있다.
    const interrupted = dispatchMode === 'immediate' && interruptForImmediateCommand(cmd, sessionId);
    // §5.5 #17-4 — 명령 텍스트의 `/skill-name` 토큰을 프로젝트 사용 카운트에 반영(SkillsView 정렬 키·배지).
    graphManager.recordSkillUsageFromCommandText(sessionId, cmd.text);
    res.json({ ok: true, command: cmd });
    broadcastSnapshot();

    // 즉시 실행 시도 (끊은 경우는 그 턴이 마감되는 시점에 자동으로 이어진다)
    if (!interrupted) processNextCommand(sessionId);
  });

  /**
   * §5.5 #17-18 — PATCH /api/commands/:sessionId/:commandId/mode — 대기 중인 명령의 처리 방식 변경.
   * body `{ dispatchMode: 'wait' | 'merge' | 'immediate' }`. `queued` 명령만 대상 — 이미 나간 턴은 되돌릴 수 없다(409).
   * `immediate` 로 바꾸면 그 자리에서 도는 턴을 끊고 이 명령이 다음 턴이 된다.
   */
  app.patch('/api/commands/:sessionId/:commandId/mode', (req, res) => {
    const { sessionId, commandId } = req.params;
    const { dispatchMode } = (req.body ?? {}) as { dispatchMode?: unknown };
    const mode = normalizeCommandDispatchMode(dispatchMode);
    const queue = commandQueues.get(sessionId);
    const cmd = queue?.find((c) => c.id === commandId);
    if (!cmd) {
      res.status(404).json({ error: 'command not found' });
      return;
    }
    if (cmd.status !== 'queued') {
      res.status(409).json({ error: 'command already dispatched' });
      return;
    }
    cmd.dispatchMode = mode;
    let interrupted = false;
    if (mode === 'immediate') interrupted = interruptForImmediateCommand(cmd, sessionId);
    res.json({ ok: true, command: cmd, interrupted });
    broadcastSnapshot();
    // 실행 중인 게 없었다면(끊을 것이 없었다면) 지금 바로 나갈 수 있는지 확인.
    if (mode === 'immediate' && !interrupted) processNextCommand(sessionId);
  });

  /** DELETE /api/commands/:sessionId/:commandId — 명령 제거 */
  app.delete('/api/commands/:sessionId/:commandId', (req, res) => {
    const { sessionId, commandId } = req.params;
    const queue = commandQueues.get(sessionId);
    if (!queue) { res.json({ ok: true }); return; }
    const idx = queue.findIndex((c) => c.id === commandId);
    const [removed] = idx >= 0 ? queue.splice(idx, 1) : [];
    // §5.3 #10-4 — 지운 명령이 지휘 명령이면 그 런을 닫는다(신고 없이 끝났다 = `unreported`, 이미 신고했으면
    //   끝난 시각만). 도는 중에 지웠으면 그 턴의 덮어쓴 설정도 함께 내린다 — 완료 정산이 이 명령을 못 본다.
    if (removed?.orchestraRunId) {
      const removedId = removed.id;
      const settledAt = Date.now();
      graphManager.updateOrchestraRun(removed.orchestraRunId, (r) => settleConductorTurn(r, { id: removedId, status: 'error' }, settledAt));
      if (graphManager.findOrchestraRun(removed.orchestraRunId)?.commandId === removedId) {
        cancelOrchestraWork(removed.orchestraRunId, 'conductor command removed');
      } else if (orchestraResults.isEntry(removed.orchestraRunId, removedId)) {
        cancelOrchestraWork(removed.orchestraRunId, 'entry command removed');
      } else {
        settleDispatchCommand(removed, { outcome: { status: 'cancelled', errorMessage: 'orchestra command removed' }, updateEdge: true });
      }
      if (removed.status === 'executing' && removed.subAgentId) subAgentManager.stop(removed.subAgentId);
      if (removed.subAgentId && orchestraTurnConfigs.get(removed.subAgentId)?.commandId === removedId) {
        orchestraTurnConfigs.delete(removed.subAgentId);
      }
      if (removed.subAgentId && configTrimTurnConfigs.get(removed.subAgentId)?.commandId === removedId) {
        configTrimTurnConfigs.delete(removed.subAgentId);
      }
      scheduleCheckpoint();
    }
    // §5.3 #10-2 — 안 나간 위임 명령을 지우면 그 작업은 취소로 끝난다(장부·동기 대기·엣지가 함께 내려간다).
    if (removed?.status === 'queued') {
      settleDispatchCommand(removed, { outcome: { status: 'cancelled', errorMessage: 'removed from queue before start' }, updateEdge: true, neverStarted: true });
    }
    res.json({ ok: true });
    broadcastSnapshot();
    // Removing an unstarted predecessor may release a new task without any completion callback.
    if (removed?.status === 'queued') processNextCommand(sessionId);
  });

  /** POST /api/commands/:sessionId/pop — 1번 명령 꺼내기 (실행용) */
  app.post('/api/commands/:sessionId/pop', (req, res) => {
    const { sessionId } = req.params;
    const queue = commandQueues.get(sessionId);
    if (!queue || queue.length === 0) {
      res.json({ command: null });
      return;
    }
    const cmd = queue.shift()!;

    // pop 메타 기록 — buildAgentEvents에서 source 매칭용
    let popped = poppedCommands.get(sessionId);
    if (!popped) { popped = []; poppedCommands.set(sessionId, popped); }
    popped.push({ text: cmd.text, queuedAt: cmd.timestamp, poppedAt: Date.now() });
    // 오래된 기록 정리 (최대 30개)
    if (popped.length > 30) popped.splice(0, popped.length - 30);

    res.json({ command: cmd });
    broadcastSnapshot();
  });

  /**
   * PUT /api/commands/:sessionId/reorder — 순서 변경.
   * §5.3 #9-1 (P) — 자리(index)가 아니라 명령(id)으로 받는다 — 우리가 끼운 조용한 압축은 화면에서 빠져 화면의 N번째와 큐의 N번째가 다르다.
   * 옛 클라이언트의 `fromIndex`/`toIndex` 도 받는다(id 가 없을 때만).
   */
  app.put('/api/commands/:sessionId/reorder', (req, res) => {
    const { sessionId } = req.params;
    const { fromIndex, toIndex, fromId, toId } = req.body as {
      fromIndex?: number; toIndex?: number; fromId?: string; toId?: string;
    };
    const queue = commandQueues.get(sessionId);
    if (!queue) { res.json({ ok: true }); return; }
    const from = typeof fromId === 'string' ? queue.findIndex((c) => c.id === fromId) : fromIndex;
    const to = typeof toId === 'string' ? queue.findIndex((c) => c.id === toId) : toIndex;
    if (typeof from !== 'number' || typeof to !== 'number') {
      res.status(400).json({ error: 'fromId/toId (or fromIndex/toIndex) required' });
      return;
    }
    // 못 찾은 id(-1)·범위 밖 자리는 **조용히 무시한다** — 그 사이 명령이 끝나 큐에서 빠진 것이라
    //   사용자 잘못이 아니고, 억지로 splice 하면 엉뚱한 명령이 움직인다.
    if (from < 0 || from >= queue.length || to < 0 || to >= queue.length || from === to) {
      res.json({ ok: true });
      return;
    }
    const [moved] = queue.splice(from, 1);
    if (moved) queue.splice(to, 0, moved);
    res.json({ ok: true });
    broadcastSnapshot();
  });

  /**
   * §5.5 #17-11 — PUT /api/session-loop/:agentId/:subId — 세션 반복 실행(루프) 설정 저장.
   * body: `{ command, mode:'count'|'infinite', total?, intervalMs?, stopOnError?, contextMode?,
   *   maxCostUsd?, maxTokens?, maxDurationMs?, progressFile?, oneTaskPerRound?, commitEachRound?,
   *   commandFile?, enabled? }` (전체 저장 — 한 필드만 보내면 나머지는 기본값으로 되돌아간다).
   * `enabled:true` 면 저장 즉시 1회차를 발사한다([시작]). 렌더러 in-process fetch 라 loopback 허용 목록이 필요 없다.
   */
  app.put('/api/session-loop/:agentId/:subId', subAgentOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    const { agentId, subId } = req.params;
    // §5.5 #17-29 — 루프는 회차마다 큐에 명령을 직접 넣는다(= `POST /api/commands` 를 우회하는
    //   또 하나의 입력구). 훅 버블은 읽기 전용이라 여기서도 막는다.
    if (isReadOnlyHookAgentId(agentId)) {
      res.status(403).json({ ok: false, error: READ_ONLY_HOOK_AGENT_ERROR });
      return;
    }
    const body = (req.body ?? {}) as {
      command?: string; mode?: string; total?: number;
      intervalMs?: number; stopOnError?: boolean; enabled?: boolean;
      contextMode?: string;
      maxCostUsd?: number; maxTokens?: number; maxDurationMs?: number;
      progressFile?: string; oneTaskPerRound?: boolean; commitEachRound?: boolean; commandFile?: string;
    };

    // §5.5 #17-11 ⑫(c)(f) — 경로 입력 정리. 백슬래시는 슬래시로 통일하고 앞의 `./` 는 떼어
    //   프롬프트에 실릴 때·경로를 풀 때 같은 모양이 되게 한다. 빈 문자열이면 미설정.
    const cleanPath = (v: unknown): string | undefined => {
      if (typeof v !== 'string') return undefined;
      const s = v.trim().replace(/\\/g, '/').replace(/^\.\//, '').slice(0, SESSION_LOOP_PATH_MAX);
      return s ? s : undefined;
    };
    const commandFile = cleanPath(body.commandFile);
    const progressFile = cleanPath(body.progressFile);

    const command = typeof body.command === 'string' ? body.command.trim() : '';
    // §5.5 #17-11 ⑫(f) — 본문을 파일에서 읽는 루프는 저장 시점에 본문이 비어 있어도 된다
    //   (파일이 원본이다). 다만 파일을 못 읽는 회차의 대비책이므로 있으면 그대로 보관한다.
    if (!command && !commandFile) {
      res.status(400).json({ error: 'command required' });
      return;
    }
    if (!subAgentManager.getSub(subId)) {
      res.status(404).json({ error: 'session not found' });
      return;
    }

    const mode: SessionLoopMode = body.mode === 'infinite' ? 'infinite' : 'count';
    const total = mode === 'count'
      ? Math.min(Math.max(1, Math.floor(body.total ?? SESSION_LOOP_DEFAULT_TOTAL)), SESSION_LOOP_MAX_ITERATIONS)
      : undefined;
    const intervalMs = Math.min(
      Math.max(0, Math.floor(body.intervalMs ?? SESSION_LOOP_DEFAULT_INTERVAL_MS)),
      SESSION_LOOP_MAX_INTERVAL_MS,
    );
    const enabled = body.enabled !== false;

    // §5.5 #17-11 ⑫(b) — 컨텍스트 처리 3택. 모르는 값은 'none'(기존 동작)으로 떨어뜨린다.
    const contextMode: SessionLoopContextMode =
      body.contextMode === 'compact' || body.contextMode === 'clear' ? body.contextMode : 'none';

    // §5.5 #17-11 ⑫(a) — 예산 상한. 0·음수·NaN 은 "무제한"(필드 자체를 넣지 않는다).
    const posNum = (v: unknown, limit: number): number | undefined => {
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v * 1000) / 1000 : 0;
      if (n <= 0) return undefined;
      return Math.min(n, limit);
    };
    const maxCostUsd = posNum(body.maxCostUsd, SESSION_LOOP_MAX_COST_USD_LIMIT);
    const maxTokens = posNum(body.maxTokens, Number.MAX_SAFE_INTEGER);
    const maxDurationMs = posNum(body.maxDurationMs, SESSION_LOOP_MAX_DURATION_LIMIT_MS);

    const prev = graphManager.getSessionLoop(subId);
    const now = Date.now();
    // 설정을 바꾸면 진행 카운트는 0 부터 다시 — "5회로 바꿨는데 이미 3회 찼다"는 혼란 방지.
    //   같은 설정 그대로 [시작]만 다시 누른 경우(끝난 루프 재시작)도 새 사이클로 본다.
    //   §5.5 #17-11 ⑫(a) — 예산 누적·사이클 시작 시각도 같은 판정을 따른다(새 사이클이면 0 부터).
    const sameShape = !!prev && prev.command === command && prev.mode === mode && prev.total === total
      && prev.commandFile === commandFile;
    const keepProgress = sameShape && prev.enabled && enabled;

    const loop: SessionLoop = {
      agentId,
      subAgentId: subId,
      command: command.slice(0, SESSION_LOOP_COMMAND_MAX),
      mode,
      ...(total !== undefined ? { total } : {}),
      completed: keepProgress ? prev.completed : 0,
      enabled,
      intervalMs,
      stopOnError: body.stopOnError !== false,
      // §5.5 #17-11 ⑪·⑫(b) — 회차 사이 컨텍스트 처리. 기본은 'none'(보내지 않으면 기존 동작 그대로).
      contextMode,
      // §5.5 #17-11 ⑫(a) — 예산 상한과 누적. 누적은 사이클을 새로 시작하면 0 부터.
      ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(maxDurationMs !== undefined ? { maxDurationMs } : {}),
      spentCostUsd: keepProgress ? prev.spentCostUsd : 0,
      spentTokens: keepProgress ? prev.spentTokens : 0,
      ...(keepProgress && prev.cycleStartedAt !== undefined ? { cycleStartedAt: prev.cycleStartedAt } : {}),
      // §5.5 #17-11 ⑫(c)(d)(e)(f) — 회차 프롬프트 규약. 전부 기본 꺼짐.
      ...(progressFile ? { progressFile } : {}),
      oneTaskPerRound: body.oneTaskPerRound === true,
      commitEachRound: body.commitEachRound === true,
      ...(commandFile ? { commandFile } : {}),
      status: enabled ? 'waiting' : 'idle',
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      ...(keepProgress && prev.lastRunAt !== undefined ? { lastRunAt: prev.lastRunAt } : {}),
    };

    clearSessionLoopTimer(subId);
    if (!graphManager.setSessionLoop(loop)) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    if (enabled) fireSessionLoopIteration(subId);
    else graphManager.updateSessionLoop(subId, { status: 'idle', pendingCommandId: undefined, nextRunAt: undefined });

    logger.info(
      `[session-loop] saved agent=${agentId} sub=${subId} mode=${mode}` +
      `${total !== undefined ? ` total=${total}` : ''} interval=${intervalMs}ms enabled=${enabled}` +
      ` context=${contextMode}${maxCostUsd ? ` maxCost=$${maxCostUsd}` : ''}${maxTokens ? ` maxTokens=${maxTokens}` : ''}` +
      `${maxDurationMs ? ` maxDuration=${Math.round(maxDurationMs / 1000)}s` : ''}${commandFile ? ` commandFile=${commandFile}` : ''}`,
    );
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, loop: graphManager.getSessionLoop(subId) ?? loop });
  });

  /**
   * §5.5 #17-11 — DELETE /api/session-loop/:agentId/:subId — 루프 설정 삭제.
   * body `{ stopOnly: true }` 면 설정은 남기고 정지만(사용자 [정지] 버튼). 없는 루프여도 200(멱등).
   */
  app.delete('/api/session-loop/:agentId/:subId', subAgentOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    const { agentId, subId } = req.params;
    const stopOnly = !!(req.body as { stopOnly?: boolean } | undefined)?.stopOnly;
    if (stopOnly) {
      stopSessionLoop(subId, 'stopped');
    } else {
      clearSessionLoopTimer(subId);
      graphManager.deleteSessionLoop(subId);
    }
    // §5.5 #17-11 — 루프가 꺼졌으니 그동안 보류돼 있던 완료 판정을 같은 스냅샷에서 낸다.
    //   (늦게 실리면 클라가 "루프 종료(침묵)" 와 "버블 완료(발화)" 를 별개 사건으로 보고 소리를 낸다.)
    graphManager.recomputeCustomAgentStatus(agentId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, ...(stopOnly ? { loop: graphManager.getSessionLoop(subId) } : {}) });
  });

  /**
   * §5.5 #17-17 — 세션의 `TodoWrite` 계획을 목표 단계로 옮긴다.
   * claude 의 todo 상태(`pending`/`in_progress`/`completed`) → 목표 단계 상태 매핑.
   * 형식이 다르면 조용히 빈 배열(목표 창은 표시용이라 훅 경로를 막을 이유가 없다).
   */
  function parsePlanStepsFromTodos(raw: unknown): { text: string; status: SessionGoalStepStatus }[] {
    if (!Array.isArray(raw)) return [];
    const out: { text: string; status: SessionGoalStepStatus }[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as { content?: unknown; status?: unknown };
      const text = typeof rec.content === 'string' ? rec.content.trim() : '';
      if (!text) continue;
      const status: SessionGoalStepStatus =
        rec.status === 'completed' ? 'done' : rec.status === 'in_progress' ? 'in_progress' : 'pending';
      out.push({ text, status });
    }
    return out;
  }

  /**
   * §5.5 #17-17 — 외부(에이전트 curl·렌더러)에서 온 단계 배열을 신뢰 가능한 형태로 정리.
   * 잡스러운 항목은 조용히 버린다 — 신고 하나가 형식이 틀렸다고 진행 갱신 전체를 막을 이유는 없다.
   */
  function parseGoalSteps(
    raw: unknown[],
  ): { text: string; status?: SessionGoalStepStatus; kind?: string; confidence?: 'high' | 'low'; parallel?: boolean }[] {
    const out: { text: string; status?: SessionGoalStepStatus; kind?: string; confidence?: 'high' | 'low'; parallel?: boolean }[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        if (item.trim()) out.push({ text: item.trim() });
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const rec = item as { text?: unknown; status?: unknown; kind?: unknown; confidence?: unknown; parallel?: unknown };
      const text = typeof rec.text === 'string' ? rec.text.trim() : '';
      if (!text) continue;
      const status = rec.status === 'done' || rec.status === 'in_progress' || rec.status === 'pending'
        ? (rec.status as SessionGoalStepStatus)
        : undefined;
      // §5.5 #17-17 ⑪(a)(e) — 종류·확신은 `rebuildGoalSteps` 가 이미 받을 줄 아는데 이 체가 버리고
      //   있었다. 그래서 에이전트가 `kind` 를 실어 보내도 무대는 영원히 중립 점이었다 — 블록(⑪(l))과
      //   REST 가 같은 답을 내야 하므로 여기서도 통과시킨다.
      const kind = typeof rec.kind === 'string' && rec.kind.trim() ? rec.kind.trim().slice(0, 40) : undefined;
      const confidence = rec.confidence === 'low' || rec.confidence === 'high' ? rec.confidence : undefined;
      // §5.5 #17-17 ⑰(b) — 행 표식은 3값이다: `true` 붙임 · `false` 뗌 · 없음 = 이전 값 유지. 불리언만 받는다.
      const parallel = rec.parallel === true ? true : rec.parallel === false ? false : undefined;
      out.push({
        text,
        ...(status ? { status } : {}),
        ...(kind ? { kind } : {}),
        ...(confidence ? { confidence } : {}),
        ...(parallel !== undefined ? { parallel } : {}),
      });
    }
    return out;
  }

  /**
   * §5.5 #17-17 / §3.6 — 작업 장부(Task) 훅을 목표 단계로 흘린다(`TaskCreate`/`TaskUpdate` 도구가 `TaskCreated`/`TaskCompleted` 훅을 낸다).
   * 단계 목록은 본문(제목)으로 이어 붙인다 — "같은 본문이 같은 항목"이고 `rebuildGoalSteps` 가 그 규칙으로 id 를 물려준다.
   * 별도 장부(새 저장소)를 들지 마라 — 그것만 따로 비워지거나 새는 자리가 하나 더 생긴다.
   * 우리 관할이 아닌 세션(agentId·subAgentId 미상)은 지나간다 — 남의 세션 훅으로 카드를 만들지 않는다.
   */
  function ingestTaskLedgerHook(
    body: HookEventPayload,
    agentId: string | null,
    subAgentId: string | null,
  ): void {
    if (!agentId || !subAgentId) return;
    const rec = body as unknown as Record<string, unknown>;
    const subject = typeof rec['task_subject'] === 'string' ? rec['task_subject'].trim() : '';
    if (!subject) return; // 제목이 없으면 화면에 적을 것이 없다

    const done = body.hook_event_name === 'TaskCompleted';
    const prev = graphManager.getSessionGoal(subAgentId)?.steps ?? [];
    const carried = prev.map((s) => ({ text: s.text, status: s.status }));
    const idx = carried.findIndex((s) => s.text === subject);
    if (idx >= 0) {
      const hit = carried[idx];
      // 완료 신고만 상태를 올린다. 생성 신고가 이미 진행 중인 항목을 pending 으로 되돌리면
      //   화면의 퍼센트가 뒤로 간다(사용자에게는 그게 곧 "되감김"으로 읽힌다).
      if (hit && done) carried[idx] = { text: hit.text, status: 'done' };
    } else {
      carried.push({ text: subject, status: done ? 'done' : 'pending' });
    }

    const existing = graphManager.getSessionGoal(subAgentId);
    if (existing) {
      graphManager.noteSessionGoalProgress(subAgentId, { steps: carried, source: 'plan' });
    } else {
      // 목표가 아직 없으면 **이 장부가 곧 목표**다 — `TodoWrite` 경로와 같은 규칙(§5.5 #17-17 ⑨).
      graphManager.setSessionGoal({
        agentId,
        subAgentId,
        text: subject.slice(0, SESSION_GOAL_TEXT_MAX),
        status: 'active',
        steps: carried,
        authoredBy: 'session',
      });
    }
    broadcastSnapshot();
  }

  /**
   * §5.5 #17-17 — PUT /api/session-goal/:agentId/:subId — 세션 목표 저장(생성·수정·상태 변경).
   * body: `{ text, status? }`. 문장이 실제로 바뀌면 서버가 `revision++` 으로 plan 자동 폴백을 다시 연다(#17-17 ③).
   * 진행률·이력은 보존한다(문장 다듬기 ≠ 진행 되감기). loopback 허용 목록에는 올리지 않는다(목표는 사용자 것).
   */
  app.put('/api/session-goal/:agentId/:subId', subAgentOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    const { agentId, subId } = req.params;
    const body = (req.body ?? {}) as { text?: string; status?: string; steps?: unknown };

    // 이미 목표가 있으면 text 는 선택(상태만 바꾸는 저장이 문장을 다시 실어 보낼 필요 없게).
    const existing = graphManager.getSessionGoal(subId);
    const text = typeof body.text === 'string' ? body.text.trim() : (existing?.text ?? '');
    if (!text) {
      res.status(400).json({ error: 'text required' });
      return;
    }
    if (!subAgentManager.getSub(subId)) {
      res.status(404).json({ error: 'session not found' });
      return;
    }

    const status: SessionGoalStatus =
      body.status === 'achieved' || body.status === 'abandoned' ? body.status : 'active';
    const goal = graphManager.setSessionGoal({
      agentId,
      subAgentId: subId,
      text: text.slice(0, SESSION_GOAL_TEXT_MAX),
      status,
      ...(Array.isArray(body.steps) ? { steps: parseGoalSteps(body.steps) } : {}),
      // 이 문은 사이드바(사용자)만 쓴다 — 문장을 고쳤다면 그 순간부터 세션 자동 교체를 멈춘다(⑧).
      authoredBy: 'user',
    });
    if (!goal) {
      res.status(404).json({ error: 'agent not found' });
      return;
    }

    logger.info(`[session-goal] saved agent=${agentId} sub=${subId} rev=${goal.revision} status=${status}`);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, goal });
  });

  /**
   * §5.5 #17-17 — 진행률 갱신. 호출자 둘: 에이전트(loopback, 토큰 필수 — 화이트리스트에 오르는 유일한 목표 경로) ·
   * 패널의 사용자(렌더러 in-process, `source:'user'`). 우선순위는 서버(ProjectGraph)가 정한다.
   */
  app.post('/api/session-goal/:agentId/:subId/progress', subAgentOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    const { agentId, subId } = req.params;
    const body = (req.body ?? {}) as { percent?: number; note?: string; steps?: unknown; goal?: string; source?: string };

    const hasSteps = Array.isArray(body.steps);
    const hasPercent = typeof body.percent === 'number' && Number.isFinite(body.percent);
    const hasGoal = typeof body.goal === 'string' && body.goal.trim().length > 0;
    if (!hasSteps && !hasPercent && !hasGoal) {
      res.status(400).json({ error: 'steps (array), percent (number) or goal (string) required' });
      return;
    }
    const existing = graphManager.getSessionGoal(subId);
    if (!existing || existing.agentId !== agentId) {
      res.status(404).json({ error: 'goal not found' });
      return;
    }

    // 'plan' 은 훅 경로 전용(자동 폴백) — 외부에서 사칭하지 못하게 여기선 agent/user 만 받는다.
    const source: SessionGoalProgressSource = body.source === 'user' ? 'user' : 'agent';
    const goal = graphManager.noteSessionGoalProgress(subId, {
      ...(hasPercent ? { percent: body.percent } : {}),
      ...(hasSteps ? { steps: parseGoalSteps(body.steps as unknown[]) } : {}),
      ...(hasGoal ? { goal: body.goal } : {}),
      ...(typeof body.note === 'string' ? { note: body.note } : {}),
      source,
    });

    logger.info(`[session-goal] progress agent=${agentId} sub=${subId} ${goal?.percent ?? existing.percent}% src=${source}`);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, goal: goal ?? existing });
  });

  /** §5.5 #17-17 — 목표 해제. 없는 목표여도 200(멱등). */
  app.delete('/api/session-goal/:agentId/:subId', subAgentOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    const { subId } = req.params;
    graphManager.deleteSessionGoal(subId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  // §5.5 #17-17 ⑪ 단계 지도 REST — `/steps` 는 loopback 화이트리스트 밖이다(⑪(d)): 끼워 넣기는 사용자만, 에이전트는 `/progress` 로만 갱신한다(⑤).

  /**
   * ⑪(d) — 사용자가 단계 목록을 통째로 다시 세운다.
   * ⑲ — 새 본문만 `authoredBy='user'`(다음 턴 세션 계획이 못 지운다 — 주입 블록의 "지울 수 없다" 근거). 재사용분은 원래 주인을 지킨다 —
   * 순서 바꾸기도 이 문으로 오므로 전부 user 로 박으면 에이전트 단계가 모두 불멸이 된다.
   */
  app.put('/api/session-goal/:agentId/:subId/steps', subAgentOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    const { subId } = req.params;
    const raw = Array.isArray(req.body?.steps) ? req.body.steps : null;
    if (!raw) return res.status(400).json({ error: 'steps array required' });
    const goal = graphManager.setUserGoalSteps(subId, raw);
    if (!goal) return res.status(404).json({ error: 'goal not found' });
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, goal });
  });

  /**
   * ⑪(i) — 한 단계의 종류만 바꾼다. `/steps` 와 일부러 가른 문 — 그쪽은 소유를 사용자로 옮기고, 종류 고르기는 소유를 옮기지 않는다.
   * `kind` 를 비우면 중립 점으로. loopback 화이트리스트 밖(고르는 것은 사용자).
   */
  app.put('/api/session-goal/:agentId/:subId/steps/:stepId/kind', subAgentOwnerGuard<{ agentId: string; subId: string; stepId: string }>((id) => subAgentManager.getSub(id)), (req, res) => {
    const { subId, stepId } = req.params;
    const raw = req.body?.kind;
    const kind = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    const goal = graphManager.setGoalStepKind(subId, stepId, kind);
    if (!goal) return res.status(404).json({ error: 'step not found' });
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, goal });
  });

  /** ⑪(a)(b) — 종류 카드 생성·수정. 에이전트가 새 종류를 만들 때도 이 문으로 온다(글리프는 `sanitizeGlyphPath` 통과분만). */
  app.put('/api/visual-kind/:key', (req, res) => {
    const card = graphManager.upsertVisualKind({
      key: req.params.key,
      label: typeof req.body?.label === 'string' ? req.body.label : undefined,
      glyph: typeof req.body?.glyph === 'string' ? req.body.glyph : undefined,
      color: typeof req.body?.color === 'string' ? req.body.color : undefined,
      // ⑪(i) — 무대 세 칸. 검증(경로 문법·골격 목록·길이)은 전부 ProjectGraph 가 한다 —
      //   여기서 한 번 더 거르면 규칙이 두 벌이 되어 한쪽만 고쳐지는 날이 온다.
      scene: req.body?.scene,
      surface: req.body?.surface,
      blurb: req.body?.blurb,
      // ⑪(m) — 밑그림 이름. 안 낸 칸만 채우므로 여기서도 검증 없이 그대로 넘긴다.
      from: req.body?.from,
    });
    if (!card) return res.status(400).json({ error: 'invalid key' });
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, card });
  });

  /** ⑪(c) — POST /api/visual-kind/:key/pin — 고정·해제(고정한 카드는 시들지 않는다). */
  app.post('/api/visual-kind/:key/pin', (req, res) => {
    const card = graphManager.setVisualKindPinned(req.params.key, req.body?.pinned !== false);
    if (!card) return res.status(404).json({ error: 'kind not found' });
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, card });
  });

  /** ⑪(c) — POST /api/visual-kind/:key/trash — 휴지통으로 보내거나 꺼낸다(씨앗은 버려지지 않는다). */
  app.post('/api/visual-kind/:key/trash', (req, res) => {
    const card = graphManager.setVisualKindTrashed(req.params.key, req.body?.trashed !== false);
    if (!card) return res.status(404).json({ error: 'kind not found' });
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, card });
  });

  /** §5.5 #17-17 ⑫(b) — 팔레트 한 칸 고정·해제. 목록을 고치는 문은 없다 — 목록은 배운 것에서 파생돼 자주 쓰면 오르고 안 쓰면 내려간다(⑫(a)). */
  app.post('/api/goal-action/pin', (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    if (!id) return res.status(400).json({ error: 'id required' });
    const pinned = graphManager.setGoalActionPinned(id, req.body?.pinned !== false);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, id, pinned });
  });

  // §5.5 #17-28 — 컨텍스트 주입원 통제 REST. 조회는 매번 다시 잰다(캐시 ❌ — 창을 여는 순간의 답이어야 한다). 파일 스캔은 창을 열 때만.

  /** 목록(`/api/context-inventory`)과 상세(`/api/context-source`)가 함께 쓰는 한 실측 — 따로 재면 그 사이 파일이 바뀔 때 둘이 어긋난다. */
  function measureContextForAgent(agentId: string, subAgentId?: string): { inventory: ContextInventory; parts: MeasuredPart[] } | null {
    // 버블 id 로 에이전트를 찾는 표준 경로는 스냅샷의 `agents` 배열이다(다른 라우트와 같은 방식).
    const agent = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
    if (!agent) return null;

    const projectPath = graphManager.getProjectPathForAgent(agentId) ?? graphManager.getRoot() ?? '';
    const cwd = graphManager.getAgentCwdByAgentId(agentId) ?? projectPath;
    const agentConfig = graphManager.getAgentConfig(agentId);
    // §5.10 (O) — 자동 기억 폴더는 에이전트 설정 「기억」 범위를 따른다(스폰이 `prepareAgentSettings` 에 넘기는
    //   것과 같은 입력). 안 넘기면 `user`/`project`/`local` 로 둔 에이전트의 표가 레포 공용 폴더를 잘못 센다.
    const memoryDir = resolveAgentMemoryDirOverride(agentConfig?.memory, agentId, cwd);
    // 프롬프트를 만드는 그 함수로 잰다 — 표와 실제 주입이 갈라질 수 없는 유일한 방법.
    // Brain 브리핑은 **명령 본문으로 랭킹**되므로, 잴 때도 그 세션이 마지막에 받은 명령을 넣는다
    //   (목표 카드가 그 문장을 이미 들고 있어 새로 저장할 것이 없다). 없으면 상시 규칙만 잡힌다.
    const lastCommand = (subAgentId ? graphManager.getSessionGoal(subAgentId)?.sourceCommand : '') ?? '';
    const assembled = assembleContextParts({
      agent,
      cwd,
      ...(agentConfig ? { agentConfig } : {}),
      ...(subAgentId ? { subAgentId } : {}),
      commandText: lastCommand,
    });
    const inventory = buildContextInventory({
      agentId,
      ...(subAgentId ? { subAgentId } : {}),
      projectKey: graphManager.getAgentProjectName(agentId) ?? '',
      projectPath,
      cwd,
      parts: assembled.parts,
      managed: Boolean(agent.customCreated),
      ...(agentConfig ? { agentConfig } : {}),
      ...(graphManager.getContextOverrides() ? { overrides: graphManager.getContextOverrides() } : {}),
      ...(memoryDir ? { memoryDir } : {}),
    });
    return { inventory, parts: assembled.parts };
  }

  /** GET /api/context-inventory/:agentId?sub=<subAgentId> — 이 세션에 실릴 주입원 전수 + 최종 켬/끔. */
  app.get('/api/context-inventory/:agentId', (req, res) => {
    try {
      const { agentId } = req.params;
      const subAgentId = typeof req.query['sub'] === 'string' && req.query['sub'] ? String(req.query['sub']) : undefined;
      const measured = measureContextForAgent(agentId, subAgentId);
      if (!measured) return res.status(404).json({ error: 'agent not found' });
      return res.json(measured.inventory);
    } catch (err) {
      logger.error('GET /api/context-inventory failed', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.5 #17-28 ⑦ — `?source=<id>&sub=<subAgentId>&file=<절대경로>` — 상세창 원문(읽기 전용).
   * 본문은 이 턴에 실제로 조립된 문자열이고, 파일은 그 순간 인벤토리에 든 경로만 연다(⑤).
   */
  app.get('/api/context-source/:agentId', (req, res) => {
    try {
      const { agentId } = req.params;
      const sourceId = typeof req.query['source'] === 'string' ? String(req.query['source']) : '';
      if (!sourceId) return res.status(400).json({ error: 'source required' });
      const subAgentId = typeof req.query['sub'] === 'string' && req.query['sub'] ? String(req.query['sub']) : undefined;
      const wantFile = typeof req.query['file'] === 'string' && req.query['file'] ? String(req.query['file']) : '';

      const measured = measureContextForAgent(agentId, subAgentId);
      if (!measured) return res.status(404).json({ error: 'agent not found' });
      const item = measured.inventory.items.find((i) => i.id === sourceId);
      if (!item) return res.status(404).json({ error: 'source not found' });

      const files = (item.children ?? []).filter((c) => Boolean(c.path));
      const base = { sourceId, files, unreadable: false } as const;

      // ① 특정 파일을 물었으면 그것만 — 단, 지금 이 인벤토리에 있는 경로여야 한다.
      if (wantFile) {
        const read = readContextSourceFile(wantFile, collectInventoryFilePaths(measured.inventory), CONTEXT_PREVIEW_MAX_CHARS);
        if (!read) return res.status(403).json({ error: 'file is not part of this context' });
        return res.json({ ...base, text: read.text, chars: read.chars, tokens: read.tokens, truncated: read.truncated, filePath: read.path });
      }

      // ② 우리가 조립하는 블록이면 그 턴의 문자열 그대로.
      const part = measured.parts.find((p) => p.id === sourceId);
      if (part) {
        const truncated = part.text.length > CONTEXT_PREVIEW_MAX_CHARS;
        return res.json({
          ...base,
          text: truncated ? part.text.slice(0, CONTEXT_PREVIEW_MAX_CHARS) : part.text,
          chars: part.text.length,
          tokens: estimateTokens(part.text),
          truncated,
        });
      }

      // ③ 파일로 이뤄진 줄이면 첫 파일을 바로 펼쳐 준다 — 누르자마자 "아 이런 거구나"가 되도록
      //    한 번 더 물어보게 만들지 않는다(나머지 파일은 목록에서 고른다).
      // Only the configured instruction text is previewable; config.toml can hold credentials.
      if (sourceId === CONTEXT_SOURCE_IDS.codexDeveloperInstructions) {
        const text = readCodexDeveloperInstructions(measured.inventory.cwd);
        return res.json({
          ...base, text: text.slice(0, CONTEXT_PREVIEW_MAX_CHARS), chars: text.length,
          tokens: estimateTokens(text), truncated: text.length > CONTEXT_PREVIEW_MAX_CHARS,
        });
      }
      const first = files[0];
      if (first?.path) {
        const read = readContextSourceFile(first.path, collectInventoryFilePaths(measured.inventory), CONTEXT_PREVIEW_MAX_CHARS);
        if (read) {
          return res.json({ ...base, text: read.text, chars: read.chars, tokens: read.tokens, truncated: read.truncated, filePath: read.path });
        }
      }

      // ④ 남은 것은 실행본 안에 있어 열어 볼 것이 없는 줄 — 빈 화면 대신 "못 읽는다"고 말한다(⑥).
      return res.json({
        ...base,
        unreadable: CONTEXT_UNREADABLE_SOURCE_IDS.has(sourceId) || files.length === 0,
        text: '',
        chars: item.chars,
        tokens: item.tokens,
        truncated: false,
      });
    } catch (err) {
      logger.error('GET /api/context-source failed', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** 층은 정본 어휘로만 받고 모르는 값은 가장 넓은 층(프로젝트)으로 — 자리마다 문자열로 비교하면 층이 늘 때 한 곳을 빠뜨린다. */
  function parseContextScopeLevel(raw: unknown): ContextScopeLevel {
    return CONTEXT_SCOPE_LEVELS.includes(raw as ContextScopeLevel) ? (raw as ContextScopeLevel) : 'project';
  }

  /**
   * PUT /api/context-overrides/:agentId — 주입원 한 줄의 켬/끔.
   * body: `{ sourceId, enabled: boolean|null, scope: 'project'|'agent'|'session', subAgentId? }`
   * `enabled: null` 은 **그 층의** 명시값 해제(= 위층에서 물려받음).
   */
  app.put('/api/context-overrides/:agentId', (req, res) => {
    try {
      const { agentId } = req.params;
      const body = req.body as { sourceId?: unknown; enabled?: unknown; scope?: unknown; subAgentId?: unknown };
      const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
      if (!sourceId) return res.status(400).json({ error: 'sourceId required' });
      const enabled = body.enabled === null ? null : body.enabled === true ? true : body.enabled === false ? false : undefined;
      if (enabled === undefined) return res.status(400).json({ error: 'enabled must be boolean or null' });

      const level = parseContextScopeLevel(body.scope);
      const subAgentId = typeof body.subAgentId === 'string' ? body.subAgentId : '';
      if (level === 'session' && !subAgentId) return res.status(400).json({ error: 'subAgentId required for session scope' });
      const measured = measureContextForAgent(agentId, subAgentId || undefined);
      if (!measured) return res.status(404).json({ error: 'agent not found' });
      const source = measured.inventory.items.find((item) => item.id === sourceId);
      if (!source || (source.control !== 'session' && source.control !== 'spawn')) {
        return res.status(400).json({ error: 'source is not controllable for this agent' });
      }
      // 프로젝트 층은 키가 있어야 걸린다. 못 구하면 **조용히 무시되지 않게** 여기서 되돌려 준다 —
      //   저장은 안 됐는데 200 을 받으면 화면은 껐다고 믿고 프롬프트에는 계속 실린다.
      const projectKey = graphManager.getAgentProjectName(agentId) ?? '';
      if (level === 'project' && !projectKey) return res.status(409).json({ error: 'project key not resolved for agent' });

      graphManager.setContextOverride(
        { level, agentId, projectKey, ...(subAgentId ? { subAgentId } : {}) },
        sourceId,
        enabled,
      );
      broadcastSnapshot();
      saveCheckpoint();
      return res.json({ ok: true, overrides: graphManager.getContextOverrides() ?? null });
    } catch (err) {
      logger.error('PUT /api/context-overrides failed', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /api/context-overrides/:agentId?scope=project|agent|session&sub=… — 그 층만 비운다(위층은 그대로). */
  app.delete('/api/context-overrides/:agentId', (req, res) => {
    try {
      const { agentId } = req.params;
      const level = parseContextScopeLevel(req.query['scope']);
      const subAgentId = typeof req.query['sub'] === 'string' ? String(req.query['sub']) : '';
      if (level === 'session' && !subAgentId) return res.status(400).json({ error: 'sub required for session scope' });
      graphManager.clearContextOverrides({
        level,
        agentId,
        projectKey: graphManager.getAgentProjectName(agentId) ?? '',
        ...(subAgentId ? { subAgentId } : {}),
      });
      broadcastSnapshot();
      saveCheckpoint();
      return res.json({ ok: true, overrides: graphManager.getContextOverrides() ?? null });
    } catch (err) {
      logger.error('DELETE /api/context-overrides failed', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §4 — 캔버스에서 커스텀 에이전트 생성. `executionMode:'interactive-terminal'` 이면 CMD(인터랙티브 터미널) 에이전트로 굽는다. */
  app.post('/api/create-custom-agent', (req, res) => {
    try {
      const { label, x, y, project, executionMode, provider: providerRaw, cliKind: cliKindRaw, orchestraRunId: orchestraRunIdRaw } = req.body as {
        label?: string; x?: number; y?: number; project?: string;
        // §5.3 #10-4 — 오케스트라 지휘자가 만드는 멤버면 그 런 id. 화면은 보내지 않는다.
        orchestraRunId?: unknown;
        executionMode?: 'headless' | 'interactive-terminal';
        // §5.19 (B) — All Model 버블. **모델 없이도 온다** — 우클릭으로 고른 순간 버블이 먼저 생기고
        //   모델은 그 버블을 눌렀을 때 매인다(진입 순서 역전). 그래서 modelId 가 비었다고 버리면 안 된다.
        provider?: unknown;
        // §5.25 (B-1) — CMD 터미널이 채울 CLI(Codex 칸의 "Codex CMD" = `codex`). 표에 있는 값만 받는다.
        cliKind?: unknown;
      };
      const position = typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
      const provider: AgentProvider | undefined = normalizeAgentProvider(providerRaw);
      const cliKind = CMD_CLI_KINDS.some((k) => k.value === cliKindRaw) ? (cliKindRaw as CmdCliKind) : undefined;
      const options =
        executionMode === 'interactive-terminal'
          ? { executionMode, ...(provider ? { provider } : {}), ...(cliKind ? { cliKind } : {}) }
          : provider
            ? { provider }
            : undefined;
      if (!graphManager.hasOpenProject()) return respondNoProjectFolder(res, 'create-custom-agent');
      /*
       * §5.3 #10 — 정원. loopback 토큰만으로 닿는 경로라 제한이 없으면 "새 에이전트 둘을 만들어라" 한 줄로 자기증식한다.
       * 프로젝트별로 커스텀만 센다 — 훅으로 붙은 외부 세션은 사용자 에디터가 띄운 것이라 막을 자리가 아니다.
       */
      const liveCustom = graphManager.getSnapshot().agents
        .filter((a) => a.customCreated && graphManager.getAgentProjectName(a.id) === (project ?? graphManager.getPrimaryProjectName()))
        .length;
      if (liveCustom >= CUSTOM_AGENT_MAX_PER_PROJECT) {
        logger.warn(`create-custom-agent refused — project already has ${liveCustom} custom agents (max ${CUSTOM_AGENT_MAX_PER_PROJECT})`);
        res.status(429).json({
          ok: false,
          error: 'custom-agent-limit',
          limit: CUSTOM_AGENT_MAX_PER_PROJECT,
          current: liveCustom,
          hint: 'Delete unused agent bubbles first, or raise the limit in the source constant.',
        });
        return;
      }
      // §5.3 #10-4 — 지휘자가 만드는 멤버. 런이 아직 지휘 중이고, 같은 프로젝트이고, 멤버 엔진 설정에 맞고,
      //   이 런이 새로 만든 수가 상한 안일 때만 만든다(재사용은 자리를 깎지 않는다). **만들기 전에** 잰다.
      const orchestraRunId = typeof orchestraRunIdRaw === 'string' ? orchestraRunIdRaw.trim() : '';
      const orchestraRun = orchestraRunId ? graphManager.findOrchestraRun(orchestraRunId) : undefined;
      if (orchestraRunId) {
        const targetRoot = graphManager.getCustomAgentTargetRoot(project ?? null);
        const check = checkOrchestraMemberCreate(
          orchestraRun,
          orchestraRun ? graphManager.getOrchestraSettings(orchestraRun.projectPath) : undefined,
          {
            sameProject: !!orchestraRun && !!targetRoot && samePath(targetRoot, orchestraRun.projectPath),
            providerKind: provider?.kind,
            readiness: currentOrchestraReadiness(),
          },
        );
        if (!check.ok) {
          respondOrchestraCheck(res, check);
          return;
        }
      }
      const agent = graphManager.createCustomAgent(label ?? '', position, project ?? null, options);
      if (!agent) return respondNoProjectFolder(res, 'create-custom-agent');
      if (orchestraRun) {
        const memberId = agent.id;
        graphManager.updateOrchestraRun(orchestraRun.runId, (r) => addOrchestraMember(r, memberId, true));
        // 재귀 방지 — 멤버는 에이전트 칸에 **명시적 끔**을 적는다. 프로젝트 스위치를 켜 둬도 멤버는 지휘하지 않는다.
        const currentOrchestra = graphManager.getOrchestraSettings(orchestraRun.projectPath) ?? {};
        graphManager.setOrchestraSettings(
          orchestraRun.projectPath,
          normalizeOrchestraSettings(withOrchestraScope(currentOrchestra, 'agent', memberId, false)),
        );
        logger.info(`[orchestra] member ${memberId} created for run ${orchestraRun.runId}`);
        /*
         * §5.3 #10-4 — 멤버가 태어날 때 사용자 스위치의 `isolation`·`tools` 를 서버가 심는다 — `tools` 는 loopback 유입에서 얼려 있고(§5.3 #12-1)
         * 멤버는 빈 오버라이드로 태어나 "첫 구성 통과"도 안 열린다. 권한 상승이 아니다(출처가 사용자 스위치, `tools` 는 좁히기만). `'all'` 은 기본값이라 박지 않는다.
         */
        const birth = orchestraMemberBirthConfig(currentOrchestra);
        if (birth) {
          // 3층을 지킨다 — 완성본을 읽어 두 칸만 얹어 되보내면 `setAgentConfig` 가 갈라진 칸만 남긴다.
          const resolved = graphManager.getAgentConfig(memberId);
          if (resolved) graphManager.setAgentConfig(memberId, { ...resolved, ...birth });
          logger.info(`[orchestra] member ${memberId} born with isolation=${birth.isolation ?? 'none'} tools=${birth.tools ? birth.tools.length : 'inherit'}`);
        }
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, agent });
    } catch (err) {
      logger.error('POST /api/create-custom-agent failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // §5.10 — 구 "지난 커스텀 에이전트 복구"(/api/custom-agents/recoverable·restore)는 휴지통이 후신이 되어 제거됨.

  // ─── §5.10 Project Brain — 커스텀 에이전트 휴지통 REST ───

  /** POST /api/trash/restore — 휴지통에서 커스텀 에이전트 복구(identity·설정·개별 기억 보존).
   *  `sessionId` 는 세션 키(`custom-…`)·버블 id(`agent-…`) 둘 다 받는다(클라는 버블 id 만 안다). */
  app.post('/api/trash/restore', (req, res) => {
    try {
      const { sessionId } = req.body as { sessionId?: string };
      if (typeof sessionId !== 'string' || !sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
      }
      const ok = graphManager.restoreTrashedAgent(sessionId);
      if (!ok) return res.status(404).json({ error: 'trashed agent not found' });
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/trash/restore failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /api/trash/agent/:sessionId — 휴지통 에이전트 영구 삭제(identity 제거 + 묘비 + 개별 기억 파일 삭제).
   *  `:sessionId` 는 세션 키·버블 id 둘 다 허용(복구와 동일). */
  app.delete('/api/trash/agent/:sessionId', (req, res) => {
    try {
      const { sessionId } = req.params;
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
      const ok = graphManager.permanentlyDeleteTrashedAgent(sessionId);
      if (!ok) return res.status(404).json({ error: 'trashed agent not found' });
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /api/trash/agent failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 — 휴지통 일괄 영구 삭제([모두 삭제] · 다중 선택). `sessionIds` 는 세션 키·버블 id 혼재 허용.
   * 모아 지우고 한 번만 알린다 — 개별 DELETE N 번이면 버블이 나눠 사라진다(§5.7 `/api/bubbles/delete` 와 같다). 확인 팝업은 클라 몫.
   */
  app.post('/api/trash/purge', (req, res) => {
    try {
      const { sessionIds } = req.body as { sessionIds?: string[] };
      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        return res.status(400).json({ error: 'sessionIds array required' });
      }
      const purged: string[] = [];
      const missing: string[] = [];
      for (const sessionId of sessionIds) {
        if (typeof sessionId !== 'string' || !sessionId) continue;
        // 하나가 이미 사라졌어도(경합) 나머지는 계속 지운다 — 부분 성공이 전부 실패보다 낫다.
        if (graphManager.permanentlyDeleteTrashedAgent(sessionId)) purged.push(sessionId);
        else missing.push(sessionId);
      }
      logger.info(`POST /api/trash/purge — purged ${purged.length}, missing ${missing.length}`);
      if (purged.length > 0) {
        broadcastSnapshot();
        saveCheckpoint();
      }
      res.json({ ok: true, purged, missing });
    } catch (err) {
      logger.error('POST /api/trash/purge failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /* §5.10 — 기억 카드 REST 는 두지 않는다(부르는 화면이 없으면 열린 문일 뿐). 절차 굳히기는 `/api/auto-goal/*` 가 맡는다. */

  /** §5.3 #10-2 — Auto Agent 메타 버블 생성(캔버스 우클릭 메뉴) */
  app.post('/api/create-auto-agent', (req, res) => {
    try {
      const { label, x, y, project } = req.body as { label?: string; x?: number; y?: number; project?: string };
      const position = typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
      if (!graphManager.hasOpenProject()) return respondNoProjectFolder(res, 'create-auto-agent');
      const agent = graphManager.createAutoAgent(label ?? '', position, project ?? null);
      if (!agent) return respondNoProjectFolder(res, 'create-auto-agent');
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, agent });
    } catch (err) {
      logger.error('POST /api/create-auto-agent failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.3 #10-2 — Auto Agent 에게 사용자 메시지 전달 → 자동 spawn + dispatch */
  app.post('/api/auto-agent/:sessionId/message', (req, res) => {
    try {
      const { sessionId } = req.params;
      const { text } = req.body as { text?: string };
      if (typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'text required' });
      }
      const summary = autoAgentRuntime.processRequest(sessionId, text.trim());
      res.json({ ok: true, summary });
    } catch (err) {
      logger.error('POST /api/auto-agent/:sessionId/message failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
    }
  });

  /** §5.3 #10-2 — Auto Agent "질문하기" 토글 */
  app.post('/api/auto-agent/:sessionId/toggle-questions', (req, res) => {
    try {
      const { sessionId } = req.params;
      const { enabled } = req.body as { enabled?: boolean };
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be boolean' });
      }
      const summary = autoAgentRuntime.toggleQuestions(sessionId, enabled);
      if (!summary) return res.status(404).json({ error: 'auto-agent not found' });
      res.json({ ok: true, summary });
    } catch (err) {
      logger.error('POST /api/auto-agent/:sessionId/toggle-questions failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.3 #10-2 — Auto Agent 명확화 질문에 사용자 답을 보내고 spawn 재개 */
  app.post('/api/auto-agent/:sessionId/answer-questions', (req, res) => {
    try {
      const { sessionId } = req.params;
      const { answers } = req.body as { answers?: { questionIndex: number; selectedLabels: string[]; note?: string }[] };
      if (!Array.isArray(answers)) {
        return res.status(400).json({ error: 'answers must be array' });
      }
      const summary = autoAgentRuntime.resumeWithAnswers(sessionId, answers);
      res.json({ ok: true, summary });
    } catch (err) {
      logger.error('POST /api/auto-agent/:sessionId/answer-questions failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
    }
  });

  // §5.3 #10-3 — 검증 런

  /** GET /api/auto-agent/:sessionId/runs — 그 auto-agent 의 검증 런 목록(최신이 뒤) */
  app.get('/api/auto-agent/:sessionId/runs', (req, res) => {
    try {
      const { sessionId } = req.params;
      res.json({ ok: true, runs: graphManager.listAutoAgentRuns(sessionId) });
    } catch (err) {
      logger.error('GET /api/auto-agent/:sessionId/runs failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
    }
  });

  /** 검증 증거 1건(실제로 돌린 명령 + 종료 코드). `ok` 는 본문에서 받지 않고 서버가 `exitCode === 0` 으로 계산한다 — 주장과 실제 통과를 가르는 자리. */
  app.post('/api/auto-agent/:sessionId/verification', (req, res) => {
    try {
      const { sessionId } = req.params;
      const body = (req.body ?? {}) as {
        runId?: string; kind?: VerificationKind; command?: string;
        exitCode?: number; revision?: string; durationMs?: number; detail?: string;
      };
      const command = typeof body.command === 'string' ? body.command.trim() : '';
      if (!command) return res.status(400).json({ error: 'command required' });
      if (typeof body.exitCode !== 'number' || !Number.isFinite(body.exitCode)) {
        return res.status(400).json({ error: 'exitCode (number) required — evidence without a result is not evidence' });
      }
      const run = body.runId
        ? graphManager.getAutoAgentRun(body.runId)
        : graphManager.getActiveAutoAgentRun(sessionId);
      if (!run) return res.status(404).json({ error: 'no active run' });
      const kinds: VerificationKind[] = ['build', 'typecheck', 'test', 'run', 'custom'];
      const kind = body.kind && kinds.includes(body.kind) ? body.kind : 'custom';
      const updated = graphManager.appendVerificationAttempt(run.runId, {
        kind,
        command: command.slice(0, 400),
        exitCode: Math.trunc(body.exitCode),
        ...(typeof body.revision === 'string' ? { revision: body.revision.slice(0, 80) } : {}),
        startedAt: Date.now(),
        ...(typeof body.durationMs === 'number' ? { durationMs: body.durationMs } : {}),
        ...(typeof body.detail === 'string' ? { detail: body.detail.slice(0, 2000) } : {}),
      });
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, run: updated });
    } catch (err) {
      logger.error('POST /api/auto-agent/:sessionId/verification failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
    }
  });

  /**
   * 게이트 자가진단 — 막는지는 차단으로만 증명되므로 일부러 실패하는 가짜 런 2건을 돌린다(`selfTest` 배지):
   * ① `exitCode=1` 증거만 있는 런에 `verified` 요청 → `escalated(no-evidence)` ② `REJECT`·`PASS` 섞인 판정 → `held`(승인이면 실패).
   */
  app.post('/api/auto-agent/:sessionId/self-test', (req, res) => {
    try {
      const { sessionId } = req.params;
      const checks: { id: string; expected: string; actual: string; pass: boolean }[] = [];

      // ① 실패 증거로는 verified 가 될 수 없다.
      const failing = graphManager.createAutoAgentRun({
        autoAgentId: sessionId,
        userRequest: '[self-test] exitCode=1 evidence must not verify',
        selfTest: true,
      });
      if (failing) {
        graphManager.appendVerificationAttempt(failing.runId, {
          kind: 'test', command: 'self-test: exit 1', exitCode: 1, startedAt: Date.now(),
          detail: 'deliberate failure injected by gate self-test',
        });
        const closed = graphManager.closeAutoAgentRun(failing.runId, 'verified');
        checks.push({
          id: 'failing-evidence-blocks-verified',
          expected: 'escalated',
          actual: closed?.status ?? 'missing',
          pass: closed?.status === 'escalated',
        });
      }

      // ② 판정이 애매하면 승인으로 흐르지 않는다.
      const ambiguous = parseCritiqueVerdict('The build looks fine and tests PASS, but I must REJECT the naming.');
      checks.push({
        id: 'ambiguous-verdict-is-held',
        expected: 'held-or-reject',
        actual: ambiguous.verdict,
        pass: ambiguous.verdict !== 'approve',
      });

      // ③ 증거 없는 approve 도 승인이 아니다.
      const bareApprove = parseCritiqueVerdict('```json\n{"verdict":"approve","reason":"looks good"}\n```');
      checks.push({
        id: 'approve-without-evidence-is-held',
        expected: 'held',
        actual: bareApprove.verdict,
        pass: bareApprove.verdict === 'held',
      });

      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, allPassed: checks.every((c) => c.pass), checks });
    } catch (err) {
      logger.error('POST /api/auto-agent/:sessionId/self-test failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
    }
  });

  /** POST /api/create-pipeline — 캔버스에서 파이프라인 에이전트 생성 (부모 + 자식 4개) */
  app.post('/api/create-pipeline', (req, res) => {
    try {
      const { type, label, x, y, project } = req.body as {
        type?: string; label?: string; x?: number; y?: number; project?: string;
      };
      const validTypes = ['pipeline-subagent', 'pipeline-teams', 'pipeline-hybrid'];
      if (!type || !validTypes.includes(type)) {
        res.status(400).json({ error: `Invalid pipeline type: ${type}` });
        return;
      }
      const position = typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
      if (!graphManager.hasOpenProject()) return respondNoProjectFolder(res, 'create-pipeline');
      const pipeline = graphManager.createPipeline(type as PipelineType, label ?? '', position, project ?? null);
      if (!pipeline) return respondNoProjectFolder(res, 'create-pipeline');
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, pipeline });
    } catch (err) {
      logger.error('POST /api/create-pipeline failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** `git worktree add` 실행. base 브랜치 후보를 차례로 시도(master → main). */
  function runGitWorktreeAdd(
    parentCwd: string,
    targetDir: string,
    newBranch: string,
    baseCandidates: string[],
  ): Promise<{ ok: true; base: string } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const tryNext = (i: number): void => {
        if (i >= baseCandidates.length) {
          resolve({ ok: false, error: `No matching base ref (tried: ${baseCandidates.join(', ')})` });
          return;
        }
        const base = baseCandidates[i]!;
        execFile(
          'git',
          ['-C', parentCwd, 'worktree', 'add', '-b', newBranch, targetDir, base],
          { windowsHide: true },
          (err, _stdout, stderr) => {
            if (!err) { resolve({ ok: true, base }); return; }
            const msg = (stderr || String(err)).trim();
            // base 를 찾지 못한 경우 → 다음 후보 시도
            if (/invalid reference|unknown revision|not a valid object/i.test(msg)) {
              tryNext(i + 1);
              return;
            }
            resolve({ ok: false, error: msg });
          },
        );
      };
      tryNext(0);
    });
  }

  /** POST /api/create-worktree — 캔버스에서 `master` 기준 새 git worktree + 버블 생성 */
  /** 워크트리 한 벌 만들기 — `/api/create-worktree` 와 §5.18 랩이 같이 쓴다(베끼면 한쪽만 고쳐진다). 브로드캐스트·저장은 호출부 몫(랩은 N개 뒤 한 번). */
  async function createWorktreeUnder(input: {
    project?: string | undefined;
    name?: string | undefined;
    base?: string | undefined;
    x?: number | undefined;
    y?: number | undefined;
  }): Promise<
    | { ok: true; name: string; branch: string; base: string; path: string; nodeId: string; parentPath: string }
    | { ok: false; status: number; error: string }
  > {
    // 1) 부모 프로젝트 resolve — worktree 프로젝트가 넘어오면 부모로 승격
    const requested = typeof input.project === 'string' && input.project.length > 0 ? input.project : null;
    const info = requested ? graphManager.getProjectByName(requested) : graphManager.getPrimaryProject();
    if (!info) {
      return { ok: false, status: 400, error: 'No project available to create a worktree under.' };
    }
    let parentInfo = info;
    if (info.parentProjectPath) {
      // `getProjectByName`은 모든 인스턴스를 훑으므로 worktree 본인일 수도 있다 → 부모로 치환
      const parent = graphManager.getProjectByName(path.basename(info.parentProjectPath));
      if (parent) parentInfo = parent;
    }
    const parentCwd = parentInfo.path.replace(/\//g, path.sep);

    // 2) 이름 자동 생성 (미지정 시 timestamp). 파일 시스템 안전 문자만 허용.
    const sanitize = (s: string): string => s.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '');
    const autoName = (() => {
      const d = new Date();
      const pad = (n: number): string => n.toString().padStart(2, '0');
      return `wt-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    })();
    let wtName = sanitize(typeof input.name === 'string' && input.name.trim() ? input.name.trim() : autoName);
    if (!wtName) wtName = autoName;

    const wtRoot = path.join(parentCwd, '.claude', 'worktrees');
    try { fs.mkdirSync(wtRoot, { recursive: true }); } catch { /* ignore */ }

    // 3) 중복 회피 — 같은 이름 존재 시 `-2`, `-3`... 접미어.
    //    디스크에 아직 없어도 **지금 만들어지는 중**인 이름은 피한다 — 랩(§5.18)이 변형 N개를
    //    연달아 만들 때 앞 건의 폴더가 생기기 전에 뒤 건이 같은 이름을 집는 것을 막는다.
    let targetDir = path.join(wtRoot, wtName);
    let attempt = 1;
    while (fs.existsSync(targetDir) || isWorktreeUnderConstruction(targetDir)) {
      attempt += 1;
      targetDir = path.join(wtRoot, `${wtName}-${attempt}`);
    }
    const finalName = path.basename(targetDir);
    const branch = `wt/${finalName}`;

    // 4) `git worktree add` — base 후보: 지정값 → master → main. 도는 동안 생성 유예로 폴더를 숨긴다 — git 이 `.git` 을 먼저 붙여,
    // 그 사이 10초 스윕이 주우면 좌표가 정해지기 전에 버블이 엉뚱한 자리에 태어난다. 해제는 반드시 `finally`.
    const baseCandidates = input.base ? [input.base, 'master', 'main'] : ['master', 'main'];
    beginWorktreeCreation(targetDir);
    const result = await runGitWorktreeAdd(parentCwd, targetDir, branch, baseCandidates)
      .finally(() => endWorktreeCreation(targetDir));
    if (!result.ok) {
      logger.warn(`create-worktree git failed: ${result.error}`);
      return { ok: false, status: 500, error: `git worktree add failed: ${result.error}` };
    }

    // 방금 만든 워크트리가 "죽은 폴더" 캐시에 걸려 발견에서 밀리지 않게 즉시 무효화.
    invalidateWorktreeLiveness(targetDir);

    // 5) 등록 + 버블 생성
    //    부모가 이미 등록돼 있으면 manager.registerProject(wtCwd) 는 부모로 리다이렉트 후 early return 하므로,
    //    `scanAllProjects` 로 부모 인스턴스의 `discoverWorktrees` 를 강제 실행시켜 worktree 노드를 생성한다.
    try {
      graphManager.registerProject(parentCwd); // 부모 인스턴스 확보 (idempotent)
    } catch (err) {
      // §3.2.1-4 — 부모가 read-only 격리(load-error)면 워크트리 생성 불가.
      logger.warn(`create-worktree: parent registerProject("${parentCwd}") failed: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, status: 409, error: `parent project not available (possibly read-only isolated): ${parentCwd}` };
    }
    graphManager.scanAllProjects();          // `.claude/worktrees/*` 재스캔 → ensureWorktreeNode

    // 6) 위치 부여 — ensureWorktreeNode 의 id 규칙: `worktree-${hashString(normalized)}`
    // `ensureWorktreeNode` 의 키(= projectGraph.normalize) 와 **같은 규칙**이어야 id 가 맞는다.
    const normalizedWt = pathKey(targetDir);
    let hash = 5381;
    for (let i = 0; i < normalizedWt.length; i++) {
      hash = ((hash << 5) + hash + normalizedWt.charCodeAt(i)) >>> 0;
    }
    const nodeId = `worktree-${hash}`;
    if (typeof input.x === 'number' && typeof input.y === 'number') {
      const positioned = graphManager.updateBubblePosition(nodeId, input.x, input.y);
      if (!positioned) {
        logger.warn(`create-worktree: node not found after scan — id=${nodeId}, path=${normalizedWt}`);
      }
    }

    return { ok: true, name: finalName, branch, base: result.base, path: targetDir, nodeId, parentPath: parentCwd };
  }

  app.post('/api/create-worktree', (req, res) => {
    void (async () => {
      try {
        const { project, x, y, name, base } = req.body as {
          project?: string; x?: number; y?: number; name?: string; base?: string;
        };
        // §4 온보딩 ③ — 워크트리는 **부모 프로젝트의 사본**이라, 부모가 없으면 만들 것 자체가 없다.
        if (!graphManager.hasOpenProject()) { respondNoProjectFolder(res, 'create-worktree'); return; }
        const created = await createWorktreeUnder({ project, x, y, name, base });
        if (!created.ok) {
          res.status(created.status).json({ error: created.error });
          return;
        }
        broadcastSnapshot();
        saveCheckpoint();
        res.json({ ok: true, name: created.name, branch: created.branch, base: created.base, path: created.path, nodeId: created.nodeId });
      } catch (err) {
        logger.error('POST /api/create-worktree failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /** git 명령 실행 헬퍼 — stdout/stderr/exitCode 를 한 번에 반환 */
  function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile('git', ['-C', cwd, ...args], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException).code === 'number'
          ? (err as NodeJS.ErrnoException).code as unknown as number
          : err ? 1 : 0;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
      });
    });
  }

  /** 주어진 worktree 경로에 매칭되는 branch 를 `git worktree list --porcelain` 로 조회 */
  async function getWorktreeBranch(parentCwd: string, wtAbsolutePath: string): Promise<string | null> {
    const r = await runGit(parentCwd, ['worktree', 'list', '--porcelain']);
    if (r.code !== 0) return null;
    const targetNorm = pathKey(path.resolve(wtAbsolutePath));
    const blocks = r.stdout.split(/\r?\n\r?\n/);
    for (const block of blocks) {
      const m = block.match(/^worktree\s+(.+)$/m);
      if (!m) continue;
      const wt = pathKey(path.resolve(m[1]!.trim()));
      if (wt !== targetNorm) continue;
      const b = block.match(/^branch\s+refs\/heads\/(.+)$/m);
      return b ? b[1]!.trim() : null;
    }
    return null;
  }

  /** nodeId → worktree 버블 정보 조회 (topFolders 순회) */
  function resolveWorktreeNode(nodeId: string): { parentAbs: string; wtAbs: string; wtNormalized: string } | null {
    const snap = graphManager.getSnapshot();
    const found = snap.topFolders.find((n) => n.id === nodeId && n.bubbleType === 'worktree');
    if (!found) return null;
    const wtNormalized = found.path;
    const wtAbs = (found.absolutePath ?? wtNormalized).replace(/\//g, path.sep);
    const m = wtNormalized.match(/^(.+?)\/\.claude\/worktrees\/[^/]+$/);
    if (!m) return null;
    const parentNorm = m[1]!;
    const parentAbs = parentNorm.replace(/\//g, path.sep);
    return { parentAbs, wtAbs, wtNormalized };
  }

  /**
   * §7.6 — 그 워크트리에서 일하던 커스텀 에이전트(충돌 넘기기의 상대). `agentProjects` 로 고른다 — 새 매핑 ❌.
   * 훅 버블·휴지통은 제외(§5.5 #17-29: 관측 대상에는 명령을 넣지 않는다). 없으면 화면은 버튼을 그리지 않는다.
   */
  function findWorktreeOwnerAgentId(wtAbs: string): string | undefined {
    const wtName = path.basename(wtAbs);
    const snap = graphManager.getSnapshot();
    let best: { id: string; at: number } | null = null;
    for (const agent of snap.agents) {
      if (agent.customCreated !== true || agent.trashed === true) continue;
      if (snap.agentProjects[agent.id] !== wtName) continue;
      const at = agent.lastActivity ?? 0;
      if (!best || at > best.at) best = { id: agent.id, at };
    }
    return best?.id;
  }

  /**
   * `reapWorktreeBeforeDelete` — §7.10 지우기 직전에 그 안에서 돌던 것을 강제로 끝낸다(팝업에서 확인됨). 고르는 규칙은 `worktreeReaper`.
   * 반드시 `removeBubble` 전에 — 프로젝트 등록이 사라지면 `agentProjects` 가 부모로 접혀 아무도 못 고른다.
   */
  /** 그 워크트리 경로의 **프로젝트 표시명**. 예고(status)와 실행(delete)이 같은 답을 써야 한다. */
  function resolveWorktreeProjectName(wtAbs: string): string {
    const snap = graphManager.getSnapshot();
    return Object.values(snap.worktreeProjects ?? {}).find(
      (name) => samePath(graphManager.getProjectByName(name)?.path ?? '', wtAbs),
    ) ?? path.basename(wtAbs);
  }

  /** §7.10 — 지금 지우면 무엇이 강제 종료되는지 세기만 한다 — 팝업이 확인 전에 보여 준다(모르고 dev 서버를 끄지 않게). */
  function countWorktreeReapTargets(wtAbs: string): { agents: number; terminals: number } {
    try {
      const snap = graphManager.getSnapshot();
      const agents = selectWorktreeAgents(
        snap.agents.map((a) => ({
          id: a.id,
          project: snap.agentProjects[a.id],
          customCreated: a.customCreated,
          trashed: a.trashed,
        })),
        resolveWorktreeProjectName(wtAbs),
      ).length;
      const terminals = getCmdTerminalController()?.listUnder(wtAbs).length ?? 0;
      return { agents, terminals };
    } catch {
      return { agents: 0, terminals: 0 };
    }
  }

  function reapWorktreeBeforeDelete(wtAbs: string): WorktreeReapResult {
    try {
      const snap = graphManager.getSnapshot();
      return reapWorktree({
        worktreePath: wtAbs,
        worktreeProjectName: resolveWorktreeProjectName(wtAbs),
        agents: snap.agents.map((a) => ({
          id: a.id,
          project: snap.agentProjects[a.id],
          customCreated: a.customCreated,
          trashed: a.trashed,
        })),
        stopAllSessions: (agentId) => subAgentManager.stopAll(agentId),
        trashAgent: (agentId) => graphManager.tryTrashCustomAgentByBubbleId(agentId),
        killTerminalsUnder: getCmdTerminalController()?.killUnder ?? null,
      });
    } catch (err) {
      // 회수가 실패해도 삭제는 진행한다 — 남은 잠금은 아래 부분 삭제 보고로 사용자에게 간다.
      logger.warn(`reapWorktreeBeforeDelete failed: ${err instanceof Error ? err.message : String(err)}`);
      return EMPTY_REAP;
    }
  }

  /** 삭제 뒤 남은 파일(상대경로)을 최대 `max`개 — 잠금 파일로 반만 지워진 것을 보여 주는 진단용. */
  function listRemainingFiles(dir: string, max: number): string[] {
    const out: string[] = [];
    const walk = (cur: string): void => {
      if (out.length >= max) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        out.push(path.relative(dir, cur) || path.basename(cur));
        return;
      }
      if (entries.length === 0 && cur !== dir) {
        out.push(`${path.relative(dir, cur)}${path.sep}`);
        return;
      }
      for (const e of entries) {
        if (out.length >= max) return;
        const full = path.join(cur, e.name);
        if (e.isDirectory()) walk(full);
        else out.push(path.relative(dir, full));
      }
    };
    try {
      if (!fs.existsSync(dir)) return out;
      walk(dir);
    } catch { /* 접근 실패 — 수집된 것까지만 보고 */ }
    return out;
  }

  /** GET /api/worktree/:nodeId/status — 브랜치명 + master/main 병합 여부 조회 */
  app.get('/api/worktree/:nodeId/status', (req, res) => {
    void (async () => {
      try {
        const info = resolveWorktreeNode(req.params.nodeId);
        if (!info) { res.status(404).json({ error: 'worktree node not found' }); return; }
        const branch = await getWorktreeBranch(info.parentAbs, info.wtAbs);
        // base branch 결정 — master → main 순 존재 확인
        const masterRef = await runGit(info.parentAbs, ['rev-parse', '--verify', '--quiet', 'refs/heads/master']);
        const baseBranch = masterRef.code === 0 ? 'master' : 'main';
        let isMerged = false;
        if (branch) {
          const anc = await runGit(info.parentAbs, ['merge-base', '--is-ancestor', branch, baseBranch]);
          isMerged = anc.code === 0;
        }
        // §7.10 — 삭제 시 강제 종료될 것들. 팝업이 확인 버튼 위에 그대로 적는다.
        res.json({ branch, baseBranch, isMerged, wtPath: info.wtAbs, parentPath: info.parentAbs, running: countWorktreeReapTargets(info.wtAbs) });
      } catch (err) {
        logger.error('GET /api/worktree/:id/status failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /** DELETE /api/worktree/:nodeId?merge=1 — 폴더·브랜치·버블 일괄 정리. merge=1 이면 삭제 전 병합 시도. */
  app.delete('/api/worktree/:nodeId', (req, res) => {
    void (async () => {
      try {
        const nodeId = req.params.nodeId;
        const merge = req.query['merge'] === '1' || req.query['merge'] === 'true';
        const info = resolveWorktreeNode(nodeId);
        if (!info) { res.status(404).json({ error: 'worktree node not found' }); return; }
        const branch = await getWorktreeBranch(info.parentAbs, info.wtAbs);

        // 1) 선택 시 병합 먼저
        if (merge) {
          if (!branch) {
            res.status(400).json({ error: 'branch not resolved', stderr: 'Could not determine worktree branch via `git worktree list`.' });
            return;
          }
          const mergeRes = await runGit(info.parentAbs, ['merge', '--no-edit', branch]);
          if (mergeRes.code !== 0) {
            // 실패 — 삭제 진행하지 않고 stderr 반환
            res.status(409).json({ ok: false, step: 'merge', error: 'merge failed', stderr: mergeRes.stderr || mergeRes.stdout, branch });
            return;
          }
        }

        // 2) §7.10 — 여기서 강제 종료한다 — 안에서 도는 dev 서버·빌드가 파일을 잡으면 삭제가 반만 된다.
        // 합치기 실패는 위에서 이미 돌아가므로 아무것도 죽이지 않는다 — 이 순서를 지킬 것.
        const reaped = reapWorktreeBeforeDelete(info.wtAbs);
        // 트리째 죽인 직후에는 OS 가 아직 핸들을 놓지 않았을 수 있다(Windows). 한 박자 기다린 뒤
        //   지운다 — 이 대기 없이 바로 rmSync 하면 방금 죽인 프로세스 탓에 또 반만 지워진다.
        if (reaped.terminals > 0 || reaped.sessions > 0) {
          await new Promise((resolve) => setTimeout(resolve, WORKTREE_REAP_SETTLE_MS));
        }

        // 3) worktree 제거 (force — dirty tree 도 강제 삭제, "그냥 삭제" 경로 커버)
        const rm = await runGit(info.parentAbs, ['worktree', 'remove', '--force', info.wtAbs]);
        if (rm.code !== 0) {
          // 폴더가 이미 사라졌으면 prune 으로 정리 후 계속 진행
          const prune = await runGit(info.parentAbs, ['worktree', 'prune']);
          logger.warn(`worktree remove failed, pruned: rmStderr=${rm.stderr} pruneStderr=${prune.stderr}`);
        }

        // 4) 브랜치 강제 삭제 (best-effort)
        if (branch) {
          const br = await runGit(info.parentAbs, ['branch', '-D', branch]);
          if (br.code !== 0) logger.warn(`branch -D ${branch} failed: ${br.stderr}`);
        }

        // 5) 버블 제거 + 디스크 폴더가 남아 있으면 정리 (worktree remove 가 실패한 경우)
        graphManager.removeBubble(nodeId);
        let cleanupError = '';
        try {
          if (fs.existsSync(info.wtAbs)) fs.rmSync(info.wtAbs, { recursive: true, force: true });
        } catch (err) {
          cleanupError = err instanceof Error ? err.message : String(err);
          logger.warn(`worktree folder cleanup failed: ${cleanupError}`);
        }
        invalidateWorktreeLiveness(info.wtAbs);

        // Windows 는 잠긴 파일 하나로 폴더가 반만 지워진다 — 조용한 성공으로 넘기지 말고 남은 파일을 보고한다.
        const stillExists = ((): boolean => { try { return fs.existsSync(info.wtAbs); } catch { return false; } })();
        const remaining = stillExists ? listRemainingFiles(info.wtAbs, 30) : [];

        broadcastSnapshot();
        saveCheckpoint();
        res.json({
          ok: true,
          branch,
          // §7.10 — 무엇을 강제로 끝냈는지 그대로 보고한다. 조용히 죽이면 사용자는 자기 dev 서버가
          //   왜 꺼졌는지 영영 모른다(팝업이 이 숫자를 그대로 읽는다).
          reaped,
          partial: stillExists,
          remainingPath: stillExists ? info.wtAbs : undefined,
          remaining,
          cleanupError: cleanupError || undefined,
        });
      } catch (err) {
        logger.error('DELETE /api/worktree/:id failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /** 반만 지워진 워크트리 폴더 재삭제 — 버블이 이미 없어 경로를 직접 받으므로 `.claude/worktrees/<name>` 패턴만 허용. */
  app.post('/api/worktree/cleanup-folder', (req, res) => {
    try {
      const raw = (req.body as { path?: unknown })?.path;
      if (typeof raw !== 'string' || !raw.trim()) { res.status(400).json({ error: 'path required' }); return; }
      const target = raw.trim();
      if (!/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+[\\/]?$/i.test(target)) {
        res.status(400).json({ error: 'not a worktree folder path' });
        return;
      }
      // §7.10 — 재시도가 첫 삭제와 다른 점은 **여기서도 잠금을 먼저 끊는다**는 것이다.
      //   버블은 이미 사라진 뒤라 에이전트는 없지만, 그 폴더에서 띄운 터미널(dev 서버·빌드)은
      //   그대로 살아 있을 수 있고 그것이 바로 첫 삭제가 반만 성공한 이유다.
      let terminals = 0;
      try {
        terminals = getCmdTerminalController()?.killUnder(target) ?? 0;
      } catch (err) {
        logger.warn(`cleanup-folder: killUnder failed — ${err instanceof Error ? err.message : String(err)}`);
      }
      void (async () => {
        if (terminals > 0) await new Promise((resolve) => setTimeout(resolve, WORKTREE_REAP_SETTLE_MS));
        let cleanupError = '';
        try {
          if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        } catch (err) {
          cleanupError = err instanceof Error ? err.message : String(err);
        }
        invalidateWorktreeLiveness(target);
        const stillExists = ((): boolean => { try { return fs.existsSync(target); } catch { return false; } })();
        res.json({
          ok: true,
          reaped: { agents: 0, sessions: 0, terminals, trashed: 0 },
          partial: stillExists,
          remainingPath: stillExists ? target : undefined,
          remaining: stillExists ? listRemainingFiles(target, 30) : [],
          cleanupError: cleanupError || undefined,
        });
      })();
    } catch (err) {
      logger.error('POST /api/worktree/cleanup-folder failed', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
    }
  });

  /** §7.6 Sync — base 를 머지(origin/master → origin/main → master → main). 충돌이면 `merge --abort` 후 409 + stderr. */
  app.post('/api/worktree/:nodeId/sync', (req, res) => {
    void (async () => {
      try {
        const info = resolveWorktreeNode(req.params.nodeId);
        if (!info) { res.status(404).json({ error: 'worktree node not found' }); return; }

        // 1) fetch origin — best-effort (offline / no remote 시 경고만 찍고 계속)
        const fetchR = await runGit(info.wtAbs, ['fetch', 'origin']);
        if (fetchR.code !== 0) {
          logger.warn(`worktree sync: fetch origin failed (continuing with local refs): ${fetchR.stderr.trim()}`);
        }

        // 2) base ref 결정 — 4단 폴백
        const candidates = ['origin/master', 'origin/main', 'master', 'main'];
        let base: string | null = null;
        for (const ref of candidates) {
          const verify = await runGit(info.wtAbs, ['rev-parse', '--verify', '--quiet', ref]);
          if (verify.code === 0) { base = ref; break; }
        }
        if (!base) {
          res.status(400).json({ error: 'no base ref found', tried: candidates });
          return;
        }

        // 3) merge
        const merge = await runGit(info.wtAbs, ['merge', '--no-edit', base]);
        if (merge.code !== 0) {
          // 충돌 → 자동 abort 로 worktree 상태 원복
          const abort = await runGit(info.wtAbs, ['merge', '--abort']);
          if (abort.code !== 0) logger.warn(`worktree sync: merge --abort failed: ${abort.stderr.trim()}`);
          res.status(409).json({
            ok: false,
            step: 'merge',
            base,
            stderr: merge.stderr || merge.stdout || 'merge failed',
          });
          return;
        }

        // 4) 캐시 무효화 — 부모 프로젝트의 git-status 에 반영 (worktree ahead/behind 변동)
        const parentInst = graphManager.getProjectByName(path.basename(info.parentAbs));
        const projectName = parentInst?.name;
        if (projectName) gitStatusService.invalidate(projectName);
        broadcastSnapshot();
        res.json({ ok: true, base });
      } catch (err) {
        logger.error('POST /api/worktree/:id/sync failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /**
   * §7.6 — 워크트리 브랜치를 본선으로 합친다. merge 라우트와 §5.16 승인이 같이 쓴다 — 가르면 한쪽이 아래 규칙에서 벗어난다.
   * `--no-ff` 고정(갈래가 남아야 되돌린다) · 손대기 전 409 두 가지 `parent-dirty`/`nothing-to-merge` · 충돌이면 `merge --abort` 로 원복하고 파일 목록을 돌려준다.
   */
  type WorktreeMergeOutcome =
    | { ok: true; branch: string }
    | {
        ok: false;
        httpStatus: number;
        step: 'resolve' | 'precheck' | 'merge';
        error: string;
        branch?: string;
        files?: string[];
        conflicts?: string[];
        ownerAgentId?: string;
        stderr?: string;
      };

  async function performWorktreeMerge(nodeId: string): Promise<WorktreeMergeOutcome> {
    const info = resolveWorktreeNode(nodeId);
    if (!info) return { ok: false, httpStatus: 404, step: 'resolve', error: 'worktree node not found' };
    const branch = await getWorktreeBranch(info.parentAbs, info.wtAbs);
    if (!branch) {
      return {
        ok: false,
        httpStatus: 400,
        step: 'resolve',
        error: 'branch not resolved',
        stderr: 'Could not determine worktree branch via `git worktree list`.',
      };
    }

    // 1) 부모가 dirty 면 거부 — 남의 미커밋 작업물 위에 머지를 얹지 않는다(§3.2.1 손실 방지와 같은 방향).
    const status = await runGit(info.parentAbs, ['status', '--porcelain']);
    const dirtyFiles = status.stdout.split(/\r?\n/).map((l) => l.slice(3).trim()).filter((l) => l !== '');
    if (status.code === 0 && dirtyFiles.length > 0) {
      return { ok: false, httpStatus: 409, step: 'precheck', error: 'parent-dirty', branch, files: dirtyFiles.slice(0, 50) };
    }

    // 2) 합칠 것이 있나 — 브랜치가 이미 부모 HEAD 의 조상이면 새로 들어올 커밋이 없다(= ahead 0).
    const ancestor = await runGit(info.parentAbs, ['merge-base', '--is-ancestor', branch, 'HEAD']);
    if (ancestor.code === 0) {
      return { ok: false, httpStatus: 409, step: 'precheck', error: 'nothing-to-merge', branch };
    }

    // 3) 합치기
    const merge = await runGit(info.parentAbs, ['merge', '--no-ff', '--no-edit', branch]);
    if (merge.code !== 0) {
      // 충돌 파일은 **abort 하기 전에** 뽑는다(abort 뒤엔 U 상태가 사라진다).
      const conflictRes = await runGit(info.parentAbs, ['diff', '--name-only', '--diff-filter=U']);
      const conflicts = conflictRes.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
      const abort = await runGit(info.parentAbs, ['merge', '--abort']);
      if (abort.code !== 0) logger.warn(`worktree merge: merge --abort failed: ${abort.stderr.trim()}`);
      const ownerAgentId = findWorktreeOwnerAgentId(info.wtAbs);
      return {
        ok: false,
        httpStatus: 409,
        step: 'merge',
        error: 'merge-conflict',
        branch,
        conflicts,
        // 충돌을 넘길 상대 — 그 워크트리에서 일하던 커스텀 에이전트(없으면 생략 → 화면이 버튼을 안 낸다).
        ...(ownerAgentId ? { ownerAgentId } : {}),
        stderr: merge.stderr || merge.stdout || 'merge failed',
      };
    }

    // 4) 캐시 무효화 — 부모의 ahead/behind·최근 커밋이 바뀌었다.
    const parentInst = graphManager.getProjectByName(path.basename(info.parentAbs));
    if (parentInst?.name) gitStatusService.invalidate(parentInst.name);
    broadcastSnapshot();
    return { ok: true, branch };
  }

  /** §7.6 — 위 본문의 HTTP 창구(sync 의 반대 방향). */
  app.post('/api/worktree/:nodeId/merge', (req, res) => {
    void (async () => {
      try {
        const outcome = await performWorktreeMerge(req.params.nodeId);
        if (outcome.ok) { res.json({ ok: true, branch: outcome.branch }); return; }
        const { httpStatus, ...rest } = outcome;
        res.status(httpStatus).json(rest);
      } catch (err) {
        logger.error('POST /api/worktree/:id/merge failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  // ─── §5.16 — 리뷰·승인 레인 (머지 전에 사람이 붙잡는 자리) ───

  /** §5.16 — 워크트리 변경분(`merge-base` 기준 커밋분 + 미커밋분). 읽기 전용 — add/stash ❌. */
  interface WorktreeChangeSet {
    files: ReviewFileChange[];
    diff: string;
    filesTruncated: boolean;
    diffTruncated: boolean;
  }

  /** `git diff --numstat` → 경로별 증감. 바이너리는 `-`/`-` 로 오므로 0/0 이다. */
  function parseNumstat(out: string): Map<string, { additions: number; deletions: number }> {
    const map = new Map<string, { additions: number; deletions: number }>();
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      // rename 은 `old => new` 형태로 오므로 화살표 뒤(현재 경로)를 쓴다.
      const rawPath = m[3]!.trim();
      const arrow = rawPath.lastIndexOf('=>');
      const filePath = (arrow >= 0 ? rawPath.slice(arrow + 2) : rawPath)
        .replace(/[{}]/g, '')
        .replace(/\\/g, '/')
        .trim();
      if (filePath === '') continue;
      map.set(filePath, {
        additions: m[1] === '-' ? 0 : Number(m[1]),
        deletions: m[2] === '-' ? 0 : Number(m[2]),
      });
    }
    return map;
  }

  /** git 의 상태 문자 한 개 → 우리 변경 종류. 모르는 문자는 숨기지 않고 `unknown` 으로 남긴다. */
  function toReviewChangeType(code: string): ReviewFileChangeType {
    switch (code) {
      case 'A': return 'added';
      case '?': return 'added';
      case 'M': return 'modified';
      case 'T': return 'modified';
      case 'D': return 'deleted';
      case 'R': return 'renamed';
      case 'C': return 'renamed';
      default: return 'unknown';
    }
  }

  /** `git diff --name-status` → 경로별 변경 종류. */
  function parseNameStatus(out: string): Map<string, ReviewFileChangeType> {
    const map = new Map<string, ReviewFileChangeType>();
    for (const line of out.split(/\r?\n/)) {
      const parts = line.split('\t');
      if (parts.length < 2) continue;
      const code = (parts[0] ?? '').trim().charAt(0);
      // rename/copy 는 `R100 <old> <new>` — 마지막 칸이 현재 경로다.
      const filePath = (parts[parts.length - 1] ?? '').replace(/\\/g, '/').trim();
      if (filePath === '') continue;
      map.set(filePath, toReviewChangeType(code));
    }
    return map;
  }

  /** 미커밋 목록은 `git status --porcelain` 이 근거다 — `git diff HEAD` 는 추적 안 된 새 파일을 못 본다. */
  function parsePorcelainStatus(out: string): { path: string; changeType: ReviewFileChangeType }[] {
    const rows: { path: string; changeType: ReviewFileChangeType }[] = [];
    for (const line of out.split(/\r?\n/)) {
      if (line.trim() === '') continue;
      const codes = line.slice(0, 2);
      let rest = line.slice(3).trim();
      // rename 은 `R  <old> -> <new>` — 현재 경로만 남긴다.
      const arrow = rest.indexOf(' -> ');
      if (arrow >= 0) rest = rest.slice(arrow + 4).trim();
      const filePath = rest.replace(/^"/, '').replace(/"$/, '').replace(/\\/g, '/').trim();
      if (filePath === '') continue;
      const code = codes.trim().charAt(0) || codes.charAt(1);
      rows.push({ path: filePath, changeType: toReviewChangeType(code) });
    }
    return rows;
  }

  /** §5.16 — git 이 아는 것만 읽는다. 커밋분은 `merge-base` 기준(부모 최신 커밋이 안 섞인다), 미커밋분은 `uncommitted` 표시(승인해도 병합에 안 들어간다). */
  async function collectWorktreeChanges(
    parentAbs: string,
    wtAbs: string,
    branch: string | null,
  ): Promise<WorktreeChangeSet> {
    const byPath = new Map<string, ReviewFileChange>();
    const diffParts: string[] = [];

    // 1) 커밋분 — merge-base..HEAD
    if (branch) {
      const base = await runGit(parentAbs, ['merge-base', 'HEAD', branch]);
      const baseSha = base.code === 0 ? base.stdout.trim() : '';
      if (baseSha !== '') {
        const range = `${baseSha}..HEAD`;
        const [numstat, nameStatus, body] = await Promise.all([
          runGit(wtAbs, ['diff', '--numstat', range]),
          runGit(wtAbs, ['diff', '--name-status', range]),
          runGit(wtAbs, ['diff', range]),
        ]);
        const counts = parseNumstat(numstat.stdout);
        for (const [filePath, changeType] of parseNameStatus(nameStatus.stdout)) {
          const c = counts.get(filePath);
          byPath.set(filePath, {
            path: filePath,
            changeType,
            additions: c?.additions ?? 0,
            deletions: c?.deletions ?? 0,
          });
        }
        if (body.code === 0 && body.stdout.trim() !== '') diffParts.push(body.stdout);
      }
    }

    // 2) 미커밋분 — 목록은 status(추적 안 된 파일 포함), 증감은 diff HEAD.
    const [status, unNumstat, unBody] = await Promise.all([
      runGit(wtAbs, ['status', '--porcelain']),
      runGit(wtAbs, ['diff', '--numstat', 'HEAD']),
      runGit(wtAbs, ['diff', 'HEAD']),
    ]);
    if (status.code === 0) {
      const counts = parseNumstat(unNumstat.stdout);
      for (const row of parsePorcelainStatus(status.stdout)) {
        const c = counts.get(row.path);
        byPath.set(row.path, {
          path: row.path,
          changeType: row.changeType,
          additions: c?.additions ?? 0,
          deletions: c?.deletions ?? 0,
          uncommitted: true,
        });
      }
    }
    if (unBody.code === 0 && unBody.stdout.trim() !== '') diffParts.push(unBody.stdout);

    const all = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    const files = all.slice(0, REVIEW_FILES_MAX);
    const joined = diffParts.join('\n');
    return {
      files,
      diff: joined.slice(0, REVIEW_DIFF_MAX_BYTES),
      filesTruncated: all.length > files.length,
      diffTruncated: joined.length > REVIEW_DIFF_MAX_BYTES,
    };
  }

  /**
   * §5.16 — 턴이 끝났을 때 넷 다 맞을 때만 리뷰를 만든다: 커스텀 에이전트 · 워크트리 프로젝트 · 실제 변경분 · 미결정 리뷰 없음.
   * 아니면 조용히 넘긴다(턴마다 카드가 쌓이면 소음이다).
   */
  async function maybeCreateReviewRequest(agentId: string, subAgentId?: string): Promise<void> {
    const snap = graphManager.getSnapshot();
    const agent = snap.agents.find((a) => a.id === agentId);
    if (!agent || agent.customCreated !== true || agent.trashed === true) return;  // (a)
    const projectName = snap.agentProjects[agentId];
    if (!projectName) return;
    const info = graphManager.getProjectByName(projectName);
    if (!info?.parentProjectPath) return;                                          // (b)
    if (graphManager.findOpenReviewRequestByAgent(agentId)) return;                 // (d)

    const wtAbs = info.path.replace(/\//g, path.sep);
    const parentAbs = info.parentProjectPath.replace(/\//g, path.sep);
    const branch = await getWorktreeBranch(parentAbs, wtAbs);
    const changes = await collectWorktreeChanges(parentAbs, wtAbs, branch);
    if (changes.files.length === 0) return;                                        // (c)

    const baseRes = await runGit(parentAbs, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const baseBranch = baseRes.code === 0 ? baseRes.stdout.trim() : '';
    // 부모 캔버스의 worktree 버블 id = 승인 병합의 키. `worktreeProjects`(nodeId → 프로젝트명) 역인덱스.
    const nodeId = Object.entries(snap.worktreeProjects ?? {}).find(([, name]) => name === projectName)?.[0];

    const created = graphManager.createReviewRequest({
      projectName,
      parentProjectName: path.basename(info.parentProjectPath),
      agentId,
      ...(subAgentId ? { subAgentId } : {}),
      ...(nodeId ? { worktreeNodeId: nodeId } : {}),
      worktreePath: info.path,
      ...(branch ? { branch } : {}),
      ...(baseBranch !== '' ? { baseBranch } : {}),
      files: changes.files,
      filesTruncated: changes.filesTruncated,
      diff: changes.diff,
      diffTruncated: changes.diffTruncated,
    });
    if (!created) return;

    // 표시는 §4 검수 카드 자리 — `reviewRequestId` 로 레코드를 가리킨다(새 카드 계열 ❌).
    const shown = changes.files
      .slice(0, 8)
      .map((f) => `${f.path} (+${f.additions}/-${f.deletions})${f.uncommitted === true ? ' *' : ''}`);
    if (changes.files.length > shown.length) shown.push(`… +${changes.files.length - shown.length}`);
    const card: AgentReview = {
      id: randomUUID(),
      agentId,
      ...(subAgentId ? { subAgentId } : {}),
      changes: shown,
      checkpoints: [],
      reviewRequestId: created.id,
      createdAt: Date.now(),
    };
    graphManager.addAgentReview(card);
    broadcast({ type: 'agent_review', payload: { agentId, subAgentId } } as WSMessage);
    broadcastSnapshot();
    saveCheckpoint();
    logger.info(`[review-lane] created review=${created.id} agent=${agent.label} branch=${branch ?? '?'} files=${changes.files.length}`);
  }

  /** 명령 큐에 한 건 넣고 바로 발사(반려 재작업 경로, 새 전송 경로 ❌). §5.3 #12-4 — 검증 범위는 부른 쪽이 정한다(랩은 과제 문장에서 만든 범위). */
  function enqueueAgentCommand(agentId: string, text: string, idTag: string, subAgentId?: string, verificationScope?: VerificationScope): boolean {
    const agent = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
    if (!agent) return false;
    const sessionId = agent.path;
    const sub = subAgentId ? subAgentManager.getSub(subAgentId)
      : subAgentManager.getPrimarySub(agentId) ?? subAgentManager.create(agentId);
    // A review belongs to its original conversation. A removed/foreign session is never replaced by the primary tab.
    if (!sub || sub.parentAgentId !== agentId) return false;
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now().toString(36)}-${idTag}${Math.random().toString(36).slice(2, 5)}`,
      text,
      timestamp: Date.now(),
      subAgentId: sub.id,
      status: 'queued',
      ...(verificationScope ? { verificationScope } : {}),
    };
    const queue = commandQueues.get(sessionId) ?? [];
    queue.push(cmd);
    commandQueues.set(sessionId, queue);
    processNextCommand(sessionId);
    return true;
  }

  /**
   * §5.16 — 승인 / 반려 / 보류.
   * 승인: §7.6 `performWorktreeMerge()` 를 그대로 — 실패면 `pending` 으로 돌아가 다시 승인할 수 있다.
   * 반려: 사유 필수, 클라가 번역해 조립한 `reworkPrompt` 를 명령 큐로(없으면 사유만 — 서버는 언어를 정하지 않는다). 보류: 적재만.
   */
  app.post('/api/review-requests/:id/decision', createReviewDecisionHandler({
    getReview: (id) => graphManager.getReviewRequest(id),
    recordDecision: (id, decision) => graphManager.recordReviewDecision(id, decision),
    enqueue: enqueueAgentCommand,
    merge: performWorktreeMerge,
    publish: () => { broadcastSnapshot(); saveCheckpoint(); },
    logInfo: (message) => logger.info(message),
    logError: (message, error) => logger.error(message, error),
  }));
  /** DELETE /api/review-requests/:id — 사람이 레인에서 치운다(서버는 스스로 지우지 않는다). §5.16 */
  app.delete('/api/review-requests/:id', (req, res) => {
    const removed = graphManager.deleteReviewRequest(req.params.id);
    if (!removed) { res.status(404).json({ ok: false, error: 'review not found' }); return; }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** 특정 프로젝트의 worktree 버블 → gitStatusService 로 넘길 resolve 정보 리스트 */
  function listWorktreeInfo(projectName: string): WorktreeResolveInfo[] {
    const info = graphManager.getProjectByName(projectName);
    if (!info) return [];
    const parentNorm = pathKey(info.path);
    const snap = graphManager.getSnapshot();
    const out: WorktreeResolveInfo[] = [];
    for (const node of snap.topFolders) {
      if (node.bubbleType !== 'worktree') continue;
      const p = pathKey(node.path ?? '');
      if (!p.startsWith(`${parentNorm}/.claude/worktrees/`)) continue;
      const absPath = (node.absolutePath ?? node.path).replace(/\//g, path.sep);
      out.push({ nodeId: node.id, name: node.label, absPath });
    }
    return out;
  }

  /** GET /api/git-status/:projectName?force=1 — §7.6 GitStatusCard 데이터 소스 */
  app.get('/api/git-status/:projectName', (req, res) => {
    void (async () => {
      try {
        const projectName = req.params.projectName;
        const project = graphManager.getProjectByName(projectName);
        if (!project) {
          res.status(404).json({ error: 'project not found' });
          return;
        }
        const cwd = project.path.replace(/\//g, path.sep);
        const worktrees = listWorktreeInfo(projectName);
        const force = req.query['force'] === '1' || req.query['force'] === 'true';
        const status = await gitStatusService.getStatus(projectName, cwd, worktrees, force);
        res.json(status);
      } catch (err) {
        logger.error('GET /api/git-status/:projectName failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /** §7.6 Commit — body { projectName, message? }, `git add -A && git commit -m "wip: <ts>"`. 실패면 stderr 를 409 로(GitErrorModal). */
  app.post('/api/git-commit', (req, res) => {
    void (async () => {
      try {
        const { projectName, message } = req.body as { projectName?: string; message?: string };
        if (typeof projectName !== 'string' || projectName.length === 0) {
          res.status(400).json({ error: 'projectName required' });
          return;
        }
        const project = graphManager.getProjectByName(projectName);
        if (!project) {
          res.status(404).json({ error: 'project not found' });
          return;
        }
        const cwd = project.path.replace(/\//g, path.sep);

        // 기본 메시지: "wip: YYYY-MM-DD HH:mm" (서버 로컬 타임, work-in-progress 관용)
        const now = new Date();
        const pad = (n: number): string => n.toString().padStart(2, '0');
        const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const commitMsg = typeof message === 'string' && message.trim() ? message.trim() : `wip: ${ts}`;

        // 1) add -A
        const add = await runGit(cwd, ['add', '-A']);
        if (add.code !== 0) {
          res.status(409).json({ ok: false, step: 'add', stderr: add.stderr || add.stdout || 'git add failed' });
          return;
        }
        // 2) commit — 빈 커밋은 에러로 튀는데, dirty 없으면 클라에서 버튼 비활성화 상태라 정상 경로에선 안 옴
        const commit = await runGit(cwd, ['commit', '-m', commitMsg]);
        if (commit.code !== 0) {
          res.status(409).json({
            ok: false,
            step: 'commit',
            message: commitMsg,
            stderr: commit.stderr || commit.stdout || 'git commit failed',
          });
          return;
        }

        gitStatusService.invalidate(projectName);
        broadcastSnapshot();
        res.json({ ok: true, message: commitMsg });
      } catch (err) {
        logger.error('POST /api/git-commit failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  /** POST /api/git-init — body { projectName }. git init 실행 후 캐시 무효화 + 재fetch + 브로드캐스트. */
  app.post('/api/git-init', (req, res) => {
    void (async () => {
      try {
        const { projectName } = req.body as { projectName?: string };
        if (typeof projectName !== 'string' || projectName.length === 0) {
          res.status(400).json({ error: 'projectName required' });
          return;
        }
        const project = graphManager.getProjectByName(projectName);
        if (!project) {
          res.status(404).json({ error: 'project not found' });
          return;
        }
        const cwd = project.path.replace(/\//g, path.sep);
        const init = await runGit(cwd, ['init']);
        if (init.code !== 0) {
          res.status(500).json({ error: 'git init failed', stderr: init.stderr });
          return;
        }
        gitStatusService.invalidate(projectName);
        const worktrees = listWorktreeInfo(projectName);
        const status = await gitStatusService.getStatus(projectName, cwd, worktrees, true);
        res.json({ ok: true, status });
      } catch (err) {
        logger.error('POST /api/git-init failed', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

  app.post('/api/dismiss-agent', (req, res) => {
    try {
      const { agentId } = req.body as { agentId?: string };
      if (typeof agentId !== 'string') {
        res.status(400).json({ error: 'agentId required' });
        return;
      }
      const sessionId = graphManager.findSessionByAgentId(agentId);
      // 실패 표식은 sub 에 걸려 있다 — 버블의 `error` 는 `recomputeCustomAgentStatus` 가 매 스윕(10초) subs 에서 다시 만드는 파생값이라,
      // 버블만 idle 로 내리면 빨강이 되살아난다. 세션 유무와 무관해 `if (sessionId)` 밖에서 부른다.
      const clearedErrors = subAgentManager.acknowledgeErrorSubs(agentId);
      let purged = 0;
      let wasSessionEnd = false;
      if (sessionId) {
        // 확인 dismiss 는 이제 `idle` 잔상 버블에서도 온다(§2.4 — 종료·크래시로 남은 것을
        // 눌러서 걷는 길). 그 클릭은 "세션이 방금 끝났다"가 아니므로 아래 두 가지를 가른다.
        const statusBefore = graphManager.getAgentBySession(sessionId)?.status;
        wasSessionEnd = statusBefore === 'completed' || statusBefore === 'error';
        purged = agentTracker.dismiss(sessionId).length;
      }
      // markAgentIdle 이 파일/폴더 엣지를 지우므로 바로 알려야 dismiss 때 폴더 버블이 사라진다(고정 제외).
      // 변한 게 없으면 저장하지 않는다. `clearedErrors` 를 조건에서 빼면 sub `error` 가 디스크에 남아 재기동 때 되살아난다.
      if (wasSessionEnd || purged > 0 || clearedErrors > 0) {
        broadcastSnapshot();
        saveCheckpoint();
      }
      res.json({ ok: true, purged, clearedErrors });
    } catch (err) {
      logger.error('POST /api/dismiss-agent failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.1 #2-1 (B) — IDE 에서 세션을 확인했다(탭 점 초록→회색). body `{ subAgentId }`.
   * 도는 턴이 없으면 묶음의 이번 턴을 닫는다(버블은 걷지 않는다) — 안 닫으면 확인한 지난 그림이 새 명령의 묶음에 들어온다. 판정은 서버(§3.1).
   */
  app.post('/api/agent-turn-ack', (req, res) => {
    try {
      const { subAgentId } = (req.body ?? {}) as { subAgentId?: unknown };
      if (typeof subAgentId !== 'string' || subAgentId.length === 0) {
        res.status(400).json({ error: 'subAgentId required' });
        return;
      }
      const sub = subAgentManager.getSub(subAgentId);
      const closed = sub ? graphManager.acknowledgeAgentTurn(sub.parentAgentId) : false;
      if (closed) {
        broadcastSnapshot();
        scheduleCheckpoint();
      }
      res.json({ ok: true, closed });
    } catch (err) {
      logger.error('POST /api/agent-turn-ack failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/usage-limit-ack — §2.4 한도 정지 표식(주황불)을 사용자가 확인했다.
   * body `{ subAgentIds?, agentIds? }` — 합집합으로 걷는다. `subAgentIds` = 세션 하나, `agentIds` = 그 버블의 멈춘 세션 전부.
   * 어느 세션을 걷을지는 서버가 정한다 — "지금 멈춰 있는가"는 `listUsageLimitedSubIds` 가 판정(§3.1).
   * 표식은 체크포인트에 실리므로(§5.5 #17-47 (C)) 걷었으면 **반드시 저장까지 간다** — 빼면 재기동 때 확인이 없던 일이 된다(`/api/dismiss-agent` 의 `clearedErrors` 와 같은 이유).
   */
  app.post('/api/usage-limit-ack', (req, res) => {
    try {
      const body = req.body as { subAgentIds?: unknown; agentIds?: unknown } | undefined;
      const asIds = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
      const subIds = asIds(body?.subAgentIds);
      const agentIds = asIds(body?.agentIds);
      if (subIds.length === 0 && agentIds.length === 0) {
        res.status(400).json({ error: 'subAgentIds or agentIds required' });
        return;
      }
      const targets = new Set<string>(subIds);
      for (const agentId of agentIds) {
        for (const id of subAgentManager.listUsageLimitedSubIds(agentId)) targets.add(id);
      }
      const cleared = subAgentManager.acknowledgeUsageLimits(targets);
      if (cleared.length > 0) {
        broadcastSnapshot();
        saveCheckpoint();
      }
      res.json({ ok: true, cleared });
    } catch (err) {
      logger.error('POST /api/usage-limit-ack failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  mountAgentCardTaskRoutes(app, {
    rootForAgent: (agentId) => graphManager.getProjectPathForAgent(agentId),
    sessionOwner: (sessionId) => subAgentManager.getSub(sessionId)?.parentAgentId,
    warn: (message) => logger.warn(message),
  });

  /** GET /api/subagents/:agentId — 해당 에이전트의 idle subagent 목록 (세션 선택용) */
  app.get('/api/subagents/:agentId', (req, res) => {
    const { agentId } = req.params;
    const idle = subAgentManager.getIdleSubs(agentId);
    res.json({ subAgents: idle });
  });

  /** POST /api/subagents/:agentId — 빈 SubAgent 생성 (IDE + 탭용).
   *  body.subAgentId 가 있으면 그 id 로 생성(클라이언트 optimistic create — 응답 대기 없이 즉시 포커스).
   *  §5.5 #17-29 — 훅 버블에는 세션을 새로 붙이지 않는다(읽기 전용). */
  app.post('/api/subagents/:agentId', (req, res) => {
    const { agentId } = req.params;
    if (isReadOnlyHookAgentId(agentId)) {
      res.status(403).json({ ok: false, error: READ_ONLY_HOOK_AGENT_ERROR });
      return;
    }
    const body = req.body as { subAgentId?: unknown } | undefined;
    const preferredId = typeof body?.subAgentId === 'string' && body.subAgentId.startsWith('sub-')
      ? body.subAgentId
      : undefined;
    const sub = subAgentManager.create(agentId, preferredId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, subAgent: sub });
  });

  /** POST /api/subagents/:agentId/:subId/stop — 실행 중인 서브에이전트 중지 (탭/세션은 유지).
   *  실행 중이 아니면 409. 성공 시 cmd.result 가 `[Stopped by user]` 로 채워진다(persistent 는 그 자리에서,
   *  legacy 는 close 핸들러가). */
  app.post('/api/subagents/:agentId/:subId/stop', subAgentOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    const { subId } = req.params;
    cancelOrchestraForSession(req.params.agentId, subId);
    const ok = subAgentManager.stop(subId);
    if (!ok) {
      res.status(409).json({ ok: false, error: 'not running' });
      return;
    }
    res.json({ ok: true });
  });

  /**
   * §5.3 #9-1 (P)(b) — 조용한 압축이 도는 동안 실행 중으로 보이던 명령을 [중지]가 봉합한다.
   * 큐의 사실은 `queued` 지만 화면은 실행 중으로 그렸다(`displayCommands`, 가려내는 규칙은 같은 `silentPreCompactHeirs`) — 다른 대기 명령처럼 버리면 말풍선이 통째로 사라지므로 `[Stopped by user]` 로 대화에 남긴다. 자리는 압축이 나간 시각.
   * 위임 장부는 호출자가 "나가기 전 취소"로 내린다 — CLI 에 닿은 적이 없다.
   */
  function sealStoppedHeir(c: QueuedCommand, silentStartedAt: number | undefined): QueuedCommand {
    c.status = 'completed';
    c.result = '[Stopped by user]';
    c.stopReason = 'cancelled'; // §5.5 #17-12 ③-6 — 사용자 [중지]가 봉합한 턴
    if (c.startedAt === undefined && silentStartedAt !== undefined) c.startedAt = silentStartedAt;
    return c;
  }

  /**
   * §5.5 #17-10 — POST /api/subagents/:agentId/:subId/stop-session — 열려 있는 그 세션 하나만 중지한다(`stop-all` 은 다른 세션 탭까지 끊는다).
   *   1) 이 세션의 반복 루프를 끄고 이 세션의 `queued` 명령만 폐기. 2) `subAgentManager.stop(subId)` — 그 탭의 자식 프로세스 트리 / agent-view worker 종료 + 백그라운드 서브에이전트 대차대조 해제.
   *   3) 살아있는 자식 없이 `executing` 에 굳은 이 세션의 명령만 `[Stopped by user]` 봉합.
   * 1) 이 2) 보다 먼저다(§5.5 #17-18): `stop()` 마감이 부르는 `onComplete` 가 곧바로 다음 차례를 집으므로, 큐·루프가 남아 있으면 멈춘 뒤 다음 명령이나 루프 회차가 저절로 돈다.
   * 실행 중인 게 없어도 200(멱등) — 두 번 눌러도 에러 카드가 뜨지 않게.
   */
  app.post('/api/subagents/:agentId/:subId/stop-session', subAgentOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    const { agentId, subId } = req.params;
    cancelOrchestraForSession(agentId, subId);
    // §5.5 #17-11 — 이 세션의 반복 루프도 함께 끈다. 안 끄면 중지 직후 루프가 다음 회차를 밀어 넣어 "눌러도 안 멈춘다"가 재발한다.
    const loopStopped = stopSessionLoop(subId, 'stopped');

    let cancelledQueued = 0;
    let sealedExecuting = 0;
    let sealedHeirs = 0;
    const sessionId = graphManager.findSessionByAgentId(agentId);
    const queueBeforeStop = sessionId ? commandQueues.get(sessionId) : undefined;
    if (queueBeforeStop && sessionId) {
      // §5.3 #9-1 (P)(b) — 조용한 압축이 도는 동안 실행 중으로 보이던 명령은 버리지 않고 봉합한다.
      const heirs = silentPreCompactHeirs(queueBeforeStop);
      const remaining: QueuedCommand[] = [];
      const sealed: QueuedCommand[] = [];
      for (const c of queueBeforeStop) {
        // 다른 세션 소유 명령은 손대지 않는다 — 이 라우트의 존재 이유.
        if (c.subAgentId === subId && c.status === 'queued') {
          cancelledQueued++;
          // §5.3 #10-2 — 안 나간 위임 명령도 끝이 있어야 한다(없으면 장부는 영영 queued, 동기 대기는 안 풀린다).
          settleDispatchCommand(c, { outcome: { status: 'cancelled', errorMessage: 'stopped by user before start' }, updateEdge: true, neverStarted: true });
          if (heirs.has(c)) sealed.push(sealStoppedHeir(c, heirs.get(c)));
          continue;
        }
        remaining.push(c);
      }
      commandQueues.set(sessionId, remaining);
      sealedHeirs = sealed.length;
      archiveCompletedCommands(sessionId, sealed);
    }

    const stopped = subAgentManager.stop(subId);

    // `stop()` 의 마감이 큐를 아카이브로 옮겼을 수 있다 — 지금 큐를 다시 읽는다.
    const queue = sessionId ? commandQueues.get(sessionId) : undefined;
    if (queue && sessionId) {
      const remaining: QueuedCommand[] = [];
      // 봉합한 명령은 stop-all 과 동일하게 Results 아카이브로 넘긴다 — 평소 완료 경로와 같은 자리에
      // `[Stopped by user]` 로 남아야 사용자가 "왜 사라졌지"를 겪지 않는다.
      const sealed: QueuedCommand[] = [];
      for (const c of queue) {
        if (c.subAgentId !== subId) { remaining.push(c); continue; }
        if (c.status === 'executing' && !subAgentManager.isSubRunning(subId)) {
          c.status = 'completed';
          c.result = '[Stopped by user]';
          c.stopReason = 'cancelled'; // §5.5 #17-12 ③-6 — 사용자 [중지]가 봉합한 턴
          sealedExecuting++;
          sealed.push(c);
          // §5.3 #10-2 — 이 봉합은 완료 콜백을 거치지 않는다. 장부·대기·엣지를 여기서 함께 내린다.
          settleDispatchCommand(c, { updateEdge: true });
          const sealedSub = subAgentManager.getSub(subId);
          if (sealedSub && sealedSub.status === 'active') {
            sealedSub.status = 'idle';
            sealedSub.lastActivityAt = Date.now();
          }
          continue;
        }
        remaining.push(c);
      }
      commandQueues.set(sessionId, remaining);
      if (sealed.length > 0) {
        archiveCompletedCommands(sessionId, sealed);
      }
    }

    logger.info(
      `[stop-session] agent=${agentId} sub=${subId} stopped=${stopped} cancelledQueued=${cancelledQueued} sealedHeirs=${sealedHeirs} sealedExecuting=${sealedExecuting} loopStopped=${loopStopped}`,
    );
    flushOrchestraResults();
    graphManager.recomputeCustomAgentStatus(agentId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, stopped, cancelledQueued, sealedExecuting, loopStopped });
  });

  /**
   * 에이전트 하나의 3단 중지 — 순서도 이대로(큐가 프로세스보다 먼저, §5.5 #17-18): ① 세션 큐의 `queued` 전량 폐기(루프도 끔 — 다음 명령이 튀어나오지 않게)
   * ② `subAgentManager.stopAll` — 모든 탭의 자식 트리·agent-view worker 종료 + 백그라운드 서브에이전트 대차대조(§5.3 #12-1) 해제
   * ③ 자식 없이 `executing` 에 걸린 명령은 `[Stopped by user]` 봉합 + sub idle(자식이 있으면 close 핸들러가 마무리).
   * `stop-all` 과 §5.4 #14-3 프로젝트 탭 [닫기]가 함께 쓴다 — 두 벌이면 한쪽만 고쳐진다. broadcast·저장은 호출자가 한 번만(수십 개를 돌 때의 부하).
   */
  function stopAllSessionsForAgent(agentId: string): {
    stopped: number;
    cancelledQueued: number;
    sealedExecuting: number;
    loopsStopped: number;
  } {
    cancelOrchestraForSession(agentId);
    // §5.5 #17-11 — 이 에이전트의 모든 세션 루프도 함께 끈다.
    // §5.5 #17-18 — 루프와 큐를 프로세스보다 먼저 비운다. `stopAll` 마감의 `onComplete` 가 곧바로 다음 차례를 집으므로, 큐가 남아 있으면 아직 안 멈춘 탭으로 명령이 나가거나 멈춘 탭의 명령이 큐로 돌아왔다가 저절로 실행된다.
    const loopsStopped = stopSessionLoopsForAgent(agentId);

    let cancelledQueued = 0;
    let sealedExecuting = 0;
    const sessionId = graphManager.findSessionByAgentId(agentId);
    const queueBeforeStop = sessionId ? commandQueues.get(sessionId) : undefined;
    if (queueBeforeStop && sessionId) {
      // §5.3 #9-1 (P)(b) — 조용한 압축이 도는 동안 실행 중으로 보이던 명령은 버리지 않고 봉합한다
      //   (stop-session 과 같은 규칙 — 두 [중지]가 다르게 끝나면 탭에 따라 명령이 남고 사라진다).
      const heirs = silentPreCompactHeirs(queueBeforeStop);
      const remaining: QueuedCommand[] = [];
      const sealed: QueuedCommand[] = [];
      for (const c of queueBeforeStop) {
        if (c.status === 'queued') {
          cancelledQueued++;
          // §5.3 #10-2 — 안 나간 위임 명령도 끝이 있어야 한다(없으면 장부는 영영 queued, 동기 대기는 안 풀린다).
          settleDispatchCommand(c, { outcome: { status: 'cancelled', errorMessage: 'stopped by user before start' }, updateEdge: true, neverStarted: true });
          if (heirs.has(c)) sealed.push(sealStoppedHeir(c, heirs.get(c)));
          continue;
        }
        remaining.push(c);
      }
      commandQueues.set(sessionId, remaining);
      archiveCompletedCommands(sessionId, sealed);
    }

    const stopped = subAgentManager.stopAll(agentId);

    // `stopAll` 의 마감이 큐를 아카이브로 옮겼을 수 있다 — 지금 큐를 다시 읽는다.
    const queue = sessionId ? commandQueues.get(sessionId) : undefined;
    if (queue && sessionId) {
      const remaining: QueuedCommand[] = [];
      // 봉합한 명령은 그냥 버리지 않고 Results 아카이브로 넘긴다 — 평소 완료 경로와 같은 자리에
      // `[Stopped by user]` 로 남아야 사용자가 "왜 사라졌지"를 겪지 않는다.
      const sealed: QueuedCommand[] = [];
      for (const c of queue) {
        if (c.status === 'executing' && !(c.subAgentId && subAgentManager.isSubRunning(c.subAgentId))) {
          // 자식은 이미 없는데 executing 으로 굳어 있던 건 — 여기서 봉합해야 UI 가 Run 으로 돌아온다.
          c.status = 'completed';
          c.result = '[Stopped by user]';
          c.stopReason = 'cancelled'; // §5.5 #17-12 ③-6 — 사용자 [중지]가 봉합한 턴
          sealedExecuting++;
          sealed.push(c);
          // §5.3 #10-2 — 이 봉합은 완료 콜백을 거치지 않는다. 장부·대기·엣지를 여기서 함께 내린다.
          settleDispatchCommand(c, { updateEdge: true });
          const sealedSub = c.subAgentId ? subAgentManager.getSub(c.subAgentId) : undefined;
          if (sealedSub && sealedSub.status === 'active') {
            sealedSub.status = 'idle';
            sealedSub.lastActivityAt = Date.now();
          }
          continue;
        }
        remaining.push(c);
      }
      commandQueues.set(sessionId, remaining);
      if (sealed.length > 0) {
        archiveCompletedCommands(sessionId, sealed);
      }
    }

    flushOrchestraResults();
    graphManager.recomputeCustomAgentStatus(agentId);
    return { stopped: stopped.length, cancelledQueued, sealedExecuting, loopsStopped };
  }

  /**
   * §5.5 #17-9 — 에이전트 전체 중지. 메인 탭 전용 — 세션 탭이 열려 있으면 `/:subId/stop-session` 으로 간다(§5.5 #17-10, 다른 탭 보호).
   * 실행 중인 게 없어도 200(멱등).
   */
  app.post('/api/subagents/:agentId/stop-all', (req, res) => {
    const { agentId } = req.params;
    const r = stopAllSessionsForAgent(agentId);

    logger.info(
      `[stop-all] agent=${agentId} stoppedSubs=${r.stopped} cancelledQueued=${r.cancelledQueued} sealedExecuting=${r.sealedExecuting} loopsStopped=${r.loopsStopped}`,
    );
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, ...r });
  });

  /**
   * §5.4 #14-3 — POST /api/projects/:name/stop-agents — 탭 하나(또는 전체)의 에이전트를 멈춘다(프로젝트 탭 × 확인 팝업의 [닫기]).
   * 목록은 서버가 만든다(§3.1) — 배경 탭의 버블은 클라 스냅샷에 안 실려 올 수 있어(§9 스코프드 구독) 클라가 세면 프로세스가 살아남는다.
   * body `{ scope: 'project' | 'all' }` — `'all'` 은 열린 모든 인스턴스를 훑는다. 도는 게 없어도 200(멱등).
   */
  app.post('/api/projects/:name/stop-agents', (req, res) => {
    try {
      const ref = decodeURIComponent(req.params.name);
      const scope = (req.body as { scope?: string } | undefined)?.scope === 'all' ? 'all' : 'project';
      const agentIds = graphManager.listAgentIdsForProject(scope === 'all' ? null : ref);

      let stopped = 0;
      let cancelledQueued = 0;
      let sealedExecuting = 0;
      let loopsStopped = 0;
      for (const agentId of agentIds) {
        const r = stopAllSessionsForAgent(agentId);
        stopped += r.stopped;
        cancelledQueued += r.cancelledQueued;
        sealedExecuting += r.sealedExecuting;
        loopsStopped += r.loopsStopped;
      }

      logger.info(
        `[stop-agents] scope=${scope} ref=${ref} agents=${agentIds.length} stoppedSubs=${stopped} cancelledQueued=${cancelledQueued} sealedExecuting=${sealedExecuting} loopsStopped=${loopsStopped}`,
      );
      // broadcast·저장은 여기서 **한 번만** — 에이전트마다 뿌리면 그 자체가 부하다.
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, scope, agents: agentIds.length, stopped, cancelledQueued, sealedExecuting, loopsStopped });
    } catch (err) {
      logger.error('POST /api/projects/:name/stop-agents failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /api/subagents/:agentId/running-task/:taskId — 실행 중 목록에서 그 항목 하나만 내린다(매달린 자식 하나 때문에 형제 작업까지 죽이지 않게).
   * 우리 장부에서만 내린다 — 프로세스는 끊지 않는다(개별 자식은 그 자식을 띄운 에이전트가 `TaskStop` 으로 끊는다).
   */
  app.delete('/api/subagents/:agentId/running-task/:taskId', (req, res) => {
    const { agentId, taskId } = req.params;
    const dismissed = subAgentManager.dismissRunningTask(agentId, taskId);
    if (dismissed) {
      graphManager.recomputeCustomAgentStatus(agentId);
      broadcastSnapshot();
    }
    // 이미 끝나서 사라진 뒤 눌러도 200 (멱등) — 사용자가 두 번 눌러 에러 카드를 보지 않게.
    res.json({ ok: true, dismissed });
  });

  // Queue and loop cleanup must precede provider stop, whose completion callback may dispatch again.
  const prepareSessionsForRemoval = (agentId: string, ids: string[]): void => {
    const selected = ids.filter((id) => !!subAgentManager.getSub(id));
    for (const id of selected) {
      clearSessionLoopTimer(id);
      graphManager.deleteSessionLoop(id);
    }
    discardSessionQueuedCommands(commandQueues, graphManager.findSessionByAgentId(agentId), new Set(selected), (command) => {
      settleDispatchCommand(command, {
        outcome: { status: 'cancelled', errorMessage: 'session closed before start' }, updateEdge: true, neverStarted: true,
      });
    });
    for (const id of selected) cancelOrchestraForSession(agentId, id);
  };

  /** DELETE /api/subagents/:agentId/:subId — 서브에이전트 탭 닫기(세션 종료+삭제) */
  app.delete('/api/subagents/:agentId/:subId', subAgentOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    const { subId } = req.params;
    prepareSessionsForRemoval(req.params.agentId, [subId]);
    const ok = subAgentManager.remove(subId);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'sub not found' });
      return;
    }
    // §5.5 #17-11 — 탭이 사라지면 그 탭의 루프도 사라진다(좀비 루프 차단).
    clearSessionLoopTimer(subId);
    graphManager.deleteSessionLoop(subId);
    // §5.5 #17-17 — 목표도 같은 수명(탭이 없으면 향할 세션도 없다).
    graphManager.deleteSessionGoal(subId);
    // §5.5 #17-28 — 그 탭에만 걸어 둔 주입원 오버라이드도 함께(좀비 설정 차단).
    graphManager.deleteContextOverridesForSession(subId);
    // §5.11 정독 게이트 — 읽기 영수증 원장도 같은 수명이다. 남겨 두면 없는 탭의 정독 숫자가
    //   활동바·정독 뷰에 계속 뜬다(닫은 탭의 좀비 상태 — 루프·목표와 같은 규칙).
    specReadingService.forget(subId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /**
   * POST /api/subagents/:agentId/remove-bulk — 여러 탭을 한 번에 닫기(다른 탭 / 오른쪽 / 모두 닫기).
   * 개별 DELETE N번이면 요청마다 broadcastSnapshot + saveCheckpoint(전체 직렬화 + worktree prune)가 돌아 한 개씩 느리게 닫힌다 — 모두 제거한 뒤 1회만 한다.
   */
  app.post('/api/subagents/:agentId/remove-bulk', (req, res) => {
    const body = req.body as { ids?: unknown } | undefined;
    const ids = Array.isArray(body?.ids)
      ? body!.ids.filter((x): x is string => typeof x === 'string')
      : null;
    if (!ids || ids.length === 0) {
      res.status(400).json({ ok: false, error: 'ids must be non-empty string[]' });
      return;
    }
    // Validate the whole batch before removing anything; a stale selection must not cross parents.
    if (hasForeignSubAgent((id) => subAgentManager.getSub(id), req.params.agentId, ids)) {
      res.status(404).json({ ok: false, error: 'session not found for agent' });
      return;
    }
    prepareSessionsForRemoval(req.params.agentId, ids);
    let removed = 0;
    for (const id of ids) {
      if (!subAgentManager.remove(id)) continue;
      removed++;
      // §5.5 #17-11 — 닫은 탭의 루프 동반 삭제(개별 DELETE 경로와 같다).
      clearSessionLoopTimer(id);
      graphManager.deleteSessionLoop(id);
      // §5.5 #17-17 — 목표도 동반 삭제.
      graphManager.deleteSessionGoal(id);
      // §5.5 #17-28 — 세션 층 오버라이드도 동반 삭제.
      graphManager.deleteContextOverridesForSession(id);
      // §5.11 정독 게이트 — 원장도 동반 삭제(개별 DELETE 경로와 같은 규칙).
      specReadingService.forget(id);
    }
    if (removed > 0) {
      broadcastSnapshot();
      saveCheckpoint();
    }
    res.json({ ok: true, removed });
  });

  /** GET /api/subagents/:agentId/history — 이 부모 에이전트가 과거에 소유했던(탭 닫은) SubAgent 목록.
   *  소프트 아카이브에서 읽음 → 다른 에이전트·VSCode 메인 세션은 섞이지 않음. */
  app.get('/api/subagents/:agentId/history', (req, res) => {
    const { agentId } = req.params;
    const archived = subAgentManager.getArchived(agentId);
    const items: SubAgentHistoryItem[] = archived.map((s) => ({
      subAgentId: s.id,
      sessionId: s.sessionId,
      label: s.label,
      lastCommand: s.lastCommand,
      lastActivityAt: s.lastActivityAt,
      totalInputTokens: s.totalInputTokens,
      totalOutputTokens: s.totalOutputTokens,
    }));
    res.json({ ok: true, items });
  });

  /** POST /api/subagents/:agentId/restore — archive에서 registry로 되돌림.
   *  body: { subAgentId }. 이미 registry에 있으면(중복) 그 인스턴스 반환.
   *  §5.5 #17-29 — 과거 세션 되살리기도 "세션 추가"라 훅 버블에는 허용하지 않는다. */
  app.post('/api/subagents/:agentId/restore', (req, res) => {
    const { agentId } = req.params;
    if (isReadOnlyHookAgentId(agentId)) {
      res.status(403).json({ ok: false, error: READ_ONLY_HOOK_AGENT_ERROR });
      return;
    }
    const body = req.body as { subAgentId?: unknown } | undefined;
    const sid = typeof body?.subAgentId === 'string' ? body.subAgentId : '';
    if (!sid) {
      res.status(400).json({ ok: false, error: 'subAgentId required' });
      return;
    }

    const revived = subAgentManager.restoreFromArchive(sid, agentId);
    if (!revived) {
      res.status(404).json({ ok: false, error: 'archived sub not found' });
      return;
    }

    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, subAgent: revived });
  });

  /** PATCH /api/subagents/:agentId/order — 서브에이전트 탭 순서 저장 */
  app.patch('/api/subagents/:agentId/order', (req, res) => {
    const { agentId } = req.params;
    const body = req.body as { order?: unknown } | undefined;
    const order = Array.isArray(body?.order) ? body!.order.filter((x): x is string => typeof x === 'string') : null;
    if (!order) {
      res.status(400).json({ ok: false, error: 'order must be string[]' });
      return;
    }
    const ok = subAgentManager.reorder(agentId, order);
    if (!ok) {
      res.status(409).json({ ok: false, error: 'order mismatch' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** GET /api/subagent-streams/:agentId — 에이전트 전체 서브에이전트 스트림 버퍼 (IDE 열 때 초기 데이터).
   *  버퍼는 emit 시점에 디스크 append-only로 기록되므로(streamBufferStore), 서버 재시작 후에도 live와 동일한 타임라인이 복원된 상태다. */
  app.get('/api/subagent-streams/:agentId', async (req, res) => {
    const { agentId } = req.params;
    if (req.query.searchTerms !== undefined) {
      const terms = parseConversationSearchTerms(req.query.searchTerms);
      if (terms === null) {
        res.status(400).json({ error: 'searchTerms must be a JSON array of at most 32 strings, each at most 512 characters' });
        return;
      }
      const subs = [...subAgentManager.getAllSubs(agentId), ...subAgentManager.getArchived(agentId)];
      const queueKeys = new Set([agentId, graphManager.findSessionByAgentId(agentId), ...subs.map((sub) => sub.sessionId)].filter((id): id is string => !!id));
      const commands = [...queueKeys].flatMap((id) => [
        ...(completedCommandArchive.get(id) ?? []), ...(commandQueues.get(id) ?? []),
      ]);
      const controller = new AbortController();
      const abortSearch = () => controller.abort();
      res.once('close', abortSearch);
      try {
        const matches = await searchSessionConversations({
          agentId,
          projects: [...Object.values(graphManager.getProjects()), ...Object.values(graphManager.getStubProjects()).map((meta) => meta.project)],
          subIds: subs.map((sub) => sub.id),
          commands,
          terms,
          signal: controller.signal,
        });
        res.json({ matches });
      } catch (error) {
        if (controller.signal.aborted) return;
        logger.warn(`conversation search failed (${agentId}): ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({ error: 'Could not search saved conversations' });
      } finally {
        res.off('close', abortSearch);
      }
      return;
    }
    const buffers = subAgentManager.getStreamBuffersForAgent(agentId);
    res.json({ streams: buffers });
  });

  /**
   * GET /api/subagent-streams/:agentId/:subId — 한 세션의 깊은 복원분(§5.5).
   * 전체 조회는 세션마다 얕게 준다 — 실제로 여는 세션만 여기서 `MAX_STREAM_BUFFER` 전체를 받아, 오래된 대화가 말풍선과 카드만 남지 않게 한다.
   */
  app.get('/api/subagent-streams/:agentId/:subId', (req, res) => {
    const { agentId, subId } = req.params;
    // 부모 id 를 함께 넘긴다 — 복원 직후처럼 그 sub 가 아직 index 에 없어도 디스크에서 읽어 준다
    // (빈 배열이 나가면 클라가 얕은 창에 갇혀 대화 중간이 빈 채로 굳는다).
    res.json({ events: subAgentManager.getStreamBuffer(subId, agentId) });
  });

  /**
   * GET /api/subagent-streams/:agentId/:subId/older?beforeId=&beforeTs=&limit= — §5.5 #17-12 복원 창 위쪽 한 쪽.
   * 깊은 복원분(마지막 `MAX_STREAM_BUFFER` 건)보다 오래된 대화. 사용자가 그 경계 가까이 올라왔을 때만 클라가 부른다(IDE 여는 비용은 그대로).
   * 컴팩션으로 보관 파일에 옮겨진 앞부분까지 거슬러 읽는다.
   */
  app.get('/api/subagent-streams/:agentId/:subId/older', (req, res) => {
    const { agentId, subId } = req.params;
    const beforeId = typeof req.query.beforeId === 'string' && req.query.beforeId !== '' ? req.query.beforeId : undefined;
    const beforeTs = typeof req.query.beforeTs === 'string' ? Number(req.query.beforeTs) : Number.NaN;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : Number.NaN;
    res.json(subAgentManager.getOlderStreamEvents(
      subId,
      agentId,
      { ...(beforeId ? { beforeId } : {}), ...(Number.isFinite(beforeTs) ? { beforeTs } : {}) },
      Number.isFinite(limit) ? limit : undefined,
    ));
  });

  /**
   * GET /api/codex-image/:agentId/:subId/:eventId — §5.25 (O) 엔진이 대화에 내건 그림 한 장.
   * **클라가 준 경로를 열지 않는다** — 이벤트 id 로 그 세션 스트림을 되짚어 거기 적힌 `imagePath` 만 연다(경로를 인자로 받으면 아무 파일이나 읽어 주는 문이 된다 — 시연 프레임 라우트의 `rel` 대조와 같은 규율).
   * 스트림은 디스크에 남아 `getStreamBuffer` 가 되읽으므로 재기동 뒤에도 옛 그림이 뜬다(따로 등록부를 두지 않는다).
   */
  app.get('/api/codex-image/:agentId/:subId/:eventId', (req, res) => {
    const { agentId, subId, eventId } = req.params;
    const events = subAgentManager.getStreamBuffer(subId, agentId);
    const hit = events.find((e) => e.id === eventId);
    const filePath = hit?.imagePath ?? '';
    if (!filePath) { res.status(404).json({ error: 'not found' }); return; }
    // 스트림에 적혔더라도 다시 한 번 본다 — 적히는 쪽이 느슨해지는 날 이 문이 함께 느슨해지지 않게.
    if (!isCodexImageFile(filePath)) { res.status(403).json({ error: 'not an image' }); return; }
    const resolved = path.resolve(filePath);
    // 그림은 사용자의 기계 곳곳에 있다(프로젝트 폴더·코덱스 홈·임시 폴더) — 폴더로 가둘 수 없어
    //   **기록과의 일치**가 유일한 관문이다. 그 대신 심볼릭 링크로 새어 나가지 않게 실경로로 편다.
    let real: string;
    try {
      real = fs.realpathSync(resolved);
    } catch {
      res.status(404).json({ error: 'file missing' }); return;
    }
    if (!isCodexImageFile(real)) { res.status(403).json({ error: 'not an image' }); return; }
    const ext = real.slice(real.lastIndexOf('.') + 1).toLowerCase();
    res.type(ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
    fs.createReadStream(real).pipe(res);
  });

  /** PATCH /api/bubble/:nodeId/label — 버블 이름 변경 */
  app.patch('/api/bubble/:nodeId/label', (req, res) => {
    try {
      const { nodeId } = req.params;
      const { label } = req.body as { label?: string };
      if (typeof label !== 'string' || !label.trim()) {
        res.status(400).json({ error: 'label required' });
        return;
      }
      graphManager.updateBubbleLabel(nodeId, label.trim());
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('PATCH /api/bubble/label failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── Skills Discovery ───

  /** §5.5 #17-2/#17-4 — 목록 한 줄. 정의는 `@vibisual/shared` 의 `AvailableSkill` 하나이고 여기서는 별칭만 둔다 — 서버와 화면이 각자 모양을 들면 새 칸이 한쪽에만 생겨 조용히 어긋난다. */
  type SkillInfo = AvailableSkill;

  /** SKILL.md frontmatter에서 name/description 파싱 */
  function parseSkillMd(filePath: string): { name: string; description: string } | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      // YAML frontmatter: --- 로 시작, --- 로 끝
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fmMatch?.[1]) return null;
      const fm = fmMatch[1];
      const nameMatch = fm.match(/^name:\s*(.+)$/m);
      const descMatch = fm.match(/^description:\s*["']?(.*?)["']?\s*$/m);
      if (!nameMatch?.[1]) return null;
      return {
        name: nameMatch[1].trim().replace(/^["']|["']$/g, ''),
        description: descMatch?.[1]?.trim() ?? '',
      };
    } catch {
      return null;
    }
  }

  /** 디렉토리 내 스킬 폴더들 스캔 → SkillInfo[] */
  function scanSkillsDir(dir: string, source: 'project' | 'global' | 'plugin', pluginName?: string): SkillInfo[] {
    const results: SkillInfo[] = [];
    try {
      if (!fs.existsSync(dir)) return results;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(dir, entry.name, 'SKILL.md');
        const parsed = parseSkillMd(skillMd);
        if (parsed) {
          results.push({ name: parsed.name, description: parsed.description, source, pluginName });
        }
      }
    } catch { /* ignore */ }
    return results;
  }

  /**
   * 슬래시 커맨드 `.md` 1개 파싱 → description. (커맨드는 skill 과 달리 frontmatter 가 선택)
   * frontmatter `description:` 우선, 없으면 본문 첫 비어있지 않은 줄(헤딩/HTML 주석 제외) — Claude Code 규칙.
   */
  function parseCommandMd(filePath: string): { description: string } | null {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      const fm = fmMatch?.[1] ?? '';
      const body = fmMatch ? (fmMatch[2] ?? '') : content;
      const descMatch = fm.match(/^description:\s*["']?(.*?)["']?\s*$/m);
      if (descMatch?.[1]) {
        return { description: descMatch[1].trim().replace(/^["']|["']$/g, '') };
      }
      const firstLine = body
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('<!--'));
      return { description: firstLine ?? '' };
    } catch {
      return null;
    }
  }

  /**
   * `.claude/commands/` 재귀 스캔 → SkillInfo[]. Claude Code 가 슬래시 커맨드를 읽는 디렉토리.
   * 최상위 `foo.md` → `foo`, 하위폴더 `bar/baz.md` → `bar:baz` (네임스페이스). skill 폴더와 달리 폴더가 아니라 `.md` 파일이 단위.
   */
  function scanCommandsDir(baseDir: string, source: 'project' | 'global' | 'plugin', pluginName?: string): SkillInfo[] {
    const results: SkillInfo[] = [];
    const walk = (dir: string, prefix: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, prefix ? `${prefix}:${entry.name}` : entry.name);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const base = entry.name.slice(0, -'.md'.length);
          const name = prefix ? `${prefix}:${base}` : base;
          const parsed = parseCommandMd(full);
          results.push({ name, description: parsed?.description ?? '', source, pluginName });
        }
      }
    };
    if (!fs.existsSync(baseDir)) return results;
    walk(baseDir, '');
    return results;
  }

  // §5.5 #17-33 ⑦ — "이 플러그인 스킬이 실제로 실리는가" 판정.
  // 안 깔리거나 꺼진 스킬을 고르면 프롬프트에 `/이름` 이 붙어 나가도(`skillsPrefix`) CLI 가 풀지 못한다 — 이 목록도 #17-33 ② 대로 CLI 자신의 답을 따른다.

  /**
   * 플러그인 설치·활성 상태 메모.
   * `/api/claude-plugins`(플러그인 창)는 캐시 없이 매번 CLI 에 묻지만, 이 목록은 IDE·세션 입력창을 띄울 때마다 불려 그때마다 461ms 짜리 스폰을 태울 수 없다.
   * 그래서 여기서만 짧게 들고, 플러그인을 바꾸는 아홉 동작과 자동 갱신이 끝날 때 한 곳에서 버린다.
   */
  const pluginStateCache = new Map<string, { at: number; inv: ClaudePluginInventory }>();
  const PLUGIN_STATE_TTL_MS = 60_000;

  /** 메모를 버린다 — 플러그인 상태를 바꾼 모든 자리가 이 하나를 부른다(빠뜨리면 목록이 옛 상태로 굳는다). */
  function invalidatePluginStateCache(): void {
    pluginStateCache.clear();
  }
  // 자동 갱신이 끝나면(마켓을 끌어왔거나 설치본을 올렸으면) 목록도 다시 세어야 한다.
  onClaudePluginRefreshed(invalidatePluginStateCache);

  async function getPluginState(projectPath: string): Promise<ClaudePluginInventory | null> {
    const key = pathKey(projectPath);
    const hit = pluginStateCache.get(key);
    if (hit && Date.now() - hit.at < PLUGIN_STATE_TTL_MS) return hit.inv;
    const inv = await scanClaudePlugins(projectPath);
    // 못 물었으면 메모하지 않는다 — 사유를 60초 동안 붙들면 CLI 가 돌아와도 목록이 안 살아난다.
    if (inv.unavailable) return null;
    pluginStateCache.set(key, { at: Date.now(), inv });
    return inv;
  }

  /** 스킬 한 줄에 새길 날것 세 칸 — 접는 것은 화면이 아니라 shared 의 `resolveSkillPluginState` 다. */
  type SkillPluginStatus = { id: string; installed: boolean; enabled: boolean; placement?: ClaudePluginPlacement };

  /** 같은 이름이 여러 자리에 깔렸을 때 **이 세션에 실제로 오는 쪽**이 이긴다. 클수록 이긴다. */
  function skillStatusRank(st: SkillPluginStatus): number {
    if (st.placement === 'other-project') return 0;
    return st.enabled ? 2 : 1;
  }

  /** 플러그인 이름 → 이 세션에서의 상태. CLI 에 못 물었으면 `null` 이고 그때는 아무 표식도 달지 않는다 — "안 깔렸다"고 잘못 적어 멀쩡한 스킬에 설치 단추를 붙이는 것이 목록이 잠깐 비는 것보다 나쁘다. */
  async function pluginSkillStatus(
    projectPath: string | null,
  ): Promise<Map<string, SkillPluginStatus> | null> {
    if (!projectPath) return null;
    const inv = await getPluginState(projectPath);
    if (!inv) return null;
    const byName = new Map<string, SkillPluginStatus>();
    // 깔린 것 먼저 — 같은 이름이 마켓에도 있으면 **깔린 쪽이 이긴다**(그것이 실제로 도는 것이다).
    for (const p of inv.installed) {
      const cand: SkillPluginStatus = {
        id: p.id,
        installed: true,
        // 깔림과 켜짐은 다른 상태이고(③), 남의 프로젝트에 매인 것은 켜져 있어도 이 세션엔 안 온다.
        enabled: p.enabled && placementAppliesHere(p.placement),
        // ⑦ — 화면이 `꺼짐`(사용자가 끔)과 `다른 프로젝트`(여기엔 설치본이 없음)를 가르는 칸.
        // 이 칸이 없으면 둘이 같은 `enabled:false` 로 접혀 뒤쪽에 틀린 처방(`enable`)이 나간다.
        placement: p.placement,
      };
      // 같은 플러그인이 **여러 자리에 깔려 있을 수 있다**(user 한 벌 + 남의 프로젝트 한 벌).
      // 그냥 덮어쓰면 CLI 가 준 순서에 따라 멀쩡한 것이 남의 자리 것에 밀려 사라진다 —
      // 이 세션에 실제로 오는 쪽을 남긴다.
      const prev = byName.get(p.name);
      if (!prev || skillStatusRank(cand) > skillStatusRank(prev)) byName.set(p.name, cand);
    }
    for (const m of inv.market) {
      if (byName.has(m.name)) continue;
      byName.set(m.name, { id: m.id, installed: false, enabled: false });
    }
    return byName;
  }

  /**
   * GET /api/available-skills — 프로젝트 + 설치 플러그인 스킬 목록.
   * §5.5 #17-2/#17-4 — `?agent=<id>`(권위) 또는 `?project=<name>` 이면 그 프로젝트의 `.claude/skills/` + `.claude/commands/` 를 프로젝트 스킬로, 미지정이면 전 프로젝트 병합.
   * plugin 스킬은 `~/.claude/plugins` 전역이라 project 와 무관하다.
   */
  mountSkillSharingRoutes(app, {
    service: new SkillSharingService(),
    rootForAgent: (agentId) => graphManager.getProjectPathForAgent(agentId),
    configForAgent: (agentId) => graphManager.getAgentConfig(agentId),
    changed: () => codexInventoryService.invalidate(),
  });

  app.get('/api/available-skills', async (req, res) => {
    try {
      const skills: SkillInfo[] = [];
      const seen = new Set<string>();

      // 1) 프로젝트 스킬 — 스캔할 경로: agent(권위) → project(표시명/path 해소) → 미지정 시 전 프로젝트.
      //    표시명은 활성 프로젝트 오염·이름 충돌·미해소로 어긋날 수 있어, agentId 가 있으면 그 에이전트의 소속 인스턴스에서 path 를 직접 얻는다.
      const agentParam = typeof req.query.agent === 'string' ? req.query.agent : '';
      const projectParam = typeof req.query.project === 'string' ? req.query.project : '';
      const scoped = agentParam || projectParam;
      let scopedPath: string | null = null;
      if (agentParam) scopedPath = graphManager.getProjectPathForAgent(agentParam);
      if (!scopedPath && projectParam) {
        scopedPath = graphManager.resolveProjectRef(projectParam)?.path ?? null;
      }
      const projectDirs: string[] = scoped
        ? (scopedPath ? [scopedPath] : []) // 지정했으나 미해소 → 빈 목록(전역 병합으로 새지 않게)
        : Object.values(graphManager.getSnapshot().projects).map((info) => info.path);
      for (const projectPath of projectDirs) {
        // skill 폴더(.claude/skills) 를 먼저 — 같은 이름이면 skill 이 command 를 이긴다(Claude Code 규칙).
        const projectSkillsDir = path.join(projectPath, '.claude', 'skills');
        for (const s of scanSkillsDir(projectSkillsDir, 'project')) {
          if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
        }
        // 슬래시 커맨드(.claude/commands) — Claude Code 가 프로젝트 스킬처럼 노출하는 곳. (P_MPS_DEV 의 26개 등)
        const projectCommandsDir = path.join(projectPath, '.claude', 'commands');
        for (const s of scanCommandsDir(projectCommandsDir, 'project')) {
          if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
        }
      }
      const projectSkillCount = skills.length;

      // 1.5) 글로벌(개인) 스킬 — 홈 `~/.claude/skills/` + `~/.claude/commands/`. 모든 프로젝트 공통.
      //   §5.5 #17-5 — claude CLI 가 헤드리스/인터랙티브 양쪽에서 읽는 개인 스킬 경로. 프로젝트가
      //   같은 이름을 먼저 차지하면 그게 이긴다(Claude Code: project > personal). seen 공유로 보장.
      const homeClaudeDir = path.join(os.homedir(), '.claude');
      for (const s of scanSkillsDir(path.join(homeClaudeDir, 'skills'), 'global')) {
        if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
      }
      for (const s of scanCommandsDir(path.join(homeClaudeDir, 'commands'), 'global')) {
        if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
      }
      logger.info(`[skills] agent="${agentParam}" project="${projectParam}" → path=${scopedPath ?? 'null'} dirs=${projectDirs.length} projectSkills=${projectSkillCount} globalSkills=${skills.length - projectSkillCount}`);

      // 2) 설치된 플러그인 스킬: `~/.claude/plugins/marketplaces/` 아래 각 마켓.
      // 카탈로그는 이 폴더에서 읽는다(스킬 본문이 있는 유일한 자리, 파일 읽기라 싸다). 항목마다 #17-33 ⑦ 판정(`pluginSkillStatus`)으로 깔렸는지·켜졌는지를 싣는다 — 없으면 안 깔린 스킬의 `/이름` 이 CLI 에서 평문으로 흘러간다.
      const pluginsBase = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
      const pluginStatus = await pluginSkillStatus(scopedPath);
      /** 카탈로그 한 줄에 이 세션에서의 상태를 새긴다. CLI 에 못 물었으면 아무 표식도 안 단다. */
      const markPluginSkill = (s: SkillInfo, pluginName: string): SkillInfo => {
        if (!pluginStatus) return s;
        const st = pluginStatus.get(pluginName);
        // 마켓에도 설치본에도 없는 폴더(사용자가 손으로 넣은 것 등)는 판정 대상이 아니다.
        if (!st) return s;
        return {
          ...s,
          pluginId: st.id,
          installed: st.installed,
          enabled: st.enabled,
          ...(st.placement ? { placement: st.placement } : {}),
        };
      };
      try {
        if (fs.existsSync(pluginsBase)) {
          // 마켓플레이스 → 플러그인 → skills/ 탐색
          for (const marketplace of fs.readdirSync(pluginsBase, { withFileTypes: true })) {
            if (!marketplace.isDirectory()) continue;
            const mpDir = path.join(pluginsBase, marketplace.name);
            // 최상위 skills/ 폴더 (가장 대표적)
            const topSkills = path.join(mpDir, 'skills');
            const pluginLabel = marketplace.name.replace(/-marketplace$/, '');
            for (const s of scanSkillsDir(topSkills, 'plugin', pluginLabel)) {
              if (!seen.has(s.name)) { seen.add(s.name); skills.push(markPluginSkill(s, pluginLabel)); }
            }
            // plugins/ 하위 (claude-plugins-official 등)
            const pluginsSubDir = path.join(mpDir, 'plugins');
            try {
              if (fs.existsSync(pluginsSubDir)) {
                for (const plugin of fs.readdirSync(pluginsSubDir, { withFileTypes: true })) {
                  if (!plugin.isDirectory()) continue;
                  const pSkills = path.join(pluginsSubDir, plugin.name, 'skills');
                  for (const s of scanSkillsDir(pSkills, 'plugin', plugin.name)) {
                    if (!seen.has(s.name)) { seen.add(s.name); skills.push(markPluginSkill(s, plugin.name)); }
                  }
                }
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }

      /*
       * §5.5 #17-2 (보강) — 이 프로젝트에서 슬래시가 꺼져 있는가.
       * 꺼져 있으면 스폰마다 `--disable-slash-commands` 가 붙어 `skills`·`builtins` 가 전부 거절된다(내장 명령도 — 실측 2.1.263).
       * 판정은 주입원 표를 그리는 그 함수 그대로다(두 벌이면 화면과 실제가 갈린다). 목록은 거르지 않고 안 된다는 사실만 더한다.
       */
      const slashProjectKey = agentParam
        ? graphManager.getAgentProjectName(agentParam)
        : (projectParam || null);
      const slashCommandsEnabled = isContextSourceOn(
        graphManager.getContextOverrides(),
        { projectKey: slashProjectKey, agentId: agentParam || null, subAgentId: null },
        CONTEXT_SOURCE_IDS.slashCommands,
        true,
      );

      // §5.5 #17-2 — CLI 내장 슬래시 명령은 별도 배열로. skills 에 섞지 않아 Skills 사이드바(#17-4)는 그대로, `/` 자동완성 드롭다운에만 함께 보인다.
      res.json({
        ok: true,
        skills,
        builtins: BUILTIN_SLASH_COMMANDS,
        order: appStateGetSkillOrder(),
        favorites: appStateGetSkillFavorites(),
        slashCommandsEnabled,
      });
    } catch (err) {
      logger.error('GET /api/available-skills failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.5 #17-4 — 등록된 프로젝트들의 .claude/skills/ 에서 frontmatter name 이 일치하는 스킬 폴더 절대경로 탐색. */
  function findProjectSkillDir(skillName: string): string | null {
    for (const info of Object.values(graphManager.getSnapshot().projects)) {
      const skillsDir = path.join(info.path, '.claude', 'skills');
      try {
        if (!fs.existsSync(skillsDir)) continue;
        for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const dir = path.join(skillsDir, entry.name);
          const parsed = parseSkillMd(path.join(dir, 'SKILL.md'));
          if (parsed && parsed.name === skillName) return dir;
        }
      } catch { /* next project */ }
    }
    return null;
  }

  /** DELETE /api/skill — 프로젝트 스킬을 디스크에서 제거 (source==='project' 만).
   *  frontmatter name 으로 폴더를 찾아 해당 스킬 디렉토리 전체를 삭제하고 고정 순서에서도 제거. */
  app.delete('/api/skill', (req, res) => {
    try {
      const { name, source } = req.body as { name?: string; source?: string };
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name required' });
        return;
      }
      if (source !== 'project') {
        // 플러그인 스킬은 전역 설치본이라 디스크 삭제 대상에서 제외 (프로젝트 스킬만 제거).
        res.status(400).json({ error: 'only project skills can be deleted' });
        return;
      }
      const dir = findProjectSkillDir(name.trim());
      if (!dir) {
        res.status(404).json({ error: 'skill not found' });
        return;
      }
      fs.rmSync(dir, { recursive: true, force: true });
      appStateRemoveSkillFromOrder(name.trim());
      logger.info(`Skill deleted from disk: ${dir} ("${name.trim()}")`);
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /api/skill failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // §5.5 #17-4 — 스킬을 다른 프로젝트로 복사.
  // 목록을 만든 스캐너(scanSkillsDir / scanCommandsDir)와 같은 규칙으로 원본을 되찾는다 — 화면의 항목은 전부 복사할 수 있어야 한다.
  // 단위: 스킬은 폴더 통째(보조 파일·하위 폴더 포함), 슬래시 커맨드는 `.md` 파일 1개.

  /** 대상 목록에서 "전역(모든 프로젝트)" 을 가리키는 예약 ref — 클라와 공유하는 약속 값. */
  const SKILL_COPY_GLOBAL_TARGET = 'global';

  /** 복사 원본. `rel` 은 `.claude`(플러그인은 그 플러그인 폴더) 기준 상대 위치 — 대상에도 같은 자리에 놓는다. */
  interface SkillAsset {
    kind: 'skill-dir' | 'command-file';
    src: string;
    rel: string;
  }

  /** 대상 하나의 복사 결과. `same` = 원본과 같은 자리라 건드리지 않음, `exists` = 승인 없이는 덮지 않음. */
  interface SkillCopyResult {
    target: string;
    status: 'copied' | 'overwritten' | 'exists' | 'same' | 'error';
    error?: string;
  }

  /** `<root>/skills/<폴더>/SKILL.md` frontmatter name 일치 → 폴더. 없으면 `<root>/commands/<a>/<b>.md`. */
  function findSkillAssetIn(root: string, name: string): SkillAsset | null {
    try {
      const skillsDir = path.join(root, 'skills');
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(skillsDir, entry.name);
        const parsed = parseSkillMd(path.join(dir, 'SKILL.md'));
        if (parsed && parsed.name === name) {
          return { kind: 'skill-dir', src: dir, rel: path.join('skills', entry.name) };
        }
      }
    } catch { /* skills 폴더 없음 */ }
    // 커맨드 이름의 `:` 는 하위 폴더 구분(scanCommandsDir 규약의 역). 경로 탈출 토큰은 거부.
    const segs = name.split(':');
    const safe = segs.every((seg) => seg.length > 0 && seg !== '.' && seg !== '..' && !seg.includes('/') && !seg.includes('\\'));
    if (safe) {
      const rel = `${path.join('commands', ...segs)}.md`;
      const file = path.join(root, rel);
      try {
        if (fs.statSync(file).isFile()) return { kind: 'command-file', src: file, rel };
      } catch { /* 그 이름의 커맨드 없음 */ }
    }
    return null;
  }

  /** 플러그인 원본 — 마켓플레이스·플러그인 폴더가 `.claude` 와 같은 `skills/` 구조를 쓴다. */
  function findPluginSkillAsset(name: string): SkillAsset | null {
    const base = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
    const roots: string[] = [];
    try {
      for (const marketplace of fs.readdirSync(base, { withFileTypes: true })) {
        if (!marketplace.isDirectory()) continue;
        const mpDir = path.join(base, marketplace.name);
        roots.push(mpDir);
        try {
          for (const plugin of fs.readdirSync(path.join(mpDir, 'plugins'), { withFileTypes: true })) {
            if (plugin.isDirectory()) roots.push(path.join(mpDir, 'plugins', plugin.name));
          }
        } catch { /* plugins 하위 없음 */ }
      }
    } catch { /* 설치된 마켓플레이스 없음 */ }
    for (const root of roots) {
      const found = findSkillAssetIn(root, name);
      if (found) return found;
    }
    return null;
  }

  /** 출처별 원본 해소. project 는 fromPath(에이전트 권위) 우선, 미지정이면 등록된 전 프로젝트 탐색. */
  function resolveSkillAsset(name: string, source: SkillInfo['source'], fromPath: string | null): SkillAsset | null {
    if (source === 'plugin') return findPluginSkillAsset(name);
    if (source === 'global') return findSkillAssetIn(path.join(os.homedir(), '.claude'), name);
    const roots = fromPath
      ? [fromPath]
      : Object.values(graphManager.getSnapshot().projects).map((info) => info.path);
    for (const root of roots) {
      const found = findSkillAssetIn(path.join(root, '.claude'), name);
      if (found) return found;
    }
    return null;
  }

  /** 대상 ref → 놓을 `.claude` 폴더. `'global'` 은 홈, 그 외는 프로젝트 path 해소(표시명·path 둘 다 허용). */
  function resolveSkillTargetDir(target: string): string | null {
    if (target === SKILL_COPY_GLOBAL_TARGET) return path.join(os.homedir(), '.claude');
    const projectPath = graphManager.resolveProjectRef(target)?.path;
    return projectPath ? path.join(projectPath, '.claude') : null;
  }

  /** 원본과 대상이 같은 자리인가 (Windows 는 대소문자 무시). */
  function isSameSkillPath(a: string, b: string): boolean {
    // 대소문자를 실제로 무시하는 FS(win32/darwin)에서만 접는다 — mac 도 기본 APFS 는 무시한다.
    return samePath(path.resolve(a), path.resolve(b));
  }

  /**
   * POST /api/skill/copy — 스킬(폴더) 또는 슬래시 커맨드(.md)를 다른 프로젝트·전역으로 복사.
   * 이미 있는 대상은 `exists` 로 되돌려 **덮어쓰지 않는다** — 클라가 [덮어쓰기] 승인 후 `overwrite:true` 로 재전송.
   */
  app.post('/api/skill/copy', (req, res) => {
    try {
      const { name, source, agentId, fromProject, targets, overwrite } = req.body as {
        name?: unknown;
        source?: unknown;
        agentId?: unknown;
        fromProject?: unknown;
        targets?: unknown;
        overwrite?: unknown;
      };
      const skillName = typeof name === 'string' ? name.trim() : '';
      if (!skillName) {
        res.status(400).json({ error: 'name required' });
        return;
      }
      if (source !== 'project' && source !== 'global' && source !== 'plugin') {
        res.status(400).json({ error: 'source must be project|global|plugin' });
        return;
      }
      if (!Array.isArray(targets) || targets.length === 0 || targets.some((x) => typeof x !== 'string' || !x)) {
        res.status(400).json({ error: 'targets must be non-empty string[]' });
        return;
      }

      // 원본 프로젝트: agentId 가 권위(클라 표시명에 의존 ❌ — available-skills 조회와 같은 규약).
      let fromPath: string | null = null;
      if (typeof agentId === 'string' && agentId) fromPath = graphManager.getProjectPathForAgent(agentId);
      if (!fromPath && typeof fromProject === 'string' && fromProject) {
        fromPath = graphManager.resolveProjectRef(fromProject)?.path ?? null;
      }
      const asset = resolveSkillAsset(skillName, source, fromPath);
      if (!asset) {
        res.status(404).json({ error: 'skill not found' });
        return;
      }

      const results: SkillCopyResult[] = (targets as string[]).map((target) => {
        const claudeDir = resolveSkillTargetDir(target);
        if (!claudeDir) return { target, status: 'error', error: 'unknown target' };
        const dest = path.join(claudeDir, asset.rel);
        if (isSameSkillPath(dest, asset.src)) return { target, status: 'same' };
        const exists = fs.existsSync(dest);
        if (exists && overwrite !== true) return { target, status: 'exists' };
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          if (exists) fs.rmSync(dest, { recursive: true, force: true });
          if (asset.kind === 'skill-dir') fs.cpSync(asset.src, dest, { recursive: true });
          else fs.copyFileSync(asset.src, dest);
          return { target, status: exists ? 'overwritten' : 'copied' };
        } catch (err) {
          return { target, status: 'error', error: err instanceof Error ? err.message : String(err) };
        }
      });

      const written = results.filter((r) => r.status === 'copied' || r.status === 'overwritten').length;
      logger.info(`[skills] copy "${skillName}" (${source}/${asset.kind}) → ${written}/${results.length} targets`);
      res.json({ ok: true, results });
    } catch (err) {
      logger.error('POST /api/skill/copy failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /api/skill-order — SkillsView 고정 순서 저장 (type 별 전체 가시 순서 치환). */
  app.put('/api/skill-order', (req, res) => {
    try {
      const { type, order } = req.body as { type?: string; order?: unknown };
      if (type !== 'project' && type !== 'global' && type !== 'plugin') {
        res.status(400).json({ error: 'type must be project|global|plugin' });
        return;
      }
      if (!Array.isArray(order) || order.some((x) => typeof x !== 'string')) {
        res.status(400).json({ error: 'order must be string[]' });
        return;
      }
      appStateSetSkillOrder(type, order as string[]);
      res.json({ ok: true, order: appStateGetSkillOrder() });
    } catch (err) {
      logger.error('PUT /api/skill-order failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.5 #17-4 — PUT /api/skill-favorites — SkillsView 즐겨찾기 목록 전체 치환(별 누른 순서대로). */
  app.put('/api/skill-favorites', (req, res) => {
    try {
      const { favorites } = req.body as { favorites?: unknown };
      if (!Array.isArray(favorites) || favorites.some((x) => typeof x !== 'string')) {
        res.status(400).json({ error: 'favorites must be string[]' });
        return;
      }
      appStateSetSkillFavorites(favorites as string[]);
      res.json({ ok: true, favorites: appStateGetSkillFavorites() });
    } catch (err) {
      logger.error('PUT /api/skill-favorites failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/agent-config/:agentId — 에이전트 설정 조회 */
  app.get('/api/agent-config/:agentId', (req, res) => {
    try {
      const config = graphManager.getAgentConfig(req.params.agentId);
      res.json({ ok: true, config: config ?? null });
    } catch (err) {
      logger.error('GET /api/agent-config failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /api/agent-config/:agentId — 에이전트 설정 저장 */
  app.put('/api/agent-config/:agentId', (req, res) => {
    try {
      const { agentId } = req.params;
      const body = req.body as Partial<AgentConfig>;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'config body required' });
        return;
      }
      // §4 (설정 3층) — 빠진 칸의 기준선은 상수가 아니라 그 에이전트의 지금 값(없으면 설정 창 기본값)이다.
      //   상수(`'sonnet'`·`'default'`·`[]`)로 메우면 일부만 보내는 경로(루프백 빌더)가 저장할 때 모델이 조용히 강등되고 도구가 빈다.
      const base = graphManager.getAgentConfig(agentId) ?? resolveAgentDefaults(userDefaultsService.get());
      // Bash 를 자동으로 넣지 않는다 — 도구 구성은 사용자 몫. Bash 를 빼면 dispatch curl 경로가 동작하지 않을 수 있다.
      const tools = Array.isArray(body.tools) ? body.tools.filter((t): t is string => typeof t === 'string') : [...base.tools];
      // §5.3 #28 (K) — 이전 config(rules diff + customMode 전이 감지용).
      const prev = graphManager.getAgentConfig(agentId);
      const prevRules = typeof prev?.rules === 'string' ? prev.rules : '';
      const prevHistory: RulesHistoryEntry[] = Array.isArray(prev?.rulesHistory) ? [...prev.rulesHistory] : [];
      const prevCustomMode = prev?.customMode;
      const incomingCustomMode =
        body.customMode === 'conti' || body.customMode === 'review' || body.customMode === 'debug'
          ? body.customMode
          : undefined;
      const userRules = typeof body.rules === 'string' ? body.rules : '';

      // §5.3 #28 (K) — 콘티모드 전이 자동 룰.
      // (i) → 'conti' 진입: rules 를 CONTI_AGENT_RULES 로 덮어쓴다.
      // (ii) 'conti' → 그 외: rules 를 비운다(자동 복원 ❌, 사용자가 히스토리에서 직접).
      // (iii) 그 외: 입력 그대로.
      let nextRules = userRules;
      let autoLabel: 'auto:conti-on' | 'auto:conti-off' | null = null;
      if (incomingCustomMode === 'conti' && prevCustomMode !== 'conti') {
        nextRules = CONTI_AGENT_RULES;
        autoLabel = 'auto:conti-on';
      } else if (prevCustomMode === 'conti' && incomingCustomMode !== 'conti') {
        nextRules = '';
        autoLabel = 'auto:conti-off';
      }

      // §5.3 #28 (K) — rules 가 실제로 바뀌었고 prev 가 비어있지 않을 때만 history push(빈→빈·동일 본문은 노이즈). 라벨: 자동 전이면 auto:*, 아니면 manual.
      const nextHistory: RulesHistoryEntry[] = [...prevHistory];
      if (prevRules !== nextRules && prevRules !== '') {
        nextHistory.push({
          ts: Date.now(),
          rules: prevRules,
          label: autoLabel ?? 'manual',
        });
        // FIFO drop
        while (nextHistory.length > RULES_HISTORY_MAX) nextHistory.shift();
      }

      /*
       * §5.3 #12-1 — 권한 축은 사용자만 올린다.
       * 이 창구는 §3.7 빌더 경로라 loopback 토큰만 있으면 닿는데, 그 토큰은 우리가 스폰한 에이전트의 env·프롬프트에 실려 나간다 — 토큰 보유가 사용자 의사가 아니다.
       * 표식은 desktop main 리스너가 재디스패치 직전에 덮어써 심는다(클라가 보낸 같은 이름의 헤더는 믿지 않는다). 판정은 shared 순수 함수 한 곳.
       */
      const fromLoopback = req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE;
      const guarded = applyIngressPermissionGuard(
        {
          permissionMode: typeof body.permissionMode === 'string' ? body.permissionMode : base.permissionMode,
          tools,
          disallowedTools: Array.isArray(body.disallowedTools)
            ? body.disallowedTools.filter((t): t is string => typeof t === 'string')
            : undefined,
          // §5.3 #12-1-A — 도구별 확인 목록. `disallowedTools` 와 같은 규약(창은 항상 전량을 보낸다).
          askTools: Array.isArray(body.askTools)
            ? body.askTools.filter((t): t is string => typeof t === 'string')
            : undefined,
        },
        prev
          ? {
              permissionMode: prev.permissionMode,
              tools: [...prev.tools],
              disallowedTools: prev.disallowedTools,
              askTools: prev.askTools,
            }
          : undefined,
        fromLoopback,
      );
      // 막은 것은 조용히 넘기지 않는다 — 아무 기록이 없으면 "왜 안 먹었나"를 되짚을 수 없다.
      if (guarded.frozen.length > 0) {
        logger.warn(
          `agent-config(${agentId}): loopback ingress tried to change ${guarded.frozen.join(', ')} — kept previous values (§5.3 #12-1)`,
        );
      }
      if (guarded.downgraded) {
        logger.warn(
          `agent-config(${agentId}): loopback ingress asked for bypassPermissions — stored acceptEdits instead (§5.3 #12-1)`,
        );
      }

      const config: AgentConfig = {
        model: typeof body.model === 'string' ? body.model : base.model,
        tools: guarded.tools,
        permissionMode: guarded.permissionMode,
        skills: Array.isArray(body.skills) ? body.skills.filter((s): s is string => typeof s === 'string') : [...base.skills],
        color: typeof body.color === 'string' ? body.color : undefined,
        maxTurns: typeof body.maxTurns === 'number' ? body.maxTurns : undefined,
        isolation: typeof body.isolation === 'string' ? body.isolation : undefined,
        effort: typeof body.effort === 'string' ? body.effort : undefined,
        disallowedTools: guarded.disallowedTools,
        /*
         * §5.3 #12-1-A — 도구별 확인 목록. **여기 없으면 저장할 때마다 사라진다.**
         * 이 핸들러는 `AgentConfig` 한 벌을 새로 짓고 `setAgentConfig` 는 병합 없이 통째로 갈아치운다 — 빠지면 매 저장마다 비워져 `shouldAskForTool` 이 늘 false 다. `PUT → GET` 왕복 회귀가 지킨다.
         */
        askTools: guarded.askTools,
        memory: normalizeAgentMemoryScope(body.memory),
        // §5.3 — 서브에이전트 중첩 깊이. 범위를 벗어난 값은 저장하지 않는다(CLI 기본 3층 유지).
        subagentDepth: normalizeSubagentDepth(body.subagentDepth),
        // §4 (설정 3층) — 빈 규칙을 `undefined` 로 접으면 **위층이 깔아 둔 규칙을 이 버블에서
        //   지울 수 없다**(저장분에 키가 없으면 읽는 순간 위층이 도로 얹힌다). 빈 문자열은
        //   기본값과 대조돼 필요할 때만 남는다.
        rules: nextRules,
        rulesHistory: nextHistory.length > 0 ? nextHistory : undefined,
        // §5.3 #12-1 — 권한 축은 permissionMode 하나다.
        // §5.3 #12-1 — 60초 무응답 fallback 정책. 미설정(undefined)은 allow.
        permissionTimeoutPolicy: body.permissionTimeoutPolicy === 'deny' ? 'deny'
          : body.permissionTimeoutPolicy === 'allow' ? 'allow' : undefined,
        // §5.3 #28 — Custom Mode (conti/review/debug). 그 외는 undefined.
        customMode: incomingCustomMode,
        // §4 — 1M 컨텍스트 토글, 기본 1M. '200k' = 명시적 opt-out · '1m' = 명시적 opt-in(undefined 와 같은 동작) · 그 외 = undefined(기본 1M).
        contextWindow: body.contextWindow === '200k' ? '200k' : body.contextWindow === '1m' ? '1m' : undefined,
        // §4 — 프리셋 트레이스 메타. 값 검증은 클라 몫(자유 문자열).
        presetId: typeof body.presetId === 'string' && body.presetId.trim() ? body.presetId.trim() : undefined,
        /*
         * §4 — 모델 풀ID 핀. **여기 없으면 저장할 때마다 사라진다**(`askTools` 와 같은 이유 — 다음 저장 한 번에 alias 로 되돌아간다).
         * `''` 는 alias=latest 라 빈 문자열을 그대로 받아야 위층의 핀을 이 버블에서 풀 수 있다.
         */
        modelVersion: typeof body.modelVersion === 'string' ? body.modelVersion.trim() : undefined,
        // §4 — executionMode 는 에이전트 정체성(CMD vs 헤드리스)이라 AgentConfigPopup 이 보내지 않는다.
        //   PUT 이 config 를 새로 지으므로 body 에 명시값이 없으면 이전 값을 유지한다 — 안 하면 설정 저장 때 CMD→커스텀으로 되돌아간다.
        executionMode:
          body.executionMode === 'interactive-terminal' || body.executionMode === 'headless'
            ? body.executionMode
            : prev?.executionMode,
        // §5.19 (B) — provider(All Model 의 정체)는 executionMode 와 같은 규약이다: **body 에 없으면
        //   이전 값을 유지**한다. 이 축을 모르는 창(에이전트 설정 팝업)이 저장하는 순간 provider 가
        //   지워지면 All Model 버블이 조용히 클로드 버블로 되돌아간다. 모델을 새로 매는 것도 이 통로다.
        provider: fromLoopback ? prev?.provider : prepareLocalModelSelection(prev?.provider, normalizeAgentProvider(body.provider) ?? prev?.provider),
        // §4 (CMD 터미널 업그레이드 ⑧) — CMD 버블이 띄울 CLI. `executionMode`·`provider` 와 **같은
        //   규약**이다: body 에 유효값이 오면 그걸, 없으면 이전 값을 유지한다. 이 축을 모르는 창이
        //   저장하는 순간 고른 CLI 가 조용히 claude 로 되돌아가는 것을 막는다.
        cliKind: CMD_CLI_KINDS.some((k) => k.value === body.cliKind) ? (body.cliKind as CmdCliKind) : prev?.cliKind,
        // §4 — API 비용 상한(달러). 0 = 무제한 — 위층이 건 상한을 이 버블에서 푸는 표기라 그대로 받는다(음수만 버린다).
        maxBudgetUsd: typeof body.maxBudgetUsd === 'number' && body.maxBudgetUsd >= 0 ? body.maxBudgetUsd : undefined,
        // §5.5 #17-20 ⑥ — MCP 디버그 도구 선택. 알 수 없는 id 는 걸러 스폰 인자 조립(`prepareMcpConfig`)이 옛 설정에 흔들리지 않게 한다.
        //   `executionMode` 와 같은 이유로 body 에 없으면 이전 값을 유지한다 — 이 필드를 모르는 창이 저장해도 켜 둔 도구가 꺼지지 않게.
        mcpServers: Array.isArray(body.mcpServers)
          ? body.mcpServers.filter((id): id is string => typeof id === 'string' && !!findMcpPreset(id))
          : prev?.mcpServers,
        /*
         * §4 (설정 3층) — 설치된 CLI 가 받는 옵션들. 검증은 여기서 좁게, 인자 조립은 `buildConfigArgs` 한 곳.
         * ⚠ "안 보냈다"와 "비워서 보냈다"를 가른다 — 빈 값을 `undefined` 로 접으면 `sparsifyAgentConfig` 의 위층 대조에 오르지 못해, 읽는 순간 위층이 도로 얹힌다("껐는데 프로젝트 설정을 따라간다").
         * 키가 있으면 그 값을(빈 값 포함) 그대로, 없을 때만 undefined — 일부만 보내는 경로(루프백 빌더)는 위층을 따른다.
         */
        fallbackModel: typeof body.fallbackModel === 'string' ? body.fallbackModel.trim() : undefined,
        //   `''` 는 목록의 첫 값 = "미설정(위층을 따름)" 이라 유효값이다. 알 수 없는 값만 버린다.
        autoCompact: typeof body.autoCompact === 'string' && AVAILABLE_AUTOCOMPACT_VALUES.includes(body.autoCompact.trim())
          ? body.autoCompact.trim() : undefined,
        // §4 (CLI 사양 추종) — 턴 경계 압축은 스위치가 아니라 `autoCompact` 값에서 파생된다(합쳐진 축).
        //   여기 남은 것은 **에이전트가 스스로 부르는** 직교 축 하나뿐이다.
        agentCanCompact: typeof body.agentCanCompact === 'boolean' ? body.agentCanCompact : undefined,
        excludeDynamicSystemPromptSections: typeof body.excludeDynamicSystemPromptSections === 'boolean' ? body.excludeDynamicSystemPromptSections : undefined,
        settingSources: Array.isArray(body.settingSources)
          ? body.settingSources.filter((s): s is string => typeof s === 'string' && AVAILABLE_SETTING_SOURCES.includes(s))
          : undefined,
        safeMode: typeof body.safeMode === 'boolean' ? body.safeMode : undefined,
        // §4 (Fast 모드) — settings 키로만 켜지는 축(플래그 아님). 모델 지원 여부는 저장이 아니라
        //   스폰부(`wantsFastMode`)가 판정한다 — 사용자가 모델을 Opus 로 되돌리면 값이 그대로 살아난다.
        fastMode: typeof body.fastMode === 'boolean' ? body.fastMode : undefined,
        // §4 (Thinking on/off) — 사고도 settings 키로만 꺼지는 축이며 **기본이 켬**이다. 위층이
        //   꺼 둔 것을 이 버블에서 켜려면 명시 `true` 가 저장돼야 하므로 둘 다 받는다.
        thinking: typeof body.thinking === 'boolean' ? body.thinking : undefined,
        // §4 (스트림 3종) — ①은 기본 켬, ②③은 기본 끔. 방향은 달라도 규약은 하나다.
        forwardSubagentText: typeof body.forwardSubagentText === 'boolean' ? body.forwardSubagentText : undefined,
        replayUserMessages: typeof body.replayUserMessages === 'boolean' ? body.replayUserMessages : undefined,
        promptSuggestions: typeof body.promptSuggestions === 'boolean' ? body.promptSuggestions : undefined,
        /*
         * §4 (CLI 사양 추종) — 훅 생명주기를 스트림에 끼운다(`--include-hook-events`).
         * **여기 없으면 저장할 때마다 사라진다** — `subAgentManager` 가 읽어 플래그를 붙이는 축이다.
         */
        includeHookEvents: typeof body.includeHookEvents === 'boolean' ? body.includeHookEvents : undefined,
        // §4 (CLI 사양 추종) — Bash 타임아웃(ms). 0/범위 밖은 미설정이고, 그 0 이 위층의
        //   타임아웃을 이 버블에서 푸는 표기라 키가 오면 그대로 받는다.
        bashDefaultTimeoutMs: body.bashDefaultTimeoutMs === undefined ? undefined : (normalizeBashTimeoutMs(body.bashDefaultTimeoutMs) ?? 0),
        bashMaxTimeoutMs: body.bashMaxTimeoutMs === undefined ? undefined : (normalizeBashTimeoutMs(body.bashMaxTimeoutMs) ?? 0),
        /*
         * §5.3 #9-1 (J~M) — 이 에이전트만의 토큰 절약. 숫자 축은 0 이 "전역을 따른다"라 그대로 저장한다.
         * 범위 클램프는 `buildTokenSaverEnv` 가 env 를 만들 때 한 곳에서 건다 — 두 곳에 두면 한쪽만 고쳐져 어긋난다.
         */
        bashMaxOutputChars: typeof body.bashMaxOutputChars === 'number' ? Math.max(0, Math.floor(body.bashMaxOutputChars)) : undefined,
        mcpMaxOutputTokens: typeof body.mcpMaxOutputTokens === 'number' ? Math.max(0, Math.floor(body.mcpMaxOutputTokens)) : undefined,
        maxOutputTokens: typeof body.maxOutputTokens === 'number' ? Math.max(0, Math.floor(body.maxOutputTokens)) : undefined,
        maxThinkingTokens: typeof body.maxThinkingTokens === 'number' ? Math.max(0, Math.floor(body.maxThinkingTokens)) : undefined,
        autoCompactPct: typeof body.autoCompactPct === 'number' ? Math.max(0, Math.min(100, Math.floor(body.autoCompactPct))) : undefined,
        disableNonEssentialModelCalls: typeof body.disableNonEssentialModelCalls === 'boolean' ? body.disableNonEssentialModelCalls : undefined,
        betas: Array.isArray(body.betas)
          ? body.betas.filter((b): b is string => typeof b === 'string' && b.trim().length > 0).map((b) => b.trim())
          : undefined,
        /*
         * §4 (CLI 사양 추종) — 세션 한정 서브에이전트 정의(`--agents`)와 플러그인 폴더(`--plugin-dir`). 둘 다 여기 없으면 저장할 때마다 사라진다.
         * 필수 칸이 빈 정의는 서버에서도 접는다 — 반쯤 채운 채 나가면 CLI 가 인자 파싱에서 거부해 에이전트가 통째로 못 뜬다.
         */
        agentDefinitions: Array.isArray(body.agentDefinitions)
          ? (body.agentDefinitions as AgentDefinition[]).filter(
              (d) => !!d && typeof d.name === 'string' && d.name.trim() !== ''
                && typeof d.description === 'string' && d.description.trim() !== ''
                && typeof d.prompt === 'string' && d.prompt.trim() !== '',
            )
          : undefined,
        pluginDirs: Array.isArray(body.pluginDirs)
          ? normalizePluginDirs(body.pluginDirs.filter((d): d is string => typeof d === 'string'))
          : undefined,
      };
      // §5.3 #28 — Custom Mode 는 커스텀 에이전트(customCreated=true)에만 켤 수 있다. Hook 에이전트는 사용자가 만든 게 아니라 모드를 붙이지 않는다.
      if (config.customMode) {
        const snap = graphManager.getSnapshot();
        const agent = snap.agents.find((a) => a.id === agentId);
        if (!agent || !agent.customCreated) {
          res.status(400).json({ error: 'customMode is only allowed on custom-created agents' });
          return;
        }
      }
      graphManager.setAgentConfig(agentId, config);
      // §5.3 #28 — customMode='conti' 최초 활성화 때 빈 conti 1건 자동 생성(LLM 호출 ❌).
      if (config.customMode === 'conti') {
        const existing = graphManager.getContisByAgent(agentId);
        if (existing.length === 0) {
          const empty = createEmptyConti(agentId);
          graphManager.addConti(empty);
          broadcast({ type: 'conti_generated', timestamp: Date.now(), payload: { contiId: empty.id, agentId } });
        }
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, config: graphManager.getAgentConfig(agentId) });
    } catch (err) {
      logger.error('PUT /api/agent-config failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.3 #12-1 — POST /api/permission-check
   * PreToolUse 훅이 동기 호출. 그 세션/subagent 가 우리 관할 + ask 모드면 broker 에 큐잉하고 사용자의 답을 기다려 `{decision:'allow'|'deny'}` 반환. 그 외는 즉시 allow.
   */
  /**
   * §5.3 #12-1-B — 카드를 기다리는 요청 연결이 **답을 받기 전에** 닫히면 울리는 신호.
   * `req` 의 `close` 는 본문을 다 읽은 순간에도 오므로 `res` 의 `close` 에서 `writableEnded` 로 가른다.
   */
  function callerGoneSignal(res: express.Response): AbortSignal {
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    return controller.signal;
  }

  // Codex named-tool gate. Kept separate from sandbox/audit approval: allowing a
  // tool here never grants sandbox access or skips the other permission hooks.
  app.post('/api/codex-tool-check', async (req, res) => {
    try {
      const body = req.body ?? {};
      const agentId = typeof body.parentAgentId === 'string' ? body.parentAgentId : '';
      const node = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
      // §5.3 #10-4 — 지휘 턴이면 그 턴의 덮어쓴 설정(`codexTools.edit = 'deny'`)으로 판정한다.
      const config = agentConfigForTurn(agentId, body.subAgentId);
      if (!node?.customCreated || config?.provider?.kind !== 'codex-cli' || typeof body.toolName !== 'string') {
        res.json({ decision: 'deny', reason: 'not-managed' }); return;
      }
      const projectName = graphManager.getAgentProjectName(agentId) ?? '';
      const toolInput = body.toolInput && typeof body.toolInput === 'object' ? body.toolInput : {};
      const auditEntryId = graphManager.recordAuditCall({
        projectName, agentId, agentLabel: node.label ?? agentId,
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
        subAgentId: typeof body.subAgentId === 'string' ? body.subAgentId : undefined,
        toolName: body.toolName, toolInput,
        roots: graphManager.getAuditRoots(projectName, typeof body.cwd === 'string' ? body.cwd : null),
        awaitHookEvent: true,
      });
      const note = (decision: 'allow' | 'deny', source: AuditDecisionSource, reason: string) => {
        if (auditEntryId) graphManager.recordAuditDecision(projectName, auditEntryId, decision, source, reason);
      };
      const decision = decideCodexTool(config.provider.codexTools, body.toolName);
      if (decision !== 'ask') {
        if (decision === 'deny') note('deny', 'policy', 'tool-policy');
        res.json({ decision, reason: 'tool-policy' }); return;
      }
      if (config.permissionMode === 'dontAsk') {
        note('deny', 'policy', 'dont-ask');
        res.json({ decision: 'deny', reason: 'dont-ask' }); return;
      }
      // §5.3 #12-1-B — 이 호출을 묻는 칸이 곧 "항상"이 적히는 칸이다(`provider.codexTools[묶음]`).
      const toolGroup = codexToolGroup(body.toolName);
      const signal = callerGoneSignal(res);
      graphManager.setPermissionWaiting(agentId, true);
      broadcastSnapshot();
      try {
        const result = await permissionBroker.request({
          agentId, agentLabel: node.label ?? agentId, agentColor: config.color ?? BUBBLE_COLORS.agent,
          projectName, toolName: body.toolName,
          toolInput,
          subAgentId: typeof body.subAgentId === 'string' ? body.subAgentId : undefined,
          askedByTool: true,
          ...(toolGroup ? { alwaysAllow: 'codex-tools', alwaysReject: 'codex-tools', codexToolGroup: toolGroup } : {}),
          ...(auditEntryId ? { auditEntryId } : {}),
        }, config.permissionTimeoutPolicy === 'allow' ? 'allow' : 'deny', { signal });
        note(result.decision, permissionDecisionSource(result), result.reason ?? 'user');
        if (!res.writableEnded) res.json({ decision: result.decision, reason: result.reason ?? 'user' });
      } finally {
        graphManager.setPermissionWaiting(agentId, false);
        broadcastSnapshot();
      }
    } catch (error) {
      logger.error('POST /api/codex-tool-check failed', error);
      res.status(500).json({ decision: 'deny', reason: 'internal-error' });
    }
  });

  // §5.25 (H) — 코덱스 재시도·승인 요청이 앞 카드의 답을 잇는 짧은 기억(2분). 서버 수명 동안 한 벌.
  const codexApprovalMemory = new CodexApprovalMemory();
  app.post('/api/permission-check', async (req, res) => {
    try {
      interface Body {
        sessionId?: string;
        /** env VIBISUAL_SUBAGENT_ID */
        subAgentId?: string;
        /** env VIBISUAL_PARENT_AGENT_ID — 설정의 owner */
        parentAgentId?: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        cwd?: string;
        /** §5.25 (H) — `codex-edges.mjs permission` 이 보낸 요청이면 'codex'. 없으면 클로드 훅(handler.mjs). */
        engine?: string;
        /** §5.25 (H) — 코덱스 훅 이벤트(`PreToolUse` | `PermissionRequest`). */
        hookEvent?: string;
        /** §5.25 (H) — 코덱스 PreToolUse 의 `tool_use_id`. 원장 줄을 훅 추적 이벤트와 잇는다. */
        toolUseId?: string;
        /**
         * §5.3 #12-3 — 훅 페이로드의 `turn_id`. **코덱스 훅에만 있는 필드**라, 전역 코덱스 훅(§5.25 (I))이
         * `handler.mjs` 로 보낸 문의를 가른다 — 코덱스는 `ask` 를 지원하지 않아 거부로 답해야 한다.
         */
        turnId?: string;
        /**
         * §5.3 #12-4 — env `VIBISUAL_OWNER_AGENT_ID` · `VIBISUAL_OWNER_TERM_ID`. 우리 CMD 터미널에서 뜬 CLI 의
         * 훅만 터미널 id 를 갖는다 — 그 턴의 검증 범위로 판정하는 근거다.
         */
        ownerAgentId?: string;
        ownerTermId?: string;
      }
      const body = (req.body ?? {}) as Body;

      const toolName = typeof body.toolName === 'string' ? body.toolName : '';
      const toolInput = (body.toolInput ?? {}) as Record<string, unknown>;
      /*
       * §5.3 #12-3 — 이 호출이 닿는 자물쇠. 열려 있는 **모든** 프로젝트의 자물쇠를 본다(경로는 프로젝트를
       * 가리지 않는다). 아래 갈래 중 필요한 곳에서 한 번만 잰다.
       */
      let lockHitsMemo: PathLockHit[] | null = null;
      const lockHits = (): PathLockHit[] => {
        if (lockHitsMemo === null) {
          lockHitsMemo = findToolLockHitsOnHost(toolName, toolInput, body.cwd ?? null, graphManager.getAllPathLocks());
        }
        return lockHitsMemo;
      };
      // §5.25 (H) — 코덱스 권한 훅의 이벤트. 샌드박스 밖 실행을 묻는 `PermissionRequest` 에 "관할 밖이니
      //   통과"를 답하면 사람 없이 샌드박스가 풀린다 — 그 이벤트의 관할 밖 답은 거부다(문구는 훅이 고른다).
      const codexEvent: CodexPermissionHookEvent | null = body.engine !== 'codex' ? null
        : body.hookEvent === 'PreToolUse' || body.hookEvent === 'PermissionRequest' ? body.hookEvent : null;
      if (body.engine === 'codex' && !codexEvent) {
        res.status(400).json({ ok: false, decision: 'deny', reason: 'invalid-hook-event' });
        return;
      }
      const passUnmanaged = (reason: string): void => {
        if (codexEvent === 'PermissionRequest') {
          res.json({ ok: true, decision: 'deny', reason: 'not-managed' });
          return;
        }
        /*
         * §5.3 #12-4 (E) ④ — 우리 CMD 터미널의 AI 호출도 같은 검증 정책을 탄다. 훅이 터미널 id 를 실어 오면 그 턴(사람이 친 문장 → Stop)의 범위로 판정한다.
         * 터미널 id 가 없는 세션(사용자 에디터·터미널의 훅 세션)은 막지 않는다(§5.3 #12-1 절대 규칙).
         */
        const cmdSub = typeof body.ownerTermId === 'string' && body.ownerTermId
          ? subAgentManager.findSubByTermId(body.ownerTermId)
          : undefined;
        if (cmdSub && (!body.ownerAgentId || cmdSub.parentAgentId === body.ownerAgentId)
          && graphManager.getSnapshot().agents.some((a) => a.id === cmdSub.parentAgentId && a.customCreated)) {
          const verification = verificationGate.checkCmdCall(cmdSub.id, { toolName, toolInput, cwd: body.cwd ?? null });
          if (verification.verdict === 'deny') {
            res.json({ ok: true, decision: 'deny', reason: VERIFICATION_DENY_REASON, message: verification.message });
            return;
          }
        }
        /*
         * §5.3 #12-3 — 관할 밖 세션(사용자 에디터·터미널의 훅 세션, 우리 CMD 터미널)도 자물쇠는 지난다. 우리 팝업은 띄우지 않는다(#12-1 "훅 버블은 막지 않는다"의 예외는 자물쇠뿐).
         * 그 엔진 자신의 강제 허락 장치로 돌려준다: 클로드는 `ask`(CLI 승인 창 — bypass 에서도 뜬다), 코덱스는 `ask` 를 읽기만 하고 실행하므로 거부 + 사유.
         */
        const lockAnswer = unmanagedLockAnswer(lockHits(), { engine: body.engine, turnId: body.turnId });
        if (lockAnswer) {
          res.json(lockAnswer);
          return;
        }
        res.json({ ok: true, decision: 'allow', reason });
      };

      // 1) 관할 에이전트 resolve — parentAgentId 우선, 그 다음 sessionId 역방향.
      let agentId: string | null = body.parentAgentId ?? null;
      if (!agentId && typeof body.sessionId === 'string') {
        agentId = graphManager.findAgentIdBySession(body.sessionId);
      }
      if (!agentId) {
        // Vibisual 관할이 아님 — 즉시 통과
        passUnmanaged('not-managed');
        return;
      }

      // §5.3 #12-1 — 권한 승인 팝업은 커스텀 에이전트 전용. 훅으로 생긴 버블(사용자의 Claude Code 세션 시각화)은 view-only — 승인 모달을 띄우지 않는다(그 세션의 도구 호출을 막으면 안 된다).
      const agentNode = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
      if (!agentNode || !agentNode.customCreated) {
        passUnmanaged('view-only-agent');
        return;
      }

      // §5.3 #10-4 — 지휘 턴이면 그 턴의 덮어쓴 설정(도구·권한)으로 판정한다. 저장된 설정으로 재면
      //   지휘자의 curl 이 저장된 권한 모드의 승인 카드에 걸려 턴이 멈춘다.
      const config = agentConfigForTurn(agentId, body.subAgentId);
      if (!config) {
        // §5.3 #12-4 — 설정이 없어도 우리가 띄운 세션이다. 검증 판정만은 그대로 탄다(그 밖은 종전대로 통과).
        const verification = verificationGate.checkSubAgentCall(
          typeof body.subAgentId === 'string' && body.subAgentId ? body.subAgentId : undefined,
          { toolName, toolInput, cwd: body.cwd ?? null },
        );
        if (verification.verdict === 'deny') {
          res.json({ ok: true, decision: 'deny', reason: VERIFICATION_DENY_REASON, message: verification.message });
          return;
        }
        // 설정 없음 — 막을 근거 없음, 통과
        passUnmanaged('no-config');
        return;
      }

      /*
       * §5.25 (H) — 코덱스 버블의 권한 모드·감사 경계.
       * 주인은 앱이 턴마다 싣는 권한 훅(`codex-edges.mjs permission`)이다. 전역 코덱스 훅(§5.25 (I), `handler.mjs`)도 여기 오므로 그쪽은 비켜 선다 — 안 비키면 승인 카드가 두 장 뜬다(`codex-app-hook` 은 handler.mjs 가 개입하지 않는 통과 사유).
       * 판정은 `planCodexPermission` 한 곳. 모드는 코덱스 샌드박스·승인 정책이 집행하고, 카드는 샌드박스 밖을 물을 때(PermissionRequest)만 뜬다.
       * 감사 경계는 모드와 따로 실행 전(PreToolUse) 위험 호출을 붙잡는다. 카드·60초 정책·원장은 클로드 경로와 같다.
       */
      if (!codexEvent && config.provider?.kind === 'codex-cli') {
        res.json({ ok: true, decision: 'allow', reason: 'codex-app-hook' });
        return;
      }
      if (codexEvent) {
        const codexSessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        const codexSubAgentId = typeof body.subAgentId === 'string' && body.subAgentId ? body.subAgentId : undefined;
        /*
         * §5.25 (F) — 적용이 허락된 `apply_patch` 만 그 sub 의 장부에 적는다(거부된 패치는 남기지 않는다). 코덱스는 이 답을 받은 뒤 패치를 적용하므로 적기가 늘 `file_change` 완료보다 앞선다.
         * 패치 도구가 아니면 장부가 버린다.
         */
        const noteAllowedPatch = (): void => {
          if (codexEvent !== 'PreToolUse' || !codexSubAgentId) return;
          subAgentManager.noteCodexPatch(codexSubAgentId, {
            cwd: body.cwd ?? '',
            toolName,
            toolInput,
            ...(typeof body.toolUseId === 'string' && body.toolUseId ? { toolUseId: body.toolUseId } : {}),
          });
        };
        const codexProject = graphManager.getAgentProjectName(agentId) ?? '';
        const codexRoots = graphManager.getAuditRoots(codexProject, body.cwd ?? null);
        const codexRisk = classifyToolRiskOnHost(toolName, toolInput, codexRoots);
        const codexEscalate = codexRisk.length > 0
          && shouldEscalateRisk(graphManager.getAuditBoundary(codexProject), codexRisk);
        const approvalKey = codexApprovalKey(agentId, codexSessionId, toolName, toolInput);
        /*
         * §5.3 #12-4 (E) ② — 코덱스도 실행 전(PreToolUse)에 같은 검증 판정을 탄다. 모드와 무관하다 — 읽기 전용
         * 샌드박스도 테스트는 돈다. 묻지 않는다(승인 카드 ❌) — 범위 밖이면 거부하고 사유는 서버가 짓는다.
         */
        if (codexEvent === 'PreToolUse') {
          const verification = verificationGate.checkSubAgentCall(codexSubAgentId, { toolName, toolInput, cwd: body.cwd ?? null });
          if (verification.verdict === 'deny') {
            const deniedEntryId = graphManager.recordAuditCall({
              projectName: codexProject,
              sessionId: codexSessionId,
              agentId,
              ...(codexSubAgentId ? { subAgentId: codexSubAgentId } : {}),
              ...(agentNode.label ? { agentLabel: agentNode.label } : {}),
              ...(config.color ? { agentColor: config.color } : {}),
              toolName,
              toolInput,
              ...(typeof body.toolUseId === 'string' && body.toolUseId ? { toolUseId: body.toolUseId } : {}),
              roots: codexRoots,
            });
            if (deniedEntryId) graphManager.recordAuditDecision(codexProject, deniedEntryId, 'deny', 'policy', VERIFICATION_DENY_REASON);
            res.json({ ok: true, decision: 'deny', reason: VERIFICATION_DENY_REASON, message: verification.message });
            return;
          }
        }
        // §5.3 #12-3 — 실행 전(PreToolUse)에만 잰다. 승인 요청은 같은 호출의 뒷단이라 앞에서 이미 물었다.
        const codexLockHits = codexEvent === 'PreToolUse' ? lockHits() : [];
        const plan = planCodexPermission({
          event: codexEvent,
          permissionMode: config.permissionMode,
          escalate: codexEscalate,
          locked: codexLockHits.length > 0,
          consumeApproval: () => codexApprovalMemory.consume(approvalKey, codexEvent),
        });
        // 한 호출은 원장 한 줄 — 승인 요청(`tool_use_id` 없음)과 허용된 재시도는 앞 PreToolUse 가 적은 줄을 잇는다.
        const reusedEntry = codexEvent === 'PermissionRequest' || (plan.kind === 'allow' && plan.reason === 'approved')
          ? codexApprovalMemory.entryFor(approvalKey)
          : undefined;
        const codexEntryId = reusedEntry ?? graphManager.recordAuditCall({
          projectName: codexProject,
          sessionId: codexSessionId,
          agentId,
          ...(codexSubAgentId ? { subAgentId: codexSubAgentId } : {}),
          ...(agentNode.label ? { agentLabel: agentNode.label } : {}),
          ...(config.color ? { agentColor: config.color } : {}),
          toolName,
          toolInput,
          ...(typeof body.toolUseId === 'string' && body.toolUseId ? { toolUseId: body.toolUseId } : {}),
          roots: codexRoots,
        });
        if (codexEntryId && !reusedEntry) codexApprovalMemory.rememberEntry(approvalKey, codexEntryId);
        const noteCodexDecision = (decision: 'allow' | 'deny', source: AuditDecisionSource, reason?: string): void => {
          if (codexEntryId) graphManager.recordAuditDecision(codexProject, codexEntryId, decision, source, reason);
        };
        if (plan.kind === 'allow') {
          if ('policy' in plan && plan.policy) noteCodexDecision('allow', 'policy', plan.policy);
          noteAllowedPatch();
          res.json({ ok: true, decision: 'allow', reason: plan.reason });
          return;
        }
        if (plan.kind === 'deny') {
          noteCodexDecision('deny', 'policy', plan.reason);
          res.json({
            ok: true, decision: 'deny', reason: plan.reason, mode: config.permissionMode || 'default',
            // §5.3 #12-3 — 묻지 않는 모드의 자물쇠 거부는 문구를 서버가 짓는다(어느 경로가 잠겼는지 말해야 한다).
            ...(plan.reason === 'locked' ? { message: lockDenyReason(codexLockHits, 'dont-ask') } : {}),
          });
          return;
        }
        const codexSignal = callerGoneSignal(res);
        // §5.3 #12-3 — 자물쇠가 세운 카드: 무응답은 언제나 거부, "항상"은 잠금 풀기뿐이다.
        const codexLockCard = codexLockHits.length > 0;
        graphManager.setPermissionWaiting(agentId, true);
        if (codexEvent === 'PreToolUse' && codexEscalate && codexEntryId) graphManager.markAuditEscalated(codexProject, codexEntryId);
        broadcastSnapshot();
        let codexDecision;
        try {
          codexDecision = await permissionBroker.request({
            agentId,
            subAgentId: codexSubAgentId,
            agentLabel: agentNode.label ?? agentId,
            agentColor: config.color ?? BUBBLE_COLORS.agent,
            projectName: codexProject,
            toolName,
            toolInput,
            ...(codexRisk.length > 0 ? { risk: codexRisk } : {}),
            // PreToolUse 에서 경계가 붙잡은 호출이면 그렇다고 적는다. 승인 요청은 모드가 원래 묻는 자리다.
            ...(codexEvent === 'PreToolUse' && codexEscalate ? { escalated: true } : {}),
            ...(codexLockCard ? { lockHits: lockHitsForCard(codexLockHits), alwaysAllow: 'unlock' as const } : {}),
            ...(codexEntryId ? { auditEntryId: codexEntryId } : {}),
          }, codexLockCard || config.permissionTimeoutPolicy === 'deny' ? 'deny' : 'allow', { signal: codexSignal });
        } finally {
          graphManager.setPermissionWaiting(agentId, false);
          broadcastSnapshot();
        }
        noteCodexDecision(codexDecision.decision, permissionDecisionSource(codexDecision), codexDecision.reason);
        if (codexEvent === 'PreToolUse' && codexDecision.decision === 'allow') codexApprovalMemory.grant(approvalKey);
        if (codexDecision.decision === 'allow') noteAllowedPatch();
        if (!res.writableEnded) res.json({ ok: true, decision: codexDecision.decision, reason: codexDecision.reason });
        return;
      }

      /*
       * §5.22 — 권한·감사 경계.
       * 원장 줄은 모드 단축보다 먼저 적는다 — 통과시킨 호출까지 남아야 하고, 묻지 않은 것과 허용한 것이 다른 상태로 구분된다.
       * (훅으로만 붙은 세션은 여기 오지 않지만 `processHookEvent` 가 같은 원장에 적는다.)
       */
      const auditProject = graphManager.getAgentProjectName(agentId) ?? '';
      // §5.22 `outside` — 이 호출이 머물러야 할 경계(프로젝트 루트 + 이 세션의 cwd).
      //   훅 경로와 **같은 헬퍼**를 써야 한 호출이 카드와 타임라인에서 다르게 판정되지 않는다.
      const auditRoots = graphManager.getAuditRoots(auditProject, body.cwd ?? null);
      const riskKinds = classifyToolRiskOnHost(toolName, toolInput, auditRoots);
      const escalate = riskKinds.length > 0
        && shouldEscalateRisk(graphManager.getAuditBoundary(auditProject), riskKinds);
      const auditEntryId = graphManager.recordAuditCall({
        projectName: auditProject,
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
        agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        ...(agentNode.label ? { agentLabel: agentNode.label } : {}),
        ...(config.color ? { agentColor: config.color } : {}),
        toolName,
        toolInput,
        roots: auditRoots,
        awaitHookEvent: true,
      });
      const noteAuditDecision = (
        decision: 'allow' | 'deny',
        source: AuditDecisionSource,
        reason?: string,
      ): void => {
        if (auditEntryId) graphManager.recordAuditDecision(auditProject, auditEntryId, decision, source, reason);
      };

      // §5.3 #12-1 — 권한 축은 permissionMode 하나. CC 권한 모델에 팝업 발동을 매핑:
      //   bypassPermissions → 무확인 / plan → 실행 차단은 CC 자체 / 읽기 전용 → 자동 allow
      //   acceptEdits → 편집 계열 자동 allow / default·acceptEdits(비편집 가변) → 사용자 확인 팝업
      const mode = config.permissionMode || 'default';
      const EDIT_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);

      /*
       * §5.3 #12-1-A — 도구별 확인 목록. 이 버블 설정창에서 지목한 도구는 모드와 무관하게 아래 단축을 타지 않고 사람에게 간다.
       * 자리가 핵심이다 — `bypassPermissions`·`auto`·`acceptEdits` 의 편집 통과 **앞**이어야 그 셋에서 붙잡힌다(뒤면 영영 안 탄다). 관할·커스텀 가드(`not-managed`·`view-only-agent`)보다는 뒤라 훅 버블은 해당 없다(§12-1).
       * `plan`·`dontAsk` 는 제외 — plan 은 실행이 없고, dontAsk 는 이미 사람 없이 답을 낸다(되물으면 무인 실행에 60초 팝업이 쌓인다).
       * 읽기 전용 통과보다는 앞이다 — `Read` 를 골랐다면 읽기도 묻는다.
       */
      const askedByTool = shouldAskForTool(config.askTools, toolName)
        && mode !== 'plan' && mode !== 'dontAsk';

      /*
       * §5.11 정독 게이트 — 강도 `차단`의 집행 자리. 안 연 필수 절을 남긴 채 코드를 고치려 하면 그 편집을 거부한다.
       * `bypassPermissions`·`acceptEdits` 의 편집 통과보다 앞이어야 그 모드에서 붙잡힌다(도구별 확인 목록과 같은 이유).
       * 커스텀 에이전트 전용(`view-only-agent` 가 위에서 막는다) — 사용자 에디터의 편집은 거부하지 않고 알림과 `Stop` 되돌림(강도 2)까지만 간다.
       */
      if (EDIT_TOOLS.has(toolName) && typeof body.subAgentId === 'string' && body.subAgentId) {
        const target = toolInput?.['file_path'] ?? toolInput?.['notebook_path'];
        const specGate = specWriteGate(body.subAgentId, typeof target === 'string' ? target : '', {
          customCreated: true,
        });
        if (specGate.deny && specGate.reason) {
          noteAuditDecision('deny', 'policy', 'spec-reading');
          broadcastSnapshot();
          res.json({ ok: true, decision: 'deny', reason: specGate.reason });
          return;
        }
      }

      /*
       * §5.3 #12-1-B — 금지 목록은 모드 단축보다 먼저. `--disallowedTools` 는 스폰 때 실리므로 [항상 거절] 뒤에도 오래 사는 자식은 그 도구를 계속 가진다 — 여기서 다시 봐야 누른 순간부터 먹는다.
       * `reason` 은 훅이 문구를 고르는 약속된 마커다(사람이 누른 척 ❌).
       */
      if (isToolDisallowed(config.disallowedTools, toolName)) {
        noteAuditDecision('deny', 'policy', 'disallowed');
        res.json({ ok: true, decision: 'deny', reason: 'disallowed' });
        return;
      }

      /*
       * §5.3 #12-4 (E) ① — 검증은 시킬 때만. 금지 목록 바로 뒤, 자물쇠·모든 모드 단축(`bypassPermissions`·`auto`·`acceptEdits`·읽기 전용 통과·세션 기억)보다 먼저다 — 뒤면 그 모드들에서 안 탄다.
       *   `plan` 은 실행이 없어 보지 않는다. 묻지 않는다(팝업 ❌) — 범위 밖이면 실행 전 거부하고 사유는 서버가 짓는다(`message`). 도는 명령을 못 찾으면 거부(fail-closed). 검증이 아닌 호출은 그대로 흐른다.
       *   (J) 차단을 꺼 두면(기본) 판정 객체가 거부 없이 실행으로만 센다 — 스위치는 그 객체가 쥔다.
       */
      if (mode !== 'plan') {
        const verification = verificationGate.checkSubAgentCall(
          typeof body.subAgentId === 'string' && body.subAgentId ? body.subAgentId : undefined,
          { toolName, toolInput, cwd: body.cwd ?? null },
        );
        if (verification.verdict === 'deny') {
          noteAuditDecision('deny', 'policy', VERIFICATION_DENY_REASON);
          res.json({ ok: true, decision: 'deny', reason: VERIFICATION_DENY_REASON, message: verification.message });
          return;
        }
      }

      /*
       * §5.3 #12-3 — 자물쇠는 모든 모드 단축보다 먼저(`bypassPermissions`·`auto`·`plan`·`acceptEdits`·읽기 전용 통과·세션 기억). 금지 목록 뒤인 것은 그쪽이 이미 거부를 냈기 때문이다.
       * `plan` 도 묻는다(계획 모드의 읽기도 실제 접근). `dontAsk` 는 거부한다. 위험·확인 목록과 겹쳐도 카드는 한 장이고 자물쇠 규칙이 이긴다(무응답 거부 · "항상"은 잠금 풀기뿐).
       */
      const managedLockHits = lockHits();
      if (managedLockHits.length > 0) {
        if (mode === 'dontAsk') {
          noteAuditDecision('deny', 'policy', 'locked');
          res.json({ ok: true, decision: 'deny', reason: 'locked', message: lockDenyReason(managedLockHits, 'dont-ask') });
          return;
        }
        const lockSubAgentId = typeof body.subAgentId === 'string' && body.subAgentId ? body.subAgentId : undefined;
        const lockSignal = callerGoneSignal(res);
        graphManager.setPermissionWaiting(agentId, true);
        broadcastSnapshot();
        let lockDecision;
        try {
          lockDecision = await permissionBroker.request({
            agentId,
            subAgentId: lockSubAgentId,
            agentLabel: agentNode.label ?? agentId,
            agentColor: config.color ?? BUBBLE_COLORS.agent,
            projectName: auditProject,
            toolName,
            toolInput,
            ...(riskKinds.length > 0 ? { risk: riskKinds } : {}),
            lockHits: lockHitsForCard(managedLockHits),
            // [잠금 풀고 허용] — 카드를 세운 자물쇠를 그 주인 프로젝트에서 푼다. "항상 거절"·세션 기억은 없다.
            alwaysAllow: 'unlock',
            ...(auditEntryId ? { auditEntryId } : {}),
          }, 'deny', { signal: lockSignal });
        } finally {
          graphManager.setPermissionWaiting(agentId, false);
          broadcastSnapshot();
        }
        noteAuditDecision(lockDecision.decision, permissionDecisionSource(lockDecision), lockDecision.reason);
        if (!res.writableEnded) res.json({ ok: true, decision: lockDecision.decision, reason: lockDecision.reason });
        return;
      }

      // §5.22 — `!escalate` 가 붙은 단축은 **위험 3종이 아닐 때만** 탄다. 경계를 끄면
      //   `escalate` 가 늘 false 라 아래는 종전 그대로 동작한다.
      if (!escalate && !askedByTool && mode === 'bypassPermissions') {
        noteAuditDecision('allow', 'policy', 'bypass');
        res.json({ ok: true, decision: 'allow', reason: 'bypass' });
        return;
      }
      // §5.22 — `plan` 은 경계가 건드리지 않는다. 실행 자체를 CLI 가 막는 자리라
      //   여기서 또 물으면 **일어나지도 않을 호출**에 사람을 세우는 셈이다.
      if (mode === 'plan') {
        noteAuditDecision('allow', 'policy', 'plan');
        res.json({ ok: true, decision: 'allow', reason: 'plan' });
        return;
      }
      // §4 (CLI 사양 추종) — `auto` 는 **판정을 CLI 모델 분류기에 맡긴 모드**다. 여기서 또 팝업을 띄우면
      //   같은 호출을 두 번 묻는 셈이고 사용자가 auto 를 고른 의미가 사라진다 — 우리는 비관여로 통과시키고
      //   차단은 CLI 가 한다(거부 시 transcript 에 분류기 사유가 남는다).
      if (!escalate && !askedByTool && mode === 'auto') {
        res.json({ ok: true, decision: 'allow', reason: 'cli-auto-classifier' });
        return;
      }
      // §5.22 — 읽기 전용 도구의 통과도 종전 그대로다(위험 3종 어디에도 걸리지 않는다).
      if (!askedByTool && READ_TOOLS.has(toolName)) {
        res.json({ ok: true, decision: 'allow', reason: 'read-only' });
        return;
      }
      if (!escalate && !askedByTool && mode === 'acceptEdits' && EDIT_TOOLS.has(toolName)) {
        noteAuditDecision('allow', 'policy', 'accept-edits');
        res.json({ ok: true, decision: 'allow', reason: 'accept-edits' });
        return;
      }
      // §4 (CLI 사양 추종) — `dontAsk` = "묻지 않는다, 사전 승인이 없으면 거부"(CLI 의미 그대로).
      //   읽기전용은 위에서 이미 통과했으므로 여기 오는 것은 가변 도구뿐 — 팝업 없이 즉시 거부한다.
      //   사람이 자리를 비운 채 돌리는 무인 실행에서 60초 팝업이 쌓이지 않게 하는 안전 모드.
      if (mode === 'dontAsk') {
        //   reason 은 훅이 분기하는 **약속된 마커**('timeout' 과 같은 자리) — 문구는 훅이 만든다.
        //   여기서 자유 문장을 보내면 훅의 "사용자가 Deny 를 눌렀다" 문구에 섞여 거짓말이 된다.
        //   §5.22 — 이 즉시 거부는 경계가 건드리지 않는다(사람 없이 이미 안전한 답을 낸다).
        noteAuditDecision('deny', 'policy', 'dont-ask');
        res.json({ ok: true, decision: 'deny', reason: 'dont-ask' });
        return;
      }

      // 가변 도구 + (default | acceptEdits 비편집) → broker 큐잉, 클라 응답 대기
      const agentLabel = agentNode.label ?? agentId;
      const agentColor = config.color ?? BUBBLE_COLORS.agent;
      const projectName = graphManager.getAgentProjectName(agentId) ?? '';
      const permissionSubAgentId = typeof body.subAgentId === 'string' && body.subAgentId ? body.subAgentId : undefined;

      /*
       * §5.3 #12-1-B — **이 세션에선 허용** 기억. 위험·확인 목록 판정 뒤, 브로커 직전이다 — 경계가
       * 붙잡은 호출과 사용자가 지목한 도구는 기억이 있어도 여전히 사람에게 간다.
       */
      if (!escalate && !askedByTool && permissionSessionGrants.has(agentId, permissionSubAgentId, toolName)) {
        noteAuditDecision('allow', 'policy', 'session-grant');
        res.json({ ok: true, decision: 'allow', reason: 'session-grant' });
        return;
      }
      // §5.3 #12-1-B — "항상"이 적히는 칸은 카드가 뜬 이유가 정한다(카드는 받은 대로 버튼을 그린다).
      const alwaysAllow: PermissionRequest['alwaysAllow'] = escalate ? undefined
        : askedByTool ? 'ask-tools'
        : permissionSubAgentId ? 'session'
        : undefined;

      // §5.3 #12-1 — 60초 무응답 fallback 정책(기본 allow).
      const timeoutPolicy = config.permissionTimeoutPolicy === 'deny' ? 'deny' : 'allow';
      const signal = callerGoneSignal(res);
      // §5.3 #12-1 — 팝업 대기 동안 에이전트를 "블록된 활성"으로 고정(completed 강등 방지).
      graphManager.setPermissionWaiting(agentId, true);
      // §5.22 — 모드가 통과시켰을 호출을 경계가 되돌려 물었다는 표식(타임라인에서 구분된다).
      if (escalate && auditEntryId) graphManager.markAuditEscalated(auditProject, auditEntryId);
      broadcastSnapshot();
      let decision;
      try {
        decision = await permissionBroker.request({
          agentId,
          // §5.3 #12-1 — sub 인스턴스 ID 를 찍어 두어 broker resolve 뒤 Allow/Deny 결정을 그 sub 의 stream 라인으로 합성할 수 있게 한다.
          subAgentId: permissionSubAgentId,
          agentLabel,
          agentColor,
          projectName,
          toolName,
          toolInput,
          // §5.22 — 카드가 "왜 지금 묻는지"를 말할 수 있게 위험 판정을 함께 싣는다.
          ...(riskKinds.length > 0 ? { risk: riskKinds } : {}),
          ...(escalate ? { escalated: true } : {}),
          // §5.3 #12-1-A — 카드가 "왜 지금 묻는지"를 말할 수 있게. 모드가 원래 묻는 호출에는 안 붙는다.
          ...(askedByTool ? { askedByTool: true } : {}),
          ...(alwaysAllow ? { alwaysAllow } : {}),
          alwaysReject: 'disallowed-tools',
          ...(auditEntryId ? { auditEntryId } : {}),
        }, timeoutPolicy, { signal });
      } finally {
        graphManager.setPermissionWaiting(agentId, false);
        broadcastSnapshot();
      }
      // §5.22 — 사람(또는 60초 무응답 정책 · 취소)의 답을 원장의 그 줄에 적는다.
      noteAuditDecision(
        decision.decision,
        permissionDecisionSource(decision),
        decision.reason,
      );
      if (!res.writableEnded) res.json({ ok: true, decision: decision.decision, reason: decision.reason });
    } catch (err) {
      logger.error('POST /api/permission-check failed', err);
      // safe-deny on error
      res.status(500).json({ ok: false, decision: 'deny', reason: 'internal-error' });
    }
  });

  /**
   * §5.3 #12-1-B — [항상 허용]/[항상 거절]을 카드가 뜬 이유가 정한 칸에 적는다.
   * 칸은 대기 요청의 `alwaysAllow`·`alwaysReject`(카드를 띄울 때 서버가 찍었다)에서 읽는다 — 결정 본문의 도구·칸 이름은 받지 않는다(이름을 바꿔 보내 다른 도구를 풀 수 없게).
   * 설정은 지금 값 한 벌을 통째로 새로 지어 저장한다(부분 객체로 갈아치우면 칸이 사라진다).
   */
  function applyPermissionAlways(
    request: PermissionRequest,
    choice: 'allow_always' | 'reject_always',
  ): { ok: true } | { ok: false; error: string } {
    const scope = choice === 'allow_always' ? request.alwaysAllow : request.alwaysReject;
    if (!scope) return { ok: false, error: 'always-not-offered' };
    if (scope === 'unlock') {
      // §5.3 #12-3 — [잠금 풀고 허용]: 카드를 세운 자물쇠를 **그 주인 프로젝트**에서 푼다(다른 탭이 건 것일 수 있다).
      //   자물쇠 id 는 카드에 서버가 실어 둔 것만 쓴다 — 결정 본문으로 다른 자물쇠를 풀 수 없다.
      const hits = request.lockHits ?? [];
      if (hits.length === 0) return { ok: false, error: 'always-not-offered' };
      const byProject = new Map<string, string[]>();
      for (const hit of hits) byProject.set(hit.projectName, [...(byProject.get(hit.projectName) ?? []), hit.lockId]);
      let changed = false;
      for (const [projectName, ids] of byProject) {
        if (graphManager.updatePathLocks(projectName, [], ids)?.changed) changed = true;
      }
      if (changed) {
        broadcastSnapshot();
        saveCheckpoint();
      }
      logger.info(`[permission] allow_always → unlock (${request.agentId} · ${hits.map((h) => h.target).join(', ')})`);
      return { ok: true };
    }
    if (scope === 'session') {
      if (!request.subAgentId) return { ok: false, error: 'always-not-offered' };
      permissionSessionGrants.grant(request.agentId, request.subAgentId, request.toolName);
      return { ok: true };
    }
    const config = graphManager.getAgentConfig(request.agentId);
    if (!config) return { ok: false, error: 'agent-config-missing' };
    let next: AgentConfig;
    if (scope === 'codex-tools') {
      const group = codexToolGroup(request.toolName);
      if (!group || config.provider?.kind !== 'codex-cli') return { ok: false, error: 'always-not-offered' };
      next = {
        ...config,
        provider: {
          ...config.provider,
          codexTools: { ...config.provider.codexTools, [group]: choice === 'allow_always' ? 'allow' : 'deny' },
        },
      };
    } else {
      const lists = applyToolListAlways(
        { askTools: config.askTools, disallowedTools: config.disallowedTools },
        request.toolName,
        choice,
      );
      next = { ...config, askTools: lists.askTools, disallowedTools: lists.disallowedTools };
      // 확인 목록에서 빼기만 하면 Manual 의 가변 도구는 곧바로 모드 카드가 다시 뜬다 — 세션 기억을 함께 남긴다.
      if (scope === 'ask-tools' && request.subAgentId) {
        permissionSessionGrants.grant(request.agentId, request.subAgentId, request.toolName);
      }
    }
    graphManager.setAgentConfig(request.agentId, next);
    broadcastSnapshot();
    saveCheckpoint();
    logger.info(`[permission] ${choice} → ${scope} (${request.agentId} · ${request.toolName})`);
    return { ok: true };
  }

  /**
   * §5.3 #12-1 — POST /api/permission-decide — 클라 모달 버튼. broker 의 pending 요청을 푼다.
   * §5.3 #12-1-B — 본문은 답 넷(`choice`)이고 `decision` 은 서버가 접는다. `decision` 만 보내는 옛 클라는 한 번짜리다.
   */
  app.post('/api/permission-decide', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<PermissionDecision>;
      const choice: PermissionChoice | undefined = body.choice !== undefined
        ? (PERMISSION_CHOICES.includes(body.choice) ? body.choice : undefined)
        : body.decision === 'allow' ? 'allow_once'
        : body.decision === 'deny' ? 'reject_once'
        : undefined;
      if (typeof body.requestId !== 'string' || !choice) {
        res.status(400).json({ ok: false, error: 'invalid payload' });
        return;
      }
      const pending = permissionBroker.get(body.requestId);
      if (!pending) {
        res.status(404).json({ ok: false, error: 'request not found (possibly timed out)' });
        return;
      }
      if (choice === 'allow_always' || choice === 'reject_always') {
        // 쓰는 칸이 #12-1 의 동결 칸이라 loopback 유입은 "항상"을 못 누른다(권한 축은 사용자만 올린다).
        if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) {
          res.status(400).json({ ok: false, error: 'always-not-allowed-from-loopback' });
          return;
        }
        // 제공되지 않은 "항상"을 한 번짜리로 낮춰 받지 않는다 — "항상 눌렀는데 또 묻는다"가 된다.
        const applied = applyPermissionAlways(pending, choice);
        if (!applied.ok) {
          res.status(400).json({ ok: false, error: applied.error });
          return;
        }
      }
      const resolved = permissionBroker.resolve({
        requestId: body.requestId,
        decision: foldPermissionChoice(choice),
        choice,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      });
      if (!resolved) {
        res.status(404).json({ ok: false, error: 'request not found (possibly timed out)' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/permission-decide failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §5.3 #12-3 — POST /api/path-locks `{ projectName, lock?: PathLockTarget[], unlock?: string[] }` — 버블 우클릭 [잠그기]/[잠금 풀기].
   * 걸고 푸는 손은 사람뿐 — loopback 유입은 403(화이트리스트에도 없지만 두 겹으로 막는다, #12-1-B "항상"과 같은 규율).
   * `projectName` 은 표시명·원래 이름·경로 무엇이든 된다(클라는 표시명을 보낸다).
   */
  app.post('/api/path-locks', (req, res) => {
    try {
      if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) {
        res.status(403).json({ ok: false, error: 'path-locks-not-allowed-from-loopback' });
        return;
      }
      const body = (req.body ?? {}) as { projectName?: unknown; lock?: unknown; unlock?: unknown };
      const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : '';
      const rawLock = Array.isArray(body.lock) ? body.lock.slice(0, PATH_LOCK_MAX_PER_PROJECT) : [];
      const unlock = Array.isArray(body.unlock)
        ? body.unlock.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, PATH_LOCK_MAX_PER_PROJECT)
        : [];
      const lock: PathLockTarget[] = [];
      let invalid = 0;
      for (const raw of rawLock) {
        const target = normalizePathLockTarget(raw);
        if (target) lock.push(target);
        else invalid++;
      }
      if (!projectName || (lock.length === 0 && unlock.length === 0)) {
        res.status(400).json({ ok: false, error: 'invalid payload' });
        return;
      }
      const result = graphManager.updatePathLocks(projectName, lock, unlock);
      if (!result) {
        res.status(404).json({ ok: false, error: 'project not found' });
        return;
      }
      if (result.changed) {
        broadcastSnapshot();
        saveCheckpoint();
      }
      res.json({ ok: true, projectName: result.projectName, locks: result.locks, rejected: result.rejected + invalid });
    } catch (err) {
      logger.error('POST /api/path-locks failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §5.22 — GET /api/audit-log/:projectName
   * 그 프로젝트의 감사 원장 한 장(전선 스냅샷과 같은 모양). 스냅샷이 늦거나 끊긴 상황에서
   * 타임라인이 "없다"와 "못 물었다"를 구분할 수 있게 하는 조회 창구.
   */
  app.get('/api/audit-log/:projectName', (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params['projectName'] ?? '');
      if (!projectName) {
        res.status(400).json({ ok: false, error: 'projectName required' });
        return;
      }
      const log = graphManager.getAuditLog(projectName);
      res.json({ ok: true, log: log ?? null, boundary: graphManager.getAuditBoundary(projectName) });
    } catch (err) {
      logger.error('GET /api/audit-log failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  // §5.26 / §7.23 — 컨텍스트 보험 창구. 전부 사용자가 눌렀을 때만 돈다 — 자동 동작은 사본 뜨기·대조까지이고, 되돌리기·부활·압축 보내기는 이 여섯 라우트로만 일어난다(§5.26 (J)).

  /**
   * GET /api/insurance/:projectName — 그 프로젝트의 원장 전문 + 파생 두 축(감시·부활 후보).
   * 팝업(§7.23)이 열릴 때 한 번 부른다. 방송 스냅샷은 최근분만 싣고, 전문은 여기로 온다.
   */
  app.get('/api/insurance/:projectName', (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params['projectName'] ?? '');
      if (!projectName) {
        res.status(400).json({ ok: false, error: 'projectName required' });
        return;
      }
      const ledger = graphManager.getInsuranceLedger(projectName);
      res.json({ ok: true, ledger: ledger ?? null });
    } catch (err) {
      logger.error('GET /api/insurance failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * GET /api/insurance/:projectName/preimage/:id — 사본 한 건의 내용(§7.23 `[미리보기]`).
   * `text: null` 은 이진이거나 예산에 밀려 사라진 것 — 화면은 "미리볼 수 없다"고 적어야 한다(빈 문서는 사본이 비었다는 뜻으로 읽힌다).
   */
  app.get('/api/insurance/:projectName/preimage/:id', (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params['projectName'] ?? '');
      const id = req.params['id'] ?? '';
      if (!projectName || !id) {
        res.status(400).json({ ok: false, error: 'projectName and id required' });
        return;
      }
      const found = graphManager.readInsuranceBlob(projectName, id);
      if (!found) {
        res.status(404).json({ ok: false, error: 'preimage not found' });
        return;
      }
      res.json({ ok: true, preimage: found.preimage, text: found.text });
    } catch (err) {
      logger.error('GET /api/insurance preimage failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * POST /api/insurance/restore-file — 사본으로 되돌린다(§7.23 `[다시 읽히기]`).
   * 되돌리기 직전 내용도 사본으로 뜬다(`undoId`) — 잘못 눌러도 한 번 더 되돌아갈 자리가 있어야 한다.
   */
  app.post('/api/insurance/restore-file', (req, res) => {
    try {
      const body = (req.body ?? {}) as { projectName?: unknown; id?: unknown };
      const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : '';
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!projectName || !id) {
        res.status(400).json({ ok: false, error: 'projectName and id required' });
        return;
      }
      const out = graphManager.restoreInsuranceFile(projectName, id);
      if (!out.ok) {
        res.status(409).json({ ok: false, error: 'restore failed (blob gone or unwritable)' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, ...(out.undoId ? { undoId: out.undoId } : {}) });
    } catch (err) {
      logger.error('POST /api/insurance/restore-file failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * POST /api/insurance/resurrect — 죽은 세션 하나를 탭에 입힌다(§5.26 (G) 5단계).
   * `mode: 'resume'` 은 대화를 이어받고(다음 명령이 `--resume`), `'fresh'` 는 새 탭만 열고 사본은 팝업에서 읽게 둔다 — 큰 기록(`resumeRisky`)·사본만 남은 것(`mirroredOnly`)엔 이쪽이 맞다.
   */
  app.post('/api/insurance/resurrect', (req, res) => {
    try {
      const body = (req.body ?? {}) as { agentId?: unknown; sessionId?: unknown; mode?: unknown; label?: unknown };
      const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
      const mode = body.mode === 'fresh' ? 'fresh' : 'resume';
      if (!agentId || !sessionId) {
        res.status(400).json({ ok: false, error: 'agentId and sessionId required' });
        return;
      }
      if (isReadOnlyHookAgentId(agentId)) {
        res.status(403).json({ ok: false, error: READ_ONLY_HOOK_AGENT_ERROR });
        return;
      }
      // 살아 있는 세션을 되살리면 한 대화를 두 탭이 민다 — 여기서 막는다(§5.26 (G)).
      if (graphManager.getAgentBySession(sessionId)) {
        res.status(409).json({ ok: false, error: 'session is alive' });
        return;
      }
      const sub = subAgentManager.create(agentId);
      const label = typeof body.label === 'string' ? body.label : '';
      const adopted = mode === 'resume'
        ? subAgentManager.adoptSession(sub.id, sessionId, label)
        : false;
      /* §5.26 (G) — 이어받은 경우에만 확인을 건다. `fresh` 는 새 대화라 비교할 것이 없고(비어 있는 게 정상), `resume` 만 "성공한 얼굴로 빈 문맥"이 가능하다(#43696). */
      if (adopted) graphManager.armResumeCheck(sessionId);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, subAgent: sub, mode, adopted });
    } catch (err) {
      logger.error('POST /api/insurance/resurrect failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * POST /api/insurance/snapshot — 지금 이 세션의 사본을 손으로 뜬다(§7.23 `[지금 사본 뜨기]`).
   * `PreCompact` 를 기다리지 않고 같은 마커를 만든다(자동압축이 안 도는 것 같을 때 (F) 가 내주는 손잡이). `trigger: 'manual'` 로 이력에서 구분된다.
   */
  app.post('/api/insurance/snapshot', (req, res) => {
    try {
      const body = (req.body ?? {}) as { sessionId?: unknown; subAgentId?: unknown };
      const subAgentId = typeof body.subAgentId === 'string' ? body.subAgentId.trim() : '';
      const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim()
        : (subAgentId ? subAgentManager.getSub(subAgentId)?.sessionId ?? '' : '');
      if (!sessionId) {
        res.status(400).json({ ok: false, error: 'sessionId (or a subAgentId with one) required' });
        return;
      }
      const marker = graphManager.recordCompactMarker({
        sessionId,
        trigger: 'manual',
        ...(subAgentId ? { subAgentId } : {}),
      });
      if (!marker) {
        res.status(409).json({ ok: false, error: 'no transcript for this session' });
        return;
      }
      // 미러는 응답 뒤에 — 훅 경로와 같은 규율이다(사용자를 기다리게 하지 않는다).
      setImmediate(() => graphManager.mirrorCompactMarker(marker));
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, marker });
    } catch (err) {
      logger.error('POST /api/insurance/snapshot failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * POST /api/insurance/compact — 사용자가 직접 압축을 보낸다(§7.23 `[압축 보내기]`).
   * `/api/agent-compact` 와 같은 대기표를 쓴다(턴이 끝나는 자리에서 `/compact` 가 큐에 얹혀 일하던 것이 잘리지 않는다). `agentCanCompact` 관문은 없다 — 그건 에이전트가 스스로 부를 수 있는가의 스위치다.
   */
  app.post('/api/insurance/compact', (req, res) => {
    try {
      const body = (req.body ?? {}) as { subAgentId?: unknown };
      const subAgentId = typeof body.subAgentId === 'string' ? body.subAgentId.trim() : '';
      if (!subAgentId) {
        res.status(400).json({ ok: false, error: 'subAgentId required' });
        return;
      }
      if (!subAgentManager.getSub(subAgentId)) {
        res.status(404).json({ ok: false, error: 'unknown subAgentId' });
        return;
      }
      compactRequestedSubs.add(subAgentId);
      logger.info(`[turn-compact] requested by user sub=${subAgentId} (§5.26 F)`);
      res.json({ ok: true, scheduled: 'end-of-turn' });
    } catch (err) {
      logger.error('POST /api/insurance/compact failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §5.22 — POST /api/audit-boundary/:projectName
   * 경계 스위치(전체 + 위험 종류별) 갱신. **기록을 끄는 스위치는 없다** — 이 창구는
   * "실행 전에 물을지"만 정한다.
   */
  app.post('/api/audit-boundary/:projectName', (req, res) => {
    try {
      const projectName = decodeURIComponent(req.params['projectName'] ?? '');
      if (!projectName) {
        res.status(400).json({ ok: false, error: 'projectName required' });
        return;
      }
      const body = (req.body ?? {}) as Partial<AuditBoundaryConfig>;
      const patch: Partial<AuditBoundaryConfig> = {};
      if (typeof body.escalateRisky === 'boolean') patch.escalateRisky = body.escalateRisky;
      if (body.kinds && typeof body.kinds === 'object') {
        // 외부에서 온 값이므로 종류·불리언을 한 번 걸러 넣는다.
        // 여기서 쓰는 것은 `.kinds` 뿐이다 — 전체 스위치는 위에서 따로 받으므로 넣지 않는다
        // (기본값을 이 자리에 적어 두면 §5.22 기본이 바뀔 때 조용히 어긋난다).
        patch.kinds = normalizeAuditBoundary({ kinds: body.kinds }).kinds;
        for (const [k, v] of Object.entries(body.kinds)) {
          if (typeof v !== 'boolean') delete (patch.kinds as Record<string, unknown>)[k];
        }
      }
      const boundary = graphManager.setAuditBoundary(projectName, patch);
      if (!boundary) {
        res.status(404).json({ ok: false, error: 'project not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, boundary });
    } catch (err) {
      logger.error('POST /api/audit-boundary failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** §5.7 #23-1 — GET /api/claude-version — 지금 쓰는 `claude` 버전 + npm registry latest 비교. latest 는 5분 TTL 캐시(`?refresh=1` 로 무효화). */
  app.get('/api/claude-version', async (req, res) => {
    try {
      const force = req.query['refresh'] === '1';
      const info = await getClaudeVersionInfo(force);
      res.json({ ok: true, info });
    } catch (err) {
      logger.error('GET /api/claude-version failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /**
   * §4 — GET /api/claude-installs — 옵션창 Version 탭: PC 의 모든 claude 설치본 + 현재 활성/선택 + 앱·런타임 메타 + npm latest.
   * `?refresh=1` 로 registry 캐시 무효화. 선택 저장은 기존 `PUT /api/user-defaults {claudeBinPath}`.
   */
  app.get('/api/claude-installs', async (req, res) => {
    try {
      const force = req.query['refresh'] === '1';
      const info = await getClaudeInstallsInfo(force);
      res.json({ ok: true, info });
    } catch (err) {
      logger.error('GET /api/claude-installs failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /**
   * §4 (앱 전용 엔진) ④ — GET /api/codex-installs. Version 탭 코덱스 칸의 고르기 목록(기본 = 앱 전용 · 나머지 = 보조).
   * 선택 저장은 `PUT /api/user-defaults {codexBinPath}`(빈 문자열 = 기본). 렌더러 전용(루프백 화이트리스트 ❌).
   */
  app.get('/api/codex-installs', async (_req, res) => {
    try {
      invalidateCodexBinCache(); // 앱 밖에서 깔거나 지웠을 수 있다 — 들어올 때마다 다시 찾는다
      res.json({ ok: true, info: await getCodexInstallsInfo() });
    } catch (err) {
      logger.error('GET /api/codex-installs failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /** §5.7 #23-1 — POST /api/claude-version/install — `npm install -g @anthropic-ai/claude-code` 1회. 단일 in-flight 락(동시 호출은 같은 installId). 진행은 WS `claude_install_progress`. */
  app.post('/api/claude-version/install', (_req, res) => {
    try {
      const progress = installLatestClaude();
      res.json({ ok: true, progress });
    } catch (err) {
      logger.error('POST /api/claude-version/install failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /** §5.7 #23-1 — GET /api/claude-version/install — 진행 중 설치 상태(WS 재연결/새로고침 복구용). */
  app.get('/api/claude-version/install', (_req, res) => {
    res.json({ ok: true, progress: getInflightInstall() });
  });

  /** §5.7 #23-1 — POST /api/claude-version/dismiss-session — "이번 세션 건너뛰기"/"이 버전 계속 쓰기". registry 캐시를 비워 다음 세션(새로고침)에 신선한 결과를 받게 한다. */
  app.post('/api/claude-version/dismiss-session', (_req, res) => {
    invalidateLatestCache();
    res.json({ ok: true });
  });

  // §5.19 All Model — 로컬 LLM(엔진 설치 · 모델 카탈로그 · 내려받기). 그래프 상태는 건드리지 않고, 목록이 바뀌는 조작(설치·내려받기·삭제) 뒤에는 스냅샷을 한 번 민다.

  // §5.19 (E) — 내려받기가 끝나면 그 모델에게 실제로 몇 마디 시켜 본다.
  //   러너와 모델 서비스가 서로 물지 않도록 배선은 여기 한 곳에서 한다.
  setModelDownloadedHook((modelId) => {
    void verifyModelOutput(modelId).then(() => broadcastSnapshot()).catch((err: unknown) => {
      logger.warn('Local model output check failed', err);
    });
  });

  /** GET /api/local-llm — 엔진 상태 + 받아 둔 모델 + 진행 중 내려받기. */
  app.get('/api/local-llm', (_req, res) => {
    void (async (): Promise<void> => {
      try {
        // 사양은 엔진에게 물어 온다 — 캐시가 살아 있으면 프로세스를 띄우지 않는다.
        const hardware = await getLocalHardware();
        res.json({
          ok: true,
          state: {
            engine: getEngineState(),
            models: listModels(),
            downloads: listDownloads(),
            loaded: listLoadedModels(),
            hardware,
          },
        });
      } catch (err) {
        logger.error('GET /api/local-llm failed', err);
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  /**
   * POST /api/local-llm/engine/install — 엔진 설치 1회 발사.
   * 동시 호출은 같은 in-flight installId 를 돌려준다. 진행은 WS `local_engine_progress`.
   */
  app.post('/api/local-llm/engine/install', (req, res) => {
    try {
      const body = req.body as { backends?: string[] } | undefined;
      const raw = Array.isArray(body?.backends) ? body.backends : [];
      const backends = raw.filter((b): b is 'vulkan' | 'cpu' | 'cuda' => b === 'vulkan' || b === 'cpu' || b === 'cuda');
      const progress = installEngine(backends.length > 0 ? backends : undefined);
      broadcastSnapshot();
      res.json({ ok: true, progress });
    } catch (err) {
      logger.error('POST /api/local-llm/engine/install failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /** GET /api/local-llm/engine/install — 진행 중(또는 마지막) 설치 상태. 재연결 복구용. */
  app.get('/api/local-llm/engine/install', (_req, res) => {
    res.json({ ok: true, progress: getInflightEngineInstall() });
  });

  /**
   * DELETE /api/local-llm/engine — 엔진 삭제.
   * 받아 둔 모델은 건드리지 않는다 — 수십 GB 를 말없이 지우지 않는다(§5.19 (B)).
   */
  app.delete('/api/local-llm/engine', (_req, res) => {
    void (async (): Promise<void> => {
      try {
        await uninstallEngine();
        invalidateLocalHardware(); // 엔진이 없어졌으니 재 둔 장치 정보도 버린다
        broadcastSnapshot();
        res.json({ ok: true });
      } catch (err) {
        logger.error('DELETE /api/local-llm/engine failed', err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    })();
  });

  // §5.5 #17-38 ⑫ 오프라인 받아쓰기 — 마이크를 누르면 화면이 먼저 여기에 묻는다. 준비돼 있으면 곧장 듣고, 아니면 설치 창이 뜬다(§5.19 (B) 와 같은 흐름).

  /** GET /api/voice-asr — 지금 이 PC 가 받아쓰기를 할 수 있는가. 판정 근거는 **디스크의 실물**. */
  app.get('/api/voice-asr', (_req, res) => {
    try {
      res.json({ ok: true, state: getVoiceAsrState() });
    } catch (err) {
      logger.error('GET /api/voice-asr failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /**
   * POST /api/voice-asr/install — 엔진 + 모델을 한 흐름으로 받는다.
   * 동시 호출은 같은 in-flight 를 돌려준다. 진행은 WS `voice_asr_progress`.
   */
  app.post('/api/voice-asr/install', (_req, res) => {
    try {
      res.json({ ok: true, progress: installVoiceAsr() });
    } catch (err) {
      logger.error('POST /api/voice-asr/install failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /** POST /api/voice-asr/install/cancel — 중간에 그만둔다. 받다 만 것은 남겨 다음에 이어받는다. */
  app.post('/api/voice-asr/install/cancel', (_req, res) => {
    res.json({ ok: true, canceled: cancelVoiceInstall() });
  });

  /** DELETE /api/voice-asr — 받아 둔 엔진·모델을 지운다. 묻는 것은 화면 몫(§5.19 (B)). */
  app.delete('/api/voice-asr', (_req, res) => {
    void (async (): Promise<void> => {
      try {
        stopVoiceEngine();
        await removeVoiceAsr();
        res.json({ ok: true });
      } catch (err) {
        logger.error('DELETE /api/voice-asr failed', err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    })();
  });

  /**
   * POST /api/voice-asr/session/start — 받아쓰기 한 번을 시작한다. 엔진이 안 떠 있으면 여기서 띄운다(모델 적재에 몇 초).
   * 돌려주는 것은 포트 하나이고 표본은 화면이 그 포트로 곧장 보낸다 — 초당 64KB 를 메인 스레드에 붓지 않기 위해서다.
   */
  app.post('/api/voice-asr/session/start', (req, res) => {
    void (async (): Promise<void> => {
      const body = req.body as { sessionId?: string } | undefined;
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
      if (!sessionId) {
        res.status(400).json({ ok: false, error: 'sessionId required' });
        return;
      }
      try {
        holdVoiceEngine(sessionId);
        const port = await ensureVoiceEngine();
        res.json({ ok: true, port });
      } catch (err) {
        releaseVoiceEngine(sessionId);
        logger.error('POST /api/voice-asr/session/start failed', err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    })();
  });

  /** POST /api/voice-asr/session/stop — 이 받아쓰기가 끝났다. 마지막 하나가 놓으면 엔진이 유휴로. */
  app.post('/api/voice-asr/session/stop', (req, res) => {
    const body = req.body as { sessionId?: string } | undefined;
    if (typeof body?.sessionId === 'string' && body.sessionId) releaseVoiceEngine(body.sessionId);
    res.json({ ok: true });
  });

  /**
   * GET /api/local-llm/catalog?q=&sort= — 받을 수 있는 저장소 검색(조회로 만든다, 하드코딩 목록 ❌).
   * `sort` 는 §5.19 (E) 네 축(내려받기·하트·트렌딩·최근) 중 하나 — 모르는 값은 내려받기 순으로 떨어뜨린다(낯선 문자열을 카탈로그에 넘기지 않는다).
   */
  app.get('/api/local-llm/catalog', (req, res) => {
    void (async (): Promise<void> => {
      try {
        const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
        const raw = req.query['sort'];
        const sort = LOCAL_MODEL_CATALOG_SORTS.find((s) => s === raw) ?? 'downloads';
        const repos = await searchCatalog(q, sort);
        res.json({ ok: true, repos });
      } catch (err) {
        logger.warn('GET /api/local-llm/catalog failed', err);
        res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  /** GET /api/local-llm/catalog/files?repo= — 그 저장소의 GGUF(=양자화 선택지) 목록. */
  app.get('/api/local-llm/catalog/files', (req, res) => {
    void (async (): Promise<void> => {
      try {
        const repo = typeof req.query['repo'] === 'string' ? req.query['repo'] : '';
        if (!repo) {
          res.status(400).json({ ok: false, error: 'repo required' });
          return;
        }
        const files = await listRepoFiles(repo);
        res.json({ ok: true, files });
      } catch (err) {
        logger.warn('GET /api/local-llm/catalog/files failed', err);
        res.status(502).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
  });

  /** POST /api/local-llm/models/download — 모델 내려받기(재개 가능). 진행은 WS `local_model_progress`. */
  app.post('/api/local-llm/models/download', (req, res) => {
    try {
      const body = req.body as { repo?: string; file?: string; partFiles?: unknown } | undefined;
      const repo = body?.repo ?? '';
      const file = body?.file ?? '';
      if (!repo || !file) {
        res.status(400).json({ ok: false, error: 'repo and file required' });
        return;
      }
      // 쪼개진 모델은 조각 전부를 함께 받는다 — 한 조각만 있으면 그 모델은 못 쓴다.
      const partFiles = Array.isArray(body?.partFiles)
        ? body.partFiles.filter((f): f is string => typeof f === 'string' && f.length > 0)
        : [];
      const progress = downloadModel(repo, file, partFiles.length > 0 ? partFiles : undefined);
      broadcastSnapshot();
      res.json({ ok: true, progress });
    } catch (err) {
      logger.error('POST /api/local-llm/models/download failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /** POST /api/local-llm/models/cancel — 내려받기 중단. 받다 만 조각은 남긴다(다음에 이어 받게). */
  app.post('/api/local-llm/models/cancel', (req, res) => {
    const body = req.body as { downloadId?: string } | undefined;
    const ok = cancelDownload(body?.downloadId ?? '');
    broadcastSnapshot();
    res.json({ ok });
  });

  /** DELETE /api/local-llm/models/:modelId — 받아 둔 모델 삭제. */
  app.delete('/api/local-llm/models/:modelId', (req, res) => {
    void (async (): Promise<void> => {
      try {
        const removed = await deleteModel(req.params.modelId ?? '');
        broadcastSnapshot();
        res.json({ ok: removed });
      } catch (err) {
        logger.error('DELETE /api/local-llm/models failed', err);
        res.status(500).json({ ok: false, error: (err as Error).message });
      }
    })();
  });

  /**
   * §5.25 (G-2) — GET /api/local-llm/models/:modelId/sampling — 온도를 비워 두면 실제로 쓰이는 값과 출처.
   * 읽기만 한다(엔진을 올리지 않는다). 모르면 `temperature: null`.
   */
  app.get('/api/local-llm/models/:modelId/sampling', (req, res) => {
    void (async (): Promise<void> => {
      try {
        res.json(await getLocalSampling(req.params.modelId ?? ''));
      } catch {
        res.json({ temperature: null, source: null });
      }
    })();
  });


  /** §5.3 #12-1 — GET /api/permission-pending — 클라 재연결 때 대기 중인 권한 요청 복구용. */
  app.get('/api/permission-pending', (_req, res) => {
    try {
      res.json({ ok: true, pending: permissionBroker.listPending() });
    } catch (err) {
      logger.error('GET /api/permission-pending failed', err);
      res.status(500).json({ ok: false, pending: [] });
    }
  });

  /**
   * §5.3 #12-2 — POST /api/ask-user-question — PreToolUse 훅이 `tool_name === 'AskUserQuestion'` 에서 동기 호출.
   * 커스텀 에이전트면 broker 큐잉 → 사용자 응답 또는 60s 타임아웃까지 대기. 응답 `{ decision: 'answer' | 'timeout' | 'reject', selectedLabels: string[], note?: string }`.
   * 훅은 이 결과를 `permissionDecisionReason` 으로 합성해 모델 transcript 에 닿게 한다.
   */
  app.post('/api/ask-user-question', async (req, res) => {
    try {
      interface Body {
        sessionId?: string;
        subAgentId?: string;
        parentAgentId?: string;
        toolInput?: Record<string, unknown>;
      }
      const body = (req.body ?? {}) as Body;
      const rawInput = (body.toolInput ?? {}) as Partial<AskUserQuestionToolInput>;

      // 1) 관할 에이전트 resolve.
      let agentId: string | null = body.parentAgentId ?? null;
      if (!agentId && typeof body.sessionId === 'string') {
        agentId = graphManager.findAgentIdBySession(body.sessionId);
      }
      if (!agentId) {
        res.json({ ok: true, decision: 'reject', reason: 'not-managed', selectedLabels: [] });
        return;
      }

      // 2) 커스텀 에이전트 가드(view-only 제외) — §5.3 #12-1 과 같은 패턴.
      const agentNode = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
      if (!agentNode || !agentNode.customCreated) {
        res.json({ ok: true, decision: 'reject', reason: 'view-only-agent', selectedLabels: [] });
        return;
      }

      // 3) toolInput 유효성 — claude-code v2.1.145+ 스키마는 `questions: AskUserQuestionItem[]`. CLI 처럼 모든 질문을 차례로 — 한 카드에 step 으로 묶어 답한다.
      const questionsRaw = Array.isArray(rawInput.questions) ? rawInput.questions : [];
      const items: AskUserQuestionItem[] = questionsRaw
        .map((q): AskUserQuestionItem | null => {
          if (!q || typeof q !== 'object') return null;
          const qq = q as Partial<AskUserQuestionItem>;
          const question = typeof qq.question === 'string' ? qq.question : '';
          const optionsRaw = Array.isArray(qq.options) ? qq.options : [];
          const options: AskUserQuestionOption[] = optionsRaw
            .filter((o): o is AskUserQuestionOption => !!o && typeof (o as AskUserQuestionOption).label === 'string')
            .map((o) => ({
              label: o.label,
              description: typeof o.description === 'string' && o.description ? o.description : undefined,
            }))
            .slice(0, 4);
          if (!question || options.length === 0) return null;
          const item: AskUserQuestionItem = {
            question,
            multiSelect: qq.multiSelect === true,
            options,
          };
          if (typeof qq.header === 'string' && qq.header) item.header = qq.header;
          return item;
        })
        .filter((q): q is AskUserQuestionItem => q !== null);
      if (items.length === 0) {
        res.json({ ok: true, decision: 'reject', reason: 'invalid-input', answers: [] });
        return;
      }

      // 4) UI 메타 stamp.
      const config = graphManager.getAgentConfig(agentId);
      const agentLabel = agentNode.label ?? agentId;
      const agentColor = config?.color ?? BUBBLE_COLORS.agent;
      const projectName = graphManager.getAgentProjectName(agentId) ?? '';

      // §5.3 #12-1 — 훅 hold 중 "블록된 활성"으로 고정.
      graphManager.setPermissionWaiting(agentId, true);
      broadcastSnapshot();
      let decision: AskUserQuestionDecision;
      try {
        decision = await askUserQuestionBroker.request({
          agentId,
          subAgentId: typeof body.subAgentId === 'string' && body.subAgentId ? body.subAgentId : undefined,
          agentLabel,
          agentColor,
          projectName,
          items,
        });
      } finally {
        graphManager.setPermissionWaiting(agentId, false);
        broadcastSnapshot();
      }

      // 훅이 reason 합성에 사용할 수 있게 items 의 question 본문과 answers 를 함께 회신.
      // 모델 transcript 도달은 hook handler 에서 단일 reason 문자열로 포매팅.
      const answersOut = items.map((item, i) => {
        const ans = decision.answers[i];
        return {
          question: item.question,
          selectedLabels: ans?.selectedLabels ?? [],
          note: ans?.note,
        };
      });
      res.json({
        ok: true,
        decision: decision.reason === 'timeout' ? 'timeout' : 'answer',
        answers: answersOut,
      });
    } catch (err) {
      logger.error('POST /api/ask-user-question failed', err);
      res.status(500).json({ ok: false, decision: 'reject', reason: 'internal-error', selectedLabels: [] });
    }
  });

  /** §5.3 #12-2 — POST /api/ask-user-question/decide — 클라 IDE 카드의 Send. broker pending 해제. */
  app.post('/api/ask-user-question/decide', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AskUserQuestionDecision>;
      if (typeof body.requestId !== 'string' || !Array.isArray(body.answers)) {
        res.status(400).json({ ok: false, error: 'invalid payload' });
        return;
      }
      const answers: AskUserQuestionAnswer[] = body.answers
        .map((a) => {
          if (!a || typeof a !== 'object') return null;
          const aa = a as Partial<AskUserQuestionAnswer>;
          const labels = Array.isArray(aa.selectedLabels)
            ? aa.selectedLabels.filter((s): s is string => typeof s === 'string')
            : [];
          const ans: AskUserQuestionAnswer = { selectedLabels: labels };
          if (typeof aa.note === 'string' && aa.note) ans.note = aa.note;
          return ans;
        })
        .filter((a): a is AskUserQuestionAnswer => a !== null);
      const resolved = askUserQuestionBroker.resolve({
        requestId: body.requestId,
        answers,
        reason: 'user',
      });
      if (!resolved) {
        res.status(404).json({ ok: false, error: 'request not found (possibly timed out)' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/ask-user-question/decide failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** §5.3 #12-2 — GET /api/ask-user-question/pending — 클라 재연결 때 대기 중 질문 복구용. */
  app.get('/api/ask-user-question/pending', (_req, res) => {
    try {
      res.json({ ok: true, pending: askUserQuestionBroker.listPending() });
    } catch (err) {
      logger.error('GET /api/ask-user-question/pending failed', err);
      res.status(500).json({ ok: false, pending: [] });
    }
  });

  /**
   * §4 (CLI 사양 추종) — POST /api/agent-compact — `agentCanCompact` 를 켠 에이전트가 일하는 도중 "이제 접자"고 신고하는 창구.
   * 그 세션엔 자기 턴이 돌고 있어 바로 못 쏘므로 대기표에만 적고, 턴이 끝나는 자리에서 `maybeCompactAfterTurn` 이 큐에 `/compact` 를 얹는다(작업이 잘리지 않는다). Set 이라 여러 번 불러도 한 번.
   * 카드 5경로와 같은 loopback ingress(127.0.0.1 바인드 + 토큰)라 §10 의 'HTTP/REST API 외부 노출'이 아니다. 실패해도 에이전트 일에는 영향이 없다.
   */
  app.post('/api/agent-compact', (req, res) => {
    try {
      const body = (req.body ?? {}) as { agentId?: unknown; subAgentId?: unknown; reason?: unknown };
      const subAgentId = typeof body.subAgentId === 'string' ? body.subAgentId.trim() : '';
      if (!subAgentId) {
        res.status(400).json({ ok: false, error: 'subAgentId required' });
        return;
      }
      const sub = subAgentManager.getSub(subAgentId);
      if (!sub) {
        res.status(404).json({ ok: false, error: 'unknown subAgentId' });
        return;
      }
      // 켜지 않은 에이전트의 요청은 받지 않는다 — 안내를 안 실은 에이전트가 부를 리 없고,
      //   설정을 끈 뒤에도 듣고 있으면 "껐는데 압축된다"가 된다.
      const agentId = sub.parentAgentId;
      if (graphManager.getAgentConfig(agentId)?.agentCanCompact !== true) {
        res.status(409).json({ ok: false, error: 'agentCanCompact is off' });
        return;
      }
      compactRequestedSubs.add(subAgentId);
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : '';
      logger.info(`[turn-compact] requested by agent sub=${subAgentId}${reason ? ` reason="${reason}"` : ''}`);
      res.json({ ok: true, scheduled: 'end-of-turn' });
    } catch (err) {
      logger.error('POST /api/agent-compact failed', err);
      res.status(500).json({ ok: false });
    }
  });

  /**
   * §4 — POST /api/agent-report — 커스텀/스폰 에이전트가 작업 완료 때 did/userActions 를 구조화 신고(loopback curl, 토큰 인증).
   * 서버가 id/createdAt 을 찍어 ProjectGraph 에 적재·broadcast → IDE 가 색 구분 카드로 그린다. 표시 전용. Hook 에이전트는 신고 지시문이 없어 부르지 않는다.
   */
  app.post('/api/agent-report', subAgentBodyOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AgentReport>;
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      const toStrArray = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
      const did = toStrArray(body.did);
      const userActions = toStrArray(body.userActions);
      const nextSteps = toStrArray(body.nextSteps);
      // §5.10 — 에이전트가 신고에 담아 보낸 "배운 것"(교훈). Brain 개별 기억 카드로 저장(중복 검사 경유).
      const learned = toStrArray(body.learned).slice(0, 3).map((s) => s.trim());
      // §5.10 — 브리핑/주입으로 받은 카드 중 실제로 도움된 id(랭킹 "도움됨" 신호, markHelpful).
      const helpfulMemoryIds = toStrArray(body.helpfulMemoryIds).map((s) => s.trim());
      // §5.10 — 대칭 채널. 브리핑으로 받았지만 지금 코드와 어긋난 카드 id(재검증 1비트 회수).
      const staleMemoryIds = toStrArray(body.staleMemoryIds).map((s) => s.trim());
      // 내용이 전혀 없으면 무시 (빈 신고로 카드만 늘리지 않음)
      if (did.length === 0 && userActions.length === 0 && nextSteps.length === 0 && learned.length === 0) {
        res.status(400).json({ ok: false, error: 'empty report' });
        return;
      }
      const report: AgentReport = {
        id: randomUUID(),
        agentId: body.agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        did,
        userActions,
        ...(nextSteps.length > 0 ? { nextSteps } : {}),
        ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
        ...(learned.length > 0 ? { learned } : {}),
        ...(helpfulMemoryIds.length > 0 ? { helpfulMemoryIds } : {}),
        ...(staleMemoryIds.length > 0 ? { staleMemoryIds } : {}),
        createdAt: Date.now(),
      };
      const ok = graphManager.addAgentReport(report);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found' });
        return;
      }
      // §5.10 — 교훈(`learned`)·도움/낡음 신고는 신고 카드 안에 그대로 남는다 — 기억 카드 저장고는 폐기돼 그리로 옮겨 심지 않는다.
      broadcast({ type: 'agent_report', payload: { agentId: report.agentId, subAgentId: report.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, id: report.id });
    } catch (err) {
      logger.error('POST /api/agent-report failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 — POST /api/agent-questions — 커스텀/스폰 에이전트가 사용자에게 던지는 질문(1~N) + 제안 프롬프트 신고(loopback curl, 토큰 인증).
   * agent-report 와 같은 골격(id/createdAt 을 찍어 적재·broadcast → IDE 질문 카드). 표시 전용. Hook 에이전트는 지시문이 없어 부르지 않는다.
   */
  app.post('/api/agent-questions', subAgentBodyOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AgentQuestions>;
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      // items 정규화 — question 비어있는 항목 버림, prompts 는 비문자열/공백 제거.
      const rawItems = Array.isArray(body.items) ? body.items : [];
      const items: AgentQuestionItem[] = [];
      for (const it of rawItems) {
        if (!it || typeof it !== 'object') continue;
        const question = typeof it.question === 'string' ? it.question.trim() : '';
        if (!question) continue;
        const prompts = Array.isArray(it.prompts)
          ? it.prompts.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map((p) => p.trim())
          : [];
        items.push({
          question,
          ...(typeof it.header === 'string' && it.header.trim() ? { header: it.header.trim() } : {}),
          prompts,
        });
      }
      if (items.length === 0) {
        res.status(400).json({ ok: false, error: 'empty questions' });
        return;
      }
      const questions: AgentQuestions = {
        id: randomUUID(),
        agentId: body.agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        items,
        ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
        createdAt: Date.now(),
      };
      const ok = graphManager.addAgentQuestions(questions);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found' });
        return;
      }
      broadcast({ type: 'agent_questions', payload: { agentId: questions.agentId, subAgentId: questions.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, id: questions.id });
    } catch (err) {
      logger.error('POST /api/agent-questions failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 — POST /api/agent-review — 커스텀/스폰 에이전트가 맡은 작업을 끝낸 뒤 changes/checkpoints 검수 요청 신고(loopback curl, 토큰 인증). IDE 가 보라색 검수 카드로 그린다.
   * userActions("직접 해")와 성격이 다르다 — 이쪽은 AI 가 끝낸 결과의 검수다. agent-report/agent-questions 와 같은 골격.
   */
  app.post('/api/agent-review', subAgentBodyOwnerGuard((id) => subAgentManager.getSub(id)), (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AgentReview>;
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      const toStrArray = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()) : [];
      const changes = toStrArray(body.changes);
      const checkpoints = toStrArray(body.checkpoints);
      // changes 가 비면 검수 요청으로서 의미가 없으므로 무시 (빈 카드만 늘리지 않음).
      if (changes.length === 0) {
        res.status(400).json({ ok: false, error: 'empty review (changes required)' });
        return;
      }
      const review: AgentReview = {
        id: randomUUID(),
        agentId: body.agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        ...(typeof body.instruction === 'string' && body.instruction.trim() ? { instruction: body.instruction.trim() } : {}),
        changes,
        checkpoints,
        ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
        createdAt: Date.now(),
      };
      const ok = graphManager.addAgentReview(review);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found' });
        return;
      }
      broadcast({ type: 'agent_review', payload: { agentId: review.agentId, subAgentId: review.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, id: review.id });
    } catch (err) {
      logger.error('POST /api/agent-review failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** §4 — POST /api/agent-list — 커스텀/스폰 에이전트가 답변의 번호/순서 목록을 items 로 신고(loopback curl, 토큰 인증). 번호는 IDE 가 매기므로 항목 텍스트만 받는다. agent-report 와 같은 골격. */
  app.post('/api/agent-list', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AgentList>;
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      const items = Array.isArray(body.items)
        ? body.items.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
        : [];
      // items 가 비면 목록 카드로서 의미가 없으므로 무시 (빈 카드만 늘리지 않음).
      if (items.length === 0) {
        res.status(400).json({ ok: false, error: 'empty list (items required)' });
        return;
      }
      const list: AgentList = {
        id: randomUUID(),
        agentId: body.agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        ...(typeof body.title === 'string' && body.title.trim() ? { title: body.title.trim() } : {}),
        items,
        ...(typeof body.note === 'string' && body.note.trim() ? { note: body.note.trim() } : {}),
        createdAt: Date.now(),
      };
      const ok = graphManager.addAgentList(list);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found' });
        return;
      }
      broadcast({ type: 'agent_list', payload: { agentId: list.agentId, subAgentId: list.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, id: list.id });
    } catch (err) {
      logger.error('POST /api/agent-list failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 (CMD 터미널 업그레이드 ①) — POST /api/cmd-terminal-state — 임베디드 터미널 뷰가 감지한 상태(`working|idle|blocked`)를 올린다.
   * 판정·쓰기·전파는 서버가 한다(§3.1) — 클라는 바이트 흐름만 보고 신호를 보낸다. 훅이 없는 CLI(codex·gemini 등)도 이 경로로 상태가 보인다(⑧ 과 맞물린다).
   */
  app.post('/api/cmd-terminal-state', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<CmdTerminalSignal>;
      if (typeof body.termId !== 'string' || !body.termId) {
        res.status(400).json({ ok: false, error: 'termId required' });
        return;
      }
      if (body.state !== 'working' && body.state !== 'idle' && body.state !== 'blocked') {
        res.status(400).json({ ok: false, error: 'state must be working|idle|blocked' });
        return;
      }
      const changed = subAgentManager.applyCmdTerminalSignal({
        termId: body.termId,
        state: body.state,
        ...(typeof body.reason === 'string' && body.reason.trim() ? { reason: body.reason.trim() } : {}),
        ...(typeof body.foregroundProcess === 'string' && body.foregroundProcess.trim()
          ? { foregroundProcess: body.foregroundProcess.trim() }
          : {}),
      });
      if (changed) {
        broadcastSnapshot();
        // §4 (④) — blocked 로 **전이한 순간에만** 알린다(상태 에지 = 스팸 방지). 실제 알림은
        //   Electron 을 아는 desktop main 이 주입한 notifier 가 띄운다(§3.4 의존성 방향).
        const notifyEnabled = userDefaultsService.get().notifications?.cmdBlocked !== false;
        if (body.state === 'blocked' && notifyEnabled && cmdBlockedNotifier) {
          const sub = subAgentManager.findSubByTermId(body.termId);
          if (sub) {
            cmdBlockedNotifier({
              termId: body.termId,
              agentId: sub.parentAgentId,
              subAgentId: sub.id,
              label: sub.label,
              ...(sub.blockedReason ? { reason: sub.blockedReason } : {}),
            });
          }
        }
      }
      res.json({ ok: true, changed });
    } catch (err) {
      logger.error('POST /api/cmd-terminal-state failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 (CMD 터미널 업그레이드 ⑤) — PUT /api/cmd-pane-tree
   * 세션 탭의 pane 분할 트리를 저장한다. 그 탭의 표시 상태라 체크포인트에 그대로 실린다.
   * 신뢰할 수 없는 입력이므로 `sanitizeCmdPaneTree` 로 걸러 넣는다(개수·비율·중복 id 상한).
   */
  app.put('/api/cmd-pane-tree', (req, res) => {
    try {
      const body = (req.body ?? {}) as { subAgentId?: unknown; tree?: unknown };
      if (typeof body.subAgentId !== 'string' || !body.subAgentId) {
        res.status(400).json({ ok: false, error: 'subAgentId required' });
        return;
      }
      const tree = body.tree == null ? null : sanitizeCmdPaneTree(body.tree);
      const changed = subAgentManager.setCmdPaneTree(body.subAgentId, tree);
      if (changed) {
        broadcastSnapshot();
        saveCheckpoint();
      }
      res.json({ ok: true, changed, tree });
    } catch (err) {
      logger.error('PUT /api/cmd-pane-tree failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §5.5 #17-36 — PUT /api/session-memos — 그 화면(세션 탭 또는 메인 탭)의 스티키 메모 목록 전량을 저장한다(부분 갱신 ❌ — 한 필드만 보내면 나머지가 빈 값으로 강등된다).
   * `subAgentId` 가 오면 그 세션의 소지품(`SubAgent.memos`, 세션과 함께 사라짐), 없으면 메인 탭 → `ProjectGraph.agentMemos`.
   * 신뢰할 수 없는 입력이라 `sanitizeSessionMemos` 로 거른다(장수·크기·색·좌표 상한).
   */
  app.put('/api/session-memos', (req, res) => {
    try {
      const body = (req.body ?? {}) as { agentId?: unknown; subAgentId?: unknown; memos?: unknown };
      const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
      const subAgentId = typeof body.subAgentId === 'string' && body.subAgentId.trim()
        ? body.subAgentId.trim()
        : null;
      if (!agentId && !subAgentId) {
        res.status(400).json({ ok: false, error: 'agentId or subAgentId required' });
        return;
      }
      const memos = sanitizeSessionMemos(body.memos);
      let changed = false;
      if (subAgentId) {
        if (!subAgentManager.getSub(subAgentId)) {
          res.status(404).json({ ok: false, error: 'session not found' });
          return;
        }
        changed = subAgentManager.setSessionMemos(subAgentId, memos);
      } else {
        if (!graphManager.setAgentMemos(agentId, memos)) {
          // false 는 "안 바뀜"이거나 "그런 에이전트 없음" 둘 다 — 화면은 어느 쪽이든 낙관 표시를
          //   들고 있으므로 200 으로 돌려주고 changed=false 만 알린다(사용자 글을 잃지 않는다).
          res.json({ ok: true, changed: false, memos });
          return;
        }
        changed = true;
      }
      if (changed) {
        broadcastSnapshot();
        saveCheckpoint();
      }
      res.json({ ok: true, changed, memos });
    } catch (err) {
      logger.error('PUT /api/session-memos failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 (CMD 터미널 업그레이드 ⑥) — POST /api/cmd/send — 에이전트가 CMD 터미널에 prefill 한다.
   * **개행·Enter 는 절대 넣지 않는다**(`sendCmdTerminal` 이 걷어 낸다) — 사람이 Enter 를 치는 것이 §4 의 Anthropic ToS 합법선이다(herdr 의 `agent prompt --wait` 는 따라가지 않는다).
   */
  app.post('/api/cmd/send', (req, res) => {
    try {
      const body = (req.body ?? {}) as { termId?: unknown; text?: unknown };
      if (typeof body.termId !== 'string' || !isCmdTermId(body.termId)) {
        res.status(400).json({ ok: false, error: 'valid termId required' });
        return;
      }
      if (typeof body.text !== 'string' || !body.text) {
        res.status(400).json({ ok: false, error: 'text required' });
        return;
      }
      const out = sendCmdTerminal(body.termId, body.text);
      if (!out.ok) {
        res.status(404).json({ ok: false, error: out.error });
        return;
      }
      res.json({ ok: true, note: 'prefilled (no newline sent — the human presses Enter)' });
    } catch (err) {
      logger.error('POST /api/cmd/send failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** §4 (⑥) — GET /api/cmd/read?termId=…&lines=N — 그 터미널 최근 출력(ANSI 제거 평문). */
  app.get('/api/cmd/read', (req, res) => {
    try {
      const termId = typeof req.query['termId'] === 'string' ? req.query['termId'] : '';
      if (!isCmdTermId(termId)) {
        res.status(400).json({ ok: false, error: 'valid termId required' });
        return;
      }
      const lines = Number(req.query['lines'] ?? 200);
      const text = readCmdTerminal(termId, Number.isFinite(lines) ? lines : 200);
      if (text == null) {
        res.status(404).json({ ok: false, error: `no such terminal: ${termId}` });
        return;
      }
      res.json({ ok: true, termId, text });
    } catch (err) {
      logger.error('GET /api/cmd/read failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** §4 (⑥) — POST /api/cmd/wait — 출력에 문자열/정규식이 뜰 때까지 대기(상한 `CMD_WAIT_MAX_MS`). */
  app.post('/api/cmd/wait', (req, res) => {
    void (async () => {
      try {
        const body = (req.body ?? {}) as { termId?: unknown; match?: unknown; regex?: unknown; timeoutMs?: unknown };
        if (typeof body.termId !== 'string' || !isCmdTermId(body.termId)) {
          res.status(400).json({ ok: false, error: 'valid termId required' });
          return;
        }
        const out = await waitCmdTerminal(body.termId, {
          ...(typeof body.match === 'string' ? { match: body.match } : {}),
          ...(typeof body.regex === 'string' ? { regex: body.regex } : {}),
          ...(typeof body.timeoutMs === 'number' ? { timeoutMs: body.timeoutMs } : {}),
        });
        if (!out.ok) {
          res.status(400).json({ ok: false, error: out.error });
          return;
        }
        res.json(out);
      } catch (err) {
        logger.error('POST /api/cmd/wait failed', err);
        res.status(500).json({ ok: false, error: 'internal error' });
      }
    })();
  });

  /**
   * §7.11 — POST /api/agent-iframe — 커스텀/스폰 에이전트가 띄운 로컬 서버 URL 신고(loopback curl, 토큰 인증). 서버가 그 세션에 iframe 위성을 직접 만든다(정규식 추측 없이 결정론적).
   * isPortAlive 로 확인된 뒤에만 만든다(reportIframeFromAgent 가 boot race 재시도). 위성 키가 (세션,포트)라 같은 포트 재신고·감지 폴백과 하나로 합쳐진다.
   */
  app.post('/api/agent-iframe', (req, res) => {
    try {
      const body = (req.body ?? {}) as { agentId?: unknown; url?: unknown };
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      if (typeof body.url !== 'string' || !body.url.trim()) {
        res.status(400).json({ ok: false, error: 'url required' });
        return;
      }
      const ok = graphManager.reportAgentIframe(body.agentId, body.url.trim());
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found or invalid url' });
        return;
      }
      // 위성은 isPortAlive 확인 후 async 로 생기며, 그 시점 onSnapshotChange 가 broadcast 를 다시 친다.
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/agent-iframe failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 — POST /api/agent-feedback — IDE 에서 AI 작업 결과(작업 신고/검수 카드/스트림 result)에 남기는 좋아요/싫어요.
   * targetId 별 upsert — 재평가는 verdict 교체, `verdict:null` 은 철회. 렌더러 in-process fetch 라 loopback 토큰 화이트리스트 불필요. 표시·학습 보조 전용.
   */
  app.post('/api/agent-feedback', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<AgentFeedback> & { verdict?: AgentFeedbackVerdict | null };
      if (typeof body.agentId !== 'string' || !body.agentId) {
        res.status(400).json({ ok: false, error: 'agentId required' });
        return;
      }
      const targetTypes: AgentFeedbackTargetType[] = ['report', 'review', 'result'];
      const targetType = targetTypes.find((t) => t === body.targetType);
      if (!targetType || typeof body.targetId !== 'string' || !body.targetId) {
        res.status(400).json({ ok: false, error: 'targetType/targetId required' });
        return;
      }
      // verdict:null = 평가 철회 (해당 target 의 기존 피드백 제거)
      if (body.verdict == null) {
        const removed = graphManager.removeAgentFeedback(body.agentId, targetType, body.targetId);
        if (removed) {
          broadcast({ type: 'agent_feedback', payload: { agentId: body.agentId } } as WSMessage);
          broadcastSnapshot();
          saveCheckpoint();
        }
        res.json({ ok: true, removed });
        return;
      }
      if (body.verdict !== 'up' && body.verdict !== 'down') {
        res.status(400).json({ ok: false, error: 'verdict must be up/down/null' });
        return;
      }
      const summary = Array.isArray(body.summary)
        ? body.summary
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim().slice(0, AGENT_FEEDBACK_SUMMARY_ITEM_MAX))
            .slice(0, 5)
        : [];
      const feedback: AgentFeedback = {
        id: randomUUID(),
        agentId: body.agentId,
        ...(typeof body.subAgentId === 'string' && body.subAgentId ? { subAgentId: body.subAgentId } : {}),
        targetType,
        targetId: body.targetId,
        verdict: body.verdict,
        ...(typeof body.reason === 'string' && body.reason.trim() ? { reason: body.reason.trim() } : {}),
        summary,
        createdAt: Date.now(),
      };
      const ok = graphManager.setAgentFeedback(feedback);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'agent not found' });
        return;
      }
      broadcast({ type: 'agent_feedback', payload: { agentId: feedback.agentId, subAgentId: feedback.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, id: feedback.id });
    } catch (err) {
      logger.error('POST /api/agent-feedback failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §4 — POST /api/agent-feedback/:agentId/distill — 싫어요 피드백을 one-shot claude CLI(haiku)로 규칙 문장으로 증류해 제안만 돌려준다.
   * 적용은 사용자가 확인 모달에서 승인한 뒤 기존 `PUT /api/agent-config/:agentId` rules append 로(rulesHistory 롤백 가능). 자동 append 금지 — 일회성 싫어요가 영구 규칙이 되지 않게.
   */
  app.post('/api/agent-feedback/:agentId/distill', async (req, res) => {
    try {
      const agentId = req.params.agentId;
      const feedbacks = graphManager.getAgentFeedbacksForAgent(agentId);
      if (!feedbacks.some((f) => f.verdict === 'down')) {
        res.status(422).json({ ok: false, error: 'no down feedback to distill' });
        return;
      }
      const proposal = await distillFeedbackToRules(feedbacks);
      if (!proposal) {
        res.status(502).json({ ok: false, error: 'distill failed' });
        return;
      }
      res.json({ ok: true, proposal });
    } catch (err) {
      logger.error('POST /api/agent-feedback/:agentId/distill failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** GET /api/project-context — 프로젝트 컨텍스트 (프롬프트에 주입되는 것들) 조회 */
  app.get('/api/project-context', (_req, res) => {
    try {
      const root = findProjectRoot(process.cwd());
      const home = os.homedir();
      interface CtxItem { name: string; type: 'readable' | 'not_accessible'; summary?: string; lines?: number; path?: string }
      const items: CtxItem[] = [];

      // ─ Readable: CLAUDE.md (project)
      const claudeMd = path.join(root, 'CLAUDE.md');
      if (fs.existsSync(claudeMd)) {
        const content = fs.readFileSync(claudeMd, 'utf-8');
        const headings = content.split('\n').filter(l => l.startsWith('#')).slice(0, 8).map(h => h.replace(/^#+\s*/, ''));
        items.push({ name: 'CLAUDE.md', type: 'readable', summary: headings.join(' / '), lines: content.split('\n').length, path: claudeMd });
      }

      // ─ Readable: ~/.claude/CLAUDE.md (user-level)
      const userClaudeMd = path.join(home, '.claude', 'CLAUDE.md');
      if (fs.existsSync(userClaudeMd)) {
        const content = fs.readFileSync(userClaudeMd, 'utf-8');
        items.push({ name: '~/.claude/CLAUDE.md', type: 'readable', summary: `User-level instructions (${content.split('\n').length} lines)`, lines: content.split('\n').length, path: userClaudeMd });
      }

      // ─ Readable: .claude/settings.local.json (project settings)
      const projSettings = path.join(root, '.claude', 'settings.local.json');
      if (fs.existsSync(projSettings)) {
        try {
          const data = JSON.parse(fs.readFileSync(projSettings, 'utf-8')) as Record<string, unknown>;
          const keys = Object.keys(data);
          const hookCount = data['hooks'] && typeof data['hooks'] === 'object' ? Object.keys(data['hooks'] as object).length : 0;
          items.push({ name: '.claude/settings.local.json', type: 'readable', summary: `Keys: ${keys.join(', ')}${hookCount > 0 ? ` (${hookCount} hook events)` : ''}`, path: projSettings });
        } catch { items.push({ name: '.claude/settings.local.json', type: 'readable', summary: 'Parse error', path: projSettings }); }
      }

      // ─ Readable: ~/.claude/settings.json (global settings)
      const globalSettings = path.join(home, '.claude', 'settings.json');
      if (fs.existsSync(globalSettings)) {
        try {
          const data = JSON.parse(fs.readFileSync(globalSettings, 'utf-8')) as Record<string, unknown>;
          const hookCount = data['hooks'] && typeof data['hooks'] === 'object' ? Object.keys(data['hooks'] as object).length : 0;
          items.push({ name: '~/.claude/settings.json', type: 'readable', summary: `Global settings${hookCount > 0 ? ` (${hookCount} hook events)` : ''}`, path: globalSettings });
        } catch { items.push({ name: '~/.claude/settings.json', type: 'readable', summary: 'Parse error', path: globalSettings }); }
      }

      // ─ Readable: Agent definitions
      const agentsDir = path.join(root, '.claude', 'agents');
      if (fs.existsSync(agentsDir)) {
        const agents = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));
        items.push({ name: '.claude/agents/', type: 'readable', summary: `${agents.length} agents: ${agents.map(f => f.replace('.md', '')).join(', ')}`, path: agentsDir });
      }

      // ─ Readable: Memory
      const memGlob = path.join(home, '.claude', 'projects');
      const memoryMd = findMemoryMd(memGlob, root);
      if (memoryMd) {
        const content = fs.readFileSync(memoryMd, 'utf-8');
        const entries = content.split('\n').filter(l => l.trim().startsWith('- [')).length;
        items.push({ name: 'MEMORY.md', type: 'readable', summary: `${entries} memory entries`, lines: content.split('\n').length, path: memoryMd });
      }

      // ─ Readable: Skills
      const skillsDir = path.join(root, '.claude', 'skills');
      if (fs.existsSync(skillsDir)) {
        const skills = fs.readdirSync(skillsDir).filter(f => fs.existsSync(path.join(skillsDir, f, 'SKILL.md')));
        if (skills.length > 0) {
          items.push({ name: '.claude/skills/', type: 'readable', summary: `${skills.length} skills: ${skills.join(', ')}`, path: skillsDir });
        }
      }

      // ─ Not accessible (Claude Code internal)
      items.push({ name: 'Built-in system prompt', type: 'not_accessible', summary: 'Claude Code core instructions, tool definitions, safety rules. Not readable from outside.' });
      items.push({ name: 'IDE context', type: 'not_accessible', summary: 'Open files, cursor position, selected text, workspace state.' });
      items.push({ name: 'Git status snapshot', type: 'not_accessible', summary: 'Branch, uncommitted changes, recent commits — injected at session start.' });
      items.push({ name: 'Conversation history', type: 'not_accessible', summary: 'All prior messages in the current session, compressed when nearing context limit.' });
      items.push({ name: 'Deferred tools list', type: 'not_accessible', summary: 'Available tools and MCP server tools registered in the session.' });
      items.push({ name: 'Model capabilities', type: 'not_accessible', summary: 'Active model ID, context window size, available features.' });

      res.json({ ok: true, items });
    } catch (err) {
      logger.error('GET /api/project-context failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** MEMORY.md를 프로젝트별 경로에서 찾는 헬퍼 */
  function findMemoryMd(projectsBase: string, projectRoot: string): string | null {
    if (!fs.existsSync(projectsBase)) return null;
    // .claude/projects/ 아래에서 현재 프로젝트에 매칭되는 디렉토리 탐색
    try {
      const dirs = fs.readdirSync(projectsBase);
      for (const d of dirs) {
        const memDir = path.join(projectsBase, d, 'memory', 'MEMORY.md');
        if (fs.existsSync(memDir)) {
          // 디렉토리 이름에 프로젝트 경로가 인코딩되어 있는지 확인.
          // 슬러그 대조는 **대소문자를 실제로 무시하는 FS 에서만** 접는다 — linux 에서 접으면
          // 케이스만 다른 다른 프로젝트의 MEMORY.md 를 집어 든다.
          const slug = projectRoot.replace(/[/\\:]/g, '-');
          const dKey = CASE_INSENSITIVE_FS ? d.toLowerCase() : d;
          const slugKey = CASE_INSENSITIVE_FS ? slug.toLowerCase() : slug;
          if (d.toLowerCase().includes('vibisual') || dKey.includes(slugKey)) {
            return memDir;
          }
        }
      }
      // fallback: 첫 번째 발견된 MEMORY.md
      for (const d of dirs) {
        const memDir = path.join(projectsBase, d, 'memory', 'MEMORY.md');
        if (fs.existsSync(memDir)) return memDir;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** POST /api/open-context-path — 프로젝트 컨텍스트 파일/폴더 열기 */
  app.post('/api/open-context-path', (req, res) => {
    try {
      const { filePath, mode } = req.body as { filePath?: string; mode?: string };
      if (typeof filePath !== 'string') { res.status(400).json({ error: 'filePath required' }); return; }
      // 컨텍스트 파일은 프로젝트 루트 또는 홈 `~/.claude`(CLAUDE.md·settings·memory 등) 내부만 허용.
      // project-context 가 노출하는 경로 집합과 일치 — 임의 절대경로 열기 차단(모바일 페어링 기기 포함).
      const resolved = path.resolve(filePath);
      if (!isWithinOpenableRoots(resolved, [path.join(os.homedir(), '.claude')])) {
        logger.warn(`open-context-path blocked (outside allowed roots): "${filePath}"`);
        res.status(403).json({ error: 'Path outside allowed roots' });
        return;
      }
      if (!fs.existsSync(resolved)) { res.status(404).json({ error: 'Path not found' }); return; }
      if (mode === 'folder') {
        const dir = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
        openFolder(dir);
      } else {
        openFile(resolved);
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/open-context-path failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/bubble/:nodeId/position — 버블 위치 저장 (드래그 후) */
  app.patch('/api/bubble/:nodeId/position', (req, res) => {
    try {
      const { nodeId } = req.params;
      const { x, y } = req.body as { x?: number; y?: number };
      if (typeof x !== 'number' || typeof y !== 'number') {
        res.status(400).json({ error: 'x and y required' });
        return;
      }
      graphManager.updateBubblePosition(nodeId, x, y);
      saveCheckpoint();
      broadcastSnapshot();
      res.json({ ok: true });
    } catch (err) {
      logger.error('PATCH /api/bubble/position failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** 물리 엔진 위치 일괄 저장 (PATCH + POST — sendBeacon은 POST만 지원) */
  function handleBatchPositions(req: import('express').Request, res: import('express').Response): void {
    try {
      const { positions } = req.body as { positions?: Array<{ id: string; x: number; y: number }> };
      if (!Array.isArray(positions)) {
        res.status(400).json({ error: 'positions array required' });
        return;
      }
      graphManager.updateBubblePositionsBatch(positions);
      saveCheckpoint();
      logger.info(`Batch positions saved: ${positions.length} nodes`);
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      res.json({ ok: true });
    } catch (err) {
      logger.error('batch positions save failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
  app.patch('/api/bubbles/positions', handleBatchPositions);
  app.post('/api/bubbles/positions', handleBatchPositions);

  /** DELETE /api/bubble/:nodeId — 버블 삭제 (에이전트가 다시 사용하면 재생성) */
  app.delete('/api/bubble/:nodeId', (req, res) => {
    try {
      const { nodeId } = req.params;
      logger.info(`DELETE /api/bubble/${nodeId}`);
      if (!nodeId) {
        res.status(400).json({ error: 'nodeId required' });
        return;
      }
      // preserve-pin 가드(§2.4)
      if (graphManager.isPreservePinned(nodeId)) {
        logger.info(`DELETE /api/bubble/${nodeId} blocked: preserve-pinned`);
        res.status(409).json({ error: 'bubble preserved', reason: 'preserve-pinned' });
        return;
      }
      // §5.10 — 커스텀 에이전트 삭제는 즉시 소멸 대신 휴지통 이동(identity 보존, 묘비 ❌).
      //   휴지통 이동에 성공하면 removeBubble 로 내려가지 않는다(영구 삭제는 /api/trash/agent).
      if (graphManager.tryTrashCustomAgentByBubbleId(nodeId)) {
        broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
        saveCheckpoint();
        res.json({ ok: true, trashed: true });
        return;
      }
      // 사용자가 지운 버블이 에이전트면 그 Task Edge 까지 cascade 제거(고아 방지).
      graphManager.removeBubble(nodeId, { purgeTaskEdges: true });
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /api/bubble failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/bubbles/delete — 버블 일괄 삭제 (Shift 다중 선택 → 한 번의 스냅샷으로 동시 제거) */
  app.post('/api/bubbles/delete', (req, res) => {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids array required' });
        return;
      }
      const deleted: string[] = [];
      const blocked: string[] = [];
      for (const nodeId of ids) {
        if (!nodeId) continue;
        // preserve-pin 가드(§2.4) — 막힌 건 건너뛰고 나머지는 계속 삭제
        if (graphManager.isPreservePinned(nodeId)) {
          blocked.push(nodeId);
          continue;
        }
        // §5.10 — 커스텀 에이전트는 즉시 소멸 대신 휴지통 이동.
        if (graphManager.tryTrashCustomAgentByBubbleId(nodeId)) {
          deleted.push(nodeId);
          continue;
        }
        // 일괄 삭제도 에이전트면 Task Edge 까지 cascade 제거.
        graphManager.removeBubble(nodeId, { purgeTaskEdges: true });
        deleted.push(nodeId);
      }
      logger.info(`POST /api/bubbles/delete — removed ${deleted.length}, blocked ${blocked.length}`);
      // 한 번만 스냅샷 브로드캐스트 → 클라이언트가 선택 버블을 동시에 제거
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ ok: true, deleted, blocked });
    } catch (err) {
      logger.error('POST /api/bubbles/delete failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/bubble/:nodeId/preserve-pin — preserve-pin 토글(§2.4) */
  app.patch('/api/bubble/:nodeId/preserve-pin', (req, res) => {
    try {
      const { nodeId } = req.params;
      if (!nodeId) {
        res.status(400).json({ error: 'nodeId required' });
        return;
      }
      const next = graphManager.togglePreservePinned(nodeId);
      if (next === null) {
        res.status(404).json({ error: 'Bubble not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, preservePinned: next });
    } catch (err) {
      logger.error('PATCH /api/bubble/preserve-pin failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/bubble/:nodeId/form — §5.4 #36 (A) 커스텀 에이전트의 캔버스 형태(말풍선 ↔ 버블).
   * 대상이 아니면(훅·CMD·버려진 에이전트) 409, 없으면 404. 형태는 에이전트 노드째 체크포인트에 실린다.
   */
  app.patch('/api/bubble/:nodeId/form', (req, res) => {
    try {
      const { nodeId } = req.params;
      const form = (req.body as { form?: unknown } | undefined)?.form;
      if (!nodeId || (form !== 'card' && form !== 'bubble')) {
        res.status(400).json({ error: 'nodeId and form(card|bubble) required' });
        return;
      }
      const result = graphManager.setAgentForm(nodeId, form);
      if (!result.ok) {
        res.status(result.reason === 'not-found' ? 404 : 409).json({ error: result.reason });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, form: result.form });
    } catch (err) {
      logger.error('PATCH /api/bubble/form failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/bubble/:nodeId/link-view — §5.4 #36 (H) 에이전트의 연결 보기.
   * `{hidden?: boolean, bubblesHidden?: boolean, lens?: 'linked'|'files'}` — 준 칸만 바꾼다. 유효한 칸이 없으면 400,
   * 에이전트가 아니면 409, 없으면 404. 표시 형태라 에이전트 노드째 체크포인트에 실린다(`/form` 과 같다).
   */
  app.patch('/api/bubble/:nodeId/link-view', (req, res) => {
    try {
      const { nodeId } = req.params;
      const body = (req.body ?? {}) as { hidden?: unknown; bubblesHidden?: unknown; lens?: unknown };
      const patch: { hidden?: boolean; bubblesHidden?: boolean; lens?: 'linked' | 'files' } = {};
      if (typeof body.hidden === 'boolean') patch.hidden = body.hidden;
      if (typeof body.bubblesHidden === 'boolean') patch.bubblesHidden = body.bubblesHidden;
      if (body.lens === 'linked' || body.lens === 'files') patch.lens = body.lens;
      if (!nodeId || (patch.hidden === undefined && patch.bubblesHidden === undefined && patch.lens === undefined)) {
        res.status(400).json({ error: 'nodeId and hidden(boolean), bubblesHidden(boolean) or lens(linked|files) required' });
        return;
      }
      const result = graphManager.setAgentLinkView(nodeId, patch);
      if (!result.ok) {
        res.status(result.reason === 'not-found' ? 404 : 409).json({ error: result.reason });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, linksHidden: result.linksHidden, linkLens: result.linkLens });
    } catch (err) {
      logger.error('PATCH /api/bubble/link-view failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/bubble/:nodeId/link-pin — §5.4 #36 (H) ①-2 에이전트의 연결된 버블 고정.
   * `{pinned: boolean}`. 고정한 동안 확인 dismiss·자동 유휴·5분 TTL 이 그 에이전트의 연결을 걷지 않는다. 풀 때 실행 중이
   * 아니면 **같은 호출 안에서** 걷는다(확인 dismiss 와 같은 걷기 · 에이전트 상태는 그대로). 에이전트가 아니면 409, 없으면 404.
   */
  app.patch('/api/bubble/:nodeId/link-pin', (req, res) => {
    try {
      const { nodeId } = req.params;
      const pinned = (req.body as { pinned?: unknown } | undefined)?.pinned;
      if (!nodeId || typeof pinned !== 'boolean') {
        res.status(400).json({ error: 'nodeId and pinned(boolean) required' });
        return;
      }
      const result = graphManager.setAgentLinksPinned(nodeId, pinned);
      if (!result.ok) {
        res.status(result.reason === 'not-found' ? 404 : 409).json({ error: result.reason });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, linksPinned: result.linksPinned, purged: result.purged.length });
    } catch (err) {
      logger.error('PATCH /api/bubble/link-pin failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/bubble/:nodeId/link-replay — §5.4 #36 (H) ①-2 [이전 연결 다시 보기].
   * 마지막으로 걷힌 연결을 훅 이벤트와 같은 라우팅으로 다시 세우고 다음 확인 클릭까지 붙든다.
   * 실행 중이면 409 `running`, 기억한 연결이 없으면 409 `empty`, 에이전트가 아니면 409, 없으면 404.
   */
  app.post('/api/bubble/:nodeId/link-replay', (req, res) => {
    try {
      const { nodeId } = req.params;
      if (!nodeId) {
        res.status(400).json({ error: 'nodeId required' });
        return;
      }
      const result = graphManager.replayAgentLinks(nodeId);
      if (!result.ok) {
        res.status(result.reason === 'not-found' ? 404 : 409).json({ error: result.reason });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, restored: result.restored });
    } catch (err) {
      logger.error('POST /api/bubble/link-replay failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/bubble/:nodeId/disappear-pause — 소멸 중단/재개 토글 */
  app.patch('/api/bubble/:nodeId/disappear-pause', (req, res) => {
    try {
      const { nodeId } = req.params;
      if (!nodeId) {
        res.status(400).json({ error: 'nodeId required' });
        return;
      }
      const paused = graphManager.toggleDisappearPause(nodeId, 60);
      if (paused === null) {
        res.status(404).json({ error: 'Bubble not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, paused });
    } catch (err) {
      logger.error('PATCH /api/bubble/disappear-pause failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/bubble/:nodeId/disappear — 버블을 disappearing 상태로 전환 */
  app.patch('/api/bubble/:nodeId/disappear', (req, res) => {
    try {
      const { nodeId } = req.params;
      const { duration } = req.body as { duration?: number };
      if (!nodeId) {
        res.status(400).json({ error: 'nodeId required' });
        return;
      }
      graphManager.setDisappear(nodeId, duration ?? 60);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('PATCH /api/bubble/disappear failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/folder-files — §7.5 폴더 목록: 디렉터리 한 겹의 한 페이지(`FolderFilePage`). 통째 재귀는 홈 폴더 버블에서 메인 프로세스를 세워 창이 "응답 없음"이 된다.
   * `?nodePath=<폴더 노드 키>` + `relPath`(그 아래 펼친 자리)·`cursor`(이전 응답의 `nextCursor`)·`limit`(장당 개수).
   * `absolutePath` 를 주면 그것으로 프로젝트 인스턴스를 먼저 찍는다 — 노드 키가 루트 기준 상대 경로라 `docs` 같은 흔한 이름은 다른 프로젝트가 먼저 답한다(`open-node-file` 과 같은 규약).
   * 창구를 나누지 않고 페이지화한 것은 인스턴스 라우팅·위성 매칭 규약을 두 벌로 만들지 않기 위함이다.
   */
  app.get('/api/folder-files', (req, res) => {
    try {
      const nodePath = req.query['nodePath'];
      if (typeof nodePath !== 'string') {
        res.status(400).json({ error: 'nodePath query required' });
        return;
      }
      const absHint = req.query['absolutePath'];
      const subPath = req.query['relPath'];
      const cursor = req.query['cursor'];
      const rawLimit = req.query['limit'];
      const limit = typeof rawLimit === 'string' ? Number.parseInt(rawLimit, 10) : NaN;
      const page = graphManager.listFolderFilePage(
        nodePath,
        typeof absHint === 'string' ? absHint : null,
        {
          subPath: typeof subPath === 'string' ? subPath : null,
          cursor: typeof cursor === 'string' ? cursor : null,
          ...(Number.isFinite(limit) ? { limit } : {}),
        },
      );
      if (!page) {
        res.status(404).json({ error: 'Folder not found' });
        return;
      }
      res.json(page);
    } catch (err) {
      logger.error('GET /api/folder-files failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/workspace-dir — §5.5 #17-19 IDE 탐색기: 디렉터리 한 겹 조회.
   * `root` 는 클라가 아는 프로젝트 루트를 그대로 받고(`open-node-file` 의 `absolutePath` 와 같은 규약) 등록된 루트 안인지 여기서 검사한다. `..` 는 `listWorkspaceDir` 이 한 번 더 막는다. 조회 전용 — broadcast·checkpoint 없음.
   */
  app.get('/api/workspace-dir', (req, res) => {
    try {
      const root = req.query['root'];
      const relPath = req.query['path'] ?? '';
      if (typeof root !== 'string' || root.length === 0 || typeof relPath !== 'string') {
        res.status(400).json({ error: 'root query required' });
        return;
      }

      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`workspace-dir blocked (outside project root): "${root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const listing = listWorkspaceDir(resolvedRoot, relPath);
      if (!listing) {
        res.status(404).json({ error: 'Directory not found' });
        return;
      }
      res.json(listing);
    } catch (err) {
      logger.error('GET /api/workspace-dir failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/workspace-find — §5.5 #17-27 ⑱ 판 쪽에서 그 갈래의 파일을 찾는다.
   * `?root=<절대경로>&kind=code|html|image|pdf&claimed=<.확장자,…>` → `WorkspaceFindResult`(파일만 · 최근 고친 순 · 상한이면 `truncated`). `claimed` 는 앱이 받겠다는 확장자(등록표가 화면에 있어 화면이 보낸다) — 판정은 서버도 같은 `isEditorPaneListable`.
   * 가드는 탐색기와 같은 `isWithinOpenableRoots` + `resolveWorkspacePath`(새 가드 ❌). 조회 전용 · loopback 화이트리스트 밖(렌더러 전용). 걷기는 비동기라 창을 세우지 않는다.
   */
  app.get(WORKSPACE_FIND_PATH, async (req, res) => {
    try {
      const root = req.query['root'];
      const kind = req.query['kind'];
      if (typeof root !== 'string' || root.length === 0) {
        res.status(400).json({ error: 'root query required' });
        return;
      }
      if (!isEditorPaneFileKind(kind)) {
        res.status(400).json({ error: 'kind must be one of code, html, image, pdf' });
        return;
      }

      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`workspace-find blocked (outside project root): "${root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const found = await findWorkspaceFiles(resolvedRoot, kind, parseClaimedExtensions(req.query['claimed']));
      if (!found) {
        res.status(404).json({ error: 'Directory not found' });
        return;
      }
      res.json(found);
    } catch (err) {
      logger.error('GET /api/workspace-find failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/workspace-path — §5.5 #17-27 ⑬ 스트림 본문의 경로 하나의 정체.
   * `?root=<절대경로>&path=<상대경로>` → `{ root, path, absPath, kind: 'file' | 'directory' }`. 없으면 404 — 화면은 평범한 인라인 코드로 둔다(가짜 손잡이 ❌).
   * 가드는 탐색기와 같은 `isWithinOpenableRoots` + `resolveWorkspacePath`. 조회 전용.
   */
  app.get('/api/workspace-path', (req, res) => {
    try {
      const root = req.query['root'];
      const relPath = req.query['path'] ?? '';
      if (typeof root !== 'string' || root.length === 0 || typeof relPath !== 'string') {
        res.status(400).json({ error: 'root query required' });
        return;
      }

      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        // 본문에 박힌 경로는 사용자가 고른 것이 아니라 에이전트가 적은 것이라, 루트 밖 요청도 정상 흐름이다
        // (화면이 조용히 평문으로 둔다) — 경고 로그로 남기지 않는다.
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const info = statWorkspacePath(resolvedRoot, relPath);
      if (!info) {
        res.status(404).json({ error: 'Path not found' });
        return;
      }
      res.json(info);
    } catch (err) {
      logger.error('GET /api/workspace-path failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/external-path — §5.5 #17-27 ⑬ (d) 프로젝트 루트 밖 경로의 존재·정체. `?path=<절대경로>` → `{ absPath, kind: 'file' | 'directory' }`, 없으면 404(화면은 평문 인라인 코드로 둔다).
   * `isWithinOpenableRoots` 를 쓰지 않는다(루트 밖이 전제) — 경계는 누가 닿는가다: loopback 화이트리스트에 올리지 않으므로 외부 `claude` 는 404, 페어링 기기는 채팅 명령 파서로만 들어온다 → 렌더러만 부른다(§3.7).
   * 답에 `executable` 이 없는 것은 설계다 — 루트 밖은 탐색기 한 갈래로만 가고, 실행 여부를 알려 주면 갈래가 는다. 조회 전용.
   */
  app.get('/api/external-path', (req, res) => {
    try {
      const abs = req.query['path'];
      if (typeof abs !== 'string' || abs.length === 0) {
        res.status(400).json({ error: 'path query required' });
        return;
      }

      const info = statExternalPath(abs);
      if (!info) {
        res.status(404).json({ error: 'Path not found' });
        return;
      }
      res.json(info);
    } catch (err) {
      logger.error('GET /api/external-path failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/reveal-path — §5.5 #17-27 ⑬ (d) 루트 밖 경로를 시스템 탐색기에 보여준다.
   * 실행부는 기존 `editorLauncher.openFolder` 하나(새 열기 레일 ❌) — Windows `explorer /select` + 포그라운드 보정, macOS `open -R`, Linux FileManager1. 파일이면 상위 폴더에서 그 파일을 선택(미지원이면 폴더 열기). 여기서는 있는지만 한 번 더 본다.
   * 경계는 `GET /api/external-path` 와 같다(렌더러만). 여는 갈래를 늘리지 않는다 — 연결 프로그램(`openWithDefaultApp`)·실행(`startRun`)으로 가지 않는다(본문 글자를 눌러 임의 경로가 실행되면 안 된다).
   */
  app.post('/api/reveal-path', (req, res) => {
    try {
      const { absPath } = req.body as { absPath?: string };
      if (typeof absPath !== 'string' || absPath.length === 0) {
        res.status(400).json({ error: 'absPath required' });
        return;
      }

      // 있는 것만 연다 — 없는 경로를 넘기면 탐색기가 제 나름의 오류 창을 띄우는데,
      // 그 창은 우리가 문구도 위치도 통제할 수 없다.
      const info = statExternalPath(absPath);
      if (!info) {
        res.status(404).json({ error: 'Path not found' });
        return;
      }

      openFolder(info.absPath);
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/reveal-path failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/workspace-file — §5.5 #17-27 IDE 내장 편집창: 파일 한 개 읽기. 가드는 탐색기와 같은 `isWithinOpenableRoots` + `resolveWorkspacePath`.
   * §5.5 #17-27 ⑥ — 루트 밖이라도 그 파일이 지금 버블로 떠 있으면 읽기만 연다(`outside: true`, 판정은 `resolveWorkspaceFileRead` 한 곳) — 캔버스 파일 버블 더블클릭이 이 편집창으로 연다(§5.1 #2-1 (A)).
   * 쓰기(PUT)는 루트 안만. 조회 전용 — broadcast·checkpoint 없음.
   */
  app.get('/api/workspace-file', (req, res) => {
    try {
      const root = req.query['root'];
      const relPath = req.query['path'];
      if (typeof root !== 'string' || root.length === 0 || typeof relPath !== 'string' || relPath.length === 0) {
        res.status(400).json({ error: 'root and path query required' });
        return;
      }

      const resolvedRoot = path.resolve(root);
      const read = resolveWorkspaceFileRead(root, relPath, {
        isOpenableRoot: (r) => isWithinOpenableRoots(r),
        isBubblePath: (absPath) => graphManager.hasNodeAbsolutePath(absPath),
      });
      if (!read) {
        logger.warn(`workspace-file blocked (not a project root / known bubble path): "${root}" "${relPath}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const file = readWorkspaceFile(resolvedRoot, relPath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      res.json(read.outside ? { ...file, outside: true } : file);
    } catch (err) {
      logger.error('GET /api/workspace-file failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/workspace-file — §5.5 #17-27 IDE 내장 편집창: 파일 한 개 저장.
   * `baseMtimeMs` 는 읽을 때 본 수정 시각 — 그 사이 디스크가 바뀌었으면 409(에이전트가 고친 내용을 조용히 덮어쓰지 않게). "그래도 저장"이면 `baseMtimeMs: 0` 으로 다시 온다.
   * 사용자 소스 파일이라 §3.2.1 체크포인트 창구가 아닌 평범한 쓰기이고 broadcast 도 없다.
   * §5.5 #17-27 ⑫ — 디스크가 잠근 파일(Perforce 체크아웃 전 등)은 423, [읽기 전용 해제하고 저장]이면 `clearReadOnly: true` 로 다시 온다.
   */
  app.put('/api/workspace-file', (req, res) => {
    try {
      const { root, path: relPath, text, eol, baseMtimeMs, baseRevision, clearReadOnly } = req.body as {
        root?: string; path?: string; text?: string; eol?: string; baseMtimeMs?: number; baseRevision?: string; clearReadOnly?: boolean;
      };
      if (typeof root !== 'string' || root.length === 0 || typeof relPath !== 'string' || relPath.length === 0) {
        res.status(400).json({ error: 'root and path required' });
        return;
      }
      if (typeof text !== 'string') {
        res.status(400).json({ error: 'text required' });
        return;
      }

      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`workspace-file write blocked (outside project root): "${root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const outcome = writeWorkspaceFile(
        resolvedRoot,
        relPath,
        text,
        eol === 'crlf' ? 'crlf' : 'lf',
        typeof baseMtimeMs === 'number' ? baseMtimeMs : 0,
        undefined,
        clearReadOnly === true,
        typeof baseRevision === 'string' ? baseRevision : undefined,
      );
      if (outcome.ok) {
        res.json(outcome.result);
        return;
      }
      const status = outcome.error === 'outside' ? 403
        : outcome.error === 'not-found' ? 404
        : outcome.error === 'conflict' ? 409
        : outcome.error === 'too-large' ? 413
        // ⑫ 423 Locked — 디스크가 잠근 파일(Perforce 등). 화면이 [읽기 전용 해제하고 저장]을 띄운다.
        : outcome.error === 'readonly' ? 423
        : 500;
      res.status(status).json({ error: outcome.error, mtimeMs: outcome.mtimeMs });
    } catch (err) {
      logger.error('PUT /api/workspace-file failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/workspace-image — §5.5 #17-27 ⑭ IDE 내장 편집창: 이미지 한 장의 원본 바이트(JSON 이 아니라 바이트라 텍스트 창구와 가른다).
   * 가드는 같은 `isWithinOpenableRoots` + `resolveWorkspacePath`. §5.5 #17-27 ⑥ — 루트 밖이라도 그 파일이 버블로 떠 있으면 읽기만 연다(`resolveWorkspaceFileRead`). 덮어쓰기(PUT)는 루트 안만.
   * 캐시하지 않는다 — 주석을 저장하면 같은 URL 의 내용만 바뀌어, 캐시가 남으면 방금 그린 표시가 안 나타난다.
   */
  app.get('/api/workspace-image', (req, res) => {
    try {
      const root = req.query['root'];
      const relPath = req.query['path'];
      if (typeof root !== 'string' || root.length === 0 || typeof relPath !== 'string' || relPath.length === 0) {
        res.status(400).json({ error: 'root and path query required' });
        return;
      }

      const resolvedRoot = path.resolve(root);
      const read = resolveWorkspaceFileRead(root, relPath, {
        isOpenableRoot: (r) => isWithinOpenableRoots(r),
        isBubblePath: (absPath) => graphManager.hasNodeAbsolutePath(absPath),
      });
      if (!read) {
        logger.warn(`workspace-image blocked (not a project root / known bubble path): "${root}" "${relPath}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const image = readWorkspaceImage(resolvedRoot, relPath);
      if (!image) {
        res.status(404).json({ error: 'Image not found' });
        return;
      }
      res.setHeader('Content-Type', image.mime);
      res.setHeader('X-Workspace-Revision', image.revision);
      res.setHeader('X-Workspace-Mtime', String(image.mtimeMs));
      res.setHeader('Cache-Control', 'no-store');
      res.end(image.bytes);
    } catch (err) {
      logger.error('GET /api/workspace-image failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/workspace-image — §5.5 #17-25 ④-1 라이트박스 주석본으로 그 이미지 파일을 덮어쓴다.
   * 본문은 이미지 바이트 그대로, 나머지는 쿼리 — base64 는 33% 를 부풀리고 전역 `express.json()` 상한(100kb)에 스크린샷 한 장이 걸린다. 그래서 이 라우트에만 `express.raw` 를 물린다(전역 상한은 낮추지 않는다).
   * 덮어쓰기 규율은 `PUT /api/workspace-file` 과 같다(`mtimeMs` 가 다르면 409, [그래도 저장]은 `baseMtimeMs=0`). 굽지 못하는 형식(svg·gif·ico·bmp·avif)은 415.
   */
  app.put(
    '/api/workspace-image',
    express.raw({ type: () => true, limit: WORKSPACE_IMAGE_MAX_BYTES }),
    (req, res) => {
      try {
        const root = req.query['root'];
        const relPath = req.query['path'];
        if (typeof root !== 'string' || root.length === 0 || typeof relPath !== 'string' || relPath.length === 0) {
          res.status(400).json({ error: 'root and path query required' });
          return;
        }
        const bytes = req.body;
        if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
          res.status(400).json({ error: 'image body required' });
          return;
        }

        const resolvedRoot = path.resolve(root);
        if (!isWithinOpenableRoots(resolvedRoot)) {
          logger.warn(`workspace-image write blocked (outside project root): "${root}"`);
          res.status(403).json({ error: 'Path outside project root' });
          return;
        }

        const rawBase = req.query['baseMtimeMs'];
        const baseRevision = req.query['baseRevision'];
        const baseMtimeMs = typeof rawBase === 'string' ? Number(rawBase) : 0;
        const outcome = writeWorkspaceImage(
          resolvedRoot,
          relPath,
          bytes,
          Number.isFinite(baseMtimeMs) ? baseMtimeMs : 0,
          undefined,
          typeof baseRevision === 'string' ? baseRevision : undefined,
        );
        if (outcome.ok) {
          res.json(outcome.result);
          return;
        }
        const status = outcome.error === 'outside' ? 403
          : outcome.error === 'not-found' ? 404
          : outcome.error === 'conflict' ? 409
          : outcome.error === 'too-large' ? 413
          // ④-1 415 — 원본 형식으로 구울 수 없는 확장자. 화면은 [파일에 저장]을 아예 흐리게 둔다.
          : outcome.error === 'unsupported' ? 415
          : outcome.error === 'readonly' ? 423
          : 500;
        res.status(status).json({ error: outcome.error, mtimeMs: outcome.mtimeMs });
      } catch (err) {
        logger.error('PUT /api/workspace-image failed', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /api/workspace-media — §5.13 (R) 영상·음악·3D·PDF 파일의 바이트(Range 요청 지원).
   * 이미지 창구와 가른 이유: 몇백 MB 파일을 `<video>`·`<audio>` 가 Range 로 구간만 집어 가야 되감기·구간 반복이 즉시 반응한다(통째면 서버 메모리에 전체가 올라오고 첫 프레임까지 몇 초).
   * 가드는 같은 `isWithinOpenableRoots` + `resolveWorkspacePath`. §5.1 #2-1 (A) — 루트 밖이라도 그 파일이 버블로 떠 있으면 읽기는 연다(`hasNodeAbsolutePath`, 판정은 `resolveWorkspaceMediaRead` 한 곳). 쓰기(PUT)는 루트 안만.
   * §5.13 40-1 — 패키지 앱은 vibproxy 미디어 갈래로 받는다(IPC 는 응답 전체를 메인에 모았다가 넘긴다). 그 갈래도 이 판정 한 벌을 쓴다(`setWorkspaceMediaReadGuards`).
   */
  const workspaceMediaReadGuards: WorkspaceMediaReadGuards = {
    isOpenableRoot: (resolvedRoot) => isWithinOpenableRoots(resolvedRoot),
    isBubblePath: (absPath) => graphManager.hasNodeAbsolutePath(absPath),
  };
  setWorkspaceMediaReadGuards(workspaceMediaReadGuards);
  app.get('/api/workspace-media', (req, res) => {
    try {
      const root = req.query['root'];
      const relPath = req.query['path'];
      if (typeof root !== 'string' || root.length === 0 || typeof relPath !== 'string' || relPath.length === 0) {
        res.status(400).json({ error: 'root and path query required' });
        return;
      }

      const resolved = resolveWorkspaceMediaRead(root, relPath, workspaceMediaReadGuards);
      if (!resolved) {
        logger.warn(`workspace-media blocked (not a project root / known bubble path): "${root}" "${relPath}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      let size: number;
      try {
        const st = fs.statSync(resolved.abs);
        if (!st.isFile()) {
          res.status(404).json({ error: 'Media not found' });
          return;
        }
        size = st.size;
      } catch {
        res.status(404).json({ error: 'Media not found' });
        return;
      }

      const mime = workspaceMediaMime(resolved.rel);
      res.setHeader('Content-Type', mime);
      res.setHeader('Accept-Ranges', 'bytes');
      // 편집 결과를 덮어써도 같은 URL 이라, 캐시가 남으면 방금 저장한 소리가 안 들린다(이미지와 같은 판단).
      res.setHeader('Cache-Control', 'no-store');

      const range = req.headers.range;
      const match = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
      if (!match) {
        res.setHeader('Content-Length', String(size));
        fs.createReadStream(resolved.abs).on('error', () => res.end()).pipe(res);
        return;
      }

      // `bytes=-N`(끝에서 N바이트)도 규격이라 함께 받는다.
      const startRaw = match[1] ?? '';
      const endRaw = match[2] ?? '';
      let start = startRaw === '' ? size - Number(endRaw || 0) : Number(startRaw);
      let end = startRaw === '' || endRaw === '' ? size - 1 : Number(endRaw);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      start = Math.max(0, Math.min(start, size === 0 ? 0 : size - 1));
      end = Math.max(start, Math.min(end, size === 0 ? 0 : size - 1));

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(resolved.abs, { start, end }).on('error', () => res.end()).pipe(res);
    } catch (err) {
      logger.error('GET /api/workspace-media failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/workspace-media — §5.13 (R-4) 음악 편집기가 만든 새 파일을 프로젝트 안에 쓴다. 본문은 바이트 그대로(이미지 저장과 같은 이유).
   * 덮어쓰기를 허용하지 않는다 — 편집 결과는 늘 새 이름으로 남고 원본은 그대로 있어야 한다(§5.13 (I) 와 같은 판단).
   */
  app.put(
    '/api/workspace-media',
    express.raw({ type: () => true, limit: WORKSPACE_MEDIA_MAX_BYTES }),
    (req, res) => {
      try {
        const root = req.query['root'];
        const relPath = req.query['path'];
        if (typeof root !== 'string' || root.length === 0 || typeof relPath !== 'string' || relPath.length === 0) {
          res.status(400).json({ error: 'root and path query required' });
          return;
        }
        const bytes = req.body;
        if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
          res.status(400).json({ error: 'media body required' });
          return;
        }

        const resolvedRoot = path.resolve(root);
        if (!isWithinOpenableRoots(resolvedRoot)) {
          logger.warn(`workspace-media write blocked (outside project root): "${root}"`);
          res.status(403).json({ error: 'Path outside project root' });
          return;
        }
        const resolved = resolveWorkspacePath(resolvedRoot, relPath);
        if (!resolved || resolved.rel === '') {
          res.status(403).json({ error: 'Path outside project root' });
          return;
        }
        if (fs.existsSync(resolved.abs)) {
          // 이름이 겹치면 화면이 다른 이름을 고르게 한다 — 조용히 덮어쓰지 않는다.
          res.status(409).json({ error: 'exists' });
          return;
        }

        fs.mkdirSync(path.dirname(resolved.abs), { recursive: true });
        fs.writeFileSync(resolved.abs, bytes);
        res.json({ ok: true, path: resolved.rel, size: bytes.length });
      } catch (err) {
        logger.error('PUT /api/workspace-media failed', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /api/workspace-site/<루트>/<파일…> — §5.5 #17-27 ⑮ HTML 을 페이지로 내보내는 창구.
   * 여기만 경로형인 이유: 질의형(`?root=&path=`)이면 `<link href="style.css">` 가 `/api/style.css` 로 풀려 CSS·그림·스크립트가 전멸한다. 경로형이면 `./`·`../` 가 브라우저 규칙대로 풀린다(규약·왕복 검증은 shared `workspaceSite.ts` 한 파일).
   * 가드는 같은 `isWithinOpenableRoots` + `resolveWorkspacePath`(새 가드 ❌) — 열린 프로젝트 밖으로는 못 나간다.
   */
  app.get(`${WORKSPACE_SITE_PATH}/*`, (req, res) => {
    try {
      // req.path 는 아직 퍼센트 인코딩된 원본이다 — 세그먼트별 디코딩은 파서가 한다.
      const parsed = parseWorkspaceSitePath(req.path);
      if (!parsed) {
        res.status(400).json({ error: 'usage: /api/workspace-site/<root>/<path>' });
        return;
      }

      const resolvedRoot = path.resolve(parsed.root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`workspace-site blocked (outside project root): "${parsed.root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const resolved = resolveWorkspacePath(resolvedRoot, parsed.relPath);
      if (!resolved) {
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      let abs = resolved.abs;
      let rel = resolved.rel;
      let size: number;
      try {
        const st = fs.statSync(abs);
        if (st.isDirectory()) {
          // 폴더를 가리키면 그 안의 index.html — 브라우저에 폴더 주소를 넣었을 때와 같은 기대.
          const indexRel = rel === '' ? 'index.html' : `${rel}/index.html`;
          const indexResolved = resolveWorkspacePath(resolvedRoot, indexRel);
          const indexStat = indexResolved ? fs.statSync(indexResolved.abs) : null;
          if (!indexResolved || !indexStat?.isFile()) {
            res.status(404).json({ error: 'Not found' });
            return;
          }
          abs = indexResolved.abs;
          rel = indexResolved.rel;
          size = indexStat.size;
        } else if (!st.isFile()) {
          res.status(404).json({ error: 'Not found' });
          return;
        } else {
          size = st.size;
        }
      } catch {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      res.setHeader('Content-Type', workspaceSiteMime(rel));
      // 저장하면 그 자리에서 다시 그려져야 한다(⑮ (e)) — 캐시가 남으면 방금 고친 화면이 안 뜬다.
      res.setHeader('Cache-Control', 'no-store');
      // 우리가 정한 MIME 을 브라우저가 다시 추측하지 않게 한다(스니핑으로 갈리면 자산이 조용히 죽는다).
      res.setHeader('X-Content-Type-Options', 'nosniff');

      // 손으로 쓴 페이지만 다시 쓴다(⑮ (c)). 그 외(그림·폰트·JS·wasm)와 거대한 생성물은
      // 바이트 그대로 흘린다 — 정규식으로 훑을 이유도, 메모리에 통째로 올릴 이유도 없다.
      const rewriteKind = size <= WORKSPACE_SITE_REWRITE_MAX_BYTES ? workspaceSiteRewriteKind(rel) : null;
      if (rewriteKind !== null) {
        const text = fs.readFileSync(abs, 'utf8');
        const base = workspaceSiteBase(parsed.root);
        if (rewriteKind === 'css') {
          res.send(rewriteWorkspaceSiteCss(text, base));
          return;
        }
        // 순서가 규칙이다. ① 원본 그대로 시작 태그마다 줄:칸을 적는다(⑮ (i)) — 재작성이 먼저면 늘어난 글자만큼 위치가 밀린다. ② 루트 절대 경로 재작성.
        // ③ 부모와 말하는 조각((b) 위치 신고 · (i) 요소 집기)은 맨 마지막 — 먼저 얹으면 그 안의 문자열이 재작성 정규식에 걸린다.
        const annotated = annotateWorkspaceSiteSource(text);
        res.send(injectWorkspaceSiteAgents(rewriteWorkspaceSiteHtml(annotated, base)));
        return;
      }

      // 페이지 안의 <video>·<audio> 는 구간 요청으로 집어 간다 — 없으면 되감기가 죽는다
      // (§5.13 (R) 미디어 창구와 같은 규칙).
      res.setHeader('Accept-Ranges', 'bytes');
      const range = req.headers.range;
      const match = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
      if (!match) {
        res.setHeader('Content-Length', String(size));
        fs.createReadStream(abs).on('error', () => res.end()).pipe(res);
        return;
      }
      const startRaw = match[1] ?? '';
      const endRaw = match[2] ?? '';
      let start = startRaw === '' ? size - Number(endRaw || 0) : Number(startRaw);
      let end = startRaw === '' || endRaw === '' ? size - 1 : Number(endRaw);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      start = Math.max(0, Math.min(start, size === 0 ? 0 : size - 1));
      end = Math.max(start, Math.min(end, size === 0 ? 0 : size - 1));
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      fs.createReadStream(abs, { start, end }).on('error', () => res.end()).pipe(res);
    } catch (err) {
      logger.error('GET /api/workspace-site failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.5 #17-19 ⑦ — 탐색기 우클릭의 세 변경(만들기 · 이름 바꾸기 · 삭제) 공용 앞단.
   * `root` 는 `/api/workspace-dir` 과 같은 규약으로 받고 등록된 루트 안인지 검사한다(루트를 벗어나는 `path` 는 서비스가 한 번 더 막는다). 디스크가 SSOT 라 broadcast·checkpoint 미관여.
   */
  function readWorkspaceMutateRoot(
    body: { root?: unknown },
    res: express.Response,
  ): string | null {
    const { root } = body;
    if (typeof root !== 'string' || root.length === 0) {
      res.status(400).json({ error: 'root required' });
      return null;
    }
    const resolvedRoot = path.resolve(root);
    if (!isWithinOpenableRoots(resolvedRoot)) {
      logger.warn(`workspace-entry blocked (outside project root): "${root}"`);
      res.status(403).json({ error: 'Path outside project root' });
      return null;
    }
    return resolvedRoot;
  }

  /** 실패 사유 → HTTP 코드. 화면은 코드가 아니라 `error` 문자열을 보고 문구를 고른다. */
  function workspaceMutateStatus(error: WorkspaceMutateError): number {
    switch (error) {
      case 'not-found': return 404;
      case 'exists': return 409;
      case 'denied': return 403;
      case 'outside':
      case 'root':
      case 'into-self':
      case 'invalid-name': return 400;
      default: return 500;
    }
  }

  /** POST /api/workspace-entry — §5.5 #17-19 ⑦ 새 파일·새 폴더. */
  app.post('/api/workspace-entry', (req, res) => {
    try {
      const body = req.body as Partial<WorkspaceEntryCreateRequest>;
      const resolvedRoot = readWorkspaceMutateRoot(body, res);
      if (resolvedRoot === null) return;

      const relPath = typeof body.path === 'string' ? body.path : '';
      const name = typeof body.name === 'string' ? body.name : '';
      const kind = body.kind === 'directory' ? 'directory' : 'file';

      const outcome = createWorkspaceEntry(resolvedRoot, relPath, name, kind);
      if (!outcome.ok) {
        res.status(workspaceMutateStatus(outcome.error)).json({ error: outcome.error });
        return;
      }
      logger.info(`workspace-entry created (${kind}): ${outcome.result.path}`);
      res.json(outcome.result);
    } catch (err) {
      logger.error('POST /api/workspace-entry failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/workspace-entry — §5.5 #17-19 ⑦ 이름 바꾸기(같은 폴더 안에서만). */
  app.patch('/api/workspace-entry', (req, res) => {
    try {
      const body = req.body as Partial<WorkspaceEntryRenameRequest>;
      const resolvedRoot = readWorkspaceMutateRoot(body, res);
      if (resolvedRoot === null) return;

      const relPath = typeof body.path === 'string' ? body.path : '';
      const name = typeof body.name === 'string' ? body.name : '';

      const outcome = renameWorkspaceEntry(resolvedRoot, relPath, name);
      if (!outcome.ok) {
        res.status(workspaceMutateStatus(outcome.error)).json({ error: outcome.error });
        return;
      }
      logger.info(`workspace-entry renamed: ${relPath} → ${outcome.result.path}`);
      res.json(outcome.result);
    } catch (err) {
      logger.error('PATCH /api/workspace-entry failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/workspace-entry/move — §5.5 #17-19 ⑧ 옮기기(끌어다 폴더에 놓기). 이름 바꾸기(`PATCH`)와 다른 창구 — 이름은 그대로, 사는 폴더만 바뀌고 되물음도 다르다.
   * 되물음은 화면 몫이고 여기서는 시키는 대로 옮긴다(⑦ 삭제와 같은 분담).
   */
  app.post('/api/workspace-entry/move', (req, res) => {
    try {
      const body = req.body as Partial<WorkspaceEntryMoveRequest>;
      const resolvedRoot = readWorkspaceMutateRoot(body, res);
      if (resolvedRoot === null) return;

      const relPath = typeof body.path === 'string' ? body.path : '';
      const toDir = typeof body.toDir === 'string' ? body.toDir : '';

      const outcome = moveWorkspaceEntry(resolvedRoot, relPath, toDir);
      if (!outcome.ok) {
        res.status(workspaceMutateStatus(outcome.error)).json({ error: outcome.error });
        return;
      }
      logger.info(`workspace-entry moved: ${relPath} → ${outcome.result.path}`);
      res.json(outcome.result);
    } catch (err) {
      logger.error('POST /api/workspace-entry/move failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /api/workspace-entry — §5.5 #17-19 ⑦ 삭제. 데스크톱 앱은 OS 휴지통으로(Electron `shell.trashItem` 주입 — `setWorkspaceTrash`), 그 통로가 없으면 영구 삭제 — 어느 쪽이었는지는 `trashed` 로 화면에 전한다. */
  app.delete('/api/workspace-entry', (req, res) => {
    void (async () => {
      try {
        const body = req.body as Partial<WorkspaceEntryDeleteRequest>;
        const resolvedRoot = readWorkspaceMutateRoot(body, res);
        if (resolvedRoot === null) return;

        const relPath = typeof body.path === 'string' ? body.path : '';
        const outcome = await deleteWorkspaceEntry(resolvedRoot, relPath);
        if (!outcome.ok) {
          res.status(workspaceMutateStatus(outcome.error)).json({ error: outcome.error });
          return;
        }
        logger.info(`workspace-entry deleted (${outcome.result.trashed ? 'trash' : 'permanent'}): ${outcome.result.path}`);
        res.json(outcome.result);
      } catch (err) {
        logger.error('DELETE /api/workspace-entry failed', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    })();
  });

  /** GET /api/workspace-trash — §5.5 #17-19 ⑦ 이 실행 형태가 휴지통을 쓸 수 있는가. 되물음 문구("휴지통으로 보냅니다" vs "영구히 지웁니다")가 갈려 화면이 미리 알아야 한다. 조회 전용. */
  app.get('/api/workspace-trash', (_req, res) => {
    res.json({ available: isWorkspaceTrashAvailable() });
  });

  /**
   * POST /api/open-external — §5.13 (R-6) 그 파일을 OS 연결 프로그램으로 연다(`/api/open-node-file` 의 외부 에디터 열기와 병행).
   * 에디터 길은 VS Code 가 없으면 메모장으로 떨어져 zip·폰트·xlsx 의 이진 바이트가 쏟아진다. 가드는 열기 라우트 둘과 같다(`isWithinOpenableRoots` 또는 화면의 버블 경로) — 페어링된 모바일 기기도 이 라우트에 닿는다.
   */
  app.post('/api/open-external', (req, res) => {
    try {
      const { absolutePath } = req.body as { absolutePath?: string };
      if (typeof absolutePath !== 'string' || absolutePath.length === 0) {
        res.status(400).json({ error: 'absolutePath required' });
        return;
      }
      const resolved = path.resolve(absolutePath);
      if (!isWithinOpenableRoots(resolved) && !graphManager.hasNodeAbsolutePath(resolved)) {
        logger.warn(`open-external blocked (not a project root / known bubble path): "${absolutePath}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }
      if (!fs.existsSync(resolved)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      openWithDefaultApp(resolved);
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/open-external failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/mic-settings — §5.5 #17-38 ⑮ 이 PC 에서 마이크 설정 창을 열 수 있는가([설정 열기] 버튼을 그릴지).
   * linux 는 데스크톱 환경마다 창이 갈려 `openable: false` — 화면은 버튼 대신 무엇을 확인할지 글로 보여 준다(눌러도 아무 일 없는 버튼 ❌).
   */
  app.get('/api/mic-settings', (_req, res) => {
    res.json({
      openable: isMicSettingsOpenable(),
      hintKey: micSettingsHintKey(),
    });
  });

  /**
   * POST /api/mic-settings/open — §5.5 #17-38 ⑮ OS 의 마이크 설정 창을 연다.
   * 본문에서 URL 을 받지 않는다 — 여는 주소는 `micSettingsTarget()` 이 플랫폼으로 정한 하나뿐이라 임의 URI 를 여는 문이 되지 않는다(페어링된 모바일 기기도 닿는다 — `/api/open-external` 과 같은 이유).
   */
  app.post('/api/mic-settings/open', (_req, res) => {
    try {
      res.json(openMicSettings());
    } catch (err) {
      logger.error('POST /api/mic-settings/open failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/media-tools — §5.13 (R-8) (e) 이 PC 에 변환기(ffmpeg)가 있는가. 코덱이 아니다 — Chromium 은 시스템 코덱을 안 쓰므로 코덱팩은 무효다.
   * `?force=1` 이면 캐시를 무시하고 다시 훑는다(설치 직후).
   */
  app.get('/api/media-tools', (req, res) => {
    try {
      res.json(detectMediaTools(req.query['force'] === '1'));
    } catch (err) {
      logger.error('GET /api/media-tools failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/media-tools/install — 변환기 설치(사용자가 눌렀을 때만). 바이너리를 나르지 않고 OS 표준 창구(winget·brew)에 맡긴다 — 라이선스·용량(§5.13 (R-8) (e)). 끝나면 다시 훑은 결과를 돌려준다. */
  app.post('/api/media-tools/install', (_req, res) => {
    void installMediaTools()
      .then((result) => res.json(result))
      .catch((err: unknown) => {
        logger.error('POST /api/media-tools/install failed', err);
        res.status(500).json({ ok: false, error: 'Internal server error' });
      });
  });

  /**
   * GET /api/media-convert/cached — 이 파일의 변환 결과가 이미 있는가(팝업을 띄울지 그냥 열지). 변환을 시작하지 않는 순수 조회.
   * 라우트 순서 주의 — `/:jobId` 보다 먼저 서야 `cached` 가 작업 id 로 읽히지 않는다.
   */
  app.get('/api/media-convert/cached', (req, res) => {
    try {
      const root = req.query['root'];
      const relPath = req.query['path'];
      const kind = req.query['kind'];
      if (typeof root !== 'string' || typeof relPath !== 'string' || (kind !== 'video' && kind !== 'audio')) {
        res.status(400).json({ error: 'root, path, kind required' });
        return;
      }
      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }
      res.json({ outRel: mediaConvertService.cachedOutput(resolvedRoot, relPath, kind) });
    } catch (err) {
      logger.error('GET /api/media-convert/cached failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/media-convert — 변환 시작(또는 이미 있는 결과·작업 반환). 같은 파일을 두 번 갈지 않고 캐시가 있으면 곧바로 `done` — 호출부는 `status` 만 본다. */
  app.post('/api/media-convert', (req, res) => {
    try {
      const { root, path: relPath, kind } = req.body as { root?: string; path?: string; kind?: string };
      if (typeof root !== 'string' || typeof relPath !== 'string' || (kind !== 'video' && kind !== 'audio')) {
        res.status(400).json({ error: 'root, path, kind required' });
        return;
      }
      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`media-convert blocked (outside project root): "${root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const result = mediaConvertService.start(resolvedRoot, relPath, kind);
      if ('error' in result) {
        // 없는 파일(404)과 변환기 없음(409)은 화면이 서로 다르게 답해야 한다 —
        // 앞은 잘못된 경로, 뒤는 [변환기 설치] 를 낼 자리다.
        res.status(result.error === 'not-found' ? 404 : 409).json({ error: result.error });
        return;
      }
      res.json({ job: result });
    } catch (err) {
      logger.error('POST /api/media-convert failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/media-convert/:jobId — 진행 상황(화면이 폴링한다. 상태는 휘발성이라 서버가 죽으면 사라진다). */
  app.get('/api/media-convert/:jobId', (req, res) => {
    try {
      const job = mediaConvertService.getJob(req.params.jobId);
      if (!job) {
        res.status(404).json({ error: 'unknown job' });
        return;
      }
      res.json({ job });
    } catch (err) {
      logger.error('GET /api/media-convert/:jobId failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });



  /**
   * GET /api/run-configs — §5.5 #17-20 ② 디버그·실행 런처: 이 프로젝트의 실행 구성.
   * `.vscode/launch.json`·`tasks.json`(JSONC)·`package.json` scripts·`.vibisual/run.json` + §5.14 탐지기 결과를 한 목록으로. 디스크가 SSOT 라 조회 전용. 가드는 탐색기와 같은 `isWithinOpenableRoots`.
   */
  app.get('/api/run-configs', (req, res) => {
    try {
      const root = req.query['root'];
      if (typeof root !== 'string' || root.length === 0) {
        res.status(400).json({ error: 'root query required' });
        return;
      }
      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`run-configs blocked (outside project root): "${root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }
      const { configs, scanned } = scanRunConfigs(resolvedRoot);
      res.json({ projectPath: resolvedRoot, configs, scanned });
    } catch (err) {
      logger.error('GET /api/run-configs failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/external-debuggers — §5.5 #17-20 ⑦ C층: 설치된 외부 디버거 목록.
   * 설치돼 있지 않은 항목도 함께 돌려준다(화면이 "설치되어 있지 않음"을 적어야 하므로).
   */
  app.get('/api/external-debuggers', (req, res) => {
    try {
      const root = req.query['root'];
      if (typeof root !== 'string' || root.length === 0) {
        res.status(400).json({ error: 'root query required' });
        return;
      }
      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }
      res.json({ debuggers: listExternalDebuggers(resolvedRoot) });
    } catch (err) {
      logger.error('GET /api/external-debuggers failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/external-debuggers/launch — 고른 도구로 `.sln`/`.uproject`/폴더를 연다(detached). */
  app.post('/api/external-debuggers/launch', (req, res) => {
    try {
      const { id, root } = req.body as { id?: string; root?: string };
      if (typeof id !== 'string' || typeof root !== 'string' || root.length === 0) {
        res.status(400).json({ error: 'id and root required' });
        return;
      }
      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }
      const result = launchExternalDebugger(id as Parameters<typeof launchExternalDebugger>[0], resolvedRoot);
      if (!result.ok) {
        res.status(400).json({ error: result.error ?? 'launch failed' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/external-debuggers/launch failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/mcp-servers — §5.5 #17-31: 이 프로젝트에서 쓸 수 있는 MCP 전부 — 글로벌(`~/.claude.json` 최상위) · 로컬(그 프로젝트 엔트리) · 프로젝트(`.mcp.json`) · 프리셋.
   * 매 호출마다 디스크를 다시 읽는다(앱 밖에서 `claude mcp add` 한 직후에도 새로고침으로 보이게). 가드는 `isWithinOpenableRoots`.
   */
  app.get('/api/mcp-servers', (req, res) => {
    try {
      const root = req.query['root'];
      if (typeof root !== 'string' || root.length === 0) {
        res.status(400).json({ error: 'root query required' });
        return;
      }
      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`mcp-servers blocked (outside project root): "${root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }
      // 프리셋 줄의 켜짐은 파일이 아니라 이 에이전트의 설정이 진실이다(#17-20 ⑥).
      const agentId = req.query['agentId'];
      const presetIds = typeof agentId === 'string' && agentId.length > 0
        ? graphManager.getAgentConfig(agentId)?.mcpServers
        : undefined;
      res.json(scanMcpInventory(resolvedRoot, presetIds));
    } catch (err) {
      logger.error('GET /api/mcp-servers failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/mcp-servers/toggle — §5.5 #17-31 ④: 그 서버를 이 프로젝트에서 켜거나 끈다.
   * 쓰는 곳은 `~/.claude.json` 의 그 프로젝트 엔트리 하나뿐(= `/mcp disable` 과 같은 자리) — `.mcp.json`·`.claude/settings*.json` 은 읽기만. 프리셋(`scope='preset'`)은 받지 않는다 — `PUT /api/agent-config/:agentId` 가 통로다.
   * 응답은 갱신된 인벤토리라 화면이 다시 묻지 않는다.
   */
  app.post('/api/mcp-servers/toggle', (req, res) => {
    try {
      const { root, scope, name, enabled, agentId } = req.body as {
        root?: string; scope?: string; name?: string; enabled?: boolean; agentId?: string;
      };
      if (typeof root !== 'string' || root.length === 0 || typeof name !== 'string' || name.length === 0) {
        res.status(400).json({ error: 'root and name required' });
        return;
      }
      if (scope !== 'global' && scope !== 'local' && scope !== 'project') {
        res.status(400).json({ error: 'scope must be global | local | project' });
        return;
      }
      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }
      const result = setMcpServerEnabled(resolvedRoot, scope, name, enabled === true);
      if (!result.ok) {
        res.status(400).json({ error: result.reason });
        return;
      }
      const presetIds = typeof agentId === 'string' && agentId.length > 0
        ? graphManager.getAgentConfig(agentId)?.mcpServers
        : undefined;
      res.json({ ok: true, inventory: scanMcpInventory(resolvedRoot, presetIds) });
    } catch (err) {
      logger.error('POST /api/mcp-servers/toggle failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/hooks — §5.5 #17-32: 이 프로젝트(=이 세션)에 적용되는 Claude Code 훅 전부 — 글로벌(`~/.claude/settings.json`)·프로젝트·로컬(`settings.local.json`)·관리자 정책.
   * 매 호출마다 디스크를 다시 읽는다(앱 밖에서 훅을 추가한 직후에도 보이게, #17-32 ③). 가드는 `isWithinOpenableRoots`.
   */
  app.get('/api/hooks', (req, res) => {
    try {
      const root = req.query['root'];
      if (typeof root !== 'string' || root.length === 0) {
        res.status(400).json({ error: 'root query required' });
        return;
      }
      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`hooks blocked (outside project root): "${root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }
      res.json(scanHookInventory(resolvedRoot));
    } catch (err) {
      logger.error('GET /api/hooks failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/hooks/toggle — §5.5 #17-32 ④: 그 훅을 이 컴퓨터에서 켜거나 끈다.
   * Claude Code 에는 훅 끄기 손잡이가 없어 명령 객체를 같은 블록 안 `hooks` ↔ `_vibisualDisabled` 사이로 옮긴다(지우지 않는다 = 늘 되돌릴 수 있다).
   * 관리자 정책(`managed`)과 우리 자신의 블록은 받지 않는다. 응답은 갱신된 인벤토리.
   */
  app.post('/api/hooks/toggle', (req, res) => {
    try {
      const { root, scope, event, matcher, command, enabled } = req.body as {
        root?: string; scope?: string; event?: string; matcher?: string; command?: string; enabled?: boolean;
      };
      if (typeof root !== 'string' || root.length === 0
        || typeof event !== 'string' || event.length === 0
        || typeof command !== 'string' || command.length === 0) {
        res.status(400).json({ error: 'root, event and command required' });
        return;
      }
      if (scope !== 'user' && scope !== 'project' && scope !== 'local') {
        res.status(400).json({ error: 'scope must be user | project | local' });
        return;
      }
      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }
      const result = setHookEnabled(
        resolvedRoot, scope, event, typeof matcher === 'string' ? matcher : '', command, enabled === true,
      );
      if (!result.ok) {
        res.status(400).json({ error: result.reason });
        return;
      }
      res.json({ ok: true, inventory: scanHookInventory(resolvedRoot) });
    } catch (err) {
      logger.error('POST /api/hooks/toggle failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/claude-plugins — §5.5 #17-33: 이 프로젝트에서 본 Claude Code 플러그인 + 마켓.
   * 진실은 CLI 자신의 답(`claude plugin list --json --available`) — 매 호출마다 다시 묻는다. CLI 가 `cwd` 로 `project`/`local` 범위를 해석하므로 그 프로젝트에서 띄운다. 가드는 `isWithinOpenableRoots`.
   */
  /**
   * §5.5 #17-33 ⑦ — 인벤토리에 마지막 마켓 갱신 시각을 얹는다.
   * CLI 는 클론 시각을 알려 주지 않고 `known_marketplaces.json` 읽기는 ② 가 막으므로 우리가 부른 시각을 우리가 적는다(없으면 클론이 오래 멈춰도 화면이 말이 없다 — 실측 36일).
   */
  async function inventoryWithRefreshMarks(projectPath: string): Promise<ClaudePluginInventory> {
    const inv = await scanClaudePlugins(projectPath);
    const refresh = appStateGetClaudePluginRefresh();
    return {
      ...inv,
      ...(refresh.lastMarketAt ? { marketRefreshedAt: refresh.lastMarketAt } : {}),
      ...(refresh.lastError ? { marketRefreshError: refresh.lastError } : {}),
    };
  }

  app.get('/api/claude-plugins', (req, res) => {
    void (async () => {
      try {
        const root = req.query['root'];
        if (typeof root !== 'string' || root.length === 0) {
          res.status(400).json({ error: 'root query required' });
          return;
        }
        const resolvedRoot = path.resolve(root);
        if (!isWithinOpenableRoots(resolvedRoot)) {
          logger.warn(`claude-plugins blocked (outside project root): "${root}"`);
          res.status(403).json({ error: 'Path outside project root' });
          return;
        }
        res.json(await inventoryWithRefreshMarks(resolvedRoot));
      } catch (err) {
        logger.error('GET /api/claude-plugins failed', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    })();
  });

  /** §5.5 #17-33 ⑦ — 자동 갱신 설정 읽기/쓰기. 플러그인은 사용자 컴퓨터에서 임의 코드를 도는 물건이라 끌 자리가 반드시 있어야 한다. 기본은 켬. */
  app.get('/api/claude-plugin-refresh', (_req, res) => {
    res.json({ ok: true, ...appStateGetClaudePluginRefresh(), running: isClaudePluginRefreshRunning() });
  });

  app.put('/api/claude-plugin-refresh', (req, res) => {
    try {
      const body = req.body as { market?: unknown; plugins?: unknown; intervalHours?: unknown };
      const current = appStateGetClaudePluginRefresh().settings;
      // 부분 페이로드로 와도 나머지를 강등시키지 않는다(§5.3 #12-1 agent-config 가 겪은 그 사고).
      appStateSetClaudePluginRefresh({
        settings: normalizePluginRefreshSettings({
          market: typeof body.market === 'boolean' ? body.market : current.market,
          plugins: typeof body.plugins === 'boolean' ? body.plugins : current.plugins,
          intervalHours: typeof body.intervalHours === 'number' ? body.intervalHours : current.intervalHours,
        }),
      });
      res.json({ ok: true, ...appStateGetClaudePluginRefresh() });
    } catch (err) {
      logger.error('PUT /api/claude-plugin-refresh failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/claude-plugins/action — §5.5 #17-33 ④⑤: 켜기·끄기·설치·제거·마켓 추가/제거.
   * 전부 CLI 위임이라 창구 하나 — git clone·설치 상태 파일 쓰기를 흉내 내면 CLI 상태와 갈린다. 응답에 갱신된 인벤토리를 싣는다.
   */
  app.post('/api/claude-plugins/action', (req, res) => {
    void (async () => {
      try {
        const { root, action, id, scope, source } = req.body as {
          root?: string; action?: string; id?: string; scope?: string; source?: string;
        };
        if (typeof root !== 'string' || root.length === 0) {
          res.status(400).json({ error: 'root required' });
          return;
        }
        const resolvedRoot = path.resolve(root);
        if (!isWithinOpenableRoots(resolvedRoot)) {
          res.status(403).json({ error: 'Path outside project root' });
          return;
        }
        const pluginScope = scope === 'project' || scope === 'local' ? scope : 'user';

        let result: PluginMutationResult;
        switch (action) {
          case 'enable':
          case 'disable': {
            if (typeof id !== 'string' || id.length === 0) {
              res.status(400).json({ error: 'id required' });
              return;
            }
            result = await setClaudePluginEnabled(resolvedRoot, id, pluginScope, action === 'enable');
            break;
          }
          case 'install': {
            if (typeof id !== 'string' || id.length === 0) {
              res.status(400).json({ error: 'id required' });
              return;
            }
            result = await installClaudePlugin(resolvedRoot, id, pluginScope);
            break;
          }
          case 'uninstall': {
            if (typeof id !== 'string' || id.length === 0) {
              res.status(400).json({ error: 'id required' });
              return;
            }
            result = await uninstallClaudePlugin(resolvedRoot, id, pluginScope);
            break;
          }
          case 'marketplace-add': {
            if (typeof source !== 'string' || source.trim().length === 0) {
              res.status(400).json({ error: 'source required' });
              return;
            }
            result = await addClaudeMarketplace(resolvedRoot, source.trim());
            break;
          }
          case 'marketplace-remove': {
            if (typeof source !== 'string' || source.trim().length === 0) {
              res.status(400).json({ error: 'source required' });
              return;
            }
            result = await removeClaudeMarketplace(resolvedRoot, source.trim());
            break;
          }
          // §5.5 #17-33 ⑦ — 여기부터 셋이 "손으로 하던 갱신" 을 앱 안으로 들인 자리다.
          case 'marketplace-update': {
            // `source` 는 선택 — 없으면 붙어 있는 마켓 전부(CLI 규약 그대로).
            result = await updateClaudeMarketplaces(
              resolvedRoot,
              typeof source === 'string' ? source.trim() : undefined,
            );
            if (result.ok) appStateSetClaudePluginRefresh({ lastMarketAt: Date.now(), lastError: null });
            else appStateSetClaudePluginRefresh({ lastError: result.reason });
            break;
          }
          case 'update': {
            if (typeof id !== 'string' || id.length === 0) {
              res.status(400).json({ error: 'id required' });
              return;
            }
            result = await updateClaudePlugin(resolvedRoot, id, pluginScope);
            break;
          }
          case 'update-all': {
            // 마켓을 먼저 끌어오고 뒤처진 것을 올린다 — 순서가 뒤집히면 옛 마켓으로 견줘 새 판을 놓친다.
            const refreshed = await runClaudePluginRefresh(resolvedRoot, { force: true, market: true, plugins: true });
            const failed = refreshed.plugins.failed;
            result = failed.length === 0
              ? { ok: true }
              // 일부만 실패해도 사유는 CLI 출력 그대로 — 우리가 요약하면 원인이 지워진다(④).
              : { ok: false, reason: failed.map((f) => `${f.id}: ${f.reason}`).join(' / ').slice(0, 400) };
            break;
          }
          default:
            res.status(400).json({ error: 'unknown action' });
            return;
        }

        // §5.5 #17-33 ⑦ — **아홉 동작이 전부 플러그인 상태를 바꾼다.** 스킬 목록이 들고 있는
        // "이 플러그인이 켜져 있는가" 메모를 여기서 한 번에 버린다. 갈래마다 따로 버리면
        // 언젠가 하나를 빠뜨리고, 그 빠뜨림은 "왜 목록이 그대로지" 라는 로직 버그로 오진된다.
        invalidatePluginStateCache();

        if (!result.ok) {
          // 실패해도 목록은 함께 준다 — 실패 뒤 화면이 옛 상태로 남아 있으면 무엇이 됐는지 알 수 없다.
          res.status(400).json({ error: result.reason, inventory: await inventoryWithRefreshMarks(resolvedRoot) });
          return;
        }
        res.json({ ok: true, inventory: await inventoryWithRefreshMarks(resolvedRoot) });
      } catch (err) {
        logger.error('POST /api/claude-plugins/action failed', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    })();
  });

  /**
   * POST /api/unreal/attach — §5.5 #17-20 ③⑦: 실행 중인 언리얼 에디터에 디버거를 붙인다(`-WaitForDebugger` 로 띄우면 붙을 때까지 멈춰 있다).
   * 멈춰 세우는 일은 재배포할 수 없는 네이티브 디버거(⑦) 몫이라 우리는 pid 를 찾아 JIT 디버거에 넘기기만 한다. 조회·위임 전용.
   */
  app.post('/api/unreal/attach', (req, res) => {
    try {
      const { root } = req.body as { root?: string };
      if (typeof root !== 'string' || root.length === 0) {
        res.status(400).json({ error: 'root required' });
        return;
      }
      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }
      const result = attachDebuggerToEditor(resolvedRoot);
      if (!result.ok) {
        // 실패 사유는 화면이 그대로 적어야 한다(에디터가 안 떠 있는 것과 디버거가 없는 것은 다른 문제).
        res.status(409).json({ error: result.error ?? 'attach failed' });
        return;
      }
      res.json({ ok: true, pid: result.pid });
    } catch (err) {
      logger.error('POST /api/unreal/attach failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // §5.5 #17-20 ⑩⑫ — 공통 디버그 층. 연결은 서버가 소유한다(소켓·자식 프로세스는 브라우저가 못 연다).
  // 전부 런타임 무관 창구 — 언어가 갈리는 것은 표(`DEBUG_ADAPTERS`) 안에서다. 세션은 프로세스 수명이라 broadcast 는 `debug_event` 로만, checkpoint 미관여.

  /** GET /api/debug/adapters — 이 컴퓨터에서 쓸 수 있는 디버그 어댑터 목록(없으면 없다고 답한다). */
  app.get('/api/debug/adapters', (_req, res) => {
    try {
      res.json({ adapters: listDebugAdapters() });
    } catch (err) {
      logger.error('GET /api/debug/adapters failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/debug/sessions — 살아 있는 디버그 세션(클라 재접속 시 한 번 받아 간다). */
  app.get('/api/debug/sessions', (_req, res) => {
    res.json({ sessions: debugSessionManager.list() });
  });

  /*
   * §5.11 정독 게이트 — 설정 창구. 이 값은 호스트 소유라(체크포인트에 저장, 게이트가 훅·권한 경로에서 읽는다) 플러그인 REST(`/api/plugins/<id>/…`)가 아니라 여기다 — `verificationRuns`·`sessionLoops` 와 같은 축.
   * 저장소의 `.vibisual/spec.json`(팀이 git 으로 공유하는 기획 뿌리·경로 매핑)은 여기서 쓰지 않는다 — 화면 토글로 작업 트리를 건드리면 안 된다.
   * 이 창구는 이 기기의 선택(강도·면제·상한)만 저장하고, 판정은 파일이 바닥·이 값이 덮개다.
   */
  app.get('/api/spec-reading/settings', (req, res) => {
    try {
      const projectPath = typeof req.query['projectPath'] === 'string' ? req.query['projectPath'] : '';
      if (!projectPath) {
        res.status(400).json({ ok: false, error: 'projectPath required' });
        return;
      }
      res.json({ ok: true, settings: graphManager.getSpecReadingSettings(projectPath) ?? null });
    } catch (err) {
      logger.error('GET /api/spec-reading/settings failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/spec-reading/settings — 전량 교체(부분 페이로드 ❌ — 한 칸만 보내면 나머지가 조용히 기본값으로 강등된다, `agent-config` 와 같다).
   * 값 검증은 플러그인의 `normalizeSpecSettings` 하나 — 서버가 따로 검증하면 화면이 저장한 값과 게이트가 읽는 값이 갈린다.
   */
  app.put('/api/spec-reading/settings', (req, res) => {
    try {
      const body = req.body as { projectPath?: unknown; settings?: unknown };
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
      if (!projectPath || !body.settings || typeof body.settings !== 'object') {
        res.status(400).json({ ok: false, error: 'projectPath and settings required' });
        return;
      }
      const normalized = normalizeSpecSettings(body.settings as Partial<SpecReadingSettings>);
      const saved = graphManager.setSpecReadingSettings(projectPath, normalized);
      if (!saved) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      scheduleCheckpoint();
      broadcastSnapshot();
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('PUT /api/spec-reading/settings failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  // Preference controls send only their changed field. Reading and merging here are synchronous,
  // so a scope/waiver or another window's roots cannot be overwritten by an older UI snapshot.
  app.patch('/api/spec-reading/settings', (req, res) => {
    try {
      const body = req.body as { projectPath?: unknown; settings?: unknown };
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
      const next = projectPath
        ? patchSpecReadingPreferences(graphManager.getSpecReadingSettings(projectPath), body.settings)
        : null;
      if (!next) {
        res.status(400).json({ ok: false, error: 'projectPath and a strength/roots patch required' });
        return;
      }
      const saved = graphManager.setSpecReadingSettings(projectPath, next);
      if (!saved) { res.status(404).json({ ok: false, error: 'project not loaded' }); return; }
      scheduleCheckpoint();
      broadcastSnapshot();
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('PATCH /api/spec-reading/settings failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /** POST /api/spec-reading/waive — 절 하나를 면제한다(또는 되돌린다). 면제는 사용자만 — 이 창구는 화면에서만 불리고 에이전트에게 알려 주지 않는다(스스로 면제하면 게이트가 무의미). */
  app.post('/api/spec-reading/waive', (req, res) => {
    try {
      const body = req.body as { projectPath?: unknown; unitId?: unknown; waived?: unknown };
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
      const unitId = typeof body.unitId === 'string' ? body.unitId.trim() : '';
      if (!projectPath || !unitId) {
        res.status(400).json({ ok: false, error: 'projectPath and unitId required' });
        return;
      }
      const current = graphManager.getSpecReadingSettings(projectPath) ?? normalizeSpecSettings({});
      const list = new Set(current.waived ?? []);
      if (body.waived === false) list.delete(unitId);
      else list.add(unitId);
      const next = normalizeSpecSettings({ ...current, waived: [...list] });
      const saved = graphManager.setSpecReadingSettings(projectPath, next);
      if (!saved) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      scheduleCheckpoint();
      broadcastSnapshot();
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('POST /api/spec-reading/waive failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /**
   * POST /api/spec-reading/scope — §5.5 #17-44 ⑧ 켬/끔 3층을 한 칸만 갈아 끼운다.
   * `PUT /settings` 는 전량 교체라 팝오버가 그것으로 켜면 모르는 강도·면제·뿌리가 기본값으로 강등된다 — 여기서는 서버가 지금 값을 읽어 한 칸만 바꾼다.
   * `enabled: null` 은 그 칸을 지운다(위 층 상속) — `false` 와 다르다(그래야 "프로젝트는 켜고 이 세션만 끄기"가 된다).
   */
  app.post('/api/spec-reading/scope', (req, res) => {
    try {
      const body = req.body as { projectPath?: unknown; scope?: unknown; id?: unknown; enabled?: unknown };
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
      const scope = body.scope as SpecReadingScope;
      if (!projectPath || !SPEC_SCOPE_ORDER.includes(scope)) {
        res.status(400).json({ ok: false, error: 'projectPath and scope required' });
        return;
      }
      // 에이전트·세션 층은 그 id 가 있어야 칸을 만든다 — 없으면 어느 칸을 켰는지 아무도 모르는 값이 남는다.
      const id = typeof body.id === 'string' && body.id.trim() !== '' ? body.id.trim() : null;
      if (scope !== 'project' && id === null) {
        res.status(400).json({ ok: false, error: 'id required for agent/session scope' });
        return;
      }
      const enabled = body.enabled === null ? null : body.enabled === true ? true : body.enabled === false ? false : undefined;
      if (enabled === undefined) {
        res.status(400).json({ ok: false, error: 'enabled must be true, false or null' });
        return;
      }
      const current = graphManager.getSpecReadingSettings(projectPath) ?? normalizeSpecSettings({});
      const next = normalizeSpecSettings(withSpecReadingScope(current, scope, id, enabled));
      const saved = graphManager.setSpecReadingSettings(projectPath, next);
      if (!saved) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      scheduleCheckpoint();
      // 판정 메모는 저장된 설정을 지문으로 쓰므로 이 방송 한 번에 배지·뷰가 곧바로 새 값을 그린다.
      broadcastSnapshot();
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('POST /api/spec-reading/scope failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  // ─── §5.10 자동 목표 — 되풀이한 일을 스킬로 굳힌다 (기본 off · 3층) ───
  mountAutoGoalLifecycleRoutes(app, {
    resolveRoot: (requested) => graphManager.resolveAutoGoalRoot(requested),
    rootForAgent: (agentId) => {
      const root = graphManager.getProjectPathForAgent(agentId);
      return root ? graphManager.resolveAutoGoalRoot(root) : null;
    },
    ownsSession: (agentId, sessionId) => {
      const sub = subAgentManager.getSub(sessionId);
      if (sub) return sub.parentAgentId === agentId;
      // Internal scope overrides are keyed by sub.id; aliases must not bypass a disabled session.
      if (subAgentManager.findSubBySessionId(sessionId)) return false;
      return graphManager.findAgentIdBySession(sessionId) === agentId;
    },
    settings: (root) => graphManager.getAutoGoalSettings(root),
    material: (root) => graphManager.getAutoGoalMaterial(root),
    changed: () => { broadcastSnapshot(); },
  });
  // 창구가 넷인 이유는 정독(#17-44 ⑧(e))과 같다: 켬/끔은 전용 창구가 한 칸만 갈아 끼운다 — 전량 교체로 켜면 화면이 모르는 값(물린 후보 목록)이 조용히 기본값으로 강등된다.

  /**
   * GET /api/auto-goal/state — 이 자리에서 자동 목표가 무엇을 보고 있는가.
   * 꺼져 있으면 훑지 않는다 — 후보 0건·`observed` 0, 이미 지은 스킬 목록만 준다(껐다고 만든 것이 사라지면 안 된다).
   * 켜져 있으면 이 호출이 분석을 돌리고 문턱을 넘은 후보를 스킬로 굳힌다(쿨다운이 있어 창을 다시 열어도 다시 세지 않는다).
   */
  app.get('/api/auto-goal/state', (req, res) => {
    try {
      const projectPath = typeof req.query['projectPath'] === 'string' ? req.query['projectPath'] : '';
      if (!projectPath) {
        res.status(400).json({ ok: false, error: 'projectPath required' });
        return;
      }
      // 열려 있는 프로젝트만 연다 — 아무 경로나 적어 남의 폴더 절차를 읽어 가는 길을 막는다.
      const root = graphManager.resolveAutoGoalRoot(projectPath);
      if (!root) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      const agentId = typeof req.query['agentId'] === 'string' ? req.query['agentId'] : null;
      const subAgentId = typeof req.query['subAgentId'] === 'string' ? req.query['subAgentId'] : null;
      const settings = graphManager.getAutoGoalSettings(root);
      const material = graphManager.getAutoGoalMaterial(root);
      const state = getAutoGoalState(root, settings, { agentId, subAgentId }, material);
      res.json({ ok: true, state, settings: settings ?? null });
    } catch (err) {
      logger.error('GET /api/auto-goal/state failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /** POST /api/auto-goal/scope — 켬/끔 3층을 한 칸만 갈아 끼운다(정독과 같은 규약). `enabled: null` 은 그 칸을 지운다(상속) — `false` 와 다르다. */
  app.post('/api/auto-goal/scope', (req, res) => {
    try {
      const body = req.body as { projectPath?: unknown; scope?: unknown; id?: unknown; enabled?: unknown };
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
      const scope = body.scope as AutoGoalScope;
      if (!projectPath || !AUTO_GOAL_SCOPE_ORDER.includes(scope)) {
        res.status(400).json({ ok: false, error: 'projectPath and scope required' });
        return;
      }
      // 에이전트·세션 층은 그 id 가 있어야 칸을 만든다 — 없으면 어느 칸을 켰는지 아무도 모르는 값이 남는다.
      const id = typeof body.id === 'string' && body.id.trim() !== '' ? body.id.trim() : null;
      if (scope !== 'project' && id === null) {
        res.status(400).json({ ok: false, error: 'id required for agent/session scope' });
        return;
      }
      const enabled = body.enabled === null ? null : body.enabled === true ? true : body.enabled === false ? false : undefined;
      if (enabled === undefined) {
        res.status(400).json({ ok: false, error: 'enabled must be true, false or null' });
        return;
      }
      const current = graphManager.getAutoGoalSettings(projectPath) ?? {};
      const next = normalizeAutoGoalSettings(withAutoGoalScope(current, scope, id, enabled));
      const saved = graphManager.setAutoGoalSettings(projectPath, next);
      if (!saved) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      scheduleCheckpoint();
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('POST /api/auto-goal/scope failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /** POST /api/auto-goal/dismiss — 후보 하나를 물린다(또는 푼다). 지우지 않고 덮는다 — 계속 관찰돼도 제안만 멈춘다. 화면에서만 불린다(에이전트가 자기 제안을 물릴 수 있으면 무의미). */
  app.post('/api/auto-goal/dismiss', (req, res) => {
    try {
      const body = req.body as { projectPath?: unknown; candidateId?: unknown; dismissed?: unknown };
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
      const candidateId = typeof body.candidateId === 'string' ? body.candidateId.trim() : '';
      if (!projectPath || !candidateId) {
        res.status(400).json({ ok: false, error: 'projectPath and candidateId required' });
        return;
      }
      const current = graphManager.getAutoGoalSettings(projectPath) ?? {};
      const next = normalizeAutoGoalSettings(withAutoGoalDismissed(current, candidateId, body.dismissed !== false));
      const saved = graphManager.setAutoGoalSettings(projectPath, next);
      if (!saved) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      scheduleCheckpoint();
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('POST /api/auto-goal/dismiss failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /** GET /api/auto-goal/skills/:id — 굳어진 절차의 **본문 원문**(화면이 펼쳐 보일 때). */
  app.get('/api/auto-goal/skills/:id', (req, res) => {
    try {
      const projectPath = typeof req.query['projectPath'] === 'string' ? req.query['projectPath'] : '';
      const id = typeof req.params['id'] === 'string' ? req.params['id'] : '';
      if (!projectPath || !id) {
        res.status(400).json({ ok: false, error: 'projectPath and id required' });
        return;
      }
      const root = graphManager.resolveAutoGoalRoot(projectPath);
      if (!root) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      const body = readAutoGoalSkillBody(root, id);
      if (body === null) {
        res.status(404).json({ ok: false, error: 'skill not found' });
        return;
      }
      res.json({ ok: true, body });
    } catch (err) {
      logger.error('GET /api/auto-goal/skills/:id failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /**
   * DELETE /api/auto-goal/skills/:id — 굳어진 절차 한 장을 지운다. 사용자만 지운다 — 자동 삭제 경로는 없다(총량은 `AUTO_GOAL_SKILL_BUDGET` 으로 묶고 넘치면 더 짓지 않을 뿐, §5.10).
   * 지운 절차는 함께 물려 둔다 — 안 그러면 다음 분석이 곧바로 다시 짓는다.
   */
  app.delete('/api/auto-goal/skills/:id', (req, res) => {
    try {
      const projectPath = typeof req.query['projectPath'] === 'string' ? req.query['projectPath'] : '';
      const id = typeof req.params['id'] === 'string' ? req.params['id'] : '';
      const candidateId = typeof req.query['candidateId'] === 'string' ? req.query['candidateId'] : '';
      if (!projectPath || !id) {
        res.status(400).json({ ok: false, error: 'projectPath and id required' });
        return;
      }
      const root = graphManager.resolveAutoGoalRoot(projectPath);
      if (!root) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      const storedCandidateId = listAutoGoalSkills(root).find((skill) => skill.id === id)?.candidateId ?? candidateId;
      const removed = deleteAutoGoalSkill(root, id);
      if (storedCandidateId) {
        const current = graphManager.getAutoGoalSettings(root) ?? {};
        const next = normalizeAutoGoalSettings(withAutoGoalDismissed(current, storedCandidateId, true));
        graphManager.setAutoGoalSettings(root, next);
        scheduleCheckpoint();
      }
      broadcastSnapshot();
      res.json({ ok: true, removed });
    } catch (err) {
      logger.error('DELETE /api/auto-goal/skills/:id failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });


  // ─── §5.3 #10-4 오케스트라(지휘 모드) — 켬/끔 2층 · 세부 설정 · 계획 신고 ───

  /**
   * POST /api/orchestra/scope — 켬/끔 한 칸. body `{ projectPath, scope: 'project'|'agent', id?, enabled: true|false|null }`.
   * `null` 은 그 칸을 지운다(= 상속으로 되돌린다). **사용자만 바꾼다** — 에이전트가 loopback 으로 스스로
   * 켜고 끌 수 있으면 스위치가 아무 뜻이 없어진다(403).
   */
  app.post('/api/orchestra/scope', (req, res) => {
    try {
      if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) {
        res.status(403).json({ ok: false, error: 'orchestra-settings-user-only' });
        return;
      }
      const body = (req.body ?? {}) as { projectPath?: unknown; scope?: unknown; id?: unknown; enabled?: unknown };
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
      const scope = (ORCHESTRA_SCOPE_ORDER as readonly unknown[]).includes(body.scope) ? (body.scope as OrchestraScope) : null;
      if (!projectPath || !scope) {
        res.status(400).json({ ok: false, error: 'projectPath and scope required' });
        return;
      }
      const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null;
      if (scope === 'agent' && !id) {
        res.status(400).json({ ok: false, error: 'id required for agent scope' });
        return;
      }
      const enabled = body.enabled === null ? null : body.enabled === true ? true : body.enabled === false ? false : undefined;
      if (enabled === undefined) {
        res.status(400).json({ ok: false, error: 'enabled must be true, false or null' });
        return;
      }
      const orchestraRoot = graphManager.resolveAutoGoalRoot(projectPath);
      if (!orchestraRoot) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      // 에이전트 칸은 **그 프로젝트의 에이전트**에만 적는다 — 아무 id 나 받으면 맵이 쓰레기로 찬다.
      if (scope === 'agent' && id && !samePath(graphManager.getOrchestraRootForAgent(id) ?? '', orchestraRoot)) {
        res.status(404).json({ ok: false, error: 'agent not in project' });
        return;
      }
      const current = graphManager.getOrchestraSettings(orchestraRoot) ?? {};
      const saved = graphManager.setOrchestraSettings(
        orchestraRoot,
        normalizeOrchestraSettings(withOrchestraScope(current, scope, id, enabled)),
      );
      if (!saved) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      scheduleCheckpoint();
      broadcastSnapshot();
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('POST /api/orchestra/scope failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/orchestra/settings — 세부 설정 칸 몇 개를 갈아 끼운다. body `{ projectPath, patch }`.
   * 켬/끔 칸은 여기서 받지 않는다(`/scope` 한 길 — 두 창구가 같은 칸을 쓰면 한쪽이 다른 쪽을 덮는다).
   * 모양이 어긋난 칸은 조용히 버리지 않고 그 칸 이름으로 400. **사용자만 바꾼다**(403).
   */
  app.put('/api/orchestra/settings', (req, res) => {
    try {
      if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) {
        res.status(403).json({ ok: false, error: 'orchestra-settings-user-only' });
        return;
      }
      const body = (req.body ?? {}) as { projectPath?: unknown; patch?: unknown };
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
      if (!projectPath) {
        res.status(400).json({ ok: false, error: 'projectPath required' });
        return;
      }
      const orchestraRoot = graphManager.resolveAutoGoalRoot(projectPath);
      if (!orchestraRoot) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      const patched = applyOrchestraSettingsPatch(graphManager.getOrchestraSettings(orchestraRoot) ?? {}, body.patch, Date.now());
      if (!patched.ok) {
        res.status(400).json({ ok: false, error: 'invalid-field', field: patched.field });
        return;
      }
      const saved = graphManager.setOrchestraSettings(orchestraRoot, patched.settings);
      if (!saved) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      scheduleCheckpoint();
      broadcastSnapshot();
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('PUT /api/orchestra/settings failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  // ─── §5.3 #10-5 설정 덜어내기 — 켬/끔 3층 · 규칙 끄기 ───

  /**
   * POST /api/config-trim/scope — 켬/끔 한 칸.
   * body `{ projectPath, scope: 'project'|'agent'|'session', id?, enabled: true|false|null }`.
   * `null` 은 그 칸을 지운다(= 윗단 물려받기로 되돌린다). **사용자만 바꾼다** — 에이전트가 loopback 으로
   * 스스로 켜고 끌 수 있으면 스위치가 아무 뜻이 없어진다(403).
   */
  app.post('/api/config-trim/scope', (req, res) => {
    try {
      if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) {
        res.status(403).json({ ok: false, error: 'config-trim-settings-user-only' });
        return;
      }
      const body = (req.body ?? {}) as { projectPath?: unknown; scope?: unknown; id?: unknown; agentId?: unknown; enabled?: unknown };
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
      const scope = (CONFIG_TRIM_SCOPE_ORDER as readonly unknown[]).includes(body.scope)
        ? (body.scope as ConfigTrimScope) : null;
      if (!projectPath || !scope) {
        res.status(400).json({ ok: false, error: 'projectPath and scope required' });
        return;
      }
      // 에이전트·세션 단은 그 id 가 있어야 칸을 만든다 — 없으면 어느 칸을 켰는지 아무도 모르는 값이 남는다.
      const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null;
      if (scope !== 'project' && !id) {
        res.status(400).json({ ok: false, error: 'id required for agent/session scope' });
        return;
      }
      const enabled = body.enabled === null ? null : body.enabled === true ? true : body.enabled === false ? false : undefined;
      if (enabled === undefined) {
        res.status(400).json({ ok: false, error: 'enabled must be true, false or null' });
        return;
      }
      const trimRoot = graphManager.resolveAutoGoalRoot(projectPath);
      if (!trimRoot) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      // 에이전트 칸은 **그 프로젝트의 에이전트**에만 적는다 — 아무 id 나 받으면 맵이 쓰레기로 찬다.
      if (scope === 'agent' && id && !samePath(graphManager.getConfigTrimRootForAgent(id) ?? '', trimRoot)) {
        res.status(404).json({ ok: false, error: 'agent not in project' });
        return;
      }
      // 세션 칸도 같은 규칙 — 다만 세션 id 만으로는 주인을 되짚을 창구가 없어 agentId 를 함께 받는다.
      //   (화면은 언제나 그 창의 에이전트를 알고 있다. 이걸 안 막으면 남의 프로젝트 세션 칸이 여기 쌓인다.)
      if (scope === 'session') {
        const ownerId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
        if (!ownerId) {
          res.status(400).json({ ok: false, error: 'agentId required for session scope' });
          return;
        }
        if (!samePath(graphManager.getConfigTrimRootForAgent(ownerId) ?? '', trimRoot)) {
          res.status(404).json({ ok: false, error: 'session not in project' });
          return;
        }
      }
      const current = graphManager.getConfigTrimSettings(trimRoot) ?? {};
      const saved = graphManager.setConfigTrimSettings(
        trimRoot,
        normalizeConfigTrimSettings(withConfigTrimScope(current, scope, id ?? undefined, enabled)),
      );
      if (!saved) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      scheduleCheckpoint();
      broadcastSnapshot();
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('POST /api/config-trim/scope failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/config-trim/settings — 규칙 끄기 목록을 갈아 끼운다. body `{ projectPath, patch: { disabledRules } }`.
   * 켬/끔 칸은 여기서 받지 않는다(`/scope` 한 길 — 두 창구가 같은 칸을 쓰면 한쪽이 다른 쪽을 덮는다).
   * 모르는 규칙 id 는 조용히 버리지 않고 그 칸 이름으로 400. **사용자만 바꾼다**(403).
   */
  app.put('/api/config-trim/settings', (req, res) => {
    try {
      if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) {
        res.status(403).json({ ok: false, error: 'config-trim-settings-user-only' });
        return;
      }
      const body = (req.body ?? {}) as { projectPath?: unknown; patch?: unknown };
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : '';
      if (!projectPath) {
        res.status(400).json({ ok: false, error: 'projectPath required' });
        return;
      }
      const trimRoot = graphManager.resolveAutoGoalRoot(projectPath);
      if (!trimRoot) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      const patched = applyConfigTrimSettingsPatch(graphManager.getConfigTrimSettings(trimRoot) ?? {}, body.patch, Date.now());
      if (!patched.ok) {
        res.status(400).json({ ok: false, error: 'invalid-field', field: patched.field });
        return;
      }
      const saved = graphManager.setConfigTrimSettings(trimRoot, patched.settings);
      if (!saved) {
        res.status(404).json({ ok: false, error: 'project not loaded' });
        return;
      }
      scheduleCheckpoint();
      broadcastSnapshot();
      res.json({ ok: true, settings: saved });
    } catch (err) {
      logger.error('PUT /api/config-trim/settings failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /**
   * POST /api/orchestra/runs/:runId/plan — 지휘자의 **계획 신고**(의도·편성·고른 방안과 이유·건너뛴 방안과 이유).
   * 지휘 중인 런에만 한 번 받는다(이미 신고했거나 끝났으면 409). 틀린 id 는 조용히 고치지 않고 그 목록을 돌려줘
   * 지휘자가 스스로 고치게 한다(400 `{error, ids}`). 받아들이면 단계가 `dispatched`(편성 없음이면 `answered`).
   */
  app.post('/api/orchestra/runs/:runId/plan', async (req, res) => {
    try {
      const runId = typeof req.params['runId'] === 'string' ? req.params['runId'] : '';
      const run = runId ? graphManager.findOrchestraRun(runId) : undefined;
      if (!run) {
        res.status(404).json({ ok: false, error: 'orchestra-run-not-found' });
        return;
      }
      if (run.endedAt !== undefined || (run.phase !== 'conducting' && run.phase !== 'dispatched' && run.phase !== 'answered')) {
        res.status(409).json({ ok: false, error: 'orchestra-run-settled', phase: run.phase });
        return;
      }
      const projectAgentIds = new Set(
        graphManager.getSnapshot().agents
          .filter((a) => a.customCreated && a.id !== run.agentId
            && samePath(graphManager.getOrchestraRootForAgent(a.id) ?? '', run.projectPath))
          .map((a) => a.id),
      );
      const result = validateOrchestraPlan(req.body, {
        settings: graphManager.getOrchestraSettings(run.projectPath) ?? {},
        projectAgentIds,
      });
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error, ...(result.ids ? { ids: result.ids } : {}) });
        return;
      }
      const { plan, reusedAgentIds } = result;
      /** 이미 등록된 계획이면 같은 계획인지만 보고 배차 엣지 id 를 다시 돌려준다. */
      const respondReusedPlan = (current: OrchestraRun): void => {
        // A lost HTTP response must not strand a valid plan before its entry dispatch.
        if (JSON.stringify(current.plan) !== JSON.stringify(plan)) {
          res.status(409).json({ ok: false, error: 'orchestra-plan-already-reported', phase: current.phase });
          return;
        }
        const existingEntry = plan.topology !== 'none' && plan.entryAgentId
          ? ensureOrchestraEntryEdge(graphManager, current, plan.entryAgentId) : undefined;
        scheduleCheckpoint();
        broadcastSnapshot();
        res.json({ ok: true, run: current, reused: true, ...(existingEntry ? { dispatchEdgeId: existingEntry.id } : {}) });
      };
      // 재수령은 준비 검사보다 **앞**이다 — 이미 등록한 계획의 배차 엣지를 다시 받는 길까지
      // 엔진 판정으로 막으면, 잠깐의 "모름"에 지휘자가 이어 갈 길을 잃고 런이 보고 없이 닫힌다.
      if (run.phase !== 'conducting') {
        respondReusedPlan(run);
        return;
      }
      // 재사용 멤버도 새 멤버와 같은 엔진·준비 계약을 지킨다(생성 검사만 두면 오래된 버블로 우회된다).
      if (plan.topology !== 'none') {
        const settings = graphManager.getOrchestraSettings(run.projectPath);
        let readiness = currentOrchestraReadiness();
        const reprobed = new Set<OrchestraCliEngine>();
        for (const id of new Set([...run.memberAgentIds, ...reusedAgentIds, ...(plan.entryAgentId ? [plan.entryAgentId] : [])])) {
          const cfg = graphManager.getAgentConfig(id);
          if (!orchestraMemberProviderAllowed(settings, cfg?.provider?.kind, run.engine)) {
            respondOrchestraCheck(res, { ok: false, status: 400, error: 'orchestra-member-engine', ids: [id] });
            return;
          }
          const memberEngine: OrchestraCliEngine = cfg?.provider?.kind === 'codex-cli' ? 'codex' : 'claude';
          let preparation = orchestraEnginePreparation(memberEngine, readiness);
          // 판정이 "모름"이면 막기 전에 엔진당 한 번만 다시 묻는다(부팅 직후 빈 캐시도 여기서 풀린다).
          if (preparation?.action === 'refresh' && !reprobed.has(memberEngine)) {
            reprobed.add(memberEngine);
            await reprobeOrchestraEngine(memberEngine);
            readiness = currentOrchestraReadiness();
            preparation = orchestraEnginePreparation(memberEngine, readiness);
          }
          if (preparation) {
            respondOrchestraCheck(res, { ok: false, status: 409, error: 'orchestra-engine-not-ready', ids: [id], preparation });
            return;
          }
        }
      }
      // 재탐침을 기다리는 사이 런이 움직였을 수 있다 — 지나간 런에 계획을 덧쓰지 않는다.
      const fresh = graphManager.findOrchestraRun(run.runId);
      if (!fresh || fresh.endedAt !== undefined) {
        res.status(409).json({ ok: false, error: 'orchestra-run-settled', phase: fresh?.phase ?? run.phase });
        return;
      }
      if (fresh.phase !== 'conducting') {
        respondReusedPlan(fresh);
        return;
      }
      const graphCheck = checkOrchestraPlanGraph(fresh, plan, reusedAgentIds, Object.values(graphManager.getTaskEdgesSnapshot()));
      if (!graphCheck.ok) {
        respondOrchestraCheck(res, graphCheck);
        return;
      }
      const dispatchEdge = plan.topology !== 'none' && plan.entryAgentId
        ? ensureOrchestraEntryEdge(graphManager, fresh, plan.entryAgentId) : undefined;
      const plannedAt = Date.now();
      const saved = graphManager.updateOrchestraRun(fresh.runId, (r) => applyOrchestraPlan(r, plan, reusedAgentIds, plannedAt));
      if (saved && plan.topology !== 'none') ensureOrchestraMemberReturns(graphManager, saved.memberAgentIds);
      scheduleCheckpoint();
      broadcastSnapshot();
      logger.info(`[orchestra] run ${fresh.runId} plan: ${plan.intent}/${plan.topology}`);
      res.json({ ok: true, run: saved, ...(dispatchEdge ? { dispatchEdgeId: dispatchEdge.id } : {}) });
    } catch (err) {
      logger.error('POST /api/orchestra/runs/:runId/plan failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /** GET /api/debug/free-port?base= — 실제로 비어 있는 디버그 포트. 실제 리슨 여부는 서버만 볼 수 있다 — 클라가 자기 실행 세션 안에서만 보면 밖에서 그 포트를 쓰는 프로세스와 부딪혀 디버거가 엉뚱한 프로세스에 붙는다. */
  app.get('/api/debug/free-port', (req, res) => {
    const base = Number(req.query['base']);
    void findFreePort(Number.isFinite(base) && base > 0 ? base : DEBUG_PORT_BASE)
      .then((port) => res.json({ port }))
      .catch(() => res.status(409).json({ error: 'no-free-port' }));
  });

  /** POST /api/debug/attach — 이미 떠 있는 디버기에 붙는다. `attach:'pid'` 런타임인데 pid 를 모르면 실행 명령에서 뽑은 조각으로 찾아 본다(PTY 로 띄워 우리 손의 pid 는 셸의 것). 못 찾으면 그대로 답한다. */
  app.post('/api/debug/attach', (req, res) => {
    const body = req.body as {
      runId?: string; root?: string; runtime?: string; port?: number; pid?: number; command?: string;
      breakpoints?: unknown;
    };
    if (typeof body.runId !== 'string' || typeof body.root !== 'string' || typeof body.runtime !== 'string') {
      res.status(400).json({ error: 'runId, root, runtime required' });
      return;
    }
    const resolvedRoot = path.resolve(body.root);
    if (!isWithinOpenableRoots(resolvedRoot)) {
      res.status(403).json({ error: 'Path outside project root' });
      return;
    }
    let pid = typeof body.pid === 'number' ? body.pid : undefined;
    if (!pid && typeof body.command === 'string' && body.command.length > 0) {
      pid = findPidByCommandLine(commandFingerprint(body.command)) ?? undefined;
    }
    void debugSessionManager
      .start({
        runId: body.runId,
        projectPath: resolvedRoot,
        runtime: body.runtime as Parameters<typeof debugSessionManager.start>[0]['runtime'],
        ...(typeof body.port === 'number' ? { port: body.port } : {}),
        ...(pid ? { pid } : {}),
        // 붙자마자 걸어 둔다 — 뒤로 미루면 시작 코드의 중단점을 놓친다(붙기 절차 ②).
        ...(Array.isArray(body.breakpoints)
          ? { breakpoints: body.breakpoints as Parameters<typeof debugSessionManager.setBreakpoints>[1] }
          : {}),
      })
      .then((state) => res.json({ session: state }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[debug] attach failed: ${message}`);
        res.status(409).json({ error: message });
      });
  });

  /** POST /api/debug/detach — 세션만 끊는다(디버기는 계속 달린다). */
  app.post('/api/debug/detach', (req, res) => {
    const { sessionId } = req.body as { sessionId?: string };
    if (typeof sessionId !== 'string') {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }
    void debugSessionManager.stop(sessionId).then(() => res.json({ ok: true }));
  });

  /** PUT /api/debug/breakpoints — 프로젝트의 중단점을 저장한다(세션 유무와 무관). 다음에 붙을 때 걸리고 재기동 뒤에도 남아야 해서 여기만 broadcast + saveCheckpoint 를 탄다. */
  app.put('/api/debug/breakpoints', (req, res) => {
    const { projectName, breakpoints } = req.body as { projectName?: string; breakpoints?: unknown };
    if (typeof projectName !== 'string' || !Array.isArray(breakpoints)) {
      res.status(400).json({ error: 'projectName and breakpoints required' });
      return;
    }
    const saved = graphManager.setDebugBreakpoints(
      projectName,
      breakpoints as Parameters<typeof graphManager.setDebugBreakpoints>[1],
    );
    if (!saved) {
      res.status(404).json({ error: 'project not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, breakpoints: saved });
  });

  /** POST /api/debug/breakpoints/push — 살아 있는 세션에 중단점 전량 교체(부분 갱신 ❌ — DAP 축과 같게). */
  app.post('/api/debug/breakpoints/push', (req, res) => {
    const { sessionId, breakpoints } = req.body as { sessionId?: string; breakpoints?: unknown };
    if (typeof sessionId !== 'string' || !Array.isArray(breakpoints)) {
      res.status(400).json({ error: 'sessionId and breakpoints required' });
      return;
    }
    void debugSessionManager
      .setBreakpoints(sessionId, breakpoints as Parameters<typeof debugSessionManager.setBreakpoints>[1])
      .then((verified) => res.json({ breakpoints: verified }))
      .catch((err: unknown) => res.status(409).json({ error: err instanceof Error ? err.message : String(err) }));
  });

  /** POST /api/debug/control — 계속·일시정지·스텝(백엔드 차이는 매니저가 흡수한다). */
  app.post('/api/debug/control', (req, res) => {
    const { sessionId, action } = req.body as { sessionId?: string; action?: string };
    const allowed: DebugControlAction[] = ['continue', 'pause', 'stepOver', 'stepIn', 'stepOut'];
    if (typeof sessionId !== 'string' || !allowed.includes(action as DebugControlAction)) {
      res.status(400).json({ error: 'sessionId and valid action required' });
      return;
    }
    void debugSessionManager
      .control(sessionId, action as DebugControlAction)
      .then(() => res.json({ ok: true }))
      .catch((err: unknown) => res.status(409).json({ error: err instanceof Error ? err.message : String(err) }));
  });

  /** GET /api/debug/scopes?sessionId=&frameId= — 멈춘 프레임의 변수 묶음. */
  app.get('/api/debug/scopes', (req, res) => {
    const sessionId = String(req.query['sessionId'] ?? '');
    const frameId = Number(req.query['frameId']);
    if (!sessionId || !Number.isFinite(frameId)) {
      res.status(400).json({ error: 'sessionId and frameId required' });
      return;
    }
    void debugSessionManager
      .scopes(sessionId, frameId)
      .then((scopes) => res.json({ scopes }))
      .catch((err: unknown) => res.status(409).json({ error: err instanceof Error ? err.message : String(err) }));
  });

  /** GET /api/debug/variables?sessionId=&reference= — 묶음 하나를 펼친다. */
  app.get('/api/debug/variables', (req, res) => {
    const sessionId = String(req.query['sessionId'] ?? '');
    const reference = Number(req.query['reference']);
    if (!sessionId || !Number.isFinite(reference)) {
      res.status(400).json({ error: 'sessionId and reference required' });
      return;
    }
    void debugSessionManager
      .variables(sessionId, reference)
      .then((variables) => res.json({ variables }))
      .catch((err: unknown) => res.status(409).json({ error: err instanceof Error ? err.message : String(err) }));
  });

  /** POST /api/debug/evaluate — 멈춘 자리에서 식을 계산한다. */
  app.post('/api/debug/evaluate', (req, res) => {
    const { sessionId, expression, frameId } = req.body as {
      sessionId?: string; expression?: string; frameId?: number;
    };
    if (typeof sessionId !== 'string' || typeof expression !== 'string' || expression.length === 0) {
      res.status(400).json({ error: 'sessionId and expression required' });
      return;
    }
    void debugSessionManager
      .evaluate(sessionId, expression, typeof frameId === 'number' ? frameId : undefined)
      .then((result) => res.json({ result }))
      .catch((err: unknown) => res.status(409).json({ error: err instanceof Error ? err.message : String(err) }));
  });

  /**
   * POST /api/debug/release — §5.5 #17-20 ⑫ 붙지 않고 그냥 진행. `--inspect-brk` 로 멈춘 Node 프로세스를 재시작 없이 풀어 준다.
   * 다른 런타임(`suspend=y`·`--wait-for-client`)은 디버거가 붙어야만 풀리므로 [디버그 연결]이 답이다 — 거짓 성공을 답하지 않는다.
   */
  app.post('/api/debug/release', (req, res) => {
    const { port } = req.body as { port?: number };
    if (typeof port !== 'number' || !Number.isFinite(port)) {
      res.status(400).json({ error: 'port required' });
      return;
    }
    void releaseWaitingNodeProcess(port).then((result) => {
      if (!result.ok) {
        res.status(409).json({ error: result.error ?? 'release failed' });
        return;
      }
      res.json({ ok: true });
    });
  });

  /** POST /api/satellite/toggle — 위성 표시 토글 */
  app.post('/api/satellite/toggle', (req, res) => {
    try {
      const { folderPath, filePath, show, absolutePath } = req.body as {
        folderPath?: string;
        filePath?: string;
        show?: boolean;
        /** 그 폴더의 절대경로 — 인스턴스 라우팅 힌트(같은 이름의 폴더가 여러 프로젝트에 있을 때). */
        absolutePath?: string | null;
      };
      if (typeof folderPath !== 'string' || typeof filePath !== 'string' || typeof show !== 'boolean') {
        res.status(400).json({ error: 'folderPath, filePath, show required' });
        return;
      }
      const ok = graphManager.toggleSatellite(
        folderPath, filePath, show,
        typeof absolutePath === 'string' && absolutePath.length > 0 ? absolutePath : null,
      );
      if (!ok) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/satellite/toggle failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/satellite/max — 폴더별 위성 표시 상한 편집 (§7.5) */
  app.post('/api/satellite/max', (req, res) => {
    try {
      const { folderPath, max } = req.body as { folderPath?: string; max?: number };
      if (typeof folderPath !== 'string' || typeof max !== 'number' || !Number.isFinite(max)) {
        res.status(400).json({ error: 'folderPath, max required' });
        return;
      }
      const ok = graphManager.setFolderMaxSatellites(folderPath, max);
      if (!ok) {
        res.status(404).json({ error: 'Folder not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/satellite/max failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── §5.23 도메인 버블 ───

  /** POST /api/domain-entries/max — 도메인 버블별 항목 상한 편집 (§7.22) */
  app.post('/api/domain-entries/max', (req, res) => {
    try {
      const { nodeId, max } = req.body as { nodeId?: string; max?: number };
      if (typeof nodeId !== 'string' || typeof max !== 'number' || !Number.isFinite(max)) {
        res.status(400).json({ error: 'nodeId, max required' });
        return;
      }
      const ok = graphManager.setDomainMaxEntries(nodeId, max);
      if (!ok) {
        res.status(404).json({ error: 'Domain bubble not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/domain-entries/max failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/domain-entries/check — 체크 = 그 항목 제거 (§5.23) */
  app.post('/api/domain-entries/check', (req, res) => {
    try {
      const { nodeId, entryId } = req.body as { nodeId?: string; entryId?: string };
      if (typeof nodeId !== 'string' || typeof entryId !== 'string') {
        res.status(400).json({ error: 'nodeId, entryId required' });
        return;
      }
      const ok = graphManager.removeWebEntry(nodeId, entryId);
      if (!ok) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/domain-entries/check failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/domain-entries/clear — 그 도메인의 항목을 통째로 비운다 (§7.22) */
  app.post('/api/domain-entries/clear', (req, res) => {
    try {
      const { nodeId } = req.body as { nodeId?: string };
      if (typeof nodeId !== 'string') {
        res.status(400).json({ error: 'nodeId required' });
        return;
      }
      const ok = graphManager.clearWebEntries(nodeId);
      if (!ok) {
        res.status(404).json({ error: 'Domain bubble not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/domain-entries/clear failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/file-edits/unlimited — 파일 버블별 diff 무한 저장 토글 (§7.4) */
  app.post('/api/file-edits/unlimited', (req, res) => {
    try {
      const { nodePath, unlimited } = req.body as { nodePath?: string; unlimited?: boolean };
      if (typeof nodePath !== 'string' || typeof unlimited !== 'boolean') {
        res.status(400).json({ error: 'nodePath, unlimited required' });
        return;
      }
      const ok = graphManager.setFileEditsUnlimited(nodePath, unlimited);
      if (!ok) {
        res.status(404).json({ error: 'File node not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/file-edits/unlimited failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/command-history/unlimited — 명령 앱 버블별 명령 목록 체크박스(§5.1 명령 앱 · §7.3 — file-edits/unlimited 미러) */
  app.post('/api/command-history/unlimited', (req, res) => {
    try {
      const { nodeId, unlimited } = req.body as { nodeId?: unknown; unlimited?: unknown };
      if (typeof nodeId !== 'string' || typeof unlimited !== 'boolean') {
        res.status(400).json({ error: 'nodeId, unlimited required' });
        return;
      }
      const ok = graphManager.setCommandHistoryUnlimited(nodeId, unlimited);
      if (!ok) {
        res.status(404).json({ error: 'Command bubble not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/command-history/unlimited failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/root/toggle — 루트 패널에서 독립 버블 추가/제거 (폴더 내부 Root도 지원) */
  app.post('/api/root/toggle', (req, res) => {
    try {
      const { projectName, filePath, show, parentPath, absolutePath } = req.body as {
        projectName?: string;
        filePath?: string;
        show?: boolean;
        parentPath?: string;
        /** 목록을 뽑아 온 그 폴더/루트의 절대경로 — 인스턴스 라우팅 힌트(프로젝트 컨텍스트 보존). */
        absolutePath?: string | null;
      };
      if (typeof projectName !== 'string' || typeof filePath !== 'string' || typeof show !== 'boolean') {
        res.status(400).json({ error: 'projectName, filePath, show required' });
        return;
      }
      const absHint = typeof absolutePath === 'string' && absolutePath.length > 0 ? absolutePath : null;
      const ok = typeof parentPath === 'string'
        ? graphManager.toggleFolderChild(parentPath, filePath, show, absHint)
        : graphManager.toggleRootChild(projectName, filePath, show, absHint);
      if (!ok) {
        logger.warn(`root/toggle miss: project="${projectName}" file="${filePath}" parent="${parentPath ?? '-'}" abs="${absHint ?? '-'}"`);
        res.status(404).json({ error: 'File not found' });
        return;
      }
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/root/toggle failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/tokens/:sessionId — 세션 토큰 사용량 데이터 */
  app.get('/api/tokens/:sessionId', (req, res) => {
    try {
      const { sessionId } = req.params;
      const cwd = graphManager.getAgentCwd(sessionId);
      const empty: SessionTokenData = { sessionId, turns: [], categories: [] };
      if (!cwd) {
        res.json(empty);
        return;
      }
      res.json(readSessionTokenData(cwd, sessionId) ?? empty);
    } catch (err) {
      logger.error('GET /api/tokens failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/app-state — 현재 서버의 탭 라이프사이클 상태 반환 */
  app.get('/api/app-state', (_req, res) => {
    try {
      res.json(publicAppState(loadAppState())); // §4 API 크레딧 — 키가 든 칸은 빼고 보낸다.
    } catch (err) {
      logger.error('GET /api/app-state failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // §3.2.3 보존 정책 — 모든 축을 사용자가 조절하고 `0` 이면 그 축은 정리하지 않는다(Claude Code 가 `cleanupPeriodDays` 를 끌 수 없게 해 반발을 산 자리 #59248·#64999 를 비껴간다).

  /** GET /api/retention-settings — 현재 설정 + 입력 한계 + 기본값(설정 UI 가 "되돌리기"에 쓴다). */
  app.get('/api/retention-settings', (_req, res) => {
    try {
      res.json({
        settings: appStateGetRetention(),
        limits: RETENTION_LIMITS,
        defaults: DEFAULT_RETENTION_SETTINGS,
      });
    } catch (err) {
      logger.error('GET /api/retention-settings failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /api/retention-settings — 부분 갱신. 정규화(범위 클램프)는 shared 한 곳에서. */
  app.put('/api/retention-settings', (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // §5.26 — 보존 축에 **숫자가 아닌 칸**이 생겼다(`insuranceMirror` 스위치). 종전처럼 숫자만
      //   받으면 그 스위치는 화면에서 눌러도 서버에 영영 닿지 않는다 — 값의 종류로 갈라 받는다.
      const patch: Record<string, number | boolean> = {};
      for (const key of Object.keys(DEFAULT_RETENTION_SETTINGS)) {
        const v = body[key];
        if (typeof v === 'number' && Number.isFinite(v)) patch[key] = v;
        else if (typeof v === 'boolean') patch[key] = v;
      }
      const settings = appStateSetRetention(patch as Partial<typeof DEFAULT_RETENTION_SETTINGS>);
      // 상한이 내려갔으면 즉시 반영해야 "적용했는데 그대로다"로 보이지 않는다.
      for (const inst of graphManager.getInstancesForRetention()) inst.pruneFileEditRetention();
      // §5.22 감사 원장도 같은 자리에서 — 조용한 프로젝트는 다음 도구 호출까지 옛 크기 그대로다.
      graphManager.applyAuditRetention();
      // §5.26 보험 저장고도 같은 자리에서 — 여기가 유일하게 "예산을 줄였다"를 아는 순간이라,
      //   빠뜨리면 사용자가 256MB 를 64MB 로 내려도 디스크는 그대로 남는다.
      if (graphManager.applyInsuranceRetention()) saveCheckpoint();
      broadcastSnapshot();
      res.json({ settings, limits: RETENTION_LIMITS, defaults: DEFAULT_RETENTION_SETTINGS });
    } catch (err) {
      logger.error('PUT /api/retention-settings failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // §5.3 #9-1 토큰 절약 — 보존 정책(§3.2.3)과 같은 모양의 창구(머신 단위 설정 하나, 정규화는 shared 한 곳, `0` = 그 축 끔). 대상이 디스크가 아니라 스폰 정책일 뿐이다.

  /** GET /api/token-saver-settings — 현재 설정 + 입력 한계 + 기본값 + 프리셋 세 벌. */
  app.get('/api/token-saver-settings', (_req, res) => {
    try {
      res.json({
        settings: appStateGetTokenSaver(),
        limits: TOKEN_SAVER_LIMITS,
        defaults: DEFAULT_TOKEN_SAVER_SETTINGS,
        presets: TOKEN_SAVER_PRESET_VALUES,
      });
    } catch (err) {
      logger.error('GET /api/token-saver-settings failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/token-saver-settings — 부분 갱신. 정규화(범위 클램프·바닥·프리셋 재판정)는 shared 한 곳.
   * `preset` 이름을 주면 그 벌의 값으로 통째 교체(칸을 하나씩 보낸 것과 같은 결과라 판정 경로가 하나다). 이름과 개별 값이 함께 오면 개별 값이 이긴다 — 프리셋을 고른 뒤 한 칸을 고친 순서를 따른다.
   */
  app.put('/api/token-saver-settings', (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const presetName = typeof body['preset'] === 'string' ? String(body['preset']) : '';
      const base = (presetName === 'off' || presetName === 'balanced' || presetName === 'saver')
        ? TOKEN_SAVER_PRESET_VALUES[presetName]
        : appStateGetTokenSaver();
      const { preset: _ignoredPreset, ...baseValues } = base;
      const patch: Record<string, number | boolean | string> = { ...baseValues };
      for (const key of Object.keys(DEFAULT_TOKEN_SAVER_SETTINGS)) {
        const v = body[key];
        if (typeof v === 'number' && Number.isFinite(v)) patch[key] = v;
        else if (typeof v === 'boolean') patch[key] = v;
        // (Q) 압축 창은 문자열 축이다 — 목록 밖 값은 정규화가 '' 로 되돌린다.
        else if (typeof v === 'string' && key === 'autoCompactWindow') patch[key] = v;
      }
      delete patch['preset']; // 값에서 다시 판정한다 — 들어온 이름을 그대로 믿지 않는다(위에서 이미 뺐다).
      const settings = appStateSetTokenSaver(patch as Partial<typeof DEFAULT_TOKEN_SAVER_SETTINGS>);
      // 상한이 **올라갔으면** 기다리던 명령이 지금 나갈 수 있다 — 여기가 그것을 아는 유일한 순간이다
      // (다음 턴 종료까지 기다리면 "적용했는데 아무 일도 안 일어난다"로 보인다).
      pumpTokenSaverQueues();
      broadcastSnapshot();
      res.json({
        settings,
        limits: TOKEN_SAVER_LIMITS,
        defaults: DEFAULT_TOKEN_SAVER_SETTINGS,
        presets: TOKEN_SAVER_PRESET_VALUES,
      });
    } catch (err) {
      logger.error('PUT /api/token-saver-settings failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // §6 단축키 재매핑 — 정본은 `shared/keymap.ts` 의 `COMMANDS` 표. 서버는 사용자가 바꾼 것만 든다 — 기본값은 코드에 있어, 기본 바인딩을 고치면 안 건드린 칸이 자동으로 새 값을 따라간다.

  /** GET /api/keymap — 사용자 덮어쓰기 + 기본값(설정 UI 가 "되돌리기"에 쓴다). */
  app.get('/api/keymap', (_req, res) => {
    try {
      res.json({ overrides: appStateGetKeymap(), defaults: defaultKeymap(process.platform) });
    } catch (err) {
      logger.error('GET /api/keymap failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/keymap — 부분 갱신. 본문 `{ overrides?: Record<CommandId, string|null>, reset?: CommandId[] }`.
   * `overrides` 의 `null` 은 해제(키보드에서 내림), `reset` 은 기본값 복귀 — 한 값으로 뭉개면 "되돌리기"가 "해제"가 되어 그 명령을 영영 못 쓴다.
   * 정규화(모르는 명령·못 읽는 바인딩 버리기)는 shared 한 곳.
   */
  app.put('/api/keymap', (req, res) => {
    try {
      const body = (req.body ?? {}) as { overrides?: unknown; reset?: unknown };
      const patch: Record<string, string | null> = {};
      if (body.overrides && typeof body.overrides === 'object' && !Array.isArray(body.overrides)) {
        for (const [id, value] of Object.entries(body.overrides as Record<string, unknown>)) {
          if (!isCommandId(id)) continue;
          if (value === null) patch[id] = null;
          else if (typeof value === 'string') patch[id] = value;
        }
      }
      const reset = Array.isArray(body.reset)
        ? body.reset.filter((id): id is string => typeof id === 'string' && isCommandId(id))
        : [];
      const overrides = appStateSetKeymap(patch, reset);
      // 창이 여럿이면 다른 창도 즉시 같은 키를 써야 한다 — 안 그러면 창마다 다른 단축키가 된다.
      broadcast({ type: 'keymap_updated', timestamp: Date.now(), payload: overrides });
      res.json({ overrides, defaults: defaultKeymap(process.platform) });
    } catch (err) {
      logger.error('PUT /api/keymap failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /api/keymap — 전부 기본값으로. */
  app.delete('/api/keymap', (_req, res) => {
    try {
      const overrides = appStateResetKeymap();
      broadcast({ type: 'keymap_updated', timestamp: Date.now(), payload: overrides });
      res.json({ overrides, defaults: defaultKeymap(process.platform) });
    } catch (err) {
      logger.error('DELETE /api/keymap failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // §5.5 #16-1 IDE 활동바 구성(순서·제외) — 단축키와 같은 모양의 창구(머신 단위, 바꾼 것만 저장, 창이 여럿이면 WS 로 즉시 같은 배치).
  // 서버는 항목 이름을 모른다(문자열 배열만 정규화) — 실재하는 뷰는 클라 정본 표가 판정하므로 칸이 늘어도 이 라우트는 안 고친다(`/api/skill-order` 와 같은 규약).

  /** GET /api/ide-activity-bar — 사용자가 정한 활동바 순서·제외 목록. */
  app.get('/api/ide-activity-bar', (_req, res) => {
    try {
      res.json({ prefs: appStateGetIDEActivityBar() });
    } catch (err) {
      logger.error('GET /api/ide-activity-bar failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /api/ide-activity-bar — 부분 갱신. 본문 `{ order?: string[], hidden?: string[], reset?: true }`. `order`·`hidden` 은 언급한 칸만 치환한다(순서를 바꿨다고 제외 목록이 날아가면 안 된다). */
  app.put('/api/ide-activity-bar', (req, res) => {
    try {
      const body = (req.body ?? {}) as { order?: unknown; hidden?: unknown; reset?: unknown };
      const list = (v: unknown): string[] | undefined => (
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : undefined
      );
      const prefs = body.reset === true
        ? appStateResetIDEActivityBar()
        : appStateSetIDEActivityBar({
          ...(list(body.order) !== undefined ? { order: list(body.order)! } : {}),
          ...(list(body.hidden) !== undefined ? { hidden: list(body.hidden)! } : {}),
        });
      // 창이 여럿이면 다른 창도 즉시 같은 배치를 써야 한다 — 창마다 항목 순서가 다르면 그게 곧 버그다.
      broadcast({ type: 'ide_activity_bar_updated', timestamp: Date.now(), payload: prefs });
      res.json({ prefs });
    } catch (err) {
      logger.error('PUT /api/ide-activity-bar failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── §5.5 #17-9 ⑭ 조용한 백그라운드 작업 판정 ───
  //
  // 모델을 부르는 기능이라 **끌 수 있어야 한다**(§3.2.3 규칙 1 과 같은 선). `quietMinutes: 0` 도 끔.

  /** GET /api/bg-task-probe-settings — 현재 설정 + 입력 한계 + 기본값(설정 UI 의 "되돌리기"용). */
  app.get('/api/bg-task-probe-settings', (_req, res) => {
    try {
      res.json({
        settings: appStateGetBgTaskProbe(),
        limits: BG_TASK_PROBE_LIMITS,
        models: BG_TASK_PROBE_MODELS,
        defaults: DEFAULT_BG_TASK_PROBE_SETTINGS,
      });
    } catch (err) {
      logger.error('GET /api/bg-task-probe-settings failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /api/bg-task-probe-settings — 부분 갱신. 정규화(범위·목록)는 shared 한 곳에서. */
  app.put('/api/bg-task-probe-settings', (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Partial<BackgroundTaskProbeSettings> = {};
      for (const key of ['enabled', 'autoClose', 'killProcess'] as const) {
        if (typeof body[key] === 'boolean') patch[key] = body[key] as boolean;
      }
      if (typeof body['quietMinutes'] === 'number') patch.quietMinutes = body['quietMinutes'] as number;
      if (typeof body['model'] === 'string') patch.model = body['model'] as string;
      const settings = appStateSetBgTaskProbe(patch);
      // 저장과 동시에 판정부에 먹인다 — 다음 회차부터 곧바로 새 값으로 돈다.
      subAgentManager.setBackgroundTaskProbeSettings(settings);
      res.json({
        settings,
        limits: BG_TASK_PROBE_LIMITS,
        models: BG_TASK_PROBE_MODELS,
        defaults: DEFAULT_BG_TASK_PROBE_SETTINGS,
      });
    } catch (err) {
      logger.error('PUT /api/bg-task-probe-settings failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── §2.4 "실행중…"이 진짜인가 — 세션 생존 판정 ───
  //
  // 위와 같은 이유로 **끌 수 있어야 한다**. 끄면 모델 호출이 0 이 되고 종전 동작으로 돌아간다.

  /** GET /api/session-probe-settings — 현재 설정 + 입력 한계 + 기본값(설정 UI 의 "되돌리기"용). */
  app.get('/api/session-probe-settings', (_req, res) => {
    try {
      res.json({
        settings: appStateGetSessionProbe(),
        limits: SESSION_PROBE_LIMITS,
        models: SESSION_PROBE_MODELS,
        defaults: DEFAULT_SESSION_PROBE_SETTINGS,
      });
    } catch (err) {
      logger.error('GET /api/session-probe-settings failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /api/session-probe-settings — 부분 갱신. 정규화(범위·목록)는 shared 한 곳에서. */
  app.put('/api/session-probe-settings', (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Partial<SessionLivenessProbeSettings> = {};
      for (const key of ['enabled', 'autoClose'] as const) {
        if (typeof body[key] === 'boolean') patch[key] = body[key] as boolean;
      }
      if (typeof body['quietMinutes'] === 'number') patch.quietMinutes = body['quietMinutes'] as number;
      if (typeof body['model'] === 'string') patch.model = body['model'] as string;
      const settings = appStateSetSessionProbe(patch);
      // 저장과 동시에 판정부에 먹인다 — 다음 회차부터 곧바로 새 값으로 돈다.
      subAgentManager.setSessionProbeSettings(settings);
      res.json({
        settings,
        limits: SESSION_PROBE_LIMITS,
        models: SESSION_PROBE_MODELS,
        defaults: DEFAULT_SESSION_PROBE_SETTINGS,
      });
    } catch (err) {
      logger.error('PUT /api/session-probe-settings failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── §5.3 #9-2 에이전트가 띄운 프로세스의 보호 (묶음 · 메모리 상한 · 정리) ───
  //
  // 프로세스를 자동으로 끊는 기능이라 위 판정들과 같은 이유로 **끌 수 있어야 한다**.

  /** GET /api/process-guard-settings — 현재 설정 + 입력 한계 + 기본값(설정 UI 의 "되돌리기"용). */
  app.get('/api/process-guard-settings', (_req, res) => {
    try {
      res.json({
        settings: appStateGetProcessGuard(),
        limits: PROCESS_GUARD_LIMITS,
        defaults: DEFAULT_PROCESS_GUARD_SETTINGS,
        // 설정 UI 가 "이 컴퓨터에서 실제 상한"을 같은 shared 함수로 미리 보여 주도록 실메모리 총량을 싣는다.
        totalMemBytes: os.totalmem(),
      });
    } catch (err) {
      logger.error('GET /api/process-guard-settings failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PUT /api/process-guard-settings — 부분 갱신. 정규화(범위)는 shared 한 곳에서. */
  app.put('/api/process-guard-settings', (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Partial<ProcessGuardSettings> = {};
      for (const key of ['enabled', 'pressureKill', 'reapOnSessionEnd'] as const) {
        if (typeof body[key] === 'boolean') patch[key] = body[key] as boolean;
      }
      if (typeof body['memoryCapPercent'] === 'number') patch.memoryCapPercent = body['memoryCapPercent'] as number;
      const settings = appStateSetProcessGuard(patch);
      // 저장과 동시에 감시에 먹인다 — 이미 떠 있는 묶음의 상한·닫힘 동작도 곧바로 바뀐다.
      processGuard.setSettings(settings);
      res.json({ settings, limits: PROCESS_GUARD_LIMITS, defaults: DEFAULT_PROCESS_GUARD_SETTINGS, totalMemBytes: os.totalmem() });
    } catch (err) {
      logger.error('PUT /api/process-guard-settings failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §2.1 (B) — GET /api/external-folder-budget
   * 최상위에 동시에 세울 외부 폴더 예산 + 입력 범위 + 기본값(설정 UI 의 "되돌리기"용).
   */
  app.get('/api/external-folder-budget', (_req, res) => {
    try {
      res.json({
        budget: appStateGetExternalTopBudget(),
        bounds: EXTERNAL_TOP_BUDGET_BOUNDS,
        defaults: EXTERNAL_TOP_BUDGET_DEFAULT,
      });
    } catch (err) {
      logger.error('GET /api/external-folder-budget failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §2.1 (B) — PUT /api/external-folder-budget. 정규화(범위 클램프)는 shared 한 곳에서. */
  app.put('/api/external-folder-budget', (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const budget = appStateSetExternalTopBudget(body['budget']);
      // 저장과 동시에 그래프에 먹인다 — 트리가 곧바로 다시 서고 다음 스냅샷부터 새 밀도로 그려진다.
      graphManager.setExternalTopBudget(budget);
      broadcastSnapshot();
      res.json({ budget, bounds: EXTERNAL_TOP_BUDGET_BOUNDS, defaults: EXTERNAL_TOP_BUDGET_DEFAULT });
    } catch (err) {
      logger.error('PUT /api/external-folder-budget failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.23 웹 버블 묶기 — GET /api/web-fold. 같은 사이트 · 비슷한 종류 · 에이전트마다 최대 N개(머신 단위 앱 설정) + 되돌리기용 기본값 + 최대 개수의 범위.
   * §5.23 「더블클릭」 — 같은 칸의 [더블클릭하면 열 곳](`openTarget`)과 그 기본값도 싣는다(옵션창 한 칸 = 창구 하나).
   */
  app.get('/api/web-fold', (_req, res) => {
    try {
      res.json({
        group: appStateGetWebGroup(),
        defaults: WEB_GROUP_DEFAULTS,
        bounds: WEB_GROUP_MAX_BOUNDS,
        openTarget: appStateGetWebOpenTarget(),
        openTargetDefault: WEB_OPEN_TARGET_DEFAULT,
      });
    } catch (err) {
      logger.error('GET /api/web-fold failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.23 웹 버블 묶기 — PUT /api/web-fold `{ group?, openTarget? }`. **준 칸만 바꾼다**(빠진 칸은 지금 값 유지),
   * 정규화(범위 클램프·모르는 값)는 shared 한 곳에서. 둘은 서로 다른 일을 깨운다 — 묶기는 그래프의 판을 올리고,
   * 여는 곳은 창들에 알리기만 한다(스냅샷 모양과 무관하다).
   */
  app.put('/api/web-fold', (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      let group = appStateGetWebGroup();
      if (body['group'] !== undefined) {
        group = appStateSetWebGroup(body['group']);
        // 저장과 동시에 그래프에 먹인다 — 판이 올라 다음 스냅샷부터 묶인(또는 풀린) 모양으로 그려진다.
        graphManager.setWebGroupSettings(group);
        broadcastSnapshot();
      }
      let openTarget = appStateGetWebOpenTarget();
      if (body['openTarget'] !== undefined) {
        openTarget = appStateSetWebOpenTarget(body['openTarget']);
        // 창이 여럿이면 다른 창도 즉시 같은 곳에서 연다(단축키 `keymap_updated` 와 같은 길).
        broadcast({ type: 'web_open_target_updated', timestamp: Date.now(), payload: openTarget });
      }
      res.json({
        group,
        defaults: WEB_GROUP_DEFAULTS,
        bounds: WEB_GROUP_MAX_BOUNDS,
        openTarget,
        openTargetDefault: WEB_OPEN_TARGET_DEFAULT,
      });
    } catch (err) {
      logger.error('PUT /api/web-fold failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/storage-usage — 어디가 몇 MB 인지 실측(디스크를 훑으므로 사용자가 열 때만 돈다). */
  app.get('/api/storage-usage', (_req, res) => {
    try {
      const stubInfos = Object.values(graphManager.getStubProjects()).map((m) => m.project);
      const report = scanStorageUsage([...Object.values(graphManager.getProjects()), ...stubInfos]);
      res.json(report);
    } catch (err) {
      logger.error('GET /api/storage-usage failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/storage-cleanup — 사용자가 [정리] 를 눌렀을 때. 무엇을 얼마나 지웠는지 그대로 돌려준다. */
  app.post('/api/storage-cleanup', (_req, res) => {
    try {
      const result = runProjectStorageCleanup();
      let removedEdits = 0;
      let removedPaths = 0;
      for (const inst of graphManager.getInstancesForRetention()) {
        const r = inst.pruneFileEditRetention();
        removedEdits += r.removedEdits;
        removedPaths += r.removedPaths;
      }
      if (removedEdits > 0 || removedPaths > 0) {
        // 편집 이력은 파일이 아니라 체크포인트 안쪽이라 `removedFiles` 로 셀 수 없다 —
        // 사용자가 "무엇이 정리됐는지" 알 수 있게 별도 줄로 보고한다.
        result.skipped.push(`fileEdits:${removedEdits} edit(s), ${removedPaths} path(s)`);
        saveCheckpoint(); // 줄어든 이력을 디스크에 반영해야 실제 용량이 준다
        broadcastSnapshot();
      }
      res.json(result);
    } catch (err) {
      logger.error('POST /api/storage-cleanup failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** 열린 프로젝트 + stub 전체 — 저장소 계열 라우트가 같은 목록을 봐야 "있는데 안 보인다"가 안 생긴다. */
  function allProjectInfosForStorage(): ProjectInfo[] {
    const stubInfos = Object.values(graphManager.getStubProjects()).map((m) => m.project);
    return [...Object.values(graphManager.getProjects()), ...stubInfos];
  }

  /**
   * GET /api/retention-trash — 휴지통 목록(= 복원 가능한 것). §3.2.3 규칙 4 "조용히 지우지 않는다".
   * 기록 파일 없이 휴지통 폴더를 훑어 만든다 — 파일 자체가 사실이라 기록과 실제가 어긋날 수 없다.
   */
  app.get('/api/retention-trash', (_req, res) => {
    try {
      res.json(listTrash(allProjectInfosForStorage()));
    } catch (err) {
      logger.error('GET /api/retention-trash failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/retention-trash/restore — 휴지통에서 원래 자리로 되살린다.
   * body `{ projectPath, trashRel }`. 원래 자리에 파일이 있으면 **덮어쓰지 않고** 실패로 돌려준다.
   */
  app.post('/api/retention-trash/restore', (req, res) => {
    try {
      const { projectPath, trashRel } = (req.body ?? {}) as { projectPath?: string; trashRel?: string };
      if (typeof projectPath !== 'string' || typeof trashRel !== 'string' || !projectPath || !trashRel) {
        res.status(400).json({ error: 'projectPath, trashRel required' });
        return;
      }
      // 경로 대조 — linux 에서 접으면 케이스만 다른 다른 프로젝트의 휴지통을 되살릴 수 있다.
      const target = path.resolve(projectPath);
      const info = allProjectInfosForStorage().find((p) => samePath(path.resolve(p.path), target));
      if (!info) {
        res.status(404).json({ error: 'project not found' });
        return;
      }
      const result = restoreFromTrash(info, trashRel);
      if (!result.ok) {
        res.status(400).json({ error: result.error ?? 'restore failed' });
        return;
      }
      logger.info(`retention trash restored: ${trashRel} → ${result.restoredTo}`);
      res.json(result);
    } catch (err) {
      logger.error('POST /api/retention-trash/restore failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/app-state — lastActiveProject / defaultProject / pinnedProjects 부분 업데이트.
   * body는 `AppStatePatch` (Partial<AppState>). 배열 필드는 치환(전체 목록).
   * openProjects는 서버가 lifecycle로 관리하므로 클라에서 직접 조작하지 않음 (요청 들어와도 무시).
   */
  app.patch('/api/app-state', (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      const patch: { lastActiveProject?: string | null; defaultProject?: string | null; pinnedProjects?: string[] } = {};
      if ('lastActiveProject' in body) {
        const v = body['lastActiveProject'];
        if (v === null || typeof v === 'string') patch.lastActiveProject = v;
      }
      if ('defaultProject' in body) {
        const v = body['defaultProject'];
        if (v === null || typeof v === 'string') patch.defaultProject = v;
      }
      if ('pinnedProjects' in body) {
        const v = body['pinnedProjects'];
        if (Array.isArray(v) && v.every((n) => typeof n === 'string')) patch.pinnedProjects = v as string[];
      }
      const updated = patchAppState(patch);
      res.json(publicAppState(updated)); // §4 API 크레딧 — 키가 든 칸은 빼고 보낸다.
      broadcastSnapshot();
    } catch (err) {
      logger.error('PATCH /api/app-state failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/projects/order — §5.4 #14-2 (C-1) 프로젝트 탭 순서 저장(끌어서 놓은 순서, 재기동 뒤에도 그 자리).
   * body `{ order: string[] }` = 화면에 선 탭의 경로(보이는 순서). 순서만 바꾼다 — 목록 치환 ❌(`PATCH /api/app-state` 가 `openProjects` 를 받지 않는 규약, `appStateReorderOpenProjects`).
   * 바뀐 것이 있을 때만 저장·방송한다 — 클라는 방송된 순서가 놓은 순서를 따르면 붙들기를 놓는다.
   */
  app.patch('/api/projects/order', (req, res) => {
    try {
      const body = req.body as { order?: unknown } | undefined;
      const raw = body?.order;
      if (!Array.isArray(raw)) {
        res.status(400).json({ ok: false, error: 'order must be string[]' });
        return;
      }
      const order = raw.filter((p): p is string => typeof p === 'string' && p.length > 0);
      const changed = appStateReorderOpenProjects(order);
      if (changed) {
        logger.info(`AppState: openProjects reordered (${order.length} tab(s))`);
        broadcastSnapshot();
      }
      res.json({ ok: true, changed });
    } catch (err) {
      logger.error('PATCH /api/projects/order failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /** DELETE /api/projects/:name — 프로젝트 탭 닫기 (데이터 보존, 스냅샷에서만 숨김 + AppState에서 제거) */
  app.delete('/api/projects/:name', (req, res) => {
    try {
      // 클라는 projectId(path)를 보낸다. path 우선 해소, 이름 폴백.
      const ref = decodeURIComponent(req.params.name);
      const resolved = graphManager.resolveProjectRef(ref);
      const rawName = resolved?.rawName ?? ref;
      const idPath = resolved?.path ?? ref;
      // hydrated / stub / appState 어느 쪽이든 걸리면 정리 — 모두 실패면 404.
      const hidden = graphManager.hideProject(rawName);
      const stubRemoved = graphManager.removeStubFromMap(rawName);
      const appStateRemoved = appStateRemoveOpenProject(idPath);
      if (!hidden && !stubRemoved && !appStateRemoved) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      if (appStateRemoved) logger.info(`AppState: openProjects -= ${idPath} ("${rawName}")`);
      // §5.4 #14-4 — 닫은 탭을 "다시 열기" 스택에 올리는 유일한 등록 지점 — × 버튼·컨텍스트 메뉴(닫기/다른 탭/좌우/모두)·별창 X(#14-1 (E))가 전부 이 DELETE 를 지난다.
      //   분리(detach)는 이 길로 오지 않는다 — 분리는 닫기가 아니라 표시 라우팅(#14-1 (F))이라 스택에 들어가면 안 된다.
      appStatePushClosedTab({
        key: `p:${rawName}`,
        kind: 'project',
        label: rawName,
        closedAt: Date.now(),
        path: idPath,
      });
      res.json({ ok: true });
      broadcastSnapshot();
      saveCheckpoint();
    } catch (err) {
      logger.error('DELETE /api/projects/:name failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // §5.4 #14-4 "닫은 탭 다시 열기"(브라우저 Ctrl+Shift+T 와 같은 동작). 목록 SSOT 는 머신 단위 `AppState.recentlyClosedTabs` — 클라는 스냅샷의 목록을 그리기만 한다.
  // 프로젝트 탭은 `DELETE /api/projects/:name` 이 서버에서 직접 등록하므로 클라가 신고하는 것은 서버가 모르는 iframe 탭뿐이다.

  /** POST /api/closed-tabs — 닫은 탭 1건 등록(iframe 탭 전용). `kind: 'project'` 는 거절한다 — DELETE 가 이미 올린 것을 또 올리면 같은 항목이 두 번 접히며 `closedAt` 만 흔들린다. */
  app.post('/api/closed-tabs', (req, res) => {
    try {
      const body = (req.body ?? {}) as { key?: unknown; label?: unknown; url?: unknown; serverKind?: unknown; projectPath?: unknown };
      const key = typeof body.key === 'string' ? body.key.trim() : '';
      const url = typeof body.url === 'string' ? body.url.trim() : '';
      if (!key || !url) {
        res.status(400).json({ ok: false, error: 'key and url are required' });
        return;
      }
      const list = appStatePushClosedTab({
        key,
        kind: 'iframe',
        label: typeof body.label === 'string' && body.label ? body.label : key.slice(2),
        closedAt: Date.now(),
        url,
        ...(body.serverKind === 'frontend' || body.serverKind === 'backend' ? { serverKind: body.serverKind } : {}),
        // §7.11 / §3.5 — 그 프리뷰를 연 프로젝트. 되연 탭도 이 프로젝트 기준으로 소속을 묻는다.
        ...(typeof body.projectPath === 'string' && body.projectPath ? { projectPath: body.projectPath } : {}),
      });
      res.json({ ok: true, closedTabs: list });
      broadcastSnapshot();
    } catch (err) {
      logger.error('POST /api/closed-tabs failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /**
   * POST /api/closed-tabs/reopen — 한 건을 되연다(`key` 가 없으면 가장 최근에 닫은 것).
   * 프로젝트면 `registerProject` → `showProject` 까지 — `hiddenProjects` 를 푸는 것은 사용자 명시 액션뿐이고(§5.4 #14), 이 창구가 폴더 선택과 나란한 두 번째 경로다.
   * ⚠ 폴더가 사라졌으면 열지 않고 항목을 버린다 — 없는 경로로 `registerProject` 하면 유령 프로젝트가 생기고, 남겨 두면 눌러도 깨지기만 한다.
   */
  app.post('/api/closed-tabs/reopen', (req, res) => {
    try {
      const body = (req.body ?? {}) as { key?: unknown };
      const key = typeof body.key === 'string' && body.key ? body.key : undefined;
      const entry = appStateTakeClosedTab(key);
      if (!entry) {
        res.status(404).json({ ok: false, error: 'no closed tab to reopen' });
        return;
      }
      if (entry.kind !== 'project') {
        // iframe 탭은 클라이언트 로컬 상태다 — 꺼내 주기만 하면 저쪽이 그대로 되살린다.
        res.json({ ok: true, entry, closedTabs: appStateGetClosedTabs() });
        broadcastSnapshot();
        return;
      }
      const projectPath = entry.path ?? '';
      if (!projectPath || !fs.existsSync(projectPath)) {
        logger.info(`closed-tabs: reopen 대상 폴더가 없어 항목을 버린다 — ${projectPath}`);
        res.status(410).json({ ok: false, error: 'missing', entry, closedTabs: appStateGetClosedTabs() });
        broadcastSnapshot();
        return;
      }
      const info = graphManager.registerProject(projectPath);
      graphManager.showProject(info.name);
      res.json({ ok: true, entry, project: info, closedTabs: appStateGetClosedTabs() });
      broadcastSnapshot();
      saveCheckpoint();
    } catch (err) {
      logger.error('POST /api/closed-tabs/reopen failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /** DELETE /api/closed-tabs — 목록 비우기(메뉴의 "목록 지우기"). */
  app.delete('/api/closed-tabs', (_req, res) => {
    try {
      const removed = appStateClearClosedTabs();
      res.json({ ok: true, removed });
      if (removed > 0) broadcastSnapshot();
    } catch (err) {
      logger.error('DELETE /api/closed-tabs failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  /** POST /api/projects/open-folder — 모던 폴더 선택 다이얼로그 (IFileDialog COM) → 프로젝트 등록 */
  app.post('/api/projects/open-folder', (_req, res) => {
    /** 고른 경로를 프로젝트로 등록하고 응답까지 끝낸다 — 플랫폼별 선택기가 공유하는 꼬리. */
    const registerPicked = (selected: string): void => {
      try {
        const info = graphManager.registerProject(selected);
        // §5.4 #14 — 사용자가 폴더를 골라 "열기" 한 경로 — 닫아서 hidden 이던 프로젝트는 여기서만 되살린다.
        graphManager.showProject(info.name);
        broadcastSnapshot();
        saveCheckpoint();
        res.json({ ok: true, project: info });
      } catch (regErr) {
        logger.error('Project registration failed', regErr);
        res.status(500).json({ ok: false, error: String(regErr) });
      }
    };

    // macOS / Linux — 아래 Windows 경로(IFileDialog COM)만 있으면 `powershell` 이 없어 ENOENT → 500 이고, FileMenu 가 그 실패를 삼켜 폴더 열기가 아무 일도 없는 버튼이 된다(프로젝트를 추가할 수단이 UI 에 없다).
    // 새 의존성 없이 OS 대화상자를 부른다: macOS 는 내장 `osascript`, Linux 는 `zenity` → `kdialog` 순.
    if (process.platform !== 'win32') {
      const attempts = process.platform === 'darwin'
        ? [{ cmd: 'osascript', args: ['-e', 'POSIX path of (choose folder with prompt "Select project folder")'] }]
        : [
            { cmd: 'zenity', args: ['--file-selection', '--directory', '--title=Select project folder'] },
            { cmd: 'kdialog', args: ['--getexistingdirectory', os.homedir()] },
          ];
      const runPicker = (i: number): void => {
        const a = attempts[i];
        if (!a) {
          // 셋 다 없다 — 여기서만은 조용히 삼키지 않는다(설치 안내를 그대로 올려 보낸다).
          logger.error('Folder picker unavailable: install zenity or kdialog');
          res.status(501).json({ ok: false, error: 'no folder picker available (install zenity or kdialog)' });
          return;
        }
        execFile(a.cmd, a.args, { timeout: 300000, encoding: 'utf-8' }, (err, stdout) => {
          // 그 도구 자체가 없으면 다음 후보로. (execFile 은 셸을 안 거치므로 ENOENT 로 온다.)
          if (err && (err.code === 'ENOENT' || err.code === 127)) {
            runPicker(i + 1);
            return;
          }
          // 취소는 실패가 아니다 — osascript 는 -128, zenity/kdialog 는 exit 1 로 나간다.
          if (err) {
            logger.info(`Folder picker (${a.cmd}) returned ${String(err.code)} — 취소로 처리`);
            res.json({ ok: false, cancelled: true });
            return;
          }
          // osascript 의 POSIX path 는 끝에 슬래시를 붙인다 — 그대로 두면 프로젝트 이름이 빈다.
          const selected = stdout.trim().replace(/\/+$/, '');
          if (!selected) {
            res.json({ ok: false, cancelled: true });
            return;
          }
          registerPicked(selected);
        });
      };
      runPicker(0);
      return;
    }

    // ─── Windows ───
    // IFileDialog COM 인터페이스로 모던 파일 탐색기 스타일 폴더 선택
    const csSource = `
  using System;
  using System.Runtime.InteropServices;
  using System.Text;
  using System.Threading;

  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  class FileOpenDialogRCW {}

  [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileDialog {
      [PreserveSig] int Show(IntPtr hwnd);
      void SetFileTypes(uint c, IntPtr f);
      void SetFileTypeIndex(uint i);
      void GetFileTypeIndex(out uint i);
      void Advise(IntPtr p, out uint c);
      void Unadvise(uint c);
      void SetOptions(uint o);
      void GetOptions(out uint o);
      void SetDefaultFolder(IShellItem i);
      void SetFolder(IShellItem i);
      IShellItem GetFolder();
      IShellItem GetCurrentSelection();
      void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string s);
      void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string s);
      void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string s);
      void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string s);
      void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string s);
      IShellItem GetResult();
  }

  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
      void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
      void GetParent(out IShellItem ppsi);
      void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
      void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
      void Compare(IShellItem psi, uint hint, out int piOrder);
  }

  public class FolderPicker {
      // 백그라운드 Node 서버가 d.Show(NULL owner) 로 모달을 띄우면 Windows 포그라운드
      // 잠금에 걸려 폴더 선택창이 VSCode/브라우저 뒤로 열린다. Show()는 블로킹이라
      // 호출 후 보정이 불가 → 별도 백그라운드 스레드가 이 프로세스의 다이얼로그 창을
      // 찾아 AttachThreadInput 우회로 강제 포그라운드 한다.
      [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
      delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
      [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
      [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
      [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
      [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
      [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
      [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
      [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
      [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool f);
      [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
      [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
      [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
      [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
      [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
      [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint flags);
      [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);

      [StructLayout(LayoutKind.Sequential)] struct POINT { public int x; public int y; }
      [StructLayout(LayoutKind.Sequential)] struct RECT { public int left; public int top; public int right; public int bottom; }
      [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }

      // 다이얼로그 창을 현재 마우스 커서 위치(커서가 창 중앙)로 이동.
      // OS가 복원하는 "마지막 창 위치" 대신 사용자가 클릭한 자리에 뜨게 한다.
      // 커서가 속한 모니터 작업영역 안으로 클램프해 화면 밖으로 안 나가게 한다.
      static void PositionAtCursor(IntPtr h) {
          POINT pt;
          if (!GetCursorPos(out pt)) return;
          RECT wr;
          if (!GetWindowRect(h, out wr)) return;
          int w = wr.right - wr.left;
          int ht = wr.bottom - wr.top;
          int x = pt.x - w / 2;
          int y = pt.y - ht / 2;
          IntPtr mon = MonitorFromPoint(pt, 2); // MONITOR_DEFAULTTONEAREST
          MONITORINFO mi = new MONITORINFO();
          mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
          if (GetMonitorInfo(mon, ref mi)) {
              if (x < mi.rcWork.left) x = mi.rcWork.left;
              if (y < mi.rcWork.top) y = mi.rcWork.top;
              if (x + w > mi.rcWork.right) x = mi.rcWork.right - w;
              if (y + ht > mi.rcWork.bottom) y = mi.rcWork.bottom - ht;
          }
          MoveWindow(h, x, y, w, ht, true);
      }

      static void Force(IntPtr h) {
          IntPtr fg = GetForegroundWindow();
          uint fgpid;
          uint ftid = GetWindowThreadProcessId(fg, out fgpid);
          uint cur = GetCurrentThreadId();
          AttachThreadInput(cur, ftid, true);
          ShowWindow(h, 9); // SW_RESTORE
          BringWindowToTop(h);
          SetForegroundWindow(h);
          AttachThreadInput(cur, ftid, false);
      }

      static IntPtr FindDialog() {
          uint mypid = GetCurrentProcessId();
          IntPtr found = IntPtr.Zero;
          EnumWindows(delegate(IntPtr h, IntPtr l) {
              uint pid;
              GetWindowThreadProcessId(h, out pid);
              if (pid != mypid) return true;
              if (!IsWindowVisible(h)) return true;
              if (GetWindow(h, 4) != IntPtr.Zero) return true; // GW_OWNER=4 → 소유된 창 제외
              StringBuilder sb = new StringBuilder(64);
              GetClassName(h, sb, 64);
              if (sb.ToString() == "ConsoleWindowClass") return true; // PS 콘솔 제외
              found = h;
              return false;
          }, IntPtr.Zero);
          return found;
      }

      public static string Pick(string title) {
          Thread t = new Thread(delegate() {
              IntPtr dlg = IntPtr.Zero;
              for (int i = 0; i < 30 && dlg == IntPtr.Zero; i++) {
                  Thread.Sleep(120);
                  dlg = FindDialog();
              }
              if (dlg == IntPtr.Zero) return;
              Force(dlg);
              // 다이얼로그가 표시 직후 OS 저장 위치로 한 번 더 튀는 경우가 있어
              // 짧게 몇 번 더 커서 위치로 재배치한다.
              for (int j = 0; j < 4; j++) {
                  PositionAtCursor(dlg);
                  Thread.Sleep(70);
              }
          });
          t.IsBackground = true;
          t.Start();
          uint options;
          string pickedPath;
          IFileDialog d = (IFileDialog)new FileOpenDialogRCW();
          d.GetOptions(out options);
          d.SetOptions(options | 0x20);
          d.SetTitle(title);
          if (d.Show(IntPtr.Zero) != 0) return "__CANCELLED__";
          IShellItem r = d.GetResult();
          r.GetDisplayName(0x80058000, out pickedPath);
          return pickedPath;
      }
  }`;
    // [Console]::OutputEncoding 을 UTF-8 로 강제 — 기본 OEM 코드페이지(한국어 Windows=CP949 등)로 쓰면 한글·일어·중국어 경로가 Node utf8 디코딩에서 깨져, 부팅 때 ghost 로 제거되고 다음 실행에 탭이 사라진다.
    // PowerShell 내부는 UTF-16 이라 출력 단계만 UTF-8 로 맞춘다.
    const psScript = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$OutputEncoding = [System.Text.Encoding]::UTF8\nAdd-Type -TypeDefinition @'\n${csSource}\n'@\nWrite-Output ([FolderPicker]::Pick('Select project folder'))`;
    const tmpFile = path.join(process.env['TEMP'] || '.', `vibisual-picker-${Date.now()}.ps1`);
    // BOM 포함 UTF-8 로 저장 — PowerShell 5.1 의 -File 은 BOM 없는 파일을 ANSI 로 해석할 수
    // 있어 (스크립트 본문이 ASCII 라 현재는 영향 없지만) 향후 비-ASCII 추가에도 안전하게 둔다.
    fs.writeFileSync(tmpFile, '﻿' + psScript, 'utf-8');
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', tmpFile], { timeout: 120000, encoding: 'utf-8' }, (err, stdout) => {
      // 임시 파일 정리
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      if (err) {
        logger.error('Folder picker failed', err);
        res.status(500).json({ ok: false, error: String(err) });
        return;
      }
      const selected = stdout.trim();
      if (!selected || selected === '__CANCELLED__') {
        res.json({ ok: false, cancelled: true });
        return;
      }
      registerPicked(selected);
    });
  });

  // ─── Task Edge API (에이전트 간 작업 흐름) ───

  /** GET /api/task-edges — 전체 Task Edge 목록 */
  app.get('/api/task-edges', (_req, res) => {
    res.json({ ok: true, data: graphManager.getTaskEdgesSnapshot() });
  });

  /** POST /api/task-edges — Task Edge 생성. 고급 옵션(kind/messageFormat/returnFormat/timeoutMs/retryCount/cacheEnabled/priority)은 선택. */
  app.post('/api/task-edges', (req, res) => {
    const {
      sourceAgentId, targetAgentId, command, forwardMode, templateId,
      kind, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority,
      delegationPolicy, critiqueTiming, critiqueAuthority, maxReworkCount, commandMode,
    } = req.body as {
      sourceAgentId: string;
      targetAgentId: string;
      command: string;
      forwardMode: TaskEdgeForwardMode;
      templateId: string | null;
      kind?: TaskEdgeKind;
      messageFormat?: TaskEdgeMessageFormat;
      messageSchema?: string;
      returnFormat?: TaskEdgeReturnFormat;
      timeoutMs?: number;
      retryCount?: number;
      cacheEnabled?: boolean;
      priority?: TaskEdgePriority;
      delegationPolicy?: 'strict' | 'auto';
      critiqueTiming?: TaskEdgeCritiqueTiming;
      critiqueAuthority?: TaskEdgeCritiqueAuthority;
      maxReworkCount?: number;
      commandMode?: TaskEdgeCommandMode;
    };
    if (!sourceAgentId || !targetAgentId || typeof command !== 'string') {
      res.status(400).json({ ok: false, error: 'sourceAgentId, targetAgentId, command required' });
      return;
    }
    // §5.3 #12 — `commandMode` 기본값을 생성 시점에 박는다. `undefined` 로 두면 옛 엣지용 legacy fallback 을 타 `delegationPolicy` 기본 `'strict'` → `'tool-delegation'` 으로 읽혀, REST 로 만든 새 엣지(빌더·auto-agent·오케스트라)가 전부 박탈 대상이 된다.
    //   fallback 자체는 그대로 둔다 — 디스크에 `undefined` 로 저장된 옛 엣지의 거동을 바꾸면 사용자 설정을 뒤엎는다. 새 엣지에만 SSOT 기본값(`'shared'`)을 박는다.
    const resolvedCommandMode = commandMode ?? TASK_EDGE_DEFAULTS.commandMode;
    let edge;
    try {
      edge = graphManager.createTaskEdge(
        sourceAgentId, targetAgentId, command,
        forwardMode ?? 'manual', templateId ?? null,
        { kind, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority, delegationPolicy, critiqueTiming, critiqueAuthority, maxReworkCount, commandMode: resolvedCommandMode },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Task Edge creation failed';
      res.status(400).json({ ok: false, error: msg });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: edge });
  });

  /** PUT /api/task-edges/:id — Task Edge 업데이트. 고급 옵션 전부 갱신 가능. */
  app.put('/api/task-edges/:id', (req, res) => {
    const {
      command, forwardMode,
      kind, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority, delegationPolicy,
      critiqueTiming, critiqueAuthority, maxReworkCount, commandMode,
    } = req.body as {
      command?: string;
      forwardMode?: TaskEdgeForwardMode;
      kind?: TaskEdgeKind;
      messageFormat?: TaskEdgeMessageFormat;
      messageSchema?: string;
      returnFormat?: TaskEdgeReturnFormat;
      timeoutMs?: number;
      retryCount?: number;
      cacheEnabled?: boolean;
      priority?: TaskEdgePriority;
      delegationPolicy?: 'strict' | 'auto';
      critiqueTiming?: TaskEdgeCritiqueTiming;
      critiqueAuthority?: TaskEdgeCritiqueAuthority;
      maxReworkCount?: number;
      commandMode?: TaskEdgeCommandMode;
    };
    // auto-artifact / auto-rework 자매 엣지는 사용자 편집 금지(primary 에서만 수정).
    const existing = graphManager.getTaskEdge(req.params['id']!);
    if (existing && (existing.bundleRole === 'auto-artifact' || existing.bundleRole === 'auto-rework')) {
      res.status(400).json({ ok: false, error: 'cannot edit auto-generated bundle edge — modify the primary edge instead' });
      return;
    }
    const edge = graphManager.updateTaskEdge(req.params['id']!, {
      command, forwardMode,
      kind, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority, delegationPolicy,
      critiqueTiming, critiqueAuthority, maxReworkCount, commandMode,
    });
    if (!edge) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: edge });
  });

  /** DELETE /api/task-edges/:id — Task Edge 삭제. 자매(auto-artifact/auto-rework)는 단독 삭제 금지 — primary 쪽에서만. */
  app.delete('/api/task-edges/:id', (req, res) => {
    const existing = graphManager.getTaskEdge(req.params['id']!);
    if (existing && (existing.bundleRole === 'auto-artifact' || existing.bundleRole === 'auto-rework')) {
      res.status(400).json({ ok: false, error: 'cannot delete auto-generated bundle edge — delete the primary edge instead' });
      return;
    }
    const deleted = graphManager.deleteTaskEdge(req.params['id']!);
    if (!deleted) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  // §5.3 #28 — 콘티모드(Conti)

  /**
   * 콘티 생성 in-flight 락 (agentId → Promise). 같은 에이전트의 동시 generateConti 1건만 허용.
   */
  const contiInflight = new Map<string, Promise<void>>();

  /** POST /api/conti/generate?agentId=... — 새 콘티 1건 생성 (Haiku/Sonnet tool_use). */
  app.post('/api/conti/generate', async (req, res) => {
    const agentId = typeof req.query['agentId'] === 'string' ? req.query['agentId'] : '';
    if (!agentId) {
      res.status(400).json({ ok: false, error: 'agentId required' });
      return;
    }
    if (contiInflight.has(agentId)) {
      res.status(409).json({ ok: false, error: 'already generating for this agent' });
      return;
    }

    // 부모 에이전트 sessionId + cwd 조회 — `claude --resume <sessionId>` 로 부모 세션에 붙는다.
    const snap = graphManager.getSnapshot();
    const agent = snap.agents.find((a) => a.id === agentId);
    if (!agent) {
      res.status(404).json({ ok: false, error: 'agent not found' });
      return;
    }
    if (!agent.customCreated) {
      res.status(400).json({ ok: false, error: 'conti only works for custom-created agents' });
      return;
    }
    const sessionId = agent.path; // BubbleData.path === sessionId for agents
    const cwd = graphManager.getAgentCwd(sessionId);
    if (!sessionId || !cwd) {
      res.status(400).json({ ok: false, error: 'agent session/cwd unavailable' });
      return;
    }
    const input: ContiContextInput = { sessionId, cwd, agentLabel: agent.label };

    // §5.3 #28 (L) — 사용자가 명시한 "새 콘티". 늘 새 workId 를 발급한다(인플라이트 항목이 있어도 폐기 후 새로).
    const work_meta = graphManager.resetContiWork(agentId, 'user_new');
    const newWorkId = work_meta?.workId ?? '';

    const work = (async () => {
      try {
        const result = await generateContiFrames(input);
        if (!result) {
          return null;
        }
        const now = Date.now();
        const c: Conti = {
          id: contiId.conti(),
          agentId,
          createdAt: now,
          updatedAt: now,
          workId: newWorkId,
          ...(result.title ? { title: result.title } : {}),
          frames: result.frames,
        };
        graphManager.addConti(c);
        graphManager.attachContiIdToWork(agentId, c.id);
        broadcast({ type: 'conti_generated', timestamp: Date.now(), payload: { contiId: c.id, agentId, workId: newWorkId } });
        broadcastSnapshot();
        saveCheckpoint();
        return c;
      } catch (err) {
        logger.warn(`POST /api/conti/generate error: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    })();

    contiInflight.set(agentId, work.then(() => undefined));
    try {
      const c = await work;
      if (!c) {
        res.status(502).json({ ok: false, error: 'generation failed (claude CLI returned no usable JSON)' });
        return;
      }
      res.json({ ok: true, conti: c });
    } finally {
      contiInflight.delete(agentId);
    }
  });

  /** POST /api/conti/:contiId/patch-element — element 한 개 LLM 패치 */
  app.post('/api/conti/:contiId/patch-element', async (req, res) => {
    const cid = req.params['contiId']!;
    const body = req.body as { frameId?: string; elementId?: string; prompt?: string };
    if (!body || typeof body.frameId !== 'string' || typeof body.elementId !== 'string' || typeof body.prompt !== 'string') {
      res.status(400).json({ ok: false, error: 'frameId, elementId, prompt required' });
      return;
    }
    const found = graphManager.findContiElement(cid, body.frameId, body.elementId);
    if (!found) {
      res.status(404).json({ ok: false, error: 'conti/frame/element not found' });
      return;
    }
    // patchContiElement 는 부모 세션에 붙지 않는다 — harness 기반 일회용 sub-agent(tmpdir 격리 + Read/Edit only)가 element.json 을 직접 Edit 한다.
    try {
      const next = await patchContiElement(
        found.element,
        body.prompt,
        { title: found.frame.title, action: found.frame.action },
      );
      if (!next) {
        res.status(502).json({ ok: false, error: 'patch failed (claude CLI returned no usable JSON)' });
        return;
      }
      const applied = graphManager.replaceContiElement(cid, body.frameId, body.elementId, next);
      if (!applied) {
        res.status(404).json({ ok: false, error: 'apply failed' });
        return;
      }
      broadcast({
        type: 'conti_patched',
        timestamp: Date.now(),
        payload: { contiId: cid, agentId: found.conti.agentId, frameId: body.frameId, elementId: body.elementId },
      });
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, element: applied });
    } catch (err) {
      logger.warn(`POST /api/conti/:cid/patch-element error: ${err instanceof Error ? err.message : String(err)}`);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** POST /api/conti/:contiId/frames — 빈 frame append (LLM 미경유) */
  app.post('/api/conti/:contiId/frames', (req, res) => {
    const cid = req.params['contiId']!;
    const body = (req.body ?? {}) as { title?: string; action?: string };
    const frame = {
      id: contiId.frame(),
      title: typeof body.title === 'string' && body.title ? body.title.slice(0, 200) : 'New frame',
      action: typeof body.action === 'string' ? body.action.slice(0, 400) : '',
      elements: [],
    };
    const added = graphManager.addContiFrame(cid, frame);
    if (!added) {
      res.status(404).json({ ok: false, error: 'conti not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, frame: added });
  });

  /** DELETE /api/conti/:contiId/frames/:frameIndex — frame 삭제 (인덱스 기반) */
  app.delete('/api/conti/:contiId/frames/:frameIndex', (req, res) => {
    const cid = req.params['contiId']!;
    const idx = parseInt(req.params['frameIndex']!, 10);
    if (Number.isNaN(idx)) {
      res.status(400).json({ ok: false, error: 'frameIndex invalid' });
      return;
    }
    const ok = graphManager.deleteContiFrame(cid, idx);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'not found or out of range' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** §5.3 #28 — POST /api/conti/:contiId/frames/reorder — frame 드래그앤드롭 순서 변경 */
  app.post('/api/conti/:contiId/frames/reorder', (req, res) => {
    const cid = req.params['contiId']!;
    const body = (req.body ?? {}) as { fromIndex?: unknown; toIndex?: unknown };
    const from = typeof body.fromIndex === 'number' ? body.fromIndex : NaN;
    const to = typeof body.toIndex === 'number' ? body.toIndex : NaN;
    if (Number.isNaN(from) || Number.isNaN(to)) {
      res.status(400).json({ ok: false, error: 'fromIndex and toIndex (number) required' });
      return;
    }
    const ok = graphManager.moveContiFrame(cid, from, to);
    if (!ok) {
      res.status(400).json({ ok: false, error: 'reorder failed (not found, out of range, or same index)' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** PATCH /api/conti/:contiId/frames/:frameIndex — frame title/action 부분 갱신 */
  app.patch('/api/conti/:contiId/frames/:frameIndex', (req, res) => {
    const cid = req.params['contiId']!;
    const idx = parseInt(req.params['frameIndex']!, 10);
    if (Number.isNaN(idx)) {
      res.status(400).json({ ok: false, error: 'frameIndex invalid' });
      return;
    }
    const body = (req.body ?? {}) as { title?: string; action?: string };
    const updates: { title?: string; action?: string } = {};
    if (typeof body.title === 'string') updates.title = body.title;
    if (typeof body.action === 'string') updates.action = body.action;
    const updated = graphManager.patchContiFrame(cid, idx, updates);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, frame: updated });
  });

  /** DELETE /api/conti/:contiId — 콘티 1건 삭제 */
  app.delete('/api/conti/:contiId', (req, res) => {
    const ok = graphManager.deleteConti(req.params['contiId']!);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** POST /api/conti/import — 완성된 Conti JSON을 직접 주입 (세션 없이 사용 가능). */
  app.post('/api/conti/import', (req, res) => {
    const body = req.body as { conti?: unknown };
    const c = body?.conti;
    if (!c || typeof c !== 'object' || !('id' in (c as object)) || !('agentId' in (c as object))) {
      res.status(400).json({ ok: false, error: 'conti object with id and agentId required' });
      return;
    }
    const conti = c as import('@vibisual/shared').Conti;
    graphManager.addConti(conti);
    broadcast({ type: 'conti_generated', timestamp: Date.now(), payload: { contiId: conti.id, agentId: conti.agentId } });
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, contiId: conti.id });
  });

  /**
   * §5.13 (Q) POST /api/conti/from-script — 대본 텍스트에서 콘티 1건 생성. "새 콘티 생성"과 같은 저장소·히스토리에 쌓인다.
   * 입력만 다르므로(세션 회고 → 대본) 부모 세션 resume 없이 돌고, 세션이 없는 에이전트에서도 된다.
   */
  app.post('/api/conti/from-script', async (req, res) => {
    const body = req.body as { agentId?: unknown; script?: unknown; presetId?: unknown; frameCount?: unknown };
    const agentId = typeof body.agentId === 'string' ? body.agentId : '';
    const script = typeof body.script === 'string' ? body.script.trim() : '';
    if (!agentId || !script) {
      res.status(400).json({ ok: false, error: 'agentId and script required' });
      return;
    }
    if (contiInflight.has(agentId)) {
      res.status(409).json({ ok: false, error: 'already generating for this agent' });
      return;
    }
    const agent = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
    if (!agent) {
      res.status(404).json({ ok: false, error: 'agent not found' });
      return;
    }
    const presetId = normalizeStoryboardPresetId(body.presetId);
    // 대본 모드는 세션에 안 붙으므로 cwd 만 있으면 된다 — 에이전트 cwd → 프로젝트 경로 → 루트 순.
    const cwd =
      graphManager.getAgentCwdByAgentId(agentId) ??
      graphManager.getProjectPathForAgent(agentId) ??
      graphManager.getRoot() ??
      process.cwd();

    const work = (async () => {
      try {
        const result = await generateContiFramesFromScript({
          script,
          cwd,
          presetId,
          ...(typeof body.frameCount === 'number' ? { frameCount: body.frameCount } : {}),
        });
        if (!result) return null;
        const now = Date.now();
        const c: Conti = {
          id: contiId.conti(),
          agentId,
          createdAt: now,
          updatedAt: now,
          workId: '',
          ...(result.title ? { title: result.title } : {}),
          frames: result.frames,
          source: 'script',
          scriptExcerpt: script.slice(0, CONTI_SCRIPT_EXCERPT_MAX),
          presetId,
        };
        graphManager.addConti(c);
        broadcast({ type: 'conti_generated', timestamp: Date.now(), payload: { contiId: c.id, agentId, workId: '' } });
        broadcastSnapshot();
        saveCheckpoint();
        return c;
      } catch (err) {
        logger.warn(`POST /api/conti/from-script error: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    })();

    contiInflight.set(agentId, work.then(() => undefined));
    try {
      const c = await work;
      if (!c) {
        res.status(502).json({ ok: false, error: 'generation failed (claude CLI returned no usable JSON)' });
        return;
      }
      res.json({ ok: true, conti: c });
    } finally {
      contiInflight.delete(agentId);
    }
  });

  /** §5.13 (Q) PATCH /api/conti/:contiId — 출력 프리셋 지정(컷 좌표계는 안 바뀐다). */
  app.patch('/api/conti/:contiId', (req, res) => {
    const body = req.body as { presetId?: unknown };
    if (typeof body?.presetId !== 'string') {
      res.status(400).json({ ok: false, error: 'presetId required' });
      return;
    }
    const updated = graphManager.setContiPreset(req.params['contiId']!, normalizeStoryboardPresetId(body.presetId));
    if (!updated) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, conti: updated });
  });

  /** §5.13 (Q) POST /api/conti/:contiId/render-link — 콘티를 받아 간 앱의 산출물 기록. 어느 앱인지는 몸통이 알려 준다(§5.13 (P-4)) — 코어는 `appId` 를 해석하지 않고 적어 둘 뿐이라 앱이 늘어도 라우트는 그대로다. */
  app.post('/api/conti/:contiId/render-link', (req, res) => {
    const body = req.body as {
      appId?: unknown;
      docId?: unknown;
      jobId?: unknown;
      presetId?: unknown;
      status?: unknown;
      error?: unknown;
    };
    if (typeof body?.appId !== 'string' || !body.appId || typeof body.docId !== 'string' || !body.docId) {
      res.status(400).json({ ok: false, error: 'appId and docId required' });
      return;
    }
    const statuses: readonly ContiRenderStatus[] = ['queued', 'running', 'done', 'error', 'canceled'];
    const link: ContiRenderLink = {
      appId: body.appId.slice(0, 64),
      docId: body.docId.slice(0, 128),
      ...(typeof body.jobId === 'string' && body.jobId ? { jobId: body.jobId.slice(0, 128) } : {}),
      presetId: normalizeStoryboardPresetId(body.presetId),
      startedAt: Date.now(),
      ...(statuses.includes(body.status as ContiRenderStatus) ? { status: body.status as ContiRenderStatus } : {}),
      ...(typeof body.error === 'string' && body.error ? { error: body.error.slice(0, 400) } : {}),
    };
    const updated = graphManager.setContiRenderLink(req.params['contiId']!, link);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, conti: updated });
  });

  // Comment Box — 언리얼 블프 스타일 주석 컨테이너

  /** GET /api/comment-boxes — 모든 Comment Box 조회(디버그용). 일반적으로 snapshot 으로 받음. */
  app.get('/api/comment-boxes', (_req, res) => {
    res.json({ ok: true, data: graphManager.getAllCommentBoxes() });
  });

  /** POST /api/comment-boxes — 새 Comment Box 생성. */
  app.post('/api/comment-boxes', (req, res) => {
    const body = req.body as {
      projectName?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      text?: string;
      color?: string;
      textColor?: string;
      fontSize?: number;
      opacity?: number;
      childNodeIds?: string[];
    };
    if (
      typeof body.projectName !== 'string' ||
      typeof body.x !== 'number' ||
      typeof body.y !== 'number' ||
      typeof body.width !== 'number' ||
      typeof body.height !== 'number'
    ) {
      res.status(400).json({ ok: false, error: 'projectName, x, y, width, height required' });
      return;
    }
    const box = graphManager.createCommentBox({
      projectName: body.projectName,
      x: body.x,
      y: body.y,
      width: body.width,
      height: body.height,
      ...(body.text !== undefined && { text: body.text }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.textColor !== undefined && { textColor: body.textColor }),
      ...(body.fontSize !== undefined && { fontSize: body.fontSize }),
      ...(body.opacity !== undefined && { opacity: body.opacity }),
      ...(body.childNodeIds !== undefined && { childNodeIds: body.childNodeIds }),
    });
    if (!box) {
      res.status(500).json({ ok: false, error: 'no project instance registered' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: box });
  });

  /** PATCH /api/comment-boxes/:id — 위치/크기/텍스트/색/자식목록 부분 업데이트. */
  app.patch('/api/comment-boxes/:id', (req, res) => {
    const id = req.params['id']!;
    const body = req.body as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      text?: string;
      color?: string;
      textColor?: string;
      fontSize?: number;
      opacity?: number;
      childNodeIds?: string[];
    };
    const updated = graphManager.updateCommentBox(id, body);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: updated });
  });

  /** DELETE /api/comment-boxes/:id */
  app.delete('/api/comment-boxes/:id', (req, res) => {
    const deleted = graphManager.deleteCommentBox(req.params['id']!);
    if (!deleted) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  // ─── §5.9 화면/프로그램 캡처 버블 — 사용자 생성 독립 캔버스 요소 (CommentBox 패턴) ───

  /** GET /api/capture-bubbles — 모든 캡처 버블 조회(디버그용). 일반적으로 snapshot 으로 받음. */
  app.get('/api/capture-bubbles', (_req, res) => {
    res.json({ ok: true, data: graphManager.getAllCaptureBubbles() });
  });

  /** POST /api/capture-bubbles — 새 캡처 버블 생성. */
  // §5.13 내부 앱 버블(범용) — 앱마다 라우트를 새로 만들지 않는다. 앱이 늘어도 코어에 남는 자국은 이 네 개뿐이다.

  app.post('/api/app-bubbles', (req, res) => {
    const body = req.body as {
      id?: unknown;
      projectName?: unknown;
      appId?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      title?: unknown;
      ref?: unknown;
      linkedAgentIds?: unknown;
    };
    if (
      typeof body.projectName !== 'string' ||
      typeof body.appId !== 'string' ||
      typeof body.x !== 'number' ||
      typeof body.y !== 'number'
    ) {
      res.status(400).json({ ok: false, error: 'projectName, appId, x, y required' });
      return;
    }
    const bubble = graphManager.createAppBubble({
      // §5.4 #36 (F) — 클라가 지어 먼저 그려 둔 id(낙관 생성). 형식이 맞고 비어 있을 때만 쓰고, 아니면 새로 짓는다.
      ...(body.id !== undefined ? { id: body.id } : {}),
      projectName: body.projectName,
      appId: body.appId,
      x: body.x,
      y: body.y,
      ...(typeof body.width === 'number' ? { width: body.width } : {}),
      ...(typeof body.height === 'number' ? { height: body.height } : {}),
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.ref === 'string' ? { ref: body.ref } : {}),
      // §5.4 #36 (B) — 말풍선의 궤도 위성으로 만들면 그 에이전트를 참조한 채 태어난다. 다듬기는 인스턴스가 한다.
      ...(body.linkedAgentIds !== undefined ? { linkedAgentIds: body.linkedAgentIds } : {}),
    });
    if (!bubble) {
      res.status(500).json({ ok: false, error: 'no project instance registered' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: bubble });
  });

  app.patch('/api/app-bubbles/:id', (req, res) => {
    const updated = graphManager.updateAppBubble(req.params.id, req.body as Record<string, never>);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'app bubble not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: updated });
  });

  /**
   * §5.4 #36 (C) — 결과 전달. 위성줄로 이어진 에이전트가 만든 파일을 그 앱 노드에 담는다.
   * 외부 `claude`/`codex` 가 부르는 자리라 loopback 화이트리스트에 열려 있다(토큰 필수). 프로젝트 안의 존재하는 파일만 받는다 — 노드를 열면 그 파일이 앱으로 열리므로 프로젝트 밖을 가리키면 안 된다.
   * 코어는 앱 이름을 모르므로 확장자는 보지 않는다(무엇을 여는지는 클라 레지스트리 몫).
   */
  app.post('/api/app-bubbles/:id/output', (req, res) => {
    const body = (req.body ?? {}) as { file?: unknown; ref?: unknown };
    const file = typeof body.file === 'string' && body.file.trim() !== '' ? body.file.trim() : null;
    // §5.13 (L) — 결과가 파일이 아니라 앱의 **작업 문서**일 수 있다(영상 앱이면 문서 id). 그 열쇠를 노드에 묶는다 —
    //   노드를 열면 그 문서가 열린다. 코어는 뜻을 모르고 모양(안전한 id)만 본다.
    const ref = typeof body.ref === 'string' && body.ref.trim() !== '' ? body.ref.trim() : null;
    if (!file && !ref) {
      res.status(400).json({ ok: false, error: 'file or ref required' });
      return;
    }
    if (ref && !graphManager.setAppBubbleRef(req.params.id, ref)) {
      const exists = graphManager.getAppBubble(req.params.id);
      res.status(exists ? 400 : 404).json({ ok: false, error: exists ? 'invalid-ref' : 'not-found' });
      return;
    }
    if (file) {
      const result = graphManager.setAppBubbleOutput(req.params.id, file);
      if (!result.ok) {
        res.status(result.error === 'not-found' ? 404 : 400).json({ ok: false, error: result.error });
        return;
      }
    }
    const bubble = graphManager.getAppBubble(req.params.id);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: { id: req.params.id, appId: bubble?.appId, file: bubble?.file, ref: bubble?.ref } });
  });

  app.delete('/api/app-bubbles/:id', (req, res) => {
    const removed = graphManager.deleteAppBubble(req.params.id);
    if (!removed) {
      // 핀이 걸려 있으면 삭제를 거절한다(§2.4 preserve-pin) — 없는 것과 구분해 409.
      const exists = graphManager.getAppBubble(req.params.id);
      res
        .status(exists ? 409 : 404)
        .json({ ok: false, error: exists ? 'app bubble preserved' : 'app bubble not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  app.post('/api/capture-bubbles', (req, res) => {
    const body = req.body as {
      projectName?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      sourceId?: string;
      sourceName?: string;
      sourceKind?: string;
    };
    if (
      typeof body.projectName !== 'string' ||
      typeof body.x !== 'number' ||
      typeof body.y !== 'number' ||
      typeof body.width !== 'number' ||
      typeof body.height !== 'number' ||
      typeof body.sourceId !== 'string' ||
      typeof body.sourceName !== 'string' ||
      (body.sourceKind !== 'screen' && body.sourceKind !== 'window')
    ) {
      res.status(400).json({ ok: false, error: 'projectName, x, y, width, height, sourceId, sourceName, sourceKind required' });
      return;
    }
    const bubble = graphManager.createCaptureBubble({
      projectName: body.projectName,
      x: body.x,
      y: body.y,
      width: body.width,
      height: body.height,
      sourceId: body.sourceId,
      sourceName: body.sourceName,
      sourceKind: body.sourceKind,
    });
    if (!bubble) {
      res.status(500).json({ ok: false, error: 'no project instance registered' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: bubble });
  });

  /** PATCH /api/capture-bubbles/:id — 위치/크기/소스 부분 업데이트. */
  app.patch('/api/capture-bubbles/:id', (req, res) => {
    const id = req.params['id']!;
    const body = req.body as {
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      sourceId?: string;
      sourceName?: string;
      sourceKind?: 'screen' | 'window';
    };
    const updated = graphManager.updateCaptureBubble(id, body);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: updated });
  });

  /** DELETE /api/capture-bubbles/:id */
  app.delete('/api/capture-bubbles/:id', (req, res) => {
    const deleted = graphManager.deleteCaptureBubble(req.params['id']!);
    if (!deleted) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  // §5.14 — 플레이 버블(이 프로젝트를 켜는 버튼).
  // 경계: `start` 는 loopback 화이트리스트에 없다 — 외부 프로세스(에이전트)는 레시피를 등록만 하고(`/api/play-recipe`) 켜는 것은 렌더러(사용자 클릭)뿐이다. 시키지 않은 서버가 켜지는 사고를 구조로 막는다.

  /** 이 프로젝트의 절대 경로. 탐지·실행의 기준점이라 없으면 아무것도 못 한다. */
  function playProjectPath(projectName: string): string | null {
    return graphManager.getProjectByName(projectName)?.path ?? null;
  }

  /** 레시피의 cwd·root 가 그 프로젝트 안인지 — 밖이면 통째로 거절한다(§5.14 안전). */
  function playRecipeWithinProject(recipe: PlayRecipe, projectPath: string): boolean {
    for (const candidate of [recipe.cwd, recipe.root]) {
      if (candidate === undefined) continue;
      if (validatePathWithinRoot(candidate, projectPath) === null) return false;
    }
    return true;
  }

  /** POST /api/play-bubbles — 버튼을 놓는다. 놓는 즉시 실행법을 탐지해 붙여 준다. */
  app.post('/api/play-bubbles', (req, res) => {
    const body = req.body as {
      projectName?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      title?: unknown;
    };
    if (typeof body.projectName !== 'string' || typeof body.x !== 'number' || typeof body.y !== 'number') {
      res.status(400).json({ ok: false, error: 'projectName, x, y required' });
      return;
    }
    const projectPath = playProjectPath(body.projectName);
    // 4단 계단 1~3단을 여기서 한 번에 태운다. 후보가 없으면 recipe 없이 만들어지고,
    // 버튼이 [실행법 알아내기](=4단, 에이전트 위임)를 띄운다.
    const candidates = projectPath
      ? detectPlayRecipes(projectPath, graphManager.getObservedServerCommands(body.projectName))
      : [];
    const best = candidates[0];
    const recipe: PlayRecipe | undefined = best
      ? {
          kind: best.kind,
          ...(best.command !== undefined ? { command: best.command } : {}),
          ...(best.cwd !== undefined ? { cwd: best.cwd } : {}),
          ...(best.root !== undefined ? { root: best.root } : {}),
          ...(best.port !== undefined ? { port: best.port } : {}),
          ...(best.openPath !== undefined ? { openPath: best.openPath } : {}),
          ...(best.label !== undefined ? { label: best.label } : {}),
          source: best.source,
        }
      : undefined;
    const bubble = graphManager.createPlayBubble({
      projectName: body.projectName,
      x: body.x,
      y: body.y,
      width: typeof body.width === 'number' ? body.width : PLAY_BUBBLE_DEFAULT_WIDTH,
      height: typeof body.height === 'number' ? body.height : PLAY_BUBBLE_DEFAULT_HEIGHT,
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(recipe ? { recipe } : {}),
    });
    if (!bubble) {
      res.status(500).json({ ok: false, error: 'no project instance registered' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: bubble, candidates });
  });

  /** PATCH /api/play-bubbles/:id — 좌표·크기·제목·레시피·프리뷰 상태. */
  app.patch('/api/play-bubbles/:id', (req, res) => {
    const id = req.params['id']!;
    const existing = graphManager.getPlayBubble(id);
    if (!existing) {
      res.status(404).json({ ok: false, error: 'play bubble not found' });
      return;
    }
    const body = (req.body ?? {}) as Partial<PlayBubble>;
    if (body.recipe) {
      const projectPath = playProjectPath(existing.projectName);
      if (!projectPath || !playRecipeWithinProject(body.recipe, projectPath)) {
        res.status(400).json({ ok: false, error: 'recipe path outside project' });
        return;
      }
    }
    const updated = graphManager.updatePlayBubble(id, body);
    if (!updated) {
      res.status(404).json({ ok: false, error: 'play bubble not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, data: updated });
  });

  /** DELETE /api/play-bubbles/:id — 켜져 있으면 먼저 끄고 지운다(고아 서버 방지). */
  app.delete('/api/play-bubbles/:id', (req, res) => {
    const id = req.params['id']!;
    const bubble = graphManager.getPlayBubble(id);
    if (!bubble) {
      res.status(404).json({ ok: false, error: 'play bubble not found' });
      return;
    }
    if (bubble.preservePinned === true) {
      res.status(409).json({ ok: false, error: 'play bubble preserved' });
      return;
    }
    if (bubble.status === 'running') void stopPlay(bubble);
    graphManager.deletePlayBubble(id);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /**
   * POST /api/play-bubbles/:id/detect — 실행법 다시 찾기(4단 계단 1~3단).
   * `apply` 가 참이면 1등 후보를 그대로 레시피로 확정한다.
   */
  app.post('/api/play-bubbles/:id/detect', (req, res) => {
    const id = req.params['id']!;
    const bubble = graphManager.getPlayBubble(id);
    if (!bubble) {
      res.status(404).json({ ok: false, error: 'play bubble not found' });
      return;
    }
    const projectPath = playProjectPath(bubble.projectName);
    if (!projectPath) {
      res.status(409).json({ ok: false, error: 'project path unknown' });
      return;
    }
    const candidates = detectPlayRecipes(projectPath, graphManager.getObservedServerCommands(bubble.projectName));
    const apply = (req.body as { apply?: unknown } | undefined)?.apply === true;
    const best = candidates[0];
    if (apply && best) {
      graphManager.updatePlayBubble(id, {
        recipe: {
          kind: best.kind,
          ...(best.command !== undefined ? { command: best.command } : {}),
          ...(best.cwd !== undefined ? { cwd: best.cwd } : {}),
          ...(best.root !== undefined ? { root: best.root } : {}),
          ...(best.port !== undefined ? { port: best.port } : {}),
          ...(best.openPath !== undefined ? { openPath: best.openPath } : {}),
          ...(best.label !== undefined ? { label: best.label } : {}),
          source: best.source,
        },
        status: 'idle',
        error: undefined,
      });
      broadcastSnapshot();
      saveCheckpoint();
    }
    res.json({ ok: true, candidates, data: graphManager.getPlayBubble(id) });
  });

  /** POST /api/play-bubbles/:id/start — 사용자가 버튼을 눌렀다. */
  app.post('/api/play-bubbles/:id/start', (req, res) => {
    const id = req.params['id']!;
    const bubble = graphManager.getPlayBubble(id);
    if (!bubble) {
      res.status(404).json({ ok: false, error: 'play bubble not found' });
      return;
    }
    if (!bubble.recipe) {
      res.status(409).json({ ok: false, error: 'no recipe' });
      return;
    }
    const projectPath = playProjectPath(bubble.projectName);
    if (!projectPath || !playRecipeWithinProject(bubble.recipe, projectPath)) {
      res.status(400).json({ ok: false, error: 'recipe path outside project' });
      return;
    }
    if (bubble.status === 'starting') {
      res.status(409).json({ ok: false, error: 'already starting' });
      return;
    }

    // 기동은 길다(최대 PLAY_START_TIMEOUT_MS). 응답을 붙잡지 않고 상태만 먼저 알린다 —
    // 진행은 스냅샷 broadcast 로 흐르고, 버튼은 그 상태를 그대로 그린다.
    graphManager.updatePlayBubble(id, { status: 'starting', error: undefined, lastStartedAt: Date.now() });
    broadcastSnapshot();

    void startPlay(bubble).then((outcome) => {
      // 기다리는 동안 사용자가 지웠을 수 있다 — 사라진 버블에 상태를 쓰지 않는다.
      if (!graphManager.getPlayBubble(id)) return;
      if (outcome.ok) {
        const anchor = graphManager.getPlayBubble(id);
        graphManager.updatePlayBubble(id, {
          status: 'running',
          ...(outcome.url !== undefined ? { url: outcome.url } : {}),
          ...(outcome.port !== undefined ? { port: outcome.port } : {}),
          error: undefined,
          previewOpen: true,
          // 프리뷰가 처음 뜨는 자리 = 버튼 오른쪽. 이후엔 사용자가 옮긴 자리를 존중한다.
          ...(anchor && anchor.previewX === undefined
            ? {
                previewX: anchor.x + anchor.width + PLAY_PREVIEW_GAP,
                previewY: anchor.y,
                previewWidth: PLAY_PREVIEW_DEFAULT_WIDTH,
                previewHeight: PLAY_PREVIEW_DEFAULT_HEIGHT,
              }
            : {}),
        });
      } else {
        graphManager.updatePlayBubble(id, {
          status: 'failed',
          error: outcome.error ?? 'failed to start',
          url: undefined,
          port: undefined,
        });
      }
      broadcastSnapshot();
      saveCheckpoint();
    });

    res.json({ ok: true, data: graphManager.getPlayBubble(id) });
  });

  /** POST /api/play-bubbles/:id/stop — 우리가 띄운 것만 끈다. */
  app.post('/api/play-bubbles/:id/stop', (req, res) => {
    const id = req.params['id']!;
    const bubble = graphManager.getPlayBubble(id);
    if (!bubble) {
      res.status(404).json({ ok: false, error: 'play bubble not found' });
      return;
    }
    void stopPlay(bubble).then(() => {
      graphManager.updatePlayBubble(id, { status: 'idle', url: undefined, port: undefined, previewOpen: false });
      broadcastSnapshot();
      saveCheckpoint();
    });
    res.json({ ok: true });
  });

  /**
   * POST /api/play-bubbles/:id/ask-agent — 4단 계단 ④. 탐지가 빈손일 때만 쓰는 마지막 계단.
   * 새 위임 레이어 ❌ — 기존 명령 큐로 프롬프트를 넣고 답은 `/api/play-recipe` 로 받는다(에이전트가 직접 서버를 띄우는 것 ❌).
   */
  app.post('/api/play-bubbles/:id/ask-agent', (req, res) => {
    const id = req.params['id']!;
    const bubble = graphManager.getPlayBubble(id);
    if (!bubble) {
      res.status(404).json({ ok: false, error: 'play bubble not found' });
      return;
    }
    const agentId = (req.body as { agentId?: unknown } | undefined)?.agentId;
    if (typeof agentId !== 'string' || !agentId) {
      res.status(400).json({ ok: false, error: 'agentId required' });
      return;
    }
    const sessionId = graphManager.findSessionByAgentId(agentId);
    if (!sessionId) {
      res.status(404).json({ ok: false, error: 'agent session not found' });
      return;
    }
    const projectPath = playProjectPath(bubble.projectName) ?? graphManager.getAgentCwd(sessionId) ?? '';
    const text = buildPlayRecipeAskPrompt({
      serverBase: `http://127.0.0.1:${hookListenerPort ?? port}`,
      serverToken: hookListenerToken ?? '',
      bubbleId: bubble.id,
      projectPath,
      ...(hookListenerIdentityFile ? { identityFile: hookListenerIdentityFile } : {}),
    });
    const subAgentId = (subAgentManager.getPrimarySub(agentId) ?? subAgentManager.create(agentId)).id;
    let queue = commandQueues.get(sessionId);
    if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
    queue.push({
      id: `cmd-${Date.now()}-${queue.length}`,
      text,
      timestamp: Date.now(),
      subAgentId,
      status: 'queued' as const,
    });
    processNextCommand(sessionId);
    // §5.17 (C) — 실행법을 물은 그 시각이 "이 화면을 누가 만들었나" 가 정해지는 자리다.
    //   이후 프리뷰가 열리면 캔버스가 이 에이전트로 점선을 긋는다(끝점이 화면에 없으면 안 그린다).
    graphManager.updatePlayBubble(bubble.id, { ownerAgentId: agentId });
    broadcastSnapshot();
    res.json({ ok: true });
  });

  /**
   * POST /api/play-recipe — 에이전트가 알아낸 실행법 등록(loopback + 토큰). `/api/agent-iframe` 과 같은 인프라(새 통신 레이어 ❌).
   * 등록만 되고 기동은 안 된다 — start 는 화이트리스트 밖이라 렌더러(사용자)만 부른다.
   */
  // ─── §5.5 #17-35 — 검증(Verify) REST ───

  app.post('/api/verification-target/probe', async (req, res) => {
    const target = parseVerificationTarget((req.body as Record<string, unknown> | undefined)?.target);
    if (!target) { res.status(400).json({ available: false, reason: 'invalid-verification-target', actions: [], checks: [] }); return; }
    const adapter = getVerificationAutomationAdapter();
    if (!adapter) { res.json({ available: false, reason: 'verification-tools-unavailable', actions: [], checks: [] }); return; }
    try { res.json(await adapter.probe(target)); }
    catch (error) { res.json({ available: false, reason: error instanceof Error ? error.message : String(error), actions: [], checks: [] }); }
  });

  app.post('/api/verification-tools/:operation', verificationToolHandler(verificationAutomation,
    () => hookListenerToken, (agentId, subAgentId) => subAgentManager.getSub(subAgentId)?.parentAgentId === agentId));

  app.get('/api/verification-runs/:id/evidence/:evidenceId.png', (req, res) => {
    const run = graphManager.findVerificationRun(req.params.id);
    const file = run ? verificationAutomation.evidencePath(run, req.params.evidenceId) : undefined;
    if (!file || !fs.existsSync(file)) { res.status(404).json({ error: 'verification-evidence-missing' }); return; }
    res.type('image/png').sendFile(file);
  });

  app.post('/api/verification-runs/:id/save-procedure', (req, res) => {
    const run = graphManager.findVerificationRun(req.params.id);
    if (!run) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    const scopeError = verificationScopeError({ agentId: run.agentId, subAgentId: run.subAgentId, sub: subAgentManager.getSub(run.subAgentId) });
    if (scopeError) { res.status(409).json({ ok: false, error: scopeError }); return; }
    try {
      const demo = verificationAutomation.saveProcedure(run, typeof req.body?.label === 'string' ? req.body.label : undefined);
      const evicted = graphManager.addVerificationDemo(demo);
      if (evicted === null) { removeDemoFrames(demo); throw new Error('project-not-found'); }
      for (const removed of evicted) removeDemoFrames(removed);
      broadcastSnapshot(); saveCheckpoint();
      res.json({ ok: true, demo });
    } catch (error) { res.status(409).json({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });

  /** GET /api/verification-recipe/:agentId — 지금 보내면 무엇이 실릴지 미리 알려 준다. 판정은 서버가 한다(§3.1) — 클라가 플레이 버블을 뒤져 스스로 만들면 실제로 나가는 것과 어긋난다(#17-35 ⑦). */
  app.get('/api/verification-recipe/:agentId', (req, res) => {
    const agentId = req.params.agentId;
    const projectName = graphManager.getAgentProjectName(agentId) ?? '';
    const recipe = resolveVerifyRecipe(agentId, projectName);
    res.json({ ok: true, source: recipe.source, ...(recipe.label ? { label: recipe.label } : {}) });
  });

  /** POST /api/verification-runs — 검증 시작(그 탭 큐에 `/verify` 한 건). */
  app.post('/api/verification-runs', async (req, res) => {
    const body = (req.body ?? {}) as { agentId?: unknown; subAgentId?: unknown; focus?: unknown; demoId?: unknown; target?: unknown; expected?: unknown };
    const agentId = typeof body.agentId === 'string' ? body.agentId : '';
    const subAgentId = typeof body.subAgentId === 'string' ? body.subAgentId : '';
    if (!agentId || !subAgentId) {
      res.status(400).json({ ok: false, error: 'agentId and subAgentId required' });
      return;
    }
    // #17-29 — 훅 버블은 전면 읽기 전용이라 명령을 보내지 않는다.
    if (isReadOnlyHookAgentId(agentId)) {
      res.status(400).json({ ok: false, error: READ_ONLY_HOOK_AGENT_ERROR });
      return;
    }
    const focus = typeof body.focus === 'string' ? body.focus : undefined;
    const demoId = typeof body.demoId === 'string' && body.demoId ? body.demoId : undefined;
    const target = parseVerificationTarget(body.target);
    if (body.target !== undefined && !target) { res.status(400).json({ ok: false, error: 'invalid-verification-target' }); return; }
    const result = await startVerificationRun(agentId, subAgentId, focus, demoId, target, typeof body.expected === 'string' ? body.expected : undefined);
    if (!result.ok) {
      res.status(409).json({ ok: false, error: result.error });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, run: result.run });
  });

  /**
   * §5.3 #12-4 (F) — POST /api/verification-request — 결과 줄 [검증 실행]. 그 탭에 **관련 검증 명령 한 건**을
   * 넣는다. 범위(관련 테스트·타입 검사·린트·빌드)는 서버가 찍는다 — 본문(`prompt`)은 사람이 읽을 말일 뿐
   * 권한을 정하지 않는다. 사람이 누르는 손잡이라 에이전트(loopback) 유입은 받지 않는다.
   */
  app.post('/api/verification-request', (req, res) => {
    if (req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE) {
      res.status(403).json({ ok: false, error: 'user-only' });
      return;
    }
    const body = (req.body ?? {}) as { agentId?: unknown; subAgentId?: unknown; prompt?: unknown };
    const agentId = typeof body.agentId === 'string' ? body.agentId : '';
    const subAgentId = typeof body.subAgentId === 'string' ? body.subAgentId : '';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, VERIFICATION_REQUEST_PROMPT_MAX) : '';
    if (!agentId || !subAgentId || !prompt) {
      res.status(400).json({ ok: false, error: 'agentId, subAgentId and prompt required' });
      return;
    }
    // #17-29 — 훅 버블은 전면 읽기 전용이라 명령을 보내지 않는다.
    if (isReadOnlyHookAgentId(agentId)) {
      res.status(400).json({ ok: false, error: READ_ONLY_HOOK_AGENT_ERROR });
      return;
    }
    const scopeError = verificationScopeError({ agentId, subAgentId, sub: subAgentManager.getSub(subAgentId) });
    if (scopeError) { res.status(409).json({ ok: false, error: scopeError }); return; }
    const sessionId = graphManager.findSessionByAgentId(agentId);
    if (!sessionId) { res.status(409).json({ ok: false, error: 'session-not-found' }); return; }
    let queue = commandQueues.get(sessionId);
    if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
    // 겹쳐 쏘지 않는다 — 그 탭에 안 끝난 명령이 있으면 그것이 끝난 뒤 다시 누른다(무한 재실행 차단).
    if (queue.some((c) => c.subAgentId === subAgentId && (c.status === 'queued' || c.status === 'executing'))) {
      res.status(409).json({ ok: false, error: 'session-busy' });
      return;
    }
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now()}-verifyreq-${randomUUID().slice(0, 8)}`,
      text: prompt,
      timestamp: Date.now(),
      subAgentId,
      status: 'queued',
      dispatchMode: 'wait',
      verificationScope: buttonVerificationScope(),
    };
    queue.push(cmd);
    processNextCommand(sessionId);
    broadcastSnapshot();
    res.json({ ok: true, commandId: cmd.id });
  });

  /** POST /api/verification-runs/:id/stop — 도는 검증을 목록에서 닫는다(그 턴 자체 중지는 기존 [중지]). */
  app.post('/api/verification-runs/:id/stop', (req, res) => {
    const run = graphManager.findVerificationRun(req.params.id);
    if (!run) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    const finishedAt = Date.now();
    verificationAutomation.close(run.id);
    const next = graphManager.updateVerificationRun(run.id, {
      status: 'stopped',
      verdict: 'unknown',
      pendingCommandId: undefined,
      finishedAt,
      durationMs: Math.max(0, finishedAt - run.startedAt),
    });
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, run: next });
  });

  /** POST /api/verification-runs/:id/rework — 실패·보류 사유를 그대로 그 탭의 다음 프롬프트로. */
  app.post('/api/verification-runs/:id/rework', (req, res) => {
    const run = graphManager.findVerificationRun(req.params.id);
    if (!run) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    if (run.verdict !== 'fail' && run.verdict !== 'held') {
      res.status(409).json({ ok: false, error: 'nothing-to-rework' });
      return;
    }
    if (isReadOnlyHookAgentId(run.agentId)) {
      res.status(400).json({ ok: false, error: READ_ONLY_HOOK_AGENT_ERROR });
      return;
    }
    const scopeError = verificationScopeError({
      agentId: run.agentId, subAgentId: run.subAgentId, sub: subAgentManager.getSub(run.subAgentId),
    });
    if (scopeError) { res.status(409).json({ ok: false, error: scopeError }); return; }
    const sessionId = graphManager.findSessionByAgentId(run.agentId);
    if (!sessionId) { res.status(409).json({ ok: false, error: 'session-not-found' }); return; }

    // 새 통신 레이어 ❌ — 사용자가 입력창에 친 것과 똑같은 명령 한 건이다.
    let queue = commandQueues.get(sessionId);
    if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now()}-verify-rework`,
      text: buildVerifyReworkPrompt({
        verdict: run.verdict,
        ...(run.focus ? { focus: run.focus } : {}),
        ...(run.reason ? { reason: run.reason } : {}),
        attempts: run.attempts, target: run.target, expected: run.expected, toolEvents: run.toolEvents,
      }),
      timestamp: Date.now(),
      subAgentId: run.subAgentId,
      status: 'queued',
      attachments: (run.evidence ?? []).slice(-VERIFICATION_DEMO_FRAMES_MAX).map((item) => verificationAutomation.evidencePath(run, item.id)).filter((file): file is string => !!file && fs.existsSync(file)),
    };
    queue.push(cmd);
    processNextCommand(sessionId);
    broadcastSnapshot();
    res.json({ ok: true, commandId: cmd.id });
  });

  /** DELETE /api/verification-runs/:id — 목록에서 한 줄 지운다(사람이 지운다, 서버가 스스로 ❌). */
  app.delete('/api/verification-runs/:id', (req, res) => {
    const removedRun = graphManager.findVerificationRun(req.params.id);
    if (removedRun) verificationAutomation.remove(removedRun);
    if (!graphManager.deleteVerificationRun(req.params.id)) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  // §5.5 #17-35 ⑨ — 시연(재현 절차) REST. 레코드 먼저, 그림 나중 — 그림 수는 클라가 뽑아 봐야 알고, 올라오는 동안 진행을 보여야 한다.
  // 중간에 끊긴 시연은 목록에 그대로 보이고 지울 수 있다(조용히 사라지는 것보다 낫다).

  /** 시연에서 사람이 적은 단계 배열을 안전한 모양으로. 잘못된 항목은 조용히 버린다. */
  function sanitizeDemoSteps(raw: unknown): VerificationDemoStep[] {
    if (!Array.isArray(raw)) return [];
    const out: VerificationDemoStep[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const text = typeof o.text === 'string' ? o.text.trim().slice(0, VERIFICATION_DEMO_STEP_TEXT_MAX) : '';
      if (!text) continue;
      const atMs = typeof o.atMs === 'number' && Number.isFinite(o.atMs) && o.atMs > 0 ? Math.round(o.atMs) : 0;
      const action = parseVerificationAction(o.action);
      const check = parseVerificationCheck(o.check);
      out.push({ atMs, text, ...(action ? { action } : {}), ...(check ? { check } : {}) });
      if (out.length >= VERIFICATION_DEMO_STEPS_MAX) break;
    }
    return out;
  }

  /** POST /api/verification-demos — 시연 레코드 생성(그림은 아직 없다). */
  app.post('/api/verification-demos', (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const agentId = typeof body.agentId === 'string' ? body.agentId : '';
    const subAgentId = typeof body.subAgentId === 'string' ? body.subAgentId : '';
    if (!agentId || !subAgentId) {
      res.status(400).json({ ok: false, error: 'agentId and subAgentId required' });
      return;
    }
    // #17-29 — 훅 버블은 전면 읽기 전용. 시연은 그 버블에 명령을 실어 보내기 위한 재료다.
    if (isReadOnlyHookAgentId(agentId)) {
      res.status(400).json({ ok: false, error: READ_ONLY_HOOK_AGENT_ERROR });
      return;
    }
    const scopeError = verificationScopeError({ agentId, subAgentId, sub: subAgentManager.getSub(subAgentId) });
    if (scopeError) { res.status(409).json({ ok: false, error: scopeError }); return; }
    if (!graphManager.getProjectPathForAgent(agentId)) {
      res.status(409).json({ ok: false, error: 'project-not-found' });
      return;
    }
    const sourceName = typeof body.sourceName === 'string' ? body.sourceName.slice(0, VERIFICATION_DEMO_LABEL_MAX) : '';
    const label = (typeof body.label === 'string' && body.label.trim()
      ? body.label.trim()
      : sourceName || 'demo').slice(0, VERIFICATION_DEMO_LABEL_MAX);
    const expected = typeof body.expected === 'string' && body.expected.trim()
      ? body.expected.trim().slice(0, VERIFICATION_DEMO_EXPECTED_MAX)
      : undefined;
    const durationMs = typeof body.durationMs === 'number' && body.durationMs > 0 ? Math.round(body.durationMs) : 0;

    const demo: VerificationDemo = {
      id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      subAgentId,
      projectName: graphManager.getAgentProjectName(agentId) ?? '',
      label,
      sourceName,
      target: parseVerificationTarget(body.target),
      steps: sanitizeDemoSteps(body.steps),
      ...(expected ? { expected } : {}),
      frames: [],
      durationMs,
      recordedAt: Date.now(),
    };

    const evicted = graphManager.addVerificationDemo(demo);
    if (evicted === null) {
      res.status(409).json({ ok: false, error: 'project-not-found' });
      return;
    }
    // 상한에 밀려난 시연의 그림은 여기서 회수한다 — 레코드만 지우면 폴더가 영원히 남는다(§9).
    for (const gone of evicted) removeDemoFrames(gone);

    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, demo });
  });

  /** POST /api/verification-demos/:demoId/frames — 프레임 한 장 추가. 동시 업로드도 원본을 보존한다. */
  app.post('/api/verification-demos/:demoId/frames', createVerificationFrameUpload({
    findDemo: (demoId) => graphManager.findVerificationDemo(demoId),
    updateDemo: (demoId, patch) => graphManager.updateVerificationDemo(demoId, patch),
    framesDir: demoFramesDir,
    onSaved: () => {
      broadcastSnapshot();
      saveCheckpoint();
    },
  }));

  /** PATCH /api/verification-demos/:demoId — 이름·단계·기대 결과 고치기(그림은 그대로). */
  app.patch('/api/verification-demos/:demoId', (req, res) => {
    const demo = graphManager.findVerificationDemo(req.params.demoId);
    if (!demo) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<VerificationDemo> = {};
    if (body.target !== undefined) {
      const target = parseVerificationTarget(body.target);
      if (!target) { res.status(400).json({ ok: false, error: 'invalid-verification-target' }); return; }
      patch.target = target;
    }
    if (typeof body.label === 'string' && body.label.trim()) {
      patch.label = body.label.trim().slice(0, VERIFICATION_DEMO_LABEL_MAX);
    }
    if (typeof body.expected === 'string') {
      const v = body.expected.trim().slice(0, VERIFICATION_DEMO_EXPECTED_MAX);
      patch.expected = v ? v : undefined;
    }
    if (Array.isArray(body.steps)) patch.steps = sanitizeDemoSteps(body.steps);
    const next = graphManager.updateVerificationDemo(demo.id, patch);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, demo: next });
  });

  /** DELETE /api/verification-demos/:demoId — 레코드와 그림을 함께 지운다. */
  app.delete('/api/verification-demos/:demoId', (req, res) => {
    const gone = graphManager.deleteVerificationDemo(req.params.demoId);
    if (!gone) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    removeDemoFrames(gone);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /**
   * GET /api/verification-demos/:demoId/frame?rel=<demoId/0.png> — 저장된 프레임 서빙(재기동 뒤 렌더러에 blob 이 없을 때 목록 썸네일이 이 길로 온다).
   * 그 시연 폴더 안 파일만(트래버설 차단, 첨부 서빙과 같은 규약).
   */
  app.get('/api/verification-demos/:demoId/frame', (req, res) => {
    const demo = graphManager.findVerificationDemo(req.params.demoId);
    if (!demo) { res.status(404).json({ error: 'not found' }); return; }
    const rel = typeof req.query.rel === 'string' ? req.query.rel : '';
    if (!rel || !demo.frames.some((f) => f.rel === rel)) { res.status(404).json({ error: 'frame not found' }); return; }
    const dir = demoFramesDir(demo.agentId, demo.id);
    if (!dir) { res.status(404).json({ error: 'project not found' }); return; }
    const resolved = path.resolve(path.join(dir, path.basename(rel)));
    if (!resolved.startsWith(path.resolve(dir) + path.sep)) { res.status(403).json({ error: 'path outside demo dir' }); return; }
    if (!fs.existsSync(resolved)) { res.status(404).json({ error: 'file missing' }); return; }
    res.type('image/png');
    fs.createReadStream(resolved).pipe(res);
  });

  app.post('/api/play-recipe', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        bubbleId?: unknown;
        kind?: unknown;
        command?: unknown;
        cwd?: unknown;
        root?: unknown;
        port?: unknown;
        openPath?: unknown;
        label?: unknown;
      };
      if (typeof body.bubbleId !== 'string' || !body.bubbleId) {
        res.status(400).json({ ok: false, error: 'bubbleId required' });
        return;
      }
      const bubble = graphManager.getPlayBubble(body.bubbleId);
      if (!bubble) {
        res.status(404).json({ ok: false, error: 'play bubble not found' });
        return;
      }
      const kind = body.kind === 'static' ? 'static' : 'command';
      if (kind === 'command' && (typeof body.command !== 'string' || !body.command.trim())) {
        res.status(400).json({ ok: false, error: 'command required for kind=command' });
        return;
      }
      if (kind === 'static' && (typeof body.root !== 'string' || !body.root.trim())) {
        res.status(400).json({ ok: false, error: 'root required for kind=static' });
        return;
      }
      const recipe: PlayRecipe = {
        kind,
        ...(typeof body.command === 'string' && body.command.trim() ? { command: body.command.trim() } : {}),
        ...(typeof body.cwd === 'string' && body.cwd.trim() ? { cwd: body.cwd.trim() } : {}),
        ...(typeof body.root === 'string' && body.root.trim() ? { root: body.root.trim() } : {}),
        ...(typeof body.port === 'number' && Number.isFinite(body.port) ? { port: body.port } : {}),
        ...(typeof body.openPath === 'string' && body.openPath.trim() ? { openPath: body.openPath.trim() } : {}),
        /*
         * 보안 — 에이전트가 등록한 명령에는 별명을 붙이지 못한다.
         * loopback 토큰은 우리가 스폰한 에이전트에 실려 나가므로, 이름을 명령과 따로 정하게 하면 `label:"개발 서버"` 를 달고 `command` 에 다른 것을 넣을 수 있다 — 사용자는 무엇이 도는지 모르고 누른다.
         * 정적 서빙(`kind='static'`)은 실행할 명령이 없어 그대로 받는다. 화면 짝은 `PlayNode` 의 `subLabel`(이름이 명령과 다르면 명령 원문을 함께 보인다).
         */
        ...(kind === 'static' && typeof body.label === 'string' && body.label.trim()
          ? { label: body.label.trim() }
          : {}),
        source: 'agent',
      };
      const projectPath = playProjectPath(bubble.projectName);
      if (!projectPath || !playRecipeWithinProject(recipe, projectPath)) {
        res.status(400).json({ ok: false, error: 'recipe path outside project' });
        return;
      }
      graphManager.updatePlayBubble(bubble.id, { recipe, status: 'idle', error: undefined });
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('POST /api/play-recipe failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  // ─── §5.15 — 스펙 보드 (요구사항 → 수용 기준 → 작업 카드 → 실행) ───

  /** POST /api/spec-docs — 스펙 한 장을 캔버스에 놓는다. */
  app.post('/api/spec-docs', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        projectName?: unknown;
        x?: unknown;
        y?: unknown;
        width?: unknown;
        height?: unknown;
        title?: unknown;
        body?: unknown;
        items?: unknown;
      };
      if (typeof body.projectName !== 'string' || typeof body.x !== 'number' || typeof body.y !== 'number') {
        res.status(400).json({ ok: false, error: 'projectName, x, y required' });
        return;
      }
      const doc = graphManager.createSpecDoc({
        projectName: body.projectName,
        x: body.x,
        y: body.y,
        width: typeof body.width === 'number' ? body.width : SPEC_BUBBLE_DEFAULT_WIDTH,
        height: typeof body.height === 'number' ? body.height : SPEC_BUBBLE_DEFAULT_HEIGHT,
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
        ...(typeof body.body === 'string' ? { body: body.body } : {}),
        ...(Array.isArray(body.items)
          ? { items: body.items.filter((t): t is string => typeof t === 'string') }
          : {}),
      });
      if (!doc) {
        res.status(500).json({ ok: false, error: 'no project instance registered' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: doc });
    } catch (err) {
      logger.error('POST /api/spec-docs failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** PATCH /api/spec-docs/:id — 좌표·크기·제목·본문·수용 기준. 개정 번호는 서버가 판단해 올린다. */
  app.patch('/api/spec-docs/:id', (req, res) => {
    try {
      const id = req.params['id']!;
      if (!graphManager.getSpecDoc(id)) {
        res.status(404).json({ ok: false, error: 'spec doc not found' });
        return;
      }
      const updated = graphManager.updateSpecDoc(id, (req.body ?? {}) as Partial<SpecDoc>);
      if (!updated) {
        res.status(404).json({ ok: false, error: 'spec doc not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('PATCH /api/spec-docs failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** POST /api/spec-docs/:id/items — 수용 기준 한 줄 추가. */
  app.post('/api/spec-docs/:id/items', (req, res) => {
    try {
      const id = req.params['id']!;
      const text = (req.body as { text?: unknown } | undefined)?.text;
      if (typeof text !== 'string' || !text.trim()) {
        res.status(400).json({ ok: false, error: 'text required' });
        return;
      }
      const updated = graphManager.addSpecItem(id, text.trim().slice(0, SPEC_ITEM_TEXT_MAX));
      if (!updated) {
        res.status(404).json({ ok: false, error: 'spec doc not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('POST /api/spec-docs/:id/items failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** DELETE /api/spec-docs/:id — 스펙만 지운다. 거기서 나온 작업 에이전트·Task Edge 는 남는다. */
  app.delete('/api/spec-docs/:id', (req, res) => {
    try {
      const id = req.params['id']!;
      const doc = graphManager.getSpecDoc(id);
      if (!doc) {
        res.status(404).json({ ok: false, error: 'spec doc not found' });
        return;
      }
      if (doc.preservePinned === true) {
        res.status(409).json({ ok: false, error: 'spec doc preserved' });
        return;
      }
      graphManager.deleteSpecDoc(id);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /api/spec-docs failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * POST /api/spec-docs/:id/generate-tasks — 수용 기준 → 작업 카드.
   * 항목 하나당 기존 `createCustomAgent` 로 버블 한 장, 만든 순서대로 기존 Task Edge 로 사슬처럼 잇는다(새 스폰 경로·엣지 타입 ❌).
   * 이미 카드가 붙은 항목은 건너뛴다(`itemIds` 를 주면 그 항목만). `regenerate` 면 개정 번호만 지금 값으로 올린다 — 카드 재생성 ❌(사람이 만든 작업물을 스펙이 갈아엎지 않는다, §5.15).
   */
  app.post('/api/spec-docs/:id/generate-tasks', (req, res) => {
    try {
      const id = req.params['id']!;
      const doc = graphManager.getSpecDoc(id);
      if (!doc) {
        res.status(404).json({ ok: false, error: 'spec doc not found' });
        return;
      }
      const body = (req.body ?? {}) as { itemIds?: unknown; regenerate?: unknown };
      const wanted = Array.isArray(body.itemIds)
        ? new Set(body.itemIds.filter((v): v is string => typeof v === 'string'))
        : null;
      const regenerate = body.regenerate === true;

      const targets = doc.items.filter((it) => (wanted ? wanted.has(it.id) : true));
      const created: { itemId: string; agentId: string }[] = [];
      const refreshed: string[] = [];
      const edges: string[] = [];
      // 사슬의 앞 고리 — 이번에 만든 카드와 이미 있던 카드를 한 줄로 잇기 위해 항목 순서를 따라간다.
      let prevAgentId: string | null = null;

      for (const item of doc.items) {
        const isTarget = targets.includes(item);
        // 이미 카드가 있는 항목: 사슬의 앞 고리로만 쓰고, regenerate 면 개정 번호를 지금 값으로 올린다.
        if (item.taskAgentId) {
          if (isTarget && regenerate) {
            graphManager.attachSpecTask(doc.id, item.id, item.taskAgentId, item.taskSessionId ?? '');
            refreshed.push(item.id);
          }
          prevAgentId = item.taskAgentId;
          continue;
        }
        if (!isTarget) continue;

        const index = doc.items.indexOf(item);
        const label = item.text.trim().slice(0, SPEC_TASK_LABEL_MAX) || `Spec ${index + 1}`;
        const agent = graphManager.createCustomAgent(
          label,
          { x: doc.x + doc.width + SPEC_TASK_OFFSET_X, y: doc.y + index * SPEC_TASK_GAP_Y },
          doc.projectName,
        );
        // 스펙 보드는 프로젝트 안에서만 사니 여기서 폴더가 없을 일은 없다 — 그래도 임시 폴더를
        // 지어내지 않는 규약(§4 온보딩 ③)이라 없으면 이 항목만 건너뛴다.
        if (!agent) continue;
        // 카드가 만족시킬 것은 rules 자동 섹션으로 얹는다(§7.9 와 같은 문법).
        const cfg = graphManager.getAgentConfig(agent.id);
        if (cfg) {
          const rules = buildSpecTaskRules({
            specTitle: doc.title || doc.id,
            specBody: doc.body,
            itemText: item.text,
            itemIndex: index,
            itemTotal: doc.items.length,
          });
          const existing = (cfg.rules ?? '').replace(
            new RegExp(`${SPEC_RULES_BEGIN}[\\s\\S]*?${SPEC_RULES_END}\\n?`, 'g'),
            '',
          );
          graphManager.setAgentConfig(agent.id, { ...cfg, rules: existing ? `${rules}\n\n${existing}` : rules });
        }
        graphManager.attachSpecTask(doc.id, item.id, agent.id, agent.path);
        created.push({ itemId: item.id, agentId: agent.id });

        // 앞 고리가 있으면 사슬로 잇는다. `delegationPolicy='auto'` 고정 — 기본값 strict 는 소스의 도구를 런타임에 박탈해(§7.9) 형제 카드끼리 서로를 무력화한다.
        if (prevAgentId) {
          try {
            const edge = graphManager.createTaskEdge(
              prevAgentId,
              agent.id,
              label,
              'manual',
              null,
              { kind: 'command', delegationPolicy: 'auto' },
            );
            edges.push(edge.id);
          } catch (err) {
            logger.warn('spec task edge skipped', err);
          }
        }
        prevAgentId = agent.id;
      }

      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: graphManager.getSpecDoc(doc.id) ?? doc, created, refreshed, edges });
    } catch (err) {
      logger.error('POST /api/spec-docs/:id/generate-tasks failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });


  // ─── §5.18 — 에이전트 랩 (같은 과제를 설정만 바꿔 N벌) ───

  /**
   * §5.18 — 변형 하나의 설정 조립. 기준 config 전량을 스프레드한 위에 변형 축만 덮는다.
   * 부분 페이로드를 저장하면 나머지 필드(도구·스킬 등)가 날아가므로 랩의 두 쓰기 경로(실행 스폰 · 승격)는 늘 이 함수를 지난다.
   */
  function mergeLabVariantConfig(base: AgentConfig, variant: LabVariant, extraRules?: string): AgentConfig {
    const cfg = variant.config;
    const rules = (() => {
      const existing = (base.rules ?? '').replace(
        new RegExp(`${LAB_RULES_BEGIN}[\\s\\S]*?${LAB_RULES_END}\\n?`, 'g'),
        '',
      );
      if (extraRules === undefined) return existing;
      return existing.trim() ? `${extraRules}\n\n${existing}` : extraRules;
    })();
    return {
      ...base,
      ...(cfg.model ? { model: cfg.model } : {}),
      ...(cfg.effort ? { effort: cfg.effort } : {}),
      ...(cfg.permissionMode ? { permissionMode: cfg.permissionMode } : {}),
      ...(cfg.maxTurns !== undefined ? { maxTurns: cfg.maxTurns } : {}),
      ...(extraRules !== undefined ? { rules } : {}),
    };
  }

  /**
   * §5.18 — 그 턴이 끝났다. 랩 변형이면 결과를 적는다. 리뷰 레인과 같은 자리(`setOnComplete`)·같은 함수(`collectWorktreeChanges`) — 새 수집기 ❌.
   * 못 읽은 값은 비워 둔다(§5.18 "측정 없음과 0 을 구분한다").
   */
  async function maybeFinishLabVariant(agentId: string, done: QueuedCommand[]): Promise<void> {
    const hit = graphManager.findLabVariantByAgent(agentId);
    if (!hit) return;
    const { run, variant } = hit;
    // 이미 마감된 변형은 건드리지 않는다 — 그 뒤에 사람이 그 카드에 직접 시킨 일까지 표에 섞이면
    // 그 줄은 더 이상 "같은 과제를 한 번 돌린 결과"가 아니게 된다.
    if (variant.result?.status !== 'running') return;

    // 이 회차의 마지막 명령 = 우리가 발사한 과제의 결말.
    const last = [...done].reverse()[0];
    if (!last) return;
    const stopped = typeof last.result === 'string' && last.result.startsWith('[Stopped by user]');
    const status: LabResultStatus = last.status === 'error' ? 'failed' : stopped ? 'stopped' : 'success';

    // 변경분 — 그 변형의 워크트리에서 부모 대비 실제로 달라진 것(§5.16 과 같은 셈법).
    let filesChanged: number | undefined;
    let additions: number | undefined;
    let deletions: number | undefined;
    try {
      const projectName = variant.worktreeProjectName;
      const info = projectName ? graphManager.getProjectByName(projectName) : undefined;
      if (info?.parentProjectPath) {
        const wtAbs = info.path.replace(/\//g, path.sep);
        const parentAbs = info.parentProjectPath.replace(/\//g, path.sep);
        const branch = await getWorktreeBranch(parentAbs, wtAbs);
        const changes = await collectWorktreeChanges(parentAbs, wtAbs, branch);
        filesChanged = changes.files.length;
        additions = changes.files.reduce((sum, f) => sum + f.additions, 0);
        deletions = changes.files.reduce((sum, f) => sum + f.deletions, 0);
      }
    } catch (err) {
      logger.warn(`[agent-lab] change collection failed agent=${agentId}`, err);
    }

    // 토큰 — 그 명령의 증분(서브에이전트가 완료 시 적어 둔 값). 없으면 비워 둔다.
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for (const cmd of done) {
      if (typeof cmd.inputTokens === 'number') inputTokens = (inputTokens ?? 0) + cmd.inputTokens;
      if (typeof cmd.outputTokens === 'number') outputTokens = (outputTokens ?? 0) + cmd.outputTokens;
    }

    const sub = subAgentManager.getPrimarySub(agentId);
    const model = sub?.modelName ?? variant.config.model ?? graphManager.getAgentConfig(agentId)?.model;
    const pricing = model ? getModelPricing(model) : undefined;
    const costUsd = estimateLabCostUsd({
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(pricing ? { pricing: { input: pricing.input, output: pricing.output } } : {}),
    });

    const summary = typeof last.result === 'string' && last.result.trim() ? last.result.trim() : undefined;

    graphManager.finishLabVariant(run.id, variant.id, {
      status,
      finishedAt: Date.now(),
      ...(filesChanged !== undefined ? { filesChanged } : {}),
      ...(additions !== undefined ? { additions } : {}),
      ...(deletions !== undefined ? { deletions } : {}),
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(costUsd !== undefined ? { costUsd } : {}),
      ...(model ? { model } : {}),
      ...(summary ? { summary } : {}),
      ...(status !== 'success' && summary ? { error: summary } : {}),
    });
    broadcastSnapshot();
    saveCheckpoint();
    logger.info(`[agent-lab] variant finished run=${run.id} variant=${variant.label} status=${status} files=${filesChanged ?? '-'} cost=${costUsd ?? '-'}`);
  }

  /** POST /api/lab-runs — 랩 한 장을 캔버스에 놓는다. */
  app.post('/api/lab-runs', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        projectName?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown;
        title?: unknown; task?: unknown; baseAgentId?: unknown;
      };
      const projectName = typeof body.projectName === 'string' && body.projectName
        ? body.projectName
        : graphManager.getPrimaryProject()?.name;
      if (!projectName) {
        res.status(400).json({ ok: false, error: 'no project' });
        return;
      }
      const run = graphManager.createLabRun({
        projectName,
        x: typeof body.x === 'number' ? body.x : 0,
        y: typeof body.y === 'number' ? body.y : 0,
        width: typeof body.width === 'number' ? body.width : LAB_BUBBLE_DEFAULT_WIDTH,
        height: typeof body.height === 'number' ? body.height : LAB_BUBBLE_DEFAULT_HEIGHT,
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
        ...(typeof body.task === 'string' ? { task: body.task } : {}),
        ...(typeof body.baseAgentId === 'string' ? { baseAgentId: body.baseAgentId } : {}),
      });
      if (!run) {
        res.status(404).json({ ok: false, error: 'project instance not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: run });
    } catch (err) {
      logger.error('POST /api/lab-runs failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** PATCH /api/lab-runs/:id — 좌표·크기·제목·과제·기준 에이전트. 도는 중에는 과제가 잠긴다. */
  app.patch('/api/lab-runs/:id', (req, res) => {
    try {
      const id = req.params['id']!;
      const updated = graphManager.updateLabRun(id, (req.body ?? {}) as Record<string, never>);
      if (!updated) {
        res.status(404).json({ ok: false, error: 'lab run not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('PATCH /api/lab-runs failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** PUT /api/lab-runs/:id/variants — 변형 목록 통째 교체(이미 측정된 결과는 지킨다). */
  app.put('/api/lab-runs/:id/variants', (req, res) => {
    try {
      const id = req.params['id']!;
      const body = (req.body ?? {}) as { variants?: unknown };
      if (!Array.isArray(body.variants)) {
        res.status(400).json({ ok: false, error: 'variants must be an array' });
        return;
      }
      const updated = graphManager.setLabVariants(
        id,
        body.variants as { id?: string; label?: string; config?: LabVariantConfig }[],
      );
      if (!updated) {
        res.status(404).json({ ok: false, error: 'lab run not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('PUT /api/lab-runs/:id/variants failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** POST /api/lab-runs/:id/variants — 변형 한 벌 추가. 상한(LAB_MAX_VARIANTS)을 넘으면 409. */
  app.post('/api/lab-runs/:id/variants', (req, res) => {
    try {
      const id = req.params['id']!;
      const body = (req.body ?? {}) as { label?: unknown; config?: unknown };
      const run = graphManager.getLabRun(id);
      if (!run) {
        res.status(404).json({ ok: false, error: 'lab run not found' });
        return;
      }
      const label = typeof body.label === 'string' && body.label.trim()
        ? body.label.trim()
        : `V${run.variants.length + 1}`;
      const updated = graphManager.addLabVariant(id, label, (body.config ?? {}) as LabVariantConfig);
      if (!updated) {
        res.status(409).json({ ok: false, error: 'variant limit reached' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('POST /api/lab-runs/:id/variants failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** DELETE /api/lab-runs/:id/variants/:vid — 표에서 한 줄을 뺀다(만들어진 카드·워크트리는 남는다). */
  app.delete('/api/lab-runs/:id/variants/:vid', (req, res) => {
    try {
      const updated = graphManager.removeLabVariant(req.params['id']!, req.params['vid']!);
      if (!updated) {
        res.status(404).json({ ok: false, error: 'lab run not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('DELETE /api/lab-runs/:id/variants failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * POST /api/lab-runs/:id/start — 변형마다 워크트리 + 카드 + 과제 발사.
   * 새 스폰 경로 ❌ — 격리는 `createWorktreeUnder`(라우트와 같은 함수), 카드는 `createCustomAgent` + `setAgentConfig`, 발사는 기존 명령 큐(`enqueueAgentCommand`).
   * 변형 하나가 실패해도 나머지는 계속 돈다(그 줄만 `failed`).
   */
  app.post('/api/lab-runs/:id/start', (req, res) => {
    void (async () => {
      try {
        const id = req.params['id']!;
        const run = graphManager.getLabRun(id);
        if (!run) {
          res.status(404).json({ ok: false, error: 'lab run not found' });
          return;
        }
        const task = run.task.trim();
        if (!task) {
          res.status(400).json({ ok: false, error: 'task is empty' });
          return;
        }
        const body = (req.body ?? {}) as { variantIds?: unknown };
        const wanted = Array.isArray(body.variantIds)
          ? new Set(body.variantIds.filter((v): v is string => typeof v === 'string'))
          : null;
        // 이미 도는 변형은 다시 쏘지 않는다 — 같은 워크트리에 두 벌이 겹치면 표가 무의미해진다.
        const targets = run.variants.filter(
          (v) => (wanted ? wanted.has(v.id) : true) && v.result?.status !== 'running',
        );
        if (targets.length === 0) {
          res.status(400).json({ ok: false, error: 'no runnable variants' });
          return;
        }

        // 기준 설정 — 지정된 에이전트가 있으면 그 설정 전량, 없으면 새 카드의 기본 설정을 그대로 쓴다.
        const baseCfg = run.baseAgentId ? graphManager.getAgentConfig(run.baseAgentId) : undefined;
        const started: { variantId: string; agentId: string; worktree: string }[] = [];
        const failed: { variantId: string; error: string }[] = [];

        for (const [index, variant] of targets.entries()) {
          const suffix = `${run.id.slice(-6)}-${index + 1}`;
          const wt = await createWorktreeUnder({
            project: run.projectName,
            name: `${LAB_WORKTREE_PREFIX}-${suffix}`,
          });
          if (!wt.ok) {
            graphManager.finishLabVariant(run.id, variant.id, {
              status: 'failed',
              finishedAt: Date.now(),
              error: wt.error,
            });
            failed.push({ variantId: variant.id, error: wt.error });
            continue;
          }
          const wtProjectName = path.basename(wt.path);
          const label = `${run.title.trim() || 'Lab'} · ${variant.label}`.slice(0, LAB_VARIANT_LABEL_MAX + 20);
          const agent = graphManager.createCustomAgent(
            label,
            { x: run.x + run.width + LAB_CARD_OFFSET_X, y: run.y + index * LAB_CARD_GAP_Y },
            wtProjectName,
          );
          // 방금 만든 워크트리가 인스턴스로 안 잡히면 카드를 만들 자리가 없다 — 바로 위 워크트리
          // 실패와 **같은 모양으로** 신고한다(조용히 건너뛰면 변형 하나가 이유 없이 빠진다).
          if (!agent) {
            graphManager.finishLabVariant(run.id, variant.id, {
              status: 'failed',
              finishedAt: Date.now(),
              error: NO_PROJECT_FOLDER_ERROR,
            });
            failed.push({ variantId: variant.id, error: NO_PROJECT_FOLDER_ERROR });
            continue;
          }

          // 설정 — 기준 config 전량 스프레드 위에 변형 축만. 부분 페이로드 저장 ❌(실측된 함정).
          const current = graphManager.getAgentConfig(agent.id);
          const base: AgentConfig = { ...(current ?? DEFAULT_AGENT_CONFIG), ...(baseCfg ?? {}) };
          const rules = buildLabVariantRules({
            labTitle: run.title.trim() || run.id,
            variantLabel: variant.label,
            variantIndex: index,
            variantTotal: targets.length,
            ...(variant.config.rulesAppend ? { rulesAppend: variant.config.rulesAppend } : {}),
          });
          graphManager.setAgentConfig(agent.id, mergeLabVariantConfig(base, variant, rules));

          graphManager.attachLabVariantRun(run.id, variant.id, {
            agentId: agent.id,
            sessionId: agent.path,
            worktreeProjectName: wtProjectName,
            worktreePath: wt.path,
            branch: wt.branch,
            startedAt: Date.now(),
          });
          // §5.3 #12-4 — 랩 과제는 사람이 적은 문장이다. 거기서 요청한 검증만 각 변형에 열린다.
          enqueueAgentCommand(agent.id, task, 'lab', undefined, verificationScopeFromText(task));
          started.push({ variantId: variant.id, agentId: agent.id, worktree: wtProjectName });
        }

        broadcastSnapshot();
        saveCheckpoint();
        logger.info(`[agent-lab] started run=${run.id} variants=${started.length} failed=${failed.length}`);
        res.json({ ok: true, data: graphManager.getLabRun(run.id) ?? run, started, failed });
      } catch (err) {
        logger.error('POST /api/lab-runs/:id/start failed', err);
        res.status(500).json({ ok: false, error: 'internal error' });
      }
    })();
  });

  /**
   * POST /api/lab-runs/:id/variants/:vid/promote — 이긴 설정을 그 에이전트의 기본값으로(대상은 `targetAgentId`, 없으면 랩의 기준 에이전트).
   * 현재 config 전량을 스프레드한 뒤 바꾼 축만 덮는다. 자동 규칙 블록은 얹지 않는다 — 승격은 설정을 옮기는 것이지 그 카드를 랩 변형으로 만드는 것이 아니다.
   */
  app.post('/api/lab-runs/:id/variants/:vid/promote', (req, res) => {
    try {
      const id = req.params['id']!;
      const vid = req.params['vid']!;
      const run = graphManager.getLabRun(id);
      if (!run) {
        res.status(404).json({ ok: false, error: 'lab run not found' });
        return;
      }
      const variant = run.variants.find((v) => v.id === vid);
      if (!variant) {
        res.status(404).json({ ok: false, error: 'variant not found' });
        return;
      }
      const body = (req.body ?? {}) as { targetAgentId?: unknown };
      const targetAgentId = typeof body.targetAgentId === 'string' && body.targetAgentId
        ? body.targetAgentId
        : run.baseAgentId;
      if (!targetAgentId) {
        res.status(400).json({ ok: false, error: 'no target agent (set baseAgentId or pass targetAgentId)' });
        return;
      }
      const current = graphManager.getAgentConfig(targetAgentId);
      if (!current) {
        res.status(404).json({ ok: false, error: 'target agent config not found' });
        return;
      }
      graphManager.setAgentConfig(targetAgentId, mergeLabVariantConfig(current, variant));
      const updated = graphManager.markLabPromoted(id, vid);
      broadcastSnapshot();
      saveCheckpoint();
      logger.info(`[agent-lab] promoted run=${id} variant=${variant.label} -> agent=${targetAgentId}`);
      res.json({ ok: true, data: updated ?? run, targetAgentId });
    } catch (err) {
      logger.error('POST /api/lab-runs/:id/variants/:vid/promote failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** DELETE /api/lab-runs/:id — 랩만 지운다. 변형이 만든 카드·워크트리는 남는다. */
  app.delete('/api/lab-runs/:id', (req, res) => {
    try {
      const id = req.params['id']!;
      const run = graphManager.getLabRun(id);
      if (!run) {
        res.status(404).json({ ok: false, error: 'lab run not found' });
        return;
      }
      if (!graphManager.deleteLabRun(id)) {
        res.status(409).json({ ok: false, error: 'lab run is preserve-pinned' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /api/lab-runs failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  // ─── §5.20 스크립트 선반 (Shelf) ───

  /** §5.20 — 선반 항목의 작업 디렉터리. 항목의 `cwd` 가 프로젝트 밖이면 받지 않는다(가져온 선반 파일이 남의 기계 경로를 들고 올 수 있다). 기존 `validatePathWithinRoot` 를 쓴다. */
  function resolveShelfCwd(projectName: string, cwd?: string): { ok: true; cwd: string } | { ok: false; error: string } {
    const info = graphManager.getProjectByName(projectName);
    const root = info?.path;
    if (!root) return { ok: false, error: `project not found: ${projectName}` };
    const rootAbs = root.replace(/\//g, path.sep);
    if (!cwd || !cwd.trim()) return { ok: true, cwd: rootAbs };
    const safe = validatePathWithinRoot(cwd.trim(), rootAbs);
    if (!safe) return { ok: false, error: 'cwd is outside the project' };
    return { ok: true, cwd: safe };
  }

  /**
   * §5.20 — 셸 항목 한 번 실행. 끝나는 일이라 출력을 모아 결과로 돌려준다(서버를 띄우는 detached 기동은 §5.14 플레이 버블 몫).
   * `SHELF_RUN_TIMEOUT_MS` 를 넘기면 프로세스 트리를 정리하고 그때까지의 출력과 함께 실패로 적는다.
   */
  function runShelfCommand(command: string, cwd: string): Promise<{
    exitCode?: number;
    output: string;
    outputTruncated: boolean;
    error?: string;
  }> {
    return new Promise((resolve) => {
      let out = '';
      let truncated = false;
      let settled = false;

      const append = (chunk: string): void => {
        out += chunk;
        if (out.length > SHELF_RUN_OUTPUT_MAX_CHARS) {
          out = out.slice(-SHELF_RUN_OUTPUT_MAX_CHARS);
          truncated = true;
        }
      };

      let child: ChildProcess;
      try {
        // POSIX 는 `detached: true` 로 자식을 프로세스 그룹 리더로 만든다 — 그래야 타임아웃 때
        // `killTree` 의 `process.kill(-pid)` 가 셸이 낳은 손자까지 한 번에 정리한다(Windows 는
        // `taskkill /T` 라 불필요하고, detached 는 콘솔 창이 따로 뜨는 부작용이 있어 켜지 않는다).
        child = spawn(command, { cwd, shell: true, windowsHide: true, detached: process.platform !== 'win32' });
      } catch (err) {
        resolve({ output: '', outputTruncated: false, error: err instanceof Error ? err.message : String(err) });
        return;
      }
      registerSpawnedPid(child.pid);
      // §5.3 #9-2 — 선반 명령도 묶는다(사용자 스크립트라 주인 세션이 없어 알림은 진단 로그만). 시간 초과로
      //   끊을 때 `taskkill /T` 가 놓친 손자도 본체 종료 뒤 정리된다.
      processGuard.guardChild(child, null, 'shelf', { reapOnExit: true });

      child.stdout?.on('data', (d: Buffer) => append(d.toString()));
      child.stderr?.on('data', (d: Buffer) => append(d.toString()));

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        terminateChildTree(child);
        resolve({
          output: out,
          outputTruncated: truncated,
          error: `timed out after ${Math.round(SHELF_RUN_TIMEOUT_MS / 1000)}s`,
        });
      }, SHELF_RUN_TIMEOUT_MS);

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unregisterSpawnedPid(child.pid);
        resolve({ output: out, outputTruncated: truncated, error: err.message });
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unregisterSpawnedPid(child.pid);
        resolve({
          ...(typeof code === 'number' ? { exitCode: code } : {}),
          output: out,
          outputTruncated: truncated,
          ...(typeof code === 'number' && code !== 0 ? { error: `exit code ${code}` } : {}),
        });
      });
    });
  }

  /** §5.20 — 프롬프트 항목의 그 턴이 끝났다. 그 줄의 결과를 마감한다(§5.18 랩과 같은 자리 `setOnComplete`) — 발사 시점에 성공으로 적으면 화면이 먼저 "끝났다"고 말한다. */
  function maybeFinishShelfPromptRun(agentId: string, done: QueuedCommand[]): void {
    const hit = graphManager.findShelfItemByAgent(agentId);
    if (!hit) return;
    const last = [...done].reverse()[0];
    if (!last) return;
    const stopped = typeof last.result === 'string' && last.result.startsWith('[Stopped by user]');
    const summary = typeof last.result === 'string' && last.result.trim() ? last.result.trim() : undefined;
    graphManager.finishShelfItemRun(hit.bubble.id, hit.item.id, {
      status: last.status === 'error' || stopped ? 'failed' : 'success',
      finishedAt: Date.now(),
      ...(summary !== undefined ? { output: summary } : {}),
      ...(last.status === 'error' && summary ? { error: summary } : {}),
      ...(stopped ? { error: 'stopped by user' } : {}),
    });
    logger.info(`[shelf] prompt run finished shelf=${hit.bubble.id} item=${hit.item.label} agent=${agentId}`);
  }

  /** POST /api/shelf-bubbles — 선반 한 장을 캔버스에 놓는다. */
  app.post('/api/shelf-bubbles', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        projectName?: unknown; x?: unknown; y?: unknown; width?: unknown; height?: unknown; title?: unknown;
      };
      const projectName = typeof body.projectName === 'string' && body.projectName
        ? body.projectName
        : graphManager.getPrimaryProject()?.name;
      if (!projectName) {
        res.status(400).json({ ok: false, error: 'no project' });
        return;
      }
      const bubble = graphManager.createShelfBubble({
        projectName,
        x: typeof body.x === 'number' ? body.x : 0,
        y: typeof body.y === 'number' ? body.y : 0,
        width: typeof body.width === 'number' ? body.width : SHELF_BUBBLE_DEFAULT_WIDTH,
        height: typeof body.height === 'number' ? body.height : SHELF_BUBBLE_DEFAULT_HEIGHT,
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
      });
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: bubble });
    } catch (err) {
      logger.error('POST /api/shelf-bubbles failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** PATCH /api/shelf-bubbles/:id — 좌표·크기·제목·고정. */
  app.patch('/api/shelf-bubbles/:id', (req, res) => {
    try {
      const id = req.params['id']!;
      const updated = graphManager.updateShelfBubble(id, (req.body ?? {}) as Record<string, never>);
      if (!updated) {
        res.status(404).json({ ok: false, error: 'shelf not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('PATCH /api/shelf-bubbles failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** DELETE /api/shelf-bubbles/:id — 고정된 선반은 409. */
  app.delete('/api/shelf-bubbles/:id', (req, res) => {
    try {
      const id = req.params['id']!;
      const existing = graphManager.getShelfBubble(id);
      if (!existing) {
        res.status(404).json({ ok: false, error: 'shelf not found' });
        return;
      }
      if (!graphManager.deleteShelfBubble(id)) {
        res.status(409).json({ ok: false, error: 'shelf preserved (pinned)' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /api/shelf-bubbles failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** POST /api/shelf-bubbles/:id/items — 항목 한 줄 추가. 상한을 넘으면 409. */
  app.post('/api/shelf-bubbles/:id/items', (req, res) => {
    try {
      const id = req.params['id']!;
      const body = (req.body ?? {}) as {
        label?: unknown; kind?: unknown; command?: unknown; prompt?: unknown; icon?: unknown; color?: unknown;
      };
      const bubble = graphManager.getShelfBubble(id);
      if (!bubble) {
        res.status(404).json({ ok: false, error: 'shelf not found' });
        return;
      }
      const kind: ShelfItemKind = body.kind === 'prompt' ? 'prompt' : 'command';
      const updated = graphManager.addShelfItem(id, {
        label: typeof body.label === 'string' ? body.label : '',
        kind,
        ...(typeof body.command === 'string' ? { command: body.command } : {}),
        ...(typeof body.prompt === 'string' ? { prompt: body.prompt } : {}),
        icon: normalizeShelfIcon(body.icon, kind),
        color: normalizeShelfColor(body.color),
      });
      if (!updated) {
        res.status(409).json({ ok: false, error: 'item limit reached' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('POST /api/shelf-bubbles/:id/items failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** PATCH /api/shelf-bubbles/:id/items/:itemId — 항목 한 줄 수정. */
  app.patch('/api/shelf-bubbles/:id/items/:itemId', (req, res) => {
    try {
      const id = req.params['id']!;
      const itemId = req.params['itemId']!;
      const updated = graphManager.updateShelfItem(id, itemId, (req.body ?? {}) as Record<string, never>);
      if (!updated) {
        res.status(404).json({ ok: false, error: 'shelf item not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('PATCH /api/shelf-bubbles/:id/items failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** DELETE /api/shelf-bubbles/:id/items/:itemId — 항목 한 줄 삭제. */
  app.delete('/api/shelf-bubbles/:id/items/:itemId', (req, res) => {
    try {
      const id = req.params['id']!;
      const itemId = req.params['itemId']!;
      const updated = graphManager.removeShelfItem(id, itemId);
      if (!updated) {
        res.status(404).json({ ok: false, error: 'shelf item not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('DELETE /api/shelf-bubbles/:id/items failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** PUT /api/shelf-bubbles/:id/items/order — 항목 순서 바꾸기. */
  app.put('/api/shelf-bubbles/:id/items/order', (req, res) => {
    try {
      const id = req.params['id']!;
      const body = (req.body ?? {}) as { order?: unknown };
      if (!Array.isArray(body.order)) {
        res.status(400).json({ ok: false, error: 'order must be an array' });
        return;
      }
      const updated = graphManager.reorderShelfItems(
        id,
        body.order.filter((v): v is string => typeof v === 'string'),
      );
      if (!updated) {
        res.status(404).json({ ok: false, error: 'shelf not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, data: updated });
    } catch (err) {
      logger.error('PUT /api/shelf-bubbles/:id/items/order failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** POST /api/shelf-bubbles/:id/import — 가져온 JSON 한 장을 이 선반에 얹는다. 파일 내용을 믿지 않는다 — shared `normalizeShelfImport` 가 스키마 버전·아이콘·색·길이·개수를 훑은 뒤에야 항목이 된다(클라도 같은 함수로 미리 보인다). */
  app.post('/api/shelf-bubbles/:id/import', (req, res) => {
    try {
      const id = req.params['id']!;
      const body = (req.body ?? {}) as { payload?: unknown; replace?: unknown };
      const parsed = normalizeShelfImport(body.payload);
      if (!parsed.ok) {
        res.status(400).json({ ok: false, error: parsed.error ?? 'invalid shelf file' });
        return;
      }
      const result = graphManager.importShelfItems(id, parsed.items, body.replace === true);
      if (!result) {
        res.status(404).json({ ok: false, error: 'shelf not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      logger.info(`[shelf] imported shelf=${id} added=${result.added} dropped=${result.dropped + parsed.dropped}`);
      res.json({ ok: true, data: result.bubble, added: result.added, dropped: result.dropped + parsed.dropped });
    } catch (err) {
      logger.error('POST /api/shelf-bubbles/:id/import failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /** POST /api/shelf-bubbles/:id/items/:itemId/run — 그 줄을 누른다. 갈래는 둘이고 둘 다 기존 경로다(§5.20) — 셸은 여기서 돌려 출력을 결과로, 프롬프트는 기존 명령 큐로 보내고 턴 끝에 `setOnComplete` 가 마감한다. */
  app.post('/api/shelf-bubbles/:id/items/:itemId/run', (req, res) => {
    void (async () => {
      try {
        const id = req.params['id']!;
        const itemId = req.params['itemId']!;
        const bubble = graphManager.getShelfBubble(id);
        if (!bubble) {
          res.status(404).json({ ok: false, error: 'shelf not found' });
          return;
        }
        const item = bubble.items.find((i) => i.id === itemId);
        if (!item) {
          res.status(404).json({ ok: false, error: 'shelf item not found' });
          return;
        }
        if (item.lastRun?.status === 'running') {
          res.status(409).json({ ok: false, error: 'already running' });
          return;
        }

        if (item.kind === 'prompt') {
          const prompt = (item.prompt ?? '').trim();
          if (!prompt) {
            res.status(400).json({ ok: false, error: 'prompt is empty' });
            return;
          }
          // 대상 카드 — 지정된 것이 아직 캔버스에 있으면 그 카드로, 없으면 한 장 만든다(§5.18 과 같은 방식).
          const agents = graphManager.getSnapshot().agents;
          let targetId = item.targetAgentId && agents.some((a) => a.id === item.targetAgentId)
            ? item.targetAgentId
            : undefined;
          let sessionId = targetId ? agents.find((a) => a.id === targetId)?.path : undefined;
          if (!targetId) {
            const label = `${bubble.title.trim() || 'Shelf'} · ${item.label}`.slice(0, SHELF_LABEL_MAX + 20);
            const agent = graphManager.createCustomAgent(
              label,
              { x: bubble.x + bubble.width + SHELF_CARD_OFFSET_X, y: bubble.y },
              bubble.projectName,
            );
            if (!agent) { respondNoProjectFolder(res, 'shelf-run'); return; }
            targetId = agent.id;
            sessionId = agent.path;
          }
          graphManager.startShelfItemRun(id, itemId, {
            agentId: targetId,
            ...(sessionId ? { sessionId } : {}),
          });
          const sent = enqueueAgentCommand(targetId, prompt, 'shelf');
          if (!sent) {
            graphManager.finishShelfItemRun(id, itemId, { status: 'failed', error: 'could not reach the agent' });
          }
          broadcastSnapshot();
          saveCheckpoint();
          res.json({ ok: true, data: graphManager.getShelfBubble(id), agentId: targetId });
          return;
        }

        const command = (item.command ?? '').trim();
        if (!command) {
          res.status(400).json({ ok: false, error: 'command is empty' });
          return;
        }
        const where = resolveShelfCwd(bubble.projectName, item.cwd);
        if (!where.ok) {
          graphManager.startShelfItemRun(id, itemId);
          graphManager.finishShelfItemRun(id, itemId, { status: 'failed', error: where.error });
          broadcastSnapshot();
          saveCheckpoint();
          res.json({ ok: true, data: graphManager.getShelfBubble(id) });
          return;
        }

        // 도는 동안 캔버스가 그렇게 보이도록 먼저 알린다(끝나고 한 번에 알리면 누른 티가 안 난다).
        graphManager.startShelfItemRun(id, itemId);
        broadcastSnapshot();

        const out = await runShelfCommand(command, where.cwd);
        graphManager.finishShelfItemRun(id, itemId, {
          status: out.error ? 'failed' : 'success',
          finishedAt: Date.now(),
          ...(out.exitCode !== undefined ? { exitCode: out.exitCode } : {}),
          output: out.output,
          outputTruncated: out.outputTruncated,
          ...(out.error !== undefined ? { error: out.error } : {}),
        });
        broadcastSnapshot();
        saveCheckpoint();
        logger.info(`[shelf] command finished shelf=${id} item=${item.label} exit=${out.exitCode ?? '-'}`);
        res.json({ ok: true, data: graphManager.getShelfBubble(id) });
      } catch (err) {
        logger.error('POST /api/shelf-bubbles/:id/items/:itemId/run failed', err);
        res.status(500).json({ ok: false, error: 'internal error' });
      }
    })();
  });

  /** DELETE /api/spec-docs/:id/items/:itemId/task — 항목에서 카드 연결만 끊는다(에이전트는 남는다). */
  app.delete('/api/spec-docs/:id/items/:itemId/task', (req, res) => {
    try {
      const ok = graphManager.detachSpecTask(req.params['id']!, req.params['itemId']!);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'spec item not found' });
        return;
      }
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE spec task link failed', err);
      res.status(500).json({ ok: false, error: 'internal error' });
    }
  });

  /**
   * §5.4 #29 — Canvas 복사·붙여넣기. 클라 localStorage 의 CanvasClipboardPayload + 대상 projectName + anchor(캔버스 좌표)를 받아 커스텀 에이전트/Task Edge/Comment Box 묶음을 새 ID 로 한 번에 복원한다.
   * 순서: 1) agents → createCustomAgent + setAgentConfig(oldId→newId 매핑) 2) taskEdges → createTaskEdge(returnFormat='both' 자매 엣지는 자동) 3) commentBoxes → childOldIds 매핑 후 createCommentBox 4) broadcastSnapshot + saveCheckpoint
   */
  app.post('/api/canvas/paste', (req, res) => {
    try {
      const body = req.body as {
        projectName?: string;
        anchor?: { x?: number; y?: number };
        payload?: CanvasClipboardPayload;
      };
      const projectName = body.projectName;
      const anchor = body.anchor;
      const payload = body.payload;
      if (typeof projectName !== 'string' || !projectName) {
        res.status(400).json({ ok: false, error: 'projectName required' });
        return;
      }
      if (!anchor || typeof anchor.x !== 'number' || typeof anchor.y !== 'number') {
        res.status(400).json({ ok: false, error: 'anchor {x,y} required' });
        return;
      }
      if (!payload || typeof payload !== 'object') {
        res.status(400).json({ ok: false, error: 'payload required' });
        return;
      }
      if (payload.schemaVersion !== CANVAS_CLIPBOARD_SCHEMA_VERSION) {
        res.status(400).json({ ok: false, error: `unsupported schemaVersion: ${String(payload.schemaVersion)}` });
        return;
      }
      if (!Array.isArray(payload.agents) || !Array.isArray(payload.taskEdges) || !Array.isArray(payload.commentBoxes)) {
        res.status(400).json({ ok: false, error: 'payload.agents/taskEdges/commentBoxes must be arrays' });
        return;
      }

      // (0) 대상 프로젝트가 stub 이면 먼저 hydrate — 미hydrate 인스턴스에 createCustomAgent 가
      //     primaryInstance 로 폴백되어 다른 프로젝트에 새 agent 가 생성되는 사고 방지.
      if (graphManager.isStubbed(projectName)) {
        const hydrateResult = graphManager.hydrateProject(projectName);
        if (!hydrateResult.ok && hydrateResult.reason !== 'already-hydrated') {
          logger.warn(`canvas/paste: hydrate failed for "${projectName}" — reason=${String(hydrateResult.reason)}`);
          res.status(400).json({ ok: false, error: `target project "${projectName}" not hydratable: ${String(hydrateResult.reason)}` });
          return;
        }
      }

      // 대상 프로젝트의 ProjectInfo 가 정말 등록되어 있는지 검증 — 없으면 createCustomAgent 가
      //     resolveProjectCwd 의 fallback(첫 번째 project) 로 빠져 sessionCwds 가 틀린 cwd 로 매핑됨 → 체크포인트에서 누락.
      const knownProjects = graphManager.getProjects();
      const isKnownProject = Object.values(knownProjects).some((p) => p.name === projectName);
      if (!isKnownProject) {
        logger.warn(`canvas/paste: target project "${projectName}" not registered in any hydrated instance`);
        res.status(400).json({ ok: false, error: `target project "${projectName}" is not registered (open the project tab first)` });
        return;
      }

      const anchorX = anchor.x;
      const anchorY = anchor.y;
      const idMap: CanvasPasteResponse['idMap'] = { agents: {}, edges: {}, commentBoxes: {} };

      // (1) 에이전트 복제
      for (const entry of payload.agents) {
        if (!entry || typeof entry.oldId !== 'string') continue;
        const rel = entry.relPosition ?? { x: 0, y: 0 };
        const position = {
          x: anchorX + (typeof rel.x === 'number' ? rel.x : 0),
          y: anchorY + (typeof rel.y === 'number' ? rel.y : 0),
        };
        const created = graphManager.createCustomAgent(entry.label ?? '', position, projectName);
        // 붙여넣기는 프로젝트를 고른 캔버스에서만 일어나지만, 임시 폴더를 지어내는 대신
        // 그 항목만 건너뛴다(§4 온보딩 ③) — idMap 에 안 들어가면 뒤 단계도 알아서 빠진다.
        if (!created) continue;
        idMap.agents[entry.oldId] = created.id;

        // AgentConfig 적용 — 클라이언트가 strip 했지만 서버에서도 rulesHistory 방어 제거.
        const cfg = entry.config;
        if (cfg && typeof cfg === 'object') {
          const safeConfig = { ...(cfg as AgentConfig) };
          if ('rulesHistory' in safeConfig) {
            delete (safeConfig as { rulesHistory?: RulesHistoryEntry[] }).rulesHistory;
          }
          graphManager.setAgentConfig(created.id, safeConfig);
        }
      }
      logger.info(`canvas/paste: project="${projectName}" anchor=(${anchorX},${anchorY}) agents=${payload.agents.length}->${Object.keys(idMap.agents).length} edges=${payload.taskEdges.length} boxes=${payload.commentBoxes.length}`);

      // (2) Task Edge 복제 — 양 끝이 idMap 에 모두 있을 때만 생성
      payload.taskEdges.forEach((edgeEntry, idx) => {
        if (!edgeEntry) return;
        const newSrc = idMap.agents[edgeEntry.sourceOldId];
        const newDst = idMap.agents[edgeEntry.targetOldId];
        if (!newSrc || !newDst) return;
        try {
          const created = graphManager.createTaskEdge(
            newSrc,
            newDst,
            typeof edgeEntry.command === 'string' ? edgeEntry.command : '',
            edgeEntry.forwardMode ?? 'manual',
            edgeEntry.templateId ?? null,
            {
              ...(edgeEntry.kind !== undefined && { kind: edgeEntry.kind }),
              ...(edgeEntry.messageFormat !== undefined && { messageFormat: edgeEntry.messageFormat }),
              ...(edgeEntry.messageSchema !== undefined && { messageSchema: edgeEntry.messageSchema }),
              ...(edgeEntry.returnFormat !== undefined && { returnFormat: edgeEntry.returnFormat }),
              ...(edgeEntry.timeoutMs !== undefined && { timeoutMs: edgeEntry.timeoutMs }),
              ...(edgeEntry.retryCount !== undefined && { retryCount: edgeEntry.retryCount }),
              ...(edgeEntry.cacheEnabled !== undefined && { cacheEnabled: edgeEntry.cacheEnabled }),
              ...(edgeEntry.priority !== undefined && { priority: edgeEntry.priority }),
              ...(edgeEntry.delegationPolicy !== undefined && { delegationPolicy: edgeEntry.delegationPolicy }),
              ...(edgeEntry.critiqueTiming !== undefined && { critiqueTiming: edgeEntry.critiqueTiming }),
              ...(edgeEntry.critiqueAuthority !== undefined && { critiqueAuthority: edgeEntry.critiqueAuthority }),
              ...(edgeEntry.maxReworkCount !== undefined && { maxReworkCount: edgeEntry.maxReworkCount }),
              ...(edgeEntry.commandMode !== undefined && { commandMode: edgeEntry.commandMode }),
            },
          );
          idMap.edges[String(idx)] = created.id;
        } catch (err) {
          logger.warn(`canvas/paste: skip edge ${edgeEntry.sourceOldId}->${edgeEntry.targetOldId}: ${String(err)}`);
        }
      });

      // (3) Comment Box 복제 — childOldIds 를 idMap.agents 로 매핑(매칭 없는 oldId 는 drop)
      payload.commentBoxes.forEach((boxEntry, idx) => {
        if (!boxEntry) return;
        const childNodeIds: string[] = [];
        if (Array.isArray(boxEntry.childOldIds)) {
          for (const oid of boxEntry.childOldIds) {
            const mapped = idMap.agents[oid];
            if (mapped) childNodeIds.push(mapped);
          }
        }
        const created = graphManager.createCommentBox({
          projectName,
          x: anchorX + (typeof boxEntry.relX === 'number' ? boxEntry.relX : 0),
          y: anchorY + (typeof boxEntry.relY === 'number' ? boxEntry.relY : 0),
          width: typeof boxEntry.width === 'number' ? boxEntry.width : 200,
          height: typeof boxEntry.height === 'number' ? boxEntry.height : 120,
          text: typeof boxEntry.text === 'string' ? boxEntry.text : '',
          ...(typeof boxEntry.color === 'string' && { color: boxEntry.color }),
          ...(typeof boxEntry.textColor === 'string' && { textColor: boxEntry.textColor }),
          ...(typeof boxEntry.fontSize === 'number' && { fontSize: boxEntry.fontSize }),
          ...(typeof boxEntry.opacity === 'number' && { opacity: boxEntry.opacity }),
          childNodeIds,
        });
        if (created) idMap.commentBoxes[String(idx)] = created.id;
      });

      broadcastSnapshot();
      saveCheckpoint();
      // 타깃 프로젝트 강제 영속화 — saveCheckpoint() 의 getProjectNames() 가 worktree-key 인스턴스를
      // 제외하거나 다른 필터로 타깃을 빼먹는 경우, paste 직후에는 새 에이전트가 디스크에 안 박힌 채
      // 다음 unload/restart 에서 사라진다. paste 결과는 무조건 타깃 체크포인트로 직접 flush.
      try {
        const cp = graphManager.toProjectCheckpoint(projectName);
        writeCheckpoint(cp);
      } catch (err) {
        logger.warn(`canvas/paste: direct flush failed for "${projectName}": ${err instanceof Error ? err.message : String(err)}`);
      }

      const response: CanvasPasteResponse = { ok: true, idMap };
      res.json(response);
    } catch (err) {
      logger.error('POST /api/canvas/paste failed', err);
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  });

  // §5.3 #10-2 (위임 결과 복구) — 결과는 대기 소켓이 아니라 장부가 쥔다. 대기는 여럿이 걸 수 있고 하나가 풀려도(제한시간·연결 끊김) 작업은 돈다 — 끝나면 장부에 적고 남은 대기에만 건넨다.
  //   메모리 장부라 앱 재시작을 넘지 않는다.
  const dispatchJobs = createDispatchJobRegistry();
  const dispatchWaiters = createDispatchWaiterHub<DispatchJob>();
  const orchestraResults = new OrchestraResultCollector();
  let orchestraCompletionDepth = 0;
  let completingCommands = false;
  let completeCommandsAgain = false;
  const DISPATCH_LOOKUP_HTTP_STATUS = { 'requester-required': 400, forbidden: 403, 'not-found': 404 } as const;

  /**
   * §5.3 #10-2 — 이 세션이 띄우고 아직 끝난 결과를 받지 못한 위임. 턴 끝 가드와 다음 턴 안내가 같은 목록을 쓴다.
   * 엣지를 지운 작업은 뺀다 — 사용자가 걷어 낸 위임 때문에 그 세션의 턴이 계속 실패로 끝나지 않게.
   */
  const pendingDispatchResultsFor = (subAgentId: string): DispatchJob[] =>
    dispatchJobs.listUndelivered({ requesterSubAgentId: subAgentId }).filter((job) => !!graphManager.getTaskEdge(job.edgeId));

  /** `agentId` — 이 주소를 받을 조회자. 위임 조회자에게 소스 id 를 실어 주면 남의 이름으로 부르게 된다. */
  const dispatchStatusUrl = (job: DispatchJob, agentId: string = job.sourceAgentId): string =>
    `/api/task-edges/dispatch/${encodeURIComponent(job.cmdId)}?agentId=${encodeURIComponent(agentId)}`;

  /** 결과를 받아야 하는 작업인데 아직 끝나지 않았다 — 이 응답은 "접수됨"이지 결과가 아니다. */
  const isDispatchResultPending = (job: DispatchJob): boolean =>
    job.expectsResult === true && !isTerminalDispatchJobStatus(job.status);

  /** 진행 중 응답에 싣는 다음 할 일 — 다시 dispatch 하면 같은 일이 두 번 돈다. */
  const dispatchPendingNext = (job: DispatchJob): string =>
    `The task is still ${job.status} and its result has not reached you. Do not dispatch it again. `
    + `Retrieve it with this cmdId (GET statusUrl with &waitMs=60000, or the status tool) until status is completed, error or cancelled; `
    + 'ending the turn without the result is recorded as a failure.';

  /**
   * dispatch 응답 몸체 — 기다린 쪽·선반환·재시도가 같은 모양을 받는다. `ok` 는 끝난 작업이면 "끝까지 해냈다",
   * 결과를 받아야 하는 작업이 아직 도는 중이면 `false`(+`pending`) — 결과 없는 접수를 성공으로 읽지 않게. 그 외 접수는 `true`.
   */
  const dispatchResponseBody = (job: DispatchJob, extra: Record<string, unknown>): Record<string, unknown> => {
    const pending = isDispatchResultPending(job);
    return {
      ok: isTerminalDispatchJobStatus(job.status) ? isDispatchJobSucceeded(job) : !pending,
      dispatched: true,
      cmdId: job.cmdId,
      status: job.status,
      ...(job.result !== undefined ? { result: job.result } : {}),
      ...(job.errorMessage !== undefined ? { errorMessage: job.errorMessage } : {}),
      ...(job.usageLimit ? { usageLimit: job.usageLimit } : {}),
      ...(job.requestKey !== undefined ? { requestKey: job.requestKey } : {}),
      ...(job.statusGrants?.length ? { statusGrants: job.statusGrants } : {}),
      statusUrl: dispatchStatusUrl(job),
      ...(pending ? { pending: true, next: dispatchPendingNext(job) } : {}),
      ...extra,
    };
  };

  /**
   * 끝난 결과를 실은 응답이 **다 나간 뒤에** 요청자가 받은 것으로 적는다(`finish`). 쓰기 전에 연결이 끊기면 적지 않는다 —
   * 그 결과는 cmdId 로 다시 받는다. 진행 중 응답·결과를 받지 않아도 되는 작업은 적지 않는다.
   */
  const markDispatchDeliveredOnFinish = (res: express.Response, job: DispatchJob): void => {
    if (job.expectsResult !== true || !isTerminalDispatchJobStatus(job.status)) return;
    // 이미 끊긴 응답(loopback 주입 응답은 끊긴 뒤에도 `end` 에서 finish 를 낸다)은 받은 것이 아니다.
    if (res.destroyed) return;
    res.once('finish', () => { if (!res.destroyed) dispatchJobs.markDelivered(job.cmdId); });
  };

  /**
   * §5.3 #10-2 — 이 dispatch 를 부른 세션(서브에이전트). 결과를 **그 턴**에 묶는 키다.
   * 이름(`x-vibisual-source-subagent`)을 밝혔으면 소스 에이전트의 세션이어야 한다(자기 신고라 위조 방지가 아니라 오조회 방지).
   * 이름이 없으면 소스 에이전트에서 **지금 도는 세션이 딱 하나일 때만** 그 세션으로 본다 — 둘 이상이면 누구인지 모르므로 묶지 않는다.
   */
  const resolveDispatchRequesterSub = (
    raw: unknown,
    sourceAgentId: string,
  ): { ok: true; subAgentId?: string } | { ok: false; httpStatus: number; error: string } => {
    const named = resolveDispatchRequester(raw);
    if (!named.ok) return { ok: false, httpStatus: 400, error: 'conflicting-requester-subagent' };
    if (named.agentId !== undefined) {
      return subAgentManager.getSub(named.agentId)?.parentAgentId === sourceAgentId
        ? { ok: true, subAgentId: named.agentId }
        : { ok: false, httpStatus: 403, error: 'subagent does not belong to the source agent' };
    }
    const running = new Set<string>();
    for (const queue of commandQueues.values()) {
      for (const c of queue) {
        if (c.status === 'executing' && c.subAgentId && subAgentManager.getSub(c.subAgentId)?.parentAgentId === sourceAgentId) running.add(c.subAgentId);
      }
    }
    const [only] = running;
    return running.size === 1 && only !== undefined ? { ok: true, subAgentId: only } : { ok: true };
  };

  /** 명령이 아직 큐에 있으면 그 자리. 끝난 명령은 완료 경로가 큐에서 빼 아카이브로 옮긴다. */
  const findQueuedDispatchCommand = (cmdId: string): { sessionId: string; cmd: QueuedCommand } | undefined => {
    for (const [sessionId, queue] of commandQueues) {
      const cmd = queue.find((c) => c.id === cmdId);
      if (cmd) return { sessionId, cmd };
    }
    return undefined;
  };

  /** 장부를 실제 큐와 맞춘 최신 모습 — `executing` 은 여기서 적는다. 끝 상태는 명령이 큐를 떠나는 자리만 적는다. */
  const currentDispatchJob = (cmdId: string): DispatchJob | undefined => {
    if (findQueuedDispatchCommand(cmdId)?.cmd.status === 'executing') dispatchJobs.markExecuting(cmdId);
    const lookup = dispatchJobs.get(cmdId);
    return lookup.ok ? lookup.job : undefined;
  };

  /** Called only after completion has queued every critique/rework successor. */
  function flushOrchestraResults(): void {
    if (orchestraCompletionDepth > 0) return;
    for (const runId of orchestraResults.activeRunIds()) {
      const run = graphManager.findOrchestraRun(runId);
      const pending = [...commandQueues.values()].some((queue) => queue.some((cmd) =>
        cmd.orchestraRunId === runId && cmd.id !== run?.commandId
        && (cmd.status === 'queued' || cmd.status === 'executing')));
      const outcome = orchestraResults.finish(runId, pending);
      if (!outcome) continue;
      const job = dispatchJobs.finish(outcome.commandId, outcome);
      if (!job) continue;
      graphManager.setTaskEdgeStatus(job.edgeId, outcome.status, outcome.result, outcome.status === 'error' ? outcome.result : undefined);
      const artifact = graphManager.getBundleArtifact(job.edgeId);
      if (artifact) graphManager.setTaskEdgeStatus(artifact.id, outcome.status, outcome.result);
      dispatchWaiters.settle(job.cmdId, job);
    }
  }

  /** Stop only this run's delegated work, including an entry already awaiting review. */
  function cancelOrchestraWork(runId: string, reason: string): void {
    const entryId = orchestraResults.cancel(runId);
    if (!entryId) return;
    const run = graphManager.findOrchestraRun(runId);
    graphManager.updateOrchestraRun(runId, (r) => ({ ...r, phase: 'error', endedAt: r.endedAt ?? Date.now() }));
    const executing: QueuedCommand[] = [];
    orchestraCompletionDepth++;
    try {
      for (const [sessionId, queue] of commandQueues) {
        const removed = queue.filter((cmd) => cmd.orchestraRunId === runId && cmd.id !== run?.commandId && cmd.status === 'queued');
        commandQueues.set(sessionId, queue.filter((cmd) => !removed.includes(cmd)));
        for (const cmd of removed) {
          cmd.status = 'error';
          cmd.stopReason = 'cancelled';
          cmd.result = `[Stopped by user] ${reason}`;
          settleDispatchCommand(cmd, { outcome: { status: 'cancelled', errorMessage: reason }, updateEdge: true });
        }
        if (removed.length) archiveCompletedCommands(sessionId, removed);
        executing.push(...queue.filter((cmd) => cmd.orchestraRunId === runId && cmd.id !== run?.commandId && cmd.status === 'executing'));
      }
      for (const cmd of executing) {
        if (cmd.subAgentId && subAgentManager.stop(cmd.subAgentId)) continue;
        cmd.status = 'error';
        cmd.stopReason = 'cancelled';
        cmd.result = `[Stopped by user] ${reason}`;
        settleDispatchCommand(cmd, { outcome: { status: 'cancelled', errorMessage: reason }, updateEdge: true });
        for (const [sessionId, queue] of commandQueues) {
          if (!queue.includes(cmd)) continue;
          commandQueues.set(sessionId, queue.filter((item) => item !== cmd));
          archiveCompletedCommands(sessionId, [cmd]);
          break;
        }
      }
      const job = dispatchJobs.finish(entryId, { status: 'cancelled', errorMessage: reason });
      if (job) {
        graphManager.setTaskEdgeStatus(job.edgeId, 'error', undefined, reason);
        const artifact = graphManager.getBundleArtifact(job.edgeId);
        if (artifact) graphManager.setTaskEdgeStatus(artifact.id, 'error', undefined, reason);
        dispatchWaiters.settle(entryId, job);
      }
    } finally {
      orchestraCompletionDepth--;
      flushOrchestraResults();
    }
  }

  function cancelOrchestraForSession(agentId: string, subAgentId?: string): void {
    for (const queue of commandQueues.values()) {
      for (const cmd of [...queue]) {
        if (!cmd.orchestraRunId || (subAgentId && cmd.subAgentId !== subAgentId)) continue;
        const run = graphManager.findOrchestraRun(cmd.orchestraRunId);
        if (run?.agentId !== agentId || run.commandId !== cmd.id) continue;
        graphManager.updateOrchestraRun(run.runId, (r) => ({ ...r, phase: 'error', endedAt: r.endedAt ?? Date.now() }));
        if (cmd.subAgentId) orchestraTurnConfigs.delete(cmd.subAgentId);
        if (cmd.subAgentId) configTrimTurnConfigs.delete(cmd.subAgentId);
        cancelOrchestraWork(run.runId, 'conductor stopped by user');
      }
    }
  }

  /**
   * 큐를 떠난 위임 명령 하나의 끝을 장부에 적고 기다리던 대기에 건넨다. 큐를 떠나는 모든 자리(완료 콜백 · 중지 · 좀비 봉합 · 큐에서 지우기 · 취소)가 여기를 지난다 — 하나라도 빠지면 장부에서 영영 진행 중이고 동기 대기가 안 풀린다.
   * `updateEdge` — 완료 콜백은 엣지를 스스로 내리므로 끄고, 그 밖의 자리만 켠다(`completed`→completed · 그 외→error). 한 번도 안 나간 명령(`neverStarted`)은 `idle`.
   */
  const settleDispatchCommand = (
    cmd: QueuedCommand,
    options: { outcome?: DispatchJobOutcome; updateEdge?: boolean; neverStarted?: boolean } = {},
  ): void => {
    if (!cmd.edgeId) return;
    if (options.updateEdge) {
      const artifact = graphManager.getBundleArtifact(cmd.edgeId);
      if (options.neverStarted) {
        graphManager.setTaskEdgeStatus(cmd.edgeId, 'idle');
        if (artifact) graphManager.setTaskEdgeStatus(artifact.id, 'idle');
      } else {
        const edgeStatus: 'completed' | 'error' = cmd.status === 'completed' ? 'completed' : 'error';
        const errMsg = cmd.status === 'error' ? (cmd.result ?? 'subagent error') : undefined;
        graphManager.setTaskEdgeStatus(cmd.edgeId, edgeStatus, cmd.result, errMsg);
        if (artifact) graphManager.setTaskEdgeStatus(artifact.id, edgeStatus, cmd.result, errMsg);
      }
    }
    const usageLimit = cmd.subAgentId ? subAgentManager.getSub(cmd.subAgentId)?.usageLimit : undefined;
    const outcome = options.outcome ?? dispatchOutcomeFromCommand(cmd, usageLimit);
    if (!outcome) return;
    if (cmd.orchestraRunId) {
      const edge = graphManager.getTaskEdge(cmd.edgeId);
      orchestraResults.record(cmd.orchestraRunId, { id: cmd.id, ...outcome },
        edge?.kind === 'critique' && (edge.bundleRole ?? 'primary') === 'primary'
          ? { critiqueEdgeId: edge.id, critiqueVerdict: parseCritiqueVerdict(outcome.result ?? '').verdict }
          : edge?.bundleRole === 'auto-rework' ? { reworkAgentId: edge.targetAgentId } : undefined);
      if (orchestraResults.isEntry(cmd.orchestraRunId, cmd.id)) {
        // The ordinary entry turn has ended, but automatic verification may still be running.
        graphManager.setTaskEdgeStatus(cmd.edgeId, 'executing');
        const artifact = graphManager.getBundleArtifact(cmd.edgeId);
        if (artifact) graphManager.setTaskEdgeStatus(artifact.id, 'executing');
        flushOrchestraResults();
        return;
      }
    }
    const job = dispatchJobs.finish(cmd.id, outcome);
    if (job) dispatchWaiters.settle(cmd.id, job);
    flushOrchestraResults();
  };

  /**
   * 끝날 때까지 이 응답을 붙든다. 제한시간·연결 close 는 대기만 푼다 — 엣지·장부는 건드리지 않는다(기다림의 끝은 일의 실패가 아니다).
   * loopback 리스너는 요청을 in-process 로 다시 주입한다 — dispatch 경로는 바깥 연결 끊김이 안쪽 응답의 `close` 로 넘어온다(끊긴 호출자에게 건넸다고 적지 않게). 넘겨받지 못한 대기는 제한시간이나 작업 끝에 걷힌다.
   */
  const holdForDispatchResult = (
    res: express.Response,
    cmdId: string,
    timeoutMs: number,
    extra: Record<string, unknown>,
  ): void => {
    const latest = currentDispatchJob(cmdId);
    if (!latest) {
      res.status(404).json({ ok: false, error: 'not-found', cmdId });
      return;
    }
    if (isTerminalDispatchJobStatus(latest.status)) {
      markDispatchDeliveredOnFinish(res, latest);
      res.json(dispatchResponseBody(latest, { waited: true, ...extra }));
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const release = dispatchWaiters.add(cmdId, (finished) => {
      if (timer) clearTimeout(timer);
      if (res.headersSent) return;
      markDispatchDeliveredOnFinish(res, finished);
      res.json(dispatchResponseBody(finished, { waited: true, ...extra }));
    });
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        release();
        if (res.headersSent) return;
        const snapshot = currentDispatchJob(cmdId) ?? latest;
        markDispatchDeliveredOnFinish(res, snapshot);
        res.status(202).json(dispatchResponseBody(snapshot, { waited: true, timedOut: true, timeout: true, timeoutMs, ...extra }));
      }, timeoutMs);
    }
    res.on('close', () => {
      if (res.writableEnded) return;
      if (timer) clearTimeout(timer);
      release();
    });
  };

  /**
   * POST /api/task-edges/dispatch — 소스 세션이 직접 불러 엣지 위임 실행. body `{ edgeId, instruction }`.
   *  - 타겟 에이전트 세션 큐에 edgeId 포함 명령 푸시 → subagent 가 실제 Claude 프로세스로 실행
   *  - `returnFormat='both'` 번들에 artifact 자매 엣지가 있고 그 target 이 실에이전트면 완료까지 응답 홀드, 아니면 즉시 `{ dispatched: true }`
   *  §5.3 #10-2 — 어느 쪽이든 결과는 장부에 남고 `statusUrl` 로 다시 받는다. `?wait=false`(JSON `wait:false`)면 홀드 대상이어도 즉시 반환.
   *  - `requestKey`(`?requestKey=`·`x-vibisual-request-key`·JSON) → 같은 (소스·엣지·키)면 새로 띄우지 않고 기존 작업. 요청자 id(`x-vibisual-source-agent`·`?agentId=`·JSON `agentId`)는 소스와 같아야 한다.
   */
  app.post('/api/task-edges/dispatch', (req, res) => {
    // 두 경로 수용:
    //  (1) 신규(권장) — raw text 본문 + `?edgeId=` 쿼리. instruction 손escape 불필요(heredoc 그대로).
    //  (2) 후방호환 — JSON 본문 `{ edgeId, instruction }`.
    let edgeId: string | undefined;
    let instruction: string | undefined;
    const q = req.query as { edgeId?: unknown; wait?: unknown; requestKey?: unknown; agentId?: unknown; statusCmdIds?: unknown };
    let jsonBody: { wait?: unknown; requestKey?: unknown; agentId?: unknown; statusCmdIds?: unknown } = {};
    if (typeof req.body === 'string') {
      // express.text() 가 파싱한 raw 본문. edgeId 는 쿼리(우선) 또는 헤더.
      const qid = typeof q.edgeId === 'string' ? q.edgeId : undefined;
      const hid = typeof req.headers['x-edge-id'] === 'string' ? (req.headers['x-edge-id'] as string) : undefined;
      edgeId = qid ?? hid;
      // 끝의 쉘/heredoc 잔여 개행·CR 만 정리(중간 본문은 보존).
      instruction = req.body.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    } else {
      const body = (req.body ?? {}) as { edgeId?: unknown; instruction?: unknown; wait?: unknown; requestKey?: unknown; agentId?: unknown; statusCmdIds?: unknown };
      jsonBody = body;
      if (typeof body.edgeId === 'string') edgeId = body.edgeId;
      if (typeof body.instruction === 'string') instruction = body.instruction;
      // JSON 경로에서도 쿼리 edgeId 허용(혼용 안전).
      if (!edgeId && typeof q.edgeId === 'string') edgeId = q.edgeId;
    }
    if (typeof edgeId !== 'string' || edgeId.length === 0 || typeof instruction !== 'string' || instruction.trim().length === 0) {
      res.status(400).json({ ok: false, error: 'edgeId (query ?edgeId= or JSON body) and non-empty instruction (raw text body or JSON body.instruction) required' });
      return;
    }
    const edge = graphManager.getTaskEdge(edgeId);
    if (!edge) { res.status(404).json({ ok: false, error: 'edge not found' }); return; }
    // §5.3 #10-2 — 요청자 id 는 헤더(코덱스 다리)·쿼리·JSON 어디로 와도 같은 규칙이다. 서로 다르면 누구인지 모른다.
    const requester = resolveDispatchRequester(req.headers['x-vibisual-source-agent'], q.agentId, jsonBody.agentId);
    if (!requester.ok) { res.status(400).json({ ok: false, error: requester.reason }); return; }
    if (requester.agentId !== undefined && requester.agentId !== edge.sourceAgentId) {
      res.status(403).json({ ok: false, error: 'edge does not belong to the source agent' });
      return;
    }
    const requesterSub = resolveDispatchRequesterSub(req.headers['x-vibisual-source-subagent'], edge.sourceAgentId);
    if (!requesterSub.ok) { res.status(requesterSub.httpStatus).json({ ok: false, error: requesterSub.error }); return; }
    const requesterSubAgentId = requesterSub.subAgentId;
    const dispatchOrchestraRunId = orchestraRunForDispatch(commandQueues.values(), requesterSubAgentId);
    const dispatchOrchestraRun = dispatchOrchestraRunId ? graphManager.findOrchestraRun(dispatchOrchestraRunId) : undefined;
    if (dispatchOrchestraRun) {
      const participants = new Set([dispatchOrchestraRun.agentId, ...dispatchOrchestraRun.memberAgentIds]);
      if (dispatchOrchestraRun.phase !== 'dispatched' || dispatchOrchestraRun.endedAt !== undefined
        || !participants.has(edge.sourceAgentId) || !participants.has(edge.targetAgentId)) {
        res.status(409).json({ ok: false, error: 'orchestra-dispatch-outside-plan' });
        return;
      }
    }
    if ((edge.bundleRole ?? 'primary') !== 'primary') {
      res.status(400).json({ ok: false, error: 'dispatch only allowed on primary/command edge, not auto-artifact' });
      return;
    }
    const requestKeyParse = parseDispatchRequestKey(req.headers['x-vibisual-request-key'], q.requestKey, jsonBody.requestKey);
    if (!requestKeyParse.ok) { res.status(400).json({ ok: false, error: requestKeyParse.reason }); return; }
    const { requestKey } = requestKeyParse;
    // 재시도 키는 이미 끝난 결과를 돌려주는 자리다 — 바깥 프로세스는 자기가 누구인지 밝혀야 쓸 수 있다(생략으로 우회 ❌).
    //   키 없는 dispatch 는 종전 그대로(토큰만으로) 받는다.
    if (requestKey !== undefined && req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE && requester.agentId === undefined) {
      res.status(400).json({ ok: false, error: 'requester-required', detail: 'requestKey needs x-vibisual-source-agent header or ?agentId=' });
      return;
    }
    // §5.3 #10-2 위임 조회 — 부모가 이 위임의 대상에게 조회를 넘길 작업 목록. 목록이 곧 권한 범위라 이름을 밝힌 쪽만 넘긴다.
    const statusGrantsParse = parseDispatchStatusGrants(req.headers['x-vibisual-status-cmd-ids'], q.statusCmdIds, jsonBody.statusCmdIds);
    if (!statusGrantsParse.ok) { res.status(400).json({ ok: false, error: statusGrantsParse.reason }); return; }
    const statusGrants = statusGrantsParse.cmdIds;
    if (statusGrants.length && req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE && requester.agentId === undefined) {
      res.status(400).json({ ok: false, error: 'requester-required', detail: 'statusCmdIds needs x-vibisual-source-agent header or ?agentId=' });
      return;
    }
    const wait = parseDispatchWait(q.wait, jsonBody.wait);
    const fingerprint = dispatchRequestFingerprint(instruction, statusGrants);

    const allAgents = graphManager.getSnapshot().agents;
    // 대기 여부: artifact 엣지의 target 이 실제 살아있는 에이전트면 결과 돌려줄 채널이 있음 → 홀드.
    // 없거나(returnFormat != 'both') artifact.targetAgentId 가 미등록이면 즉시 반환.
    const artifact = graphManager.getBundleArtifact(edgeId);
    const artifactTargetLive = artifact
      ? Boolean(allAgents.find((a) => a.id === artifact.targetAgentId))
      : false;
    // 엣지 timeoutMs 가 양수면 그 ms, 미설정/0 이면 TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS(기본 0=무제한). 유효 timeout ≤0 이면 타이머 없이 타겟 완료까지 홀드(§5.3 미설정=무제한, i18n placeholder "unlimited").
    // §5.3 #10-2 — 제한시간이 지나면 대기만 푼다(엣지를 error 로 내리지 않는다).
    const timeoutMs = edge.timeoutMs && edge.timeoutMs > 0
      ? edge.timeoutMs
      : TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS;

    // §5.3 #10-2 — 같은 요청의 재시도면 **아무것도 새로 만들지 않는다**(서브에이전트·큐·엣지 상태 전부).
    //   큐 상한보다 먼저 본다 — 재시도는 큐를 늘리지 않으므로 꽉 찬 큐가 막을 일이 아니다.
    if (requestKey !== undefined) {
      const existing = dispatchJobs.findByRequestKey(edge.sourceAgentId, edgeId, requestKey);
      if (existing) {
        if (isDispatchRequestKeyConflict(existing, fingerprint)) {
          res.status(409).json({
            ok: false,
            error: 'request-key-reused-with-different-instruction',
            cmdId: existing.cmdId,
            statusUrl: dispatchStatusUrl(existing),
          });
          return;
        }
        const job = currentDispatchJob(existing.cmdId) ?? existing;
        logger.info(`dispatch(${edgeId}): request key reused → ${job.cmdId} (${job.status}) — not re-queued`);
        if (wait && artifactTargetLive && !isTerminalDispatchJobStatus(job.status)) {
          holdForDispatchResult(res, job.cmdId, timeoutMs, { reused: true });
          return;
        }
        markDispatchDeliveredOnFinish(res, job);
        res.json(dispatchResponseBody(job, { waited: false, reused: true, waitForResult: artifactTargetLive, timeoutMs }));
        return;
      }
    }

    // §5.3 #10-2 — 요청 키가 달라도, 같은 세션이 같은 지시로 띄우고 **아직 결과를 받지 못한** 작업이 있으면 새로 띄우지 않는다.
    //   조회가 거절·실패한 뒤 모델이 다시 dispatch 해도 같은 일이 두 번 돌지 않고 기존 cmdId 의 결과를 이어 받는다.
    //   세션을 모르면 묶지 않는다 — 누구의 기다림인지 모르는 채 남의 작업을 넘겨주지 않는다.
    if (artifactTargetLive && requesterSubAgentId !== undefined) {
      const pendingSame = dispatchJobs.findUndeliveredDuplicate({ sourceAgentId: edge.sourceAgentId, edgeId, fingerprint, requesterSubAgentId });
      if (pendingSame) {
        const job = currentDispatchJob(pendingSame.cmdId) ?? pendingSame;
        logger.info(`dispatch(${edgeId}): same instruction still awaiting its result → ${job.cmdId} (${job.status}) — not re-queued`);
        if (wait && !isTerminalDispatchJobStatus(job.status)) {
          holdForDispatchResult(res, job.cmdId, timeoutMs, { reused: true });
          return;
        }
        markDispatchDeliveredOnFinish(res, job);
        res.json(dispatchResponseBody(job, { waited: false, reused: true, waitForResult: true, timeoutMs }));
        return;
      }
    }

    // §5.3 #10-2 위임 조회 — 엣지 소스가 **지금** 읽을 수 있는 작업만 넘긴다(소유자이거나 살아 있는 위임을 쥔 쪽).
    //   서브에이전트를 만들기 전이다 — 거절하면서 빈 세션 탭을 남기지 않는다.
    const grantCheck = dispatchJobs.authorizeStatusGrants(edge.sourceAgentId, statusGrants);
    if (!grantCheck.ok) {
      res.status(grantCheck.reason === 'not-found' ? 404 : 403).json({
        ok: false,
        error: grantCheck.reason === 'not-found' ? 'status-grant-not-found' : 'status-grant-forbidden',
        cmdId: grantCheck.cmdId,
      });
      return;
    }

    const targetAgent = allAgents.find((a) => a.id === edge.targetAgentId);
    if (!targetAgent) { res.status(404).json({ ok: false, error: 'target agent not found' }); return; }

    const sessionId = targetAgent.path;
    // §5.3 #9 (판올림 번호 발급 대기) — `/api/commands` 와 **같은 상한**. 이쪽은 남의 세션을 부르는
    //   경로라 A→B→A 로 서로를 채우는 고리가 성립한다. 상한 검사는 subAgent 를 만들기 **전**이다
    //   (뒤에 두면 거절하면서도 빈 세션 탭이 하나 남는다).
    const pendingForTarget = (commandQueues.get(sessionId) ?? []).filter((c) => c.status === 'queued').length;
    if (pendingForTarget >= COMMAND_QUEUE_MAX_PER_SESSION) {
      logger.warn(`dispatch(${edgeId}): refused — target queue already at ${COMMAND_QUEUE_MAX_PER_SESSION} (§5.3 #9)`);
      res.status(429).json({ ok: false, error: 'command-queue-full', limit: COMMAND_QUEUE_MAX_PER_SESSION });
      return;
    }
    // /api/commands 핸들러처럼 subAgent 를 새로 만들어 cmd.subAgentId 에 싣는다 — 그래야 `processNextCommand → subAgentManager.execute` 가 새 Claude 서브프로세스를 띄우고 IDE 에 탭이 뜬다(null 이면 execute 가 조용히 return).
    const newSub = subAgentManager.create(targetAgent.id);
    // §5.3 #12-4 (D) — 위임은 보낸 명령(요청자 탭에서 지금 도는 명령)의 검증 범위를 **물려받기만** 한다 —
    //   종류는 같고 남은 횟수만큼. 요청자를 모르거나 그 명령에 권한이 없으면 받은 쪽도 없다(위임 지시문이
    //   "테스트까지 돌려라"라고 써 있어도 그것은 AI 가 쓴 글이라 권한이 아니다).
    const parentCommand = requesterSubAgentId ? findExecutingCommandForSub(requesterSubAgentId) : undefined;
    const inheritedScope = parentCommand
      ? inheritVerificationScope(parentCommand.verificationScope, parentCommand.verification, parentCommand.id)
      : undefined;
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now().toString(36)}-edge${Math.random().toString(36).slice(2, 5)}`,
      text: instruction,
      timestamp: Date.now(),
      subAgentId: newSub.id,
      status: 'queued',
      edgeId,
      ...(dispatchOrchestraRunId ? { orchestraRunId: dispatchOrchestraRunId } : {}),
      ...(inheritedScope ? { verificationScope: inheritedScope } : {}),
    };
    // §5.3 #10-2 — 큐에 넣기 **전에** 장부에 적는다. 넣은 직후 동기로 끝나도(스폰 실패 등) 끝을 적을 자리가 이미 있어야 한다.
    dispatchJobs.register({
      cmdId: cmd.id,
      edgeId,
      sourceAgentId: edge.sourceAgentId,
      targetAgentId: targetAgent.id,
      ...(requestKey !== undefined ? { requestKey } : {}),
      fingerprint,
      ...(statusGrants.length ? { statusGrants } : {}),
      // 반환 엣지가 있으면 부른 쪽이 결과를 받아야 한다 — 받기 전에는 그 세션의 턴이 완료로 끝나지 않는다.
      ...(artifactTargetLive ? { expectsResult: true } : {}),
      ...(requesterSubAgentId !== undefined ? { requesterSubAgentId } : {}),
    });
    if (dispatchOrchestraRun?.agentId === edge.sourceAgentId && dispatchOrchestraRun.plan?.entryAgentId === targetAgent.id) {
      orchestraResults.start(dispatchOrchestraRun.runId, cmd.id);
    }
    const queue = commandQueues.get(sessionId) ?? [];
    queue.push(cmd);
    commandQueues.set(sessionId, queue);

    graphManager.setTaskEdgeStatus(edgeId, 'executing');
    if (artifact) graphManager.setTaskEdgeStatus(artifact.id, 'executing');

    // §5.3 #28 (L) — 타겟이 conti-mode 면 task_edge 출처로 workId 발급. 인플라이트가 있으면 그대로(같은 work 연속) — reset 은 사용자 명시 '새 콘티'뿐.
    const targetCfg = graphManager.getAgentConfig(targetAgent.id);
    if (targetCfg?.customMode === 'conti') {
      graphManager.startContiWork(targetAgent.id, 'task_edge');
    }

    broadcastSnapshot();
    saveCheckpoint();

    processNextCommand(sessionId);

    // §5.3 #10-2 — 홀드 대상이 아니거나 `wait=false` 면 곧바로 돌려준다. 결과는 `statusUrl` 로 다시 받는다.
    if (!artifactTargetLive || !wait) {
      const job = currentDispatchJob(cmd.id);
      if (job) markDispatchDeliveredOnFinish(res, job);
      res.json(job
        ? dispatchResponseBody(job, { waited: false, reused: false, waitForResult: artifactTargetLive, timeoutMs })
        : { ok: true, dispatched: true, cmdId: cmd.id, waited: false });
      return;
    }

    holdForDispatchResult(res, cmd.id, timeoutMs, { reused: false });
  });

  /** §5.3 #10-2 (위임 결과 복구) — 조회·취소가 함께 쓰는 요청자 판정. loopback 유입은 이름이 필수다(생략으로 우회 ❌). */
  //   `purpose` — 조회(`'read'`)만 위임 조회를 받는다. 취소(`'cancel'`)는 소유자만.
  const lookupDispatchJobForRequest = (
    req: express.Request,
    cmdId: string,
    purpose: 'read' | 'cancel',
  ): { ok: true; job: DispatchJob; requesterAgentId?: string } | { ok: false; httpStatus: number; error: string } => {
    const q = req.query as { agentId?: unknown };
    const requester = resolveDispatchRequester(req.headers['x-vibisual-source-agent'], q.agentId);
    if (!requester.ok) return { ok: false, httpStatus: 400, error: requester.reason };
    const lookup = dispatchJobs.get(cmdId, {
      ...(requester.agentId !== undefined ? { requesterAgentId: requester.agentId } : {}),
      fromLoopback: req.get(LOOPBACK_INGRESS_HEADER) === LOOPBACK_INGRESS_VALUE,
      purpose,
    });
    if (!lookup.ok) return { ok: false, httpStatus: DISPATCH_LOOKUP_HTTP_STATUS[lookup.reason], error: lookup.reason };
    return { ok: true, job: currentDispatchJob(cmdId) ?? lookup.job, ...(requester.agentId !== undefined ? { requesterAgentId: requester.agentId } : {}) };
  };

  /** §5.3 #10-2 (위임 결과 복구) — GET /api/task-edges/dispatch/:cmdId — 위임 작업의 상태·결과.
   *  대기 소켓이 끊겼거나 `wait=false` 로 먼저 돌려받았으면 여기서 받는다. 장부는 메모리라 앱 재시작 뒤에는 404 다.
   *  ⑨ `?waitMs=N` 이면 끝나거나 N ms(상한 120초)가 지날 때까지 붙든다 — 제한시간·close 는 대기만 걷는다. */
  app.get('/api/task-edges/dispatch/:cmdId', (req, res) => {
    const cmdId = req.params.cmdId;
    const found = lookupDispatchJobForRequest(req, cmdId, 'read');
    if (!found.ok) { res.status(found.httpStatus).json({ ok: false, error: found.error }); return; }
    const stop = waitForDispatchStatus({
      cmdId,
      initial: found.job,
      waitMs: parseDispatchStatusWaitMs((req.query as { waitMs?: unknown }).waitMs),
      waiters: dispatchWaiters,
      current: () => currentDispatchJob(cmdId),
      respond: (job, { waited, timedOut }) => {
        if (res.headersSent) return;
        // 붙든 사이 조회 자격이 달라졌을 수 있다(위임 조회는 그 위임이 도는 동안만) — 풀 때 한 번 더 판정한다.
        const again = waited ? lookupDispatchJobForRequest(req, cmdId, 'read') : { ok: true as const, job };
        if (!again.ok) { res.status(again.httpStatus).json({ ok: false, error: again.error }); return; }
        // §5.3 #10-2 — 결과를 받은 것으로 적는 쪽은 **띄운 에이전트 자신**의 조회뿐이다. 위임 조회자·앱 화면이 읽은 것은 그 턴이 받은 것이 아니다.
        if (found.requesterAgentId !== undefined && found.requesterAgentId === again.job.sourceAgentId) markDispatchDeliveredOnFinish(res, again.job);
        // 조회자 자신의 id 를 싣는다 — 위임 조회자에게 소스 id 를 돌려주지 않는다. `ok` 는 조회의 성공이고, 결과 여부는 `pending` 이 말한다.
        res.json({ ok: true, job: toDispatchJobView(again.job), statusUrl: dispatchStatusUrl(again.job, found.requesterAgentId),
          ...(waited ? { waited: true } : {}), ...(timedOut ? { timedOut: true } : {}),
          ...(isDispatchResultPending(again.job) ? { pending: true, next: dispatchPendingNext(again.job) } : {}) });
      },
    });
    res.on('close', () => { if (!res.writableEnded) stop(); });
  });

  /** §5.3 #10-2 (위임 결과 복구) — POST /api/task-edges/dispatch/:cmdId/cancel — 위임 작업 취소.
   *  장부만 바꾸지 않는다. 안 나간 명령은 큐에서 걷고, 도는 명령은 기존 중지(`subAgentManager.stop`)로 끊는다 —
   *  close 핸들러가 `[Stopped by user]` 로 봉합한 결과가 완료 콜백을 지나 `cancelled` 로 적힌다. */
  app.post('/api/task-edges/dispatch/:cmdId/cancel', (req, res) => {
    const found = lookupDispatchJobForRequest(req, req.params.cmdId, 'cancel');
    if (!found.ok) { res.status(found.httpStatus).json({ ok: false, error: found.error }); return; }
    if (isTerminalDispatchJobStatus(found.job.status)) {
      res.status(409).json({ ok: false, error: 'already-finished', job: toDispatchJobView(found.job) });
      return;
    }
    const orchestraRunId = orchestraResults.activeRunIds().find((id) => orchestraResults.isEntry(id, found.job.cmdId));
    if (orchestraRunId) {
      dispatchJobs.markCancelRequested(found.job.cmdId);
      cancelOrchestraWork(orchestraRunId, 'orchestra dispatch cancelled by requester');
      broadcastSnapshot();
      saveCheckpoint();
      const job = currentDispatchJob(found.job.cmdId);
      res.json({ ok: true, cancelled: true, ...(job ? { job: toDispatchJobView(job) } : {}) });
      return;
    }
    const queued = findQueuedDispatchCommand(found.job.cmdId);
    if (!queued) {
      // 큐에도 없고 끝 기록도 없다 — 무엇을 끊을지 모른다. 끝 상태를 지어내지 않는다.
      res.status(409).json({ ok: false, error: 'command-not-found', job: toDispatchJobView(found.job) });
      return;
    }
    const { sessionId, cmd } = queued;
    dispatchJobs.markCancelRequested(cmd.id);
    if (cmd.status === 'queued') {
      commandQueues.set(sessionId, (commandQueues.get(sessionId) ?? []).filter((c) => c !== cmd));
      settleDispatchCommand(cmd, {
        outcome: { status: 'cancelled', errorMessage: 'cancelled before start' },
        updateEdge: true,
        neverStarted: true,
      });
      logger.info(`dispatch cancel: ${cmd.id} removed from queue before start`);
      broadcastSnapshot();
      saveCheckpoint();
      const job = currentDispatchJob(cmd.id);
      res.json({ ok: true, cancelled: true, ...(job ? { job: toDispatchJobView(job) } : {}) });
      return;
    }
    const stopped = cmd.subAgentId ? subAgentManager.stop(cmd.subAgentId) : false;
    const job = currentDispatchJob(cmd.id) ?? found.job;
    if (!stopped) {
      // 자식 없이 executing 으로 굳은 명령 — 좀비 봉합(`sealZombieExecutingCommands`)이 곧 걷고 그 끝이 장부에 적힌다.
      res.status(409).json({ ok: false, error: 'not-running', job: toDispatchJobView(job) });
      return;
    }
    logger.info(`dispatch cancel: ${cmd.id} stop requested (sub=${cmd.subAgentId ?? '-'})`);
    res.status(202).json({ ok: true, cancelling: true, job: toDispatchJobView(job), statusUrl: dispatchStatusUrl(job) });
  });

  const port = Number(process.env['PORT']) || DEFAULT_PORT;

  // §5.7 #23-2 — Agent View 게이트 판정(두 모드 공통, probe + 로그). 부팅 직후 1회 reattach 는 `postListenBoot()` 안에서.
  void isAgentViewEnabled(true).then((res) => {
    logger.info(`[agent-view] enabled=${res.enabled} reason="${res.reason}"`);
  }).catch((err) => {
    logger.warn(`[agent-view] gate probe failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  // §5.8 — 폐기된 keyword 데이터 1회성 디스크 cleanup. 다음 차수에서 호출과 모듈 모두 제거.
  (await import('./services/keywordCleanup.js')).runKeywordCleanupOnce();

  // ─── 상태 저장 ───

  const saveScheduler = new SaveScheduler();

  // #4: 디바운스 도입했다가 비정상 종료 시 설정 유실 결함이 확인되어 **완전 원복**.
  // 체크포인트는 이벤트마다 동기 즉시 저장 — 설정 내구성 우선. 쓰기 증폭은 기능 결함이
  // 아닌 성능 리스크였을 뿐이라 정상 동작에 영향 없음(별도 분기·코얼레스 ❌, 단순=안전).
  /** 체크포인트 저장 (이벤트 발생 시 호출, 동기 즉시 저장). */
  /**
   * §3.2.3 — 디스크 파일 쪽 정리(부팅 1회 + [정리] 누를 때).
   * 살아있는 서브에이전트의 스트림 파일은 나이와 무관하게 보존한다 — 화면의 대화를 지우면 IDE 를 다시 열 때 빈 화면이다(`deleteAgentStreams` 와 같은 이유).
   * ⚠ `getSnapshot()`(registry) 만으로는 부족하다 — 탭을 닫은 서브에이전트는 `archive` 로 옮겨져 "다시 열기" 목록 소스가 되는데 registry 에 없어 보호에서 샌다(목록엔 있는데 누르면 빈 화면, 실측 2026-08-19). 두 벌을 합쳐 넘긴다.
   */
  function runProjectStorageCleanup(): StorageCleanupResult {
    const stubInfos = Object.values(graphManager.getStubProjects()).map((m) => m.project);
    const projects = [...Object.values(graphManager.getProjects()), ...stubInfos];
    const protectedSubAgentIds = new Set<string>();
    for (const subs of Object.values(subAgentManager.getSnapshot())) {
      for (const s of subs) protectedSubAgentIds.add(s.id);
    }
    for (const subs of Object.values(subAgentManager.getArchiveSnapshot())) {
      for (const s of subs) protectedSubAgentIds.add(s.id);
    }
    return runStorageCleanup({ projects, protectedSubAgentIds });
  }

  /**
   * §9 "저장은 바뀐 프로젝트만" — 프로젝트별 마지막 저장 시점의 (변경 카운터, 시각).
   * 세션 휘발 — 부팅 직후에는 비어 있어 첫 저장이 전 프로젝트를 한 번 훑는다(의도된 초기화).
   */
  const lastSavedProjectState = new Map<string, { version: number; at: number }>();

  /**
   * @param opts.dirtyOnly 훅 이벤트 폭주 경로 전용 — 이번 창에서 실제로 바뀐 프로젝트만 저장한다.
   * 전부 재구축 + 직렬화는 비싸다(실측 2026-08-19 · 열린 탭 7개: 직렬화만 21.8ms, 1개면 3.8ms) — 서버가 Electron 메인과 한 몸이라 그 시간이 곧 UI 정지다.
   * ⚠ 기본값은 전부 저장이고 좁히는 것은 `scheduleCheckpoint()`(훅 도구 이벤트 코얼레스) 한 경로뿐 — `mutationVersion` 은 모든 변경 지점이 올리지 않는다(예: `createCustomAgent`). 훅 경로는 `processHookEvent` 가 반드시 올리므로 거기서만 믿는다.
   *   사용자 조작·설정·정체성 변경(§3.2.1 #4 즉시 저장)은 전부 저장한다. 좁힌 경로에서도 조용한 프로젝트는 `CHECKPOINT_QUIET_SWEEP_MS` 마다 한 번 무조건 재구축한다(싱글턴발 변경의 안전망).
   */
  function saveCheckpoint(opts?: { dirtyOnly?: boolean }): void {
    const fallbackProject = graphManager.getPrimaryProjectName();
    if (!fallbackProject) return;

    // §3.2.1-4 — read-only 격리 프로젝트는 자동 저장 동결(빈/손상 인스턴스가 디스크를 덮어쓰지 않게). readOnly 는 stub 이라 보통 getProjectNames 에 안 잡히지만 방어적으로 거른다.
    const projectNames = graphManager.getProjectNames().filter((n) => !graphManager.isProjectReadOnly(n));
    if (projectNames.length === 0) return;

    const dirtyOnly = opts?.dirtyOnly === true;
    const now = Date.now();
    const targets = !dirtyOnly
      ? projectNames
      : projectNames.filter((name) => {
          const version = graphManager.getProjectMutationVersion(name);
          if (version === null) return true;           // 인스턴스 해석 실패 → 보수적으로 저장
          const prev = lastSavedProjectState.get(name);
          if (prev === undefined) return true;         // 이 세션에서 아직 한 번도 저장 안 함
          if (prev.version !== version) return true;   // 그래프가 실제로 바뀜
          return now - prev.at >= CHECKPOINT_QUIET_SWEEP_MS; // 조용해도 주기적으로 한 번은
        });

    if (targets.length > 0) {
      // seq 는 저장 대상만 올린다 — 안 올린 프로젝트는 직렬화 결과가 그대로라 지문 비교가 산다.
      graphManager.incrementSeqForProjects(targets);

      if (targets.length <= 1) {
        const cp = graphManager.toProjectCheckpoint(targets[0] ?? fallbackProject);
        saveScheduler.forceCheckpoint(cp);
      } else {
        const checkpoints = targets.map((name) => graphManager.toProjectCheckpoint(name));
        saveScheduler.forceCheckpointAll(checkpoints);
      }

      for (const name of targets) {
        lastSavedProjectState.set(name, { version: graphManager.getProjectMutationVersion(name) ?? 0, at: now });
      }
      // 닫힌 프로젝트의 흔적은 남기지 않는다(세션 내내 자라지 않게).
      if (lastSavedProjectState.size > projectNames.length) {
        const alive = new Set(projectNames);
        for (const key of [...lastSavedProjectState.keys()]) {
          if (!alive.has(key)) lastSavedProjectState.delete(key);
        }
      }
    }

    // hydrated + stub 프로젝트를 합산해 orphan prune — stub 프로젝트 worktree를 잘못 제거하지 않도록.
    const stubInfos = Object.values(graphManager.getStubProjects()).map((m) => m.project);
    pruneOrphanWorktreeDirs([...Object.values(graphManager.getProjects()), ...stubInfos]);

    // 탭으로 떠 있는 top-level 프로젝트는 openProjects 에 반드시 들어가게 보정한다 — registerProject 펀넬을 놓친 경로(이미 세션 라우팅돼 재호출되지 않는 경우 등)면 재시작 때 탭이 사라진다.
    // × 로 닫은 hidden 프로젝트는 getVisibleTopLevelProjects 가 이미 빼므로 되살리지 않는다. appStateAddOpenProject 는 이미 있으면 no-op(디스크 미기록).
    for (const info of graphManager.getVisibleTopLevelProjects()) {
      if (appStateAddOpenProject(info.path, info.name)) {
        logger.info(`AppState: openProjects += ${info.path} ("${info.name}") [reconcile]`);
      }
    }
  }

  // §9 — hook-event 도구 이벤트 경로 전용 체크포인트 코얼레스(부하 적응형, broadcastSnapshot 과 같은 꼴). saveCheckpoint() 는 build + 전체 stringify + fsync 원자쓰기를 메인 스레드에서 동기로 하므로, 초당 수~수십 건 도구 이벤트마다 저장하면 앱 전체가 동결된다.
  // #4 원칙(동기 즉시 저장)은 나머지 모든 호출 지점에서 그대로 — 묶는 것은 hook-event 도구 이벤트뿐이다. 비정상 종료 때 잃는 것은 최대 창 하나(≤5s) 분량의 휘발성 그래프 상태.
  // ⚠ 정상 종료는 desktop main 의 `before-quit` 가 `flushPendingCheckpointSave()` 를 명시적으로 불러 보장한다 — Electron 종료는 `app.exit(0)` 이라 Node `exit` 이벤트가 안 돌 수 있다. 아래 'exit' 는 최후 그물이다.
  // 창 관리는 `checkpointCoalescer.ts` 단독 소유(테스트로 고정) — 같은 `flushSync()` 를 지나므로 두 번 불려도 두 번 저장되지 않는다.
  const checkpointCoalescer = new CheckpointCoalescer({
    save: saveCheckpoint,
    baseIntervalMs: CHECKPOINT_BATCH_INTERVAL,
    maxIntervalMs: CHECKPOINT_BATCH_INTERVAL_MAX,
    backoffFactor: WS_BATCH_BACKOFF_FACTOR,
    onError: (err, phase) => {
      // 종료 중 저장 실패는 다음 부팅의 §3.2.1-4 백업 복구에 위임한다(정리를 끊지 않는다).
      logger.warn(`checkpoint ${phase} save failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });
  setActiveCheckpointCoalescer(checkpointCoalescer);
  function scheduleCheckpoint(): void {
    checkpointCoalescer.schedule();
  }
  process.on('exit', () => {
    // 최후 그물 — `before-quit` 가 이미 마무리했으면 여기서는 no-op 이다.
    // 'exit' 핸들러는 동기 작업만 허용 — flushSync/saveCheckpoint 는 전 구간 동기라 안전.
    checkpointCoalescer.flushSync();
    // §9 — 워커에 넘긴 뒤 아직 디스크에 앉지 않은 쓰기를 동기로 마무리한다(§3.2.1 내구성).
    //   'exit' 는 동기 작업만 허용되므로 이 flush 도 전 구간 동기다.
    try { flushPendingDiskWritesSync(); } catch { /* 마지막 방어선 — 실패해도 다음 부팅이 백업으로 복구 */ }
  });

  // §9 — PostToolUse Bash 전 노드 existsSync 스윕 최소 간격(ms).
  const EXISTENCE_SWEEP_MIN_INTERVAL_MS = 2000;
  let lastExistenceSweepAt = 0;

  // 참조 주입 — restoreFromCheckpoint보다 먼저 실행해야 복원된 데이터가 올바른 Map에 들어감
  graphManager.setPoppedCommandsRef(poppedCommands);
  graphManager.setCommandQueuesRef(commandQueues);
  graphManager.setCompletedCommandArchiveRef(completedCommandArchive);

  // 1회 마이그레이션 — 구 `<Vibisual>/save/` 단일 루트 → 각 프로젝트의 `.vibisual/save/` 분산 저장. 순서 주의:
  //   (1) `loadAppState()` 먼저 — 구 `<Vibisual>/save/_app-state.json` 이 살아있는 동안 `~/.vibisual/app-state.json` 으로 옮긴다.
  //   (2) 그다음 `migrateLegacySaveRootToProjectDirs()` — 체크포인트 디렉토리를 각 프로젝트로 분산 후 SAVE_ROOT 를 `save.bak-v1.52` 로 백업.
  {
    loadAppState(); // (1) AppState 먼저 끌어올림 (구 _app-state.json 이 save/ 백업으로 묻히기 전에).
    const result = migrateLegacySaveRootToProjectDirs(); // (2) 체크포인트 분산 + SAVE_ROOT 백업.
    if (result.moved > 0 || result.skipped > 0 || result.bakPath) {
      logger.info(`v1.52 migration: moved=${result.moved}, skipped=${result.skipped}, bak=${result.bakPath ?? '<none>'}`);
    }
  }

  // §9 「창이 뜬 직후의 메인 스레드」 ① — 아무 창도 범위를 선언하기 전의 스냅샷(부팅 직후 방송·첫 연결)은 마지막으로 보던 프로젝트 하나만 짓는다 — 전부 지으면 대화 기록 재파싱으로 창이 뜬 순간 메인 스레드를 붙잡는다.
  //   첫 선언 뒤는 `ProjectGraphManager` 규칙대로.
  graphManager.setBootViewProject(loadAppState().lastActiveProject);

  // Lazy boot: project.json 메타만 읽어 stub 등록, 체크포인트 본문은 hydrate 때까지 안 읽는다.
  // openProjects(`~/.vibisual/app-state.json` 의 "사용자가 열어둔" 경로)만 stub 으로 등록 — × 로 닫은 프로젝트는 체크포인트는 보존되되 탭으로 뜨지 않는다(파일 열기·hook 이벤트로 복귀).
  // 식별 = projectId(절대경로) — 구 이름 배열은 `loadAppState()` normalize 가 경로로 옮기므로 openProjects 를 그대로 스캔 목록으로 쓴다. discoverProjectMetas 는 각 path 의 `.vibisual/save/` 만 읽는다.
  {
    const np = (p: string): string => pathKey(p);
    const appStateInitial = loadAppState();
    const scanPaths = appStateInitial.openProjects.filter((p): p is string => typeof p === 'string' && p.length > 0);

    let metas = discoverProjectMetas(scanPaths);
    if (metas.length === 0 && migrateLegacy() !== null) {
      // 레거시 state.json이 존재했을 경우 — 마이그레이션 후 재스캔하여 stub 등록.
      metas = discoverProjectMetas(scanPaths);
    }

    const appState = loadAppState();
    // 식별 매칭은 정규화 경로(projectId) 기준 (Windows FS 대소문자 무시).
    let openKeySet = new Set(appState.openProjects.map(np));
    // 초기 마이그레이션: 첫 가동(updatedAt=0)이면 기존 모든 top-level 메타를 열림으로 간주, 1회 기록.
    if (appState.updatedAt === 0 && metas.length > 0) {
      const topPaths = metas
        .filter((m) => !m.project.parentProjectPath && m.project.path)
        .map((m) => m.project.path.replace(/\\/g, '/'));
      const names: Record<string, string> = { ...(appState.projectNames ?? {}) };
      for (const m of metas) {
        if (!m.project.parentProjectPath && m.project.path) {
          names[m.project.path.replace(/\\/g, '/')] = m.project.name;
        }
      }
      saveAppState({ ...appState, openProjects: topPaths, projectNames: names, updatedAt: 0 });
      openKeySet = new Set(topPaths.map(np));
      logger.info(`AppState: bootstrapped openProjects with ${topPaths.length} existing project(s).`);
    }
    const stalePaths: string[] = [];
    // 1단계: path 가 비어 있거나 실제 경로가 사라진 메타는 ghost 로 간주하고 전체 스킵.
    const validMetas = metas.filter((m) => {
      const p = m.project.path;
      if (!p || !fs.existsSync(p)) {
        logger.warn(`Boot: skipping ghost meta "${m.project.name}" (path=${JSON.stringify(p)} not found on disk)`);
        if (openKeySet.has(np(p ?? ''))) stalePaths.push(p ?? '');
        return false;
      }
      return true;
    });

    // openProjects(경로) 에 있는 프로젝트만 부팅 시 즉시 hydrate (worktree 는 부모 재귀로).
    const filtered = validMetas.filter((m) => openKeySet.has(np(m.project.path)));
    let hydratedCount = 0;
    // §9 「시작 화면(스플래시)」 — 복원 진척(표시 전용). 이 반복은 동기라 그동안 메인 스레드가 붙잡히지만,
    //   desktop main 은 메시지 포트로 스플래시에 흘려보내 "몇 번째를 복원하는 중"이 그대로 뜬다.
    for (const [bootIndex, meta] of filtered.entries()) {
      reportBootProgress({ phase: 'projects', done: bootIndex, total: filtered.length, label: meta.project.name });
      graphManager.registerStub(meta);
      const result = graphManager.hydrateProject(meta.project.path);
      if (result.ok) {
        hydratedCount += 1;
      } else if (result.reason === 'load-error') {
        // §3.2.1-4 — 로드 실패(디스크 손상/일시 실패)여도 데이터는 살아있을 수 있다. stub 을 지우지 않고 read-only 격리해 빈 인스턴스가 디스크를 덮어쓰지 못하게 하고, openProjects 도 유지해 다음 부팅에 백업 복구를 재시도한다(지우면 빈 인스턴스가 덮어써 잃는다).
        logger.warn(`Boot hydrate failed for "${meta.project.name}" @ ${meta.project.path} (load-error) — isolating read-only (data-loss guard), keeping stub + openProjects`);
        graphManager.markStubReadOnly(meta.project.path, 'load-error');
      } else {
        logger.warn(`Boot hydrate failed for "${meta.project.name}" @ ${meta.project.path} (${result.reason}) — removing from openProjects`);
        graphManager.removeStubFromMap(meta.project.path);
        stalePaths.push(meta.project.path);
      }
    }
    reportBootProgress({ phase: 'projects', done: filtered.length, total: filtered.length });
    // meta 가 없는데 openProjects 에만 남은 경로 청소(정규화 경로 매칭).
    // §3.2.1-4 손실방지 — 메타를 못 읽어도 경로가 실재하면 크래시로 project.json 이 반파됐을 수 있어 지우지 않고 다음 부팅에 재시도한다. 경로 자체가 사라진 것만 영구 청소한다(무조건 지우면 멀쩡한 프로젝트가 목록에서 영영 빠진다).
    const metaKeys = new Set(metas.map((m) => np(m.project.path)));
    const unknownInOpen = appState.openProjects.filter((p) => !metaKeys.has(np(p)));
    if (unknownInOpen.length > 0) {
      const goneUnknown: string[] = [];
      const keptUnknown: string[] = [];
      const neverProject: string[] = [];
      for (const p of unknownInOpen) {
        let onDisk = false;
        try { onDisk = !!p && fs.existsSync(p); } catch { onDisk = false; }
        if (!onDisk) { goneUnknown.push(p); continue; }
        // 경로는 있는데 메타를 못 읽는 두 경우를 가른다.
        //  - save 디렉토리에 파일이 있다 → project.json 만 반파됐을 수 있다 → 재시도 보존.
        //  - save 디렉토리가 없다 → 저장된 적 없는 경로(훅 세션 cwd 로 한 번 등록된 흔적 등) — 잃을 데이터가 없어 제거해도 §3.2.1 에 저촉되지 않는다(hydrate 는 영원히 실패).
        if (hasProjectSaveData(p)) keptUnknown.push(p); else neverProject.push(p);
      }
      if (goneUnknown.length > 0) {
        logger.warn(`AppState: ${goneUnknown.length} stale openProjects entry(ies) removed (path gone from disk): ${goneUnknown.join(', ')}`);
        stalePaths.push(...goneUnknown);
      }
      if (neverProject.length > 0) {
        logger.warn(`AppState: ${neverProject.length} openProjects entry(ies) removed (path present but no Vibisual save data — never a project): ${neverProject.join(', ')}`);
        stalePaths.push(...neverProject);
      }
      if (keptUnknown.length > 0) {
        logger.warn(`AppState: ${keptUnknown.length} openProjects entry(ies) kept for retry (path present but metadata unreadable — possible transient crash corruption): ${keptUnknown.join(', ')}`);
      }
    }
    for (const p of stalePaths) if (p) appStateRemoveOpenProject(p);
    // #3: projectNames 캐시도 디스크-부재 경로 prune (무한 누적 차단, 재오픈 라벨은 보존).
    const prunedNames = appStatePruneStaleProjectNames((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    });
    // §5.4 #14-4 — "다시 열기" 목록도 같은 회차에 훑는다. 폴더를 지운 뒤에도 이름이 남아 있으면
    //   눌렀을 때 없는 경로가 유령 프로젝트로 등록된다(#62959 반면교사).
    const prunedClosed = appStatePruneMissingClosedTabs((p) => {
      try { return fs.existsSync(p); } catch { return false; }
    });
    if (prunedClosed > 0) logger.info(`Boot: recentlyClosedTabs ${prunedClosed} entry(ies) dropped (folder gone).`);
    logger.info(`Boot: hydrated ${hydratedCount}/${validMetas.length} project(s) from openProjects (${stalePaths.length} stale entry(ies) cleaned, ${prunedNames} name-cache pruned, ${metas.length - validMetas.length} ghost(s) skipped).`);

    // §3.2.3 — 부팅 시 1회 보존 정리. Claude Code 의 "시작할 때 정리" 타이밍과 같되,
    // 무엇을 얼마나 지웠는지 로그로 남기고(조용히 지우지 않는다) 살아있는 것은 건드리지 않는다.
    // hydrate 직후에 도는 이유: 이 시점이라야 `getProjects()` 가 실제 프로젝트 목록을 준다.
    try {
      runProjectStorageCleanup();
      for (const inst of graphManager.getInstancesForRetention()) inst.pruneFileEditRetention();
      // §5.26 (H) 보험 저장고 보존도 부팅 때 같은 자리에서 돌린다 — 안 돌리면 `applyInsuranceRetention()` 이 `PUT /api/retention-settings` 때만 돌아 나이 만료(14일)·고아 회수가 영영 안 돈다(실측 2026-09-09: 금고 76MB 중 고아 blob 177개 22.5MB).
      // 보험은 우리가 프로젝트 폴더에 쓰는 것 중 가장 커질 수 있는 물건이다.
      if (graphManager.applyInsuranceRetention()) saveCheckpoint();
    } catch (err) {
      // 정리 실패는 기동을 막지 않는다 — 용량이 조금 더 남을 뿐이다.
      logger.warn(`Boot storage cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // §9 「시작 화면(스플래시)」 — 복원과 보존 정리를 마쳤다. 남은 기동(세션 복원·감시·타이머)으로 넘어간다(표시 전용).
  reportBootProgress({ phase: 'services' });

  // §5.7 #24 — 기동 때 버블 소스는 체크포인트뿐이다. `scanAllProjects` 로 ~/.claude/sessions/ 를 긁어 시딩하지 않는다 — stale·타 프로젝트 세션이 섞인다. 새 세션은 SessionStart 훅이 맡는다.

  // [DISABLED] 시작 시 활성 체크(`pruneStaleRestoredAgents` + 10초 주기)는 꺼 둔다 — 동시 다발 spawn 이 문제를 일으키는 것으로 보인다(조사 중). 다시 켜려면 동시성 제한(직렬 실행·p-limit)부터.
  const startupPrune = Promise.resolve();

  // 이미 실행 중인 background shell(dev 서버 등) JSONL 스캔으로 복원
  graphManager.rehydrateAllBackgroundShells();

  // isSessionInUse 결과 → WS broadcast (클라 debug 콘솔용)
  setLivenessProbeListener((result) => {
    const msg: WSMessage = { type: 'liveness_probe', timestamp: Date.now(), payload: result };
    broadcast(msg);
  });

  // subAgentManager 스트림 이벤트 → WS 실시간 중계, 40ms 창으로 묶는다 — 이벤트마다 보내면 멀티에이전트 폭주 때 초당 수백~수천 IPC/WS 메시지로 클라 큐가 밀린다.
  // sub_agent_stream_batch 1건으로 보내고(도착 순서 보존) 200건을 넘으면 창을 기다리지 않고 즉시 flush(지연 상한).
  const STREAM_BROADCAST_INTERVAL = 40;
  const STREAM_BATCH_MAX = 200;
  let streamBatch: SubAgentStreamEvent[] = [];
  let streamBatchTimer: ReturnType<typeof setTimeout> | null = null;
  const flushStreamBatch = (): void => {
    streamBatchTimer = null;
    if (streamBatch.length === 0) return;
    const batch = streamBatch;
    streamBatch = [];
    broadcast({ type: 'sub_agent_stream_batch', timestamp: Date.now(), payload: batch });
  };
  /**
   * §5.5 #17-17 ⑪(l) — 무대 블록. 에이전트가 말하다가 코드블록처럼 끼워 넣은 신고를 수확한다.
   * 여는·닫는 펜스가 다른 이벤트(토큰 델타)에 실려 와 세션별 꼬리 버퍼가 필요하고, 같은 블록을 두 번 적용하지 않게 원문 지문을 기억한다 — 둘 다 `StageBlockIngest` 몫.
   */
  const stageBlockIngest = new StageBlockIngest();

  /** ⑪(l) — 수확한 지시를 기존 문으로 적용한다(새 저장 경로 ❌). REST(`/progress`·`/api/visual-kind`) 신고와 같은 검증·병합을 지나야 "블록으로 냈을 때만 다르게 동작하는" 두 번째 진실이 안 생긴다. */
  const applyStageDirective = (
    agentId: string,
    subAgentId: string,
    directive: import('@vibisual/shared').StageBlockDirective,
  ): boolean => {
    let changed = false;

    // 종류 카드가 먼저다 — 같은 블록에서 만든 종류를 그 아래 단계가 `@key` 로 가리키기 때문이다.
    for (const kind of directive.kinds ?? []) {
      const card = graphManager.upsertVisualKind({
        key: kind.key,
        ...(kind.label ? { label: kind.label } : {}),
        ...(kind.glyph ? { glyph: kind.glyph } : {}),
        ...(kind.color ? { color: kind.color } : {}),
        ...(kind.scene ? { scene: kind.scene } : {}),
        ...(kind.surface ? { surface: kind.surface } : {}),
        ...(kind.blurb ? { blurb: kind.blurb } : {}),
        ...(kind.from ? { from: kind.from } : {}),
      });
      if (card) changed = true;
    }

    const hasGoalPart =
      !!directive.goal || !!directive.note || directive.percent !== undefined || !!directive.steps;
    if (!hasGoalPart) return changed;

    // 아직 목표 카드가 없다 = 이 세션이 명령 없이 스스로 목록을 세웠다. 계획 경로와 같은 문으로 태운다.
    if (!graphManager.getSessionGoal(subAgentId) && directive.steps && directive.steps.length > 0) {
      const sub = subAgentManager.getSub(subAgentId);
      const seedCommand = directive.goal ?? sub?.lastCommand;
      const born = graphManager.syncSessionGoalFromPlan(subAgentId, {
        agentId,
        ...(seedCommand ? { command: seedCommand } : {}),
        steps: directive.steps,
      });
      if (born) changed = true;
    }

    const goal = graphManager.noteSessionGoalProgress(subAgentId, {
      ...(directive.goal ? { goal: directive.goal } : {}),
      ...(directive.note ? { note: directive.note } : {}),
      ...(directive.percent !== undefined ? { percent: directive.percent } : {}),
      ...(directive.steps ? { steps: directive.steps } : {}),
      source: 'agent',
    });
    return changed || !!goal;
  };

  subAgentManager.setOnStreamEvent((event) => {
    // §5.5 #17-17 ⑪(l) — 답 본문에 끼워 넣은 무대 블록. 닫힌 블록만, 한 번만 적용된다.
    if (event.eventType === 'text' && event.content) {
      try {
        let touched = false;
        for (const directive of stageBlockIngest.push(event.subAgentId, event.content, event.turnId)) {
          if (applyStageDirective(event.parentAgentId, event.subAgentId, directive)) touched = true;
        }
        // 저장은 부르지 않는다 — 답변 텍스트가 전부 지나가는 자리라 계획 경로와 같은 규율(§9)로 브로드캐스트만 하고 디스크는 기존 스윕에 맡긴다.
        if (touched) broadcastSnapshot();
      } catch (err) {
        // 표시용이라 스트림을 막지 않는다 — 블록 하나가 이상해도 대화는 그대로 흘러야 한다.
        logger.warn(`[stage-block] ingest failed sub=${event.subAgentId}: ${String(err)}`);
      }
    }
    // §5.5 #17-17 ⑨ — 목표 단계 동기화의 두 번째 입구. 훅(PreToolUse/TodoWrite)이 늦거나 안 닿아도(훅 미설치·스테일 포트·외부 세션) 세션의 계획이 목표창에 반영된다.
    //   두 입구가 같은 syncSessionGoalFromPlan 으로 모여 순서와 무관하게 결과가 같고, 바뀐 게 없으면 undefined 라 broadcast 도 없다.
    if (event.eventType === 'tool_use' && event.toolName === 'TodoWrite') {
      try {
        const input = JSON.parse(event.content) as { todos?: unknown };
        const steps = parsePlanStepsFromTodos(input.todos);
        if (steps.length > 0) {
          const sub = subAgentManager.getSub(event.subAgentId);
          const updated = graphManager.syncSessionGoalFromPlan(event.subAgentId, {
            agentId: event.parentAgentId,
            ...(sub?.lastCommand ? { command: sub.lastCommand } : {}),
            steps,
          });
          if (updated) broadcastSnapshot();
        }
      } catch {
        // 계획 JSON 이 아니거나 잘려 있으면 조용히 통과 — 목표창은 표시용이라 스트림을 막지 않는다.
      }
    }
    streamBatch.push(event);
    if (streamBatch.length >= STREAM_BATCH_MAX) {
      if (streamBatchTimer !== null) { clearTimeout(streamBatchTimer); streamBatchTimer = null; }
      flushStreamBatch();
      return;
    }
    if (streamBatchTimer === null) {
      streamBatchTimer = setTimeout(flushStreamBatch, STREAM_BROADCAST_INTERVAL);
      if (typeof streamBatchTimer.unref === 'function') streamBatchTimer.unref();
    }
  });

  /**
   * §5.19 (H) — All Model(로컬) 세션의 도구 호출을 훅 경로에 이어 준다 — 없으면 로컬 세션은 파일 노드·감사 원장·Bash 이력·프리뷰 버블 어느 자국도 캔버스에 안 남긴다.
   * HTTP 라우트를 거치지 않는다(같은 프로세스라 그래프를 직접 부른다) — 대신 라우트가 하던 귀속(`_vibisualOwnerAgentId` → 소유 버블 세션)을 여기서 한다(CMD 터미널과 같은 길).
   * 도구 이벤트만 보낸다 — 생명주기(`markActive`/`markStop`)와 `Stop` 은 보내지 않는다. 로컬 턴은 자기 상태를 스스로 관리해 주인이 둘이면 서로 덮어쓰고, `Stop` 은 두뇌 리플렉션(`claude -p` 자식)을 깨워 로컬 세션이 클로드 토큰을 쓰게 만든다.
   */
  subAgentManager.setLocalHookEmitter((ctx, event) => {
    // 버블이 캔버스에서 사라졌으면 붙일 곳이 없다(조용히 흘려보낸다 — 표시용 경로다).
    const session = graphManager.findSessionByAgentId(ctx.agentId);
    if (!session) return;
    // 변환은 `localHookPayload` 한 곳뿐이다 — 그래프가 기대하는 모양과 한 칸만 어긋나도 오류 없이 아무 일도 안 일어나므로
    // (원장엔 남고 파일 노드는 0개) 시험도 같은 함수를 써서 사본이 어긋날 자리를 없앤다.
    // §5.1 #1-1 (D) — 그 일을 한 sub 를 함께 싣는다(앱 작업 귀속). 세션 키는 주인 버블 것이라 그래프가 sub 를 못 찾는다.
    const payload: HookEventPayload = toLocalHookPayload(session, event, { subAgentId: ctx.subAgentId });

    const result = graphManager.processHookEvent(payload);
    if (event.phase === 'post' && typeof payload.duration_ms === 'number') {
      graphManager.recordToolDuration(session, event.toolName, payload.duration_ms);
    }

    // Bash 뒤에는 파일이 사라졌을 수 있다(삭제·이름 변경). 라우트와 **같은 스로틀**을 나눠 써서
    //   두 경로가 함께 폭주해도 스윕이 겹치지 않게 한다.
    let changed = result !== null;
    // §5.25 (F) "쓴 내용도 남는다" — 코덱스 패치의 바뀐 덩어리. 버블을 세운 **뒤에** 붙인다(같은 세션 → 같은
    //   인스턴스). 경로는 그래프가 노드를 세울 때 쓴 `file_path`(절대경로로 올린 값) 그대로다.
    const fileEditPath = payload.tool_input?.['file_path'];
    if (event.phase === 'post' && event.fileEdit && typeof fileEditPath === 'string'
      && graphManager.recordProviderFileEdit(session, fileEditPath, event.fileEdit)) {
      changed = true;
    }
    if (
      event.phase === 'post' && isShellToolName(event.toolName)
      && Date.now() - lastExistenceSweepAt >= EXISTENCE_SWEEP_MIN_INTERVAL_MS
    ) {
      lastExistenceSweepAt = Date.now();
      const ghosted = graphManager.checkFileExistence();
      const pruned = graphManager.pruneDisappearing();
      if (ghosted > 0 || pruned > 0) changed = true;
    }
    if (changed) broadcastSnapshot();
    // 훅 경로와 같은 규율 — 도구 빈도로 도착하는 길이라 즉시 저장이 아니라 코얼레스 저장이다.
    scheduleCheckpoint();
  });

  /**
   * §5.19 (H) — All Model 세션의 호스트 도구 처리기. 클로드는 이 셋을 CLI 내장 도구로 하고 결과가 훅으로 오지만, 로컬엔 CLI 도 훅도 없어 우리가 도구를 주고 받는다.
   * 새 엔드포인트 ❌ — 이미 REST 로 선 것(목표 · 질문 카드 · 권한 브로커)을 그대로 부른다. 실패는 던지지 않고 말로 돌려준다(모델이 다른 수를 고른다).
   */
  subAgentManager.setLocalHostToolHandler(async (ctx, toolName, input) => {
    if (toolName === 'TodoWrite') {
      const raw = Array.isArray(input['todos']) ? (input['todos'] as unknown[]) : [];
      const steps = parseGoalSteps(raw.map((t) => {
        const o = (t ?? {}) as { content?: unknown; text?: unknown; status?: unknown };
        // 도구 스키마는 `content`, 목표창은 `text` — 이름만 맞춰 주고 값은 그대로 넘긴다.
        return { text: typeof o.content === 'string' ? o.content : o.text, status: normalizeTodoStatus(o.status) };
      }));
      if (steps.length === 0) return 'TodoWrite needs a non-empty "todos" array';
      const wanted = typeof input['goal'] === 'string' ? input['goal'].trim() : '';
      const existing = graphManager.getSessionGoal(ctx.subAgentId);
      if (!existing) {
        // 목표가 아직 없으면 **이 목록이 곧 목표**다 — 사용자가 따로 세워 줄 때까지 기다리면
        //   화면은 계속 비어 있고, 그건 이 세션이 무엇을 하는지 말하지 않는 것과 같다.
        const created = graphManager.setSessionGoal({
          agentId: ctx.agentId,
          subAgentId: ctx.subAgentId,
          text: (wanted || steps[0]?.text || ctx.agentLabel).slice(0, SESSION_GOAL_TEXT_MAX),
          status: 'active',
          steps,
          authoredBy: 'session',
        });
        if (!created) return 'could not create the plan (this bubble is no longer on the canvas)';
      } else {
        graphManager.noteSessionGoalProgress(ctx.subAgentId, {
          steps,
          ...(wanted ? { goal: wanted } : {}),
          source: 'agent',
        });
      }
      broadcastSnapshot();
      saveCheckpoint();
      const done = steps.filter((s) => s.status === 'done').length;
      return `plan updated: ${String(done)}/${String(steps.length)} steps done. The user can see it and stop you if it is wrong.`;
    }

    if (toolName === 'AskUserQuestion') {
      const raw = Array.isArray(input['questions']) ? (input['questions'] as unknown[]) : [];
      const items: AgentQuestionItem[] = [];
      for (const q of raw) {
        const o = (q ?? {}) as { question?: unknown; header?: unknown; options?: unknown };
        const question = typeof o.question === 'string' ? o.question.trim() : '';
        if (!question) continue;
        const prompts = Array.isArray(o.options)
          ? o.options.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
          : [];
        items.push({
          question,
          ...(typeof o.header === 'string' && o.header.trim() ? { header: o.header.trim() } : {}),
          prompts,
        });
      }
      if (items.length === 0) return 'AskUserQuestion needs at least one question';
      const questions: AgentQuestions = {
        id: randomUUID(),
        agentId: ctx.agentId,
        subAgentId: ctx.subAgentId,
        items,
        createdAt: Date.now(),
      };
      if (!graphManager.addAgentQuestions(questions)) {
        return 'could not post the question (this bubble is no longer on the canvas)';
      }
      broadcast({ type: 'agent_questions', payload: { agentId: ctx.agentId, subAgentId: ctx.subAgentId } } as WSMessage);
      broadcastSnapshot();
      saveCheckpoint();
      // **기다리지 않는다.** 사용자는 다음 메시지로 답하므로, 여기서 붙들면 그 턴이 통째로 멈춘다.
      return `asked the user ${String(items.length)} question(s). They answer in their next message — finish what you can now and stop; do not guess the answer.`;
    }

    if (toolName === 'ExitPlanMode') {
      const plan = typeof input['plan'] === 'string' ? input['plan'].trim() : '';
      if (!plan) return 'ExitPlanMode needs the "plan" you want approved';
      const mode = ctx.config.permissionMode || 'default';
      if (mode !== 'plan') {
        return `you are not in plan mode (current mode: ${mode}) — just do the work, no approval needed`;
      }
      const project = graphManager.getProjectPathForAgent(ctx.agentId) ?? '';
      const decision = await permissionBroker.request(
        {
          agentId: ctx.agentId,
          subAgentId: ctx.subAgentId,
          agentLabel: ctx.agentLabel,
          agentColor: ctx.config.color ?? '#6b7280',
          projectName: project,
          toolName: 'ExitPlanMode',
          toolInput: { plan },
        },
        // 사람이 안 보고 있으면 **계획대로 진행하지 않는다** — 승인은 사람이 하는 일이다.
        'deny',
      );
      if (decision.decision !== 'allow') {
        return `the user did not approve the plan${decision.reason ? `: ${decision.reason}` : ''}. Revise it and ask again.`;
      }
      // 승인 = 편집 잠금 해제. 살아 있는 설정 객체라 스냅샷·체크포인트를 그대로 탄다.
      ctx.config.permissionMode = 'acceptEdits';
      broadcastSnapshot();
      saveCheckpoint();
      return 'the user approved the plan. Editing is unlocked (acceptEdits) — start carrying it out now.';
    }

    return `${toolName} is not a host tool`;
  });

  subAgentManager.setProjectResolver((parentAgentId) => {
    const name = graphManager.getAgentProjectName(parentAgentId);
    if (!name) return null;
    return graphManager.getProjectByName(name) ?? null;
  });
  // §5.3 #12-1-B — 로컬 도구 판정이 턴 도중에 저장된 "항상" 답(못 쓰는 목록·확인 목록)을 읽는 자리.
  subAgentManager.setAgentConfigResolver((parentAgentId) => graphManager.getAgentConfig(parentAgentId));
  // §5.3 #12-3 — 로컬 도구 판정도 훅 경로와 같은 판정기·같은 자물쇠(열려 있는 모든 프로젝트)를 본다.
  subAgentManager.setPathLockResolver((toolName, toolInput, cwd) => (
    findToolLockHitsOnHost(toolName, toolInput, cwd, graphManager.getAllPathLocks())
  ));
  // §5.3 #12-4 (E) ③ — 로컬 모델의 도구 판정도 훅 경로와 같은 검증 판정 객체를 부른다.
  subAgentManager.setVerificationChecker((cmd, toolName, toolInput, cwd) => (
    verificationGate.checkCommandCall(cmd, { toolName, toolInput, cwd })
  ));
  // 위 해석이 `null` 일 때의 되찾기 후보(§5.5 `findStreamDirFor` ③). 탭을 닫았다 오가면 에이전트가 `sessionCwds`·`agents` 에서 빠져
  // 폴더를 못 짚고, 디스크에 대화가 있는데도 빈 배열이 나가 화면이 굳는다. 워크트리도 독립 프로젝트로 함께 들어온다.
  // §5.5 #17-12 — stub 으로 내려간 프로젝트도 넣는다(백그라운드는 15분, 메모리 압박 시 3분 뒤 내려간다 — 로드분만 훑으면 그 세션 과거를 못 찾는다).
  subAgentManager.setAllProjectsProvider(() => [
    ...Object.values(graphManager.getProjects()),
    ...Object.values(graphManager.getStubProjects()).map((meta) => meta.project),
  ]);

  // (아래 `setOnSubStatusChange`) 커스텀 에이전트 상태 = 소속 sub 집계 — sub 활동이 바뀔 때마다 부모 버블의 active/completed 를 다시 낸다.
  // 부모 버블이 안 바뀌어도 세션 도트가 바뀌었으면 내보낸다 — `recomputeCustomAgentStatus()` 는 이미 active 면 false 라, 거기에만 걸면
  // sub 의 active↔idle 이 클라로 안 나가 탭 점이 굳는다(클라는 스냅샷으로만 status 를 받는다, §3.1).
  // `broadcastSnapshot` 은 코얼레스라 호출이 늘어도 되지만 `saveCheckpoint` 는 동기라 조건을 넓히지 않는다(§5.5 훅 경로 프리즈 — 도트는 dispatch·finalize 가 저장).
  // §5.3 #10-2 — 턴 끝에서 "띄운 위임의 결과를 받았는가"를 묻는 창구. 못 받았으면 그 턴은 실패(`dispatchResult`, 사유에 cmdId)다 — 다음 턴 안내와 같은 목록.
  subAgentManager.setPendingDispatchResultsProvider(pendingDispatchResultsFor);
  // §5.1 #2-1 (B) — 사용자 명령이 처음 나가는 순간 묶음의 이번 턴을 연다(지난 턴의 그림은 묶음에서 빠진다). 바로 뒤의 상태 통지가
  //   스냅샷을 다시 보내지만, 상태가 그대로면(이미 active) 건너뛰므로 비웠을 때는 여기서 보낸다. 저장은 코얼레스.
  subAgentManager.setOnCommandStart((parentAgentId, busy) => {
    if (!graphManager.beginAgentTurn(parentAgentId, busy)) return;
    broadcastSnapshot();
    scheduleCheckpoint();
  });
  const lastSubStatusFingerprint = new Map<string, string>();
  subAgentManager.setOnSubStatusChange((parentAgentId) => {
    const bubbleChanged = graphManager.recomputeCustomAgentStatus(parentAgentId);
    const fingerprint = subAgentManager.getAllSubs(parentAgentId)
      // §5.5 #17-24 ⑥ — 압축 중 표식도 화면을 민다(상태는 그대로 active 라 빠지면 라이브 1줄이 모른다).
      .map((s) => `${s.id}:${s.status}:${s.compactingSince ?? ''}`)
      .join('|');
    const subChanged = lastSubStatusFingerprint.get(parentAgentId) !== fingerprint;
    if (subChanged) lastSubStatusFingerprint.set(parentAgentId, fingerprint);
    if (bubbleChanged || subChanged) broadcastSnapshot();
    if (bubbleChanged) saveCheckpoint();
  });

  // agent-view 매핑(agentViewShort/SessionId)을 spawn 직후 조건 없이 저장한다 — onSubStatusChange 는 status 변화가 없으면 저장을 건너뛰어,
  // spawn 직후 크래시하면 재시작 때 `reattachAgentViewOnBoot` 가 supervisor 의 살아 있는 워커를 못 되찾는다.
  subAgentManager.setOnPersistNeeded(() => {
    saveCheckpoint();
  });

  // §5.3 #12-1 — 권한 결정 직후 sub stream 에 합성 system 줄 하나(팝업 선택 또는 자동 결정 사유가 패널·체크포인트에 남는다).
  // subAgentId 를 모르면(레거시 hook env 결손) 건너뛴다 — broadcast `permission_resolved` 만 남는다.
  permissionBroker.onResolved = (request, decision) => {
    if (!request.subAgentId) return;
    const toolLabel = request.toolName || 'tool';
    // §5.3 #12-1-B — "항상"은 어느 칸에 적혔는지까지 남긴다(나중에 "왜 더는 안 묻지?"를 되짚는 자리).
    const alwaysNote = decision.choice === 'allow_always' ? ` (always: ${request.alwaysAllow ?? 'once'})`
      : decision.choice === 'reject_always' ? ` (always: ${request.alwaysReject ?? 'once'})`
      : '';
    let line: string;
    if (decision.cancelled) {
      // §5.3 #12-1-B — 아무도 누르지 않았다는 사실을 그대로 적는다(사람이 Deny 를 누른 척 ❌).
      line = decision.cancelled === 'agent-stopped'
        ? `[permission] CANCELLED — agent stopped before you answered (${toolLabel})`
        : `[permission] CANCELLED — the waiting call went away before you answered (${toolLabel})`;
    } else if (decision.decision === 'allow') {
      if (decision.reason === 'timeout') {
        line = `[permission] ALLOW (auto, timed out — no response in 60s) on ${toolLabel}`;
      } else if (decision.reason) {
        line = `[permission] ALLOW (auto: ${decision.reason}) on ${toolLabel}`;
      } else {
        line = `[permission] ALLOW — you pressed Allow on ${toolLabel}${alwaysNote}`;
      }
    } else {
      // deny
      if (decision.reason === 'timeout') {
        line = `[permission] DENY (auto, timed out — no response in 60s) on ${toolLabel}`;
      } else if (decision.reason) {
        line = `[permission] DENY — you pressed Deny on ${toolLabel}${alwaysNote} (note: ${decision.reason})`;
      } else {
        line = `[permission] DENY — you pressed Deny on ${toolLabel}${alwaysNote}`;
      }
    }
    subAgentManager.emitSystemMessage(request.agentId, request.subAgentId, line);
  };

  // critique 런타임(§5.3) — reject 판정이 실제 재작업을 일으킨다.
  // 작업자 완료 → `getIncomingCritiqueEdges` 의 primary 엣지마다 `dispatchCritiqueWatcher`(cmd.edgeId=critique.id) → watcher 응답 →
  // `handleCritiqueCompletion` 판정 파싱 → reject + 'force-rework' 면 상한 안에서 auto-rework 자매 엣지로 재작업, 넘으면 'comment-only' 강등
  // + 자매 엣지 제거 + 에스컬레이션 → 재작업이 끝나면 다시 critique(횟수 누적).
  // 한계: `critiqueTiming='intermediate'` 도 'final' 처럼 Stop 훅(1회 완료) 시점에 발사된다.

  type CritiqueVerdict = VerificationVerdict;

  /**
   * §5.3 #10-3 — Watcher 응답에서 구조화 판정 + 검증 증거를 뽑는다. 판정 불명을 승인처럼 흘려보내지 않는다(fail-open ❌).
   * - `attempts`(실행 명령 + exit code)만이 증거다. 증거 없는 `approve` 는 **`held`(보류)** 다.
   * - 키워드 폴백은 하위호환으로 두되 폴백 approve 도 증거가 없어 `held`. `reject` 는 폴백도 인정한다(막는 쪽으로 틀리는 것은 안전).
   */
  function parseCritiqueVerdict(text: string): {
    verdict: CritiqueVerdict;
    reason?: string;
    attempts: Array<Omit<VerificationAttempt, 'id' | 'ok'>>;
  } {
    const empty: Array<Omit<VerificationAttempt, 'id' | 'ok'>> = [];
    if (!text || typeof text !== 'string') return { verdict: 'held', attempts: empty };

    // 1) 구조화 블록 우선 — 펜스 여부와 무관하게 가장 바깥 { … } 후보를 훑는다.
    for (const raw of extractJsonObjectCandidates(text)) {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { continue; }
      if (!parsed || typeof parsed !== 'object') continue;
      const obj = parsed as Record<string, unknown>;
      const v = typeof obj.verdict === 'string' ? obj.verdict.toLowerCase() : '';
      if (v !== 'approve' && v !== 'reject') continue;
      const reason = typeof obj.reason === 'string' ? obj.reason.slice(0, 500) : undefined;
      const attempts = parseVerificationAttempts(obj.attempts);
      if (v === 'reject') return { verdict: 'reject', reason, attempts };
      // approve 는 증거가 있어야 승인이다.
      if (attempts.length === 0) {
        return { verdict: 'held', reason: reason ?? 'approve without evidence', attempts };
      }
      return { verdict: 'approve', reason, attempts };
    }

    // 2) 하위호환 키워드 폴백 — reject 만 인정한다.
    const upper = text.toUpperCase();
    const hasReject = /\b(REJECT|REWORK|NEEDS?[- ]?REWORK|FAIL(ED)?|NG\b)/.test(upper);
    const hasApprove = /\b(APPROVE[D]?|LGTM|PASS(ED)?|OK\b|ACCEPT(ED)?)/.test(upper);
    if (hasReject && !hasApprove) return { verdict: 'reject', attempts: empty };
    // approve 로 보이든 판정 불명이든, 증거가 없으므로 보류다.
    return { verdict: 'held', attempts: empty };
  }

  /** 텍스트에서 균형 잡힌 최상위 `{ … }` 후보들을 뽑는다(펜스·주변 산문 허용). */
  function extractJsonObjectCandidates(text: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') { if (depth === 0) start = i; depth++; continue; }
      if (ch === '}') {
        depth--;
        if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; }
        if (depth < 0) depth = 0;
      }
    }
    // 뒤에 나온 것(= 보통 결론부)을 먼저 본다.
    return out.reverse();
  }

  /** 판정 응답의 `attempts` 배열을 검증 증거로 정규화. exitCode 가 숫자가 아니면 버린다. */
  function parseVerificationAttempts(input: unknown): Array<Omit<VerificationAttempt, 'id' | 'ok'>> {
    if (!Array.isArray(input)) return [];
    const kinds: VerificationKind[] = ['build', 'typecheck', 'test', 'run', 'custom'];
    const out: Array<Omit<VerificationAttempt, 'id' | 'ok'>> = [];
    for (const item of input.slice(0, 20)) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const command = typeof o.command === 'string' ? o.command.trim().slice(0, 400) : '';
      if (!command) continue;
      // exitCode 가 없거나 숫자가 아니면 증거로 인정하지 않는다 — "돌렸는데 결과는 모르겠다"는 증거가 아니다.
      if (typeof o.exitCode !== 'number' || !Number.isFinite(o.exitCode)) continue;
      const kindRaw = typeof o.kind === 'string' ? (o.kind.toLowerCase() as VerificationKind) : 'custom';
      out.push({
        kind: kinds.includes(kindRaw) ? kindRaw : 'custom',
        command,
        exitCode: Math.trunc(o.exitCode),
        revision: typeof o.revision === 'string' ? o.revision.slice(0, 80) : undefined,
        startedAt: typeof o.startedAt === 'number' ? o.startedAt : Date.now(),
        durationMs: typeof o.durationMs === 'number' ? o.durationMs : undefined,
        detail: typeof o.detail === 'string' ? o.detail.slice(0, 2000) : undefined,
      });
    }
    return out;
  }

  /** Critique watcher 발사: source 에이전트의 세션 큐에 비평 지시 명령을 push.
   *  - isFreshCycle=true 면 reworkCount 0 으로 리셋, 아니면 유지(연속 사이클).
   *  - 이미 critique 엣지가 executing 이면 중복 발사 방지(no-op). */
  function dispatchCritiqueWatcher(
    edge: TaskEdge,
    contextResult: string | null,
    isFreshCycle: boolean,
    orchestraRunId?: string,
    /** §5.3 #12-4 (D) — 이 비평을 부른 명령(끝난 작업). 그 명령의 검증 범위가 발사의 근거다. */
    sourceCommand?: QueuedCommand,
  ): void {
    if (orchestraRunId && graphManager.findOrchestraRun(orchestraRunId)?.phase !== 'dispatched') return;
    /*
     * §5.3 #12-4 (D) — 완료 뒤 자동 후속은 검증을 새로 시작하지 않는다. 비평(리뷰)도 검증이라, 정책이 켜진 동안 사용자가 연 검증 범위를
     * 물려받기만 한다(종류 같고 남은 횟수만큼 — 재작업 사이클도 같은 몫). 런이 기다리지 않게 이 판정은 `expectCritique` 보다 **앞**이다.
     */
    const inheritedScope = sourceCommand
      ? inheritVerificationScope(sourceCommand.verificationScope, sourceCommand.verification, sourceCommand.id)
      : undefined;
    if (verificationGateOn() && !hasVerificationGrant(inheritedScope)) {
      logger.info(`[critique] skip dispatch — the finished command had no verification permission (edge ${edge.id}, §5.3 #12-4)`);
      return;
    }
    if (orchestraRunId) orchestraResults.expectCritique(orchestraRunId, edge.id);
    if (edge.status === 'executing' && !orchestraRunId) {
      logger.debug?.(`[critique] skip dispatch — edge ${edge.id} already executing`);
      return;
    }
    const allAgents = graphManager.getSnapshot().agents;
    const watcher = allAgents.find((a) => a.id === edge.sourceAgentId);
    const target = allAgents.find((a) => a.id === edge.targetAgentId);
    if (!watcher) {
      logger.warn(`[critique] watcher agent not found: ${edge.sourceAgentId} (edge ${edge.id})`);
      return;
    }
    const watcherSessionId = watcher.path;
    const targetLabel = target?.label ?? edge.targetAgentId;

    if (isFreshCycle && !orchestraRunId) graphManager.bumpCritiqueReworkCount(edge.id, 'reset');
    const currentRework = orchestraRunId ? orchestraResults.reworkCount(orchestraRunId, edge.id) : edge.reworkCount ?? 0;
    const maxRework = Math.min(edge.maxReworkCount ?? 3, TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT);
    const cyclePhase = currentRework === 0
      ? '(initial review)'
      : `(rework cycle ${currentRework}/${maxRework})`;

    const contextBlock = contextResult && contextResult.trim().length > 0
      ? `\n\n=== Target [${targetLabel}] just completed work ===\n${contextResult.trim()}\n`
      : `\n\n=== Target [${targetLabel}] just completed work (no result snippet captured) ===\n`;

    // §5.3 #10-3 — 구조화 판정을 요구한다. "애매하면 APPROVE" 같은 문구를 넣지 마라 — fail-open 이 프롬프트에 박힌다.
    const responseGuide = `\n\n${VERIFICATION_VERDICT_SCHEMA_GUIDE}\n`;

    const instruction = `${edge.command}${cyclePhase}${contextBlock}${responseGuide}`;

    const newSub = subAgentManager.create(watcher.id);
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now().toString(36)}-critq${Math.random().toString(36).slice(2, 5)}`,
      text: instruction,
      timestamp: Date.now(),
      subAgentId: newSub.id,
      status: 'queued',
      edgeId: edge.id,
      ...(orchestraRunId ? { orchestraRunId } : {}),
      ...(inheritedScope ? { verificationScope: inheritedScope } : {}),
    };
    const queue = commandQueues.get(watcherSessionId) ?? [];
    queue.push(cmd);
    commandQueues.set(watcherSessionId, queue);

    graphManager.setTaskEdgeStatus(edge.id, 'executing');
    broadcastSnapshot();
    saveCheckpoint();
    processNextCommand(watcherSessionId);
    logger.info(`[critique] dispatched watcher edge=${edge.id} watcher=${watcher.label} target=${targetLabel} cycle=${currentRework}/${maxRework}`);
  }

  /**
   * §5.3 #10-3 — 이 세션을 품은 auto-agent 의 활성 검증 런(워커 sessionId 는 `AutoAgentSummary.spawnedAgentIds`).
   * 어느 런에도 안 속하는 수동 엣지면 null — 그때는 엣지별 카운트를 쓴다.
   */
  function findActiveRunForAgentSession(agentSessionId: string | undefined): { runId: string; autoAgentId: string } | null {
    if (!agentSessionId) return null;
    const summaries = graphManager.getAutoAgentSummaries();
    for (const [autoAgentId, summary] of Object.entries(summaries)) {
      if (!summary?.spawnedAgentIds?.includes(agentSessionId)) continue;
      const run = graphManager.getActiveAutoAgentRun(autoAgentId);
      if (run) return { runId: run.runId, autoAgentId };
    }
    return null;
  }

  /** §5.3 #10-3 — 런이 사람을 부른다. 재작업 상한을 넘으면 권한만 조용히 낮추고 로그로 끝내지 않는다(포기한 줄도 모른다) — 기존 질문 카드 경로로 띄운다(새 카드 계열 ❌). */
  function escalateAutoAgentRun(autoAgentId: string, runId: string, reason: EscalationReason, detail?: string): void {
    const run = graphManager.closeAutoAgentRun(runId, 'escalated', reason);
    if (!run) return;
    const bubble = graphManager.getSnapshot().agents.find((a) => a.path === autoAgentId);
    if (!bubble) return;
    const reasonText: Record<EscalationReason, string> = {
      'budget-exhausted': `재작업 예산 ${run.reworkBudget}회를 다 썼는데 통과하지 못했습니다.`,
      'verification-failed': '검증이 실패한 채로 남았습니다.',
      'irreversible-action': '되돌릴 수 없는 작업이라 승인이 필요합니다.',
      'no-evidence': '통과했다는 보고는 있었지만 실행 증거가 없습니다.',
    };
    graphManager.addAgentQuestions({
      id: randomUUID(),
      agentId: bubble.id,
      items: [{
        question: `${reasonText[reason]}${detail ? `\n${detail}` : ''}\n\n요청: ${run.userRequest.slice(0, 300)}\n\n어떻게 할까요?`,
        header: '자율 루프가 사람을 부릅니다',
        prompts: [
          '수용 기준을 다시 알려줄 테니 그 기준으로 다시 진행해 주세요.',
          '지금까지 한 것만 남기고 이 런은 닫아 주세요.',
          '재작업 예산을 늘려서 계속 시도해 주세요.',
        ],
      }],
      note: `run ${run.runId} · 증거 ${run.attempts.length}건(통과 ${run.attempts.filter((a) => a.ok).length}건)`,
      createdAt: Date.now(),
    });
    autoAgentRuntime.handleRunClosed(autoAgentId, 'escalated', reason);
    logger.warn(`[run] escalated run=${runId} reason=${reason} agent=${autoAgentId}`);
  }

  /** Watcher 의 critique 응답이 완료되었을 때 호출. verdict 파싱 + (필요 시) auto-rework 발사 또는 에스컬레이션. */
  function handleCritiqueCompletion(edge: TaskEdge, watcherResult: string | undefined, orchestraRunId?: string, watcherCommand?: QueuedCommand): void {
    if (edge.kind !== 'critique' || (edge.bundleRole ?? 'primary') !== 'primary') return;
    const { verdict, reason, attempts } = parseCritiqueVerdict(watcherResult ?? '');
    const authority = edge.critiqueAuthority ?? 'force-rework';
    logger.info(`[critique] verdict=${verdict} authority=${authority} edge=${edge.id} evidence=${attempts.length}`);

    // §5.3 #10-3 — 이 판정의 검증 런을 찾아 증거를 서버에 적재한다. 대상(작업자) 세션 기준 — 검수받는 쪽이 런의 주인이다.
    const targetAgent = graphManager.getSnapshot().agents.find((a) => a.id === edge.targetAgentId);
    const runRef = orchestraRunId ? null : findActiveRunForAgentSession(targetAgent?.path);
    if (runRef) {
      for (const attempt of attempts) graphManager.appendVerificationAttempt(runRef.runId, attempt);
      graphManager.setAutoAgentRunVerdict(runRef.runId, verdict, reason);
      if (verdict === 'approve') {
        // 승인이라도 **통과 증거가 없으면** closeAutoAgentRun 이 verified 를 거부하고
        // no-evidence 로 떨어뜨린다(= 완료는 서버가 소유한다).
        const closed = graphManager.closeAutoAgentRun(runRef.runId, 'verified');
        if (closed?.status === 'escalated') {
          escalateAutoAgentRun(runRef.autoAgentId, runRef.runId, 'no-evidence');
        } else if (closed?.status === 'verified') {
          autoAgentRuntime.handleRunClosed(runRef.autoAgentId, 'verified');
        }
        broadcastSnapshot();
        saveCheckpoint();
        return;
      }
      if (verdict === 'held') {
        // 판정 불명 — 통과시키지 않는다. 런을 연 채 화면에 보류로 남긴다.
        logger.warn(`[critique] verdict held (no structured evidence) — run=${runRef.runId} edge=${edge.id}`);
        broadcastSnapshot();
        saveCheckpoint();
        return;
      }
    } else if (verdict !== 'reject') {
      return; // 런 밖의 수동 엣지 — 종전 동작 유지(approve/held 는 사이클 종료)
    }

    if (verdict !== 'reject') return;
    if (authority !== 'force-rework') return; // comment-only → 강제 없음

    const reworkEdge = graphManager.getBundleAutoRework(edge.id);
    if (!reworkEdge) {
      logger.warn(`[critique] reject but no auto-rework sister edge — edge=${edge.id}`);
      return;
    }
    const maxRework = Math.min(edge.maxReworkCount ?? 3, TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT);
    const nextCount = (orchestraRunId ? orchestraResults.reworkCount(orchestraRunId, edge.id) : edge.reworkCount ?? 0) + 1;

    // §5.3 #10-3 — 예산은 런 단위로 센다(엣지마다 세면 reviewer·tester 각 3번 = 실제 6번이 된다).
    if (orchestraRunId) {
      if (!orchestraResults.consumeRework(orchestraRunId, edge.id, maxRework)) return;
    } else if (runRef) {
      const consumed = graphManager.consumeAutoAgentRework(runRef.runId);
      if (consumed && !consumed.withinBudget) {
        escalateAutoAgentRun(runRef.autoAgentId, runRef.runId, 'budget-exhausted', reason);
        broadcastSnapshot();
        saveCheckpoint();
        return;
      }
    } else if (nextCount > maxRework) {
      // 런 밖의 수동 엣지 — 종전 동작(강등) 유지.
      graphManager.downgradeCritiqueAuthority(edge.id);
      logger.warn(`[critique] maxReworkCount ${maxRework} exceeded — downgraded to comment-only. edge=${edge.id}`);
      broadcastSnapshot();
      saveCheckpoint();
      return;
    }
    if (!orchestraRunId) graphManager.bumpCritiqueReworkCount(edge.id, 'increment');

    // auto-rework 자매 엣지로 작업자에게 재작업 지시 dispatch
    const allAgents = graphManager.getSnapshot().agents;
    const worker = allAgents.find((a) => a.id === reworkEdge.targetAgentId);
    const watcher = allAgents.find((a) => a.id === reworkEdge.sourceAgentId);
    if (!worker) {
      logger.warn(`[critique] rework target not found — edge=${reworkEdge.id}`);
      return;
    }
    const watcherLabel = watcher?.label ?? reworkEdge.sourceAgentId;
    const reasonBlock = watcherResult && watcherResult.trim().length > 0
      ? `\n\n=== Reviewer [${watcherLabel}] feedback ===\n${watcherResult.trim()}\n`
      : '\n';
    const instruction = `${TASK_EDGE_AUTO_REWORK_COMMAND_LABEL} (cycle ${nextCount}/${maxRework})${reasonBlock}\nAddress the feedback and continue.`;

    const newSub = subAgentManager.create(worker.id);
    // §5.3 #12-4 (D) — 자동 재작업은 감시자 명령의 검증 범위를 물려받기만 한다(남은 횟수만큼 — 사이클이 돌수록 준다).
    const reworkScope = watcherCommand
      ? inheritVerificationScope(watcherCommand.verificationScope, watcherCommand.verification, watcherCommand.id)
      : undefined;
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now().toString(36)}-rework${Math.random().toString(36).slice(2, 5)}`,
      text: instruction,
      timestamp: Date.now(),
      subAgentId: newSub.id,
      status: 'queued',
      edgeId: reworkEdge.id,
      ...(orchestraRunId ? { orchestraRunId } : {}),
      ...(reworkScope ? { verificationScope: reworkScope } : {}),
    };
    const workerSessionId = worker.path;
    const queue = commandQueues.get(workerSessionId) ?? [];
    queue.push(cmd);
    commandQueues.set(workerSessionId, queue);

    graphManager.setTaskEdgeStatus(reworkEdge.id, 'executing');
    broadcastSnapshot();
    saveCheckpoint();
    processNextCommand(workerSessionId);
    logger.info(`[critique] dispatched rework edge=${reworkEdge.id} worker=${worker.label} cycle=${nextCount}/${maxRework}`);
  }

  // subAgentManager 완료 콜백 → 완료 명령 archive 이동 + snapshot broadcast + 다음 명령 처리
  subAgentManager.setOnComplete(() => {
    // stop() and failed spawns may finish synchronously while this callback is archiving.
    if (completingCommands) { completeCommandsAgain = true; return; }
    completingCommands = true;
    orchestraCompletionDepth++;
    try {
    do {
    completeCommandsAgain = false;
    // 완료/에러 명령을 큐에서 archive로 이동
    for (const [sessionId, queue] of commandQueues) {
      const done = queue.filter((c) => c.status === 'completed' || c.status === 'error');
      if (done.length === 0) continue;

      // Task Edge dispatch 매칭: edgeId 가 실린 명령이면 엣지 상태를 갱신하고 대기 중 dispatch promise 를 푼다.
      // critique 엣지(watcher 응답)·auto-rework 엣지(작업자 재작업)는 따로 모은다. 강제 중단(`[Stopped by user]`)은 critique 대상이 아니다.
      // §5.3 #12-4 (D) — 감시자 명령도 함께 든다. 자동 재작업은 그 명령의 검증 범위를 물려받기만 한다.
      const completedCritiqueEdges: { edge: TaskEdge; result: string | undefined; orchestraRunId?: string; command: QueuedCommand }[] = [];
      let sawNonCritiqueResponse = false;
      let sawReworkCompletion = false;
      const isUserStopped = (cmd: QueuedCommand): boolean =>
        typeof cmd.result === 'string' && cmd.result.startsWith('[Stopped by user]');
      for (const cmd of done) {
        const userStopped = isUserStopped(cmd);
        if (!cmd.edgeId) {
          // 직접 사용자 명령 완료 — 비-critique-응답으로 분류 → watcher 발사 후보
          // 단, 사용자가 강제 중단한 케이스는 watcher 발사 대상에서 제외.
          if (!userStopped) sawNonCritiqueResponse = true;
          continue;
        }
        const edgeStatus: 'completed' | 'error' = cmd.status === 'completed' ? 'completed' : 'error';
        const errMsg = cmd.status === 'error' ? (cmd.result ?? 'subagent error') : undefined;
        graphManager.setTaskEdgeStatus(cmd.edgeId, edgeStatus, cmd.result, errMsg);
        const artifact = graphManager.getBundleArtifact(cmd.edgeId);
        if (artifact) graphManager.setTaskEdgeStatus(artifact.id, edgeStatus, cmd.result, errMsg);
        // §5.3 #10-2 (위임 결과 복구) — 장부에 끝을 적고 기다리던 대기에 건넨다(엣지는 바로 위에서 이미 내렸다).
        settleDispatchCommand(cmd);
        // critique 분류 — 강제 중단은 critique 사이클에서 뺀다.
        const cmdEdge = graphManager.getTaskEdge(cmd.edgeId);
        if (cmdEdge?.kind === 'critique' && (cmdEdge.bundleRole ?? 'primary') === 'primary') {
          // watcher 의 critique 응답 — verdict 처리 대상. 작업자 watcher 발사 후보 ❌.
          // 사용자가 watcher 를 중단한 경우 verdict 파싱도 skip (rework 발사 안 함, 사이클 종료).
          if (edgeStatus === 'completed' && !userStopped) {
            completedCritiqueEdges.push({ edge: cmdEdge, result: cmd.result, orchestraRunId: cmd.orchestraRunId, command: cmd });
          }
        } else if (cmdEdge?.bundleRole === 'auto-rework') {
          // 작업자가 auto-rework 명령 완료 — 다음 사이클 watcher 재발사 대상. count 리셋 ❌(연속).
          // 사용자가 rework 중간에 중단했으면 watcher 재발사 안 함.
          if (!userStopped) {
            sawNonCritiqueResponse = true;
            if (edgeStatus === 'completed') sawReworkCompletion = true;
          }
        } else {
          // 그 외 일반 엣지(command/artifact/request) 완료 — 새 cycle watcher 발사 대상.
          if (!userStopped) sawNonCritiqueResponse = true;
        }
      }

      // §5.3 #28 (K)(L) — 콘티모드(customMode==='conti') 에이전트의 응답 `cmd.result` 에서 JSON 을 뽑아 conti 레코드로.
      // workId 트래커로 가른다: contiId 있음 → frames 통째 교체 + conti_updated · contiId 없음 → 새 Conti + 트래커에 contiId + conti_generated ·
      // 트래커 없음(외부 트리거 없는 첫 응답) → workId 를 발급해 새 Conti. 부트스트랩(title='(empty)') 1건은 첫 진짜 응답 때 버린다.
      const ownerAgentId = graphManager.findAgentIdBySession(sessionId);
      if (ownerAgentId) {
        const ownerCfg = graphManager.getAgentConfig(ownerAgentId);
        if (ownerCfg?.customMode === 'conti') {
          for (const cmd of done) {
            if (cmd.status !== 'completed') continue;
            if (typeof cmd.result !== 'string' || !cmd.result.trim()) continue;
            const parsed = parseContiResponse(cmd.result);
            if (!parsed) continue;

            // 트래커가 없으면 agent_session 출처로 자체 발급 — fallback.
            let work = graphManager.getActiveContiWork(ownerAgentId);
            if (!work) {
              work = graphManager.startContiWork(ownerAgentId, 'agent_session') ?? undefined;
            }
            const workId = work?.workId ?? '';
            const targetContiId = work?.contiId;

            if (targetContiId && graphManager.getConti(targetContiId)) {
              // 수정 케이스 — frames 통째 교체
              const updated = graphManager.updateContiFrames(targetContiId, parsed.frames, parsed.title);
              if (updated) {
                broadcast({ type: 'conti_updated', timestamp: Date.now(), payload: { contiId: targetContiId, agentId: ownerAgentId, workId } });
                logger.info(`Conti auto-updated: agent=${ownerAgentId}, contiId=${targetContiId}, frames=${parsed.frames.length}, workId=${workId}`);
              }
            } else {
              // 신규 케이스 — 새 Conti 생성 + 트래커에 contiId 머지.
              const existing = graphManager.getContisByAgent(ownerAgentId);
              if (existing.length === 1 && existing[0]?.title === '(empty)') {
                graphManager.deleteConti(existing[0]!.id);
              }
              const now = Date.now();
              const c: Conti = {
                id: contiId.conti(),
                agentId: ownerAgentId,
                createdAt: now,
                updatedAt: now,
                workId,
                ...(parsed.title ? { title: parsed.title } : {}),
                frames: parsed.frames,
              };
              graphManager.addConti(c);
              graphManager.attachContiIdToWork(ownerAgentId, c.id);
              broadcast({ type: 'conti_generated', timestamp: Date.now(), payload: { contiId: c.id, agentId: ownerAgentId, workId } });
              logger.info(`Conti auto-extracted: agent=${ownerAgentId}, contiId=${c.id}, frames=${c.frames.length}, workId=${workId}, source=${work?.source ?? 'unknown'}`);
            }
          }
        }
      }

      // attachments 는 완료 뒤에도 지우지 않는다 — 파일·필드가 archive 에 남아야 클라(StreamRenderer CommandBlock)가 보낸 그림을 썸네일로 보인다
      // (지우면 무엇을 보냈는지 확인할 수 없다). 누적 파일 정리 정책은 아직 없다.

      // §5.3 #10-2 — auto-agent 빌더 완료 감지. 빌더는 버블 자기 세션의 sub 라, 그 명령이 done 에 오면 phase 를 building → completed 로
      // 옮기고 마지막 응답을 요약으로 합성한다. 빠뜨리면 진행 표시가 'building' 에 남아 패널 스피너가 영영 돈다.
      const autoSummary = graphManager.getAutoAgentSummary(sessionId);
      if (autoSummary && autoSummary.phase === 'building') {
        let finalText: string | undefined;
        for (let i = done.length - 1; i >= 0; i--) {
          const r = done[i]!.result;
          if (typeof r === 'string' && r.trim()) { finalText = r; break; }
        }
        autoAgentRuntime.handleCompletion(sessionId, finalText);
      }

      // §5.5 #17-11 — 루프 회차 전진. 아카이브로 옮기기 **전에** `pendingCommandId` 대조로 회차 끝을 확정하고 다음 회차를 예약한다(중지·오류·목표 도달이면 정지).
      for (const cmd of done) advanceSessionLoop(cmd);
      // §5.5 #17-35 — 검증 닫기. 루프와 같은 자리에서 `pendingCommandId` 대조로 판정을 읽는다.
      for (const cmd of done) advanceVerificationRun(cmd);
      // §4 (CLI 사양 추종) — 턴 경계 압축. 루프 전진 **뒤**에 본다 — 루프가 이 회차로 `contextMode`
      //   정리를 걸었으면 그쪽이 이미 큐에 있어 직렬 가드에 막히므로 두 벌로 쏘지 않는다.
      for (const cmd of done) maybeCompactAfterTurn(cmd, sessionId);
      // §4 API 크레딧 — 한도로 멈춘 명령을 다른 결제 경로로 한 번 잇는다. 같은 큐에 넣으면 아래에서 남는
      //   명령(`remaining`)에 실리고, 이 처리기 끝의 `processNextCommand` 가 내보낸다.
      for (const cmd of done) maybeAutoContinueOnQuota(cmd, queue);
      // §5.3 #9-1 (N) — 이 턴이 슬롯 하나를 비웠다. 상한에 걸려 기다리던 **다른 세션**을 깨운다.
      //   자기 세션은 아래 기존 경로가 이미 두드리므로 여기서 하는 일은 "남의 큐" 뿐이다.
      // §5.3 #10-4 — 오케스트라 정산(토큰 귀속 · 지휘 턴 단계 닫기 · 덮어쓴 설정 내리기). 아카이브로 옮기기
      //   **전에** 해야 한다 — 옮긴 뒤에는 이 목록이 큐에 없다.
      settleOrchestraCommands(done, ownerAgentId);
      pumpTokenSaverQueues();

      archiveCompletedCommands(sessionId, done);
      const remaining = queue.filter((c) => c.status === 'queued' || c.status === 'executing');
      commandQueues.set(sessionId, remaining);

      // §5.5 #17-11 — 부모 버블의 완료 판정을 여기서 한 번 더 낸다. sub 가 idle 이 된 시점엔 루프가 살아 있어 `hasPendingAgentWork` 가 강등을 보류했으므로,
      // 루프가 꺼진 지금 불러야 "마지막 회차 끝 = 완료"가 아래 broadcastSnapshot 과 같은 스냅샷에 실린다(늦으면 루프 종료음과 완료음이 두 번 울린다).
      if (ownerAgentId) graphManager.recomputeCustomAgentStatus(ownerAgentId);
      // §5.16 — 격리(워크트리)에서 일한 커스텀 에이전트가 턴을 끝내면 변경분으로 리뷰 카드를 만든다(판정 넷은 `maybeCreateReviewRequest`).
      // 여기서는 사용자 명령 완료(비-critique) 회차만 넘긴다 — watcher 응답·중단된 턴으로는 만들지 않는다(`sawNonCritiqueResponse`).
      if (ownerAgentId && sawNonCritiqueResponse) {
        const lastSub = [...done].reverse().find((c) => typeof c.subAgentId === "string" && c.subAgentId)?.subAgentId;
        void maybeCreateReviewRequest(ownerAgentId, lastSub ?? undefined).catch((err) => {
          logger.error(`[review-lane] maybeCreateReviewRequest failed agent=${ownerAgentId}`, err);
        });
      }

      // §5.18 — 에이전트 랩: 그 턴을 끝낸 에이전트가 랩 변형이면 결과(변경분·토큰·소요·비용)를
      //   그 줄에 적는다. 리뷰 레인과 **같은 자리·같은 수집 함수**를 쓴다(새 수집기 ❌).
      if (ownerAgentId && done.length > 0) {
        void maybeFinishLabVariant(ownerAgentId, done).catch((err) => {
          logger.error(`[agent-lab] maybeFinishLabVariant failed agent=${ownerAgentId}`, err);
        });
      }

      // §5.20 — 스크립트 선반: 그 턴을 끝낸 에이전트가 선반의 프롬프트 항목이 보낸 것이면 그 줄을
      //   마감한다. 랩과 **같은 자리**다 — 발사 시점에 성공으로 적으면 화면이 먼저 끝났다고 말한다.
      if (ownerAgentId && done.length > 0) {
        try {
          maybeFinishShelfPromptRun(ownerAgentId, done);
        } catch (err) {
          logger.error(`[shelf] maybeFinishShelfPromptRun failed agent=${ownerAgentId}`, err);
        }
      }

      // critique 런타임: (1) watcher 응답 완료 처리(reject 면 자매 auto-rework 발사 또는 강등) (2) 작업자 본 완료가 있으면 incoming critique watcher 발사.
      for (const { edge, result, orchestraRunId, command } of completedCritiqueEdges) {
        try {
          handleCritiqueCompletion(edge, result, orchestraRunId, command);
        } catch (err) {
          logger.error(`[critique] handleCritiqueCompletion failed edge=${edge.id}`, err);
        }
      }
      if (sawNonCritiqueResponse) {
        const workerAgentId = graphManager.findAgentIdBySession(sessionId);
        if (workerAgentId) {
          const incoming = graphManager.getIncomingCritiqueEdges(workerAgentId);
          // 컨텍스트: 가장 최근 완료된 일반/rework 명령의 result 한 건만 발췌(과도한 컨텍스트 폭주 방지).
          const lastNonCritiqueResult = (() => {
            for (let i = done.length - 1; i >= 0; i--) {
              const c = done[i]!;
              const e = c.edgeId ? graphManager.getTaskEdge(c.edgeId) : null;
              if (e?.kind === 'critique' && (e.bundleRole ?? 'primary') === 'primary') continue;
              if (typeof c.result === 'string' && c.result.trim()) return c.result;
            }
            return null;
          })();
          // §5.3 #12-4 (D) — 비평(리뷰)은 검증이다. 그 결과를 낸 명령(가장 최근 일반/rework 명령)의 검증
          //   범위가 감시자 발사의 근거다 — 범위가 없으면 완료 뒤 자동 후속이 검증을 새로 시작하지 않는다.
          const lastNonCritiqueCommand = (() => {
            for (let i = done.length - 1; i >= 0; i--) {
              const c = done[i]!;
              const e = c.edgeId ? graphManager.getTaskEdge(c.edgeId) : null;
              if (e?.kind === 'critique' && (e.bundleRole ?? 'primary') === 'primary') continue;
              return c;
            }
            return undefined;
          })();
          // Preserve each run when concurrent sessions finish on the same worker.
          const { firings, plainFallback } = orchestraCritiqueFirings(done, workerAgentId, {
            findRun: (runId) => graphManager.findOrchestraRun(runId),
            findEdge: (edgeId) => graphManager.getTaskEdge(edgeId ?? '') ?? undefined,
            isUserStopped,
          });
          for (const edge of incoming) {
            try {
              for (const firing of firings) {
                // 오케스트라 런은 그 런을 연 사용자 명령이 권한의 근거다.
                const rootCommandId = graphManager.findOrchestraRun(firing.runId)?.commandId;
                dispatchCritiqueWatcher(edge, firing.result, firing.freshCycle, firing.runId, rootCommandId ? findCommandById(rootCommandId) : undefined);
              }
              if (plainFallback) {
                dispatchCritiqueWatcher(edge, lastNonCritiqueResult, !sawReworkCompletion, undefined, lastNonCritiqueCommand);
              }
            } catch (err) {
              logger.error(`[critique] dispatchCritiqueWatcher failed edge=${edge.id}`, err);
            }
          }
        }
      }
    }
    } while (completeCommandsAgain);
    } finally {
      completingCommands = false;
      orchestraCompletionDepth--;
      flushOrchestraResults();
    }
    broadcastSnapshot();
    saveCheckpoint();
    // 완료된 명령의 세션에서 다음 queued 명령 실행 — 큐에 등록된 모든 세션(커스텀 포함) 대상
    for (const sessionId of commandQueues.keys()) {
      processNextCommand(sessionId);
    }
  });

  // Listen 은 이미 위(createServer 직후)에서 완료됨. 여기서는 하이드레이션 완료 후 필요한
  // 주기 작업 / 세션 생명주기 / scenario 시드만 기동.
  void startupPrune.then(() => postListenBoot());

  function postListenBoot(): void {
    // 3-Layer 세션 생명주기 매니저 시작 + 기존 추적 세션 초기 동기화
    for (const s of graphManager.listTrackedSessions()) {
      lifecycle.registerFromSeed(s.sessionId, s.pid, s.cwd);
    }
    lifecycle.start();

    // §5.5 #17-33 ⑦ — 공식 마켓·설치본 자동 갱신(부르는 자리가 없으면 마켓 클론이 멈춰 새 스킬이 앱에 안 나타난다).
    // CLI 는 `cwd` 로 범위를 해석하므로 띄울 프로젝트를 여기서 넘긴다 — 마켓 클론(`~/.claude/plugins`)은 하나라 어느 프로젝트든 같다.
    startClaudePluginAutoRefresh(() => {
      const snap = graphManager.getSnapshot();
      const last = loadAppState().lastActiveProject;
      // 마지막으로 보던 프로젝트가 아직 열려 있으면 그것으로, 아니면 열린 것 아무거나.
      const byLast = last ? Object.values(snap.projects).find((p) => samePath(p.path, last)) : undefined;
      return (byLast ?? Object.values(snap.projects)[0])?.path ?? null;
    });

    // 재기동 정합성 보정: 체크포인트 복원으로 subs 는 idle 이지만 커스텀 부모 버블이
    // 이전 세션 상태(active) 로 남아있을 수 있으니 여기서 한 번 sweep.
    if (graphManager.recomputeAllCustomAgentStatuses()) {
      broadcastSnapshot();
      saveCheckpoint();
    }

    // §5.7 #23-2 — Agent View reattach: 저장된 agentViewShort 중 supervisor 에 살아 있는 워커의 JSONL watcher 를 다시 붙여
    // 서버가 죽어 있던 동안의 턴도 따라잡는다. 죽은 워커는 state.json 최종 상태로 마무리. projectResolver 가 set 된 뒤에 불러야 한다.
    void subAgentManager.reattachAgentViewOnBoot((subId) => {
      // §5.7 #23-2 — agent-view 가 끝날 때 cmd 도 함께 봉합하려는 조회. 같은 sub 의 executing 명령이 commandQueues 어딘가(보통 그 sub 의 sessionId 큐)에 있다고 본다.
      for (const queue of commandQueues.values()) {
        for (const cmd of queue) {
          if (cmd.status === 'executing' && cmd.subAgentId === subId) return cmd;
        }
      }
      return null;
    }).then((r) => {
      if (r.alive + r.gone + r.failed > 0) {
        logger.info(`[agent-view] postListen reattach: alive=${r.alive} gone=${r.gone} failed=${r.failed}`);
        if (r.alive > 0 || r.gone > 0) {
          broadcastSnapshot();
          saveCheckpoint();
        }
      }
    }).catch((err) => {
      logger.warn(`[agent-view] postListen reattach failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    // 주기적 세션 스캔 + 제목 해결 + SubAgent 대기열 처리 (통합 루프)
    setInterval(() => {
      let needsBroadcast = false;

      // SCENARIO §5.7 #24: 모든 설정 홈(`~/.claude` + Cowork 세션 홈)의 `sessions/<PID>.json` 을
      // 10초마다 스캔하여 인터랙티브 진입점 + cwd 일치 + JSONL 활성 조건을 만족하는 신규 세션을 시딩.
      // SessionStart 훅이 놓친 케이스(창 재오픈, 훅 미설치 등)의 폴백.
      const seeded = graphManager.scanAllProjects();
      if (seeded) needsBroadcast = true;

      // §3.6 — 사용자가 Cowork 에서 새 대화를 열면 설정 홈이 하나 생긴다. 그 홈에 우리 블록이
      //   깔리기 전에 CLI 가 설정을 읽으면 그 세션은 훅이 0건이라 캔버스에 한 획도 안 남는다.
      //   부팅 1회로는 그 뒤에 생긴 세션이 전부 새어 나가므로 이 스윕에 얹는다(새 타이머 ❌).
      installHooksIntoNewCoworkHomesIfReady();

      // 제목 미확정 에이전트 재조회 (JSONL 생성 대기)
      if (graphManager.hasPendingTitles()) {
        const changed = graphManager.resolvePendingTitles();
        if (changed > 0) needsBroadcast = true;
      }

      // 활성 판정은 SessionLifecycleManager가 담당 (아래 server.listen 콜백에서 start)

      if (needsBroadcast) {
        broadcastSnapshot();
        saveCheckpoint();
      }

      // 주기적 sweep: 놓친 서브에이전트 종료 콜백 등으로 커스텀 부모 상태가 튀는 케이스 보정
      if (graphManager.recomputeAllCustomAgentStatuses()) {
        broadcastSnapshot();
        saveCheckpoint();
      }

      // §7.11 — background shell(dev 서버) 발견 안전망. PostToolUse 트리거가 어긋났거나(이벤트 미도달·tool_response 형식 변화) 세션 등록 뒤에 떠서
      // 놓친 dev 서버를 모든 세션 JSONL 에서 다시 잡는다. rehydrate·watcher.start·createIframeSatellite 가 멱등이라 매 주기 불러도 중복이 없다.
      // broadcast 는 watcher 콜백(onSnapshotChange) 몫이라 여기선 needsBroadcast 를 세우지 않는다.
      graphManager.rehydrateAllBackgroundShells();

      // SubAgent: 대기열에 queued 명령 있으면 실행 — 큐 등록된 모든 세션(커스텀 포함) 대상
      for (const sessionId of commandQueues.keys()) {
        processNextCommand(sessionId);
      }

      // §5.5 #17-11 — 세션 루프 안전망. 예약은 setTimeout 이 하고, 여기서는 재시작 등으로 예약을 잃은 루프만 주워 다음 회차를 굴린다.
      if (sweepSessionLoops() > 0) {
        broadcastSnapshot();
        saveCheckpoint();
      }
    }, SESSION_SCAN_INTERVAL);

    // §5.21 — 비용·토큰 지도 스윕. 훅마다 재파싱하지 않고 이 주기에만 훑으며,
    //   활성 세션만 넘긴 뒤 JSONL 스캐너가 mtime·size 로 한 번 더 걸러 변화 없으면 파일을 열지 않는다.
    setInterval(() => {
      // §4 (상태바 모델 칸 ③(나)) — 모델 목록 주기 확인도 이 스윕에 얹는다(새 타이머 ❌). 기다리지 않는다 —
      //   할 일이 없으면 `stat` 한 번이고, 바뀐 것이 있으면 서비스 구독이 방송한다.
      void modelRegistryService.refreshIfDue();
      let changed = false;
      try {
        changed = graphManager.sweepCostMaps(modelRegistryService.getRegistry());
      } catch (err) {
        logger.debug(`cost map sweep failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (changed) {
        broadcastSnapshot();
        saveCheckpoint();
      }
    }, COST_MAP_SWEEP_INTERVAL_MS);

    // 파일 존재 확인 + ghost 만료 제거 (별도 주기)
    setInterval(() => {
      let needsBroadcast = false;

      // 파일/폴더 경로 검증 → 사라진 노드 ghost 전환
      const ghosted = graphManager.checkFileExistence();
      if (ghosted > 0) needsBroadcast = true;

      // disappearing 만료 버블 제거
      const pruned = graphManager.pruneDisappearing();
      if (pruned > 0) needsBroadcast = true;

      if (needsBroadcast) {
        broadcastSnapshot();
        saveCheckpoint();
      }
    }, FILE_EXISTENCE_CHECK_INTERVAL);

    // 자동 idle 전환 스윕 (부모 에이전트 + 서브에이전트) — 30초 간격
    setInterval(() => {
      const expiredParents = graphManager.sweepIdleAgents(AGENT_IDLE_THRESHOLD_MS);
      const expiredSubs = subAgentManager.sweepIdle(AGENT_IDLE_THRESHOLD_MS);
      // completed → idle 자동 페이드(AGENT_FADE_DURATION 60초 경과분) — 클릭 dismiss 가 없어도 글로우가 꺼진다.
      const expiredCompleted = graphManager.expireCompletedAgents();
      if (expiredParents.length > 0 || expiredSubs.length > 0 || expiredCompleted.length > 0) {
        broadcastSnapshot();
        saveCheckpoint();
      }
    }, AGENT_IDLE_SWEEP_INTERVAL_MS);

    // §9 배경 탭 유휴 해제 — 아무 창도 안 보고 · 일하는 것 없고 · 오래 지난 프로젝트를 stub 으로 내린다.
    //   탭은 그대로 보이고(스냅샷의 stubProjects), 그 탭을 다시 고르면 구독 선언이 자동 hydrate 한다.
    //   힙 압력(§3.2.4 I축)이 걸려 있으면 임계값을 낮춰 먼저 내려놓는다 — 끈 경우(0)는 그대로 끈다.
    setInterval(() => {
      if (PROJECT_IDLE_UNLOAD_MS <= 0) return;
      const level = pressureLevelOf(sampleMemory());
      const idleMs = level === 'normal'
        ? PROJECT_IDLE_UNLOAD_MS
        : Math.min(PROJECT_IDLE_UNLOAD_MS, PROJECT_IDLE_UNLOAD_PRESSURE_MS);
      const unloaded = graphManager.sweepIdleBackgroundProjects(idleMs);
      if (unloaded.length > 0) {
        logger.info(
          `Idle background project(s) unloaded → stub (${level === 'normal' ? 'idle' : `memory-pressure:${level}`}): ${unloaded.join(', ')}`,
        );
        broadcastSnapshot();
      }
    }, PROJECT_IDLE_UNLOAD_SWEEP_MS);

    // §5.5 #17-9 ⑭(g) — 저장된 판정 설정을 부팅 때 한 번 먹인다. 이후 갱신은 PUT 라우트가 한다.
    //   이 주입이 빠지면 사용자가 꺼 둔 기능이 재기동마다 되살아난다(설정이 저장돼도 안 읽히므로).
    subAgentManager.setBackgroundTaskProbeSettings(appStateGetBgTaskProbe());

    // §2.4 — **"실행중…"이 진짜인가**를 에이전트가 확인한다. 위와 같은 이유로 부팅 때 한 번 먹인다.
    subAgentManager.setSessionProbeSettings(appStateGetSessionProbe());

    // §5.3 #9-2 — 에이전트가 띄운 프로세스의 보호. 위와 같은 이유로 부팅 때 한 번 먹인다(끈 사용자의
    //   설정이 재기동마다 되살아나지 않게). 알림은 그 프로세스를 낳은 세션의 스트림 한 줄 + 진단 로그 —
    //   문장은 클라가 로케일로 만들고 여기서는 사실만 싣는다. 주인을 모르는 자식은 진단 로그만.
    processGuard.setSettings(appStateGetProcessGuard());
    processGuard.setNoticeSink((owner, notice) => {
      recordDiagnostic('server', 'warn', `[process-guard] ${notice.reason} by ${notice.enforcedBy}`
        + `${notice.image ? ` ${notice.image}` : ''}${notice.pid !== undefined ? ` pid=${notice.pid}` : ''}`
        + `${notice.memBytes !== undefined ? ` mem=${notice.memBytes}` : ''}${notice.capBytes !== undefined ? ` cap=${notice.capBytes}` : ''}`
        + `${notice.availBytes !== undefined ? ` avail=${notice.availBytes}` : ''}${notice.count !== undefined ? ` count=${notice.count}` : ''}`);
      // 그 세션이 실제로 있을 때만 — CMD 의 `main` 토큰처럼 세션이 아닌 자리에 줄을 만들지 않는다.
      if (owner && subAgentManager.getSub(owner.subAgentId)) {
        subAgentManager.emitSystemMessage(owner.parentAgentId, owner.subAgentId, formatProcessGuardNotice(notice));
      }
    });

    // §2.1 (B) — 최상위 외부 폴더 예산도 같은 규약이다. 이 주입이 빠지면 사용자가 정한 밀도가
    //   재기동마다 기본값(12)으로 되돌아간다(설정은 저장돼 있는데 아무도 안 읽는 상태).
    graphManager.setExternalTopBudget(appStateGetExternalTopBudget());
    // §5.23 — 웹 버블 묶기도 같은 규약이다. 빠지면 엔진 씨앗(묶지 않음)이 그대로 남아, 저장값도 기본값(켬)도
    //   먹지 않고 재기동마다 호스트마다 버블 하나로 돌아간다.
    graphManager.setWebGroupSettings(appStateGetWebGroup());
    // §2.4 — 실행 중 세션 생존 확인(`sessionLivenessProbe.ts`): 10분마다 한 건만 묻는다. `hasLivingWork` 이 참이라 다른 정리 장치가 못 걷는데
    // 실제로는 끝났거나 멈춘 세션을 잡는다 — 마지막 기록의 뜻을 읽어야 해서 코드가 아니라 모델이 답한다. 비동기라 착수만 하고 넘어간다.
    setInterval(() => {
      subAgentManager.maybeProbeRunningSessions(commandQueues);
    }, SESSION_PROBE_INTERVAL_MS);

    // §5.3 — 인터럽트(Esc/Ctrl+C)·도구 거부 때 Claude Code 는 Stop 훅을 안 쏴 Hook 버블이 active 로 굳는다.
    // 세션 JSONL 마지막 줄이 인터럽트 sentinel 이면 Stop 을 대신 흉내 낸다(markStop → completed → 60초 fade). markStop 이 broadcast 한다.
    setInterval(() => {
      // 헤드리스 세션의 실행 표시를 실제 프로세스 생존과 대조해 5초 안에 바로잡는다(자식을 잃고 `active` 가 남으면 [중지]가 헛버튼이 된다).
      // 프로세스가 사라진 세션의 백그라운드 작업 표시를 **먼저** 걷는다 — 남아 있으면 생존 대조가 "아직 도는 중"으로 보고 건너뛰어 유령이 버블을 붙든다.
      const orphanParents = subAgentManager.sweepOrphanedBackgroundTasks();
      const deadActive = subAgentManager.reconcileDeadActiveSubs();
      // §5.5 #17-9 ⑭ — 위 둘이 못 걷은 것(표식도 없고 세션은 살아 있는 것) 중 **가장 오래 조용한
      //   하나**를 골라 물어본다. 비동기라 여기서 기다리지 않는다 — 착수만 하고 즉시 넘어간다.
      subAgentManager.maybeProbeQuietBackgroundTasks();
      // 턴은 끝났는데 `executing` 으로 굳은 명령을 걷는다 — 굳으면 그 탭이 `busy` 로 잠겨 새 명령을 영영 못 받는다.
      // 아래 잠듦 판정이 `executing` 을 "곧 쓸 자식"으로 읽으므로 **그보다 먼저** 걷어야 재우기도 막히지 않는다.
      const zombieCmds = subAgentManager.sealZombieExecutingCommands(
        commandQueues,
        ZOMBIE_EXECUTING_GRACE_MS,
      );
      const zombieBySession = new Map<string, QueuedCommand[]>();
      for (const { sessionId, cmd } of zombieCmds) {
        const list = zombieBySession.get(sessionId);
        if (list) list.push(cmd);
        else zombieBySession.set(sessionId, [cmd]);
      }
      for (const [sessionId, sealed] of zombieBySession) {
        // 봉합분은 큐에서 빼 결과 아카이브로 옮긴다 — 정지 라우트가 하는 처리와 같은 자리라야
        //   사용자가 "왜 사라졌지"를 겪지 않고 실패 사유를 평소 자리에서 본다.
        const queue = commandQueues.get(sessionId);
        if (queue) commandQueues.set(sessionId, queue.filter((c) => !sealed.includes(c)));
        // §5.3 #10-2 — 좀비 봉합도 완료 콜백을 거치지 않는다. 위임 명령이면 장부·대기·엣지를 여기서 내린다.
        for (const cmd of sealed) settleDispatchCommand(cmd, { updateEdge: true });
        archiveCompletedCommands(sessionId, sealed);
      }
      // §5.5 #17-18 ⑪ — 대기 워치독: 5초마다 나갈 수 있는데 안 나간 명령이 있는 세션을 한 번 더 민다.
      // `processNextCommand` 로 들어가는 길은 턴 종료 콜백·토큰 절약 펌프·정지 라우트뿐이고, 그것도 에이전트/cwd 를 못 찾거나 토큰 절약이
      // 거절하면 예약 없이 돌아간다 — 그러면 뒤에 선 덧말이 영영 대기로 남아 "작업 중"만 뜬다.
      // `processNextCommand` 는 게이트를 전부 다시 보므로 반복 호출이 안전하다. 새 타이머·상태·REST ❌. 판정은 `services/queueWatchdog.ts`(따로 시험).
      for (const sid of sessionsNeedingKick(commandQueues)) processNextCommand(sid);
      // §2.4 (잠듦) — 대화가 끝난 지 오래된 세션의 자식 프로세스를 회수해 메모리를 돌려준다.
      //   다음 명령이 오면 `--resume` fresh spawn 으로 그대로 이어지므로 사용자가 잃는 것은 없다.
      //   큐에 아직 나가지 않은 명령이 남은 세션은 곧 그 자식을 쓸 자리라 건너뛴다.
      const slept = subAgentManager.sweepDormantIdleSubs(SUBAGENT_DORMANT_IDLE_MS, (subId) => {
        // 반복 명령(§5.5 #17-11)이 켜진 탭은 다음 회차를 기다리는 중이다. 회차는 큐를 타므로 재워도
        //   `--resume` 으로 이어지지만, 사용자에게는 "루프가 도는 탭"이라 건드리지 않는다.
        if (graphManager.getSessionLoop(subId)?.enabled) return true;
        for (const queue of commandQueues.values()) {
          for (const cmd of queue) {
            if (cmd.subAgentId !== subId) continue;
            if (cmd.status === 'queued' || cmd.status === 'executing') return true;
          }
        }
        return false;
      });
      if (deadActive.length > 0 || orphanParents.length > 0 || slept.length > 0 || zombieCmds.length > 0) {
        const parents = new Set(orphanParents);
        const zombieSubIds = zombieCmds
          .map(({ cmd }) => cmd.subAgentId)
          .filter((id): id is string => id !== null);
        for (const id of [...deadActive, ...slept, ...zombieSubIds]) {
          const parentId = subAgentManager.getSub(id)?.parentAgentId;
          if (parentId) parents.add(parentId);
        }
        for (const parentId of parents) {
          graphManager.recomputeCustomAgentStatus(parentId);
        }
        broadcastSnapshot();
        saveCheckpoint();
      }

      /*
       * §5.26 (D)(F) — 컨텍스트 보험의 주기 몫. 새 타이머 ❌ — 이미 5초마다 화면과 사실을 대조하는 이 루프에 얹는다.
       * - 2단계 대조: `PreCompact` 마커 중 결과가 없는 것만, 마커 바이트 오프셋 뒤 요약 구간에 항목이 나타나는지만 훑는다(모델 호출 ❌).
       * - 4단계 감시: 문맥이 찼는데 압축이 안 도는 세션에 등급을 매긴다. 자동 조치 ❌ — 사용자가 누를 손잡이만 켠다(§5.26 (F)).
       */
      const outcomeChanged = graphManager.sweepCompactOutcomes();
      // §5.26 (G) — 되살아난 세션이 정말 문맥을 받았는지. 첫 턴이 돌면 그때 판정된다.
      const resumeChanged = graphManager.sweepResumeChecks();
      const watchChanged = graphManager.refreshCompactWatch();
      if (outcomeChanged || resumeChanged || watchChanged) {
        broadcastSnapshot();
        // 대조 결과·되살리기 확인은 원장에 남는다(감시는 파생이라 ❌)
        if (outcomeChanged || resumeChanged) saveCheckpoint();
      }

      const interrupted = graphManager.findInterruptedActiveSessions();
      if (interrupted.length === 0) return;
      for (const sessionId of interrupted) {
        agentTracker.markStop(sessionId);
        logger.info(`Interrupt reconcile: missing Stop hook → completed (session: ${sessionId.slice(0, 8)})`);
      }
      saveCheckpoint();
    }, INTERRUPT_RECONCILE_INTERVAL_MS);

    // iframe 생사 확인 (포트 TCP 핑) — 5초 간격
    setInterval(() => {
      void graphManager.checkIframesAlive().then((changed) => {
        if (changed) {
          broadcastSnapshot();
          saveCheckpoint();
        }
      });
    }, 5000);

    // §5.14 — 플레이 버블 생사 확인: running 인데 포트가 죽었으면 idle 로. 버블은 지우지 않는다 — 사용자가 지울 때까지 남는 것이 이 기능의 약속이다
    // (§7.11 iframe 위성의 60초 grace 자동 제거와 다르다).
    setInterval(() => {
      const running = graphManager.getAllPlayBubbles().filter((b) => b.status === 'running');
      if (running.length === 0) return;
      void Promise.all(
        running.map(async (bubble) => {
          if (bubble.recipe?.kind === 'static') return false;
          if (await isPlayAlive(bubble)) return false;
          graphManager.updatePlayBubble(bubble.id, { status: 'idle', url: undefined, port: undefined, previewOpen: false });
          return true;
        }),
      ).then((changes) => {
        if (changes.some(Boolean)) {
          broadcastSnapshot();
          saveCheckpoint();
        }
      });
    }, PLAY_ALIVE_SWEEP_MS);

    // 비동기 감시 이벤트 (background shell 포트 탐지 등) → broadcast 연결
    graphManager.setOnSnapshotChange(() => {
      broadcastSnapshot();
      saveCheckpoint();
    });

    // §4 — 진단 에러 로그가 바뀌면 스냅샷만 보낸다(saveCheckpoint ❌).
    diagnosticService.setOnChange(() => {
      snapshotBroadcast.requestDiagnostic();
    });

  }

  return { app };
}
import { hasCodexToolRestrictions, decideCodexTool } from '@vibisual/shared';
