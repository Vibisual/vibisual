import express from 'express';
import cors from 'cors';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { exec, execFile, spawn, type ChildProcess } from 'node:child_process';
import multer from 'multer';
import { DEFAULT_PORT, SESSION_SCAN_INTERVAL, FILE_EXISTENCE_CHECK_INTERVAL, SATELLITE_TYPES, IFRAME_PROXY_PATH, AGENT_IDLE_THRESHOLD_MS, AGENT_IDLE_SWEEP_INTERVAL_MS, INTERRUPT_RECONCILE_INTERVAL_MS, ZOMBIE_EXECUTING_GRACE_MS, SUBAGENT_DORMANT_IDLE_MS, SESSION_PROBE_INTERVAL_MS, TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS, TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT, TASK_EDGE_AUTO_REWORK_COMMAND_LABEL, SUPPORTED_UI_LOCALES, CONTI_AGENT_RULES, RULES_HISTORY_MAX, CANVAS_CLIPBOARD_SCHEMA_VERSION, AGENT_INTENT_FIRST_RULES, buildAgentCardCommonRules, AGENT_CARD_ENV_BASE, AGENT_CARD_ENV_TOKEN, buildAgentReportRules, buildAgentQuestionRules, buildAgentReviewRules, buildAgentFeedbackBlock, AGENT_FEEDBACK_SUMMARY_ITEM_MAX, CLAUDE_USAGE_POLL_INTERVAL_MS, CLAUDE_AUTH_POLL_INTERVAL_MS, CLAUDE_AUTO_UPDATE_BOOT_DELAY_MS, HOOK_TRANSPORT_REFRESH_DELAY_MS, SESSION_GOAL_TEXT_MAX, buildSessionGoalRules, buildSessionGoalState, buildSessionGoalProtocol, CONTEXT_SOURCE_IDS, CONTEXT_PLUGIN_ID_PREFIX, CONTEXT_PREVIEW_MAX_CHARS, estimateTokens, VERIFICATION_VERDICT_SCHEMA_GUIDE, COST_MAP_SWEEP_INTERVAL_MS, normalizeTodoStatus, BUILTIN_SLASH_COMMANDS,
  BRAIN_AXIS_IDS,
  BRAIN_CURATOR_PAGE_SIZE,
  BRAIN_TOPIC_MISC,
  buildBrainSkillsSection,
  buildBrainNudgeSection,
  resolveBrainProjectKey,
  type BrainActivation,
  type BrainAxisId,
} from '@vibisual/shared';
import type { HookEventPayload, WSMessage, SubAgentStreamEvent, QueuedCommand, SessionTokenData, PipelineType, AgentConfig, TaskEdge, TaskEdgeForwardMode, TaskEdgeKind, TaskEdgeMessageFormat, TaskEdgeReturnFormat, TaskEdgePriority, TaskEdgeCritiqueTiming, TaskEdgeCritiqueAuthority, TaskEdgeCommandMode, SubAgentHistoryItem, UiLocale, PermissionDecision, RulesHistoryEntry, Conti, CanvasClipboardPayload, CanvasPasteResponse, AskUserQuestionDecision, AskUserQuestionAnswer, AskUserQuestionOption, AskUserQuestionItem, AskUserQuestionToolInput, AgentReport, AgentQuestions, AgentQuestionItem, AgentReview, AgentList, AgentFeedback, AgentFeedbackTargetType, AgentFeedbackVerdict, BrainCard, BrainCardInput, BrainCardType, BrainCardScope, BrainInjectionEvent, ClaudeUsageInfo, ClaudeAuthStatus, VerificationVerdict, VerificationKind, VerificationAttempt, EscalationReason, AutoAgentRun, ShelfItemKind } from '@vibisual/shared';
import { LOCAL_MODEL_CATALOG_SORTS } from '@vibisual/shared';
// §4 (설정 3층) — 빠진 칸을 상수로 메우지 않기 위한 기준선(내장 + 설정 창).
import { resolveAgentDefaults } from '@vibisual/shared';
// §4 (첫 실행 온보딩) ③ — 폴더를 고르기 전 생성 요청을 서버도 같은 코드로 거절한다.
import { NO_PROJECT_FOLDER_ERROR } from '@vibisual/shared';
// §4 (CMD 터미널 업그레이드) — pane 트리 정합 + 임베디드 PTY 제어(⑤⑥).
import { sanitizeCmdPaneTree, CMD_CLI_KINDS, sanitizeSessionMemos } from '@vibisual/shared';
import type { CmdTerminalSignal, CmdCliKind } from '@vibisual/shared';
import { readCmdTerminal, sendCmdTerminal, waitCmdTerminal, getCmdTerminalController } from './services/cmdTerminalController.js';
// §7.10 — 워크트리 삭제 직전 회수(그 안에서 돌던 프로세스·에이전트).
import { reapWorktree, selectWorktreeAgents, EMPTY_REAP, type WorktreeReapResult } from './services/worktreeReaper.js';

/**
 * §4 (CMD ⑥ QA) — loopback 으로 들어온 termId 가 **우리가 발급하는 모양**인지 검사한다.
 * 임의 문자열을 그대로 받으면 오타 하나로 엉뚱한 터미널을 훑게 되고, 형식 밖 값이
 * PTY 맵의 키로 쓰이는 것 자체가 통제를 잃는 자리다. `term:<agentId>:<session>[#pane]` 과
 * 실행 런처(`run:<agentId>:<configId>`) 두 모양만 통과시킨다.
 */
function isCmdTermId(v: string): boolean {
  return /^(?:term|run):[\w.-]{1,64}:[\w.-]{1,64}(?:#[\w-]{1,32})?$/.test(v);
}
import { WORKSPACE_SITE_PATH, WORKSPACE_SITE_REWRITE_MAX_BYTES, workspaceSiteMime, workspaceSiteBase, parseWorkspaceSitePath, rewriteWorkspaceSiteHtml, rewriteWorkspaceSiteCss, injectWorkspaceSiteAgents, annotateWorkspaceSiteSource, workspaceSiteRewriteKind, WORKSPACE_IMAGE_MAX_BYTES, WORKSPACE_MEDIA_MAX_BYTES, workspaceMediaMime, BRAIN_INJECTION_TOP_K, BRAIN_INJECTION_TOKEN_BUDGET, BRAIN_FILE_WARN_ONCE_PER_SESSION, BRAIN_EXPERIENCE_TYPES, buildBrainRulesSection, buildBrainTopicIndexSection } from '@vibisual/shared';
// §3.2.3 보존 정책 — 상한·기본값은 shared 한 곳, 파일 정리·실측은 storageRetention.
import { RETENTION_LIMITS, DEFAULT_RETENTION_SETTINGS, BG_TASK_PROBE_LIMITS, BG_TASK_PROBE_MODELS, DEFAULT_BG_TASK_PROBE_SETTINGS, type BackgroundTaskProbeSettings } from '@vibisual/shared';
// §2.4 — 세션 생존 판정 설정(위 백그라운드 판정과 같은 계약).
import { SESSION_PROBE_LIMITS, SESSION_PROBE_MODELS, DEFAULT_SESSION_PROBE_SETTINGS, type SessionLivenessProbeSettings } from '@vibisual/shared';
// §5.13 (Q) 대본 → 콘티 → 렌더.
import { normalizeStoryboardPresetId, CONTI_SCRIPT_EXCERPT_MAX } from '@vibisual/shared';
import type { ContiRenderLink, ContiRenderStatus } from '@vibisual/shared';
import type { StorageCleanupResult, ProjectInfo } from '@vibisual/shared';
import { scanStorageUsage, runStorageCleanup, listTrash, restoreFromTrash } from './services/storageRetention.js';
// §5.5 #17-20 ⑥ v4.74 — MCP 프리셋 검증(모르는 id 는 설정에 남기지 않는다).
import { findMcpPreset, normalizeAgentProvider, normalizeAgentMemoryScope, normalizeSubagentDepth, normalizeBashTimeoutMs, AVAILABLE_SETTING_SOURCES, AVAILABLE_AUTOCOMPACT_VALUES } from '@vibisual/shared';
// §5.5 #17-20 ⑫ v4.94 — 디버그 포트 기본값(비어 있는 자리 찾기의 출발점)
import { DEBUG_PORT_BASE } from '@vibisual/shared';
import { REVIEW_FILES_MAX, REVIEW_DIFF_MAX_BYTES, REVIEW_REASON_MAX } from '@vibisual/shared';
import { serializeAppliesTo } from './services/brainCanonical.js';
// §5.5 #17-11 v3.79 — 세션 반복 실행(루프).
import type { SessionLoop, SessionLoopMode, SessionLoopContextMode, SessionGoalStatus, SessionGoalProgressSource, SessionGoalStepStatus } from '@vibisual/shared';
import { SESSION_LOOP_MAX_ITERATIONS, SESSION_LOOP_DEFAULT_TOTAL, SESSION_LOOP_DEFAULT_INTERVAL_MS, SESSION_LOOP_MAX_INTERVAL_MS, SESSION_LOOP_COMMAND_MAX, SESSION_LOOP_COMPACT_COMMAND, SESSION_LOOP_CLEAR_COMMAND, SESSION_LOOP_PATH_MAX, SESSION_LOOP_MAX_COST_USD_LIMIT, SESSION_LOOP_MAX_DURATION_LIMIT_MS, AGENT_COMPACT_COMMAND, buildAgentSelfCompactRule, shouldCompactAfterTurn } from '@vibisual/shared';
// §5.5 #17-11 ⑫(a)(g) — 루프 회차 프롬프트 합성(순수 모듈) + 누적 비용 추정(모델 레지스트리 가격).
import { composeLoopRoundText } from './services/sessionLoopPrompt.js';
// §5.5 #17-35 — 검증(Verify): 프롬프트 조립·판정 해석은 화면 없이 시험되는 순수 모듈에 있다.
import {
  buildVerifyPrompt,
  buildVerifyReworkPrompt,
  parseVerificationVerdict,
  recordedSkillRecipe,
  summarizePlayRecipe,
  NO_RECIPE,
} from './services/verificationPrompt.js';
import type { VerifyRecipeInfo } from './services/verificationPrompt.js';
import { calculateTokenCost, resolveAliasToLatest } from '@vibisual/shared';
// §5.5 #17-18 v4.68 — 덧말 처리 방식(대기/합치기/즉시).
import type { CommandDispatchMode } from '@vibisual/shared';
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
// §5.22 — 권한·감사 경계. 위험 판정은 shared 순수 함수 한 곳(서버·클라 같은 답).
import { shouldEscalateRisk, normalizeAuditBoundary } from '@vibisual/shared';
// §5.22 — 위험 판정은 호스트 값(플랫폼·홈)을 물린 이 창구 하나로. 승인 카드와 타임라인이 같은 답을 본다.
import { classifyToolRiskOnHost } from './services/auditLog.js';
import type { AuditDecisionSource, AuditBoundaryConfig } from '@vibisual/shared';
import { askUserQuestionBroker } from './services/askUserQuestionBroker.js';
import { AutoAgentRuntime } from './services/autoAgentRuntime.js';
import { BUBBLE_COLORS, READ_TOOLS, WS_BATCH_INTERVAL, WS_BATCH_INTERVAL_MAX, WS_BATCH_BACKOFF_FACTOR, CHECKPOINT_BATCH_INTERVAL, CHECKPOINT_BATCH_INTERVAL_MAX, CHECKPOINT_QUIET_SWEEP_MS, PROJECT_IDLE_UNLOAD_MS, PROJECT_IDLE_UNLOAD_SWEEP_MS, PROJECT_IDLE_UNLOAD_PRESSURE_MS } from '@vibisual/shared';
import { broadcast } from './broadcastBus.js';
import { graphManager } from './services/projectGraphManager.js';
import { modelRegistryService } from './services/modelRegistryService.js';
import { userDefaultsService } from './services/userDefaultsService.js';
import { brainActivationFor, brainAxisEnabledFor, brainEnabledFor } from './services/brainActivation.js';
import { getBrainSkillService } from './services/brainSkillService.js';
import { recallFromSessions } from './services/brainRecallService.js';
import { applyGrounding } from './services/brainGrounding.js';
import { claimNudgeSlot } from './services/brainNudge.js';
import { mountPluginRoutes, buildPluginPromptSection, buildPluginPromptSectionParts, getPluginFactsForProjects } from './services/pluginHost.js';
// §5.5 #17-28 — 컨텍스트 주입원: 계측(인벤토리) + 최종 게이트 + spawn 스위치.
import type { ContextInventory } from '@vibisual/shared';
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
// §5.11 v4.67 훅 세션 집행 판정 — 라우트 클로저 밖으로 빼 두어야 그 행동을 테스트가 잡는다.
import { buildHookEnforcementBlock as buildHookBlock } from './services/hookEnforcement.js';
import {
  recordInstructionsLoaded,
  getInstructionsLoaded,
  summarizeInstructionsLoaded,
} from './services/instructionsLoadedService.js';
import {
  recordSubagentStatusLine,
  getSubagentStatusLine,
  listSubagentStatusLines,
} from './services/subagentStatusLineService.js';
import { mountAppRoutes } from './services/appHost.js';
import { distillFeedbackToRules } from './services/feedbackDistillService.js';
import { getBrainService, sweepAllBrainStaleCards } from './services/brainService.js';
import { analyzeBrainMigration, applyBrainMigration } from './services/brainMigration.js';
import { scheduleBrainReflection, isBrainReflectionCwd } from './services/brainReflectionService.js';
import { isPortAlive, killByPort, respawn, setVibisualOwnPorts } from './services/processChecker.js';
// §5.14 v4.62 — 플레이 버블(이 프로젝트를 켜는 버튼).
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
// §5.5 #17-20 v4.74 — 디버그·실행 런처(실행 구성 스캔 + 외부 디버거 위임).
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
  type PluginMutationResult,
} from './services/claudePluginService.js';
import { attachDebuggerToEditor } from './services/unrealProjectService.js';
// §5.5 #17-20 ⑩ v4.94 — 공통 디버그 층(런타임 무관 중단점·스텝·변수)
import { debugSessionManager, findFreePort, type DebugControlAction } from './services/debug/debugSessionManager.js';
import { listDebugAdapters, findPidByCommandLine, commandFingerprint } from './services/debug/adapterProbe.js';
import { releaseWaitingNodeProcess } from './services/debug/cdpClient.js';
import { loadAppState, saveAppState, patchAppState, appStateAddOpenProject, appStateRemoveOpenProject, appStatePruneStaleProjectNames, appStateGetSkillOrder, appStateSetSkillOrder, appStateRemoveSkillFromOrder, appStateGetSkillFavorites, appStateSetSkillFavorites, appStateGetRetention, appStateSetRetention, appStateGetBgTaskProbe, appStateSetBgTaskProbe, appStateGetSessionProbe, appStateSetSessionProbe } from './services/appState.js';
import { ensureClaudeHooksInstalled } from './services/hookInstaller.js';
// §3.6 (판올림 번호 발급 대기) — 훅 이벤트 생명주기 분류(순수 모듈 + 단위 테스트).
//   라우트 안에 부등호로 흩어져 있으면 새 이벤트를 등록할 때마다 조용히 틀린다.
import {
  isTurnEndEventName,
  isSessionEndEvent,
  marksActivity,
  raisesAwaitingInput,
  clearsAwaitingInput,
  needsSnapshotRefresh,
  isTaskLedgerEvent,
} from './services/hookEventClass.js';
import {
  readUsageCollectorStatus,
  installStatusLine,
  uninstallStatusLine,
} from './services/statusLineInstaller.js';
import { buildClaudeUsage } from './services/claudeUsageService.js';
import { probeClaudeUsage, readCachedUsageSnapshot } from './services/claudeUsageProbe.js';
import type { UsageProbeFailure, UsageProbeSnapshot } from './services/claudeUsageProbe.js';
import { getMemoryDiagnostics, startMemoryMonitor, pressureLevelOf, sampleMemory } from './services/memoryMonitor.js';
import { claudeAuthService } from './services/claudeAuthService.js';
import { claudeSetupService } from './services/claudeSetupService.js';
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
import { cancelDownload, deleteModel, downloadModel, listDownloads, listModels, listRepoFiles, searchCatalog, setModelDownloadedHook } from './services/localModelService.js';
import { listLoadedModels, verifyModelOutput } from './services/localRunner.js';
import { getClaudeVersionInfo, getClaudeInstallsInfo, installLatestClaude, getInflightInstall, invalidateLatestCache, autoUpdateClaudeIfEnabled, onClaudeInstallSettled } from './services/claudeVersionService.js';
import { agentTracker, setSnapshotScheduler as setAgentTrackerSnapshotScheduler } from './services/agentTracker.js';
import { discoverSessions, findPidBySession, isProcessAlive, readContextInfo, readSessionTokenData, setLivenessProbeListener } from './services/sessionDiscovery.js';
import { SessionLifecycleManager } from './services/sessionLifecycle.js';
import { subAgentManager, recordCmdTermSession } from './services/subAgentManager.js';
// §5.5 #17-9 ⑦ — 자식 도구 한 줄 요약 · Task 결과 본문 추출(판본 흔들림을 흡수하는 순수 함수).
import { describeToolTarget, extractTaskResultText } from './services/subagentActivity.js';
import { reapOrphanedPidsFromPreviousRun, registerSpawnedPid, terminateChildTree, unregisterSpawnedPid } from './services/processTree.js';
import { validatePathWithinRoot } from './services/pathValidator.js';
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다(`shared/pathCase.ts`).
import { CASE_INSENSITIVE_FS, pathKey, samePath } from './services/pathKey.js';
import { openFile, openFileAtSearch, openFolder, openWithDefaultApp } from './services/editorLauncher.js';
// §5.13 (R-8) — 못 읽는 영상·소리를 우리 안에서 열기 위한 변환 레일.
import { detectMediaTools, installMediaTools } from './services/mediaTools.js';
import { mediaConvertService } from './services/mediaConvert.js';
import { iframeProxyHandler } from './services/iframeProxy.js';
import { gitStatusService, type WorktreeResolveInfo } from './services/gitStatusService.js';
import { generateContiFrames, generateContiFramesFromScript, patchContiElement, createEmptyConti, contiId, parseContiResponse, type ContiContextInput } from './services/contiManager.js';
import { logger } from './logger.js';
import { enableAsyncDiskWrites, flushPendingDiskWritesSync } from './services/diskWriteQueue.js';
import { CheckpointCoalescer, setActiveCheckpointCoalescer } from './services/checkpointCoalescer.js';
import { diagnosticService } from './services/diagnosticService.js';

// §5.10 Project Brain — 파일 접근 경고를 세션+파일 조합당 1회만 내기 위한 인메모리 집합.
//   런타임 전용(영속 X). O(1) 조회 — LLM/스캔 없이 hook 동기 경로에서 즉답.
const brainFileWarned = new Set<string>();
function normPathForWarn(p: string): string {
  // 경고 1회 판정 키 — linux 에서 접으면 `src/Foo.ts` 경고가 `src/foo.ts` 를 삼킨다.
  return pathKey(p);
}


// §3.7 — desktop in-process 진입점이 server 코어를 라이브러리로 쓰기 위한 re-export.
// `@vibisual/server` 단일 import 지점에서 코어 API를 모두 가져갈 수 있게 한다.
export { setBroadcastSink, broadcast, type BroadcastSink } from './broadcastBus.js';
// §9 — 체크포인트 디스크 쓰기 워커. desktop main 의 before-quit 가 남은 쓰기를 마무리하고 워커를 내린다.
export { shutdownDiskWriteQueue, flushPendingDiskWritesSync, getDiskWriteQueueStats } from './services/diskWriteQueue.js';
// §9 — 코얼레스된 체크포인트 창. desktop main 의 before-quit 가 디스크 큐를 내리기 **직전에**
// 이걸 불러 미저장분을 동기로 마무리한다(§3.2.1 내구성 — `app.exit(0)` 은 'exit' 를 안 돌린다).
export { flushPendingCheckpointSave, hasPendingCheckpointSave } from './services/checkpointCoalescer.js';
export {
  handleClientMessage,
  handleClientDisconnect,
  buildConnectionMessages,
  shutdownIframeLogStreamer,
  shutdownServerLogService,
  type ClientConnection,
} from './websocket.js';
// desktop in-process 모드는 hook 전용 loopback 리스너 포트로 직접 훅을 설치한다.
export { ensureClaudeHooksInstalled } from './services/hookInstaller.js';
// §4 v3.60 — 사용량 수집기(statusLine). desktop main 이 부팅 시 "이미 설치된 경우에만" 포트·토큰을 갱신한다.
export { refreshStatusLineIfInstalled } from './services/statusLineInstaller.js';
// §4 v1.98 — 진단 에러 로그: desktop main 이 자기 프로세스 에러를 recordDiagnostic 으로 적재.
export { recordDiagnostic, diagnosticService } from './services/diagnosticService.js';
// Persistent SubAgent child — desktop main 의 before-quit 핸들러가
// `subAgentManager.shutdownAllPersistentChildren()` 으로 long-lived claude 자식들을 깨끗이 종료.
export { subAgentManager, buildInteractiveClaudeArgs, buildInteractiveCliPrefill, parseCmdTermId, buildBashTimeoutEnv, prepareInteractiveRulesDir, recordCmdTermSession, getCmdResumeSession } from './services/subAgentManager.js';
// §5.11 v4.65 — CMD 세션에도 집행 플러그인의 지시를 싣는다(desktop 터미널 매니저가 rules 파일에 함께 기록).
export { buildInteractivePluginBlockForAgent } from './services/pluginHost.js';
// § 프로세스 트리 누수 — desktop 의 PTY(cmd.exe→claude) 종료 시 Windows 트리 전체를 회수하는 데 재사용.
export { killTree } from './services/processTree.js';
/**
 * desktop main 이 **직접** 띄우는 네이티브 대화상자·OS 알림의 언어. 렌더러의 i18next 는 main 에서
 * 못 쓰므로, 언어만 여기서 읽어 `main/strings.ts` 표에서 문구를 고른다(새 레일 ❌ — 이미 있는 값).
 */
export function getUiLocale(): UiLocale {
  return graphManager.getUiLocale();
}
/**
 * §5.5 #17-20 ⑩ v4.94 — 앱이 접힐 때 붙어 있던 디버그 세션을 정리한다.
 * 남겨 두면 어댑터 자식 프로세스와 소켓이 그대로 살아 다음 실행에서 포트를 물고 있다.
 */
export { debugSessionManager } from './services/debug/debugSessionManager.js';
// §3.5 v4.67 — 버블 생명주기 진단 로그 위치. 프로젝트 데이터가 아니라 앱 진단이므로 desktop main 이
// 부팅 시 userData/logs 로 고정한다(미주입 시 cwd 상대 폴백 — 서버 단독 실행 호환).
export { setDebugLogDir } from './services/debugLog.js';

// §5.5 #17-19 ⑦ — 탐색기 삭제가 쓸 **OS 휴지통** 통로. 세 OS 의 휴지통 규약이 전부 다르므로
// 이미 옳게 다루는 Electron `shell.trashItem` 을 desktop main 이 부팅 때 꽂는다(주입 없으면 영구 삭제).
export { setWorkspaceTrash, isWorkspaceTrashAvailable, type WorkspaceTrashItem } from './services/workspaceMutate.js';

// §5.14 v4.62 — 앱 종료 시 플레이 버블이 띄운 서버·정적 호스트 정리(main 이 before-quit 에서 호출).
export { stopAllPlays } from './services/playRunner.js';
// §5.19 — 앱 종료 시 로컬 엔진 자식(llama-server) 정리. 안 내리면 모델이 메모리를 물고 남는다.
export { unloadAllLocalModels } from './services/localRunner.js';
export { closeStaticHost } from './services/playStaticHost.js';
// §4 v2.63 — desktop main 의 임베디드 터미널 매니저가 인터랙티브 claude 를 스폰할 때
// 같은 바이너리(버전 체크/헤드리스 스폰과 동일 SSOT)를 쓰도록 경로 resolver 를 노출.
export { resolveClaudeBin, getClaudeBin, invalidateClaudeBinCache } from './services/claudeBin.js';

// §4 (CMD 터미널 업그레이드 ⑥) — 임베디드 PTY 제어 주입 지점. desktop main 이 terminalManager 를
// 이 인터페이스로 감싸 넣으면 loopback REST(`/api/cmd/*`)가 터미널을 읽고 prefill 할 수 있다.
export { setCmdTerminalController, getCmdTerminalController, readCmdTerminal, sendCmdTerminal, waitCmdTerminal, stripTerminalAnsi } from './services/cmdTerminalController.js';
export type { CmdTerminalController } from './services/cmdTerminalController.js';

// §3.7 v2.8 — hook loopback 리스너 포트. 통합(in-process) 모델에서 외부 `claude` 프로세스
// (hook curl·커스텀 위임 엣지 dispatch)가 in-process 서버에 닿는 유일한 네트워크 포트다.
// desktop main 이 startHookListener 직후 주입한다. 폐기된 서버-클라 모델엔 DEFAULT_PORT(4800)
// listen 소켓이 있었으나 in-process 모델에선 없어졌으므로, 위임 엣지 dispatch curl URL 은
// 반드시 이 리스너 포트를 써야 한다(`buildOutboundEdgesRulesSection` 참조).
let hookListenerPort: number | null = null;
export function setHookListenerPort(port: number): void {
  hookListenerPort = port;
  // §7.11 — 감지 폴백이 **우리 자신**을 "에이전트가 띄운 서버"로 오인하지 않게 알려 둔다.
  //   에이전트는 카드 엔드포인트를 `curl http://127.0.0.1:<이 포트>` 로 수시로 치므로, 걸러 두지
  //   않으면 세션마다 Vibisual 자신의 프리뷰 버블이 생긴다.
  setVibisualOwnPorts([port, DEFAULT_PORT]);
}

// §5.3 #10-2 v2.47 — loopback 리스너 per-launch 토큰. desktop main 의 hookToken 을 주입받아
// 하네스 빌더 rules 의 구축 curl 헤더(x-vibisual-hook-token)에 실어 보낸다(§3.7 v2.47).
let hookListenerToken: string | null = null;
export function setHookListenerToken(token: string): void {
  hookListenerToken = token;
}

/**
 * §4 (CMD 터미널 업그레이드 ④) — CMD 세션이 `blocked` 로 **전이할 때** 부를 알림 콜백.
 *
 * 실제 알림은 Electron `Notification` 이라 desktop main 만 띄울 수 있다(§3.4 — server 는
 * desktop 을 import 하지 않는다). `setBroadcastSink`·`setHookListenerToken` 과 같은 주입 방식이며,
 * 주입이 없으면(웹·테스트) 아무 일도 일어나지 않는다. 스팸 방지(백그라운드 여부·opt-out 판정)는
 * 창 포커스와 사용자 설정을 아는 main 쪽에서 한다.
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

// §4 v2.71 — hook 신원 파일(hook-listener.json)의 절대 경로(forward-slash 정규화). desktop main 이
// 주입한다. 카드 엔드포인트(작업 신고/질문/검수) curl 이 dispatch 시점 상수가 아니라 "호출 시점"에
// 이 파일에서 현재 포트·토큰을 읽도록 빌더에 넘긴다 → 재기동으로 포트가 바뀐 뒤 resume 으로 도는
// 옛 세션도 live 서버로 닿아 카드를 "또 못 받는" 일이 사라진다. 미주입(서버 단독 모드) 시 상수 폴백.
let hookListenerIdentityFile: string | null = null;
export function setHookListenerIdentityFile(filePath: string): void {
  hookListenerIdentityFile = filePath;
}

// §4 v3.60 — hooks/handler.mjs 절대 경로. desktop main 이 훅 설치와 같은 값을 주입한다.
// 사용량 수집기(statusLine)는 사용자가 팝업에서 켤 때 REST 로 설치되므로, 그 시점에
// 명령 문자열(`node <handlerPath> --statusline …`)을 조립할 핸들러 경로가 필요하다.
let hookHandlerPath: string | null = null;
export function setHookHandlerPath(filePath: string): void {
  hookHandlerPath = filePath;
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
   * §4 v1.49 — Notification 이벤트 서브타입 분류.
   *
   * Anthropic Agent SDK 2026-04~05 부터 `type` 필드(permission_prompt | idle_prompt |
   * auth_success | elicitation_dialog)가 명시적으로 들어오지만 구버전 페이로드는 `message`
   * 만 가질 수 있어 폴백 heuristic 으로 분류한다.
   *
   * - awaiting_permission: 도구 호출 권한 요청
   * - other:               분류 불가(또는 입력 대기) — 시각 상태 변경 없음
   *
   * v1.73 — `awaiting_input`(모래시계) 분류 제거. idle_prompt / 입력대기 메시지는 더 이상
   * 별도 시각 상태로 승격하지 않고 'other'(무시)로 떨군다. 데몬 단일-세션은 `--resume`
   * 으로 항상 이어지므로 "입력 대기" 모래시계가 오히려 연속성 끊김으로 보였다.
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
   * 3-Layer 세션 생명주기 매니저.
   * 정책: entrypoint(cli/vscode) 무관. 활성 판정은 OR 조건 —
   *   claude.exe가 매칭 PID로 실행 중이거나 세션 JSONL 파일이 잠겨 있으면 활성.
   *   둘 다 아니면 onDead로 즉시 제거. VSCode를 다시 열면 새 프로세스가 뜨고
   *   SessionStart 훅으로 재등록되므로 손실 없음.
   */
  const lifecycle = new SessionLifecycleManager({
    onDead: (sessionId) => {
      if (graphManager.removeAgentBySession(sessionId)) {
        broadcastSnapshot();
        saveCheckpoint();
      }
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
  // §5.11 v4.65 — 집행 플러그인이 무엇을 보고 판단했는지를 카드가 그릴 수 있게 스냅샷에 실어 보낸다.
  //   열려 있는 프로젝트만 묻고, 켠 집행 모듈이 없으면 undefined 라 필드 자체가 생기지 않는다.
  graphManager.setPluginFactsProvider(() => getPluginFactsForProjects(graphManager.getProjectRoots()));
  graphManager.setOnMutated(() => broadcastSnapshot());
  gitStatusService.setChangeListener(() => broadcastSnapshot());
  // §9 v3.45 — agentTracker 의 Stop/dismiss 스냅샷 송신도 디바운스 경로로 위임.
  setAgentTrackerSnapshotScheduler(() => broadcastSnapshot());

  // §4 v2.38 — 모델 레지스트리 부팅 시 비동기 refresh (시드는 이미 적재됨).
  // 완료/실패 무관, listener 가 WS 푸시 담당.
  modelRegistryService.refreshIfStale().catch((err) => {
    logger.warn(`[modelRegistry] refresh error: ${err instanceof Error ? err.message : String(err)}`);
  });
  modelRegistryService.subscribe((reg) => {
    broadcast({ type: 'model_registry_updated', timestamp: Date.now(), payload: reg });
    // 시드 → api-merged 전환 시 snapshot 의 modelRegistry 도 갱신해야 하므로 그래프 한 번 푸시.
    broadcastSnapshot();
  });

  // §4 v2.42 — 사용자 옵션 갱신 broadcast (다른 창/탭 즉시 반영)
  userDefaultsService.subscribe((d) => {
    broadcast({ type: 'user_defaults_updated', timestamp: Date.now(), payload: d });
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

  app.use(express.json());
  // Task Edge dispatch raw-text 경로용 — instruction 원문을 손escape 없이 stdin 으로 받기 위함.
  // express.json() 은 application/json 만, express.text() 는 text/* 만 처리 → 상호 간섭 없음.
  // (JSON 본문은 후방호환 유지, 신규 호출은 raw text + ?edgeId= 사용 — heredoc escape 실패 원천 차단)
  app.use(express.text({ type: ['text/*'], limit: '8mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // §4 v2.42 — 사용자 글로벌 옵션 (Options 창 SSOT)
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
      // §4 (첫 실행 설치 온보딩) — 실행본 override 가 바뀌면 캐시된 해석 결과를 버린다.
      //   v2.43 은 "선택은 다음 실행에 적용"이었지만, 이제 해석이 지연 캐시라 **즉시** 반영된다.
      if ('claudeBinPath' in patch) {
        invalidateClaudeBinCache();
        void claudeSetupService.refresh().catch(() => {});
      }
      res.json({ ok: true, userDefaults: next });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  // §5.11 v3.88 — 플러그인 기여 라우트 (`/api/plugins/*`). 코어가 아는 것은 이 한 줄뿐.
  mountPluginRoutes(app);

  // §5.13 (O) v4.48 — 내부 앱 라우트. 앱이 늘어도 코어가 아는 것은 이 한 줄뿐이다.
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
      // §4 (첫 실행 온보딩) — 고른 언어를 그 자리에서 디스크에 앉힌다. 예전에는 다음 저장 때까지
      //   메모리에만 있어, 온보딩 중에 고르고 앱이 죽으면 흔적 없이 사라졌다.
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
      // v1.77 (Direction A) — Vibisual 이 스폰한 sub(커스텀 에이전트 워커 등)의 SessionStart 는
      // 독립 훅 에이전트 버블로 등록하지 않는다. 그 세션의 활동은 명령 흐름을 통해 부모
      // 커스텀 버블에 귀속된다. 이 가드가 없으면 워커 세션이 "Continue from where you left.."
      // 훅 버블로 증식한다(사용자 보고 증상). 사용자 인터랙티브 세션은 managed 가 아니라 영향 없음.
      if (subAgentManager.isManagedSession(sessionId)) {
        res.json({ ok: true, managed: true, restored: 0 });
        return;
      }
      lifecycle.registerFromHook({ sessionId, pid, cwd });
      // AppState: hook 으로 처음 감지된 프로젝트도 openProjects 에 추가되도록 보장.
      // registerProject 는 idempotent — 이미 있으면 기존 인스턴스 반환, 새로 만들면 appStateAddOpenProject 트리거.
      // 이전엔 tool 이벤트(/api/hook-event) 가 오기 전까지 appState 에 기록되지 않아, SessionStart 만 발생하고 서버 재시작 시 사라지는 문제가 있었음.
      try { graphManager.registerProject(cwd); } catch (err) {
        logger.warn(`session-start: registerProject("${cwd}") failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      // v1.6 SCENARIO §5.7 #24: VSCode 재오픈 시 같은 cwd로 잠들어있던 에이전트 복원.
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

  /**
   * §5.11 v4.67 — 훅 세션에 실을 집행 블록.
   *
   * 판정 자체는 `services/hookEnforcement.ts` 에 있다 — 여기 클로저 안에 있던 동안에는 테스트가 닿지 못해
   * 배선 검사가 "소스에 이름이 있는가"만 보고 있었다(그 검사는 판정이 늘 빈 문자열이어도 초록이다).
   * 여기서는 그래프·호스트를 그 판정에 **연결만** 한다.
   */
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
       * §3.6 (판올림 번호 발급 대기) — **HTTP 훅으로 들어온 이벤트의 env 보강.**
       *
       * `handler.mjs` 는 `VIBISUAL_OWNER_AGENT_ID` 같은 env 를 읽어 본문에 실어 보냈지만,
       * HTTP 훅은 CLI 가 원문 JSON 을 그대로 POST 하므로 본문을 손댈 수 없다. 대신 헤더 값에
       * `$VAR` 를 쓸 수 있어 같은 값이 헤더로 온다 — 여기서 본문 필드로 되돌려, 아래 로직 전체가
       * 어느 경로로 들어왔는지 모른 채 종전 그대로 돌게 한다.
       *
       * 잡히지 않은 env 는 **빈 문자열**로 치환되므로 빈 값은 "없음"으로 읽는다(빈 문자열을 그대로
       * 실으면 소유자 조회가 빈 id 로 빗나가고, 그게 CMD 버블 귀속을 통째로 깬다).
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
      // §5.10 v3.76 — **우리가 띄운 리플렉션 자식(`claude -p`)의 훅은 통째로 무시한다.**
      // 자식은 전역 settings.json 의 Vibisual 훅을 그대로 실행하므로(SessionStart→Stop), 이 이벤트가
      // 서버로 들어오면 ① markActive/markStop 이 "전체 활성 세션 0" 전이를 만들어 클라 완료 차임이
      // 울리고 ② triggerBrainReflection 이 그 자식 세션을 다시 리플렉션 예약해 5분 40초 주기로 자기
      // 자신을 무한 재점화하며 ③ registerProject 가 임시 폴더를 유령 프로젝트로 등록해 기억 카드까지
      // 그쪽에 쌓였다(실측 51장). 자식 활동은 사용자 작업이 아니므로 그래프·상태 어디에도 넣지 않는다.
      if (isBrainReflectionCwd(body.cwd)) {
        res.json({ continue: true });
        return;
      }

      // §4 v2.64 — CMD(인터랙티브 터미널) 소유자 태그면 상태/그래프 귀속을 그 CMD 버블 세션으로
      //   일원화한다. 이후 markActive/markStop·Notification·processHookEvent 가 모두 CMD 버블을
      //   가리켜 별개 Hook 버블/오완료(recompute) 대신 Hook 에이전트와 동일한 라이프사이클
      //   (tool→active, Stop→completed→idle)을 탄다. lifecycle 만은 OS 세션 liveness 추적이라
      //   claude 원본 session(아래 claudeSessionId)을 그대로 쓴다(합성 custom 세션 미주입).
      const claudeSessionId = body.session_id;
      if (body._vibisualOwnerAgentId) {
        const ownerSession = graphManager.findSessionByAgentId(body._vibisualOwnerAgentId);
        if (ownerSession) body.session_id = ownerSession;
      }

      // 서브에이전트(Task/Agent 도구)가 끝날 때 오는 Stop 은 부모(감독관) 세션의 "자기 턴 종료"가
      // 아니다. Claude Code 는 서브 컨텍스트의 Stop 을 `SubagentStop` 으로 변환하며(또는 구버전은
      // `agent_id`/`parent_tool_use_id` 를 단 Stop 으로), 이 이벤트가 부모 CMD 버블 세션으로 귀속
      // (_vibisualOwnerAgentId rewrite)되면 아래 markStop / CMD 서브-도트가 부모를 서브 종료 시점에
      // 완료로 튕긴다(= 헤드리스 감독관 버블 조기 완료의 근본 원인). 서브 마커가 있으면 "부모 자기 종료"로
      // 취급하지 않는다.
      const isSubagentStop =
        body.hook_event_name === 'SubagentStop' ||
        typeof body.agent_id === 'string' ||
        typeof body.parent_tool_use_id === 'string';
      // §3.6 v4.89 — `StopFailure` 는 API 오류로 턴이 끝난 것이라 **종료의 일종**이다.
      //   분기에 안 넣으면 아래 `markActive` 로 떨어져 그 세션이 영영 active 로 남는다.
      const isTurnEndEvent = isTurnEndEventName(body.hook_event_name);
      /*
       * §3.6 (판올림 번호 발급 대기) — `SessionEnd` 는 **턴이 아니라 세션 자체**가 끝났다는 신고다.
       *
       * `StopFailure` 가 겪은 함정과 같은 자리다 — 등록만 하고 분기를 안 두면 아래 `markActive` 로
       * 떨어져 **방금 끝난 세션이 영영 도는 것처럼 보인다.** `/clear`·`/resume` 로 갈아탄 경우도
       * 그 대화는 끝난 것이므로 같게 취급한다(`reason` 은 표시용으로만 남는다).
       *
       * `isTurnEndEvent` 에는 넣지 않는다 — 그 변수는 아래에서 "서브에이전트 종료인가"를 가르는 데
       * 쓰이는데, 세션 종료는 서브 마커와 무관하게 언제나 부모의 끝이다.
       */
      const isSessionEnd = isSessionEndEvent(body.hook_event_name);
      // 부모(감독관) 세션의 자기 턴이 실제로 끝났는가 — 서브에이전트 종료는 제외.
      const isOwnStop = (isTurnEndEvent && !isSubagentStop) || isSessionEnd;
      // §5.3 #12-1 v3.43 — 헤드리스 감독관 배경 서브에이전트 대차대조.
      // 부모 턴이 끝나(sub idle) 자식 Task/Agent 서브에이전트만 백단에서 도는 동안, 부모 버블이
      // completed 로 강등되지 않게 pending 을 센다: PreToolUse(Task|Agent) ↑ / SubagentStop ↓ /
      // 그 외 이벤트는 quiet-window 신호 갱신. Vibisual 이 스폰한(managed) 세션·CMD 소유 세션만
      // 해석되므로 일반 훅 세션엔 소규모 역조회 스캔 외 비용이 없다.
      // 세션 탭(sub) 도트도 이 대차대조를 따라가야 한다 — 이 훅을 낸 세션의 sub 를 함께 해석해
      // 넘긴다(부모 버블만 active 이고 탭 도트는 녹색으로 어긋나던 버그).
      // §5.5 #17-9 ③(c) v4.95 — CMD(인터랙티브 터미널) 세션은 JSONL 파이프가 없어 `sub.sessionId` 가
      //   비어 있어 세션 조회가 늘 빗나갔다(= 그 탭이 띄운 서브에이전트가 소유 미상으로 남아 세션
      //   필터에 전부 걸러지던 원인). 훅이 이미 싣고 오는 termId(끝 토큰 = sub.id)로 폴백한다.
      const bgOwnerSub = subAgentManager.findSubBySessionId(claudeSessionId)
        ?? (body._vibisualOwnerTermId ? subAgentManager.findSubByTermId(body._vibisualOwnerTermId) : undefined);
      const bgOwnerAgentId = body._vibisualOwnerAgentId ?? bgOwnerSub?.parentAgentId;

      // §5.5 #17-32 ⑤ — 이 이벤트가 여기 도착했다는 것은 **같은 이벤트에 걸린 다른 훅들도 그
      //   순간에 함께 돌았다**는 뜻이다(우리 훅이 그들과 같은 자리에 걸려 있으므로 — 새 계측 ❌).
      //   어느 줄에 불이 켜질지는 화면이 `hookMatcherMatches` 로 고르므로 여기서는 이벤트·도구
      //   이름만 흘려보낸다. 짧은 창으로 모아 자체 메시지로만 나가고 graph_snapshot·체크포인트에는
      //   손대지 않는다(§9 v3.45 가 고친 그 폭주 경로 위라 이 규율이 곧 안전장치다).
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
          // §5.5 #17-9 v3.51 — "무슨 내용인지"를 IDE 에 띄우려면 대차대조 항목에 tool_input 메타를
          //   같이 실어야 한다. 판정 로직엔 관여하지 않는 표시 전용 필드.
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
          // §5.5 #17-9 v3.51 — 상태 변화가 없어도 실행 중 목록이 한 건 줄었으므로 항상 broadcast
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
          // 도구 이벤트는 아래 공통 경로가 어차피 코얼레스 broadcast 를 태우므로(§9 v3.45) 여기서
          // 따로 즉시 발사하지 않는다 — 자식 도구는 폭주 경로다.
          if (!changed) subAgentManager.noteSubagentSignal(bgOwnerAgentId);
        } else {
          subAgentManager.noteSubagentSignal(bgOwnerAgentId);
        }
      }

      // §5.5 #17-17 v4.50 ① — **세션이 세운 계획이 곧 목표 창이다.** 세션이 `TodoWrite` 로
      //   "이 일을 이렇게 하겠다"고 마음먹는 순간 목표 카드가 태어나고(문장 = 지금 수행 중인 명령,
      //   단계 = 그 계획), 이후 계획이 갱신될 때마다 체크리스트가 따라간다. 사용자가 목표를 미리
      //   적어 둘 필요가 없다 — 자동으로 나타나는 것이 이 기능의 핵심이다.
      //   §9 v3.45 — 훅 경로라 인라인 broadcast·동기 saveCheckpoint 를 하지 않는다. 아래 도구 이벤트
      //   공통 경로의 코얼레스 broadcast + scheduleCheckpoint 에 그대로 얹힌다(폭주 시 프리즈 차단).
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

      // §4 v2.64 — CMD 터미널 연속성: 이 인터랙티브 claude 대화의 sessionId(rewrite 전 원본)를
      //   termId 별로 기록해 둔다. 앱을 완전히 종료하면 PTY 는 죽지만, 재시작 후 같은 termId 로
      //   터미널을 다시 열 때 terminalManager 가 이 값으로 `claude --resume <id>` 를 prefill 한다.
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
        /*
         * §5.10 — 세션 종료 시 리플렉션 예약(디바운스, 실패해도 무시). managed/CMD/hook 세션 공통.
         *
         * `SessionEnd` 에서는 **예약하지 않는다** — 직전 `Stop` 이 이미 같은 세션을 예약했고,
         * 리플렉션은 매 예약마다 자식을 띄우는 축이라(자기증식 전례) 종료 한 번에 두 번 태울 이유가 없다.
         */
        if (!isSessionEnd) triggerBrainReflection(body.session_id, body.cwd);
      } else if (marksActivity(body.hook_event_name)) {
        agentTracker.markActive(body.session_id);
      }
      // sessionLifecycle에 활동 신호 전파 (PID는 여기서 알 수 없으므로 null)
      if (claudeSessionId && body.cwd) {
        lifecycle.registerFromToolUse(claudeSessionId, body.cwd, null);
      }

      // §4 v1.49 — Notification 서브타입 → 버블 시각 신호.
      // SDK 신규 `type` 필드 우선, 누락 시 message heuristic 폴백.
      // permission 차단 자체는 v1.43 PreToolUse 경로가 담당하므로 본 분기는 시각화 전용.
      if (body.hook_event_name === 'Notification') {
        const subtype = classifyNotification(body.type, body.message);
        if (subtype === 'awaiting_permission') {
          graphManager.setAgentNotificationStatus(body.session_id, subtype);
          broadcastSnapshot();
        }
      }

      // §4 v1.50 — PostToolUse `duration_ms` 캡처 (Anthropic SDK 2026-04 신규 필드).
      if (
        body.hook_event_name === 'PostToolUse'
        && typeof body.tool_name === 'string'
        && typeof body.duration_ms === 'number'
      ) {
        graphManager.recordToolDuration(body.session_id, body.tool_name, body.duration_ms);
        // broadcast 는 도구 이벤트 처리부에서 이미 일어나므로 별도 호출 불필요.
      }

      // §4 v1.50 — PreCompact 카운터 증가.
      if (body.hook_event_name === 'PreCompact') {
        graphManager.recordCompact(body.session_id);
        broadcastSnapshot();
        saveCheckpoint(); // compactCounts 는 영속화 대상
      }

      /*
       * §3.6 v4.89 — 신규 훅 3종의 표시 처리.
       *
       *  - `PermissionRequest` — 승인 대기를 버블에 띄운다. §5.3 #12-1 의 동기 `PreToolUse`
       *    게이트를 **대체하지 않는다**(그쪽이 실제 판정, 여기는 표시 전용). `Notification` 의
       *    `awaiting_permission` 과 같은 상태를 쓰므로 두 경로가 같은 그림을 그린다.
       *  - `PermissionDenied` — 거부로 대기가 풀렸다. 위 markActive 가 이미 상태를 되돌리므로
       *    여기서는 스냅샷만 밀어 화면이 대기 표시에 멈춰 있지 않게 한다.
       *  - `PostCompact` — 압축이 끝났다. 카운터는 PreCompact 가 이미 올렸으므로 재방송만.
       */
      /*
       * §3.6 (판올림 번호 발급 대기) — 신규 18종의 표시 처리.
       *
       * 판정은 `hookEventClass.ts` 가 갖는다(라우트 안에 부등호로 흩어져 있으면 새 이벤트를
       * 등록할 때마다 조용히 틀린다 — `StopFailure` 가 그렇게 샜다).
       *
       *  - `Elicitation`       — MCP 서버가 도구 실행 도중 사용자에게 되묻는 순간. 답이 오기 전까지
       *    세션이 멈춰 있는 것은 승인 대기와 같은 상태라 **같은 표시**를 쓴다(새 상태 ❌).
       *  - `ElicitationResult` — 답이 왔다. 위 markActive 가 상태를 되돌리므로 재방송만.
       *  - `PreModelSwitch` / `PostModelSwitch` / `WorktreeCreate` / `WorktreeRemove` /
       *    `ConfigChange` / `CwdChanged` / `DirectoryAdded` / `SessionEnd` — 버블에 적힌 내용이
       *    달라지는 사건이다. 종전에는 하나도 등록돼 있지 않아 화면이 **다음 도구 호출까지** 옛 값을
       *    보여 줬다. 스냅샷 방송은 이미 디바운스+적응 backoff 를 타므로 부담이 늘지 않는다.
       *  - `MessageDisplay` / `PostToolBatch` / `UserPromptExpansion` / `Setup` / `FileChanged` —
       *    별도 표시가 없다(앞의 셋은 활동 갱신으로 충분하고, `MessageDisplay`·`FileChanged` 는
       *    빈도가 높아 활동 갱신에서도 빠진다 — `hookEventClass` 주석 참고).
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
      // §3.6-1 v4.89 — 어떤 CLAUDE.md·rules 가 실제로 로드됐는지 계측(표시 전용, 영속화 ❌).
      if (body.hook_event_name === 'InstructionsLoaded') {
        recordInstructionsLoaded(body.session_id, body as unknown as Record<string, unknown>);
      }

      // 도구 사용 이벤트만 그래프 처리 (Notification/Stop은 상태 전환만)
      if (isToolEvent(body)) {
        const result = graphManager.processHookEvent(body);

        // PostToolUse Bash 후 파일 존재 확인 (삭제/rename 감지).
        // §9 v3.45 — Bash 폭주(전수조사) 시 전 노드 existsSync 스윕이 이벤트마다 돌지
        // 않도록 최소 간격 스로틀. miss 임계(FILE_EXISTENCE_MISS_THRESHOLD) 의미 불변.
        let ghosted = 0;
        let pruned = 0;
        if (
          body.hook_event_name === 'PostToolUse' && body.tool_name === 'Bash'
          && Date.now() - lastExistenceSweepAt >= EXISTENCE_SWEEP_MIN_INTERVAL_MS
        ) {
          lastExistenceSweepAt = Date.now();
          ghosted = graphManager.checkFileExistence();
          pruned = graphManager.pruneDisappearing();
        }

        // §9 v3.45 — 이 경로는 모델 도구 사용 빈도로 도착하는 유일한 폭주 경로.
        // 인라인 즉시 broadcast(getSnapshot()) 로 §9 디바운스를 우회하던 것을 디바운스
        // 경로로 통일하고, 체크포인트도 코얼레스 저장으로 묶는다(그 외 지점은 즉시 저장 유지).
        if (ghosted > 0 || pruned > 0 || result) {
          broadcastSnapshot();
        }
        scheduleCheckpoint();
      }

      /*
       * §5.11 v4.67 — **집행의 네 번째 주입 지점: 훅으로 붙은 외부 세션.**
       *
       * 그전까지 집행이 닿는 곳은 우리가 띄운 세션 셋뿐이었다(첫 스폰 `contextSummary` · 이어지는 턴
       * `livePreamble` · CMD `CLAUDE.md`). 그래서 사용자가 자기 에디터에서 직접 돌리는 Claude Code
       * 세션 — 이 앱이 **버블로 그리고 있는 바로 그 세션** — 에는 SSOT 규율이 한 글자도 안 갔다.
       * "우리 프로젝트에서 SSOT 가 훅으로 동작하냐"는 물음의 정직한 답이 "아니오"였던 이유다.
       *
       * 통로는 이미 있다. 훅은 매 프롬프트마다 여기로 오고, Claude Code 는 `UserPromptSubmit` 응답의
       * `additionalContext` 를 그 턴의 맥락에 넣어 준다(§5.10 파일 경고가 `PostToolUse` 에서 쓰는 것과
       * 같은 방식). 새 엔드포인트·새 리스너 경로를 만들지 않고 **이 응답 한 줄**로 닿는다.
       *
       * **우리가 띄운 세션에는 붙이지 않는다** — 그쪽은 프롬프트에 이미 실려 있어서, 여기서 또 주면
       * 같은 블록이 매 턴 두 번 실린다.
       */
      if (body.hook_event_name === 'UserPromptSubmit') {
        // §5.5 #17-28 — 이 줄도 주입원 창의 한 항목이다. 그 세션이 속한 프로젝트에서 껐으면
        //   여기서도 안 나간다("여기가 최종"이 우리가 띄운 세션에만 해당하면 반쪽짜리다).
        const hookAgent = graphManager.getAgentBySession(body.session_id);
        const hookProjectKey = hookAgent ? graphManager.getAgentProjectName(hookAgent.id) : null;
        const enforcement = isContextSourceOn(
          graphManager.getContextOverrides(),
          { projectKey: hookProjectKey, subAgentId: null },
          CONTEXT_SOURCE_IDS.hookEnforcement,
        )
          ? buildHookEnforcementBlock(body)
          : '';
        if (enforcement) {
          res.json({
            continue: true,
            hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: enforcement },
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
   * §4 v4.89 — `subagentStatusLine` 수집기 ingress.
   *
   * 핸들러가 `--subagent-statusline` 모드로 틱마다 보이는 서브에이전트 행 전체를 넘긴다.
   * 계측 전용이라 판정 로직은 이 값을 읽지 않으며, 응답도 화면에 영향을 주지 않는다.
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

  /** §4 v4.89 — 수집된 서브에이전트 행 조회(세션 지정 시 그 세션, 없으면 전체). */
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
   * §3.6-1 v4.89 — `InstructionsLoaded` 계측 조회.
   *
   * 세션을 지정하면 그 세션의 로드 기록(오래된 것부터), 없으면 전체 요약.
   * 계측·표시 전용이라 어떤 판정 로직도 이 값을 읽지 않는다.
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
   * §4 v1.50 — Claude.ai 한도 사용률 푸시.
   * 외부 statusline 스크립트(또는 사용자 자체 도구)가 5h/7d 윈도우 사용률을 보고한다.
   * 한도는 사용자 단위라 프로젝트 무관 글로벌 1건만 보관.
   *
   * Body: { used5h?: number; resetAt5h?: number; used7d?: number; resetAt7d?: number }
   *  - used5h / used7d: **퍼센트(0~100)**. v3.64 이전엔 "0~1 이면 비율" 도 받아 클라이언트가
   *    추측 정규화했으나, 그 추측이 `1`(=1%)을 100% 로 부풀려 표시하는 사고를 냈다. 값 1 은
   *    두 해석 모두 가능해 추측으로 풀 수 없으므로 단위를 퍼센트로 고정한다.
   *  - resetAt*: 한도 리셋 epoch ms.
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
      // §4 v3.60 — statusLine 은 렌더마다(최대 300ms 주기) 돌 수 있다. 값이 실제로 바뀐
      // 경우에만 브로드캐스트해 전체 스냅샷이 초당 여러 번 나가는 것을 막는다(핸들러 측
      // 전송 스로틀과 2중 방어). updatedAt 만 갱신되는 경우는 조용히 흡수.
      const before = graphManager.getRateLimits();
      const changed = (['used5h', 'resetAt5h', 'used7d', 'resetAt7d'] as const).some(
        (k) => payload[k] !== undefined && payload[k] !== before?.[k],
      );
      graphManager.setRateLimits(payload);
      // statusLine 이 원천이므로, 값이 바뀌면 표시용 사용량도 그 자리에서 다시 만든다
      // (안에서 broadcastSnapshot 을 부르므로 여기서 또 부르지 않는다).
      if (changed) refreshClaudeUsage();
      res.json({ ok: true, changed });
    } catch (err) {
      logger.error('POST /api/rate-limits failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §4 v3.60 — 사용량 수집기(statusLine) 상태 조회 / opt-in 토글.
   *
   * 한도 사용률은 Claude Code 의 statusLine stdin JSON 으로만 나오므로, 위 `/api/rate-limits`
   * 를 채우려면 `~/.claude/settings.json` 의 `statusLine` 에 우리 핸들러가 걸려 있어야 한다.
   * 훅(§3.6)과 달리 **자동 설치하지 않는다** — 사용량 팝업의 스위치로만 켜고 끈다.
   *
   * GET  → UsageCollectorStatus
   * POST { enable: boolean } → 설치/해제 후 UsageCollectorStatus
   */
  /**
   * §4 v3.62 — Claude 사용량 직접 조회(Claude 앱 `/usage` 와 같은 원천).
   *
   * GET  → 캐시된 값 즉시 반환(없으면 그 자리에서 1회 조회).
   * POST → 강제 재조회(팝업의 새로고침 버튼).
   *
   * 값은 `GraphSnapshot.claudeUsage` 로도 흘러가므로 클라이언트는 평소 스냅샷만 봐도 된다.
   * 여기서 받은 세션/주간 창은 §4 v1.50 `rateLimits` 에도 미러링해 DetailPanel 루트 게이지가
   * statusLine 없이도 채워지게 한다.
   */
  /**
   * §4 v3.63 — 한도가 리셋되는 순간을 노려 한 번 더 받아온다.
   *
   * 5분 폴링만 두면 "시간이 지나 초기화됐는데 화면은 아직 100%" 구간이 최대 5분 생기고,
   * 폴링이 어떤 이유로 멈추면 영구히 남는다. 가장 이른 리셋 시각 + 10초에 일회성 타이머를
   * 걸어 그 순간 바로 새 값을 집는다(리셋 후에는 서버가 새 창의 값을 주므로 0% 로 떨어진다).
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
   * statusLine 이 보고한 창(`rateLimits`)에서 표시용 사용량을 다시 만든다.
   *
   * 네트워크 호출은 없다 — `rateLimits` 가 갱신됐을 때(그리고 리셋 시각이 지났을 때) 다시
   * 부르면 되는 순수 파생이다. 그래서 `Promise` 도 필요 없지만, 호출부가 여럿이라 반환값만
   * 돌려주고 호출부의 `void`·`await` 는 그대로 둔다.
   */
  /**
   * §4 — `/usage` probe 로 받아 둔 마지막 스냅샷과 그 실패 사유.
   *
   * 부팅 직후에는 CLI 를 돌리기 전에 **이미 디스크에 있는 캐시**(직전 실행분)를 먼저 집어
   * 넣는다 — 그래야 앱을 켜자마자 헤더 필이 값을 들고 뜬다(probe 결과는 몇 초 뒤 덮어쓴다).
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

  app.get('/api/claude-usage', (_req, res) => {
    const cached = graphManager.getClaudeUsage();
    res.json(cached ?? refreshClaudeUsage());
  });

  app.post('/api/claude-usage/refresh', (_req, res) => {
    void probeAndRefreshClaudeUsage()
      .then((info) => res.json(info))
      .catch(() => res.json(refreshClaudeUsage()));
  });

  // 부팅 직후 1회 + 주기 probe + 리셋 시각 일회성(scheduleResetRefresh).
  // probe 는 `claude -p "/usage"` 1회 실행이고 모델 호출이 0턴이라 과금이 없다(실측).
  // statusLine 이 켜져 있으면 `POST /api/rate-limits` 가 그 사이사이를 더 촘촘히 메운다.
  setTimeout(() => { void probeAndRefreshClaudeUsage(); }, 2_000);
  setInterval(() => { void probeAndRefreshClaudeUsage(); }, CLAUDE_USAGE_POLL_INTERVAL_MS);

  /**
   * §4 v4.82 — 앱 안 Claude 로그인.
   *
   * 상태 판정·로그아웃은 서버가 CLI(`claude auth …`)에 위임하고, 로그인 자체는 브라우저 왕복이
   * 필요해 임베디드 PTY(desktop terminalManager)에서 돈다 — 이 REST 는 그 성패를 확인하는 창구다.
   * 값은 `GraphSnapshot.claudeAuth` 로도 흘러가므로 클라는 평소 스냅샷만 봐도 된다.
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
  setTimeout(() => { void refreshClaudeAuth().catch(() => {}); }, 1_500);
  setInterval(
    () => { void refreshClaudeAuth().catch(() => {}); },
    CLAUDE_AUTH_POLL_INTERVAL_MS,
  );

  /**
   * §4 (첫 실행 설치 온보딩) — `claude` CLI 자체가 없는 사람을 위한 설치 창구.
   *
   * 로그인(위)보다 **한 단계 앞**이다: CLI 가 없으면 `claude auth status` 는 spawn 실패라
   * 로그인 팝업이 뜨지 않도록 설계돼 있어(§4 v4.82 — 판정 불가는 모달로 막지 않는다) 사용자가
   * 아무 신호도 못 받는 구멍이 있었다. 여기서 "없다"를 1급 상태로 세워 게이트가 뜨게 한다.
   * 값은 `GraphSnapshot.claudeSetup` 으로도 흘러가므로 클라는 평소 스냅샷만 봐도 된다.
   */
  claudeSetupService.onChange((state) => {
    graphManager.setClaudeSetup(state);
    broadcastSnapshot();
    // 없다 → 쓸 수 있다 로 **바뀐** 순간이 온보딩 사슬의 이음매다. 이때 CLI 파생 캐시를 다시
    // 태우지 않으면 방금 설치한 사용자가 다음 실행 전까지 로그인 창도 못 본다(아래 함수 주석 참고).
    //
    // ⚠ 첫 판정(`lastSetupPhase === null`)은 **전이가 아니라 기준점**이다. 이미 CLI 가 깔린
    //   사용자는 부팅 첫 판정이 곧바로 'ready' 라, 이걸 전이로 세면 **모든 실행마다** 부팅 직후
    //   캐시를 한 번 더 태우게 된다(`claude --help` 재스캔 + auth 재조회 + 명령 재스캔 = 헛일).
    const isFirstJudgement = lastSetupPhase === null;
    const becameReady = !isFirstJudgement && lastSetupPhase !== 'ready' && state.phase === 'ready';
    lastSetupPhase = state.phase;
    if (becameReady) void reprimeClaudeDerivedCaches('setup-ready');
  });

  /**
   * §4 (첫 실행 설치 온보딩 / CLI 자동 업데이트) — **CLI 에서 파생된 캐시를 다시 태운다.**
   *
   * 아래 셋은 모두 "부팅 시 1회" 전제로 만들어졌는데, 이제 앱을 켠 뒤에 CLI 가 **새로 깔리거나
   * 최신으로 바뀌는** 경로가 생겨 그 전제가 깨졌다. 다시 태우지 않으면 이렇게 끊긴다:
   *  · `claudeAuth` — `claude auth status` 는 spawn 실패 시 `error: 'cli-missing'` 로 캐시되고
   *    재조회는 10분 주기다. 그런데 `LoginWindow` 는 `error` 가 있으면 뜨지 않으므로(§4 v4.82),
   *    **설치를 끝내도 로그인 창이 최대 10분간 안 뜬다** — 사슬이 여기서 끊긴다.
   *  · `modelRegistry` — 모델 목록과 effort 등급을 `claude --help` 에서 긁어 오므로
   *    CLI 가 없던 부팅에서는 시드만 남는다(설정창 드롭다운이 빈약해진다).
   *
   * (슬래시 내장 명령은 이제 공개 문서 기반 정적 목록 `BUILTIN_SLASH_COMMANDS` 라 CLI 설치
   *  여부와 무관하다 — 다시 태울 것이 없다.)
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
   * §3.6 (판올림 번호 발급 대기) — **훅 전송 경로를 HTTP 로 승격한다.**
   *
   * 부팅 최초 설치(desktop main)는 설치본 판올림을 아직 모른다. 모르는 채로 HTTP 훅을 깔면,
   * 그 `type` 을 모르는 옛 CLI 가 훅을 통째로 버려 **이벤트가 0건**이 될 수 있다 — 화면에서는
   * 앱이 죽은 것과 구별되지 않는다. 그래서 최초 설치는 종전 그대로 command 로 깔고, 판올림을
   * 확인한 뒤 여기서 다시 부른다(인스톨러는 idempotent 라 바뀔 게 없으면 파일도 안 쓴다).
   *
   * 승격되면 순수 전달 이벤트에서 `handler.mjs` 자식 프로세스가 사라진다 — 이벤트를 15종에서
   * 33종으로 늘린 지금 그 차이가 크다.
   */
  async function refreshHookTransport(reason: string): Promise<void> {
    const skip = process.env['VIBISUAL_SKIP_HOOK_INSTALL'];
    if (skip === '1' || skip === 'true') return;
    if (process.env['VIBISUAL_HOME']?.trim()) return;
    if (hookListenerPort === null || hookListenerToken === null || hookHandlerPath === null) return;
    try {
      const info = await getClaudeVersionInfo();
      const r = ensureClaudeHooksInstalled(hookListenerPort, hookHandlerPath, hookListenerToken, {
        transport: 'http',
        cliVersion: info.current,
      });
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
  setTimeout(() => { void refreshHookTransport('boot'); }, HOOK_TRANSPORT_REFRESH_DELAY_MS);

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
  setTimeout(() => { void claudeSetupService.refresh().catch(() => {}); }, 1_200);

  /**
   * §4 (Claude Code CLI 자동 업데이트) — 앱을 켤 때 1회 CLI 를 최신으로 맞춘다(기본 켬).
   * 설치·로그인 판정보다 뒤에 둔다 — 안 깔린 사람은 설치 온보딩이 먼저 맡아야 하고, 갓 설치한
   * 실행본은 이미 최신이라 곧바로 갱신할 이유가 없다. 실패해도 기동엔 무관.
   * ⚠ §4 v2.44 **앱** 자동 업데이트(electron-updater)와는 별개 축 — 그쪽은 종전 그대로 항상 자동.
   */
  setTimeout(() => {
    void autoUpdateClaudeIfEnabled()
      .then((r) => {
        if (!r.started && r.reason && r.reason !== 'up-to-date') {
          logger.info(`[claudeVersionService] auto-update skipped (${r.reason})`);
        }
      })
      .catch(() => {});
  }, CLAUDE_AUTO_UPDATE_BOOT_DELAY_MS);

  /**
   * §3.2.4 H축 — 힙 표본 + 캐시 점유 진단.
   *
   * 이 창구가 없어서 3GB 진단을 프로세스 I/O 카운터와 소거법으로 해야 했다. 읽기 전용이고
   * 부작용이 없으므로 언제 불러도 안전하다.
   */
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
        res.json(uninstallStatusLine());
        return;
      }
      if (hookListenerPort === null || hookListenerToken === null || hookHandlerPath === null) {
        res.status(503).json({
          error: 'Hook listener is not ready yet — statusLine cannot be installed',
        });
        return;
      }
      res.json(installStatusLine(hookListenerPort, hookHandlerPath, hookListenerToken));
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
      // §7.11 v2.4 — 죽은 ServerEntry 를 즉시 제거하지 않는다. iframe 위성이 살아 있는
      // 동안(고정핀 / grace 이내) 매칭 entry 가 남아야 IframeServerCard 의 Start/Restart
      // 가 동작한다. 정리는 위성 grace 제거(checkIframesAlive)가 위성과 함께 수행.
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();
      res.json({ servers: graphManager.getRunningServers() });
    } catch (err) {
      logger.error('POST /api/refresh-servers failed', err);
      res.status(500).json({ error: 'Internal server error' });
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
      const killed = await killByPort(target.port);
      target.alive = false;
      // §7.11 v1.29 — 매칭 iframe 위성 iframeAlive=false 즉시 반영 (5초 스윕 대기 없이 active→idle 전환)
      graphManager.markIframeStoppedByServerId(id);
      // §7.11 v2.4 — removeDeadServers 제거: 죽은 entry 는 iframe 위성(고정핀/grace)이
      // 살아 있는 한 보존해야 Start/Restart 버튼의 serverId 매칭이 동작한다.
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
      // §7.11 v3.85 — 에이전트 신고로만 알게 된 서버는 기동 명령을 모른다. 여기서 kill 부터 하면
      // respawn 이 불가능해 사용자의 서버만 죽는다 — kill 없이 거절한다(클라도 버튼 disabled).
      if (target.reportedOnly) {
        res.status(409).json({ error: 'command unknown (agent-reported server)' });
        return;
      }
      // kill
      if (target.port) await killByPort(target.port);
      // §7.11 v2.22 — owning session 의 cwd 로 respawn. 누락 시 명령이 의존하는 파일/스크립트
      // (`node my-server.js` 등)을 못 찾고 즉시 종료된다. windowsHide 는 respawn 내부에서 처리.
      const owner = graphManager.findServerOwnerSession(id);
      respawn(target.command, owner?.cwd);
      target.startedAt = Date.now();
      target.alive = true;
      // §7.11 v2.23 — respawn 직후 매칭 iframe 위성의 owning-shell 분리. Vibisual detached child 는
      // Claude JSONL 에 active 로 기록 안 돼 v1.48 검사가 영원히 false → 포트가 살아도 idle 고정.
      graphManager.noteIframeRespawnedByServerId(id);
      logger.info(`Restart server port=${target.port ?? '?'} cwd="${owner?.cwd ?? '(default)'}" cmd="${target.command}"`);
      broadcast({ type: 'graph_snapshot', timestamp: Date.now(), payload: graphManager.getBroadcastSnapshot() });
      saveCheckpoint();

      // §7.11 v2.22 — 5초 정기 sweep 외에 빠른 수렴: 0.5s / 1.5s / 3s 에 추가 probe.
      // respawn 된 서버가 부팅해 listen 시점이 임의 (Vite ~1s, python http.server 즉시,
      // node 무거운 의존성 2-3s) 인 점 cover. fire-and-forget — 응답 지연 방지.
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
   * 열기 계열 엔드포인트 공용 경계 검사 — resolved 절대경로가 등록된 프로젝트 루트(또는
   * extraRoots 로 명시 허용한 디렉토리) 내부인지 확인한다. 로컬 IPC(renderer)는 신뢰되지만,
   * opt-in 모바일 리스너로 페어링된 기기도 이 라우트에 도달하므로 임의 절대경로가 에디터·
   * 탐색기로 열리는 것을 막기 위한 방어선이다(§ open-in-editor 의 기존 가드를 형제 라우트에 통일).
   * Windows 는 대소문자 무시 비교.
   */
  function isWithinOpenableRoots(resolved: string, extraRoots: string[] = []): boolean {
    const roots: string[] = [];
    for (const r of extraRoots) roots.push(path.resolve(r));
    const primaryRoot = graphManager.getRoot();
    if (primaryRoot) roots.push(path.resolve(primaryRoot));
    for (const proj of Object.values(graphManager.getProjects())) {
      roots.push(path.resolve(proj.path));
    }
    // 대소문자는 그 플랫폼이 실제로 무시할 때만 접는다 — 예전에는 win32 만 봐서 mac(APFS)에서
    // 같은 폴더가 다른 경로로 읽혀 열기가 거절됐고, linux 에서는 남의 폴더가 통과할 수 있었다.
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

      // 프로젝트 루트 내부이거나, 루트 밖이라도 **지금 버블로 그리고 있는 노드의 경로**면 허용.
      // (§2.1 #5 v1.55 — 외부 파일 클릭 시 IDE 열기. external_folder/그 위성은 정의상 루트 밖이라
      //  루트 경계만 보는 가드로는 늘 403 이었다.) 화면에 없는 임의 절대경로는 여전히 차단 —
      //  페어링된 모바일 기기도 이 라우트에 닿는다.
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

  /** POST /api/open-node-folder — 노드 키로 상위 폴더 열기 (탐색기).
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

      // 프로젝트 루트 내부이거나, 루트 밖이라도 **지금 버블로 그리고 있는 노드의 경로**면 허용.
      // (§2.1 #5 v1.55 — 외부 폴더 클릭 시 OS 탐색기에서 그 절대경로 열기.) 화면에 없는 임의
      // 절대경로는 여전히 차단 — 페어링된 모바일 기기도 이 라우트에 닿는다.
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
   * §3.2.3 — 완료 명령(사용자 말풍선)을 아카이브에 넣는 **유일한 창구**.
   *
   * 종전엔 세 곳에서 각자 `archive.push(...)` 했고 **상한 검사가 어디에도 없었다**(주석도
   * "체크포인트에 사실상 무제한"이라 인정). IDE 스트림 복원이 2,000 이벤트인데 말풍선만
   * 무제한이라 짝이 맞지 않던 자리다. 넘치면 오래된 것부터(배열 앞) 버린다 — 설정값 `0` 이면 무제한.
   */
  function archiveCompletedCommands(sessionId: string, cmds: QueuedCommand[]): void {
    if (cmds.length === 0) return;
    let archive = completedCommandArchive.get(sessionId);
    if (!archive) { archive = []; completedCommandArchive.set(sessionId, archive); }
    archive.push(...cmds);
    const cap = appStateGetRetention().completedCommandMaxPerSession;
    if (cap > 0 && archive.length > cap) archive.splice(0, archive.length - cap);
  }

  /** sessionId → 최근 pop된 명령 메타 (buildAgentEvents에서 source 매칭용) */
  interface PoppedCommand { text: string; queuedAt: number; poppedAt: number }
  const poppedCommands = new Map<string, PoppedCommand[]>();


  // ─── SubAgent 명령 실행 ───

  /** v1.38 — 엣지의 타겟이 실제로 위임 수행이 가능한지 판정.
   *  명시적으로 저장된 `AgentConfig.tools === []` 는 "모든 도구 제거" → skip 대상.
   *  cfg 자체가 undefined(한 번도 저장 안 됨)이면 CLI 기본 툴셋 상속이라 skip 아님. */
  function isEdgeTargetViable(edgeTargetAgentId: string): boolean {
    const cfg = graphManager.getAgentConfig(edgeTargetAgentId);
    if (cfg && cfg.tools.length === 0) return false;
    return true;
  }

  /** v1.33 — outbound Task Edge 자동 rules 섹션. subagent 스폰 직전에 호출되어 런타임 조회로
   *  해당 agent 의 primary(outbound) 엣지 목록을 markdown 블록으로 조립. 엣지 0개면 빈 문자열.
   *  엣지 변경은 이 함수가 다음 호출에서 자동 반영 — 별도 파일/cleanup 불필요.
   *  v1.38 — 타겟 도구가 빈 배열인 엣지는 viability 필터로 제외(프롬프트 정책 소실 == 삭제와 동등). */
  function buildOutboundEdgesRulesSection(agentId: string): string {
    const allOutbound = graphManager.getOutboundTaskEdges(agentId);
    const outbound = allOutbound.filter((e) => isEdgeTargetViable(e.targetAgentId));
    if (outbound.length === 0) return '';
    const allAgents = graphManager.getSnapshot().agents;
    // §3.7 v2.8 — dispatch curl 은 소스 커스텀 에이전트(외부 `claude` 프로세스)가 실행한다.
    // 외부 프로세스는 renderer↔server IPC 를 못 쓰므로 in-process 서버에 닿으려면 hook
    // loopback 리스너를 거쳐야 한다. 폐기된 서버-클라 모델의 DEFAULT_PORT(4800)를 쓰면
    // listen 소켓이 없어 connection refused — desktop main 이 setHookListenerPort()로
    // 주입한 동적 포트를 쓴다. (미주입 시 port 폴백 — 통합 모델에선 부팅 시 항상 주입됨.)
    const serverBase = `http://127.0.0.1:${hookListenerPort ?? port}`;

    // v1.33 — 엣지별 policy. 같은 소스라도 엣지마다 다른 policy 가능. 엣지 목록에 각각 Policy 태그 표시.
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
      `curl -s -X POST '${serverBase}/api/task-edges/dispatch?edgeId=<id>' \\`,
      '  -H \'Content-Type: text/plain; charset=utf-8\' \\',
      '  --data-binary @- <<\'VIBISUAL_EDGE_PAYLOAD_EOF\'',
      '<instruction 전문 — 그대로 붙여넣기, JSON·쉘 escape 불필요, 여러 줄 OK>',
      'VIBISUAL_EDGE_PAYLOAD_EOF',
      '```',
      '',
      '주의: `<id>` 자리에 아래 목록의 edgeId 를 그대로 넣는다(URL-safe, 인코딩 불필요). delimiter 는 싱글쿼트로 감싼 `<<\'VIBISUAL_EDGE_PAYLOAD_EOF\'` 형태 유지(쉘 변수·백틱 치환 차단). instruction 본문에 `VIBISUAL_EDGE_PAYLOAD_EOF` 가 한 줄로 등장할 가능성이 있으면 delimiter 만 다른 이름으로 변경. (기존 `{"edgeId":..,"instruction":..}` JSON 본문 방식도 서버가 후방호환 수용하지만, 신규 호출은 escape 불가능한 위 raw 방식만 쓴다.)',
      '',
      '## 엣지 목록',
    ];
    for (const edge of outbound) {
      const target = allAgents.find((a) => a.id === edge.targetAgentId);
      const cfg = graphManager.getAgentConfig(edge.targetAgentId);
      const targetLabel = target?.label ?? edge.targetAgentId;
      const modelStr = cfg?.model ?? 'unknown';
      const toolsStr = cfg?.tools && cfg.tools.length > 0 ? cfg.tools.join(', ') : 'default';
      const returnFmt = edge.returnFormat ?? 'summary';
      const policy = edge.delegationPolicy ?? 'strict';
      const policyBadge = policy === 'strict' ? '**[Policy=STRICT — 의무 위임]**' : '**[Policy=AUTO — 판단 위임]**';
      // v1.44 — commandMode (kind='command' 한정) 안내. mode-delegation 의 경우 LLM 이 도구는 가지고 있어도
      //         "이 작업은 반드시 위임" 임을 인지하도록 명시. tool-delegation 은 strip 으로 자연 강제되지만
      //         프롬프트에도 표시해 일관성 유지.
      const kind = edge.kind ?? 'command';
      const cmdMode = kind === 'command' ? (edge.commandMode ?? (policy === 'strict' ? 'tool-delegation' : 'shared')) : null;
      const cmdModeBadge = cmdMode === 'tool-delegation'
        ? '**[Mode=TOOL-DELEGATION — 부모에서 도구 박탈됨, dispatch 만 가능]**'
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
      // v1.48 — messageSchema 가 비어있지 않으면 발신 본문(instruction) 포맷을 강제. messageFormat='free' 거나 빈 값이면 생략.
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

  /** v1.37 — STRICT outbound 엣지 기반 tools strip set 계산.
   *  - outbound 중 박탈 모드인 엣지의 각 타겟 agentConfig.tools 를 합집합
   *  - 엣지 삭제/모드 전환 시 다음 호출에서 자동 축소/소멸 (매 턴 재계산)
   *  - 박탈 모드가 아닌 엣지는 도구 변경 없음 (프롬프트 권고만)
   *  - 툴 구성은 사용자 책임 (Bash 포함 특수 보호 없음).
   *  v1.38 — 타겟 tools 가 빈 배열인 엣지는 viability 필터로 skip.
   *  v1.44 — `commandMode` 도입. 박탈 조건을 `delegationPolicy === 'strict'` 단일 축에서
   *          `commandMode === 'tool-delegation'` 으로 이동. 후방호환:
   *          - kind !== 'command' (artifact/request/critique): 박탈 ❌
   *          - commandMode === 'tool-delegation': 박탈 ✅
   *          - commandMode === 'shared' | 'mode-delegation': 박탈 ❌
   *          - commandMode === undefined (기존 엣지): delegationPolicy === 'strict' 일 때만 박탈
   *            (= v1.37~v1.43 거동 그대로 보존). 신규 엣지는 기본 'shared' 라 박탈 안 됨. */
  function computeStrictStripSet(agentId: string): Set<string> {
    const outbound = graphManager.getOutboundTaskEdges(agentId);
    const stripping = outbound.filter((e) => {
      if (!isEdgeTargetViable(e.targetAgentId)) return false;
      if ((e.kind ?? 'command') !== 'command') return false;
      if (e.commandMode !== undefined) return e.commandMode === 'tool-delegation';
      // Legacy fallback: undefined commandMode + strict policy = pre-v1.44 strip behavior.
      return (e.delegationPolicy ?? 'strict') === 'strict';
    });
    if (stripping.length === 0) return new Set();
    const strip = new Set<string>();
    for (const edge of stripping) {
      const cfg = graphManager.getAgentConfig(edge.targetAgentId);
      const tools = cfg?.tools ?? [];
      for (const t of tools) strip.add(t);
    }
    return strip;
  }

  /**
   * §5.10 v3.74 스폰 브리핑용 기억 블록 조립 — **프로젝트 카드를 전량 밀어넣지 않는다.**
   *
   * 담기는 것: ① 상시 규칙(`always: true`, `BRAIN_ALWAYS_RULE_MAX`) ② 태스크 관련 top-K(축소)
   * ③ 그 에이전트 자신의 카드. 프로젝트 층의 나머지는 **주제 색인**(별도 블록)으로 안내만 하고,
   * 에이전트가 자기 작업에 해당하는 주제 문서를 그 시점에 읽는다.
   *
   * 종전에는 ①이 "모든 rule 전량(상한 20)"이라 규칙이 쌓일수록 무관한 카드가 선형으로 늘었다
   * (실측: 사용량 작업 브리핑 13장 중 상위 6장이 관련도 심사를 안 거친 rule 전량).
   * 반환 = 요약 블록 + 실제 담긴 카드(주입 이벤트/참조 갱신용).
   */
  function buildBrainBriefing(agentId: string, root: string, taskText: string): { block: string; cards: BrainCard[] } {
    const svc = getBrainService(root);
    // §5.10 v3.81-G — **강제 필터가 랭킹보다 먼저 온다.** 후보 풀 자체가 "현재 진실"뿐이다:
    //   current 로 선택됨 ∧ verified ∧ 범위 일치 ∧ 유효기간 내 ∧ 충돌·확인필요 아님.
    //   pinned·always 도 이 필터를 우회하지 못하고, 도움률·최근성은 여기 관여하지 않는다.
    // §5.10 v2 (G) — 운영자 프로필(`scope: 'user'`)은 그 축이 켜져 있을 때만 나간다.
    //   사람에 대한 관찰이라 원하지 않는 사용자에게는 한 줄도 실리지 않아야 한다.
    const operatorOn = brainAxisEnabledFor(root, 'operator');
    const pool = svc.selectCurrent({ agentId })
      // §H — 경험 계층(lesson/mistake)은 그 자체로 현재 진실이 아니다. 규칙으로 승격된 것만 나간다.
      .filter((c) => !BRAIN_EXPERIENCE_TYPES.includes(c.type))
      .filter((c) => operatorOn || c.scope !== 'user');

    const picked: BrainCard[] = [];
    const seen = new Set<string>();
    const add = (c: BrainCard): void => {
      if (!seen.has(c.id)) { seen.add(c.id); picked.push(c); }
    };
    // 1) 상시 규칙(always) — 이제는 "현재 진실인 상시 규칙"만 남는다.
    pool.filter((c) => c.always).forEach(add);
    // 2) 태스크 관련 top-K — 같은 풀 안에서 랭킹(관련도 우세 + 도움률/신선도).
    if (taskText.trim()) {
      svc.rankCards(pool, { text: taskText })
        .slice(0, BRAIN_INJECTION_TOP_K)
        .forEach((r) => add(r.card));
    }

    const budgetChars = BRAIN_INJECTION_TOKEN_BUDGET * 4;
    const lines: string[] = [];
    const cards: BrainCard[] = [];
    let used = 0;
    for (const c of picked) {
      const layer = c.scope === 'project' ? '프로젝트' : '개별';
      const firstLine = c.body ? c.body.split('\n').find((l) => l.trim()) ?? '' : '';
      // v3.81 — 진실 주소·적용 범위·출처·마지막 검증 시각을 함께 싣는다(요건: 왜 이게 현재 진실인지
      //   모델이 스스로 판단할 수 있게). id 는 종전대로 helpfulMemoryIds 신고에 쓰인다.
      const meta = [
        c.canonicalKey ? `key=${c.canonicalKey}` : '',
        serializeAppliesTo(c.appliesTo) ? `scope=${serializeAppliesTo(c.appliesTo)}` : '',
        c.files.length > 0 ? `출처=${c.files[0]}${c.files.length > 1 ? ` 외 ${c.files.length - 1}` : ''}` : '',
        c.verifiedAt ? `검증=${new Date(c.verifiedAt).toISOString().slice(0, 10)}` : '',
      ].filter(Boolean).join(' · ');
      const line = `- [${c.id}] (${c.type}/${layer}) ${c.title}${firstLine ? `: ${firstLine.trim()}` : ''}`
        + (meta ? `\n    ${meta}` : '');
      if (used + line.length > budgetChars && cards.length > 0) break;
      lines.push(line);
      used += line.length;
      cards.push(c);
    }
    // §G — **현재 진실을 확인할 수 없으면 침묵하지 않는다.** 값이 갈려 current 를 잃은 슬롯은
    //   "확인된 현재 정보 없음"으로 알려, 모델이 옛 값을 아무거나 집어 쓰지 않게 한다.
    for (const slot of svc.listContested()) {
      const line = `- (확인된 현재 정보 없음) ${slot.canonicalKey}${slot.scopeKey ? ` [${slot.scopeKey}]` : ''}`
        + ` — 후보 ${slot.contenders.length}건이 충돌 중이다. 필요하면 직접 확인하고 신고하라.`;
      if (used + line.length > budgetChars) break;
      lines.push(line);
      used += line.length;
    }
    return { block: lines.join('\n'), cards };
  }

  /**
   * §5.10 — 세션 리플렉션 예약 헬퍼. 세션 소속 에이전트를 보고 저장 층(project/agent)·루트를 정한다.
   * 실패해도 조용히 무시(호출 경로 보호).
   */
  function triggerBrainReflection(sessionId: string, cwd?: string): void {
    try {
      if (!sessionId) return;
      const agent = graphManager.getAgentBySession(sessionId);
      const scope: BrainCardScope = agent?.customCreated ? 'agent' : 'project';
      const agentId = agent?.customCreated ? agent.id : undefined;
      const root = (agentId ? graphManager.getProjectPathForAgent(agentId) : null)
        ?? graphManager.getAgentCwd(sessionId)
        ?? cwd
        ?? graphManager.getRoot()
        ?? undefined;
      const effCwd = graphManager.getAgentCwd(sessionId) ?? cwd ?? root;
      if (!root || !effCwd) return;
      // §5.10 v2 (H) 게이트 ① 수집 — 두뇌가 꺼진 프로젝트는 리플렉션 자식 세션을 **아예 띄우지 않는다**.
      //   기본 off 의 값어치가 여기서 나온다(끈 사용자에게 토큰 0).
      if (!brainEnabledFor(root)) return;
      scheduleBrainReflection({ sessionId, cwd: effCwd, root, scope, agentId });
    } catch (e) {
      logger.warn('[brain] reflection trigger failed', e as Error);
    }
  }

  /**
   * §5.5 #17-18 v4.68 — **즉시(immediate) 덧말**: 지금 도는 턴을 끊는다(soft interrupt).
   *
   * Claude CLI 는 `--input-format stream-json` 의 stdin 으로 도는 턴을 끊는 수단을 주지 않는다
   * (`{"type":"interrupt"}` 는 미구현 요청). 그래서 **이미 있는 세션 중지 경로**를 그대로 쓴다:
   * 자식 트리 종료 → close 핸들러가 끊긴 명령을 `[Stopped by user]` 로 봉합 → `setOnComplete` 가
   * 큐에 남은 이 덧말을 `--resume` 으로 dispatch(대화 맥락은 유지, 그 턴의 진행 중 도구만 버려진다).
   *
   * `stop-session` 라우트와 달리 **큐를 비우지 않는다** — 즉시로 보낸 그 덧말이 함께 지워지면
   * 사용자가 방금 친 말이 사라진다.
   *
   * 순서는 **덜 죽이는 것부터** 셋이다 — ① 그 턴이 이미 답을 내고 봉인만 붙들려 있으면 봉인을 확정해
   * 그 자리에서 다음 턴으로 넘긴다(죽는 것 없음), ② 도는 턴이면 soft interrupt 로 그 턴만 끊는다
   * (프로세스·감시 유지), ③ 그것도 못 보내면 종전 하드 킬. ① 이 없던 동안은 봉인 대기 상태에도
   * 인터럽트가 나가 3초 뒤 ③ 으로 떨어졌고, 그 결과가 사용자에게는 "즉시를 누르면 대화가 끝나고
   * 세션이 멈춘다"였다.
   *
   * @returns 실제로 끊었으면(또는 봉인을 확정해 그 자리에서 넘겼으면) true — 호출자는 `processNextCommand`
   *          를 다시 부르지 않는다. 그냥 대기 중이었으면 false(평소 dispatch 가 이어받는다).
   */
  function interruptForImmediateCommand(cmd: QueuedCommand): boolean {
    const subId = cmd.subAgentId;
    if (!subId) return false;
    // 한 턴을 실제로 처리 중일 때만 — 명령 사이에 idle 로 살아 있는 persistent 자식은 끊을 이유가 없다.
    if (!subAgentManager.isSubProcessingCommand(subId)) return false;
    // 그 턴이 **이미 답을 내고** 백단 여운 때문에 봉인만 붙들려 있는 상태라면 **끊을 턴이 없다.**
    //   여기에 인터럽트를 쏘면 CLI 가 답할 것이 없어 3초 뒤 하드 킬 폴백으로 내려가고, 프로세스와
    //   그 세션의 감시까지 죽은 뒤 남는 것은 창구가 닫힌 자식뿐이다 — 그 창구로 이 덧말을 쓰려다
    //   `write after end` 로 dispatch 가 끊긴 것이 "즉시를 누르면 대화가 끝나고 세션이 멈춘다"의 실체였다.
    //   붙든 봉인을 지금 확정하면 그 자리에서 이 덧말이 다음 턴으로 나간다(끊은 것과 같은 효과, 죽는 것 없음).
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
   * §5.5 #17-28 — **이 세션의 프롬프트에 실릴 조각 전부**를 이름표와 함께 조립한다(부작용 없음).
   *
   * 프롬프트를 만드는 쪽(`processNextCommand`)과 그것을 보여 주는 쪽(`GET /api/context-inventory`)이
   * **같은 함수**를 쓴다. 두 벌로 갈라 두면 화면은 "9,000자"라고 말하는데 실제로는 다른 것이 실리는
   * 상태가 생기고, 그것이 이 기능의 유일한 실패 방식이다(§5.11 v4.65 가 배운 것과 같은 교훈).
   *
   * 켬/끔은 여기서 보지 않는다 — 목록은 "존재하는 것 전부"이고, 무엇을 뺄지는 호출부의 게이트가 정한다.
   */
  function assembleContextParts(input: {
    agent: { id: string; label: string; customCreated?: boolean };
    cwd: string;
    agentConfig?: AgentConfig;
    subAgentId?: string;
    commandText: string;
  }): {
    parts: MeasuredPart[];
    brief: { block: string; cards: { id: string; title: string }[] };
    brainRoot: string;
    /** §5.10 v2 (B) — 이번 턴에 실린 스킬 id. 실제로 보냈을 때만 노출을 적기 위해 돌려준다. */
    skillIds: string[];
    /**
     * §5.5 #17-28 ⑧(c) — 목표 블록의 두 절반. 표(인벤토리)는 둘을 합쳐 한 줄로 재지만, 실제 발송은
     * 갈라진다 — 상태는 매 턴 프롬프트로, 규약은 스폰의 `--append-system-prompt` 로.
     */
    goalParts: { state: string; protocol: string };
  } {
    const { agent, cwd, agentConfig, subAgentId } = input;
    const parts: MeasuredPart[] = [];
    const brainRoot = graphManager.getProjectPathForAgent(agent.id) ?? cwd;
    let brief: { block: string; cards: { id: string; title: string }[] } = { block: '', cards: [] };

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
    parts.push({
      id: CONTEXT_SOURCE_IDS.compactSelf,
      text: (agentConfig?.agentCanCompact === true && subAgentId)
        ? buildAgentSelfCompactRule(agent.id, subAgentId)
        : '',
    });
    parts.push({ id: CONTEXT_SOURCE_IDS.edges, text: buildOutboundEdgesRulesSection(agent.id) });
    parts.push({
      id: CONTEXT_SOURCE_IDS.feedback,
      text: buildAgentFeedbackBlock(graphManager.getAgentFeedbacksForAgent(agent.id)),
    });

    // §5.11 — 켠 집행 플러그인은 **한 장씩** 선다(개별로 끌 수 있어야 하므로) + 그 위에 전체 스위치 하나.
    const pluginBlocks = buildPluginPromptSectionParts({
      projectPath: brainRoot,
      cwd,
      agentId: agent.id,
      agentLabel: agent.label,
      customCreated: Boolean(agent.customCreated),
    });
    parts.push({
      id: CONTEXT_SOURCE_IDS.plugins,
      text: '',
      defaultEnabled: pluginBlocks.length > 0,
      detail: String(pluginBlocks.length),
    });
    for (const p of pluginBlocks) {
      parts.push({ id: `${CONTEXT_PLUGIN_ID_PREFIX}${p.id}`, text: p.block, title: p.id });
    }

    // 아래는 커스텀/스폰 에이전트에만 실리는 것들(§4 v2.52 하이브리드 경계) — 훅 에이전트는 빈 줄로 선다.
    const ruleArgs = {
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
            ? { steps: goal.steps.map((s) => ({ text: s.text, status: s.status })) }
            : {}),
          authoredBy: goal.authoredBy,
          ...(goal.note ? { note: goal.note } : {}),
          revision: goal.revision,
        };
        goalParts.state = buildSessionGoalState(goalArgs);
        goalParts.protocol = buildSessionGoalProtocol(goalArgs);
        goalText = goalParts.state + goalParts.protocol;
      }
    }
    parts.push({ id: CONTEXT_SOURCE_IDS.goal, text: goalText });

    // §5.10 Brain — 카드 브리핑 · 주제 색인 · 그 둘을 감싸는 규칙 틀. 세 줄로 갈라 각각 끌 수 있게 한다.
    let cardsBlock = '';
    let topicIndexBlock = '';
    let brainFrame = '';
    // §5.10 v2 (B) — 스킬(절차적 기억) 줄. 카드가 "무엇이 사실인가"라면 이쪽은 "이럴 땐 이렇게 한다".
    let skillsBlock = '';
    let pickedSkillIds: string[] = [];
    // §5.10 v2 (H) 게이트 ② 주입 — 꺼진 두뇌는 브리핑을 **조립조차 하지 않는다**.
    //   조각을 안 만들면 §5.5 컨텍스트 목록에도 안 뜨고(꺼진 기능이 목록에 남지 않는다) 조립 비용도 0 이다.
    if (custom && brainEnabledFor(brainRoot)) {
      try {
        brief = buildBrainBriefing(agent.id, brainRoot, input.commandText);
        cardsBlock = brief.block;
        const brainSvc = getBrainService(brainRoot);
        topicIndexBlock = buildBrainTopicIndexSection({
          project: brainSvc.listTopicIndex(),
          agent: brainSvc.listTopicIndex(agent.id),
        });
        // §5.10 v2 (B) — 축 'skills' 가 켜져 있을 때만 절차를 고른다. 지금 작업(commandText)과
        //   맞는 것만 오므로 목록이 길어지지 않는다(카드 top-K 와 별개 예산).
        if (brainAxisEnabledFor(brainRoot, 'skills')) {
          const picked = getBrainSkillService(brainRoot)
            .selectForTask(input.commandText, { agentId: agent.id });
          pickedSkillIds = picked.map((s) => s.id);
          skillsBlock = buildBrainSkillsSection(picked);
        }
        // §5.10 v2 (D) — 넛지는 축 + 세션 빈도 상한을 통과했을 때만 붙는다. 틀 안에 들어가므로
        //   별도 컨텍스트 줄을 만들지 않는다(축 스위치가 이미 그 역할을 한다).
        const nudgeBlock = claimNudgeSlot(brainRoot, subAgentId ?? agent.id)
          ? buildBrainNudgeSection()
          : '';
        // 틀만의 크기 = 전체에서 내용물을 뺀 것 — 네 줄의 합이 실제 주입량과 정확히 같아진다.
        const whole = buildBrainRulesSection({
          serverBase: ruleArgs.serverBase,
          serverToken: ruleArgs.serverToken,
          cardsBlock,
          topicIndexBlock,
          skillsBlock,
          nudgeBlock,
          ...(hookListenerIdentityFile ? { identityFile: hookListenerIdentityFile } : {}),
        });
        brainFrame = whole.replace(cardsBlock, '').replace(topicIndexBlock, '').replace(skillsBlock, '');
      } catch (e) {
        logger.warn('[brain] briefing assemble failed', e as Error);
      }
    }
    parts.push({ id: CONTEXT_SOURCE_IDS.brainCards, text: cardsBlock, detail: String(brief.cards.length) });
    parts.push({ id: CONTEXT_SOURCE_IDS.brainTopics, text: topicIndexBlock });
    parts.push({ id: CONTEXT_SOURCE_IDS.brainSkills, text: skillsBlock, detail: String(pickedSkillIds.length) });
    parts.push({ id: CONTEXT_SOURCE_IDS.brainRules, text: brainFrame });

    // §5.11 v4.67 — 훅으로 붙은 외부 세션의 주입 통로. 글자 수로 잴 수 있는 블록이 아니라 **경로 스위치**라
    //   0자여도 켜져 있는 것이 맞다(실제 내용은 위 플러그인 줄들이 보여 준다).
    //   우리가 띄운 세션(custom)에는 해당이 없으므로 줄 자체를 세우지 않는다.
    if (!custom) {
      parts.push({ id: CONTEXT_SOURCE_IDS.hookEnforcement, text: '', defaultEnabled: true });
    }

    return { parts, brief, brainRoot, skillIds: pickedSkillIds, goalParts };
  }

  /** 큐에서 dispatch 가능한 명령을 전부 실행.
   *  동일 subAgentId는 직렬(한 세션당 한 명령), 서로 다른 subAgentId끼리는 병렬로 시작.
   *  null subAgentId는 하나의 슬롯으로 묶어 기존 직렬 동작 유지. */
  function processNextCommand(sessionId: string): void {
    const queue = commandQueues.get(sessionId);
    if (!queue) return;

    const agent = graphManager.getAgentBySession(sessionId);
    if (!agent) return;

    const cwd = graphManager.getAgentCwd(sessionId);
    if (!cwd) return;

    const agentConfig = graphManager.getAgentConfig(agent.id);

    // §5.5 #17-28 — **주입원 통제**: 사용자가 이 창에서 끈 줄은 여기서 빠진다. 이 게이트가 마지막
    //   관문이라 다른 화면(플러그인 창·에이전트 설정)에서 켜져 있어도 결과는 여기서 정해진다.
    //   오버라이드가 하나도 없으면 모든 판정이 기본값(켜짐)이라 조립 결과가 이 기능이 생기기 전과
    //   바이트 단위로 같다 — 이 기능을 안 쓰는 사용자는 아무 차이도 겪지 않는다.
    const contextOverrides = graphManager.getContextOverrides();
    const contextProjectKey = graphManager.getAgentProjectName(agent.id);

    // v1.37 — STRICT outbound 엣지가 있으면 타겟이 가진 도구를 소스 allowedTools 에서 박탈.
    // 매 턴 재계산이라 엣지 삭제·AUTO 전환 시 다음 턴에 자동 복귀 — 별도 cleanup 불필요.
    // Bash 포함 모든 툴이 strip 대상 — 구성은 사용자 책임.
    const stripSet = computeStrictStripSet(agent.id);
    const effectiveConfig = (agentConfig && stripSet.size > 0)
      ? { ...agentConfig, tools: agentConfig.tools.filter((t) => !stripSet.has(t)) }
      : agentConfig;

    // 이미 executing 중인 subAgentId들 — 이 슬롯은 점유 중
    const busy = new Set<string | null>();
    for (const c of queue) {
      if (c.status === 'executing') busy.add(c.subAgentId);
    }

    let dispatched = false;
    // §5.5 #17-18 v4.68 — 합치기가 뒤엣것을 큐에서 지우므로 **스냅샷**을 순회한다(라이브 배열을
    //   splice 하며 돌면 항목을 건너뛴다). 지워진 항목은 아래 `queue.includes` 가 걸러낸다.
    for (const next of [...queue]) {
      if (next.status !== 'queued') continue;
      if (!queue.includes(next)) continue; // 앞선 명령에 흡수됨 — 이 턴에 이미 실려 나갔다.
      if (busy.has(next.subAgentId)) continue;
      busy.add(next.subAgentId); // 같은 sub에 두 개 동시 dispatch 금지
      // §5.5 #17-18 v4.68 — 뒤따르는 합치기 덧말을 이 명령에 흡수(= 한 턴에 함께 보낸다).
      //   프롬프트 조립(목표 시딩·브리핑)보다 **먼저** 해야 합쳐진 본문이 그 입력으로 쓰인다.
      const merged = absorbMergeFollowUps(queue, next);
      if (merged.length > 0) {
        logger.info(`[follow-up] merged ${merged.length} into ${next.id} (sub=${next.subAgentId ?? '-'})`);
      }
      // §5.5 #17-17 ⑨ v4.59 — 목표 카드는 계획(TodoWrite)을 기다리지 않고 **이 명령이 뜨는
      //   순간** 태어난다. 그래야 사이드바가 "지금 이 세션이 하는 일"을 항상 가리킨다(계획을
      //   세우지 않는 짧은 작업에서도 빈 화면이 되지 않는다). 세션이 쓴 목표만 새 명령에
      //   갈아타고 사용자가 고친 문장은 건드리지 않는다 — 판단은 전부 그래프 쪽에 있다.
      //   조각 조립보다 **먼저** 세워야 이번 턴 프롬프트에 그 목표가 실린다.
      //   (주입원 창에서 목표 블록을 껐더라도 카드 자체는 세운다 — 끈 것은 "프롬프트에 싣는 것"이지
      //    화면의 목표 창이 아니다.)
      if (agent.customCreated && next.subAgentId && next.text?.trim()) {
        graphManager.seedSessionGoalFromCommand(next.subAgentId, {
          agentId: agent.id,
          command: next.text,
        });
      }

      // §5.5 #17-28 — 이 턴에 실릴 수 있는 조각 전부를 이름표와 함께 받아, **게이트를 통과한 것만**
      //   순서대로 붙인다. 화면(`/api/context-inventory`)이 같은 함수를 쓰므로 표와 프롬프트가 어긋날 수 없다.
      const assembled = assembleContextParts({
        agent,
        cwd,
        ...(agentConfig ? { agentConfig } : {}),
        ...(next.subAgentId ? { subAgentId: next.subAgentId } : {}),
        commandText: next.text ?? '',
      });
      const partText = new Map(assembled.parts.map((p) => [p.id, p.text]));
      const ctxScope = { projectKey: contextProjectKey, subAgentId: next.subAgentId };
      /** 이 조각을 실을까 — 세션 층 > 프로젝트 층 > 기본(켜짐). 끈 것은 빈 문자열이 된다. */
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

      // §4 v2.52 — 커스텀/스폰 에이전트에만 "작업 신고" 지시문 주입(Hook 에이전트 제외 = 하이브리드 경계).
      //   하네스 빌더와 동일 인프라(토큰 인증 loopback)로 did/userActions 를 POST /api/agent-report 신고 →
      //   IDE 가 색 구분 카드 렌더. agentId=부모 버블, subAgentId=이 세션(탭) 키로 baked.
      // §5.5 #17-12 v3.83 — "의도 먼저" 선언 규칙이 카드 지시문보다 앞에 온다(턴의 첫 출력이 의도 선언이 되도록).
      // §5.5 #17-17 ② v4.69 — 목표 블록은 **live preamble 에도** 실어야 한다. `dispatchContext` 는
      //   첫 스폰에서만 쓰이므로(이어지는 턴은 preamble 만 간다), 여기에만 넣으면 "매 턴 재조립"이
      //   실제로는 **세션 첫 턴 1회**가 된다 — 세션이 목록을 유지할 지시를 받지 못해 목표창의 단계가
      //   영영 비어 있던 진짜 원인(실측: 목표 5건 전부 steps=0). 집행 블록(§5.11 v4.65)과 같은 자리.
      // §5.5 #17-28 ⑧(c) — 의도 선언과 목표 **규약**은 세션 내내 한 글자도 안 변한다. 종전에는 둘 다
      //   `livePreamble` 을 타고 **매 턴 사용자 메시지에 새로 쌓여** 턴이 늘수록 같은 문장이 이력에
      //   N벌 남았다(실측 249 세션에서 4.6M 토큰 노출). 이제 `--append-system-prompt` 로 프로세스당
      //   한 벌만 실어 보낸다 — 캐시 프리픽스의 맨 앞이고, **압축(compact)에도 쓸려 나가지 않는다**
      //   (사용자 메시지에 있던 규칙은 쓸려 나가면 세션 중반부터 아무도 그 방법을 말해 주지 않는다).
      //   매 턴 남는 것은 목표의 **상태**(문장·진행률·단계)뿐 — 실측 154 토큰.
      const intentBlock = take(CONTEXT_SOURCE_IDS.intentFirst);
      const goalOn = !!take(CONTEXT_SOURCE_IDS.goal);
      const goalBlock = goalOn ? assembled.goalParts.state : '';
      const goalProtocolBlock = goalOn ? assembled.goalParts.protocol : '';
      const appendSystemPrompt = intentBlock + goalProtocolBlock;
      // §5.5 #17-28 ⑧(a) — 공통 규약은 **카드가 하나라도 켜져 있을 때만** 앞세운다. 전부 꺼 두면
      //   공통 규약도 함께 빠져 "끈 기능의 설명만 남는" 상태가 생기지 않는다.
      // §5.5 #17-28 ⑧(d) — 번호 목록·서버 iframe 규약은 걷었다. 목록 정렬은 클라의 마크다운 렌더가,
      //   서버 프리뷰는 백그라운드 셸 포트 감지(§7.11 v2.29)가 **에이전트 없이** 이미 해내던 일이다.
      //   엔드포인트(`/api/agent-list`·`/api/agent-iframe`)와 카드 렌더는 그대로 살아 있다.
      const cardBodies = take(CONTEXT_SOURCE_IDS.cardReport) + take(CONTEXT_SOURCE_IDS.cardQuestion)
        + take(CONTEXT_SOURCE_IDS.cardReview);
      const cardsRules = cardBodies ? take(CONTEXT_SOURCE_IDS.cardCommon) + cardBodies : '';
      // §5.10 v3.74 스폰 브리핑 — 상시 규칙 + 태스크 top-K + 자기 카드 + **주제 색인** + 능동 검색 안내.
      //   틀(brainRules)을 끄면 안에 들 것이 없으므로 카드·색인도 함께 빠진다.
      const brainFrame = take(CONTEXT_SOURCE_IDS.brainRules);
      const brainCards = take(CONTEXT_SOURCE_IDS.brainCards);
      const brainTopics = take(CONTEXT_SOURCE_IDS.brainTopics);
      const brainSkills = take(CONTEXT_SOURCE_IDS.brainSkills);
      const brainBlock = brainFrame
        ? buildBrainRulesSection({
          serverBase: `http://127.0.0.1:${hookListenerPort ?? port}`,
          serverToken: hookListenerToken ?? '',
          cardsBlock: brainCards,
          topicIndexBlock: brainTopics,
          skillsBlock: brainSkills,
          ...(hookListenerIdentityFile ? { identityFile: hookListenerIdentityFile } : {}),
        })
        : '';
      const dispatchContext = contextSummary + cardsRules + goalBlock + brainBlock;

      // §5.10 v2 (B) — 스킬도 같은 규율. 실제로 실어 보냈을 때만 노출을 적는다.
      if (brainSkills && assembled.skillIds.length > 0) {
        try {
          getBrainSkillService(assembled.brainRoot).touchReferences(assembled.skillIds);
        } catch (e) {
          logger.warn('[brain-skill] touchReferences failed', e as Error);
        }
      }

      // 실제로 카드를 실어 보냈을 때만 참조 기록·주입 이벤트를 남긴다(끈 턴을 "주입했다"고 기록하면
      // 랭킹이 거짓 신호를 먹는다 — 표시와 실측이 갈리는 그 지점).
      if (brainCards && assembled.brief.cards.length > 0) {
        try {
          getBrainService(assembled.brainRoot).touchReferences(assembled.brief.cards.map((c) => c.id));
          graphManager.addBrainInjection({
            id: randomUUID(),
            agentId: agent.id,
            at: Date.now(),
            cardIds: assembled.brief.cards.map((c) => c.id),
            cardTitles: assembled.brief.cards.map((c) => c.title),
            trigger: 'spawn',
          });
        } catch (e) {
          logger.warn('[brain] injection record failed', e as Error);
        }
      }

      // v1.33 — edgesBlock 을 separately 전달해 resume(--resume) 경로에서도 매 턴 prepend.
      //         엣지가 생기거나 바뀌었을 때 세션 재시작 없이도 즉시 인지하도록.
      // v1.77 (Direction A) — 커스텀 에이전트면 customParent=true → execute 가 --bg 우회, legacy 고정.
      // §5.11 v4.65 — 집행 블록을 **live preamble 에도** 싣는다. `contextSummary` 는 첫 스폰에만 쓰이므로
      //   여기 안 넣으면 이어지는 턴(resume)에는 한 글자도 안 실려 "매 턴"이 세션 첫 턴 1회가 된다.
      //   (첫 스폰 경로는 preamble 을 쓰지 않으니 중복되지 않는다 — `execute` 가 sessionId 유무로 갈라 쓴다.)
      // §5.5 #17-17 ②-2 v4.72 — "의도 먼저 + 계획을 세워라"도 같은 함정 위에 있었다(첫 스폰에만 실리면
      //   두 번째 턴부터는 계획을 세우라는 말을 아무도 안 한다). 짧은 블록이라 매 턴 실어도 비용이 미미하다.
      const livePreamble = edgesBlock + pluginBlock + goalBlock;
      // §5.5 #17-28 — `control: 'spawn'` 으로 끈 줄(CLAUDE.md·자동 기억·스킬 등)은 CLI 인자·환경변수로
      //   나간다. 헤드리스는 매 턴 새 프로세스라 다음 프롬프트부터 그대로 먹는다.
      const spawnSwitches = buildSpawnContextSwitches(contextOverrides, ctxScope);
      // §5.5 #17-28 ⑧(b) — 카드 curl 이 쓸 주소·토큰을 **환경변수로** 자식에게 넘긴다. 종전에는 이
      //   두 값을 프롬프트 안 bash 프렐류드(596 토큰 × 8벌)가 매번 파일에서 읽어 왔다. 환경은 자식이
      //   뜰 때 정해지므로 `--resume` 재스폰마다 최신값이고, 프롬프트에는 한 글자도 실리지 않는다.
      const cardEnv: Record<string, string> = {
        [AGENT_CARD_ENV_BASE]: `http://127.0.0.1:${hookListenerPort ?? port}`,
        [AGENT_CARD_ENV_TOKEN]: hookListenerToken ?? '',
      };
      subAgentManager.execute(next, cwd, dispatchContext, effectiveConfig, livePreamble, {
        customParent: !!agent.customCreated,
        ...(spawnSwitches.args.length > 0 ? { extraArgs: spawnSwitches.args } : {}),
        extraEnv: { ...cardEnv, ...spawnSwitches.env },
        ...(appendSystemPrompt.trim() ? { appendSystemPrompt } : {}),
      });
      dispatched = true;
    }

    if (dispatched) broadcastSnapshot();
  }

  // ─── §5.5 #17-11 v3.79 — 세션 반복 실행(루프) 런타임 ───
  //
  // 한 회차 = `POST /api/commands/:sessionId` 와 **똑같은 모양의 QueuedCommand** 를 그 세션 큐에
  // 넣는 것뿐이다. 새 실행 레일을 만들지 않으므로 dispatch·스트림·중지·아카이브·과금이 사용자가
  // 직접 보낸 명령과 완전히 같은 길을 탄다.
  //
  // 자기 증식 방지(§5.10 v3.76 리플렉션 순환의 교훈): ① 회차는 **직렬** — 그 세션에 queued/executing
  // 명령이 하나라도 있으면 새 회차를 쏘지 않는다, ② 다음 회차는 직전 회차의 `pendingCommandId` 가
  // 완료로 확인될 때만 예약된다, ③ [중지] 계열은 루프 자체를 끈다(아래 stop 라우트).
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

    const cmd: QueuedCommand = {
      id: `cmd-${Date.now()}-loop${round}`,
      text,
      timestamp: Date.now(),
      subAgentId,
      status: 'queued',
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
   * §5.5 #17-11 ⑪·⑫(b) — 회차 사이 컨텍스트 정리 1건 발사(`contextMode ≠ 'none'` 인 루프만).
   *
   * 정리도 **회차와 같은 명령 큐**에 얹는 `QueuedCommand` 한 건일 뿐이다(새 레일 ❌) — 사용자가
   * 입력창에 `/compact`(요약 유지) 또는 `/clear`(완전 초기화)를 치는 것과 완전히 같은 길.
   * 이 명령이 끝나야 다음 회차를 예약하므로 대조용 id 를 남긴다. 큐에 넣었으면 true
   * (넣지 못했으면 호출자가 곧바로 다음 회차를 예약한다).
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
   * §4 (CLI 사양 추종) — **에이전트가 스스로 요청한 압축**의 대기표.
   *
   * `POST /api/agent-compact` 는 턴이 도는 **도중에** 들어온다(에이전트가 일하다 부른다). 그때는
   * 그 세션에 실행 중 명령이 있어 압축을 겹쳐 쏠 수 없으므로, 여기 적어 두었다가 그 턴이 끝나는
   * 자리에서 `maybeCompactAfterTurn` 이 소비한다. 여러 번 불러도 Set 이라 한 번만 돈다.
   * 런타임 전용(재시작하면 사라짐) — 못 돈 요청은 다음 턴에 에이전트가 다시 부르면 그만이다.
   */
  const compactRequestedSubs = new Set<string>();

  /**
   * §4 (CLI 사양 추종) — 이 세션의 컨텍스트가 **지금 몇 토큰 차 있는가**(창 크기와 함께).
   *
   * 화면 게이지(IDEStatusBar)가 보는 값과 **같은 출처**를 쓴다 — 판정과 표시가 어긋나면
   * "400k 라고 적혀 있는데 왜 안 접히지"를 아무도 설명할 수 없다.
   *  - claude CLI 세션 — 세션 JSONL 의 마지막 assistant 엔트리(증분 캐시라 매 턴 읽어도 싸다).
   *  - 로컬 모델(§5.19) — JSONL 이 없다. 엔진이 왕복마다 실어 준 값이 `AgentConfig.provider` 에 있다.
   * 둘 다 없으면 `null` — **모르면 쏘지 않는다**(모르는 채로 쏘면 종전의 매 턴 압축이다).
   */
  function readTurnEndContext(sub: { id: string; sessionId?: string }, config?: AgentConfig): { used: number; max?: number } | null {
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
    return { used: info.contextUsed, ...(info.contextMax > 0 ? { max: info.contextMax } : {}) };
  }

  /**
   * §4 (CLI 사양 추종) — 턴이 끝났다. 압축을 걸어야 하면 그 세션 큐에 `/compact` 한 건을 얹는다.
   *
   * **켜고 끄는 스위치가 없다.** 사용자가 고르는 숫자는 자동 압축 값 하나뿐이고, 접는 자리는 언제나
   * 턴 경계다 — 창 크기와 턴 경계 체크박스가 같은 일을 하며 헷갈리게 하던 것을 하나로 합쳤다.
   * 발동 조건 둘은 `shouldCompactAfterTurn`(shared) 한 곳이 판정한다:
   *  - 에이전트가 이번 턴에 요청(`agentCanCompact`) — **무조건** 쏜다. 판단을 맡긴 축이라 되묻지 않는다.
   *  - 발동선 도달 — 자동 압축 값의 80%(`turnCompactTriggerTokens`)를 넘긴 채 턴이 끝났을 때.
   *    같은 숫자를 쓰면 안 된다: CLI 에게 그 값은 **창 크기**라 거기 닿기 전에 스스로 접어 버려,
   *    우리 차례가 영영 오지 않는다(그렇게 만들어 봤고 옵션이 죽었다). 한 단 낮춰야 평소에는
   *    우리가 안전한 자리에서 먼저 접고, 한 턴이 그 여백을 통째로 뚫는 예외에서만 CLI 가 도중에 접는다.
   *
   * 새 실행 레일이 아니라 §5.5 #17-11 ⑪ 이 쓰는 그 명령 큐다(사용자가 입력창에 치는 것과 같은 길).
   *
   * 안 쏘는 자리를 분명히 한다:
   *  - 방금 끝난 것이 **압축 자신**이면 ❌ — 압축이 압축을 부르는 무한 고리가 된다.
   *  - 그 세션에 **루프가 `contextMode` 로 이미 압축을 담당**하면 ❌ — 회차 경계에서 두 번 돈다.
   *  - 큐에 아직 안 끝난 명령이 있으면 ❌ — 직렬 보장(루프 압축과 같은 규약). 다음 턴 끝에 다시 본다.
   *  - 컨텍스트를 **못 재면** ❌ — 아래 `readTurnEndContext` 참고(모르면 쏘지 않는다).
   */
  function maybeCompactAfterTurn(cmd: QueuedCommand, sessionId: string): boolean {
    const subAgentId = cmd.subAgentId;
    if (!subAgentId) return false;

    const requested = compactRequestedSubs.delete(subAgentId);
    const sub = subAgentManager.getSub(subAgentId);
    if (!sub) return false;

    const agentId = graphManager.findAgentIdBySession(sessionId) ?? sub.parentAgentId;
    const config = agentId ? graphManager.getAgentConfig(agentId) : undefined;
    // 발동선 게이트 — 선은 스폰이 `--autocompact` 에 실은 그 값에서 **같은 판정**으로 파생된다.
    //   컨텍스트 측정은 요청이 없을 때만 한다(요청은 발동선을 묻지 않으므로 읽을 이유가 없다).
    const ctx = requested ? null : readTurnEndContext(sub, config);
    if (!shouldCompactAfterTurn({
      requested,
      autoCompact: config?.autoCompact,
      userAutoCompact: userDefaultsService.get().agentConfig?.autoCompact,
      contextUsed: ctx?.used,
      contextMax: ctx?.max,
    })) return false;

    // 압축이 압축을 부르지 않게. 사용자가 직접 친 `/compact` 뒤에도 또 쏘지 않는다.
    const text = cmd.text.trim();
    if (text === AGENT_COMPACT_COMMAND || text === SESSION_LOOP_CLEAR_COMMAND) return false;

    // 루프가 이미 회차 경계 정리를 맡고 있으면 그쪽에 양보한다(두 벌 압축 방지).
    const loop = graphManager.getSessionLoop(subAgentId);
    if (loop?.enabled && loop.contextMode !== 'none') return false;

    let queue = commandQueues.get(sessionId);
    if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
    if (queue.some((c) => c.subAgentId === subAgentId && (c.status === 'queued' || c.status === 'executing'))) {
      return false;
    }

    queue.push({
      id: `cmd-${Date.now()}-turncompact`,
      text: AGENT_COMPACT_COMMAND,
      timestamp: Date.now(),
      subAgentId,
      status: 'queued',
    });
    logger.info(`[turn-compact] queued ${AGENT_COMPACT_COMMAND} sub=${subAgentId} by=${requested ? 'agent' : 'config'}${ctx ? ` used=${ctx.used}` : ''}`);
    processNextCommand(sessionId);
    return true;
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
  // ─── §5.5 #17-35 — 검증(Verify) ───
  //
  // `/verify` 는 Claude Code 번들 스킬이라 **실행 로직이 우리에게 없다.** 우리가 하는 일은 셋뿐이다:
  // ① 실행법(레시피)을 먼저 쥐여 주고, ② 결과를 구조화 판정으로 받아, ③ 이력으로 남긴다.
  // 실행 자체는 **기존 명령 큐** 그대로다(새 스폰 레일 ❌ — #17-11 ② 와 같은 골격).

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
   * 시연의 프레임을 **있는 자리 그대로** 가리킨다(⑨-4) — 경로 + 클립 안 시각.
   *
   * 종전엔 검증할 때마다 첨부 폴더로 사본을 떴다. 그때는 완료 시 첨부 파일을 지웠기 때문에(v1.35/
   * v1.38) 원본을 보호할 유일한 방법이 사본이었다. 그러나 v2.61 이후 첨부는 **지워지지 않고**,
   * 프레임 경로는 이제 첨부 레일이 아니라 프롬프트 본문으로 나간다 — 사본을 쓸 곳이 하나도 없다.
   * 그대로 두면 검증 한 번마다 못 쓰는 그림 N 장이 순수하게 쌓인다(§9).
   *
   * 원본은 시연 레코드와 수명이 같다(`removeDemoFrames` 가 유일한 회수 지점). 두 번째 검증에도
   * 같은 파일이 그 자리에 있으므로 사본이 지키려던 것이 저절로 지켜진다.
   * 실제로 없는 파일은 빼고 돌려준다 — 프롬프트에 열 수 없는 경로를 적으면 모델이 거기서 멈춘다.
   */
  function demoFrameRefsForCommand(demo: VerificationDemo): { path: string; atMs: number }[] {
    if (demo.frames.length === 0) return [];
    const srcDir = demoFramesDir(demo.agentId, demo.id);
    if (!srcDir) return [];
    const out: { path: string; atMs: number }[] = [];
    for (const frame of demo.frames.slice(0, VERIFICATION_DEMO_FRAMES_MAX)) {
      const abs = path.join(srcDir, path.basename(frame.rel));
      if (!fs.existsSync(abs)) {
        logger.warn(`[verify] demo frame missing, skipped: ${abs}`);
        continue;
      }
      out.push({ path: abs, atMs: frame.atMs });
    }
    return out;
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
  function startVerificationRun(
    agentId: string,
    subAgentId: string,
    focus?: string,
    demoId?: string,
  ): { ok: true; run: VerificationRun } | { ok: false; error: string } {
    if (!subAgentManager.getSub(subAgentId)) return { ok: false, error: 'session-not-found' };
    if (graphManager.getActiveVerificationRun(subAgentId)) return { ok: false, error: 'already-running' };

    const sessionId = graphManager.findSessionByAgentId(agentId);
    if (!sessionId) return { ok: false, error: 'session-not-found' };

    let queue = commandQueues.get(sessionId);
    if (!queue) { queue = []; commandQueues.set(sessionId, queue); }
    if (queue.some((c) => c.subAgentId === subAgentId && (c.status === 'queued' || c.status === 'executing'))) {
      return { ok: false, error: 'session-busy' };
    }

    const projectName = graphManager.getAgentProjectName(agentId) ?? '';
    const recipe = resolveVerifyRecipe(agentId, projectName);
    const trimmedFocus = focus?.trim().slice(0, VERIFICATION_FOCUS_MAX);

    // §5.5 #17-35 ⑨-4 — 고른 시연이 있으면 절차를 프롬프트에, 그림을 **기존 첨부 레일**에 싣는다.
    //   원본을 그대로 넘기지 않고 **사본**을 이 명령의 첨부 폴더로 복사한다 — 완료 시 unlink 되는
    //   것은 사본이고, 시연은 다음 검증에도 그대로 남는다(⑨-3 이 폴더를 가른 이유).
    const demo = demoId ? graphManager.findVerificationDemo(demoId) : undefined;
    const demoAttachments = demo ? demoFrameRefsForCommand(demo) : [];

    // 경로는 **프롬프트 본문 안에** 실린다 — `/verify` 는 슬래시 명령이라 `composeTurnPrompt` 가
    // 꼬리 첨부를 붙이지 않기 때문이다(`DemoFrameRef` 주석). `attachments` 는 사용자 쪽 명령 카드
    // 썸네일 용도로만 함께 둔다(같은 원본 파일을 가리키는 목록일 뿐, 복사도 중복 전송도 아니다).
    const text = buildVerifyPrompt({
      recipe,
      ...(trimmedFocus ? { focus: trimmedFocus } : {}),
      ...(demo ? { demo, demoFrames: demoAttachments } : {}),
    });

    const cmd: QueuedCommand = {
      id: `cmd-${Date.now()}-verify`,
      text,
      timestamp: Date.now(),
      subAgentId,
      status: 'queued',
      ...(demoAttachments.length > 0 ? { attachments: demoAttachments.map((f) => f.path) } : {}),
    };
    queue.push(cmd);
    graphManager.recordSkillUsageFromCommandText(sessionId, cmd.text);

    const run: VerificationRun = {
      id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      subAgentId,
      projectName,
      ...(trimmedFocus ? { focus: trimmedFocus } : {}),
      recipeSource: recipe.source,
      ...(recipe.label ? { recipeLabel: recipe.label } : {}),
      ...(demo ? { demoId: demo.id, demoLabel: demo.label } : {}),
      // 위에서 "안 끝난 명령 없음"을 이미 확인했으므로 이 건은 곧바로 나간다(`queued` 는 옛 저장분 복원용).
      status: 'running',
      verdict: 'unknown',
      attempts: [],
      pendingCommandId: cmd.id,
      startedAt: cmd.timestamp,
    };
    graphManager.addVerificationRun(run);
    logger.info(
      `[verify] start agent=${agentId} sub=${subAgentId} recipe=${recipe.source}` +
      (demo ? ` demo=${demo.id} steps=${demo.steps.length} frames=${demoAttachments.length}` : ''),
    );
    processNextCommand(sessionId);
    return { ok: true, run };
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
      return;
    }

    if (failed && loop.stopOnError) {
      clearSessionLoopTimer(subAgentId);
      graphManager.updateSessionLoop(subAgentId, {
        completed, enabled: false, status: 'error', pendingCommandId: undefined, nextRunAt: undefined,
        lastError: errText ?? 'error', ...usage,
      });
      logger.warn(`[session-loop] stopped on error sub=${subAgentId} completed=${completed}`);
      return;
    }

    if (loop.mode === 'count' && completed >= (loop.total ?? 0)) {
      clearSessionLoopTimer(subAgentId);
      graphManager.updateSessionLoop(subAgentId, {
        completed, enabled: false, status: 'done', pendingCommandId: undefined, nextRunAt: undefined,
        lastError: errText, ...usage,
      });
      logger.info(`[session-loop] done sub=${subAgentId} completed=${completed}/${loop.total}`);
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

  // §9 — graph_snapshot 16ms trailing 디바운스. 커스텀 에이전트 다중 실행 시 매 mutation
  // (setOnMutated)마다 풀 getSnapshot()+broadcast 하던 것을 16ms 창 1회로 합친다.
  // 30+ 호출 사이트는 그대로 — 본체만 큐잉. flush 시점에 getSnapshot()을 읽으므로
  // 창 안의 모든 변경이 최신 상태로 반영(스케줄 시점 캡처 ❌ → 누락 0).
  // 인라인 직송 broadcast({type:'graph_snapshot'...}) 13곳은 즉시 송신이지만, trailing 이
  // 그 뒤에 떠도 최신 상태를 다시 읽어 보내므로 stale 덮어쓰기 없음.
  let snapshotBroadcastTimer: ReturnType<typeof setTimeout> | null = null;
  // §9 v3.40 — 부하 적응형 배치 창. getSnapshot()+IPC 직렬화는 Electron 메인 스레드에서 돌므로,
  // 전수조사급 다중 세션에서 flush 비용이 16ms 를 넘기면 다음 창을 비용 비례로 늘려(상한 250ms)
  // 스냅샷 파이프라인이 입력 스레드를 독점하지 못하게 한다. 경부하에선 항상 16ms 로 복귀.
  let snapshotBroadcastDelay = WS_BATCH_INTERVAL;
  // [perf-snapshot] 계측 — VIBISUAL_PERF=1 일 때만. 서버는 Electron 메인 프로세스에서 돌므로
  // getSnapshot()+직렬화 비용이 그대로 창 입력 스레드를 잡는다. 전수조사 다중 세션에서 이 값이
  // 프레임 예산(16ms)을 잡아먹는지 확인하기 위한 임시 계측(델타/utilityProcess 착수 전 범인 확정용).
  const PERF_SNAPSHOT = process.env.VIBISUAL_PERF === '1';

  /**
   * §4 (첫 실행 온보딩) ③ — "고른 프로젝트 폴더가 없다" 로 생성 요청을 돌려보낸다.
   *
   * **화면에서만 막으면 절반만 사실이 된다** — 캔버스 우클릭 말고도 이 REST 로 들어오는 길이
   * 있고(모바일 웹·원격조작·바깥 도구), 그 길로 들어오면 종전처럼 임시로 지어낸 작업 폴더에
   * 매인 유령 버블이 다시 생긴다. 코드는 shared 한 곳(`NO_PROJECT_FOLDER_ERROR`)에서 오고,
   * 클라 생성 손잡이는 그 코드를 보고 폴더 선택 게이트를 연다.
   */
  function respondNoProjectFolder(res: express.Response, where: string): void {
    logger.info(`${where}: 열린 프로젝트 폴더가 없어 생성을 거절 — 폴더 선택으로 유도`);
    res.status(409).json({ ok: false, error: NO_PROJECT_FOLDER_ERROR });
  }

  function broadcastSnapshot(): void {
    if (snapshotBroadcastTimer !== null) return; // 이미 예약됨 — trailing flush 가 최신 스냅샷을 읽는다
    snapshotBroadcastTimer = setTimeout(() => {
      snapshotBroadcastTimer = null;
      const tFlush0 = performance.now();
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
      // 직전 flush 실측 비용(getSnapshot + sink 직렬화/팬아웃 — webContents.send 는 동기 직렬화)으로
      // 다음 창을 적응. 스케줄 시점이 아니라 flush 시점에 갱신하므로 폭주가 끝나면 즉시 16ms 복귀.
      const cost = performance.now() - tFlush0;
      snapshotBroadcastDelay = Math.min(
        Math.max(WS_BATCH_INTERVAL, cost * WS_BATCH_BACKOFF_FACTOR),
        WS_BATCH_INTERVAL_MAX,
      );
    }, snapshotBroadcastDelay);
  }

  // §5.3 #10-2 v2.37 — Auto Agent 런타임. 사용자 메시지 → 서브 군 자동 생성·dispatch.
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
      const cmd: QueuedCommand = {
        id: `cmd-${Date.now()}-${queue.length}`,
        text,
        timestamp: Date.now(),
        subAgentId,
        status: 'queued' as const,
      };
      queue.push(cmd);
      processNextCommand(sessionId);
    },
    broadcastSnapshot,
    saveCheckpoint: () => saveCheckpoint(),
    // §5.3 #10-2 v2.45 — 빌더가 curl 로 닿을 loopback 베이스. buildOutboundEdgesRulesSection 과 동일 근거
    // (외부 claude 프로세스는 hook 리스너 동적 포트로만 in-process 서버에 닿음).
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
   * v1.35 — 에이전트 프롬프트 이미지 paste 업로드.
   * sessionId 는 URL param (multer 가 body 를 이미지 다음에 파싱하므로 body 에 두면 destination 콜백에서 못 읽음).
   * 저장 위치: `<agentCwd>/.vibisual/attachments/<sessionId>/<uuid>.<ext>` 절대경로.
   * 응답의 `path` 를 클라이언트가 `QueuedCommand.attachments[]` 로 보내면 dispatch 시 프롬프트에 주입되고 완료 후 cleanup.
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
   * v1.35 — 업로드 취소/대기 중 삭제.
   * 제출 전 사용자가 썸네일을 제거하거나 팝업을 닫을 때 호출.
   * 제출 후엔 `setOnComplete` cleanup 이 담당하므로 이 엔드포인트는 쓰지 않음.
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
    fs.unlink(resolvedPath, (unlinkErr) => {
      if (unlinkErr && (unlinkErr as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`attachment unlink failed: ${resolvedPath} — ${unlinkErr.message}`);
        res.status(500).json({ error: 'unlink failed' });
        return;
      }
      res.json({ ok: true });
    });
  });

  /** GET /api/agent-attachments/:sessionId/file?rel=<subId/uuid.ext | uuid.ext> — v2.93
   *  제출 후에도 디스크에 보존된 첨부 이미지를 서빙(영구 폴백). 클라 썸네일은 원래 제출 시점
   *  메모리 blob URL 에만 의존해 detach 별창·새로고침·재시작·부팅복원에서 소실됐다 → 이 라우트로
   *  파일을 직접 받아 현재 document 에서 blob 재생성. 경로 검증: 해당 세션 attachments 디렉토리
   *  내부 파일만 허용(트래버설 차단). IPC 트랜스포트가 비텍스트 응답을 base64 로 무손실 전달. */
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

  /** POST /api/commands/:sessionId — 명령 추가.
   *  두 경로 수용: (1) JSON `{ text, subAgentId?, attachments?, dispatchMode? }`,
   *  (2) raw text/plain 본문 — 하네스 빌더(§5.3 #10-2 v2.45) 가 엔트리 노드를 escape-free 로 kickoff.
   *  §5.5 #17-18 v4.68 — `dispatchMode` 미지정/알 수 없는 값이면 기본(합치기)으로 떨어진다. */
  app.post('/api/commands/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    let text: string | undefined;
    let subAgentId: string | null | undefined;
    let attachments: string[] | undefined;
    let dispatchMode: CommandDispatchMode = DEFAULT_COMMAND_DISPATCH_MODE;
    if (typeof req.body === 'string') {
      // express.text() 가 파싱한 raw 본문. 끝의 heredoc 잔여 개행만 정리.
      text = req.body.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    } else {
      const body = (req.body ?? {}) as { text?: string; subAgentId?: string | null; attachments?: string[]; dispatchMode?: unknown };
      text = body.text;
      subAgentId = body.subAgentId;
      attachments = body.attachments;
      dispatchMode = normalizeCommandDispatchMode(body.dispatchMode);
    }
    if (typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text required' });
      return;
    }

    const agentId = graphManager.findAgentIdBySession(sessionId);
    const agentBubble = graphManager.getAgentBySession(sessionId);

    // §5.5 #17-29 — 훅 버블은 읽기 전용. 우리가 spawn 하지 않은 외부 세션이라 여기에 명령을 넣으면
    //   스폰 주입(컨텍스트 요약·카드 지시문·목표·집행 플러그인) 없이 매달리는 자식이 생긴다.
    //   클라 UI 를 우회한 curl 도 여기서 막힌다 — 화면이 아니라 서버가 경계의 권위다.
    if (isReadOnlyHookAgent(agentBubble)) {
      res.status(403).json({ error: READ_ONLY_HOOK_AGENT_ERROR });
      return;
    }

    // subagent 결정: 지정된 ID 사용 → (커스텀: 정규 sub 1개 고정 재사용) → idle 재사용 → 새로 생성
    let resolvedSubId = subAgentId ?? null;
    if (!resolvedSubId && agentId) {
      if (agentBubble?.customCreated) {
        // v1.77 (Direction A) — 커스텀 에이전트 = 하나의 안정 대화. 명령마다 새 sub 를
        // 만들면 sub.sessionId 가 매번 비어 새 Claude 세션이 생기고(연속성 상실) 그게
        // 또 새 훅 버블로 증식한다. 정규 sub(대화 성립된 것 우선) 하나만 계속 재사용.
        // 진행 중이면 processNextCommand 의 busy 가드가 자동 큐잉(동시 dispatch 방지).
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

    // v1.35 — attachments 경로 검증: 해당 세션의 attachments 디렉토리 내부인 것만 허용.
    // 위조된 경로로 CLI 에게 임의 파일 경로 주입 방지.
    // v1.38 — 제출 확정 시 <agentPath>/<subId>/<uuid>.<ext> 로 이동하여 서브세션별 격리.
    //         이동 실패(권한/크로스 디바이스)시 원본 경로 유지.
    let resolvedAttachments: string[] | undefined;
    if (Array.isArray(attachments) && attachments.length > 0) {
      const cwd = graphManager.getAgentCwd(sessionId);
      if (cwd) {
        const expectedDir = path.resolve(path.join(cwd, '.vibisual', 'attachments', sessionId));
        const valid: string[] = [];
        for (const a of attachments) {
          if (typeof a !== 'string') continue;
          const resolved = path.resolve(a);
          if (resolved.startsWith(expectedDir + path.sep) && fs.existsSync(resolved)) {
            valid.push(resolved);
          }
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
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now()}-${queue.length}`,
      text: text.trim(),
      timestamp: Date.now(),
      subAgentId: resolvedSubId,
      status: 'queued' as const,
      ...(resolvedAttachments ? { attachments: resolvedAttachments } : {}),
      // §5.5 #17-18 v4.68 — 항상 명시 저장. 화면의 [대기|합치기|즉시] 칩이 이 값을 그대로 그린다.
      dispatchMode,
    };
    queue.push(cmd);
    // §5.5 #17-18 v4.68 — '즉시'면 도는 턴을 먼저 끊는다. 끊긴 뒤 close 핸들러 → setOnComplete 가
    //   이 명령을 `--resume` 으로 dispatch 하므로, 여기서 또 밀면 죽어가는 자식과 겹칠 수 있다.
    const interrupted = dispatchMode === 'immediate' && interruptForImmediateCommand(cmd);
    // §5.5 #17-4 v2.36 — 명령 텍스트의 `/skill-name` 토큰들을 프로젝트 사용 카운트에 반영.
    //                    SkillsView 가 정렬 키·배지로 사용.
    graphManager.recordSkillUsageFromCommandText(sessionId, cmd.text);
    res.json({ ok: true, command: cmd });
    broadcastSnapshot();

    // 즉시 실행 시도 (끊은 경우는 그 턴이 마감되는 시점에 자동으로 이어진다)
    if (!interrupted) processNextCommand(sessionId);
  });

  /**
   * §5.5 #17-18 v4.68 — PATCH /api/commands/:sessionId/:commandId/mode — 대기 중인 명령의 처리 방식 변경.
   *
   * body `{ dispatchMode: 'wait' | 'merge' | 'immediate' }`. **아직 큐에 있는(`queued`) 명령만** 대상 —
   * 이미 나간 턴의 방식을 되돌릴 방법은 없다(409). `immediate` 로 바꾸면 그 자리에서 도는 턴을 끊고
   * 이 명령이 다음 턴이 된다.
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
    if (mode === 'immediate') interrupted = interruptForImmediateCommand(cmd);
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
    if (idx >= 0) queue.splice(idx, 1);
    res.json({ ok: true });
    broadcastSnapshot();
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

  /** PUT /api/commands/:sessionId/reorder — 순서 변경 */
  app.put('/api/commands/:sessionId/reorder', (req, res) => {
    const { sessionId } = req.params;
    const { fromIndex, toIndex } = req.body as { fromIndex?: number; toIndex?: number };
    if (typeof fromIndex !== 'number' || typeof toIndex !== 'number') {
      res.status(400).json({ error: 'fromIndex and toIndex required' });
      return;
    }
    const queue = commandQueues.get(sessionId);
    if (!queue) { res.json({ ok: true }); return; }
    const [moved] = queue.splice(fromIndex, 1);
    if (moved) queue.splice(toIndex, 0, moved);
    res.json({ ok: true });
    broadcastSnapshot();
  });

  /**
   * §5.5 #17-11 v3.79 — PUT /api/session-loop/:agentId/:subId — 세션 반복 실행(루프) 설정 저장.
   *
   * body: `{ command, mode:'count'|'infinite', total?, intervalMs?, stopOnError?, contextMode?,
   *   maxCostUsd?, maxTokens?, maxDurationMs?, progressFile?, oneTaskPerRound?, commitEachRound?,
   *   commandFile?, enabled? }` (전체 저장 — 한 필드만 보내면 나머지는 기본값으로 되돌아간다).
   * `enabled:true` 면 저장 즉시 1회차를 발사한다(사용자가 [시작]을 눌렀다는 뜻).
   * 렌더러 in-process fetch 라 loopback 화이트리스트 불요(§4 v3.21 agent-feedback 선례).
   */
  app.put('/api/session-loop/:agentId/:subId', (req, res) => {
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
   * §5.5 #17-11 v3.79 — DELETE /api/session-loop/:agentId/:subId — 루프 설정 삭제.
   * body `{ stopOnly: true }` 면 설정은 남기고 정지만(사용자 [정지] 버튼). 없는 루프여도 200(멱등).
   */
  app.delete('/api/session-loop/:agentId/:subId', (req, res) => {
    const { agentId, subId } = req.params;
    const stopOnly = !!(req.body as { stopOnly?: boolean } | undefined)?.stopOnly;
    if (stopOnly) {
      stopSessionLoop(subId, 'stopped');
    } else {
      clearSessionLoopTimer(subId);
      graphManager.deleteSessionLoop(subId);
    }
    // §5.5 #17-11 v3.92 — 루프가 꺼졌으니 그동안 보류돼 있던 완료 판정을 같은 스냅샷에서 낸다.
    //   (늦게 실리면 클라가 "루프 종료(침묵)" 와 "버블 완료(발화)" 를 별개 사건으로 보고 소리를 낸다.)
    graphManager.recomputeCustomAgentStatus(agentId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, ...(stopOnly ? { loop: graphManager.getSessionLoop(subId) } : {}) });
  });

  /**
   * §5.5 #17-17 v4.50 — 세션의 `TodoWrite` 계획을 목표 단계로 옮긴다.
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
   * §5.5 #17-17 v4.47 — 외부(에이전트 curl·렌더러)에서 온 단계 배열을 신뢰 가능한 형태로 정리.
   * 잡스러운 항목은 조용히 버린다 — 신고 하나가 형식이 틀렸다고 진행 갱신 전체를 막을 이유는 없다.
   */
  function parseGoalSteps(raw: unknown[]): { text: string; status?: SessionGoalStepStatus }[] {
    const out: { text: string; status?: SessionGoalStepStatus }[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        if (item.trim()) out.push({ text: item.trim() });
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const rec = item as { text?: unknown; status?: unknown };
      const text = typeof rec.text === 'string' ? rec.text.trim() : '';
      if (!text) continue;
      const status = rec.status === 'done' || rec.status === 'in_progress' || rec.status === 'pending'
        ? (rec.status as SessionGoalStepStatus)
        : undefined;
      out.push({ text, ...(status ? { status } : {}) });
    }
    return out;
  }

  /**
   * §5.5 #17-17 / §3.6 (판올림 번호 발급 대기) — **작업 장부(Task) 훅을 목표 단계로 흘린다.**
   *
   * `TaskCreate`/`TaskUpdate` 도구가 `TaskCreated`/`TaskCompleted` 훅을 낸다. 이것이 목표 창이
   * 지금까지 REST 로 흉내 내던 것의 **원본**이다 — 종전에는 그 도구도 목록에 없었고 훅도 걸려
   * 있지 않아, 세션이 작업 장부를 써도 화면에는 한 줄도 오지 않았다.
   *
   * 단계 목록은 **본문(제목)으로 이어 붙인다** — 목표 창 규약이 "같은 본문이 같은 항목"이고,
   * `rebuildGoalSteps` 가 그 규칙으로 id 를 물려주므로 여기서 별도 장부를 들 이유가 없다
   * (새 저장소를 만들면 그것만 따로 비워지거나 따로 새는 자리가 하나 더 생긴다).
   *
   * 우리 관할이 아닌 세션(agentId·subAgentId 미상)은 조용히 지나간다 — 목표 창은 우리가 띄운
   * 세션의 것이고, 남의 세션 훅으로 남의 카드를 만들지 않는다.
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
   * §5.5 #17-17 v4.46 — PUT /api/session-goal/:agentId/:subId — 세션 목표 저장(생성·수정·상태 변경).   *
   * body: `{ text, status? }`. 목표 문장이 실제로 바뀌면 서버가 `revision++` 으로
   * plan 자동 폴백을 다시 연다(#17-17 ③). 진행률·이력은 보존한다 — 문장을 다듬는 것과
   * 진행을 되감는 것은 다른 일이다. loopback 화이트리스트에는 오르지 않는다(목표는 사용자 것).
   */
  app.put('/api/session-goal/:agentId/:subId', (req, res) => {
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
   * §5.5 #17-17 v4.46 — POST /api/session-goal/:agentId/:subId/progress — 진행률 갱신.
   *
   * 두 호출자가 같은 문을 쓴다: (a) 주입 지시문을 받은 **에이전트**(외부 프로세스 → loopback,
   * 토큰 필수 — 화이트리스트에 오르는 유일한 목표 경로), (b) 패널에서 직접 끄는 **사용자**
   * (렌더러 in-process fetch, `source:'user'`). 우선순위 판정은 서버(ProjectGraph)가 한다.
   */
  app.post('/api/session-goal/:agentId/:subId/progress', (req, res) => {
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

  /**
   * §5.5 #17-17 v4.46 — DELETE /api/session-goal/:agentId/:subId — 목표 해제(삭제).
   * 없는 목표여도 200(멱등) — 사용자가 두 번 눌러도 에러가 뜨지 않게.
   */
  app.delete('/api/session-goal/:agentId/:subId', (req, res) => {
    const { subId } = req.params;
    graphManager.deleteSessionGoal(subId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  // ─── §5.5 #17-28 — 컨텍스트 주입원 통제 REST ───
  //
  // 조회는 **매번 다시 잰다**(캐시 ❌). 사용자가 이 창을 여는 순간이 "지금 무엇이 실리는가"를 묻는
  // 순간이고, 캐시된 표는 그 물음에 옛날 답을 준다. 파일 스캔은 사용자가 창을 열 때만 돈다.

  /**
   * 목록과 상세가 **같은 실측**을 보게 하는 한 곳.
   *
   * 표(`GET /api/context-inventory`)와 상세창(`GET /api/context-source`)이 각자 재면, 그 사이에
   * 파일이 바뀌었을 때 "표는 9,000자라는데 본문은 다른 것"이 된다. 두 라우트가 이 함수를 함께 쓴다.
   */
  function measureContextForAgent(agentId: string, subAgentId?: string): { inventory: ContextInventory; parts: MeasuredPart[] } | null {
    // 버블 id 로 에이전트를 찾는 표준 경로는 스냅샷의 `agents` 배열이다(다른 라우트와 같은 방식).
    const agent = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
    if (!agent) return null;

    const projectPath = graphManager.getProjectPathForAgent(agentId) ?? graphManager.getRoot() ?? '';
    const cwd = graphManager.getAgentCwdByAgentId(agentId) ?? projectPath;
    const agentConfig = graphManager.getAgentConfig(agentId);
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
      ...(agentConfig ? { agentConfig } : {}),
      ...(graphManager.getContextOverrides() ? { overrides: graphManager.getContextOverrides() } : {}),
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
   * §5.5 #17-28 ⑦ — GET /api/context-source/:agentId?source=<id>&sub=<subAgentId>&file=<절대경로>
   *
   * 상세창이 "이 줄이 대체 무엇인가"에 **실물로** 답하기 위한 창구. 돌려주는 본문은 설명용 사본이
   * 아니라 이 턴에 실제로 조립된 문자열이고, 파일은 **그 순간 인벤토리에 실제로 들어 있는 경로**만
   * 열린다(⑤ — 이 창의 권한은 이미 실리고 있는 것을 보여 주는 데까지다). 읽기 전용.
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

  /**
   * PUT /api/context-overrides/:agentId — 주입원 한 줄의 켬/끔.
   * body: `{ sourceId, enabled: boolean|null, scope: 'project'|'session', subAgentId? }`
   * `enabled: null` 은 오버라이드 해제(기본값으로 되돌림).
   */
  app.put('/api/context-overrides/:agentId', (req, res) => {
    try {
      const { agentId } = req.params;
      const body = req.body as { sourceId?: unknown; enabled?: unknown; scope?: unknown; subAgentId?: unknown };
      const sourceId = typeof body.sourceId === 'string' ? body.sourceId.trim() : '';
      if (!sourceId) return res.status(400).json({ error: 'sourceId required' });
      const enabled = body.enabled === null ? null : body.enabled === true ? true : body.enabled === false ? false : undefined;
      if (enabled === undefined) return res.status(400).json({ error: 'enabled must be boolean or null' });

      const sessionScope = body.scope === 'session';
      const subAgentId = typeof body.subAgentId === 'string' ? body.subAgentId : '';
      if (sessionScope && !subAgentId) return res.status(400).json({ error: 'subAgentId required for session scope' });

      graphManager.setContextOverride(
        {
          agentId,
          ...(sessionScope ? { subAgentId } : { projectKey: graphManager.getAgentProjectName(agentId) ?? '' }),
        },
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

  /** DELETE /api/context-overrides/:agentId?scope=project|session&sub=… — 그 층을 전부 기본값으로. */
  app.delete('/api/context-overrides/:agentId', (req, res) => {
    try {
      const { agentId } = req.params;
      const sessionScope = req.query['scope'] === 'session';
      const subAgentId = typeof req.query['sub'] === 'string' ? String(req.query['sub']) : '';
      if (sessionScope && !subAgentId) return res.status(400).json({ error: 'sub required for session scope' });
      graphManager.clearContextOverrides(
        sessionScope
          ? { subAgentId }
          : { projectKey: graphManager.getAgentProjectName(agentId) ?? '' },
      );
      broadcastSnapshot();
      saveCheckpoint();
      return res.json({ ok: true, overrides: graphManager.getContextOverrides() ?? null });
    } catch (err) {
      logger.error('DELETE /api/context-overrides failed', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/create-custom-agent — 캔버스에서 커스텀 에이전트 생성.
   *  §4 v2.63 — `executionMode:'interactive-terminal'` 이면 CMD(인터랙티브 터미널) 에이전트로 baked. */
  app.post('/api/create-custom-agent', (req, res) => {
    try {
      const { label, x, y, project, executionMode, provider: providerRaw } = req.body as {
        label?: string; x?: number; y?: number; project?: string;
        executionMode?: 'headless' | 'interactive-terminal';
        // §5.19 (B) — All Model 버블. **모델 없이도 온다** — 우클릭으로 고른 순간 버블이 먼저 생기고
        //   모델은 그 버블을 눌렀을 때 매인다(진입 순서 역전). 그래서 modelId 가 비었다고 버리면 안 된다.
        provider?: unknown;
      };
      const position = typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
      const provider: AgentProvider | undefined = normalizeAgentProvider(providerRaw);
      const options =
        executionMode === 'interactive-terminal'
          ? { executionMode, ...(provider ? { provider } : {}) }
          : provider
            ? { provider }
            : undefined;
      if (!graphManager.hasOpenProject()) return respondNoProjectFolder(res, 'create-custom-agent');
      const agent = graphManager.createCustomAgent(label ?? '', position, project ?? null, options);
      if (!agent) return respondNoProjectFolder(res, 'create-custom-agent');
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
   * POST /api/trash/purge — 휴지통 일괄 영구 삭제(§5.10 v4.84 — [모두 삭제] · Delete 키 다중 선택).
   * `sessionIds` 는 세션 키·버블 id 혼재를 허용(단건 경로와 동일). 개별 DELETE 를 N 번 쏘면 서버가
   * 스냅샷을 N 번 브로드캐스트해 버블이 여러 번 나눠 사라지므로, 여기서 모아 지우고 **한 번만** 알린다
   * (§5.7 `/api/bubbles/delete` 와 같은 문법). 확인 팝업은 클라가 이미 거친 뒤다.
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

  // ─── §5.10 Project Brain — 기억 카드 REST (CommentBox 관례 + 프로젝트 스코프) ───

  /**
   * §5.10 v2 (H) — **게이트 ④ REST.** 두뇌가 꺼진 프로젝트에서는 브레인 API 를 닫는다.
   *
   * 예외는 활성화 자체를 읽고 쓰는 `/api/brain/activation` 뿐이다 — 켜기 UI 가
   * "몇 장이 잠들어 있는지"를 보여줘야 하므로 꺼진 상태에서도 답해야 한다.
   * 이 미들웨어는 아래 브레인 라우트들보다 **먼저** 등록돼야 한다(Express 는 등록 순서로 매칭).
   */
  app.use('/api/brain', (req, res, next) => {
    if (req.path === '/activation') { next(); return; }
    const project = typeof req.query.project === 'string' ? req.query.project : undefined;
    const root = graphManager.resolveBrainRoot(project);
    if (brainEnabledFor(root)) { next(); return; }
    res.status(403).json({ ok: false, error: 'brain-disabled' });
  });

  /**
   * §5.10 v2 (H) — GET /api/brain/activation?project=
   *
   * 게이트를 통과하는 **유일한 예외**. 꺼져 있어도 답한다 — 응답의 `sleepingCardCount` 가
   * 첫 실행 1회 안내("두뇌에 N장이 잠들어 있습니다 — 켤까요?")의 근거다.
   * 카드 **본문은 싣지 않는다**(꺼진 두뇌의 내용이 새 나가지 않게).
   */
  app.get('/api/brain/activation', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) {
        res.json({ root: null, enabled: false, activation: null, axes: [], sleepingCardCount: 0 });
        return;
      }
      const activation = brainActivationFor(root);
      let sleepingCardCount = 0;
      try { sleepingCardCount = getBrainService(root).getSummary().cardCount; } catch { /* best effort */ }
      res.json({
        root,
        enabled: activation?.enabled === true,
        activation: activation ?? null,
        axes: BRAIN_AXIS_IDS.map((id) => ({ id, enabled: brainAxisEnabledFor(root, id) })),
        sleepingCardCount,
      });
    } catch (err) {
      logger.error('GET /api/brain/activation failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v2 (H) — PUT /api/brain/activation — 마스터·축 켜고 끄기, 그리고 1회 안내 표시 기록.
   *
   * `prompted: true` 는 **거절했을 때도** 보낸다 — `promptedAt` 이 남아야 다시 묻지 않는다.
   * 끄기는 동작 정지일 뿐이라 **카드 파일은 건드리지 않는다**(§5.11 "끄면 지우지 않는다" 승계).
   */
  app.put('/api/brain/activation', async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        project?: string;
        enabled?: boolean;
        axes?: Record<string, unknown>;
        prompted?: boolean;
      };
      const root = graphManager.resolveBrainRoot(typeof body.project === 'string' ? body.project : undefined);
      if (!root) {
        res.status(400).json({ ok: false, error: 'no project' });
        return;
      }
      const prev = userDefaultsService.get().brainByProject ?? {};
      // 플랫폼을 넘겨 linux 에서 케이스만 다른 두 프로젝트가 한 칸을 공유하지 않게 한다.
      // (`resolveBrainProjectKey` 는 못 찾으면 예전 소문자 키도 한 번 더 본다 — 기존 설정 보존.)
      const key = resolveBrainProjectKey(prev, root, process.platform);
      const cur: BrainActivation = prev[key] ?? { enabled: false };
      const next: BrainActivation = { ...cur };
      if (typeof body.enabled === 'boolean') {
        next.enabled = body.enabled;
        if (body.enabled) next.enabledAt = Date.now();
      }
      if (body.axes && typeof body.axes === 'object') {
        // 모르는 축 이름은 버린다 — 오타가 조용히 저장돼 영영 안 읽히는 스위치가 되는 것을 막는다.
        const axes: Partial<Record<BrainAxisId, boolean>> = { ...cur.axes };
        for (const id of BRAIN_AXIS_IDS) {
          const v = body.axes[id];
          if (typeof v === 'boolean') axes[id] = v;
        }
        next.axes = axes;
      }
      if (body.prompted === true) next.promptedAt = Date.now();
      await userDefaultsService.update({ brainByProject: { ...prev, [key]: next } });
      // 켜짐이 바뀌면 표시(게이트 ③)가 달라지므로 스냅샷을 다시 보낸다.
      broadcastSnapshot();
      res.json({ ok: true, root, activation: next });
    } catch (err) {
      logger.error('PUT /api/brain/activation failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── §5.10 v2 (B) 스킬 자산 ───────────────────────────────────────────────
  // 카드와 나란한 자산이라 라우트도 카드 옆에 둔다. 전부 위 게이트 ④ 안쪽이다
  // (두뇌가 꺼진 프로젝트에서는 403 — 스킬도 두뇌의 일부다).

  /** GET /api/brain/skills?project=&scope=&agentId=&includeArchived= — 스킬 목록. */
  app.get('/api/brain/skills', (req, res) => {
    try {
      const root = graphManager.resolveBrainRoot(
        typeof req.query.project === 'string' ? req.query.project : undefined,
      );
      if (!root) { res.json({ skills: [] }); return; }
      const scope = req.query.scope === 'agent' ? 'agent' : req.query.scope === 'user' ? 'user' : undefined;
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
      const skills = getBrainSkillService(root).listSkills({
        ...(scope ? { scope } : {}),
        ...(agentId ? { agentId } : {}),
        ...(req.query.includeArchived === 'true' ? { includeArchived: true } : {}),
      });
      res.json({ skills });
    } catch (err) {
      logger.error('GET /api/brain/skills failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/brain/skills — 절차를 굳힌다.
   * 에이전트가 직접 부르는 자리이기도 하다(리플렉션이 뽑은 초안 · lesson 승급).
   */
  app.post('/api/brain/skills', (req, res) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const root = graphManager.resolveBrainRoot(typeof b.project === 'string' ? b.project : undefined);
      if (!root) { res.status(400).json({ ok: false, error: 'no project' }); return; }
      const name = typeof b.name === 'string' ? b.name.trim() : '';
      const description = typeof b.description === 'string' ? b.description.trim() : '';
      const body = typeof b.body === 'string' ? b.body : '';
      // agentskills.io 필수 두 필드가 없으면 스킬이 아니다 — 빈 껍데기를 만들지 않는다.
      if (!name || !description || !body.trim()) {
        res.status(400).json({ ok: false, error: 'name, description, body are required' });
        return;
      }
      const scope: BrainCardScope = b.scope === 'agent' ? 'agent' : b.scope === 'user' ? 'user' : 'project';
      const skill = getBrainSkillService(root).createSkill({
        name,
        description,
        body,
        scope,
        ...(typeof b.id === 'string' ? { id: b.id } : {}),
        ...(typeof b.agentId === 'string' ? { agentId: b.agentId } : {}),
        ...(typeof b.topic === 'string' ? { topic: b.topic } : {}),
        ...(Array.isArray(b.files) ? { files: b.files.filter((f): f is string => typeof f === 'string') } : {}),
        ...(typeof b.sourceSessionId === 'string' ? { sourceSessionId: b.sourceSessionId } : {}),
        ...(Array.isArray(b.originCardIds)
          ? { originCardIds: b.originCardIds.filter((f): f is string => typeof f === 'string') }
          : {}),
      });
      broadcastSnapshot();
      res.json({ ok: true, skill });
    } catch (err) {
      logger.error('POST /api/brain/skills failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/brain/skills/:id — 개정(옛 판은 보존된다). */
  app.patch('/api/brain/skills/:id', (req, res) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const root = graphManager.resolveBrainRoot(typeof b.project === 'string' ? b.project : undefined);
      if (!root) { res.status(400).json({ ok: false, error: 'no project' }); return; }
      const skill = getBrainSkillService(root).reviseSkill(String(req.params.id ?? ''), {
        ...(typeof b.name === 'string' ? { name: b.name } : {}),
        ...(typeof b.description === 'string' ? { description: b.description } : {}),
        ...(typeof b.body === 'string' ? { body: b.body } : {}),
        ...(typeof b.topic === 'string' ? { topic: b.topic } : {}),
        ...(Array.isArray(b.files) ? { files: b.files.filter((f): f is string => typeof f === 'string') } : {}),
      });
      if (!skill) { res.status(404).json({ ok: false, error: 'not found' }); return; }
      broadcastSnapshot();
      res.json({ ok: true, skill });
    } catch (err) {
      logger.error('PATCH /api/brain/skills/:id failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/brain/skills/:id/:action — activate | archive | helpful. */
  app.post('/api/brain/skills/:id/:action', (req, res) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const root = graphManager.resolveBrainRoot(typeof b.project === 'string' ? b.project : undefined);
      if (!root) { res.status(400).json({ ok: false, error: 'no project' }); return; }
      const svc = getBrainSkillService(root);
      const id = String(req.params.id ?? '');
      const action = String(req.params.action ?? '');
      const skill = action === 'activate' ? svc.activateSkill(id)
        : action === 'archive' ? svc.archiveSkill(id)
          : action === 'helpful' ? svc.markHelpful(id)
            : undefined;
      if (skill === undefined) { res.status(400).json({ ok: false, error: 'unknown action' }); return; }
      if (skill === null) { res.status(404).json({ ok: false, error: 'not found' }); return; }
      broadcastSnapshot();
      res.json({ ok: true, skill });
    } catch (err) {
      logger.error('POST /api/brain/skills/:id/:action failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/brain/skill-candidates?project= — lesson 승급 후보.
   * "같은 주제 lesson 이 N장 모였다 = 한 절차를 여러 번 다시 배우고 있다"는 신호다.
   */
  app.get('/api/brain/skill-candidates', (req, res) => {
    try {
      const root = graphManager.resolveBrainRoot(
        typeof req.query.project === 'string' ? req.query.project : undefined,
      );
      if (!root) { res.json({ candidates: [] }); return; }
      const cards = getBrainService(root).listCards({});
      const candidates = getBrainSkillService(root).promotionCandidates(cards);
      // 카드 본문은 목록에 싣지 않는다(스냅샷·목록은 요약만 — §9 perf 와 같은 규율).
      res.json({
        candidates: candidates.map((c) => ({
          topic: c.topic,
          scope: c.scope,
          ...(c.agentId ? { agentId: c.agentId } : {}),
          count: c.cards.length,
          cards: c.cards.map((k) => ({ id: k.id, title: k.title })),
        })),
      });
    } catch (err) {
      logger.error('GET /api/brain/skill-candidates failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v2 (F) — GET /api/brain/curator?project= — **입양 대기 레일.**
   *
   * 실측에서 새는 자리가 셋이었다: `topic: misc` 102장(31%) · `refCount: 0` 263장(80%) ·
   * `verifyState: candidate` 234장. 셋 다 "쌓였지만 쓰이지 않는" 상태이고, 흩어져 있으면
   * 아무도 손대지 않는다. 한 화면에 모아 **사유별로** 보여 준다.
   */
  app.get('/api/brain/curator', (req, res) => {
    try {
      const root = graphManager.resolveBrainRoot(
        typeof req.query.project === 'string' ? req.query.project : undefined,
      );
      if (!root) { res.json({ cards: [], counts: { misc: 0, unreferenced: 0, candidate: 0 } }); return; }
      if (!brainAxisEnabledFor(root, 'curator')) {
        res.status(403).json({ ok: false, error: 'brain-axis-disabled', axis: 'curator' });
        return;
      }
      const all = getBrainService(root).listCards({});
      const counts = { misc: 0, unreferenced: 0, candidate: 0 };
      const picked: { card: (typeof all)[number]; reasons: string[] }[] = [];
      for (const c of all) {
        const reasons: string[] = [];
        if (!c.topic || c.topic === BRAIN_TOPIC_MISC) { reasons.push('misc'); counts.misc++; }
        if ((c.refCount ?? 0) === 0) { reasons.push('unreferenced'); counts.unreferenced++; }
        if ((c.verifyState ?? 'candidate') === 'candidate') { reasons.push('candidate'); counts.candidate++; }
        if (reasons.length > 0) picked.push({ card: c, reasons });
      }
      // 사유가 많은 것부터 — 세 가지에 다 걸린 카드가 가장 먼저 손댈 자리다.
      picked.sort((a, b) => b.reasons.length - a.reasons.length || b.card.updatedAt - a.card.updatedAt);
      res.json({
        counts,
        cards: picked.slice(0, BRAIN_CURATOR_PAGE_SIZE).map((p) => ({ ...p.card, curatorReasons: p.reasons })),
        total: picked.length,
      });
    } catch (err) {
      logger.error('GET /api/brain/curator failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v2 (E) — POST /api/brain/cards/:id/ground — 이 카드를 **지금 코드와 대조**한다.
   *
   * 통과하면 기존 승격 관문(`confirmCard`)이 `repository-source` 권위로 올린다.
   * 실패해도 강등하지 않는다 — 증거를 못 찾은 것과 틀린 것은 다르다.
   */
  app.post('/api/brain/cards/:id/ground', (req, res) => {
    try {
      const b = (req.body ?? {}) as Record<string, unknown>;
      const root = graphManager.resolveBrainRoot(typeof b.project === 'string' ? b.project : undefined);
      if (!root) { res.status(400).json({ ok: false, error: 'no project' }); return; }
      if (!brainAxisEnabledFor(root, 'grounding')) {
        res.status(403).json({ ok: false, error: 'brain-axis-disabled', axis: 'grounding' });
        return;
      }
      const result = applyGrounding(root, String(req.params.id ?? ''));
      if (!result) { res.status(404).json({ ok: false, error: 'not found' }); return; }
      broadcastSnapshot();
      res.json({ ok: true, result, card: getBrainService(root).getCard(String(req.params.id ?? '')) });
    } catch (err) {
      logger.error('POST /api/brain/cards/:id/ground failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v2 (C) — GET /api/brain/recall?q=&project= — **과거 세션 본문** 회상.
   *
   * 카드 검색(`/api/brain/search`)과 짝이지만 찾는 대상이 다르다: 카드는 리플렉션이 남길 만하다고
   * 판단한 것만 있고, 이쪽은 **그때 실제로 오간 대화**다("그때 이거 어떻게 고쳤더라").
   * 에이전트가 직접 부르는 자리라 loopback 화이트리스트에도 올라간다.
   */
  app.get('/api/brain/recall', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) { res.json({ hits: [] }); return; }
      if (!brainAxisEnabledFor(root, 'recall')) {
        // 조용히 빈 배열을 주면 "찾은 게 없다"와 구별이 안 된다 — 꺼져 있음을 말해 준다.
        res.status(403).json({ ok: false, error: 'brain-axis-disabled', axis: 'recall' });
        return;
      }
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      if (!q.trim()) { res.status(400).json({ ok: false, error: 'q is required' }); return; }
      const limit = Number(req.query.limit);
      const hits = recallFromSessions({
        root,
        cwd: root,
        query: q,
        ...(Number.isFinite(limit) && limit > 0 ? { options: { limit } } : {}),
      });
      res.json({ hits });
    } catch (err) {
      logger.error('GET /api/brain/recall failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  /**
   * GET /api/brain/feed?project=&scope=&agentId=&q= — v3.49 유튜브식 피드(우더블클릭 오버레이).
   * ctx.text = q; agentId 가 있으면 그 에이전트가 최근 참조한 파일들을 ctx.files 로 실어 related 랭킹을 보정한다
   * (graphManager.getAgentRecentFiles — best-effort, 없으면 파일 컨텍스트 생략). 읽기 전용(broadcast 없음).
   */
  app.get('/api/brain/feed', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const scope: BrainCardScope = req.query.scope === 'agent' ? 'agent' : 'project';
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.json({ feed: { sections: { related: [], recent: [], frequent: [], resurface: [] }, totalCount: 0 } });
      const files = scope === 'agent' && agentId ? graphManager.getAgentRecentFiles(agentId) : [];
      const ctx = (q && q.trim()) || files.length > 0
        ? { text: q && q.trim() ? q : undefined, files: files.length > 0 ? files : undefined }
        : undefined;
      const feed = getBrainService(root).getFeed({ scope, agentId, ctx });
      res.json({ feed });
    } catch (err) {
      logger.error('GET /api/brain/feed failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.74 — GET /api/brain/topics?project= — 프로젝트 층 주제 색인(카드 있는 주제만).
   * 스폰 브리핑에 실리는 것과 같은 목록. 에이전트는 색인의 `docPath` 를 Read 하거나 아래 :slug 로 받는다.
   */
  app.get('/api/brain/topics', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.json({ topics: [] });
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
      res.json({ topics: getBrainService(root).listTopicIndex(agentId) });
    } catch (err) {
      logger.error('GET /api/brain/topics failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.74 — GET /api/brain/topics/:slug?project= — 주제 문서 본문(마크다운).
   * 파일을 직접 Read 할 수 없는 경로(원격·다른 cwd)를 위한 창구 — 내용은 문서 파일과 동일하게 렌더한다.
   * 카드가 하나도 없는 주제는 404(빈 문서를 헛읽지 않게).
   */
  app.get('/api/brain/topics/:slug', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.status(404).json({ error: 'no brain root' });
      const svc = getBrainService(root);
      const slug = String(req.params.slug ?? '');
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
      const cards = svc.listCardsByTopic(slug, agentId);
      if (cards.length === 0) return res.status(404).json({ error: 'topic not found or empty' });
      // 주제 문서 열람도 참조로 집계한다(브리핑 주입과 같은 기준 — 랭킹 신선도에 반영).
      svc.touchReferences(cards.map((c) => c.id));
      // v3.75 — UI(기억 라이브러리)는 카드별 버튼(👍·편집)이 필요해 JSON 을 쓰고,
      //   에이전트는 마크다운 문서를 그대로 읽는다. 같은 데이터의 두 표현.
      if (req.query.format === 'json') return res.json({ cards });
      res.type('text/markdown; charset=utf-8').send(svc.renderTopicDoc(slug, agentId));
    } catch (err) {
      logger.error('GET /api/brain/topics/:slug failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** GET /api/brain/cards?scope=&agentId=&project= — 카드 목록(본문 포함, lazy fetch). */
  app.get('/api/brain/cards', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const scope = req.query.scope === 'project' || req.query.scope === 'agent'
        ? (req.query.scope as BrainCardScope) : undefined;
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.json({ cards: [] });
      res.json({ cards: getBrainService(root).listCards({ scope, agentId }) });
    } catch (err) {
      logger.error('GET /api/brain/cards failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/brain/cards — 수동 저장("두뇌에 기억"). 중복 검사 창구 경유. */
  app.post('/api/brain/cards', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<BrainCardInput> & { project?: string };
      const type = body.type as BrainCardType;
      const scope = body.scope as BrainCardScope;
      if (!type || (scope !== 'project' && scope !== 'agent') || typeof body.title !== 'string' || !body.title.trim()) {
        return res.status(400).json({ error: 'type/scope/title required' });
      }
      const root = graphManager.resolveBrainRoot(body.project);
      if (!root) return res.status(404).json({ error: 'no project root' });
      const card = getBrainService(root).saveCard({
        type,
        scope,
        agentId: scope === 'agent' ? body.agentId : undefined,
        title: body.title,
        body: typeof body.body === 'string' ? body.body : '',
        files: Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === 'string') : [],
        sourceSessionId: typeof body.sourceSessionId === 'string' ? body.sourceSessionId : undefined,
        pinned: body.pinned === true,
        seen: true, // 사용자가 직접 만든 카드는 이미 "본" 것.
      });
      graphManager.notifyBrainChanged(body.project);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, card });
    } catch (err) {
      logger.error('POST /api/brain/cards failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** PATCH /api/brain/cards/:id — 부분 편집(undefined 필드는 유지 — PUT-wipe 회피). */
  app.patch('/api/brain/cards/:id', (req, res) => {
    try {
      const { id } = req.params;
      const body = (req.body ?? {}) as Partial<BrainCard> & { project?: string };
      const root = graphManager.resolveBrainRoot(body.project);
      if (!root) return res.status(404).json({ error: 'no project root' });
      const card = getBrainService(root).updateCard(id, {
        type: body.type,
        title: body.title,
        body: body.body,
        files: body.files,
        sourceSessionId: body.sourceSessionId,
        pinned: body.pinned,
        status: body.status,
        seen: body.seen,
        // §5.10 v3.74 — 주제 재지정(오분류 교정) + 상시 규칙 토글. 프로젝트 층 rule 에서만 의미.
        topic: body.topic,
        always: body.always,
      });
      if (!card) return res.status(404).json({ error: 'card not found' });
      graphManager.notifyBrainChanged(body.project);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, card });
    } catch (err) {
      logger.error('PATCH /api/brain/cards failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /api/brain/cards/:id — 카드 삭제(파괴적 — 클라에서 확인 후). */
  app.delete('/api/brain/cards/:id', (req, res) => {
    try {
      const { id } = req.params;
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.status(404).json({ error: 'no project root' });
      const ok = getBrainService(root).deleteCard(id);
      if (!ok) return res.status(404).json({ error: 'card not found' });
      graphManager.notifyBrainChanged(project);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true });
    } catch (err) {
      logger.error('DELETE /api/brain/cards failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/brain/cards/:id/promote — 개별(agent) 카드를 프로젝트 두뇌로 승격(이동). */
  app.post('/api/brain/cards/:id/promote', (req, res) => {
    try {
      const { id } = req.params;
      const project = typeof req.body?.project === 'string' ? req.body.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.status(404).json({ error: 'no project root' });
      const card = getBrainService(root).promoteCard(id);
      if (!card) return res.status(404).json({ error: 'card not found' });
      graphManager.notifyBrainChanged(project);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, card });
    } catch (err) {
      logger.error('POST /api/brain/cards/:id/promote failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/brain/cards/:id/seen — "최근 저장" 검토함 확인(배지 카운트 감소). */
  app.post('/api/brain/cards/:id/seen', (req, res) => {
    try {
      const { id } = req.params;
      const project = typeof req.body?.project === 'string' ? req.body.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.status(404).json({ error: 'no project root' });
      const card = getBrainService(root).markSeen(id);
      if (!card) return res.status(404).json({ error: 'card not found' });
      graphManager.notifyBrainChanged(project);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, card });
    } catch (err) {
      logger.error('POST /api/brain/cards/:id/seen failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/brain/cards/:id/helpful — v3.49 사용자 👍 "도움됨"(helpfulCount++). 파일은 디바운스 flush 로 영속.
   * **broadcast/saveCheckpoint 없음**(helpfulCount 는 스냅샷 요약에 없어 재계산 불요 — 비용 절감). 캐시만 무효화.
   */
  app.post('/api/brain/cards/:id/helpful', (req, res) => {
    try {
      const { id } = req.params;
      const project = typeof req.body?.project === 'string' ? req.body.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.status(404).json({ error: 'no project root' });
      const card = getBrainService(root).markHelpful(id);
      if (!card) return res.status(404).json({ error: 'card not found' });
      graphManager.notifyBrainChanged(project);
      res.json({ ok: true, card });
    } catch (err) {
      logger.error('POST /api/brain/cards/:id/helpful failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.78 — GET /api/brain/needs-check?project=&scope=&agentId= — **"확인 필요"** 목록.
   * 연결 파일이 수정돼 앵커가 깨진 카드들. 기억 화면 주제 레일 맨 위 특수 항목의 데이터원.
   */
  app.get('/api/brain/needs-check', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.json({ cards: [] });
      const scope = req.query.scope === 'project' || req.query.scope === 'agent'
        ? (req.query.scope as BrainCardScope) : undefined;
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
      res.json({ cards: getBrainService(root).listNeedsCheck({ scope, agentId }) });
    } catch (err) {
      logger.error('GET /api/brain/needs-check failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.78 — GET /api/brain/archive?project=&scope=&agentId= — **"정리됨"** 되돌림 목록.
   * 예산제로 보관된 카드들(파일은 `archive/` 에 그대로 있다 — 삭제된 게 아니다).
   */
  app.get('/api/brain/archive', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.json({ cards: [] });
      const scope = req.query.scope === 'project' || req.query.scope === 'agent'
        ? (req.query.scope as BrainCardScope) : undefined;
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
      res.json({ cards: getBrainService(root).listArchived({ scope, agentId }) });
    } catch (err) {
      logger.error('GET /api/brain/archive failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.81-B — GET /api/brain/current?project= — **현재 진실 인덱스**(계산 결과).
   * 슬롯별 상태(current/contested/none)와 다투는 카드 id 를 그대로 내려준다.
   */
  app.get('/api/brain/current', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.json({ entries: [] });
      res.json({ entries: getBrainService(root).listCurrentEntries() });
    } catch (err) {
      logger.error('GET /api/brain/current failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.81 — GET /api/brain/review-queue?project=&scope=&agentId= — **사람의 판단을 기다리는 카드**
   * (후보·충돌·확인 필요). 기억 화면 주제 레일의 특수 항목 데이터원.
   */
  app.get('/api/brain/review-queue', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.json({ cards: [], contested: [] });
      const scope = req.query.scope === 'project' || req.query.scope === 'agent'
        ? (req.query.scope as BrainCardScope) : undefined;
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
      const svc = getBrainService(root);
      res.json({ cards: svc.listReviewQueue({ scope, agentId }), contested: svc.listContested() });
    } catch (err) {
      logger.error('GET /api/brain/review-queue failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.81 — POST /api/brain/cards/:id/confirm — **사용자 명시 승인**(후보 → 현재 진실).
   * 같은 슬롯의 옛 진실은 §C 순서로 닫힌다(새 카드 먼저 쓰고 → 옛 카드 닫기). 삭제 ❌.
   */
  app.post('/api/brain/cards/:id/confirm', (req, res) => {
    try {
      const body = (req.body ?? {}) as { project?: string; reviewAfter?: number };
      const root = graphManager.resolveBrainRoot(body.project);
      if (!root) return res.status(404).json({ error: 'no brain root' });
      const card = getBrainService(root).confirmCard(String(req.params.id ?? ''), {
        authority: 'user-explicit',
        ...(typeof body.reviewAfter === 'number' ? { reviewAfter: body.reviewAfter } : {}),
      });
      if (!card) return res.status(404).json({ error: 'not found' });
      graphManager.notifyBrainChanged(body.project);
      broadcastSnapshot();
      res.json({ card });
    } catch (err) {
      logger.error('POST /api/brain/cards/:id/confirm failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.10 v3.81 — POST /api/brain/cards/:id/reject — 사용자 거부(파일 보존, 영구 주입 제외). */
  app.post('/api/brain/cards/:id/reject', (req, res) => {
    try {
      const body = (req.body ?? {}) as { project?: string };
      const root = graphManager.resolveBrainRoot(body.project);
      if (!root) return res.status(404).json({ error: 'no brain root' });
      const card = getBrainService(root).rejectCard(String(req.params.id ?? ''));
      if (!card) return res.status(404).json({ error: 'not found' });
      graphManager.notifyBrainChanged(body.project);
      broadcastSnapshot();
      res.json({ card });
    } catch (err) {
      logger.error('POST /api/brain/cards/:id/reject failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.81 단계 ⑨ — POST /api/brain/migrate/apply — **이행 적용**(frontmatter 필드 추가만).
   *
   * 본문·기존 값·파일 위치를 건드리지 않고 `canonicalKey`·`appliesTo`·`authority`·`verifyState` 만
   * 채운다. 기본은 **엄격안**(전부 `candidate`) — `verifyIntactFacts` 를 켤 때만 출처가 온전한
   * `fact` 를 `repository-source` 권위로 올린다. 재실행해도 결과가 같다(이미 키가 있으면 건너뜀).
   */
  app.post('/api/brain/migrate/apply', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        project?: string;
        resolutions?: Record<string, { canonicalKey?: string; appliesTo?: Record<string, string> }>;
        verifyIntactFacts?: boolean;
        dryRun?: boolean;
      };
      const root = graphManager.resolveBrainRoot(body.project);
      if (!root) return res.status(404).json({ error: 'no brain root' });
      const result = applyBrainMigration(getBrainService(root), root, {
        resolutions: body.resolutions ?? {},
        verifyIntactFacts: body.verifyIntactFacts === true,
        dryRun: body.dryRun === true,
      });
      graphManager.notifyBrainChanged(body.project);
      broadcastSnapshot();
      res.json(result);
    } catch (err) {
      logger.error('POST /api/brain/migrate/apply failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.81 단계 ① — GET /api/brain/migrate/dry-run?project= — **읽기 전용 이행 감사.**
   *
   * 저장고(Evidence)/SSOT(Canonical) 분리 전에 지금 카드가 어느 쪽 자격인지 세어 보는 보고서.
   * **파일을 쓰지 않는다** — 카드 상태도 바꾸지 않고, 같은 카드 집합이면 몇 번을 돌려도 같은 결과다.
   * 닫힌 카드·보관 카드까지 전부 넘긴다(이행 대상은 "지금 보이는 것"이 아니라 저장고 전량이므로).
   */
  app.get('/api/brain/migrate/dry-run', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.status(404).json({ error: 'no brain root' });
      const cards = getBrainService(root).listCards({ includeClosed: true, includeArchived: true });
      res.json(analyzeBrainMigration(cards, root));
    } catch (err) {
      logger.error('GET /api/brain/migrate/dry-run failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.10 v3.78 — GET /api/brain/cards/:id/chain?project= — 대체 이력 체인(옛 카드 ↔ 새 카드). */
  app.get('/api/brain/cards/:id/chain', (req, res) => {
    try {
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.json({ older: [], newer: [] });
      res.json(getBrainService(root).getSupersedeChain(String(req.params.id ?? '')));
    } catch (err) {
      logger.error('GET /api/brain/cards/:id/chain failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.78 — POST /api/brain/cards/:id/verify — "지금도 맞음". 앵커를 현재 해시로 다시 박고
   * 확인 필요를 해제한다. 사용자 버튼 채널(에이전트 채널은 작업 신고 `helpfulMemoryIds`).
   */
  app.post('/api/brain/cards/:id/verify', (req, res) => {
    try {
      const project = typeof req.body?.project === 'string' ? req.body.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.status(404).json({ error: 'no project root' });
      const card = getBrainService(root).reverifyCard(String(req.params.id ?? ''));
      if (!card) return res.status(404).json({ error: 'card not found' });
      graphManager.notifyBrainChanged(project);
      broadcastSnapshot();
      res.json({ ok: true, card });
    } catch (err) {
      logger.error('POST /api/brain/cards/:id/verify failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.10 v3.78 — POST /api/brain/cards/:id/stale — "낡음". 대체 후보로 적립하고 누적되면 자동 보관.
   * 파일 삭제 ❌ — "정리됨"에서 되돌릴 수 있다(자동 삭제 금지 원칙 준수).
   */
  app.post('/api/brain/cards/:id/stale', (req, res) => {
    try {
      const project = typeof req.body?.project === 'string' ? req.body.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.status(404).json({ error: 'no project root' });
      const card = getBrainService(root).markStale(String(req.params.id ?? ''));
      if (!card) return res.status(404).json({ error: 'card not found' });
      graphManager.notifyBrainChanged(project);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, card });
    } catch (err) {
      logger.error('POST /api/brain/cards/:id/stale failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** §5.10 v3.78 — POST /api/brain/cards/:id/restore — "정리됨" 되돌리기(보관 → 활성). */
  app.post('/api/brain/cards/:id/restore', (req, res) => {
    try {
      const project = typeof req.body?.project === 'string' ? req.body.project : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.status(404).json({ error: 'no project root' });
      const card = getBrainService(root).restoreCard(String(req.params.id ?? ''));
      if (!card) return res.status(404).json({ error: 'card not found' });
      graphManager.notifyBrainChanged(project);
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, card });
    } catch (err) {
      logger.error('POST /api/brain/cards/:id/restore failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/brain/search?q=&scope=&agentId=&project= — 능동 검색(두 층 합산, 경량 텍스트).
   * loopback 화이트리스트에 포함(에이전트가 토큰 인증으로 직접 호출). 참조 카운트 갱신.
   */
  app.get('/api/brain/search', (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      if (!q.trim()) return res.json({ results: [] });
      const project = typeof req.query.project === 'string' ? req.query.project : undefined;
      const scope = req.query.scope === 'project' || req.query.scope === 'agent'
        ? (req.query.scope as BrainCardScope) : undefined;
      const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
      const root = graphManager.resolveBrainRoot(project);
      if (!root) return res.json({ results: [] });
      const svc = getBrainService(root);
      // §5.10 v3.81-G — **기본 검색은 현재 진실만.** 저장고 전체를 뒤지려면 `all=1` 을 명시해야 한다
      //   (기억 화면은 사람이 자기 기록을 보는 곳이라 항상 all=1 을 붙인다). 에이전트가 무심코
      //   검색했다가 미검증 후보를 현재 규칙으로 읽는 일을 막는 자리.
      const includeAll = req.query.all === '1' || req.query.all === 'true';
      const found = svc.search(q, { scope, agentId });
      const currentIds = includeAll ? null : new Set(svc.selectCurrent({ agentId }).map((c) => c.id));
      const results = currentIds ? found.filter((c) => currentIds.has(c.id)) : found;
      if (results.length > 0) {
        svc.touchReferences(results.map((c) => c.id));
        // 능동 검색 주입 신호(스냅샷 칩 연출). agentId 있을 때만 귀속.
        if (agentId) {
          const ev: BrainInjectionEvent = {
            id: randomUUID(),
            agentId,
            at: Date.now(),
            cardIds: results.map((c) => c.id),
            cardTitles: results.map((c) => c.title),
            trigger: 'search',
          };
          graphManager.addBrainInjection(ev);
        }
        graphManager.notifyBrainChanged(project);
      }
      // 결과에 출처 층 표시(scope 필드가 이미 층 정보). 본문 포함.
      res.json({ results });
    } catch (err) {
      logger.error('GET /api/brain/search failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/brain/file-notes — 파일 접근 경고(hook PostToolUse Edit/Write). loopback 화이트리스트.
   * un-warned 실수/교훈 카드가 그 파일에 매칭되면 {warning} 반환(세션+파일당 1회), 아니면 204.
   * **broadcast 금지**(§9 perf — per-tool-event). O(map lookup) — LLM/스캔 없음.
   *
   * §5.10 v3.78 — 이 경로가 **코드 변경 기반 무효화**의 유일한 방아쇠다. Edit/Write 를 전수로 받는
   * 자리가 여기뿐이라, 경고를 낼지 말지(세션당 1회 가드)와 **무관하게** 먼저 앵커를 무효화한다.
   * 가드 뒤에 두면 같은 파일을 두 번째 고칠 때부터 무효화가 통째로 사라진다(고질병 ②의 재발 지점).
   */
  app.post('/api/brain/file-notes', (req, res) => {
    try {
      const body = (req.body ?? {}) as { session_id?: string; file_path?: string };
      const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
      const filePath = typeof body.file_path === 'string' ? body.file_path : '';
      if (!sessionId || !filePath) return res.status(204).end();
      const root = graphManager.getAgentCwd(sessionId) ?? graphManager.getRoot();
      if (!root) return res.status(204).end();
      const svc = getBrainService(root);
      // ① 무효화 먼저 — 경고 가드보다 앞. 상태가 실제로 바뀐 카드가 있으면 요약(needsCheckCount)을
      //    다시 계산해야 하므로 캐시만 무효화한다(broadcast 는 하지 않는다 — per-tool-event 라 비싸다).
      if (svc.noteFilesEdited([filePath]) > 0) graphManager.notifyBrainChanged();
      // ② 경고는 종전대로 세션+파일당 1회.
      const warnKey = `${sessionId}::${normPathForWarn(filePath)}`;
      if (BRAIN_FILE_WARN_ONCE_PER_SESSION && brainFileWarned.has(warnKey)) return res.status(204).end();
      const cards = svc.getCardsForFiles([filePath]);
      if (cards.length === 0) return res.status(204).end();
      brainFileWarned.add(warnKey);
      svc.touchReferences(cards.map((c) => c.id));
      const agentId = graphManager.findAgentIdBySession(sessionId);
      if (agentId) {
        graphManager.addBrainInjection({
          id: randomUUID(),
          agentId,
          at: Date.now(),
          cardIds: cards.map((c) => c.id),
          cardTitles: cards.map((c) => c.title),
          trigger: 'file',
        });
        graphManager.notifyBrainChanged();
      }
      // §5.10 v3.81-H — 실수/교훈은 **경험 계층**이라 그 자체로 현재 규칙이 아니다. 경고는 계속
      //   보내되(같은 실수 반복 차단이 이 경로의 존재 이유) "참고"임을 머리에 명시한다.
      const warning = [
        `[Project Brain · 참고 — 과거 경험] 이 파일에 연결된 실수/교훈 ${cards.length}건이 있습니다.`
        + ` 검증된 현재 규칙이 아니라 과거 기록이니 지금 코드와 대조해서 참고하세요:`,
        ...cards.map((c) => `- [${c.id}] (${c.type}) ${c.title}${c.body ? `: ${c.body.split('\n')[0]}` : ''}${svc.staleHint(c)}`),
      ].join('\n');
      res.json({ warning });
    } catch (err) {
      logger.error('POST /api/brain/file-notes failed', err);
      res.status(204).end();
    }
  });

  /** §5.3 #10-2 v2.37 — Auto Agent 메타 버블 생성 (캔버스 우클릭 메뉴) */
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

  /** §5.3 #10-2 v2.37 — Auto Agent 에게 사용자 메시지 전달 → 자동 spawn + dispatch */
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

  /** §5.3 #10-2 v2.37 — Auto Agent "질문하기" 토글 */
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

  /** §5.3 #10-2 v2.37 — Auto Agent 명확화 질문에 사용자 답을 보내고 spawn 재개 */
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

  // ── §5.3 #10-3 v4.98 — 검증 런 ─────────────────────────────────────────────

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

  /**
   * POST /api/auto-agent/:sessionId/verification — 검증 증거 1건 적재.
   *
   * 에이전트(tester 등)가 실제로 명령을 돌린 뒤 **명령 + 종료 코드**를 신고하는 자리다.
   * 통과 여부(`ok`)는 요청 본문에서 받지 않고 서버가 `exitCode === 0` 으로 계산한다 —
   * "통과했다"는 주장과 실제 통과를 구분하는 지점이 여기다.
   */
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
   * POST /api/auto-agent/:sessionId/self-test — **게이트 자가진단**.
   *
   * 게이트가 정말 막는지는 통과 화면이 아니라 **차단 화면**으로만 증명된다. 그래서 일부러
   * 실패하는 가짜 런 2건을 돌린다:
   *   ① `exitCode=1` 증거만 있는 런에 `verified` 를 요청 → `escalated(no-evidence)` 여야 한다.
   *   ② `REJECT` 와 `PASS` 가 섞인 판정 텍스트 → `held` 여야 한다(승인으로 흐르면 실패).
   * 두 결과 모두 `selfTest` 런으로 남아 화면에서 실제 작업 런과 배지로 구분된다.
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
  /**
   * 워크트리 한 벌을 만든다 — **`/api/create-worktree` 와 §5.18 에이전트 랩이 같이 쓰는 한 함수.**
   *
   * 예전에는 이 본체가 라우트 안에 인라인으로만 있어서, 다른 기능이 워크트리를 만들려면 코드를
   * 한 벌 더 베끼는 수밖에 없었다(그러면 한 쪽만 고쳐지는 사고가 난다). 랩이 변형마다 격리를
   * 필요로 하게 되면서 헬퍼로 뽑았고, 라우트는 이 함수를 부르는 얇은 껍데기가 됐다.
   *
   * 브로드캐스트·체크포인트 저장은 **호출부의 몫**이다 — 랩은 N개를 만든 뒤 한 번만 저장한다.
   */
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

    // 4) `git worktree add -b <branch> <target> <base>` — base 후보: 사용자 지정 → master → main.
    //    도는 동안은 이 폴더를 아무도 발견하지 못하게 막는다(생성 유예). git 은 `.git` 을 먼저
    //    붙이고 파일을 나중에 푸는데, 그 사이 10초 세션 스윕이 폴더를 주우면 **좌표가 정해지기
    //    전에** 버블이 태어나 사용자가 고른 자리가 아닌 곳에 앉는다. 해제는 반드시 `finally`.
    const baseCandidates = input.base ? [input.base, 'master', 'main'] : ['master', 'main'];
    beginWorktreeCreation(targetDir);
    const result = await runGitWorktreeAdd(parentCwd, targetDir, branch, baseCandidates)
      .finally(() => endWorktreeCreation(targetDir));
    if (!result.ok) {
      logger.warn(`create-worktree git failed: ${result.error}`);
      return { ok: false, status: 500, error: `git worktree add failed: ${result.error}` };
    }

    // v3.71: 방금 만든 워크트리가 "죽은 폴더" 판정 캐시에 걸려 발견에서 밀리지 않도록 즉시 무효화.
    invalidateWorktreeLiveness(targetDir);

    // 5) 등록 + 버블 생성
    //    부모가 이미 등록돼 있으면 manager.registerProject(wtCwd) 는 부모로 리다이렉트 후 early return 하므로,
    //    `scanAllProjects` 로 부모 인스턴스의 `discoverWorktrees` 를 강제 실행시켜 worktree 노드를 생성한다.
    try {
      graphManager.registerProject(parentCwd); // 부모 인스턴스 확보 (idempotent)
    } catch (err) {
      // §3.2.1-4 (v3.03) — 부모가 read-only 격리(load-error)면 워크트리 생성 불가.
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
   * §7.6 (판올림 번호 발급 대기) — 그 워크트리에서 일하던 **커스텀 에이전트** 하나.
   *
   * 합치기가 충돌했을 때 "충돌을 그 에이전트에게 넘기기"의 상대다. 워크트리는 자기 이름의
   * 프로젝트로 등록되므로 `agentProjects`(에이전트 → 프로젝트명) 로 고르면 된다 — 새 상태·새
   * 매핑을 만들지 않는다. 훅 버블(`customCreated` 아님)과 휴지통은 제외한다(§5.5 #17-29 경계:
   * 관측 대상에는 명령을 넣지 않는다). 후보가 없으면 null 이고, 화면은 버튼 자체를 렌더하지 않는다.
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
   * §7.10 — 워크트리를 지우기 **직전에** 그 안에서 돌던 것을 강제로 끝낸다.
   *
   * 사용자는 삭제 팝업에서 이미 확인했다 — 여기서 다시 묻지 않는다. 고르는 규칙은
   * `worktreeReaper` 가 쥐고(시험 가능), 여기서는 그래프·PTY 다리를 물려 주기만 한다.
   * 반드시 `removeBubble` **전에** 불러야 한다 — 워크트리 프로젝트 등록이 사라지면
   * 소유 판정에 쓸 `agentProjects` 가 부모로 접혀 아무도 못 고른다.
   */
  /** 그 워크트리 경로의 **프로젝트 표시명**. 예고(status)와 실행(delete)이 같은 답을 써야 한다. */
  function resolveWorktreeProjectName(wtAbs: string): string {
    const snap = graphManager.getSnapshot();
    return Object.values(snap.worktreeProjects ?? {}).find(
      (name) => samePath(graphManager.getProjectByName(name)?.path ?? '', wtAbs),
    ) ?? path.basename(wtAbs);
  }

  /**
   * §7.10 — 지금 지우면 **무엇이 강제 종료되는가**(죽이지 않고 세기만 한다).
   * 팝업이 확인을 받기 전에 이 숫자를 보여 준다 — 모르고 눌러 dev 서버가 꺼지면 그건 사고다.
   */
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

  /** 삭제 후에도 남아 있는 파일 경로(디렉토리 기준 상대경로)를 최대 `max`개 수집.
   *  v3.71 — 잠금 파일로 인한 부분 삭제를 사용자에게 그대로 보여주기 위한 진단용. */
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

        // 2) §7.10 — **여기서 강제 종료한다.** 사용자는 팝업에서 이미 확인했고, 이 폴더 안에서
        //    도는 dev 서버·빌드·CLI 가 파일을 잡고 있으면 아래 삭제가 반만 성공해 좀비 폴더가 남는다.
        //    합치기가 실패하면 위에서 이미 돌아갔으므로(삭제 안 함) **아무것도 죽이지 않는다** —
        //    "합치다 실패했는데 내 dev 서버만 죽었다" 가 되지 않도록 순서를 이렇게 둔다.
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

        // v3.71: Windows 에서는 잠긴 파일(에디터·dev 서버·node_modules 바이너리) 하나 때문에
        // 폴더가 반만 지워지고 좀비로 남는다. 이 경우를 조용한 성공으로 처리하면 사용자는
        // "지웠는데 폴더가 남아 있다"는 사실을 모른 채 지나간다 — 남은 파일을 그대로 보고한다.
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

  /**
   * POST /api/worktree/cleanup-folder — 잠금 파일로 반만 지워진 워크트리 폴더 재삭제 (v3.71).
   * 버블은 이미 사라진 뒤라 nodeId 로는 다시 찾을 수 없으므로 경로를 직접 받는다.
   * 안전을 위해 `.claude/worktrees/<name>` 패턴 경로만 허용한다.
   */
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

  /**
   * POST /api/worktree/:nodeId/sync — worktree 에 원격/로컬 base(master→main) 를 머지.
   * v1.23 §7.6 Sync 액션. base 후보: origin/master → origin/main → master → main.
   * 충돌 시 `merge --abort` 로 자동 원복 후 409 + stderr 반환.
   */
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
   * §7.6 (판올림 번호 발급 대기) — 워크트리 브랜치를 **부모(본선)** 로 합치는 본문.
   *
   * 엔드포인트(`POST /api/worktree/:nodeId/merge`)와 §5.16 리뷰 승인이 **같은 함수**를 쓴다 —
   * 두 벌로 갈라 두면 승인 병합만 선행 거부·충돌 원복 규칙에서 벗어나는 상태가 생긴다.
   *
   * - `--no-ff` 고정: 워크트리 한 벌이 커밋 하나로 뭉개지지 않고 갈래가 남아야 되돌릴 수 있다.
   * - 선행 거부 2종(둘 다 409, 손대기 전에 판정): 부모가 dirty(`parent-dirty`) / 합칠 것 없음(`nothing-to-merge`).
   * - 충돌이면 부모에서 `merge --abort` 로 **원복**하고 충돌 파일 목록을 돌려준다(사용자 본선을 충돌 상태로 두지 않는다).
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

  /**
   * POST /api/worktree/:nodeId/merge — 위 본문을 그대로 HTTP 로 낸다. §7.6 (판올림 번호 발급 대기).
   *
   * 바로 위 sync 의 **반대 방향**이다. 종전에는 이 방향이 없어, 격리해서 일을 다 시켜 놓고도 마지막
   * 합치기만 사용자가 터미널을 따로 열어서 했다.
   */
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

  /**
   * §5.16 — 워크트리 변경분 한 벌. `merge-base` 기준 커밋분 + 미커밋분을 합친 결과.
   *
   * **읽기 전용**이다 — 리뷰를 만들기 위해 워킹트리·인덱스를 건드리지 않는다(add/stash ❌).
   */
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

  /**
   * `git status --porcelain` → 미커밋 변경(스테이지·워킹트리·추적 안 된 파일 전부).
   *
   * `git diff HEAD` 는 추적되지 않은 새 파일을 못 보므로, 미커밋 목록의 근거는 이쪽이 맡는다.
   */
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

  /**
   * §5.16 — 그 워크트리의 변경분을 모은다. git 이 이미 아는 것만 읽는다(새 계산 ❌).
   *
   * 커밋분은 부모와 갈라진 지점(`merge-base`) 기준이라 부모의 최신 커밋이 섞여 들어오지 않는다.
   * 미커밋분은 따로 표시(`uncommitted`)해 "승인해도 병합에는 안 들어간다"를 화면이 말할 수 있게 한다.
   */
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
   * §5.16 — 격리에서 일한 에이전트가 그 턴을 끝냈다. **조건 넷을 다 만족할 때만** 리뷰를 만든다.
   *
   * (a) 커스텀 에이전트 · (b) 그 프로젝트가 워크트리 · (c) 실제 변경분 있음 · (d) 미결정 리뷰 없음.
   * 하나라도 어긋나면 조용히 만들지 않는다 — 턴마다 카드를 쌓으면 레인이 그 순간 소음이 된다.
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

    // 표시는 §4 v2.70 검수 카드 그 자리 — `reviewRequestId` 한 줄로 레코드를 가리킨다(새 카드 계열 ❌).
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

  /** 그 에이전트의 명령 큐에 한 건 넣고 바로 발사. 반려 재작업이 쓰는 경로(새 전송 경로 ❌). */
  function enqueueAgentCommand(agentId: string, text: string, idTag: string): boolean {
    const agent = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
    if (!agent) return false;
    const sessionId = agent.path;
    const sub = subAgentManager.getPrimarySub(agentId) ?? subAgentManager.create(agentId);
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now().toString(36)}-${idTag}${Math.random().toString(36).slice(2, 5)}`,
      text,
      timestamp: Date.now(),
      subAgentId: sub.id,
      status: 'queued',
    };
    const queue = commandQueues.get(sessionId) ?? [];
    queue.push(cmd);
    commandQueues.set(sessionId, queue);
    processNextCommand(sessionId);
    return true;
  }

  /**
   * POST /api/review-requests/:id/decision — 승인 / 반려(사유) / 보류. §5.16.
   *
   * - 승인: §7.6 `performWorktreeMerge()` 를 **그대로** 부른다(선행 거부·충돌 원복 동일). 결과는
   *   결정 레코드에 `mergeOk`/`mergeError`/`conflicts` 로 남고, 실패면 상태가 `pending` 으로 돌아가
   *   부모를 정리한 뒤 다시 승인할 수 있다.
   * - 반려: 사유 필수. 클라이언트가 번역문으로 조립한 `reworkPrompt` 를 기존 명령 큐로 그 에이전트에게
   *   보낸다(없으면 사유 본문만 보낸다 — 서버가 언어를 정하지 않는다).
   * - 보류: 적재만. 병합·재작업 어느 쪽도 발사하지 않는다.
   */
  app.post('/api/review-requests/:id/decision', (req, res) => {
    void (async () => {
      try {
        const id = req.params.id;
        const record = graphManager.getReviewRequest(id);
        if (!record) { res.status(404).json({ ok: false, error: 'review not found' }); return; }
        const body = (req.body ?? {}) as { kind?: unknown; reason?: unknown; reworkPrompt?: unknown };
        const kind = body.kind;
        if (kind !== 'approve' && kind !== 'reject' && kind !== 'hold') {
          res.status(400).json({ ok: false, error: 'kind must be approve|reject|hold' });
          return;
        }
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, REVIEW_REASON_MAX) : '';
        if (kind === 'reject' && reason === '') {
          res.status(400).json({ ok: false, error: 'reason required' });
          return;
        }

        if (kind === 'hold') {
          const updated = graphManager.recordReviewDecision(id, { kind: 'hold', ...(reason !== '' ? { reason } : {}) });
          broadcastSnapshot();
          saveCheckpoint();
          res.json({ ok: true, status: updated?.status ?? 'held' });
          return;
        }

        if (kind === 'reject') {
          const prompt = typeof body.reworkPrompt === 'string' && body.reworkPrompt.trim() !== ''
            ? body.reworkPrompt.trim()
            : reason;
          const dispatched = enqueueAgentCommand(record.agentId, prompt, 'rvw');
          const updated = graphManager.recordReviewDecision(id, { kind: 'reject', reason, reworkDispatched: dispatched });
          broadcastSnapshot();
          saveCheckpoint();
          logger.info(`[review-lane] rejected review=${id} agent=${record.agentId} dispatched=${dispatched}`);
          res.json({ ok: true, status: updated?.status ?? 'rejected', reworkDispatched: dispatched });
          return;
        }

        // 승인 — 병합 절차로.
        if (!record.worktreeNodeId) {
          graphManager.recordReviewDecision(id, { kind: 'approve', mergeOk: false, mergeError: 'worktree-node-missing' });
          broadcastSnapshot();
          saveCheckpoint();
          res.status(409).json({ ok: false, error: 'worktree-node-missing' });
          return;
        }
        const outcome = await performWorktreeMerge(record.worktreeNodeId);
        if (outcome.ok) {
          const updated = graphManager.recordReviewDecision(id, { kind: 'approve', mergeOk: true });
          broadcastSnapshot();
          saveCheckpoint();
          logger.info(`[review-lane] approved+merged review=${id} branch=${outcome.branch}`);
          res.json({ ok: true, status: updated?.status ?? 'approved', branch: outcome.branch });
          return;
        }
        graphManager.recordReviewDecision(id, {
          kind: 'approve',
          mergeOk: false,
          mergeError: outcome.error,
          ...(outcome.conflicts && outcome.conflicts.length > 0 ? { conflicts: outcome.conflicts } : {}),
        });
        broadcastSnapshot();
        saveCheckpoint();
        const { httpStatus, ...rest } = outcome;
        res.status(httpStatus).json(rest);
      } catch (err) {
        logger.error('POST /api/review-requests/:id/decision failed', err);
        res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Internal server error' });
      }
    })();
  });

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

  /**
   * POST /api/git-commit — body { projectName, message? }.
   * v1.25 §7.6 Commit 액션 (v1.24 Snapshot 리네임). `git add -A && git commit -m "wip: <ts>"` 일괄 실행.
   * 실패 시 stderr 를 409 로 반환하여 클라이언트가 GitErrorModal 로 노출.
   */
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
      let purged = 0;
      if (sessionId) {
        // 확인 dismiss 는 이제 `idle` 잔상 버블에서도 온다(§2.4 — 종료·크래시로 남은 것을
        // 눌러서 걷는 길). 그 클릭은 "세션이 방금 끝났다"가 아니므로 아래 두 가지를 가른다.
        const statusBefore = graphManager.getAgentBySession(sessionId)?.status;
        const wasSessionEnd = statusBefore === 'completed' || statusBefore === 'error';
        purged = agentTracker.dismiss(sessionId).length;
        // §5.10 — 리플렉션은 **진짜 세션 종료 신호**에만 예약한다(실패 무시). idle 잔상을 누를
        //   때마다 걸면 클릭 한 번이 리플렉션 한 벌이 되어 토큰이 샌다.
        if (wasSessionEnd) triggerBrainReflection(sessionId);
        // markAgentIdle 이 파일/폴더 엣지를 삭제 → 클라에 즉시 반영해야
        // 완료 에이전트 dismiss 시 폴더 버블이 화면에서 사라진다(고정 제외).
        // 형제 변이 엔드포인트와 동일하게 broadcast + saveCheckpoint 쌍으로 마감.
        // 걷을 것도 끝낼 세션도 없었으면(이미 idle + 전유 버블 0) 저장까지 갈 이유가 없다.
        if (wasSessionEnd || purged > 0) {
          broadcastSnapshot();
          saveCheckpoint();
        }
      }
      res.json({ ok: true, purged });
    } catch (err) {
      logger.error('POST /api/dismiss-agent failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
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
   *  실행 중이 아니면 409. 성공 시 close 핸들러가 cmd.result 를 `[Stopped by user]` 로 채운다. */
  app.post('/api/subagents/:agentId/:subId/stop', (req, res) => {
    const { subId } = req.params;
    const ok = subAgentManager.stop(subId);
    if (!ok) {
      res.status(409).json({ ok: false, error: 'not running' });
      return;
    }
    res.json({ ok: true });
  });

  /**
   * §5.5 #17-10 v3.53 — POST /api/subagents/:agentId/:subId/stop-session — **세션 스코프 전체 중지**.
   *
   * v3.51 의 `stop-all` 은 [중지] 를 에이전트 단위로 올려, 지금 보고 있지도 않은 **다른 세션 탭까지**
   * 함께 끊었다("이 세션만 멈추라는 건데 왜 다른 세션까지 죽냐"). 이 라우트는 stop-all 의 3단을
   * **열려 있는 그 세션 하나에만** 적용한다:
   *   1) `subAgentManager.stop(subId)` — 그 탭의 자식 프로세스 트리 / agent-view worker 만 종료
   *      + 그 세션이 띄운 백그라운드 서브에이전트 대차대조만 해제(§5.5 #17-10 ②).
   *   2) 이 세션의 `queued` 명령만 폐기 — 중지 직후 **이 세션의** 다음 명령이 자동 dispatch 되지 않게.
   *      다른 세션의 큐는 그대로 둔다(그 탭은 계속 돌아야 한다).
   *   3) 살아있는 자식 없이 `executing` 에 굳어 있던 **이 세션의** 명령만 `[Stopped by user]` 봉합.
   * 실행 중인 게 없어도 200 (멱등) — 사용자가 두 번 눌러도 에러 카드가 뜨지 않게.
   */
  app.post('/api/subagents/:agentId/:subId/stop-session', (req, res) => {
    const { agentId, subId } = req.params;
    const stopped = subAgentManager.stop(subId);
    // §5.5 #17-11 v3.79 — 이 세션의 반복 루프도 함께 끈다. 안 끄면 중지 직후 루프가 다음 회차를
    //   다시 밀어 넣어 §5.5 #17-10 이 고친 "눌러도 안 멈춘다"가 그대로 재발한다.
    const loopStopped = stopSessionLoop(subId, 'stopped');

    let cancelledQueued = 0;
    let sealedExecuting = 0;
    const sessionId = graphManager.findSessionByAgentId(agentId);
    const queue = sessionId ? commandQueues.get(sessionId) : undefined;
    if (queue && sessionId) {
      const remaining: QueuedCommand[] = [];
      // 봉합한 명령은 stop-all 과 동일하게 Results 아카이브로 넘긴다 — 평소 완료 경로와 같은 자리에
      // `[Stopped by user]` 로 남아야 사용자가 "왜 사라졌지"를 겪지 않는다.
      const sealed: QueuedCommand[] = [];
      for (const c of queue) {
        // 다른 세션 소유 명령은 손대지 않는다 — 이 라우트의 존재 이유.
        if (c.subAgentId !== subId) { remaining.push(c); continue; }
        if (c.status === 'queued') { cancelledQueued++; continue; }
        if (c.status === 'executing' && !subAgentManager.isSubRunning(subId)) {
          c.status = 'completed';
          c.result = '[Stopped by user]';
          sealedExecuting++;
          sealed.push(c);
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
      `[stop-session] agent=${agentId} sub=${subId} stopped=${stopped} cancelledQueued=${cancelledQueued} sealedExecuting=${sealedExecuting} loopStopped=${loopStopped}`,
    );
    graphManager.recomputeCustomAgentStatus(agentId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, stopped, cancelledQueued, sealedExecuting, loopStopped });
  });

  /**
   * §5.5 #17-9 v3.51 — POST /api/subagents/:agentId/stop-all — **에이전트 전체 중지**.
   *
   * 세션 1개만 끊던 위 `/stop` 으로는 (a) 다른 탭의 실행, (b) 감독관이 백단에 띄운 Task 서브에이전트,
   * (c) 큐에 남아 곧바로 dispatch 될 `queued` 명령이 계속 살아 "Stop 을 눌러도 안 멈추는" 것처럼 보였다.
   * 이 라우트는 셋을 한 번에 끊는다:
   *   1) `subAgentManager.stopAll` — 모든 탭의 자식 프로세스 트리 / agent-view worker 종료
   *      + 백그라운드 서브에이전트 대차대조(§5.3 #12-1 v3.43) 해제.
   *   2) 이 에이전트 세션 큐의 `queued` 전량 폐기 — 중지 직후 다음 명령이 자동으로 튀어나오지 않게.
   *   3) 살아있는 자식 없이 `executing` 에 걸려 있던 명령은 `[Stopped by user]` 로 봉합 + sub idle 복귀
   *      (자식이 있는 건은 건드리지 않는다 — close 핸들러가 정상 경로로 마무리).
   * 실행 중인 게 없어도 200 (멱등) — 사용자가 두 번 눌러도 에러 카드가 뜨지 않게.
   *
   * §5.5 #17-10 v3.53 — 이제 이 라우트는 **스코프를 좁힐 세션이 없는 메인 탭 전용**이다.
   * 세션 탭이 열려 있을 때의 [중지] 는 위 `/:subId/stop-session` 으로 간다(다른 탭 보호).
   */
  app.post('/api/subagents/:agentId/stop-all', (req, res) => {
    const { agentId } = req.params;
    const stopped = subAgentManager.stopAll(agentId);
    // §5.5 #17-11 v3.79 — 이 에이전트의 모든 세션 루프도 함께 끈다(전체 중지의 의미 그대로).
    const loopsStopped = stopSessionLoopsForAgent(agentId);

    let cancelledQueued = 0;
    let sealedExecuting = 0;
    const sessionId = graphManager.findSessionByAgentId(agentId);
    const queue = sessionId ? commandQueues.get(sessionId) : undefined;
    if (queue && sessionId) {
      const remaining: QueuedCommand[] = [];
      // 봉합한 명령은 그냥 버리지 않고 Results 아카이브로 넘긴다 — 평소 완료 경로와 같은 자리에
      // `[Stopped by user]` 로 남아야 사용자가 "왜 사라졌지"를 겪지 않는다.
      const sealed: QueuedCommand[] = [];
      for (const c of queue) {
        if (c.status === 'queued') { cancelledQueued++; continue; }
        if (c.status === 'executing' && !(c.subAgentId && subAgentManager.isSubRunning(c.subAgentId))) {
          // 자식은 이미 없는데 executing 으로 굳어 있던 건 — 여기서 봉합해야 UI 가 Run 으로 돌아온다.
          c.status = 'completed';
          c.result = '[Stopped by user]';
          sealedExecuting++;
          sealed.push(c);
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

    logger.info(
      `[stop-all] agent=${agentId} stoppedSubs=${stopped.length} cancelledQueued=${cancelledQueued} sealedExecuting=${sealedExecuting} loopsStopped=${loopsStopped}`,
    );
    graphManager.recomputeCustomAgentStatus(agentId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, stopped: stopped.length, cancelledQueued, sealedExecuting, loopsStopped });
  });

  /**
   * DELETE /api/subagents/:agentId/running-task/:taskId — 실행 중 목록에서 **그 항목 하나만** 내린다.
   *
   * 종전에는 자식 하나가 응답 없이 매달리면 손쓸 방법이 **세션/에이전트 전체 중지**뿐이라 멀쩡한
   * 형제 작업까지 함께 죽여야 했다. 이 라우트는 우리 장부에서만 내린다 — 프로세스를 끊지 않는다
   * (개별 자식을 끊는 것은 그 자식을 띄운 에이전트가 `TaskStop` 으로 한다).
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

  /** DELETE /api/subagents/:agentId/:subId — 서브에이전트 탭 닫기(세션 종료+삭제) */
  app.delete('/api/subagents/:agentId/:subId', (req, res) => {
    const { subId } = req.params;
    const ok = subAgentManager.remove(subId);
    if (!ok) {
      res.status(404).json({ ok: false, error: 'sub not found' });
      return;
    }
    // §5.5 #17-11 v3.79 — 탭이 사라지면 그 탭의 루프도 사라진다(좀비 루프 차단).
    clearSessionLoopTimer(subId);
    graphManager.deleteSessionLoop(subId);
    // §5.5 #17-17 v4.46 — 목표도 같은 수명(탭이 없으면 향할 세션도 없다).
    graphManager.deleteSessionGoal(subId);
    // §5.5 #17-28 v4.96 — 그 탭에만 걸어 둔 주입원 오버라이드도 함께(좀비 설정 차단 — 같은 규칙).
    graphManager.deleteContextOverridesForSession(subId);
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  /** POST /api/subagents/:agentId/remove-bulk — 여러 탭을 한 번에 닫기
   *  (컨텍스트 메뉴 "다른 탭 닫기 / 오른쪽 닫기 / 모두 닫기").
   *  N개를 개별 DELETE 로 닫으면 매 요청마다 broadcastSnapshot + saveCheckpoint(전체 직렬화 +
   *  worktree prune)가 돌아 "닫닫 닫" 하며 한 개씩 느리게 닫히는 체감을 만든다. 한 요청으로 모두
   *  제거한 뒤 broadcast/checkpoint 는 1회만 수행한다. */
  app.post('/api/subagents/:agentId/remove-bulk', (req, res) => {
    const body = req.body as { ids?: unknown } | undefined;
    const ids = Array.isArray(body?.ids)
      ? body!.ids.filter((x): x is string => typeof x === 'string')
      : null;
    if (!ids || ids.length === 0) {
      res.status(400).json({ ok: false, error: 'ids must be non-empty string[]' });
      return;
    }
    let removed = 0;
    for (const id of ids) {
      if (!subAgentManager.remove(id)) continue;
      removed++;
      // §5.5 #17-11 v3.79 — 닫은 탭의 루프 동반 삭제(개별 DELETE 경로와 동일).
      clearSessionLoopTimer(id);
      graphManager.deleteSessionLoop(id);
      // §5.5 #17-17 v4.46 — 목표도 동반 삭제.
      graphManager.deleteSessionGoal(id);
      // §5.5 #17-28 v4.96 — 세션 층 오버라이드도 동반 삭제.
      graphManager.deleteContextOverridesForSession(id);
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

    const revived = subAgentManager.restoreFromArchive(sid);
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

  /** POST /api/subagents/:agentId/:subId/summary — §5.5 #17-8 v2.95 세션 자기요약.
   *  카드가 없는 세션을 요약 보드에서 한 줄로 보여주기 위해, 그 세션의 claude 대화를 `--resume` 해
   *  헤드리스 1턴 한국어 요약을 받아 `{ ok, text }` 로 반환. 표시 전용 — 그래프 상태/체크포인트 무관. */
  app.post('/api/subagents/:agentId/:subId/summary', async (req, res) => {
    const { agentId, subId } = req.params;
    try {
      const result = await subAgentManager.summarizeSession(agentId, subId);
      if (!result.ok) {
        res.status(result.error === 'no-conversation' ? 404 : 502).json(result);
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** GET /api/subagent-streams/:agentId — 에이전트 전체 서브에이전트 스트림 버퍼 (IDE 열 때 초기 데이터).
   *  버퍼는 emit 시점에 디스크 append-only로 기록되므로(streamBufferStore), 서버 재시작 후에도 live와 동일한 타임라인이 복원된 상태다. */
  app.get('/api/subagent-streams/:agentId', (req, res) => {
    const { agentId } = req.params;
    const buffers = subAgentManager.getStreamBuffersForAgent(agentId);
    res.json({ streams: buffers });
  });

  /**
   * GET /api/subagent-streams/:agentId/:subId — **한 세션의 깊은 복원분** (§5.5 v4.92).
   *
   * 위 전체 조회는 에이전트의 모든 세션을 한 번에 싣기 때문에 세션마다 얕게 준다(그 중 9할은
   * 클라가 비활성 상한으로 곧장 깎는다). 사용자가 실제로 열어 보는 세션만 이 경로로 상한
   * 전체(`MAX_STREAM_BUFFER`)를 받아, 오래된 대화가 "말풍선과 카드만 남고" 비지 않게 한다.
   */
  app.get('/api/subagent-streams/:agentId/:subId', (req, res) => {
    const { agentId, subId } = req.params;
    // 부모 id 를 함께 넘긴다 — 복원 직후처럼 그 sub 가 아직 index 에 없어도 디스크에서 읽어 준다
    // (빈 배열이 나가면 클라가 얕은 창에 갇혀 대화 중간이 빈 채로 굳는다).
    res.json({ events: subAgentManager.getStreamBuffer(subId, agentId) });
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

  interface SkillInfo {
    name: string;
    description: string;
    /** project = 프로젝트 `.claude`, global = 홈 `~/.claude`(모든 프로젝트 공통), plugin = 설치 플러그인. */
    source: 'project' | 'global' | 'plugin';
    /** 플러그인 스킬일 때 소속 플러그인 이름 (예: "claude-code-harness", "frontend-design") */
    pluginName?: string;
  }

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

  /**
   * GET /api/available-skills — 프로젝트 + 설치 플러그인 스킬 목록.
   * §5.5 #17-2/#17-4 v2.59 — `?agent=<id>`(권위) 또는 `?project=<name>` 지정 시 그 프로젝트의
   * `.claude/skills/` + `.claude/commands/`(Claude Code 슬래시 커맨드) 를 프로젝트 스킬로 반환.
   * 미지정 시 전 프로젝트 병합(하위 호환 fallback).
   * plugin 스킬은 `~/.claude/plugins` 전역이라 project 와 무관하게 항상 동일.
   */
  app.get('/api/available-skills', async (req, res) => {
    try {
      const skills: SkillInfo[] = [];
      const seen = new Set<string>();

      // 1) 프로젝트 스킬 — 스캔할 프로젝트 경로 결정.
      //    우선순위: agent(권위) → project(표시명/path 해소) → 미지정 시 전 프로젝트.
      //    v2.59 클라는 스냅샷의 전역 유일 표시명을 보내는데, 활성 프로젝트 오염·이름 충돌·
      //    미해소로 어긋날 수 있다. agentId 가 있으면 그 에이전트의 소속 인스턴스(=cwd 기준
      //    실제 프로젝트)에서 path 를 직접 얻어 "그 프로젝트의 .claude/skills" 만 정확히 읽는다.
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

      // 2) 설치된 플러그인 스킬: ~/.claude/plugins/marketplaces/*/
      const pluginsBase = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces');
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
              if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
            }
            // plugins/ 하위 (claude-plugins-official 등)
            const pluginsSubDir = path.join(mpDir, 'plugins');
            try {
              if (fs.existsSync(pluginsSubDir)) {
                for (const plugin of fs.readdirSync(pluginsSubDir, { withFileTypes: true })) {
                  if (!plugin.isDirectory()) continue;
                  const pSkills = path.join(pluginsSubDir, plugin.name, 'skills');
                  for (const s of scanSkillsDir(pSkills, 'plugin', plugin.name)) {
                    if (!seen.has(s.name)) { seen.add(s.name); skills.push(s); }
                  }
                }
              }
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }

      // §5.5 #17-2 v3.19 — CLI 내장 슬래시 명령은 별도 배열로. skills 에 섞지 않아
      // Skills 사이드바(#17-4)는 불변, `/` 자동완성 드롭다운만 병행 표시한다.
      res.json({
        ok: true,
        skills,
        builtins: BUILTIN_SLASH_COMMANDS,
        order: appStateGetSkillOrder(),
        favorites: appStateGetSkillFavorites(),
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

  // ─── §5.5 #17-4 — 스킬을 다른 프로젝트로 복사 ───
  //
  // 목록을 만든 스캐너(scanSkillsDir / scanCommandsDir)와 **같은 규칙**으로 원본을 되찾는다 —
  // 화면에 보이는 항목은 전부 복사할 수 있어야 하기 때문. 스킬은 폴더 통째(보조 파일·하위 폴더 포함),
  // 슬래시 커맨드는 `.md` 파일 1개가 단위다.

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

  /** §5.5 #17-4 v2.93 — PUT /api/skill-favorites — SkillsView 즐겨찾기 목록 전체 치환(클라가 별 누른 순서대로 전송). */
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
      // §4 (설정 3층) — **빠진 칸의 기준선.** 이 핸들러는 body 로 config 한 벌을 새로 짓는데,
      //   종전에는 없는 칸을 `'sonnet'`·`'default'`·`[]` 같은 상수로 메웠다. 그래서 이 창을 모르는
      //   경로(루프백 빌더처럼 일부만 보내는 곳)가 저장하면 모델이 조용히 강등되고 도구가 비었다.
      //   기준선은 상수가 아니라 **그 에이전트의 지금 값**(없으면 설정 창 기본값)이어야 한다.
      const base = graphManager.getAgentConfig(agentId) ?? resolveAgentDefaults(userDefaultsService.get());
      // v1.37 — Bash 자동 포함 제거: 툴 구성은 사용자 책임.
      //         Bash 를 제거하면 dispatch curl 경로가 동작 안 할 수 있음 — 사용자가 인지하고 선택.
      const tools = Array.isArray(body.tools) ? body.tools.filter((t): t is string => typeof t === 'string') : [...base.tools];
      // §5.3 #28 (K) v1.48 — prev config snapshot (rules diff + customMode 전이 감지용)
      const prev = graphManager.getAgentConfig(agentId);
      const prevRules = typeof prev?.rules === 'string' ? prev.rules : '';
      const prevHistory: RulesHistoryEntry[] = Array.isArray(prev?.rulesHistory) ? [...prev.rulesHistory] : [];
      const prevCustomMode = prev?.customMode;
      const incomingCustomMode =
        body.customMode === 'conti' || body.customMode === 'review' || body.customMode === 'debug'
          ? body.customMode
          : undefined;
      const userRules = typeof body.rules === 'string' ? body.rules : '';

      // §5.3 #28 (K) v1.48 — 콘티모드 전이 자동 룰 처리.
      // (i) → 'conti' 진입: rules 를 CONTI_AGENT_RULES 로 강제 덮어쓰기.
      // (ii) 'conti' → 그 외: rules 를 빈 문자열로 비움 (자동 복원 ❌, 사용자가 히스토리에서 직접).
      // (iii) 그 외 변경 없음: 사용자 입력 그대로 보존.
      let nextRules = userRules;
      let autoLabel: 'auto:conti-on' | 'auto:conti-off' | null = null;
      if (incomingCustomMode === 'conti' && prevCustomMode !== 'conti') {
        nextRules = CONTI_AGENT_RULES;
        autoLabel = 'auto:conti-on';
      } else if (prevCustomMode === 'conti' && incomingCustomMode !== 'conti') {
        nextRules = '';
        autoLabel = 'auto:conti-off';
      }

      // §5.3 #28 (K) v1.48 — rules 가 실제로 변경되었고 prev 가 비어있지 않으면 history push.
      // 빈 → 빈 또는 동일 본문은 push 하지 않음(노이즈 방지). 라벨: 자동 전이면 auto:*, 아니면 manual.
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

      const config: AgentConfig = {
        model: typeof body.model === 'string' ? body.model : base.model,
        tools,
        permissionMode: typeof body.permissionMode === 'string' ? body.permissionMode : base.permissionMode,
        skills: Array.isArray(body.skills) ? body.skills.filter((s): s is string => typeof s === 'string') : [...base.skills],
        color: typeof body.color === 'string' ? body.color : undefined,
        maxTurns: typeof body.maxTurns === 'number' ? body.maxTurns : undefined,
        isolation: typeof body.isolation === 'string' ? body.isolation : undefined,
        effort: typeof body.effort === 'string' ? body.effort : undefined,
        disallowedTools: Array.isArray(body.disallowedTools) ? body.disallowedTools.filter((t): t is string => typeof t === 'string') : undefined,
        memory: normalizeAgentMemoryScope(body.memory),
        // §5.3 v4.89 — 서브에이전트 중첩 깊이. 범위를 벗어난 값은 저장하지 않는다(CLI 기본 3층 유지).
        subagentDepth: normalizeSubagentDepth(body.subagentDepth),
        rules: nextRules.trim() ? nextRules : undefined,
        rulesHistory: nextHistory.length > 0 ? nextHistory : undefined,
        // §5.3 #12-1 v1.87 — permissionPromptMode/permissionPromptAllowPatterns 제거. 권한 축은 permissionMode 단일.
        // §5.3 #12-1 v1.90 — 60초 무응답 fallback. 'deny' 만 유효, 그 외(기본)는 undefined=allow 로 저장.
        permissionTimeoutPolicy: body.permissionTimeoutPolicy === 'deny' ? 'deny' : undefined,
        // §5.3 #28 v1.47 — Custom Mode (conti/review/debug). 그 외는 undefined.
        customMode: incomingCustomMode,
        // §4 v1.53 — 1M 컨텍스트 토글. **기본 1M** (undefined → 1M 적용).
        //   - '200k' = 명시적 opt-out (저장됨)
        //   - '1m' = 명시적 opt-in (저장됨, undefined 와 동일 동작)
        //   - 그 외(undefined 포함) = undefined 저장 = 기본 1M
        contextWindow: body.contextWindow === '200k' ? '200k' : body.contextWindow === '1m' ? '1m' : undefined,
        // §4 v1.53 — 프리셋 트레이스 메타. 값 검증은 클라에 위임(자유 문자열).
        presetId: typeof body.presetId === 'string' && body.presetId.trim() ? body.presetId.trim() : undefined,
        // §4 v2.63 — executionMode 는 에이전트 정체성(CMD vs 헤드리스)이라 AgentConfigPopup 이 보내지 않는다.
        //   PUT 이 config 를 새로 빌드하므로 여기서 prev 값을 명시 보존하지 않으면 설정 저장 시 CMD→커스텀 으로
        //   되돌아간다(회귀). body 에 명시값이 오면 그걸, 아니면 이전 값을 유지.
        executionMode:
          body.executionMode === 'interactive-terminal' || body.executionMode === 'headless'
            ? body.executionMode
            : prev?.executionMode,
        // §5.19 (B) — provider(All Model 의 정체)는 executionMode 와 같은 규약이다: **body 에 없으면
        //   이전 값을 유지**한다. 이 축을 모르는 창(에이전트 설정 팝업)이 저장하는 순간 provider 가
        //   지워지면 All Model 버블이 조용히 클로드 버블로 되돌아간다. 모델을 새로 매는 것도 이 통로다.
        provider: normalizeAgentProvider(body.provider) ?? prev?.provider,
        // §4 (CMD 터미널 업그레이드 ⑧) — CMD 버블이 띄울 CLI. `executionMode`·`provider` 와 **같은
        //   규약**이다: body 에 유효값이 오면 그걸, 없으면 이전 값을 유지한다. 이 축을 모르는 창이
        //   저장하는 순간 고른 CLI 가 조용히 claude 로 되돌아가는 것을 막는다.
        cliKind: CMD_CLI_KINDS.some((k) => k.value === body.cliKind) ? (body.cliKind as CmdCliKind) : prev?.cliKind,
        // §4 v2.88 — API 비용 상한(달러). 양수만 저장, 그 외(0/미설정)는 undefined = 무제한.
        maxBudgetUsd: typeof body.maxBudgetUsd === 'number' && body.maxBudgetUsd > 0 ? body.maxBudgetUsd : undefined,
        // §5.5 #17-20 ⑥ v4.74 — MCP 디버그 도구 선택. 알 수 없는 id 는 여기서 걸러 두면
        //   스폰 인자 조립(`prepareMcpConfig`)이 옛 설정에 흔들리지 않는다. `executionMode` 와
        //   같은 이유로 **body 에 없으면 이전 값을 유지**한다 — 이 필드를 모르는 창(에이전트
        //   설정 팝업 구버전)이 저장해도 켜 둔 도구가 조용히 꺼지지 않게.
        mcpServers: Array.isArray(body.mcpServers)
          ? body.mcpServers.filter((id): id is string => typeof id === 'string' && !!findMcpPreset(id))
          : prev?.mcpServers,
        // §4 (CLI 사양 추종) — 설치된 CLI 가 받는 신규 옵션들. 값 검증은 여기서 좁게 하고
        //   (알 수 없는 값은 저장하지 않는다 = 플래그 미전달), 실제 인자 조립은 `buildConfigArgs` 한 곳.
        fallbackModel: typeof body.fallbackModel === 'string' && body.fallbackModel.trim()
          ? body.fallbackModel.trim() : undefined,
        autoCompact: typeof body.autoCompact === 'string' && AVAILABLE_AUTOCOMPACT_VALUES.includes(body.autoCompact.trim()) && body.autoCompact.trim()
          ? body.autoCompact.trim() : undefined,
        // §4 (CLI 사양 추종) — 턴 경계 압축은 스위치가 아니라 `autoCompact` 값에서 파생된다(합쳐진 축).
        //   여기 남은 것은 **에이전트가 스스로 부르는** 직교 축 하나뿐이다.
        agentCanCompact: body.agentCanCompact === true ? true : undefined,
        excludeDynamicSystemPromptSections: body.excludeDynamicSystemPromptSections === true ? true : undefined,
        settingSources: Array.isArray(body.settingSources)
          ? (() => {
              const picked = body.settingSources.filter((s): s is string => typeof s === 'string' && AVAILABLE_SETTING_SOURCES.includes(s));
              return picked.length > 0 ? picked : undefined;
            })()
          : undefined,
        safeMode: body.safeMode === true ? true : undefined,
        // §4 (Fast 모드) — settings 키로만 켜지는 축(플래그 아님). 모델 지원 여부는 저장이 아니라
        //   스폰부(`wantsFastMode`)가 판정한다 — 사용자가 모델을 Opus 로 되돌리면 값이 그대로 살아난다.
        fastMode: body.fastMode === true ? true : undefined,
        // §4 (스트림 3종) — ①은 **기본 켬**이라 저장 규약이 반대다: 명시 `false` 만 남기고
        //   그 밖(미지정·true)은 undefined = 켬. ②③은 평범하게 true 만 저장한다.
        forwardSubagentText: body.forwardSubagentText === false ? false : undefined,
        replayUserMessages: body.replayUserMessages === true ? true : undefined,
        promptSuggestions: body.promptSuggestions === true ? true : undefined,
        // §4 (CLI 사양 추종) — Bash 타임아웃(ms). 범위를 벗어나면 저장하지 않는다(= 미설정 = CLI 기본).
        bashDefaultTimeoutMs: normalizeBashTimeoutMs(body.bashDefaultTimeoutMs),
        bashMaxTimeoutMs: normalizeBashTimeoutMs(body.bashMaxTimeoutMs),
        betas: Array.isArray(body.betas)
          ? (() => {
              const picked = body.betas.filter((b): b is string => typeof b === 'string' && b.trim().length > 0).map((b) => b.trim());
              return picked.length > 0 ? picked : undefined;
            })()
          : undefined,
      };
      // §5.3 #28 v1.47 — Custom Mode 는 커스텀 에이전트(customCreated=true) 에만 켤 수 있음.
      // Hook 에이전트는 사용자가 직접 만든 게 아니라 모드 강제 부착 ❌.
      if (config.customMode) {
        const snap = graphManager.getSnapshot();
        const agent = snap.agents.find((a) => a.id === agentId);
        if (!agent || !agent.customCreated) {
          res.status(400).json({ error: 'customMode is only allowed on custom-created agents' });
          return;
        }
      }
      graphManager.setAgentConfig(agentId, config);
      // §5.3 #28 v1.47 — customMode='conti' 최초 활성화 시 빈 conti 1건 자동 생성 (LLM 호출 ❌)
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
      res.json({ ok: true });
    } catch (err) {
      logger.error('PUT /api/agent-config failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * §5.3 #12-1 v1.43 — POST /api/permission-check
   * PreToolUse 훅이 동기 호출. 해당 세션/subagent 가 Vibisual 관할 + ask 모드면 broker 에 큐잉 후
   * 사용자 결정을 기다렸다가 `{decision:'allow'|'deny'}` 반환. 그 외는 즉시 allow.
   */
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
      }
      const body = (req.body ?? {}) as Body;

      const toolName = typeof body.toolName === 'string' ? body.toolName : '';
      const toolInput = (body.toolInput ?? {}) as Record<string, unknown>;

      // 1) 관할 에이전트 resolve — parentAgentId 우선, 그 다음 sessionId 역방향.
      let agentId: string | null = body.parentAgentId ?? null;
      if (!agentId && typeof body.sessionId === 'string') {
        agentId = graphManager.findAgentIdBySession(body.sessionId);
      }
      if (!agentId) {
        // Vibisual 관할이 아님 — 즉시 통과
        res.json({ ok: true, decision: 'allow', reason: 'not-managed' });
        return;
      }

      // §5.3 #12-1 v1.87 — 권한 승인 팝업은 **커스텀 에이전트 전용**.
      // 훅으로 생성된 에이전트 버블(사용자의 Claude Code 세션 시각화)은 view-only —
      // 절대 승인 모달을 띄우지 않는다(이 세션 자신의 도구 호출을 막아선 안 됨).
      const agentNode = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
      if (!agentNode || !agentNode.customCreated) {
        res.json({ ok: true, decision: 'allow', reason: 'view-only-agent' });
        return;
      }

      const config = graphManager.getAgentConfig(agentId);
      if (!config) {
        // 설정 없음 — 막을 근거 없음, 통과
        res.json({ ok: true, decision: 'allow', reason: 'no-config' });
        return;
      }

      /*
       * §5.22 — 권한·감사 경계.
       *
       * 원장 줄은 **모드 단축보다 먼저** 적는다. 통과시킨 호출까지 남아야 "그때 무슨 일이
       * 있었나"에 답할 수 있고, 묻지 않은 것과 허용한 것이 다른 상태로 구분된다.
       * (훅으로만 붙은 세션은 이 창구에 오지 않지만 `processHookEvent` 가 같은 원장에 적는다 —
       *  이 창구가 커스텀 에이전트 전용이라는 기존 경계는 그대로 둔다.)
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

      // §5.3 #12-1 v1.87 — 권한 축 = permissionMode 단일. CC 정식 권한모델에 팝업 발동을 매핑:
      //   bypassPermissions → 무확인 / plan → 실행차단은 CC 자체 / 읽기전용 → 자동 allow
      //   acceptEdits → 편집계열 자동 allow / default·acceptEdits(비편집 가변) → 사용자 확인 팝업
      const mode = config.permissionMode || 'default';
      const EDIT_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);

      // §5.22 — `!escalate` 가 붙은 단축은 **위험 3종이 아닐 때만** 탄다. 경계를 끄면
      //   `escalate` 가 늘 false 라 아래는 종전 그대로 동작한다.
      if (!escalate && mode === 'bypassPermissions') {
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
      if (!escalate && mode === 'auto') {
        res.json({ ok: true, decision: 'allow', reason: 'cli-auto-classifier' });
        return;
      }
      // §5.22 — 읽기 전용 도구의 통과도 종전 그대로다(위험 3종 어디에도 걸리지 않는다).
      if (READ_TOOLS.has(toolName)) {
        res.json({ ok: true, decision: 'allow', reason: 'read-only' });
        return;
      }
      if (!escalate && mode === 'acceptEdits' && EDIT_TOOLS.has(toolName)) {
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

      // §5.3 #12-1 v1.90 — 60초 무응답 fallback 정책 (기본 allow).
      const timeoutPolicy = config.permissionTimeoutPolicy === 'deny' ? 'deny' : 'allow';
      // §5.3 #12-1 v1.91 — 팝업 대기 동안 에이전트를 "블록된 활성"으로 고정(completed 강등 방지).
      graphManager.setPermissionWaiting(agentId, true);
      // §5.22 — 모드가 통과시켰을 호출을 경계가 되돌려 물었다는 표식(타임라인에서 구분된다).
      if (escalate && auditEntryId) graphManager.markAuditEscalated(auditProject, auditEntryId);
      broadcastSnapshot();
      let decision;
      try {
        decision = await permissionBroker.request({
          agentId,
          // §5.3 #12-1 v1.96 — sub 인스턴스 ID 를 stamp 해서 broker resolve 후
          // 사용자의 Allow/Deny 결정을 그 sub 의 stream 라인으로 합성할 수 있게 한다.
          subAgentId: typeof body.subAgentId === 'string' && body.subAgentId ? body.subAgentId : undefined,
          agentLabel,
          agentColor,
          projectName,
          toolName,
          toolInput,
          // §5.22 — 카드가 "왜 지금 묻는지"를 말할 수 있게 위험 판정을 함께 싣는다.
          ...(riskKinds.length > 0 ? { risk: riskKinds } : {}),
          ...(escalate ? { escalated: true } : {}),
          ...(auditEntryId ? { auditEntryId } : {}),
        }, timeoutPolicy);
      } finally {
        graphManager.setPermissionWaiting(agentId, false);
        broadcastSnapshot();
      }
      // §5.22 — 사람(또는 60초 무응답 정책)의 답을 원장의 그 줄에 적는다.
      noteAuditDecision(
        decision.decision,
        decision.reason === 'timeout' ? 'timeout' : 'user',
        decision.reason,
      );
      res.json({ ok: true, decision: decision.decision, reason: decision.reason });
    } catch (err) {
      logger.error('POST /api/permission-check failed', err);
      // safe-deny on error
      res.status(500).json({ ok: false, decision: 'deny', reason: 'internal-error' });
    }
  });

  /**
   * §5.3 #12-1 v1.43 — POST /api/permission-decide
   * 클라 모달에서 Allow/Deny 버튼 클릭 시 호출. broker 의 pending 요청 해제.
   */
  app.post('/api/permission-decide', (req, res) => {
    try {
      const body = (req.body ?? {}) as Partial<PermissionDecision>;
      if (typeof body.requestId !== 'string' || (body.decision !== 'allow' && body.decision !== 'deny')) {
        res.status(400).json({ ok: false, error: 'invalid payload' });
        return;
      }
      const resolved = permissionBroker.resolve({
        requestId: body.requestId,
        decision: body.decision,
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

  /**
   * §5.7 #23-1 v1.59 — GET /api/claude-version
   * 현재 사용 중인 `claude` 바이너리 버전 + npm registry latest 비교 결과.
   * latest 는 5분 TTL 캐시 — `?refresh=1` 로 무효화 가능.
   */
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
   * §4 v2.43 — GET /api/claude-installs
   * 옵션창 Version 탭 데이터: PC 에 깔린 모든 claude 설치본 + 현재 활성/선택 + Vibisual·런타임 메타 + npm latest.
   * `?refresh=1` 로 registry 캐시 무효화. 선택 저장은 기존 `PUT /api/user-defaults {claudeBinPath}` 재사용.
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
   * §5.7 #23-1 v1.59 — POST /api/claude-version/install
   * `npm install -g @anthropic-ai/claude-code` 1회 발사. 단일 in-flight 락 — 동시 호출은 같은 installId 반환.
   * 진행 상황은 WS `claude_install_progress` 로 푸시.
   */
  app.post('/api/claude-version/install', (_req, res) => {
    try {
      const progress = installLatestClaude();
      res.json({ ok: true, progress });
    } catch (err) {
      logger.error('POST /api/claude-version/install failed', err);
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /**
   * §5.7 #23-1 v1.59 — GET /api/claude-version/install
   * 진행 중인 설치 작업 상태 조회 (WS 재연결/페이지 reload 복구용).
   */
  app.get('/api/claude-version/install', (_req, res) => {
    res.json({ ok: true, progress: getInflightInstall() });
  });

  /**
   * §5.7 #23-1 v1.59 — POST /api/claude-version/dismiss-session
   * 사용자가 "이번 세션 건너뛰기" 또는 "이 버전 계속 쓰기" 선택 — registry 캐시 무효화로
   * 다음 세션(페이지 새로고침) 시 신선한 결과를 받게 한다.
   */
  app.post('/api/claude-version/dismiss-session', (_req, res) => {
    invalidateLatestCache();
    res.json({ ok: true });
  });

  // ─── §5.19 All Model — 로컬 LLM (엔진 설치 · 모델 카탈로그 · 내려받기) ───
  //
  // 전부 조회/조작 전용이라 그래프 상태를 건드리지 않는다. 목록이 바뀌는 조작(설치 시작·
  // 내려받기·삭제) 뒤에는 스냅샷을 한 번 밀어 화면이 곧바로 따라오게 한다.

  // §5.19 (E) — 내려받기가 끝나면 그 모델에게 실제로 몇 마디 시켜 본다.
  //   러너와 모델 서비스가 서로 물지 않도록 배선은 여기 한 곳에서 한다.
  setModelDownloadedHook((modelId) => {
    void verifyModelOutput(modelId).then(() => broadcastSnapshot());
  });

  /** GET /api/local-llm — 엔진 상태 + 받아 둔 모델 + 진행 중 내려받기. */
  app.get('/api/local-llm', (_req, res) => {
    void (async (): Promise<void> => {
      // 사양은 엔진에게 물어 온다(§5.19 (E)) — 캐시가 살아 있으면 프로세스를 띄우지 않는다.
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

  // ── §5.5 #17-38 ⑫ 오프라인 받아쓰기 ──────────────────────────────────────
  //
  // 마이크를 누르면 화면이 먼저 여기에 묻는다. 준비돼 있으면 곧장 듣기 시작하고, 아니면
  // 설치 창이 뜬다(§5.19 (B) "준비됐는지는 그 버블을 눌렀을 때 판정한다" 와 같은 흐름).

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
   * POST /api/voice-asr/session/start — 받아쓰기 한 번을 시작한다.
   *
   * 엔진이 안 떠 있으면 **여기서 띄운다**(모델 적재에 몇 초 든다). 돌려주는 것은 포트 하나이고,
   * 표본은 화면이 그 포트로 곧장 보낸다 — 초당 64KB 를 메인 스레드에 붓지 않기 위해서다.
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
   * `sort` 는 §5.19 (E) 의 네 축(내려받기·하트·트렌딩·최근) 중 하나. 모르는 값이 오면
   * 내려받기 순으로 떨어뜨린다 — 낯선 문자열을 카탈로그에 그대로 넘기지 않는다.
   */
  app.get('/api/local-llm/catalog', (req, res) => {
    void (async (): Promise<void> => {
      const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
      const raw = req.query['sort'];
      const sort = LOCAL_MODEL_CATALOG_SORTS.find((s) => s === raw) ?? 'downloads';
      const repos = await searchCatalog(q, sort);
      res.json({ ok: true, repos });
    })();
  });

  /** GET /api/local-llm/catalog/files?repo= — 그 저장소의 GGUF(=양자화 선택지) 목록. */
  app.get('/api/local-llm/catalog/files', (req, res) => {
    void (async (): Promise<void> => {
      const repo = typeof req.query['repo'] === 'string' ? req.query['repo'] : '';
      if (!repo) {
        res.status(400).json({ ok: false, error: 'repo required' });
        return;
      }
      const files = await listRepoFiles(repo);
      res.json({ ok: true, files });
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
   * §5.3 #12-1 v1.43 — GET /api/permission-pending
   * 클라 재연결 시 현재 대기 중인 권한 요청 복구용.
   */
  app.get('/api/permission-pending', (_req, res) => {
    try {
      res.json({ ok: true, pending: permissionBroker.listPending() });
    } catch (err) {
      logger.error('GET /api/permission-pending failed', err);
      res.status(500).json({ ok: false, pending: [] });
    }
  });

  /**
   * §5.3 #12-2 v2.26 — POST /api/ask-user-question
   * PreToolUse 훅이 `tool_name === 'AskUserQuestion'` 분기에서 동기 호출.
   * 커스텀 에이전트가 호출자면 broker 큐잉 → 사용자 응답 또는 60s 타임아웃까지 대기.
   * 응답은 `{ decision: 'answer' | 'timeout' | 'reject', selectedLabels: string[], note?: string }`.
   * 훅은 이 결과를 `permissionDecisionReason` 으로 합성해 모델 transcript 로 도달시킨다.
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

      // 2) 커스텀 에이전트 가드(view-only 제외) — §5.3 #12-1 v1.87 패턴 재사용.
      const agentNode = graphManager.getSnapshot().agents.find((a) => a.id === agentId);
      if (!agentNode || !agentNode.customCreated) {
        res.json({ ok: true, decision: 'reject', reason: 'view-only-agent', selectedLabels: [] });
        return;
      }

      // 3) toolInput 유효성 — claude-code v2.1.145+ 스키마는 `questions: AskUserQuestionItem[]`.
      //    CLI 와 동일하게 모든 질문을 순차로 surface — 본 라운드는 한 카드에 step 으로 묶어 답한다.
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

      // §5.3 #12-1 v1.91 — 훅 hold 중 "블록된 활성" 으로 고정.
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

  /**
   * §5.3 #12-2 v2.26 — POST /api/ask-user-question/decide
   * 클라 IDE 카드의 Send 버튼이 호출. broker pending 해제.
   */
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

  /**
   * §5.3 #12-2 v2.26 — GET /api/ask-user-question/pending
   * 클라 재연결 시 대기 중인 질문 복구용.
   */
  app.get('/api/ask-user-question/pending', (_req, res) => {
    try {
      res.json({ ok: true, pending: askUserQuestionBroker.listPending() });
    } catch (err) {
      logger.error('GET /api/ask-user-question/pending failed', err);
      res.status(500).json({ ok: false, pending: [] });
    }
  });

  /**
   * §4 (CLI 사양 추종) — POST /api/agent-compact
   *
   * `agentCanCompact` 를 켠 에이전트가 **일하는 도중** "이제 접자"고 신고하는 창구. 지금은 그
   * 세션에 실행 중 명령(자기 턴)이 있어 압축을 바로 못 쏘므로 대기표에만 적고, 그 턴이 끝나는
   * 자리에서 `maybeCompactAfterTurn` 이 큐에 `/compact` 를 얹는다 — 작업이 도중에 잘리지 않는
   * 이유가 이것이다. 여러 번 불러도 Set 이라 한 번만 돈다.
   *
   * 카드 5경로와 **같은 규율**의 loopback ingress(127.0.0.1 바인드 + 토큰)이며 §10 의
   * 'HTTP/REST API 외부 노출' 이 아니다. 표시 전용은 아니지만(실제로 압축이 돈다) 실패해도
   * 에이전트의 일에는 영향이 없다.
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
   * §4 v2.52 — POST /api/agent-report
   * 커스텀/스폰 에이전트가 작업 완료 시 did/userActions 를 구조화 신고(loopback curl, 토큰 인증).
   * 서버는 id/createdAt 을 stamp 해 ProjectGraph 에 적재하고 broadcast → IDE 가 색 구분 카드 렌더.
   * 표시 전용 — 게임플레이/판정 로직과 무관. Hook 에이전트는 신고 지시문이 없어 호출하지 않음.
   */
  app.post('/api/agent-report', (req, res) => {
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
      // §5.10 v3.49 — 브리핑/주입으로 받은 카드 중 실제 도움된 id. 랭킹 "도움됨" 신호(markHelpful).
      const helpfulMemoryIds = toStrArray(body.helpfulMemoryIds).map((s) => s.trim());
      // §5.10 v3.78 — 대칭 채널. 브리핑으로 받았지만 **지금 코드와 어긋난** 카드 id(재검증 1비트 회수).
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
      // §5.10 — learned → 개별(agent) 기억 카드. 실패해도 신고 자체는 성공 처리.
      if (learned.length > 0) {
        try {
          const root = graphManager.getProjectPathForAgent(body.agentId) ?? graphManager.getRoot();
          if (root) {
            const svc = getBrainService(root);
            for (const line of learned) {
              svc.saveCard({
                type: 'lesson',
                scope: 'agent',
                agentId: body.agentId,
                title: line.slice(0, 60),
                body: line,
                seen: false,
              });
            }
            graphManager.notifyBrainChanged();
          }
        } catch (e) {
          logger.warn('[brain] learned card save failed', e as Error);
        }
      }
      // §5.10 v3.49 — helpfulMemoryIds → markHelpful(랭킹 도움됨 신호). best-effort, 미지 id 는 무시.
      // §5.10 v3.81 — **여기서 재검증을 함께 하지 않는다.** v3.78 은 "도움됨"이 오면 앵커를 다시 박고
      //   확인 필요를 풀었는데, 그건 **유용성 신호를 사실성 판정으로 승격**시키는 자리였다(에이전트가
      //   "유용했다"고만 해도 낡은 카드가 현재 진실로 되돌아왔다). 재검증은 출처 자동 대조와
      //   사용자 [지금도 맞음] 두 경로로만 한다. 낡음 신고는 종전대로 적립(누적 시 보관, 삭제 ❌).
      if (helpfulMemoryIds.length > 0 || staleMemoryIds.length > 0) {
        try {
          const root = graphManager.getProjectPathForAgent(body.agentId) ?? graphManager.getRoot();
          if (root) {
            const svc = getBrainService(root);
            for (const cid of helpfulMemoryIds) svc.markHelpful(cid);
            for (const cid of staleMemoryIds) svc.markStale(cid);
            if (staleMemoryIds.length > 0) graphManager.notifyBrainChanged();
          }
        } catch (e) {
          logger.warn('[brain] memory feedback failed', e as Error);
        }
      }
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
   * §4 v2.60 — POST /api/agent-questions
   * 커스텀/스폰 에이전트가 사용자에게 던지는 질문(1~N) + 제안 프롬프트를 구조화 신고(loopback curl, 토큰 인증).
   * 서버는 id/createdAt 을 stamp 해 ProjectGraph 에 적재하고 broadcast → IDE 가 질문 카드 렌더.
   * 표시 전용. Hook 에이전트는 지시문이 없어 호출하지 않음. agent-report 와 동형 골격.
   */
  app.post('/api/agent-questions', (req, res) => {
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
   * §4 v2.70 — POST /api/agent-review
   * 커스텀/스폰 에이전트가 사용자 지시 작업을 완료한 뒤 changes/checkpoints 검수 요청을 구조화 신고(loopback curl, 토큰 인증).
   * 서버는 id/createdAt 을 stamp 해 ProjectGraph 에 적재하고 broadcast → IDE 가 보라색 검수 카드 렌더.
   * userActions("직접 해")와 성격이 다르다 — 이쪽은 "AI 가 완료한 결과를 검수". agent-report/agent-questions 와 동형 골격.
   */
  app.post('/api/agent-review', (req, res) => {
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

  /**
   * §4 v2.84 — POST /api/agent-list
   * 커스텀/스폰 에이전트가 답변의 번호/순서 목록을 items 배열로 구조화 신고(loopback curl, 토큰 인증).
   * 서버가 id/createdAt 을 stamp 해 ProjectGraph 에 적재하고 broadcast → IDE 가 번호를 자동으로 매겨 정렬 카드 렌더.
   * 번호 매김은 IDE 가 하므로 항목 텍스트만 받는다. agent-report/agent-questions/agent-review 와 동형 골격.
   */
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
   * §4 (CMD 터미널 업그레이드 ①) — POST /api/cmd-terminal-state
   *
   * 임베디드 터미널 뷰가 **감지한** 상태(`working|idle|blocked`)를 올린다. 판정·쓰기·전파는
   * 서버가 한다(§3.1 서버 = SSOT) — 클라는 바이트 흐름만 보고 신호를 보낼 뿐이다.
   * 훅이 없는 CLI(codex·gemini 등)도 이 경로로 상태가 보인다는 것이 ⑧과 맞물리는 핵심이다.
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
   * §5.5 #17-36 — PUT /api/session-memos
   *
   * 그 화면(세션 탭 또는 메인 탭)에 붙여 둔 **스티키 메모 목록 전량**을 저장한다. 부분 갱신을
   * 받지 않는 것은 의도다 — 한 필드만 보내면 나머지가 빈 값으로 강등되는 사고를 규약으로 막는다.
   *
   * 자리는 둘로 갈린다: `subAgentId` 가 오면 **그 세션의 소지품**(`SubAgent.memos`)이라 세션이
   * 사라질 때 함께 사라지고, 없으면(메인 탭) 에이전트 쪽(`ProjectGraph.agentMemos`)에 둔다.
   * 신뢰할 수 없는 입력이므로 `sanitizeSessionMemos` 로 걸러 넣는다(장수·크기·색·좌표 상한).
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
   * §4 (CMD 터미널 업그레이드 ⑥) — POST /api/cmd/send
   *
   * 에이전트가 CMD 터미널에 **prefill** 한다. herdr 의 `pane send-text` 자리지만
   * **개행·Enter 는 절대 넣지 않는다**(`sendCmdTerminal` 이 개행을 걷어 낸다) — 사람이 Enter 를
   * 치는 것이 §4 v2.63 이 세운 Anthropic ToS 합법선이고, herdr 의 `agent prompt --wait` 를
   * 의도적으로 따라가지 않는 지점이다.
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
   * §7.11 v2.29 — POST /api/agent-iframe
   * 커스텀/스폰 에이전트가 "사용자가 열어볼 로컬 서버" 를 띄웠을 때 그 URL 을 신고(loopback curl, 토큰 인증).
   * 서버는 agentId 소속 세션을 찾아 그 URL 로 iframe 위성을 **직접** 생성한다(정규식 추측 없이 결정론적).
   * 진짜 서버만: isPortAlive 로 확인된 뒤에만 위성 생성(reportIframeFromAgent 가 boot race 재시도). 중복 없음:
   * 위성 키가 (세션,포트)라 같은 포트 재신고·감지 폴백과 하나로 합류. agent-report 와 동형 골격.
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
   * §4 v3.21 — POST /api/agent-feedback
   * 사용자가 IDE 에서 AI 작업 결과(작업 신고/검수 카드/스트림 result)에 남기는 좋아요/싫어요.
   * targetId 별 upsert — 같은 대상 재평가는 verdict 교체, `verdict:null` 은 평가 철회(제거).
   * 클라 UI 발신(렌더러 in-process fetch)이라 loopback 토큰 화이트리스트 불필요.
   * 표시·학습 보조 전용 — 실제 작업/판정 로직 무관.
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
   * §4 v3.21 — POST /api/agent-feedback/:agentId/distill
   * 이 에이전트의 싫어요 피드백을 one-shot claude CLI(haiku)로 규칙 문장으로 증류해 **제안만 반환**.
   * 적용은 사용자가 클라 확인 모달에서 승인 후 기존 `PUT /api/agent-config/:agentId` rules append 로
   * (rulesHistory 롤백 가능). 자동 append 금지 — 일회성 싫어요의 영구 규칙화 방지.
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
      // preserve-pin 가드 (§2.4 v1.28)
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
      // v1.85 — 사용자 명시 버블 삭제: 에이전트면 그 Task Edge 까지 cascade 제거(고아 방지).
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
        // preserve-pin 가드 (§2.4 v1.28) — 차단된 건 건너뛰고 나머지는 계속 삭제
        if (graphManager.isPreservePinned(nodeId)) {
          blocked.push(nodeId);
          continue;
        }
        // §5.10 — 커스텀 에이전트는 즉시 소멸 대신 휴지통 이동.
        if (graphManager.tryTrashCustomAgentByBubbleId(nodeId)) {
          deleted.push(nodeId);
          continue;
        }
        // v1.85 — 사용자 명시 일괄 삭제: 에이전트면 Task Edge 까지 cascade 제거.
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

  /** PATCH /api/bubble/:nodeId/preserve-pin — preserve-pin 토글 (§2.4 v1.28) */
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

  /** GET /api/folder-files — 폴더의 파일 트리 (디스크 기반).
   *  `absolutePath` 를 함께 받으면 그것으로 프로젝트 인스턴스를 먼저 찍는다 —
   *  노드 키는 프로젝트 루트 기준 상대 경로라 `docs` 처럼 흔한 이름은 다른 프로젝트 것이
   *  먼저 답할 수 있다(`open-node-file` 과 같은 규약, 프로젝트 컨텍스트 보존). */
  /**
   * GET /api/folder-files — §7.5 폴더 목록: 디렉터리 **한 겹**의 **한 페이지**.
   *
   * `?nodePath=<폴더 노드 키>` 에 세 가지를 더 받는다 — `relPath`(그 폴더 아래로 펼친 자리),
   * `cursor`(이전 응답의 `nextCursor`), `limit`(장당 개수). 답은 `FolderFilePage` 다.
   *
   * 종전에는 폴더를 통째로 재귀해 `{ files }` 한 벌로 돌려줬고, 외부 폴더 버블이 사용자 홈이면
   * 그 동기 열거가 메인 프로세스를 세워 창이 "응답 없음"이 됐다. 이 창구를 나누지 않고 그대로
   * 페이지화한 것은 `absolutePath` 인스턴스 라우팅·위성 매칭 규약을 두 벌로 만들지 않기 위함이다.
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
   * GET /api/workspace-dir — §5.5 #17-19 v4.71 IDE 탐색기: 디렉터리 **한 겹** 조회.
   *
   * `root` 는 클라가 아는 프로젝트 루트를 그대로 받는다(`open-node-file` 이 `absolutePath` 를
   * 받는 것과 같은 규약) — 대신 등록된 프로젝트 루트 안인지 여기서 검사하고, 루트를 벗어나는
   * `path`(`..`) 는 `listWorkspaceDir` 이 한 번 더 막는다. 조회 전용이라 broadcast·checkpoint 없음.
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
   * GET /api/workspace-path — §5.5 #17-27 ⑬ 스트림 본문의 경로: **한 경로의 정체** 조회.
   *
   * `?root=<절대경로>&path=<상대경로>` → `{ root, path, absPath, kind: 'file' | 'directory' }`.
   * 없으면 404 이고, 화면은 그 조각을 **평범한 인라인 코드로 그대로 둔다**(가짜 손잡이를 만들지 않는다).
   * 가드는 탐색기(`/api/workspace-dir`)와 같은 `isWithinOpenableRoots` + `resolveWorkspacePath` 하나다.
   * 조회 전용이라 broadcast·checkpoint 없음.
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
   * GET /api/external-path — §5.5 #17-27 ⑬ (d) 프로젝트 루트 **밖** 경로의 존재·정체 조회.
   *
   * `?path=<절대경로>` → `{ absPath, kind: 'file' | 'directory' }`, 없으면 404(화면은 그 조각을
   * 종전과 같은 평문 인라인 코드로 둔다 — (b) 의 "가짜 손잡이를 만들지 않는다" 그대로).
   *
   * **`isWithinOpenableRoots` 를 쓰지 않는다** — 루트 밖인 것이 이 라우트의 전제다. 그 대신 경계는
   * **닿을 수 있는 자가 누구인가**로 세운다: 이 경로는 loopback 리스너 화이트리스트에 **올리지 않으므로**
   * 외부 `claude` 프로세스는 404 를 받고, 페어링된 기기는 REST 가 아니라 채팅 명령 파서로만 들어온다.
   * 즉 부를 수 있는 것은 렌더러(사용자 자신의 창)뿐이다(§3.7 경계 유지).
   *
   * 답에 `executable` 이 없는 것은 누락이 아니라 **설계**다 — 루트 밖은 탐색기 한 갈래로만 가고,
   * 실행 여부를 알려 주는 순간 그 갈래가 늘어난다. 조회 전용이라 broadcast·checkpoint 미관여.
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
   * POST /api/reveal-path — §5.5 #17-27 ⑬ (d) 루트 밖 경로를 **시스템 탐색기에 보여준다**.
   *
   * 여는 실행부는 이미 있는 `editorLauncher.openFolder` 하나다(**새 열기 레일 ❌**) — Windows 는
   * `explorer` + 포그라운드 보정, macOS 는 `open`, 그 밖은 `xdg-open` 이고 **파일을 주면 그 파일이 든
   * 상위 폴더**를 연다. 그래서 이 라우트가 하는 일은 "있는가"를 한 번 더 확인하고 넘기는 것뿐이다.
   *
   * 경계는 위 `GET /api/external-path` 와 같다 — 화이트리스트 밖이라 렌더러만 닿는다. 그리고 여기서
   * **여는 갈래를 늘리지 않는다**: 연결 프로그램(`openWithDefaultApp`)·실행(`startRun`)으로는 가지 않는다.
   * 본문 글자를 눌러 임의 경로가 실행되는 길을 만들지 않는 것이 ⑬ (d) 개정의 조건이었다.
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
   * GET /api/workspace-file — §5.5 #17-27 v4.87 IDE 내장 편집창: 파일 **한 개** 읽기.
   *
   * 가드는 탐색기(`/api/workspace-dir`)와 같은 `isWithinOpenableRoots` + `resolveWorkspacePath` 하나다.
   * 조회 전용이라 broadcast·checkpoint 없음.
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
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`workspace-file blocked (outside project root): "${root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const file = readWorkspaceFile(resolvedRoot, relPath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      res.json(file);
    } catch (err) {
      logger.error('GET /api/workspace-file failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/workspace-file — §5.5 #17-27 v4.87 IDE 내장 편집창: 파일 **한 개** 저장.
   *
   * `baseMtimeMs` 는 클라이언트가 읽을 때 본 수정 시각이라, 그 사이 디스크가 바뀌었으면 409 로 막는다
   * (에이전트가 같은 파일을 고친 경우 = 사용자의 편집이 그 작업을 조용히 덮어쓰는 사고). 사용자가
   * 화면에서 "그래도 저장" 을 고르면 `baseMtimeMs: 0` 으로 다시 온다. 사용자 소스 파일이라
   * §3.2.1 체크포인트 창구가 아니라 평범한 쓰기이고, 그래프 상태가 아니므로 broadcast 도 없다.
   *
   * §5.5 #17-27 ⑫ — 디스크가 잠근 파일(Perforce 체크아웃 전 파일 등)은 423 으로 갈라 답하고,
   * 사용자가 [읽기 전용 해제하고 저장] 을 고르면 `clearReadOnly: true` 로 다시 온다.
   */
  app.put('/api/workspace-file', (req, res) => {
    try {
      const { root, path: relPath, text, eol, baseMtimeMs, clearReadOnly } = req.body as {
        root?: string; path?: string; text?: string; eol?: string; baseMtimeMs?: number; clearReadOnly?: boolean;
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
   * GET /api/workspace-image — §5.5 #17-27 ⑭ IDE 내장 편집창: 이미지 **한 장**의 원본 바이트.
   *
   * 텍스트 창구(`/api/workspace-file`)와 갈라 둔 이유는 돌려주는 것이 JSON 이 아니라 바이트라서다.
   * 가드는 같은 `isWithinOpenableRoots` + `resolveWorkspacePath` 하나를 그대로 쓴다(새 가드 발명 ❌).
   * 조회 전용이라 broadcast·checkpoint 없음. 캐시하지 않는다 — 주석을 저장하면 **같은 URL 의 내용만**
   * 바뀌므로 캐시가 남으면 방금 그린 표시가 화면에 안 나타난다.
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
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`workspace-image blocked (outside project root): "${root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const image = readWorkspaceImage(resolvedRoot, relPath);
      if (!image) {
        res.status(404).json({ error: 'Image not found' });
        return;
      }
      res.setHeader('Content-Type', image.mime);
      res.setHeader('Cache-Control', 'no-store');
      res.end(image.bytes);
    } catch (err) {
      logger.error('GET /api/workspace-image failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/workspace-image — §5.5 #17-25 ④-1 라이트박스 주석본으로 그 이미지 파일 덮어쓰기.
   *
   * 본문은 **이미지 바이트 그대로**이고 나머지 값은 쿼리로 온다. JSON+base64 로 싣지 않는 이유는 둘이다 —
   * base64 가 33% 를 부풀리고, 앱 전역 `express.json()` 상한(100kb)에 스크린샷 한 장이 바로 걸린다.
   * 그래서 이 라우트에만 `express.raw` 를 물린다(전역 상한은 손대지 않는다 — 한 기능 때문에 모든
   * 엔드포인트의 방벽을 낮추지 않는다).
   *
   * 덮어쓰기 규율은 텍스트 저장(`PUT /api/workspace-file`)과 **같다** — 읽을 때 본 `mtimeMs` 가
   * 디스크와 다르면 409, 사용자가 [그래도 저장]을 고르면 `baseMtimeMs=0` 으로 다시 온다.
   * 굽지 못하는 형식(svg·gif·ico·bmp·avif)은 415 로 갈라 답한다.
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
        const baseMtimeMs = typeof rawBase === 'string' ? Number(rawBase) : 0;
        const outcome = writeWorkspaceImage(
          resolvedRoot,
          relPath,
          bytes,
          Number.isFinite(baseMtimeMs) ? baseMtimeMs : 0,
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
   * GET /api/workspace-media — §5.13 (R) 영상·음악·3D·PDF 파일의 **바이트**(구간 요청 지원).
   *
   * 이미지 창구(`/api/workspace-image`)와 갈라 둔 이유는 크기와 재생 방식이다 — 이미지는 통째로
   * 읽어 한 번에 보내면 되지만, 영상·음악은 몇백 MB 가 예사이고 `<video>`·`<audio>` 는 **Range**
   * 요청으로 필요한 구간만 집어 간다(그래야 되감기·구간 반복이 즉시 반응한다). 통째로 보내면
   * 서버 메모리에 파일 전체가 올라오고 첫 프레임까지 몇 초가 걸린다.
   *
   * 가드는 탐색기·편집창과 같은 `isWithinOpenableRoots` + `resolveWorkspacePath` 하나 그대로다.
   */
  app.get('/api/workspace-media', (req, res) => {
    try {
      const root = req.query['root'];
      const relPath = req.query['path'];
      if (typeof root !== 'string' || root.length === 0 || typeof relPath !== 'string' || relPath.length === 0) {
        res.status(400).json({ error: 'root and path query required' });
        return;
      }

      const resolvedRoot = path.resolve(root);
      if (!isWithinOpenableRoots(resolvedRoot)) {
        logger.warn(`workspace-media blocked (outside project root): "${root}"`);
        res.status(403).json({ error: 'Path outside project root' });
        return;
      }

      const resolved = resolveWorkspacePath(resolvedRoot, relPath);
      if (!resolved) {
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
   * PUT /api/workspace-media — §5.13 (R-4) 음악 편집기가 만든 **새 파일**을 프로젝트 안에 쓴다.
   *
   * 본문은 바이트 그대로(이미지 저장과 같은 이유 — base64 는 33% 를 부풀리고 `express.json()`
   * 상한에 바로 걸린다). **덮어쓰기를 허용하지 않는다** — 편집 결과는 항상 새 이름으로 남고
   * 원본은 그대로 있어야 한다(사람의 창작물을 잃지 않는다는 §5.13 (I) 와 같은 판단).
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
   * GET /api/workspace-site/<루트>/<파일…> — §5.5 #17-27 ⑮ HTML 을 **페이지로** 내보내는 창구.
   *
   * 이 앱의 다른 파일 창구는 전부 질의형(`?root=&path=`)인데 여기만 **경로형**인 이유는
   * 하나다 — 페이지는 자기 옆의 파일을 상대 경로로 부른다. 질의형에서는
   * `<link href="style.css">` 가 `/api/style.css` 로 풀려 CSS·그림·스크립트가 전멸한다.
   * 경로형이면 `./`·`../` 가 브라우저의 규칙 그대로 풀린다(규약·왕복 검증은 shared
   * `workspaceSite.ts` — 조립하는 쪽과 해석하는 쪽이 갈라지지 않게 한 파일에 있다).
   *
   * 가드는 탐색기·편집창·미디어와 **같은 `isWithinOpenableRoots` + `resolveWorkspacePath`**
   * 하나 그대로다(새 가드 발명 ❌). 열린 프로젝트 밖은 어떤 경로로도 나가지 못한다.
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
        // 순서가 규칙이다. ① **원본 그대로** 시작 태그마다 줄:칸을 적는다(⑮ (i)) — 재작성이
        // 먼저 돌면 늘어난 글자만큼 위치가 밀려 엉뚱한 줄을 가리킨다. ② 루트 절대 경로 재작성.
        // ③ 부모와 말하는 조각((b) 위치 신고 · (i) 요소 집기)은 **맨 마지막** — 먼저 얹으면 그
        // 안의 문자열이 재작성 정규식에 걸린다.
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
   * §5.5 #17-19 ⑦ — 탐색기 우클릭이 디스크에 내는 세 변경(만들기 · 이름 바꾸기 · 삭제)의 공용 앞단.
   *
   * `root` 는 조회 창구(`/api/workspace-dir`)와 **같은 규약**으로 클라가 아는 프로젝트 루트를 그대로
   * 받고, 등록된 루트 안인지 여기서 검사한다(루트를 벗어나는 `path` 는 서비스가 한 번 더 막는다).
   * 디스크가 SSOT 라 broadcast·checkpoint 미관여(#17-19 ⑥ 그대로).
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
   * POST /api/workspace-entry/move — §5.5 #17-19 ⑧ 옮기기(끌어다 폴더에 놓기).
   *
   * 이름 바꾸기(`PATCH`)와 **다른 창구**다 — 이름은 그대로 두고 사는 폴더만 바뀌며, 화면의 되물음도
   * 다르다. 되물음 자체는 화면의 몫이고 여기서는 시키는 대로 옮긴다(#17-19 ⑦ 삭제와 같은 분담).
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

  /**
   * DELETE /api/workspace-entry — §5.5 #17-19 ⑦ 삭제.
   *
   * 데스크톱 앱에서는 **OS 휴지통**으로 간다(Electron `shell.trashItem` 주입 — `setWorkspaceTrash`).
   * 그 통로가 없는 실행 형태에서는 영구 삭제이고, 어느 쪽이었는지는 `trashed` 로 화면까지 전해진다.
   */
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

  /**
   * GET /api/workspace-trash — §5.5 #17-19 ⑦ 이 실행 형태가 **휴지통을 쓸 수 있는가**.
   *
   * 되물음 문구가 갈리는 자리라 화면이 미리 알아야 한다 — "휴지통으로 보냅니다"와 "영구히
   * 지웁니다"는 사용자가 다른 결정을 내리는 문장이다. 조회 전용.
   */
  app.get('/api/workspace-trash', (_req, res) => {
    res.json({ available: isWorkspaceTrashAvailable() });
  });

  /**
   * POST /api/open-external — §5.13 (R-6) 그 파일을 **OS 연결 프로그램**으로 연다.
   *
   * `/api/open-node-file`(외부 **에디터**로 열기)과 병행이다. 그쪽은 코드를 고치러 가는 길이라
   * VS Code 를 찾고 없으면 메모장으로 떨어지는데, zip·폰트·xlsx 를 그리로 보내면 이진 바이트가
   * 메모장에 쏟아진다. 가드는 열기 라우트 둘과 같은 것(`isWithinOpenableRoots` 또는 화면에 있는
   * 버블 경로)을 그대로 쓴다 — 페어링된 모바일 기기도 이 라우트에 닿기 때문이다.
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
   * GET /api/media-tools — §5.13 (R-8) (e) 이 PC 에 **변환기(ffmpeg)** 가 있는가.
   *
   * "코덱이 깔렸는가"가 아니다 — Chromium 은 시스템 코덱을 쓰지 않으므로 코덱팩은 무효이고,
   * 우리가 찾는 것은 포장을 바꿔 줄 도구다. `?force=1` 이면 캐시를 무시하고 다시 훑는다(설치 직후).
   */
  app.get('/api/media-tools', (req, res) => {
    try {
      res.json(detectMediaTools(req.query['force'] === '1'));
    } catch (err) {
      logger.error('GET /api/media-tools failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/media-tools/install — 변환기를 설치한다(**사용자가 눌렀을 때만**).
   *
   * 우리가 바이너리를 나르지 않고 그 OS 의 표준 창구(winget·brew)에 맡긴다 — 라이선스·용량 때문이며
   * 그 판단은 §5.13 (R-8) (e) 에 적혀 있다. 끝나면 다시 훑은 결과를 함께 돌려준다.
   */
  app.post('/api/media-tools/install', (_req, res) => {
    void installMediaTools()
      .then((result) => res.json(result))
      .catch((err: unknown) => {
        logger.error('POST /api/media-tools/install failed', err);
        res.status(500).json({ ok: false, error: 'Internal server error' });
      });
  });

  /**
   * GET /api/media-convert/cached — 이 파일의 변환 결과가 **이미 있는가**.
   *
   * 화면이 팝업을 띄울지 그냥 열지 가르는 자리다. 변환을 시작하지 않는 순수 조회라,
   * 두 번째부터는 사용자가 아무것도 누르지 않아도 바로 열린다.
   * (라우트 순서 주의 — `/:jobId` 보다 **먼저** 서야 `cached` 가 작업 id 로 읽히지 않는다.)
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

  /**
   * POST /api/media-convert — 변환을 시작한다(또는 이미 있는 결과·작업을 돌려준다).
   *
   * 같은 파일을 두 번 갈지 않고, 캐시가 있으면 곧바로 `done` 으로 답한다 — 호출부는 셋을 구분할
   * 필요 없이 `status` 만 보면 된다.
   */
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
   * GET /api/run-configs — §5.5 #17-20 ② v4.74 디버그·실행 런처: 이 프로젝트의 실행 구성.
   *
   * `.vscode/launch.json`·`tasks.json`(JSONC)·`package.json` scripts·`.vibisual/run.json` 과
   * §5.14 탐지기 결과를 한 목록으로 낸다. 디스크가 SSOT 라 조회 전용 — broadcast·checkpoint 없음.
   * 경로 가드는 탐색기(`/api/workspace-dir`)와 같은 `isWithinOpenableRoots` 를 그대로 쓴다.
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
   * GET /api/mcp-servers — §5.5 #17-31: 이 프로젝트에서 쓸 수 있는 MCP 전부.
   *
   * 글로벌(`~/.claude.json` 최상위) · 로컬(그 프로젝트 엔트리) · 프로젝트(`.mcp.json`) · 프리셋을
   * 한 목록으로 낸다. **매 호출마다 디스크를 다시 읽는다** — 화면의 새로고침이 곧 이 호출이다
   * (앱 밖 터미널에서 `claude mcp add` 를 한 직후에도 누르면 바로 보이게).
   * 경로 가드는 탐색기·실행 런처와 같은 `isWithinOpenableRoots` 하나를 그대로 쓴다.
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
   *
   * 쓰는 곳은 `~/.claude.json` 의 그 프로젝트 엔트리 하나뿐이다(= `/mcp disable` 과 같은 자리).
   * 레포의 `.mcp.json`·`.claude/settings*.json` 은 읽기만 한다. 프리셋(`scope='preset'`)은 축이
   * 달라 여기서 받지 않는다 — 기존 `PUT /api/agent-config/:agentId` 가 그 통로다.
   * 응답은 갱신된 인벤토리라 화면이 따로 다시 묻지 않는다.
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
   * GET /api/hooks — §5.5 #17-32: 지금 이 프로젝트(=이 세션)에 적용되는 Claude Code 훅 전부.
   *
   * 글로벌(`~/.claude/settings.json`) · 프로젝트(`<루트>/.claude/settings.json`) · 로컬
   * (`settings.local.json`) · 관리자 정책을 한 목록으로 낸다. **매 호출마다 디스크를 다시 읽는다** —
   * 화면의 새로고침이 곧 이 호출이다(앱 밖에서 훅을 추가한 직후에도 눌러서 보이게, #17-32 ③).
   * 경로 가드는 탐색기·MCP 인벤토리와 같은 `isWithinOpenableRoots` 하나를 그대로 쓴다.
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
   *
   * Claude Code 에는 훅을 끄는 손잡이가 없으므로, 명령 객체를 **같은 블록 안**
   * `hooks` ↔ `_vibisualDisabled` 사이로 옮긴다(지우지 않는다 = 되돌리기가 항상 가능하다).
   * 관리자 정책(`managed`)과 Vibisual 자신의 블록은 여기서 받지 않는다.
   * 응답은 갱신된 인벤토리라 화면이 따로 다시 묻지 않는다.
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
   *
   * 진실은 CLI 자신의 답이다(`claude plugin list --json --available`) — 매 호출마다 다시 묻는다
   * (화면의 새로고침이 곧 이 호출). CLI 는 `cwd` 로 `project`/`local` 범위를 해석하므로 그 프로젝트에서 띄운다.
   * 경로 가드는 탐색기·MCP·훅과 같은 `isWithinOpenableRoots` 하나를 그대로 쓴다.
   */
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
        res.json(await scanClaudePlugins(resolvedRoot));
      } catch (err) {
        logger.error('GET /api/claude-plugins failed', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    })();
  });

  /**
   * POST /api/claude-plugins/action — §5.5 #17-33 ④⑤: 켜기·끄기·설치·제거·마켓 추가/제거.
   *
   * 다섯 동작이 **전부 CLI 위임**이라 창구를 하나로 둔다(우리가 git clone 과 설치 상태 파일 쓰기를
   * 흉내 내면 CLI 의 상태와 두 갈래로 갈린다). 응답에는 갱신된 인벤토리를 함께 실어 화면이 다시 묻지 않는다.
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
          default:
            res.status(400).json({ error: 'unknown action' });
            return;
        }

        if (!result.ok) {
          // 실패해도 목록은 함께 준다 — 실패 뒤 화면이 옛 상태로 남아 있으면 무엇이 됐는지 알 수 없다.
          res.status(400).json({ error: result.reason, inventory: await scanClaudePlugins(resolvedRoot) });
          return;
        }
        res.json({ ok: true, inventory: await scanClaudePlugins(resolvedRoot) });
      } catch (err) {
        logger.error('POST /api/claude-plugins/action failed', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    })();
  });

  /**
   * POST /api/unreal/attach — §5.5 #17-20 ③⑦: 실행 중인 언리얼 에디터에 디버거를 붙인다.
   *
   * `-WaitForDebugger` 로 띄운 에디터는 디버거가 붙을 때까지 멈춰 서 있다. 그 "붙이는" 한 동작을
   * 사용자가 Vibisual 안에서 하게 하는 자리 — 멈춰 세우는 일 자체는 재배포할 수 없는
   * 네이티브 디버거(⑦)의 몫이므로, 우리는 pid 를 찾아 JIT 디버거에 넘기기만 한다.
   * 조회·위임 전용이라 broadcast·checkpoint 미관여.
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

  // ─── §5.5 #17-20 ⑩⑫ v4.94 — 공통 디버그 층 ────────────────────────────────
  //
  // 연결은 서버가 소유한다(소켓·자식 프로세스는 브라우저가 못 연다). 여기 있는 것은 전부
  // **런타임 무관** 창구다 — 어느 언어든 같은 엔드포인트를 쓰고, 갈리는 것은 표(`DEBUG_ADAPTERS`)
  // 안에서다. 세션은 프로세스 수명이라 broadcast 는 `debug_event` 로만 하고 checkpoint 미관여.

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

  /**
   * GET /api/debug/free-port?base= — 실제로 비어 있는 디버그 포트.
   *
   * 종전에는 클라가 **자기 실행 세션 안에서만** 겹치는지 봐서, 밖에서 이미 그 포트를 쓰는
   * 프로세스와 부딪혔다(그러면 디버거가 엉뚱한 프로세스에 붙는다). 실제 리슨 여부는
   * 서버만 볼 수 있으므로 이 창구로 옮긴다.
   */
  app.get('/api/debug/free-port', (req, res) => {
    const base = Number(req.query['base']);
    void findFreePort(Number.isFinite(base) && base > 0 ? base : DEBUG_PORT_BASE)
      .then((port) => res.json({ port }))
      .catch(() => res.status(409).json({ error: 'no-free-port' }));
  });

  /**
   * POST /api/debug/attach — 이미 떠 있는 디버기에 붙는다.
   *
   * `attach:'pid'` 런타임인데 pid 를 모르면 실행 명령에서 뽑은 조각으로 한 번 찾아 본다
   * (PTY 로 띄우므로 우리 손의 pid 는 셸의 것이다). 그래도 못 찾으면 그 사실을 그대로 답한다.
   */
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

  /**
   * PUT /api/debug/breakpoints — 프로젝트의 중단점을 **저장**한다(세션 유무와 무관).
   *
   * 세션이 없어도 찍어 둘 수 있어야 하고(그래야 다음에 붙을 때 그대로 걸린다), 껐다 켜도
   * 남아야 한다 — 그래서 여기만 broadcast + saveCheckpoint 를 탄다.
   */
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
   * POST /api/debug/release — §5.5 #17-20 ⑫ **붙지 않고 그냥 진행**.
   *
   * `--inspect-brk` 로 멈춰 선 Node 프로세스를 죽였다 다시 켜지 않고 풀어 준다.
   * (다른 런타임의 `suspend=y`·`--wait-for-client` 는 디버거가 붙어야만 풀리므로, 그쪽은
   * [디버그 연결] 이 답이다 — 여기서 거짓으로 성공을 답하지 않는다.)
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
      res.json(loadAppState());
    } catch (err) {
      logger.error('GET /api/app-state failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── §3.2.3 보존 정책 ───
  //
  // Claude Code 가 `cleanupPeriodDays` 를 끌 수 없게 만들어 반발을 산 자리(#59248·#64999)를
  // 의도적으로 비껴간다 — 모든 축을 사용자가 조절하고, `0` 이면 그 축은 정리하지 않는다.

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
      const patch: Record<string, number> = {};
      for (const key of Object.keys(DEFAULT_RETENTION_SETTINGS)) {
        const v = body[key];
        if (typeof v === 'number' && Number.isFinite(v)) patch[key] = v;
      }
      const settings = appStateSetRetention(patch as Partial<typeof DEFAULT_RETENTION_SETTINGS>);
      // 상한이 내려갔으면 즉시 반영해야 "적용했는데 그대로다"로 보이지 않는다.
      for (const inst of graphManager.getInstancesForRetention()) inst.pruneFileEditRetention();
      // §5.22 감사 원장도 같은 자리에서 — 조용한 프로젝트는 다음 도구 호출까지 옛 크기 그대로다.
      graphManager.applyAuditRetention();
      broadcastSnapshot();
      res.json({ settings, limits: RETENTION_LIMITS, defaults: DEFAULT_RETENTION_SETTINGS });
    } catch (err) {
      logger.error('PUT /api/retention-settings failed', err);
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
   * GET /api/retention-trash — 휴지통 목록(= 복원 가능한 것 목록). §3.2.3 규칙 4 "조용히 지우지 않는다".
   *
   * 별도 기록 파일을 두지 않고 휴지통 폴더를 훑어 만든다 — 파일 자체가 사실이라 기록과 실제가 어긋날 수 없다.
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
      res.json(updated);
      broadcastSnapshot();
    } catch (err) {
      logger.error('PATCH /api/app-state failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** DELETE /api/projects/:name — 프로젝트 탭 닫기 (데이터 보존, 스냅샷에서만 숨김 + AppState에서 제거) */
  app.delete('/api/projects/:name', (req, res) => {
    try {
      // v1.63: 클라는 projectId(path)를 보냄. path 우선 해소, 이름 폴백.
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
      res.json({ ok: true });
      broadcastSnapshot();
      saveCheckpoint();
    } catch (err) {
      logger.error('DELETE /api/projects/:name failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /** POST /api/projects/open-folder — 모던 폴더 선택 다이얼로그 (IFileDialog COM) → 프로젝트 등록 */
  app.post('/api/projects/open-folder', (_req, res) => {
    /** 고른 경로를 프로젝트로 등록하고 응답까지 끝낸다 — 플랫폼별 선택기가 공유하는 꼬리. */
    const registerPicked = (selected: string): void => {
      try {
        const info = graphManager.registerProject(selected);
        // SSOT §5.4 #14 (v1.34): 사용자가 명시적으로 폴더를 선택해서 "열기" 한 경로 —
        // 과거에 닫아서 hidden 상태였다면 여기서만 복구한다.
        graphManager.showProject(info.name);
        broadcastSnapshot();
        saveCheckpoint();
        res.json({ ok: true, project: info });
      } catch (regErr) {
        logger.error('Project registration failed', regErr);
        res.status(500).json({ ok: false, error: String(regErr) });
      }
    };

    // ─── macOS / Linux ───
    // 아래 Windows 경로(IFileDialog COM)가 **유일한 구현이면** mac·Linux 에서는 `powershell` 이
    // 없어 ENOENT → 500 이 되고, 클라이언트(FileMenu)는 그 실패를 catch 로 삼켜 **File → 폴더
    // 열기가 눌러도 아무 일도 없는 버튼**이 된다 — 그 두 플랫폼에는 프로젝트를 추가할 수단이
    // UI 에 하나도 남지 않는다는 뜻이다. 새 의존성 없이 OS 가 이미 들고 있는 대화상자를 부른다:
    // macOS 는 내장 `osascript`, Linux 는 데스크톱 환경 표준인 `zenity` → `kdialog` 순.
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
    // [Console]::OutputEncoding 을 UTF-8 로 강제 — 기본 OEM 코드페이지(한국어 Windows=CP949 등)
    // 로 stdout 을 쓰면 한글/일어/중국어 경로가 Node 의 utf8 디코딩에서 깨져, 깨진 경로로
    // registerProject 가 호출되고 디스크 fs.existsSync 가 false → 부팅 시 ghost 로 제거되어
    // 다음 실행 때 탭이 사라진다. PowerShell 내부는 UTF-16 이므로 출력 단계만 UTF-8 로 맞춘다.
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

  /** POST /api/task-edges — Task Edge 생성. v1.18: 고급 옵션(kind/messageFormat/returnFormat/timeoutMs/retryCount/cacheEnabled/priority) 선택적 수용. */
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
    let edge;
    try {
      edge = graphManager.createTaskEdge(
        sourceAgentId, targetAgentId, command,
        forwardMode ?? 'manual', templateId ?? null,
        { kind, messageFormat, messageSchema, returnFormat, timeoutMs, retryCount, cacheEnabled, priority, delegationPolicy, critiqueTiming, critiqueAuthority, maxReworkCount, commandMode },
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

  /** PUT /api/task-edges/:id — Task Edge 업데이트. v1.18: 고급 옵션 전부 갱신 가능. */
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
    // v1.32 / v1.54 — auto-artifact / auto-rework 자매 엣지는 사용자 편집 금지 (primary 에서만 수정 가능).
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

  /** DELETE /api/task-edges/:id — Task Edge 삭제. v1.32 / v1.54: 자매(auto-artifact/auto-rework) 단독 삭제 금지 — primary 측에서만. */
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

  // ─── §5.3 #28 v1.47 — 콘티모드 (Conti) ───

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

    // §5.3 #28 (L) v1.58 — 사용자 명시 "새 콘티" 트리거. 항상 새 workId 발급
    // (기존 인플라이트 항목이 있어도 폐기 후 새로 — 사용자 의도가 '새'로 명시됨).
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
    // v1.62 — patchContiElement 는 더 이상 부모 세션에 붙지 않는다.
    //   harness 기반 일회용 sub-agent (tmpdir 격리 + Read/Edit only) 가 element.json 을 직접 Edit 한다.
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

  /** §5.3 #28 v1.59 — POST /api/conti/:contiId/frames/reorder — frame 드래그앤드롭 순서 변경 */
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
   * §5.13 (Q) POST /api/conti/from-script — 대본 텍스트에서 콘티 1건 생성.
   *
   * 기존 "새 콘티 생성"과 같은 저장소·같은 히스토리에 쌓인다. 다른 것은 입력뿐이라
   * (세션 회고 → 대본) 부모 세션 resume 없이 돌고, 그래서 세션이 없는 에이전트에서도 된다.
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

  /**
   * §5.13 (Q) POST /api/conti/:contiId/render-link — 콘티를 받아 간 앱의 산출물 기록.
   *
   * **어느 앱인지는 몸통이 알려 준다**(§5.13 (P-4)) — 코어는 `appId` 를 해석하지 않고
   * 그대로 적어 둘 뿐이라, 앱이 늘어도 이 라우트는 그대로다.
   */
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

  // ─── Comment Box (v1.45) — 언리얼 블프 스타일 주석 컨테이너 ───

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
  // ─── §5.13 v4.45 내부 앱 버블 (범용) ───
  //
  // 앱마다 라우트를 새로 만들지 않는다 — 앱이 늘어도 코어에 남는 자국은 이 네 개뿐이다.

  app.post('/api/app-bubbles', (req, res) => {
    const body = req.body as {
      projectName?: unknown;
      appId?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      title?: unknown;
      ref?: unknown;
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
      projectName: body.projectName,
      appId: body.appId,
      x: body.x,
      y: body.y,
      ...(typeof body.width === 'number' ? { width: body.width } : {}),
      ...(typeof body.height === 'number' ? { height: body.height } : {}),
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.ref === 'string' ? { ref: body.ref } : {}),
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

  // ─── §5.14 v4.62 — 플레이 버블 (이 프로젝트를 켜는 버튼) ───
  //
  // **경계**: 여기서 `start` 는 loopback 화이트리스트에 없다 — 즉 외부 프로세스(에이전트)는
  // 레시피를 **등록**만 할 수 있고(`/api/play-recipe`), 실제로 켜는 것은 렌더러(사용자의 클릭)뿐이다.
  // 시키지도 않은 서버가 켜지는 사고를 구조로 막는 자리다.

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
   * POST /api/play-bubbles/:id/ask-agent — 4단 계단 ④.
   *
   * 탐지가 빈손일 때만 쓰는 마지막 계단이다. **새 위임 레이어를 만들지 않는다** — 기존 명령 큐로
   * 프롬프트를 넣고, 답은 아래 `/api/play-recipe` 로 받는다(에이전트가 직접 서버를 띄우는 것 ❌).
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
   * POST /api/play-recipe — 에이전트가 알아낸 실행법을 등록한다(loopback + 토큰).
   *
   * `/api/agent-iframe` 과 **같은 인프라**를 쓴다(새 통신 레이어 ❌). 등록만 가능하고 기동은
   * 불가능하다 — start 는 화이트리스트 밖이라 렌더러(사용자)만 부를 수 있다.
   */
  // ─── §5.5 #17-35 — 검증(Verify) REST ───

  /**
   * GET /api/verification-recipe/:agentId — 지금 보내면 **무엇이 실릴지** 미리 알려 준다.
   *
   * 판정은 서버가 한다(§3.1) — 클라가 플레이 버블을 뒤져 스스로 답을 만들면 실제로 나가는 것과
   * 어긋난다. 사용자는 보내기 전에 이 한 줄을 먼저 읽는다(#17-35 ⑦).
   */
  app.get('/api/verification-recipe/:agentId', (req, res) => {
    const agentId = req.params.agentId;
    const projectName = graphManager.getAgentProjectName(agentId) ?? '';
    const recipe = resolveVerifyRecipe(agentId, projectName);
    res.json({ ok: true, source: recipe.source, ...(recipe.label ? { label: recipe.label } : {}) });
  });

  /** POST /api/verification-runs — 검증 시작(그 탭 큐에 `/verify` 한 건). */
  app.post('/api/verification-runs', (req, res) => {
    const body = (req.body ?? {}) as { agentId?: unknown; subAgentId?: unknown; focus?: unknown; demoId?: unknown };
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
    const result = startVerificationRun(agentId, subAgentId, focus, demoId);
    if (!result.ok) {
      res.status(409).json({ ok: false, error: result.error });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true, run: result.run });
  });

  /** POST /api/verification-runs/:id/stop — 도는 검증을 목록에서 닫는다(그 턴 자체 중지는 기존 [중지]). */
  app.post('/api/verification-runs/:id/stop', (req, res) => {
    const run = graphManager.findVerificationRun(req.params.id);
    if (!run) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    const finishedAt = Date.now();
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
        attempts: run.attempts,
      }),
      timestamp: Date.now(),
      subAgentId: run.subAgentId,
      status: 'queued',
    };
    queue.push(cmd);
    processNextCommand(sessionId);
    broadcastSnapshot();
    res.json({ ok: true, commandId: cmd.id });
  });

  /** DELETE /api/verification-runs/:id — 목록에서 한 줄 지운다(사람이 지운다, 서버가 스스로 ❌). */
  app.delete('/api/verification-runs/:id', (req, res) => {
    if (!graphManager.deleteVerificationRun(req.params.id)) {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    broadcastSnapshot();
    saveCheckpoint();
    res.json({ ok: true });
  });

  // ─── §5.5 #17-35 ⑨ — 시연(재현 절차) REST ───
  //
  // 만드는 순서는 **레코드 먼저, 그림 나중**이다: 그림은 몇 장이 될지 클라가 뽑아 봐야 알고,
  // 한 장씩 올라오는 동안 사용자는 진행을 봐야 한다. 중간에 끊기면 그림이 덜 붙은 시연이 남는데,
  // 그건 목록에 그대로 보이고 지울 수 있다 — 조용히 사라지는 것보다 낫다.

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
      out.push({ atMs, text });
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

  /** 프레임 업로드 — 한 번에 한 장(붙여넣기 첨부와 같은 규약). 저장은 시연 전용 폴더. */
  const demoFrameUpload = multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const rawId = req.params['demoId'];
        const demoId = typeof rawId === 'string' ? rawId : '';
        if (!demoId || demoId.includes('..') || demoId.includes('/') || demoId.includes('\\\\')) {
          return cb(new Error('invalid demoId'), '');
        }
        const demo = graphManager.findVerificationDemo(demoId);
        if (!demo) return cb(new Error('demo not found'), '');
        const dir = demoFramesDir(demo.agentId, demo.id);
        if (!dir) return cb(new Error('project not found'), '');
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (err) {
          return cb(err instanceof Error ? err : new Error('mkdir failed'), '');
        }
        cb(null, dir);
      },
      filename: (req, _file, cb) => {
        // 순번 = 지금까지 붙은 장수. 시간 순서가 곧 파일 이름 순서라 나중에 정렬이 필요 없다.
        const demoId = typeof req.params['demoId'] === 'string' ? req.params['demoId'] : '';
        const demo = graphManager.findVerificationDemo(demoId);
        cb(null, `${demo ? demo.frames.length : 0}.png`);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!file.mimetype.startsWith('image/')) { cb(new Error('only image/* mime types allowed')); return; }
      cb(null, true);
    },
  });

  /** POST /api/verification-demos/:demoId/frames — 프레임 한 장 추가(순서대로). */
  app.post('/api/verification-demos/:demoId/frames', (req, res) => {
    const demo = graphManager.findVerificationDemo(req.params.demoId);
    if (!demo) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    if (demo.frames.length >= VERIFICATION_DEMO_FRAMES_MAX) {
      res.status(409).json({ ok: false, error: 'frames-full' });
      return;
    }
    demoFrameUpload.single('image')(req, res, (err?: unknown) => {
      if (err) { res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) }); return; }
      if (!req.file) { res.status(400).json({ ok: false, error: 'no file uploaded (field name must be "image")' }); return; }
      const fields = (req.body ?? {}) as Record<string, unknown>;
      const atMs = typeof fields.atMs === 'string' && Number.isFinite(Number(fields.atMs))
        ? Math.max(0, Math.round(Number(fields.atMs)))
        : 0;
      // 파일이 저장되는 동안 다른 요청이 목록을 바꿨을 수 있다 — 붙일 때는 지금 값을 다시 읽는다.
      const fresh = graphManager.findVerificationDemo(demo.id);
      if (!fresh) { res.status(404).json({ ok: false, error: 'not found' }); return; }
      const next = graphManager.updateVerificationDemo(demo.id, {
        frames: [...fresh.frames, { rel: `${demo.id}/${path.basename(req.file.path)}`, atMs }],
      });
      broadcastSnapshot();
      saveCheckpoint();
      res.json({ ok: true, demo: next });
    });
  });

  /** PATCH /api/verification-demos/:demoId — 이름·단계·기대 결과 고치기(그림은 그대로). */
  app.patch('/api/verification-demos/:demoId', (req, res) => {
    const demo = graphManager.findVerificationDemo(req.params.demoId);
    if (!demo) { res.status(404).json({ ok: false, error: 'not found' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<VerificationDemo> = {};
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
   * GET /api/verification-demos/:demoId/frame?rel=<demoId/0.png> — 저장된 프레임 서빙.
   *
   * 녹화 직후에는 렌더러에 blob 이 있지만 앱을 다시 켜면 없다 — 그때 목록의 썸네일이 이 길로 온다.
   * 경로 검증: 그 시연의 폴더 안 파일만(트래버설 차단, 첨부 서빙과 같은 규약).
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
        ...(typeof body.label === 'string' && body.label.trim() ? { label: body.label.trim() } : {}),
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
   *
   * 항목 하나당 커스텀 에이전트 버블을 **기존 `createCustomAgent` 경로**로 한 장 만들고,
   * 만들어진 순서대로 **기존 Task Edge** 로 사슬처럼 잇는다(새 스폰 경로·새 엣지 타입 ❌).
   * 이미 카드가 붙은 항목은 건너뛴다 — `itemIds` 를 주면 그 항목만, 주지 않으면 카드 없는 전부.
   * `regenerate` 가 참이면 이미 카드가 있어도 **개정 번호만 지금 값으로 올린다**(카드 재생성 ❌ —
   * 사람이 만든 작업물을 스펙 한 장이 갈아엎지 않는다는 §5.15 규율).
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
        // 카드가 무엇을 만족시켜야 하는지는 rules 자동 섹션으로 얹는다(§7.9 v1.33 과 같은 문법).
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

        // 앞 고리가 있으면 사슬로 잇는다. `delegationPolicy='auto'` 고정 — 기본값 strict 는
        // §7.9 v1.36 에서 소스의 도구를 런타임에 박탈해 형제 카드끼리 서로를 무력화한다.
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
   * §5.18 — 변형 하나의 설정을 조립한다. **기준 config 전량을 스프레드**한 위에 변형 축만 덮는다.
   *
   * `AgentConfig` 는 부분 페이로드를 저장하면 나머지 필드(도구·스킬 등)가 통째로 날아가는 것이
   * 이미 실측된 함정이라, 랩의 두 쓰기 경로(실행 스폰 · 승격)는 **항상 이 함수 하나**를 지난다.
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
   * §5.18 — 그 턴이 끝났다. 이 에이전트가 랩 변형이면 결과를 적는다.
   *
   * 리뷰 레인과 **같은 자리**(`setOnComplete`)에서 부르고, 변경분도 **같은 함수**(`collectWorktreeChanges`)로
   * 읽는다 — 새 수집기를 만들지 않는다. 못 읽은 값은 그대로 비워 둔다(§5.18 "측정 없음과 0 을 구분한다").
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
   *
   * 새 스폰 경로 ❌ — ① 격리는 `createWorktreeUnder`(라우트와 **같은 함수**), ② 카드는
   * `createCustomAgent` + `setAgentConfig`, ③ 발사는 기존 명령 큐(`enqueueAgentCommand`).
   * 변형 하나가 실패해도 나머지는 계속 돈다(그 줄만 `failed` 로 남는다).
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
          enqueueAgentCommand(agent.id, task, 'lab');
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
   * POST /api/lab-runs/:id/variants/:vid/promote — 이긴 설정을 그 에이전트의 기본값으로.
   *
   * 대상은 body 의 `targetAgentId`, 없으면 랩의 기준 에이전트다. **현재 config 전량을 스프레드**한
   * 뒤 그 변형이 바꾼 축만 덮는다(자동 규칙 블록은 얹지 않는다 — 승격은 설정을 옮기는 것이지
   * 그 카드를 랩 변형으로 만드는 것이 아니다).
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

  /**
   * §5.20 — 선반 항목의 작업 디렉터리를 정한다.
   *
   * 항목이 `cwd` 를 들고 있어도 **그 프로젝트 밖이면 받지 않는다**(가져온 선반 파일이 남의 기계
   * 경로를 들고 오는 것을 막는 것과 같은 이유). 기존 `validatePathWithinRoot` 를 그대로 쓴다.
   */
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
   * §5.20 — 셸 항목 한 번 실행. **끝나는 일**이라 출력을 모아 결과로 돌려준다
   * (서버를 띄우는 detached 기동은 §5.14 플레이 버블의 몫 — 여기서 하지 않는다).
   *
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

  /**
   * §5.20 — 프롬프트 항목의 그 턴이 끝났다. 그 줄의 결과를 마감한다.
   *
   * §5.18 랩과 **같은 자리**(`setOnComplete`)에서 부른다 — 발사만 하고 성공으로 적으면 화면이
   * "끝났다"고 먼저 말해 버린다(사용자는 카드를 보고 끝난 줄 안다).
   */
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

  /**
   * POST /api/shelf-bubbles/:id/import — 가져온 JSON 한 장을 이 선반에 얹는다.
   *
   * 파일 내용을 **믿지 않는다** — shared 순수 함수 `normalizeShelfImport` 가 스키마 버전·아이콘·색·
   * 길이·개수를 전부 훑은 뒤에야 항목이 된다(클라이언트도 같은 함수로 미리 보여 준다).
   */
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

  /**
   * POST /api/shelf-bubbles/:id/items/:itemId/run — 그 줄을 누른다.
   *
   * 갈래는 둘뿐이고 **둘 다 이미 있는 경로**다(§5.20) — 셸은 여기서 돌려 출력을 결과로 적고,
   * 프롬프트는 기존 명령 큐로 보낸 뒤 그 턴이 끝날 때 `setOnComplete` 가 결과를 마감한다.
   */
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
   * §5.4 #29 v1.51 — Canvas 복사·붙여넣기.
   * 클라가 localStorage 에 저장한 CanvasClipboardPayload + 대상 projectName + anchor(캔버스 좌표)
   * 를 받아 커스텀 에이전트/Task Edge/Comment Box 묶음을 새 ID 로 한 번에 복원한다.
   *
   * 처리 순서:
   *   1) agents 루프 → createCustomAgent + setAgentConfig (oldId→newId 매핑)
   *   2) taskEdges 루프 → createTaskEdge (graphManager 가 returnFormat='both' 자매 엣지 자동 생성)
   *   3) commentBoxes 루프 → childOldIds 매핑 후 createCommentBox
   *   4) broadcastSnapshot + saveCheckpoint
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

  // v1.32 — Task Edge dispatch 대기 promise 레지스트리 (cmdId → resolve/timer)
  interface PendingDispatch {
    resolve: (v: { completed: true; status: 'completed' | 'error'; result?: string; errorMessage?: string }) => void;
    /** v1.84 — 무제한(유효 timeout ≤0) 엣지는 타이머를 설치하지 않으므로 optional. clearTimeout(undefined) 는 no-op. */
    timer?: NodeJS.Timeout;
    edgeId: string;
  }
  const pendingDispatches = new Map<string, PendingDispatch>();

  /** v1.32 — POST /api/task-edges/dispatch — 소스 세션이 직접 호출해 엣지 위임 실행.
   *  body: { edgeId, instruction }
   *  - 타겟 에이전트 세션 큐에 edgeId 포함 명령 푸시 → subagent 가 실제 Claude 프로세스로 실행
   *  - `returnFormat='both'` 번들에 artifact 자매 엣지가 있고 그 target이 실에이전트면 완료까지 응답 홀드
   *  - 그 외(artifact 미연결)에는 즉시 { dispatched: true } 반환 → 소스는 다른 일 진행 */
  app.post('/api/task-edges/dispatch', (req, res) => {
    // 두 경로 수용:
    //  (1) 신규(권장) — raw text 본문 + `?edgeId=` 쿼리. instruction 손escape 불필요(heredoc 그대로).
    //  (2) 후방호환 — JSON 본문 `{ edgeId, instruction }`.
    let edgeId: string | undefined;
    let instruction: string | undefined;
    const q = req.query as { edgeId?: unknown };
    if (typeof req.body === 'string') {
      // express.text() 가 파싱한 raw 본문. edgeId 는 쿼리(우선) 또는 헤더.
      const qid = typeof q.edgeId === 'string' ? q.edgeId : undefined;
      const hid = typeof req.headers['x-edge-id'] === 'string' ? (req.headers['x-edge-id'] as string) : undefined;
      edgeId = qid ?? hid;
      // 끝의 쉘/heredoc 잔여 개행·CR 만 정리(중간 본문은 보존).
      instruction = req.body.replace(/\r\n/g, '\n').replace(/\n+$/, '');
    } else {
      const body = (req.body ?? {}) as { edgeId?: unknown; instruction?: unknown };
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
    if ((edge.bundleRole ?? 'primary') !== 'primary') {
      res.status(400).json({ ok: false, error: 'dispatch only allowed on primary/command edge, not auto-artifact' });
      return;
    }

    const allAgents = graphManager.getSnapshot().agents;
    const targetAgent = allAgents.find((a) => a.id === edge.targetAgentId);
    if (!targetAgent) { res.status(404).json({ ok: false, error: 'target agent not found' }); return; }

    const sessionId = targetAgent.path;
    // v1.32 dispatch 수정 — /api/commands 핸들러와 동일하게 subAgent 를 새로 create 해서
    // cmd.subAgentId 에 실어 큐잉. 그래야 `processNextCommand → subAgentManager.execute` 가
    // 새 Claude 서브프로세스를 스폰하고 IDE 에 탭이 뜬다. null 로 두면 execute 가 조용히 return.
    const newSub = subAgentManager.create(targetAgent.id);
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now().toString(36)}-edge${Math.random().toString(36).slice(2, 5)}`,
      text: instruction,
      timestamp: Date.now(),
      subAgentId: newSub.id,
      status: 'queued',
      edgeId,
    };
    const queue = commandQueues.get(sessionId) ?? [];
    queue.push(cmd);
    commandQueues.set(sessionId, queue);

    graphManager.setTaskEdgeStatus(edgeId, 'executing');
    const artifact = graphManager.getBundleArtifact(edgeId);
    if (artifact) graphManager.setTaskEdgeStatus(artifact.id, 'executing');

    // §5.3 #28 (L) v1.58 — 타겟 에이전트가 conti-mode 면 task_edge 출처로 workId 발급.
    // 이미 인플라이트가 있으면 그대로 유지(같은 work 연속) — 사용자 명시 '새 콘티' 만 reset 한다.
    const targetCfg = graphManager.getAgentConfig(targetAgent.id);
    if (targetCfg?.customMode === 'conti') {
      graphManager.startContiWork(targetAgent.id, 'task_edge');
    }

    broadcastSnapshot();
    saveCheckpoint();

    processNextCommand(sessionId);

    // 대기 여부: artifact 엣지의 target 이 실제 살아있는 에이전트면 결과 돌려줄 채널이 있음 → 홀드.
    // 없거나(returnFormat != 'both') artifact.targetAgentId 가 미등록이면 즉시 반환.
    const artifactTargetLive = artifact
      ? Boolean(allAgents.find((a) => a.id === artifact.targetAgentId))
      : false;

    if (!artifactTargetLive) {
      res.json({ ok: true, dispatched: true, cmdId: cmd.id, waited: false });
      return;
    }

    // v1.84 — 엣지 timeoutMs 가 양수면 그 ms 로 제한, 미설정/0 이면
    // TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS(기본 0=무제한) 적용.
    // 유효 timeout 이 ≤0 이면 타이머를 아예 설치하지 않고 타겟 완료까지 무한 홀드
    // (§5.3 line 236/837 — 미설정=무제한, i18n placeholder "unlimited" 와 정합).
    const timeoutMs = edge.timeoutMs && edge.timeoutMs > 0
      ? edge.timeoutMs
      : TASK_EDGE_DISPATCH_DEFAULT_TIMEOUT_MS;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          const p = pendingDispatches.get(cmd.id);
          if (!p) return;
          pendingDispatches.delete(cmd.id);
          graphManager.setTaskEdgeStatus(edgeId, 'error', undefined, `dispatch timeout (${timeoutMs}ms)`);
          if (artifact) graphManager.setTaskEdgeStatus(artifact.id, 'error');
          broadcastSnapshot();
          saveCheckpoint();
          res.status(504).json({ ok: false, timeout: true, cmdId: cmd.id, timeoutMs });
        }, timeoutMs)
      : undefined;

    pendingDispatches.set(cmd.id, {
      edgeId,
      ...(timer !== undefined ? { timer } : {}),
      resolve: (payload) => {
        res.json({
          ok: payload.status === 'completed',
          dispatched: true,
          waited: true,
          cmdId: cmd.id,
          status: payload.status,
          ...(payload.result !== undefined ? { result: payload.result } : {}),
          ...(payload.errorMessage !== undefined ? { errorMessage: payload.errorMessage } : {}),
        });
      },
    });
  });

  const port = Number(process.env['PORT']) || DEFAULT_PORT;

  // §5.7 #23-2 v1.60 — Agent View 게이트 판정. 두 모드 공통(probe + 로그).
  // 부팅 직후 1회 reattach 는 `postListenBoot()` 안에서 호출.
  void isAgentViewEnabled(true).then((res) => {
    logger.info(`[agent-view] enabled=${res.enabled} reason="${res.reason}"`);
  }).catch((err) => {
    logger.warn(`[agent-view] gate probe failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  // v1.96 §5.8 — 폐기된 keyword 데이터 1회성 디스크 cleanup. 다음 차수에서 호출과 모듈 모두 제거.
  (await import('./services/keywordCleanup.js')).runKeywordCleanupOnce();

  // ─── 상태 저장 ───

  const saveScheduler = new SaveScheduler();

  // #4: 디바운스 도입했다가 비정상 종료 시 설정 유실 결함이 확인되어 **완전 원복**.
  // 체크포인트는 이벤트마다 동기 즉시 저장 — 설정 내구성 우선. 쓰기 증폭은 기능 결함이
  // 아닌 성능 리스크였을 뿐이라 정상 동작에 영향 없음(별도 분기·코얼레스 ❌, 단순=안전).
  /** 체크포인트 저장 (이벤트 발생 시 호출, 동기 즉시 저장). */
  /**
   * §3.2.3 — 디스크 파일 쪽 정리(부팅 1회 + 사용자가 [정리] 를 누를 때).
   *
   * 살아있는 서브에이전트의 스트림 파일은 **나이와 무관하게 보존**한다 — 그 목록을 여기서 모아 넘긴다.
   * 화면에 떠 있는 대화를 지우면 IDE 를 다시 열었을 때 빈 화면이 되기 때문(`deleteAgentStreams` 주석과 같은 이유).
   *
   * ⚠ **`getSnapshot()`(registry) 만으로는 부족하다.** 탭을 닫은 서브에이전트는 `archive` 로 옮겨져
   *   폴더 버튼의 "다시 열기" 목록 소스가 되는데, registry 에는 없으므로 보호에서 새어 나갔다.
   *   그 결과가 "목록에는 항목이 보이는데 누르면 빈 화면" 이다(실측 2026-08-19: 아카이브 102개 중
   *   실제로 돌았던 2개가 이미 기록 소실, 91개가 같은 시계 위). 두 벌을 합쳐 넘긴다.
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
   * @param opts.dirtyOnly **훅 이벤트 폭주 경로 전용** — 이번 창에서 실제로 바뀐 프로젝트만 저장한다.
   *
   * 종전에는 호출마다 열린 프로젝트 **전부**를 `toProjectCheckpoint()` 로 재구축 + 전체 직렬화했다
   * (실측 2026-08-19 · 열린 탭 7개: 직렬화만 21.8ms, 활성 1개면 3.8ms). 서버가 Electron 메인
   * 프로세스와 한 몸이라 그 시간이 곧 UI 정지다.
   *
   * ⚠ **기본값은 종전 그대로(전부 저장)** 이고, 좁히는 것은 `scheduleCheckpoint()`(훅 도구 이벤트
   *   코얼레스) 한 경로뿐이다. 이유: 판정 근거인 `mutationVersion` 은 **모든** 변경 지점이 올리지
   *   않는다(예: `createCustomAgent` 는 올리지 않는다). 훅 경로는 `processHookEvent` 가 반드시
   *   올리므로 그 경로에서만 신뢰할 수 있고, 사용자 조작·설정·정체성 변경(§3.2.1 #4 즉시 저장)은
   *   종전대로 전부 저장한다. 좁힌 경로에서도 조용한 프로젝트는 `CHECKPOINT_QUIET_SWEEP_MS`
   *   마다 한 번은 무조건 재구축한다(싱글턴발 변경의 안전망).
   */
  function saveCheckpoint(opts?: { dirtyOnly?: boolean }): void {
    const fallbackProject = graphManager.getPrimaryProjectName();
    if (!fallbackProject) return;

    // §3.2.1-4 (v3.03) — read-only 격리 프로젝트는 자동 저장 동결(빈/손상 인스턴스가 디스크 덮어쓰기 방지).
    // readOnly 는 stub 상태라 보통 getProjectNames(인스턴스 기반)에 안 잡히지만, 방어적으로 필터한다.
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

    // 탭으로 떠 있는 top-level 프로젝트는 openProjects 에 반드시 포함되도록 보정한다.
    // registerProject 펀넬(SessionStart/hook-event)을 놓친 경로(예: 세션 라우팅으로 이미 라우팅돼
    // registerProject 가 재호출되지 않는 경우)로 활성 탭이 openProjects 에서 누락돼 재시작 시
    // 탭이 사라지는 문제 방지. × 로 닫은 hidden 프로젝트는 getVisibleTopLevelProjects 가 이미 제외하므로
    // 닫은 탭을 되살리지 않는다. appStateAddOpenProject 는 이미 있으면 no-op(디스크 미기록).
    for (const info of graphManager.getVisibleTopLevelProjects()) {
      if (appStateAddOpenProject(info.path, info.name)) {
        logger.info(`AppState: openProjects += ${info.path} ("${info.name}") [reconcile]`);
      }
    }
  }

  // §9 v3.45 — hook-event 도구 이벤트 경로 전용 체크포인트 코얼레스(부하 적응형,
  // broadcastSnapshot 동형). saveCheckpoint() 는 체크포인트 build + 전체 stringify +
  // fsync 원자쓰기를 메인 스레드에서 동기 수행하므로, 도구 이벤트가 초당 수~수십 건
  // 도착하는 전수조사에선 이벤트당 저장이 스레드를 포화시켜 앱 전체가 동결됐다.
  // #4 원칙(이벤트 동기 즉시 저장)은 사용자 조작·설정·정체성 변경 등 나머지 모든 호출
  // 지점에서 그대로 — 여기서 묶는 것은 hook-event 도구 이벤트뿐이다. 비정상 종료로 잃을
  // 수 있는 건 최대 창 하나(≤5s) 분량의 휘발성 그래프 상태이고, 정상 종료는 desktop main 의
  // `before-quit` 가 `flushPendingCheckpointSave()` 를 **명시적으로 불러** 보장한다.
  //
  // ⚠ 종전에는 그 보장이 아래 `process 'exit'` 한 곳에만 있었다. 그런데 Electron 의 모든
  //   종료 경로는 `app.exit(0)` 으로 끝나고 그때 Node 의 `exit` 이벤트는 돌지 않을 수 있어,
  //   정상 종료·업데이트 설치마다 마지막 창(0.5~5초) 분량이 조용히 사라질 수 있었다.
  //   창 관리는 `checkpointCoalescer.ts` 가 단독 소유하고(테스트로 고정), 아래 'exit' 는
  //   최후 그물로 남는다 — 같은 `flushSync()` 를 지나므로 두 번 불려도 두 번 저장되지 않는다.
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

  // §9 v3.45 — PostToolUse Bash 전 노드 existsSync 스윕 최소 간격.
  const EXISTENCE_SWEEP_MIN_INTERVAL_MS = 2000;
  let lastExistenceSweepAt = 0;

  // 참조 주입 — restoreFromCheckpoint보다 먼저 실행해야 복원된 데이터가 올바른 Map에 들어감
  graphManager.setPoppedCommandsRef(poppedCommands);
  graphManager.setCommandQueuesRef(commandQueues);
  graphManager.setCompletedCommandArchiveRef(completedCommandArchive);

  // v1.52: 1회 마이그레이션 — 구 `<Vibisual>/save/` 단일 루트 → 각 프로젝트의 `.vibisual/save/` 분산 저장.
  // 순서 주의:
  //   (1) `loadAppState()` 를 먼저 호출 — 구 `<Vibisual>/save/_app-state.json` 이 살아있는 동안 `~/.vibisual/app-state.json` 으로 이전.
  //   (2) 그 다음 `migrateLegacySaveRootToProjectDirs()` — 체크포인트 디렉토리들을 각 프로젝트로 분산 후 SAVE_ROOT 를 `save.bak-v1.52` 로 백업.
  {
    loadAppState(); // (1) AppState 먼저 끌어올림 (구 _app-state.json 이 save/ 백업으로 묻히기 전에).
    const result = migrateLegacySaveRootToProjectDirs(); // (2) 체크포인트 분산 + SAVE_ROOT 백업.
    if (result.moved > 0 || result.skipped > 0 || result.bakPath) {
      logger.info(`v1.52 migration: moved=${result.moved}, skipped=${result.skipped}, bak=${result.bakPath ?? '<none>'}`);
    }
  }

  // Lazy boot: project.json 메타만 읽어 stub 등록. 체크포인트 본문은 hydrate 시점까지 로드하지 않는다.
  // openProjects 필터 — `~/.vibisual/app-state.json` 에 기록된 "사용자가 열어둔" 프로젝트만 stub으로 등록.
  // 사용자가 × 로 닫은 프로젝트는 체크포인트는 보존되되 탭으로 뜨지 않는다 (다시 파일 열기 또는 hook 이벤트로 복귀 가능).
  //
  // v1.63: 식별 = projectId(절대경로). loadAppState().normalize 가 구 name-array AppState 를
  // path-array 로 1회 마이그레이션(구 projectPaths name→path 사용)하므로, 부팅은 openProjects(=경로)
  // 를 그대로 스캔 목록으로 쓴다. discoverProjectMetas 는 각 path 의 `.vibisual/save/` 만 읽는다.
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
    for (const meta of filtered) {
      graphManager.registerStub(meta);
      const result = graphManager.hydrateProject(meta.project.path);
      if (result.ok) {
        hydratedCount += 1;
      } else if (result.reason === 'load-error') {
        // §3.2.1-4 (v3.03) — 로드 실패(디스크 손상/일시 실패)는 데이터가 살아있을 수 있다.
        // stub 을 제거하지 않고 read-only 격리하여 빈 인스턴스가 디스크를 덮어쓰지 못하게 하고,
        // openProjects 도 유지해 다음 부팅에 백업 복구를 재시도한다(과거엔 제거 → 빈 인스턴스 덮어쓰기 손실).
        logger.warn(`Boot hydrate failed for "${meta.project.name}" @ ${meta.project.path} (load-error) — isolating read-only (data-loss guard), keeping stub + openProjects`);
        graphManager.markStubReadOnly(meta.project.path, 'load-error');
      } else {
        logger.warn(`Boot hydrate failed for "${meta.project.name}" @ ${meta.project.path} (${result.reason}) — removing from openProjects`);
        graphManager.removeStubFromMap(meta.project.path);
        stalePaths.push(meta.project.path);
      }
    }
    // meta 가 없는데 openProjects 에만 남은 경로도 청소 (정규화 경로 매칭).
    // §3.2.1-4 손실방지 (v3.29): 메타(project.json)를 못 읽었어도 경로가 디스크에 실재하면
    // 크래시로 project.json 이 truncate/일시 손상됐을 수 있으므로 openProjects 에서 지우지 않고
    // 다음 부팅에 재시도한다. 경로 자체가 사라진 것만 영구 청소한다(과거엔 무조건 제거 →
    // 크래시 후 재시작 시 멀쩡한 프로젝트가 목록에서 영영 빠지던 손실 경로).
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
        // v3.63: 경로는 있는데 메타를 못 읽는 두 경우를 가른다.
        //  - save 디렉토리에 파일이 있다 → 크래시로 project.json 만 반파됐을 수 있다 → 재시도 보존.
        //  - save 디렉토리 자체가 없다 → 저장된 적 없는 경로(훅 세션 cwd 로 한 번 등록된 흔적 등).
        //    잃을 데이터가 없으므로 제거해도 §3.2.1 손실 방지에 저촉되지 않는다(하이드레이트는 영원히 실패).
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
    logger.info(`Boot: hydrated ${hydratedCount}/${validMetas.length} project(s) from openProjects (${stalePaths.length} stale entry(ies) cleaned, ${prunedNames} name-cache pruned, ${metas.length - validMetas.length} ghost(s) skipped).`);

    // §3.2.3 — 부팅 시 1회 보존 정리. Claude Code 의 "시작할 때 정리" 타이밍과 같되,
    // 무엇을 얼마나 지웠는지 로그로 남기고(조용히 지우지 않는다) 살아있는 것은 건드리지 않는다.
    // hydrate 직후에 도는 이유: 이 시점이라야 `getProjects()` 가 실제 프로젝트 목록을 준다.
    try {
      runProjectStorageCleanup();
      for (const inst of graphManager.getInstancesForRetention()) inst.pruneFileEditRetention();
    } catch (err) {
      // 정리 실패는 기동을 막지 않는다 — 용량이 조금 더 남을 뿐이다.
      logger.warn(`Boot storage cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // v1.2 (SCENARIO §5.7 #24): 기동 시 체크포인트만 유일한 버블 소스.
  // 이전엔 scanAllProjects로 ~/.claude/sessions/를 긁어 추가 시딩했으나, 체크포인트 외의
  // stale/타 프로젝트 세션이 섞여 들어가는 문제가 있어 비활성화. 새 세션은 SessionStart 훅이 담당.
  // graphManager.scanAllProjects();

  // [DISABLED] 활성 체크 전면 비활성화 — 동시 다발 spawn이 문제를 일으키는 것으로 보여 조사 중.
  // 재활성화 시 동시성 제한(예: 직렬 실행 or p-limit) 고려 필요.
  // const startupPrune = graphManager.pruneStaleRestoredAgents()
  //   .then((removed) => {
  //     if (removed.length > 0) {
  //       logger.info(`Startup prune removed ${removed.length} stale agents`);
  //       saveCheckpoint();
  //     }
  //   })
  //   .catch((err) => logger.error('Startup prune failed', err));
  // setInterval(() => {
  //   void graphManager.pruneStaleRestoredAgents().then((removed) => {
  //     broadcastSnapshot();
  //     if (removed.length > 0) saveCheckpoint();
  //   });
  // }, 10_000);
  const startupPrune = Promise.resolve();

  // 이미 실행 중인 background shell(dev 서버 등) JSONL 스캔으로 복원
  graphManager.rehydrateAllBackgroundShells();

  // isSessionInUse 결과 → WS broadcast (클라 debug 콘솔용)
  setLivenessProbeListener((result) => {
    const msg: WSMessage = { type: 'liveness_probe', timestamp: Date.now(), payload: result };
    broadcast(msg);
  });

  // subAgentManager 스트림 이벤트 → WS로 실시간 중계 (성능: 40ms 창 coalescing).
  // 과거엔 이벤트마다 즉시 broadcast → 멀티에이전트 스트림 폭주 시 초당 수백~수천 IPC/WS
  // 메시지가 나가 클라 큐가 밀림. 짧은 창에 모아 sub_agent_stream_batch 1건으로 묶어 보낸다
  // (도착 순서 보존). 200건 초과 시 창을 기다리지 않고 즉시 flush 해 지연 상한을 건다.
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
  subAgentManager.setOnStreamEvent((event) => {
    // §5.5 #17-17 ⑨ v4.59 — 목표 단계 동기화의 **두 번째 입구**. 훅(PreToolUse/TodoWrite)이 늦거나
    //   닿지 않아도(훅 미설치·스테일 포트·외부 세션) 세션이 세운 계획이 목표창에 그대로 반영된다.
    //   두 입구가 같은 syncSessionGoalFromPlan 으로 모이므로 어느 쪽이 먼저 와도 결과가 같고,
    //   바뀐 게 없으면 그래프가 undefined 를 돌려줘 broadcast 도 일어나지 않는다(중복 비용 0).
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

  // subAgent 영속화 경로 해석 — 부모 에이전트 소속 프로젝트를 찾아 save/<project>/(worktrees/<wt>/)sub-streams/<agentId>/ 로 라우팅
  /**
   * §5.19 (H) — All Model 세션의 **호스트 도구** 처리기.
   *
   * 클로드 세션은 이 세 가지를 CLI 내장 도구로 하고, 그 결과가 훅을 타고 우리에게 온다.
   * 로컬에는 CLI 도 훅도 없으므로 **우리가 도구를 주고 우리가 받는다** — 새 엔드포인트를 세우지
   * 않고 이미 REST 로 서 있는 것들(목표 · 질문 카드 · 권한 브로커)을 그대로 부른다.
   *
   * 실패는 던지지 않는다. 무엇이 안 됐는지를 **말로** 돌려주면 모델이 다른 수를 고른다.
   */
  /**
   * §5.19 (H) — All Model(로컬) 세션의 도구 호출을 **훅 경로에 이어 준다.**
   *
   * 그전까지 로컬 세션은 파일을 읽고 고치고 명령을 돌려도 캔버스에 **자국을 하나도 안 남겼다** —
   * 파일 노드도, 감사 원장도, Bash 이력도, 띄운 서버의 프리뷰 버블도 클로드 세션에만 있었다.
   * 같은 일을 하는데 한쪽만 안 보이는 것은 "에이전트가 생각하는 것을 보여 준다"는 이 앱의 약속을
   * 로컬에서만 깨는 일이다.
   *
   * **HTTP 라우트를 거치지 않는다.** 같은 프로세스 안이라 그래프를 직접 부르면 되고, 그 대신
   * 라우트가 하던 귀속(`_vibisualOwnerAgentId` → 소유 버블 세션)을 여기서 그대로 한다 — CMD
   * 터미널이 오늘 다니는 길과 같은 길이다.
   *
   * **도구 이벤트만 보낸다.** 생명주기(`markActive`/`markStop`)와 `Stop` 은 보내지 않는다 —
   * 로컬 턴은 자기 상태를 스스로 관리하므로 주인이 둘이 되면 서로를 덮어쓰고, `Stop` 은 두뇌
   * 리플렉션(`claude -p` 자식)을 깨워 **공짜로 쓰려던 세션이 클로드 토큰을 쓰게** 만든다.
   */
  subAgentManager.setLocalHookEmitter((ctx, event) => {
    // 버블이 캔버스에서 사라졌으면 붙일 곳이 없다(조용히 흘려보낸다 — 표시용 경로다).
    const session = graphManager.findSessionByAgentId(ctx.agentId);
    if (!session) return;
    // 변환은 `localHookPayload` 한 곳에만 있다 — 그 모양이 그래프가 기대하는 모양과 한 칸이라도
    //   어긋나면 **아무 오류 없이 조용히 아무 일도 안 일어나므로**(2026-08-24: 원장엔 남고 파일
    //   노드는 0개였다), 시험도 같은 함수를 쓰게 해 사본이 어긋날 자리를 없앤다.
    const payload: HookEventPayload = toLocalHookPayload(session, event);

    const result = graphManager.processHookEvent(payload);
    if (event.phase === 'post' && typeof payload.duration_ms === 'number') {
      graphManager.recordToolDuration(session, event.toolName, payload.duration_ms);
    }

    // Bash 뒤에는 파일이 사라졌을 수 있다(삭제·이름 변경). 라우트와 **같은 스로틀**을 나눠 써서
    //   두 경로가 함께 폭주해도 스윕이 겹치지 않게 한다.
    let changed = result !== null;
    if (
      event.phase === 'post' && event.toolName === 'Bash'
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

  // 커스텀 에이전트 상태 = 소속 서브에이전트 집계.
  // 서브 활동 시작/종료 시마다 부모 커스텀 버블의 active/completed 전이를 재계산.
  // 기존 에이전트 버블처럼 completed 후 dismiss/fade 흐름은 그대로 동작(동일 setAgentStatus 세팅).
  //
  // **부모 버블이 안 바뀌어도 세션 도트가 바뀌었으면 내보낸다.** 종전에는 broadcast 가
  // `recomputeCustomAgentStatus()` 의 반환값 하나에 걸려 있었는데, 그 함수는 버블이 **이미 active 면**
  // false 를 낸다(다른 탭이 돌거나 백그라운드 Task 가 살아 있는 동안 계속 그렇다). 그래서 그동안
  // sub 의 active↔idle 전이가 서버에만 반영되고 **클라로 나가지 않아** 탭 점이 낡은 색으로 굳었다
  // (클라는 스트림 이벤트로 status 를 자가보정하지 않는다 — §3.1 대로 스냅샷이 유일한 창구).
  //
  // `broadcastSnapshot` 은 이미 코얼레스(leading guard + trailing flush)라 호출이 늘어도 흡수되지만,
  // `saveCheckpoint` 는 동기 저장이라 **조건을 넓히지 않는다**(§5.5 v3.45 훅 경로 프리즈 재발 방지).
  // 도트 상태는 어차피 dispatch·finalize 경로가 저장하므로 여기서 또 저장할 이유가 없다.
  const lastSubStatusFingerprint = new Map<string, string>();
  subAgentManager.setOnSubStatusChange((parentAgentId) => {
    const bubbleChanged = graphManager.recomputeCustomAgentStatus(parentAgentId);
    const fingerprint = subAgentManager.getAllSubs(parentAgentId)
      .map((s) => `${s.id}:${s.status}`)
      .join('|');
    const subChanged = lastSubStatusFingerprint.get(parentAgentId) !== fingerprint;
    if (subChanged) lastSubStatusFingerprint.set(parentAgentId, fingerprint);
    if (bubbleChanged || subChanged) broadcastSnapshot();
    if (bubbleChanged) saveCheckpoint();
  });

  // v1.74 — agent-view 매핑(agentViewShort/SessionId) 을 spawn 직후 무조건 영속화.
  // onSubStatusChange 는 status 변화가 없으면 저장을 건너뛰므로 데몬 reattach 가능 윈도우에
  // 구멍이 생긴다. 이 훅은 조건 없이 즉시 saveCheckpoint() — 서버가 spawn 직후 크래시해도
  // 재시작 시 reattachAgentViewOnBoot 가 supervisor 의 살아있는 워커를 되찾는다.
  subAgentManager.setOnPersistNeeded(() => {
    saveCheckpoint();
  });

  // §5.3 #12-1 v1.96 — 권한 결정 직후 sub stream 에 합성 system 라인 한 줄.
  // 사용자가 팝업에서 뭘 눌렀는지 (또는 자동 결정 사유) 가 stream 패널 / 체크포인트에 남는다.
  // subAgentId 미상(레거시 hook env 결손) 인 경우엔 건너뜀 — broadcast permission_resolved 만 남는다.
  permissionBroker.onResolved = (request, decision) => {
    if (!request.subAgentId) return;
    const toolLabel = request.toolName || 'tool';
    let line: string;
    if (decision.decision === 'allow') {
      if (decision.reason === 'timeout') {
        line = `[permission] ALLOW (auto, timed out — no response in 60s) on ${toolLabel}`;
      } else if (decision.reason) {
        line = `[permission] ALLOW (auto: ${decision.reason}) on ${toolLabel}`;
      } else {
        line = `[permission] ALLOW — you pressed Allow on ${toolLabel}`;
      }
    } else {
      // deny
      if (decision.reason === 'timeout') {
        line = `[permission] DENY (auto, timed out — no response in 60s) on ${toolLabel}`;
      } else if (decision.reason) {
        line = `[permission] DENY — you pressed Deny on ${toolLabel} (note: ${decision.reason})`;
      } else {
        line = `[permission] DENY — you pressed Deny on ${toolLabel}`;
      }
    }
    subAgentManager.emitSystemMessage(request.agentId, request.subAgentId, line);
  };

  // ─── v1.55 critique 런타임 강제 ──────────────────────────────────────────────
  //
  // SCENARIO §5.3 line 218/224 의 후속 라운드. 기존 v1.42(저장/UI) + v1.54(자매 엣지 동기화) 위에
  // 실제 reject 이벤트 → rework 트리거를 얹는다.
  //
  // 흐름:
  //   1) 타겟(작업자) 세션 완료 → `getIncomingCritiqueEdges(targetAgentId)` 로 critique primary 엣지 조회
  //   2) 각 watcher(=sourceAgent) 에게 `dispatchCritiqueWatcher` 로 비평 지시 송신 (cmd.edgeId=critique.id)
  //   3) watcher 응답 완료 → cmd.edgeId 가 critique 엣지면 `handleCritiqueCompletion` 로 verdict 파싱
  //   4) verdict='reject' + critiqueAuthority='force-rework':
  //        - reworkCount + 1 이 maxReworkCount 이하면 auto-rework 자매 엣지로 작업자에게 재작업 dispatch
  //        - 초과 시 critiqueAuthority='comment-only' 강등 + 자매 엣지 동기 제거 + 에스컬레이션 알림
  //   5) 작업자가 rework 완료 → 다시 critique 엣지 발사 (사이클 연속, count 누적)
  //
  // v1.55 라운드 한계:
  //   - `critiqueTiming='intermediate'` 도 사실상 'final' 과 동일하게 "Stop 훅 = 1회 완료" 시점에 발사.
  //     진정한 중간 milestone 발사(PostToolUse 스트림 후킹)는 후속 라운드.

  type CritiqueVerdict = VerificationVerdict;

  /**
   * §5.3 #10-3 v4.98 — Watcher 응답에서 **구조화 판정 + 검증 증거** 추출.
   *
   * 종전 구현은 자유 텍스트를 정규식으로 긁어 판정했고, 해석에 실패하면 `unknown` 을 돌려준 뒤
   * 호출부가 `verdict !== 'reject'` 로 흘려보내 **판정 불명이 승인과 같은 길**을 탔다(fail-open).
   * 이제 셋이 달라진다:
   *   1) `attempts`(실행 명령 + exit code)까지 함께 뽑는다 — 이것만이 증거다.
   *   2) 증거 없는 `approve` 는 승인이 아니라 **`held`(보류)** 다. "봤더니 괜찮다"는 증거가 아니다.
   *   3) 키워드 폴백은 하위호환으로 남기되, 폴백 approve 도 증거가 없으므로 `held` 로 떨어진다.
   *      (`reject` 는 폴백으로도 그대로 인정한다 — 막는 쪽으로 틀리는 것은 안전하다.)
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
  ): void {
    if (edge.status === 'executing') {
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

    if (isFreshCycle) graphManager.bumpCritiqueReworkCount(edge.id, 'reset');
    const currentRework = edge.reworkCount ?? 0;
    const maxRework = Math.min(edge.maxReworkCount ?? 3, TASK_EDGE_CRITIQUE_MAX_REWORK_LIMIT);
    const cyclePhase = currentRework === 0
      ? '(initial review)'
      : `(rework cycle ${currentRework}/${maxRework})`;

    const contextBlock = contextResult && contextResult.trim().length > 0
      ? `\n\n=== Target [${targetLabel}] just completed work ===\n${contextResult.trim()}\n`
      : `\n\n=== Target [${targetLabel}] just completed work (no result snippet captured) ===\n`;

    // §5.3 #10-3 v4.98 — 구조화 판정 요구. 종전 문구는 마지막 줄이 "판정이 애매하면 APPROVE 를
    //   쓰라"고 지시하고 있었다 — fail-open 이 프롬프트에까지 박혀 있던 셈이다.
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
   * §5.3 #10-3 v4.98 — 이 에이전트(세션)를 품고 있는 auto-agent 의 **활성 검증 런**을 찾는다.
   * auto-agent 가 스폰한 워커들의 sessionId 는 `AutoAgentSummary.spawnedAgentIds` 에 있다.
   * 어느 런에도 속하지 않는 수동 엣지면 null — 그 경우 종전 동작(엣지별 카운트)을 그대로 쓴다.
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

  /**
   * §5.3 #10-3 v4.98 — 런이 사람을 부른다.
   * 종전에는 재작업 상한 초과 시 감시 권한을 조용히 낮추고 로그 한 줄만 남겼다(= 포기한 줄도 모름).
   * 이제 기존 질문 카드 경로를 그대로 써서 화면에 띄운다(새 카드 계열 ❌).
   */
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
  function handleCritiqueCompletion(edge: TaskEdge, watcherResult: string | undefined): void {
    if (edge.kind !== 'critique' || (edge.bundleRole ?? 'primary') !== 'primary') return;
    const { verdict, reason, attempts } = parseCritiqueVerdict(watcherResult ?? '');
    const authority = edge.critiqueAuthority ?? 'force-rework';
    logger.info(`[critique] verdict=${verdict} authority=${authority} edge=${edge.id} evidence=${attempts.length}`);

    // §5.3 #10-3 v4.98 — 이 판정이 어느 검증 런에 속하는지 찾아 **증거를 서버에 적재**한다.
    //   대상(작업자) 세션 기준으로 찾는다 — 검수자가 아니라 검수받는 쪽이 런의 주인이다.
    const targetAgent = graphManager.getSnapshot().agents.find((a) => a.id === edge.targetAgentId);
    const runRef = findActiveRunForAgentSession(targetAgent?.path);
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
        // 판정 불명 — 종전에는 여기서 조용히 통과했다. 이제 런을 열어 둔 채 화면에 보류로 남긴다.
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
    const nextCount = (edge.reworkCount ?? 0) + 1;

    // §5.3 #10-3 v4.98 — 예산은 **런 단위**로 센다. 종전에는 엣지마다 따로 세어
    //   reviewer·tester 가 각각 3번씩 = 실제 6번이 됐다.
    if (runRef) {
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
    graphManager.bumpCritiqueReworkCount(edge.id, 'increment');

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
    const cmd: QueuedCommand = {
      id: `cmd-${Date.now().toString(36)}-rework${Math.random().toString(36).slice(2, 5)}`,
      text: instruction,
      timestamp: Date.now(),
      subAgentId: newSub.id,
      status: 'queued',
      edgeId: reworkEdge.id,
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
    // 완료/에러 명령을 큐에서 archive로 이동
    for (const [sessionId, queue] of commandQueues) {
      const done = queue.filter((c) => c.status === 'completed' || c.status === 'error');
      if (done.length === 0) continue;

      // v1.32 — Task Edge dispatch 매칭: edgeId 실린 명령이면 엣지 상태 갱신 + 대기 중 dispatch promise resolve
      // v1.55 — critique 엣지(watcher 응답) / auto-rework 엣지(작업자 rework) 분류해 별도 처리 hook 마련.
      // v1.56b — 사용자 강제 중단(`[Stopped by user]`)은 critique 트리거 대상에서 제외 — 중단된 결과를 watcher 가 review 할 가치 없음.
      const completedCritiqueEdges: { edge: TaskEdge; result: string | undefined }[] = [];
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
        const pending = pendingDispatches.get(cmd.id);
        if (pending) {
          clearTimeout(pending.timer);
          pendingDispatches.delete(cmd.id);
          pending.resolve({
            completed: true,
            status: edgeStatus,
            ...(cmd.result !== undefined ? { result: cmd.result } : {}),
            ...(errMsg !== undefined ? { errorMessage: errMsg } : {}),
          });
        }
        // v1.55 분류 (v1.56b — 사용자 강제 중단은 critique 사이클에서 전부 배제)
        const cmdEdge = graphManager.getTaskEdge(cmd.edgeId);
        if (cmdEdge?.kind === 'critique' && (cmdEdge.bundleRole ?? 'primary') === 'primary') {
          // watcher 의 critique 응답 — verdict 처리 대상. 작업자 watcher 발사 후보 ❌.
          // 사용자가 watcher 를 중단한 경우 verdict 파싱도 skip (rework 발사 안 함, 사이클 종료).
          if (edgeStatus === 'completed' && !userStopped) {
            completedCritiqueEdges.push({ edge: cmdEdge, result: cmd.result });
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

      // §5.3 #28 (K) v1.48 + (L) v1.58 — 콘티모드 에이전트의 응답을 conti 레코드로 자동 추출.
      // sessionId → owning agentId → customMode==='conti' 이면 cmd.result 에서 JSON 파싱.
      // 작업 ID(workId) 트래커로 신규/수정 분기:
      //   - 트래커 + contiId 있음 → 기존 Conti.frames 통째 교체 + conti_updated 브로드캐스트
      //   - 트래커 + contiId 없음 → 새 Conti 생성 + 트래커에 contiId 머지 + conti_generated
      //   - 트래커 없음 (외부 트리거 없는 agent_session 첫 응답) → workId 자체 발급 + 새 Conti
      // 부트스트랩(title='(empty)') 1건은 첫 진짜 응답이 들어올 때 폐기.
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

      // v2.61 — attachments 보존: 종전(v1.35/v1.38)엔 완료 시 paste 이미지 파일을 unlink + cmd.attachments
      //   필드 클리어해 "전송 직후 사라져 무엇을 보냈는지 확인 불가"(사용자 보고)였다. 이제 파일·필드를
      //   모두 보존하여 archive(완료 명령)에 attachments 경로가 남고, 클라(StreamRenderer CommandBlock)가
      //   대화 스트림에 썸네일을 인라인 표시 + 클릭 시 라이트박스 확대한다.
      //   누적 파일 정리(세션 종료/주기) 정책은 후속 과제.

      // §5.3 #10-2 v2.45 — auto-agent 빌더 완료 감지. 빌더는 auto-agent 버블 자기 세션의 sub 로
      //   돌므로, 그 명령이 끝나면(= done 에 등장) phase 를 building → completed 로 전이하고 마지막
      //   응답을 요약으로 합성한다. 이 전이를 빠뜨리면 빌더가 끝나도 진행 표시가 영원히 'building'
      //   으로 남아 패널 스피너가 계속 돈다(사용자 보고: "명령 후 아무 동작 없이 빙글빙글만").
      const autoSummary = graphManager.getAutoAgentSummary(sessionId);
      if (autoSummary && autoSummary.phase === 'building') {
        let finalText: string | undefined;
        for (let i = done.length - 1; i >= 0; i--) {
          const r = done[i]!.result;
          if (typeof r === 'string' && r.trim()) { finalText = r; break; }
        }
        autoAgentRuntime.handleCompletion(sessionId, finalText);
      }

      // §5.5 #17-11 v3.79 — 루프 회차 전진. 아카이브로 옮기기 전에 `pendingCommandId` 대조로
      //   "이번 회차가 끝났다"를 확정하고 다음 회차를 예약한다(중지·오류·목표 도달이면 정지).
      for (const cmd of done) advanceSessionLoop(cmd);
      // §5.5 #17-35 — 검증 닫기. 루프와 같은 자리에서 `pendingCommandId` 대조로 판정을 읽는다.
      for (const cmd of done) advanceVerificationRun(cmd);
      // §4 (CLI 사양 추종) — 턴 경계 압축. 루프 전진 **뒤**에 본다 — 루프가 이 회차로 `contextMode`
      //   정리를 걸었으면 그쪽이 이미 큐에 있어 직렬 가드에 막히므로 두 벌로 쏘지 않는다.
      for (const cmd of done) maybeCompactAfterTurn(cmd, sessionId);

      archiveCompletedCommands(sessionId, done);
      const remaining = queue.filter((c) => c.status === 'queued' || c.status === 'executing');
      commandQueues.set(sessionId, remaining);

      // §5.5 #17-11 v3.92 — 큐/루프가 이 회차로 비었는지 반영해 부모 버블의 완료 판정을 여기서 한 번 더 낸다.
      //   sub 가 idle 로 떨어진 시점(onSubStatusChange)엔 아직 이 회차의 루프가 살아 있어
      //   hasPendingAgentWork 가 강등을 보류했으므로, 루프가 꺼진 뒤인 지금 다시 불러야
      //   "마지막 회차 종료 = 완료" 가 아래 broadcastSnapshot 과 **같은 스냅샷**에 실린다
      //   (늦게 실리면 클라가 루프 종료음과 버블 완료음을 두 번 울린다).
      if (ownerAgentId) graphManager.recomputeCustomAgentStatus(ownerAgentId);
      // §5.16 — 리뷰·승인 레인: 격리(워크트리)에서 일한 커스텀 에이전트가 그 턴을 끝냈으면
      //   변경분을 붙잡아 리뷰 카드를 만든다. 판정 넷은 `maybeCreateReviewRequest` 안에 있고,
      //   여기서는 **사용자 명령 완료(비-critique)** 인 회차만 후보로 넘긴다 — watcher 응답이나
      //   중단된 턴으로는 리뷰를 만들지 않는다(sawNonCritiqueResponse 가 그 판정을 이미 들고 있다).
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

      // v1.55 — critique 런타임:
      //   (1) watcher critique 응답 완료들 처리(reject 판정 시 자매 auto-rework 발사 / 강등)
      //   (2) 작업자 본 완료(=critique 응답 외)가 있으면 incoming critique watcher 발사
      for (const { edge, result } of completedCritiqueEdges) {
        try {
          handleCritiqueCompletion(edge, result);
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
          for (const edge of incoming) {
            try {
              dispatchCritiqueWatcher(edge, lastNonCritiqueResult, !sawReworkCompletion);
            } catch (err) {
              logger.error(`[critique] dispatchCritiqueWatcher failed edge=${edge.id}`, err);
            }
          }
        }
      }
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

    // 재기동 정합성 보정: 체크포인트 복원으로 subs 는 idle 이지만 커스텀 부모 버블이
    // 이전 세션 상태(active) 로 남아있을 수 있으니 여기서 한 번 sweep.
    if (graphManager.recomputeAllCustomAgentStatuses()) {
      broadcastSnapshot();
      saveCheckpoint();
    }

    // §5.7 #23-2 v1.60 — Agent View reattach. 영속화된 agentViewShort 들 중 supervisor 에 살아있는
    // worker 의 JSONL watcher 를 재부착 → 서버가 죽어있던 동안 진행된 turn 도 새 라인부터 따라잡음.
    // 죽은 worker 는 state.json 최종 상태로 마무리. projectResolver 가 set 된 후 호출 보장.
    void subAgentManager.reattachAgentViewOnBoot((subId) => {
      // §5.7 #23-2 v1.60 — agent-view terminal 시점에 cmd 도 함께 봉합하기 위한 lookup.
      // 같은 sub 의 executing 명령이 commandQueues 어딘가에 있다고 가정(보통 그 sub 의 sessionId 큐).
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

      // SCENARIO §5.7 #24: ~/.claude/sessions/<PID>.json 을 10초마다 스캔하여
      // entrypoint=vscode + cwd 일치 + JSONL 활성 조건을 만족하는 신규 세션을 시딩.
      // SessionStart 훅이 놓친 케이스(창 재오픈, 훅 미설치 등)의 폴백.
      const seeded = graphManager.scanAllProjects();
      if (seeded) needsBroadcast = true;

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

      // §7.11 — background shell(dev 서버) 발견 sweep(안전망). attachBackgroundShell 의
      // PostToolUse 트리거가 어긋나거나(이벤트 미도달·tool_response 형식 변화) 세션 등록
      // **이후** 떠서 startup rehydrate 가 놓친 dev 서버를, 등록된 모든 세션의 JSONL 을
      // 다시 훑어 잡는다. rehydrate·watcher.start·createIframeSatellite 전부 멱등이라
      // 매 주기 재호출해도 중복 위성/중복 watcher 가 생기지 않는다. 포트 탐지 시 broadcast 는
      // watcher 콜백의 onSnapshotChange 가 담당하므로 여기선 needsBroadcast 를 세우지 않는다.
      graphManager.rehydrateAllBackgroundShells();

      // SubAgent: 대기열에 queued 명령 있으면 실행 — 큐 등록된 모든 세션(커스텀 포함) 대상
      for (const sessionId of commandQueues.keys()) {
        processNextCommand(sessionId);
      }

      // §5.5 #17-11 v3.79 — 세션 루프 안전망. 정확한 예약은 setTimeout 이 하고, 여기서는
      //   재시작으로 타이머가 사라졌거나 예약이 유실된 루프만 주워 다음 회차를 굴린다.
      if (sweepSessionLoops() > 0) {
        broadcastSnapshot();
        saveCheckpoint();
      }
    }, SESSION_SCAN_INTERVAL);

    // §5.21 — 비용·토큰 지도 스윕. 훅마다 재파싱하지 않고 이 주기에만 훑으며,
    //   활성 세션만 넘긴 뒤 JSONL 스캐너가 mtime·size 로 한 번 더 걸러 변화 없으면 파일을 열지 않는다.
    setInterval(() => {
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
      // v1.60: completed → idle 자동 페이드 (AGENT_FADE_DURATION=60s 경과 분).
      // 사용자 클릭 dismiss 없어도 시안 글로우가 자연 소멸 → 다음 작업이 깨끗한 상태에서 시작.
      const expiredCompleted = graphManager.expireCompletedAgents();
      // §5.10 — 카드 연결 파일 소실 → ghost(재검토) 신선도 sweep(주기, per-event ❌). 변화 시 요약 갱신.
      let brainChanged = false;
      try { brainChanged = sweepAllBrainStaleCards(); } catch { /* best effort */ }
      if (brainChanged) graphManager.notifyBrainChangedAll();
      if (expiredParents.length > 0 || expiredSubs.length > 0 || expiredCompleted.length > 0 || brainChanged) {
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
    //   10분마다 **한 건**만 물어본다. 이 축이 메우는 자리는 위 다섯 장치가 손댈 수 없는 곳이다 —
    //   `hasLivingWork` 이 참이라 아무도 못 걷는데 실제로는 끝났거나 멈춘 세션. 그 판정은 마지막
    //   기록의 *뜻*을 읽어야 나오므로 코드가 아니라 모델이 답한다(§2.4 · `sessionLivenessProbe.ts`).
    //   비동기라 여기서 기다리지 않는다 — 착수만 하고 즉시 넘어간다.
    setInterval(() => {
      subAgentManager.maybeProbeRunningSessions(commandQueues);
    }, SESSION_PROBE_INTERVAL_MS);

    // §5.3 — 사용자 인터럽트(Esc/Ctrl+C)·도구 거부 시 Claude Code 는 Stop 훅을 발사하지 않아
    // Hook 에이전트 버블이 active(파란 링)로 stuck 된다. 세션 JSONL 마지막 엔트리가 인터럽트
    // sentinel 이면 누락된 Stop 훅을 대신 시뮬레이트(markStop → completed → 60초 fade → idle).
    // markStop 이 내부에서 스냅샷을 broadcast 하므로 별도 broadcast 불필요.
    setInterval(() => {
      // 헤드리스 세션의 실행 표시를 **실제 프로세스 생존**과 대조한다. 어떤 경로가 `active` 를 남긴 채
      //   자식을 잃으면, 종전에는 5분 무활동 sweep 이 걷을 때까지 화면이 "돌고 있다"고 거짓말했고
      //   그동안 [중지]는 멈출 게 없는 헛버튼이었다. 여기서 5초 안에 사실로 되돌린다.
      // 프로세스가 사라진 세션에 남은 백그라운드 작업 표시(끝 통지가 영영 오지 않는 것)를 **먼저** 걷는다 —
      //   그게 남아 있는 동안은 아래 생존 대조가 그 세션을 "아직 도는 중"으로 보고 건너뛰므로,
      //   순서가 뒤집히면 유령이 세션·버블을 계속 활동 중으로 붙든다.
      const orphanParents = subAgentManager.sweepOrphanedBackgroundTasks();
      const deadActive = subAgentManager.reconcileDeadActiveSubs();
      // §5.5 #17-9 ⑭ — 위 둘이 못 걷은 것(표식도 없고 세션은 살아 있는 것) 중 **가장 오래 조용한
      //   하나**를 골라 물어본다. 비동기라 여기서 기다리지 않는다 — 착수만 하고 즉시 넘어간다.
      subAgentManager.maybeProbeQuietBackgroundTasks();
      // 턴은 끝났는데 `executing` 으로 굳은 명령을 걷는다. 굳어 있는 동안 그 탭은 `busy` 로 잠겨
      //   **새 명령을 영영 못 받으므로**(앞 명령이 안 끝났으니 다음이 안 나간다), 종전에는 사용자가
      //   앱을 재기동하거나 [중지]를 눌러야만 풀렸다. 아래 잠듦 판정이 `executing` 을 "곧 쓸 자식"
      //   으로 읽으므로 **그보다 먼저** 걷어야 재우기까지 함께 막히지 않는다.
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
        archiveCompletedCommands(sessionId, sealed);
      }
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

    // §5.14 v4.62 — 플레이 버블 생사 확인. running 인데 포트가 죽었으면 idle 로 되돌린다.
    //   **버블 자체는 지우지 않는다** — 버튼은 사용자가 지울 때까지 그 자리에 남는 것이 이 기능의 약속이다
    //   (§7.11 iframe 위성의 60초 grace 자동 제거와 다른 점).
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

    // §4 v1.98 — 진단 에러 로그 변경 시 스냅샷 broadcast (영속화 ❌ — saveCheckpoint 안 함)
    diagnosticService.setOnChange(() => {
      broadcastSnapshot();
    });

  }

  return { app };
}
