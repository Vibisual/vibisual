import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { linkedImageEvents } from './streamLinkedImages.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ProjectInfo, SubAgent, SubAgentStatus, QueuedCommand, CommandError, AgentConfig, AgentEngineKind, SubAgentStreamEvent, StreamEventType, AgentViewJobState, RunningSubagentTask, FinishedSubagentTask, StreamTaskInfo, StreamTaskStatus, CmdTerminalSignal, CmdTerminalState, CmdPaneNode, CmdCliKind, SessionMemo } from '@vibisual/shared';
// §5.3 #12-4 — CMD 규칙 파일에 싣는 검증 정책 문단(헤드리스는 index.ts 가 시스템 프롬프트로 싣는다).
//   (J) 실행 전 차단 스위치(옵션창 권한 탭, 기본 끔)에 따라 문단 머리말·스폰 표식이 갈린다.
import { buildVerificationPolicyRules, isVerificationGateEnabled, VERIFICATION_GATE_ENV } from '@vibisual/shared';
import { appStateGetTokenSaver } from './appState.js';
import { userDefaultsService } from './userDefaultsService.js';
import { CMD_PANE_SEPARATOR, CMD_BLOCK_REASON_MAX, collectCmdPaneIds, resolveCmdCliKind, DEFAULT_AGENT_CONFIG, isOpusModel, supportsFastMode, isForwardSubagentTextEnabled, resolveAliasToLatest, buildCmdCardProtocolRules, isNeverRenderedStreamEvent, formatSystemChip, normalizeBashTimeoutMs, TASK_CHIP_START_SUBTYPE, TASK_CHIP_END_SUBTYPE, parseSystemSubtype, parseSystemTaskInfo, capMapSize, capSetSize, SESSION_KEYED_MAP_MAX, resolveLocalToolGate, shouldAskForTool, isToolDisallowed, readTurnStopSignal, resolveTurnStopReason, normalizeModelStopReason, type TurnStopSignal, type ModelStopReason, readCompactionSignal, toCliPermissionMode, buildAgentsFlagJson, normalizePluginDirs, isHookStreamSubtype, HOOK_STREAM_SUBTYPES, BG_TASK_PROBE_CONCURRENCY, BG_TASK_PROBE_MAX_PER_HOUR, BG_TASK_PROBE_BACKOFF_FACTOR, BG_TASK_PROBE_BACKOFF_MAX, DEFAULT_BG_TASK_PROBE_SETTINGS, type BackgroundTaskProbeResult, type BackgroundTaskProbeSettings, SESSION_PROBE_CONCURRENCY, SESSION_PROBE_MAX_PER_HOUR, SESSION_PROBE_BACKOFF_FACTOR, SESSION_PROBE_BACKOFF_MAX, DEFAULT_SESSION_PROBE_SETTINGS, type SessionLivenessProbeResult, type SessionLivenessProbeSettings, detectUsageLimitStop, detectUsageLimitInText, engineForProvider, USAGE_LIMIT_PROMOTABLE_ERROR_CODES, buildTokenSaverEnv, STREAM_HISTORY_PAGE_EVENTS, STREAM_HISTORY_PAGE_MAX, TURN_STREAM_STALL_MS, CODEX_MANAGED_TUI_ARGS } from '@vibisual/shared';
import {
  createTurnSealState, noteTaskChip, mayTurnResume, noteTurnResumed, noteTurnSealed, hasLiveAgentTasks, countLiveShells,
  listDisplayableLiveTasks, hasLiveTasks, turnIdOfLiveTask, takeOrphanLiveTasks, LIVE_TASK_ORPHAN_GRACE_MS,
  isTurnResumeSignal, TURN_RESUME_GRACE_MS, shouldSleepResumedTurn,
  NOTICE_RESUME_WINDOW_MS, shouldHoldForNoticeResume,
  EARLY_RESULT_SAFETY_MS, isMainThreadModelLine, isResultBeforeOwnTurn,
  type TurnSealState, type LiveTaskInfo,
} from './turnSeal.js';
import { resolveSessionTasksDir, readTaskOutputState, type TaskEndMarker } from './backgroundTaskOutput.js';
import {
  runBackgroundTaskProbe, collectPathFacts, readOutputTail, type ProbeEvidence,
} from './backgroundTaskProbe.js';
// §2.4 — 세션 생존 판정. 위 백그라운드 판정과 같은 계약(중립 cwd · 도구 없음 · 질문 쪼개기).
import {
  runSessionLivenessProbe, resolveSessionTranscript, summarizeTranscriptTail, transcriptLastWriteMs,
  type SessionProbeEvidence,
} from './sessionLivenessProbe.js';
import { terminateTaskProcesses } from './processDescendants.js';
import { scanActiveBackgroundShells, findBackgroundShellCommand } from './backgroundShellWatcher.js';

/**
 * §5.5 #17-9 ⑭ — 판정 상태의 열쇠. **작업 id 만으로는 부족하다** — 하니스가 발급하는 `taskId` 는
 * 세션 안에서만 유일해서, 탭이 여럿이면 서로 다른 작업이 한 칸을 덮어쓴다.
 */
const probeKey = (subId: string, taskId: string): string => `${subId}::${taskId}`;
import { logger } from '../logger.js';
import {
  runLocalTurn,
  stopLocalTurn,
  isRenderableLocalEvent,
  buildLocalSystemPrompt,
  parseLocalSlash,
  unsupportedSlashMessage,
  clearLocalSession,
  compactLocalSession,
  describeLocalContext,
  type LocalTurnArgs,
  type LocalHookToolEvent,
  type LocalToolVerdict,
  type LocalTurnDoneInfo,
} from './localRunner.js';
import { isCodexTurnRunning, runCodexTurn, stopCodexTurn } from './codexRunner.js';
import { effectiveMaxTurns, runLimitMs } from './commandRunLimits.js';
import { createCodexBashBridge } from './codexBashBridge.js';
import { CodexPatchEditLedger, type CodexPatchNote } from './codexPatchEdits.js';
import { codexEdgeInstructions, type CodexEdgeConfig, type CodexPermissionHookConfig, type CodexToolHookConfig } from './codexEdges.js';
import { formatUndeliveredDispatchJobs } from './taskEdgeDispatchJobs.js';
import { permissionBroker } from './permissionBroker.js';
// §5.3 #12-3 — 자물쇠 카드에 싣는 몫(훅 경로와 같은 상한).
import { PATH_LOCK_CARD_HITS_MAX } from '@vibisual/shared';
import type { PathLockHit } from '@vibisual/shared';
import { permissionSessionGrants } from './permissionSessionGrants.js';
import { rescueSubagentResult } from './subagentResultRescue.js';
import { modelRegistryService } from './modelRegistryService.js';
import { readLastAssistantMessage, readLastAssistantEntry, readSessionTokenData, getSessionJsonlPath } from './sessionDiscovery.js';
import type { LastAssistantEntry } from './sessionDiscovery.js';
import * as streamBufferStore from './streamBufferStore.js';
import { claudeSpawnEnv, getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';
import { buildShellCommandLine, interactiveShellFamily } from './interactiveCommandLine.js';
// §5.5 #17-2 — 턴 프롬프트 조립(슬래시 명령은 앞말 없이 원문 그대로). 순수 모듈 + 단위 테스트.
import { composeTurnPrompt, isSlashCommandText } from './turnPrompt.js';
import { resolveTurnResult, isAnswerlessTurnText } from './turnResult.js';
import { isAgentViewEnabled, spawnBackground, stopSession, rmSession } from './claudeAgentViewService.js';
import { attach as attachWatcher, detach as detachWatcher, resumeWatch as resumeAgentViewWatch } from './claudeAgentViewWatcher.js';
import { killTree, terminateChildTree, forceCloseAfterExit, registerSpawnedPid, unregisterSpawnedPid, processGroupSpawnOptions } from './processTree.js';
import { apiCreditService, withCreditKeyEnv, type ApiCreditRunEnd } from './apiCreditService.js';
// 경로 대소문자 정책과 같은 자리의 호스트 플랫폼 — 스폰 env 의 키 이름 규칙(Windows 는 대소문자 무시)에 쓴다.
import { HOST_PLATFORM } from './pathKey.js';
import { processGuard } from './processGuard.js';
import { prepareMcpConfig } from './mcpConfigService.js';
import { decideVerificationReuse, verificationMcpKeyOf, verificationMcpServer, verificationToolsAvailable, type VerificationToolsConfig } from './verificationToolsConfig.js';
import { prepareAgentSettings } from './agentMemoryService.js';
import { decidePersistentReuse, modelAxesKeyOf } from './persistentChildModelAxes.js';
// §4 엔진 다리 — 우리가 띄우는 세션에 싣는 모드 폴더 + 모드가 올린 사실(턴·생존·진척).
import { engineBridge } from './engineBridge.js';

/** parentAgentId → 소속 ProjectInfo 해석. index.ts에서 graphManager 기반으로 주입. */
export type AgentProjectResolver = (parentAgentId: string) => ProjectInfo | null;

/**
 * 모든 프로젝트 — `AgentProjectResolver` 가 소속을 못 풀 때(탭을 닫았다 오가면 `null`) 디스크의 `sub-streams/` 를 찾을 후보.
 * 없으면 파일이 멀쩡한데도 대화가 통째로 빈 것처럼 보인다.
 */
export type AllProjectsProvider = () => ProjectInfo[];

/** §5.3 #12-1-B — 부모 에이전트의 지금 설정(세 층 완성본). 카드의 "항상 거절"은 턴 도중 저장되므로 판정 자리가 이걸 다시 읽는다. `index.ts` 가 주입. */
export type AgentConfigResolver = (parentAgentId: string) => AgentConfig | undefined;

/**
 * §5.3 #12-3 — 이 도구 호출이 닿는 자물쇠. 훅 경로(`/api/permission-check`)와 **같은 판정기**를 쓰도록
 * `index.ts` 가 주입한다(열려 있는 모든 프로젝트의 자물쇠 + 이 호스트의 플랫폼·홈). 두 벌이 되면 헤드리스에서는
 * 묻는데 로컬 모델에서는 안 묻는 상태가 생긴다.
 */
export type PathLockResolver = (
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string | null,
) => PathLockHit[];

/**
 * §5.3 #12-4 — 로컬 도구 판정이 부르는 검증 판정. 훅 경로(`/api/permission-check`)와 **같은 판정 객체**
 * (`VerificationGate`)를 `index.ts` 가 주입한다 — 이 턴의 명령에 찍힌 범위로 판정하고 그 명령에 기록한다.
 * 거부면 사유를 모델에게 돌려준다(던지지 않는다).
 */
export type VerificationCallChecker = (
  cmd: QueuedCommand,
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
) => { verdict: 'none' | 'allow' | 'deny'; message?: string };

/**
 * §5.19 (H) — 로컬 세션의 호스트 도구 한 건(`TodoWrite` → 목표창 · `AskUserQuestion` → 질문 카드 · `ExitPlanMode` → 권한 모드).
 * 반환 문자열이 곧 도구 결과 — 실패도 던지지 말고 말로 돌려라(모델이 다른 수를 고를 수 있게).
 */
/** §5.19 (H) — 로컬 세션의 도구 호출을 훅 이벤트로 흘린다(`index.ts` 가 그래프에 잇는다). 도구 이벤트만 — 생명주기는 로컬 턴이 관리한다. */
export type LocalHookEmitter = (
  ctx: { agentId: string; subAgentId: string },
  event: LocalHookToolEvent,
) => void;

export type LocalHostToolHandler = (
  ctx: { agentId: string; subAgentId: string; agentLabel: string; config: AgentConfig },
  toolName: string,
  input: Record<string, unknown>,
) => Promise<string>;

/** 서버 기본 라벨 패턴(`Sub #N`) — 자동 이름은 이 기본값일 때만 덮는다. */
const DEFAULT_SUB_LABEL_RE = /^Sub #\d+$/;
/** 자동 탭 제목 최대 길이(초과분은 … 로 컷). 탭은 CSS truncate 하지만 라벨 자체도 과하게 길지 않게 보관. */
const AUTO_TITLE_MAX = 60;

/** §5.5 #17-5 — 첫 프롬프트로 탭 제목을 정한다(LLM 호출 없이). 첫 비지 않은 줄의 장식·따옴표를 벗겨 ~60자. 빈 문자열이면 호출부가 기본 라벨(Sub #N)을 둔다. */
function deriveTabTitle(text: string): string {
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';
  let title = firstLine
    .replace(/^#{1,6}\s+/, '')          // 마크다운 헤더
    .replace(/^[-*+]\s+/, '')           // 리스트 불릿
    .replace(/^>\s+/, '')               // 인용
    .replace(/^`+|`+$/g, '')            // 인라인 코드펜스
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '') // 감싼 따옴표
    .trim();
  if (title.length > AUTO_TITLE_MAX) title = `${title.slice(0, AUTO_TITLE_MAX).trimEnd()}…`;
  return title;
}

/** §4 — CLI `--model` 이 bare alias 로 latest 해소하는 패밀리. 밖의 패밀리(fable 등)를 bare 로 넘기면 opus 로 조용히 폴백된다 — 레지스트리 풀ID 로 바꿀 것. */
const CLI_NATIVE_ALIASES = new Set<string>(['opus', 'sonnet', 'haiku']);

/** AgentConfig → claude CLI 인자(`buildConfigArgs`). 기본값과 같은 항목은 넘기지 않는다 — 권한 모드·도구는 예외로 항상 명시. */
/** 스폰 맥락 — 기억 폴더를 프로젝트 아래에 잡을 이름·루트(§5.3). */
interface ConfigArgsContext {
  verificationConfig?: VerificationToolsConfig;
  /** 기억 폴더 이름이 될 에이전트 식별자. */
  agentName?: string;
  /** 프로젝트 루트(= 스폰 cwd). 'project'/'local' 범위에서만 쓰인다. */
  projectRoot?: string;
}

/** §4 (Fast 모드) — Opus 계열이 아니면 CLI 가 조용히 무시하므로 키를 만들지 않는다. `--model` 로 나가는 값과 같게 핀(`modelVersion`)을 먼저 본다. */
function wantsFastMode(config: AgentConfig): boolean {
  if (!config.fastMode) return false;
  return supportsFastMode(config.modelVersion?.trim() || config.model);
}

function buildConfigArgs(config: AgentConfig, ctx?: ConfigArgsContext): string[] {
  const args: string[] = [];

  // 모델 — §4: alias 해소는 CLI 에 맡긴다(`opus[1m]` 도 작동, 2.1.154 확인). 핀(`modelVersion`) 우선. 정적 목록으로 거르지 않는다 — 검증은 CLI 가 spawn 때 한다.
  if (config.model) {
    const pinned = config.modelVersion?.trim();
    let base = pinned || config.model;
    // §4 — 핀도 native alias 도 아니면 레지스트리 latest 풀ID 로 바꾼다(fable → claude-fable-5). 레지스트리에 없으면 bare 그대로(CLI 가 에러).
    if (!pinned && !CLI_NATIVE_ALIASES.has(base)) {
      const resolved = resolveAliasToLatest(base, modelRegistryService.getRegistry());
      if (resolved) base = resolved;
    }
    let modelArg = base;
    if (config.contextWindow !== '200k' && isOpusModel(base) && !modelArg.endsWith('[1m]')) {
      modelArg = `${modelArg}[1m]`;
    }
    args.push('--model', modelArg);
  }

  // 퍼미션 모드 — **항상 명시한다.** CLI 무플래그 기본이 `auto`(자동 승인, 2026-08-14 부터)라 `'default'`(Manual)에서 빼면 자동 승인으로 돈다.
  // 변환표는 `toCliPermissionMode`(shared) 한 곳, `bypassPermissions` 만 전용 플래그. 승인 게이트 매핑은 §5.3 #12-1.
  if (config.permissionMode === 'bypassPermissions') {
    args.push('--dangerously-skip-permissions');
  } else {
    const cliPermissionMode = toCliPermissionMode(config.permissionMode);
    if (cliPermissionMode) args.push('--permission-mode', cliPermissionMode);
  }
  // 사고 깊이 (effort)
  if (config.effort && config.effort !== 'default') {
    args.push('--effort', config.effort);
  }

  // 허용 도구 — `--tools` 는 늘 명시한다(UI 목록이 CLI 툴셋의 부분집합일 수 있어 "전부면 생략"하면 어긋난다). 빈 배열은 `--tools ""` = 전부 끔.
  if (config.tools) {
    args.push('--tools', config.tools.join(','));
  }

  // 차단 도구
  if (config.disallowedTools && config.disallowedTools.length > 0) {
    args.push('--disallowedTools', config.disallowedTools.join(','));
  }

  // §5.5 #17-20 ⑥ — MCP 도구. 이 함수가 헤드리스·CMD 공유의 유일한 조립 지점이라 여기 한 번이면 된다.
  // `--tools` 는 MCP 를 막지 않는다 — 매 호출 승인 팝업이 없게 `--allowedTools mcp__<서버>` 로 연다.
  const mcp = prepareMcpConfig(config.mcpServers, ctx?.verificationConfig ? verificationMcpServer(ctx.verificationConfig) : undefined);
  if (ctx?.verificationConfig && !mcp) throw new Error('Verification tools unavailable: could not prepare the MCP connection');
  if (mcp) {
    args.push('--mcp-config', mcp.configPath);
    args.push('--allowedTools', mcp.allowedTools.join(','));
  }

  // 격리 — worktree 면 `--worktree`(이름은 CLI 가), `'none'` 은 플래그 없음. ⚠ `--isolation` 은 없는 플래그라 스폰이 즉시 죽는다(실측 2.1.223).
  if (config.isolation === 'worktree') {
    args.push('--worktree');
  }

  // §4 — 아래는 양쪽 경로에 유효한 플래그(`--fallback-model` 은 `--print` 전용이라 printFlags).
  // (5) 자동 압축 창(`--autocompact`)은 싣지 않는다 — 실으면 Opus 5.5 에서 200k 창이 ~19호출마다 접혔다(실측). 고른 창은 턴 경계 판정(`shouldCompactAfterTurn`)만 본다.
  // ⚠ `--autocompact off` 는 즉시 종료(실측 2.1.252) — `agentCliArgs.test.ts` 가 막는다.

  // §4 — `--system-prompt-snapshot off`: 기본 `on` 은 첫 요청의 프롬프트를 압축 전까지 resume 에도 그대로 보내, 매 턴 `--append-system-prompt` 로 바뀌는 집행 문구가 조용히 굳는다.
  // ⚠ 값은 `on|off` 뿐(밖이면 즉시 종료). `off` 는 `--print`·`--version` probe 통과(실측 2.1.278)라 두 경로 공유 자리에 둔다.
  args.push('--system-prompt-snapshot', 'off');
  if (config.excludeDynamicSystemPromptSections) {
    args.push('--exclude-dynamic-system-prompt-sections');
  }
  const settingSources = config.settingSources?.filter((s) => typeof s === 'string' && s.trim().length > 0);
  if (settingSources && settingSources.length > 0) {
    args.push('--setting-sources', settingSources.join(','));
  }
  if (config.safeMode) {
    args.push('--safe-mode');
  }
  const betas = config.betas?.filter((b) => typeof b === 'string' && b.trim().length > 0);
  if (betas && betas.length > 0) {
    args.push('--betas', ...betas);
  }

  // §4 — 세션 전용 서브에이전트 정의(`--agents`, 변환은 shared `buildAgentsFlagJson`, 없으면 안 붙인다).
  // ⚠ argv JSON 이라 배열 인자 spawn 에서만 안전하다 — 셸 한 줄인 CMD prefill 은 따옴표가 먹혀 깨지므로 `interactiveCommandLine.ts` 가 셸별로 감싼다.
  const agentsJson = buildAgentsFlagJson(config.agentDefinitions);
  if (agentsJson) {
    args.push('--agents', agentsJson);
  }

  // §4 (CLI 사양 추종) — 세션 한정 플러그인. `--plugin-dir` 는 **반복 플래그**라 경로마다 한 번씩
  //   붙는다(쉼표 연결이 아니다 — 경로에 쉼표가 들어갈 수 있어 CLI 가 그 형식을 안 쓴다).
  for (const dir of normalizePluginDirs(config.pluginDirs)) {
    args.push('--plugin-dir', dir);
  }
  // §4 엔진 다리 — 우리 모드(`vibisual-bridge`)를 이 세션에만 싣는다. 스위치를 껐거나·판올림이 낮거나·
  //   모르거나·파일을 못 옮겼으면 아무것도 붙지 않는다(종전 스폰과 바이트 단위로 같다).
  appendEngineBridgeArgs(args);
  // §5.3 기억 + §4 Fast — `--settings` 한 장(사용자 설정과 병합). ⚠ 두 번 붙이면 뒤엣것이 통째로 덮는다(실측) — `prepareAgentSettings` 가 한 장으로 만든다.
  const settingsPlan = prepareAgentSettings({
    memory: config.memory,
    fastMode: wantsFastMode(config),
    thinking: config.thinking,
    agentName: ctx?.agentName ?? 'agent',
    projectRoot: ctx?.projectRoot,
  });
  if (settingsPlan?.settingsPath) {
    args.push('--settings', settingsPlan.settingsPath);
  }

  return args;
}

/**
 * §4 엔진 다리 — 실을 모드 폴더가 있으면 `--plugin-dir <폴더>` 를 붙인다. 같은 폴더가 이미 있으면 두 번
 * 붙이지 않는다 — `buildConfigArgs` 가 붙인 뒤 `execute` 가 설정 없는 맨 스폰을 위해 한 번 더 부른다.
 */
function appendEngineBridgeArgs(args: string[]): void {
  const dir = engineBridge.pluginDirForSpawn();
  if (!dir) return;
  for (let i = 0; i + 1 < args.length; i++) {
    if (args[i] === '--plugin-dir' && args[i + 1] === dir) return;
  }
  args.push('--plugin-dir', dir);
}

/** §4 — Bash 타임아웃 env(`BASH_DEFAULT_TIMEOUT_MS`/`BASH_MAX_TIMEOUT_MS`): CLI 는 기본 2분·상한 10분으로 자른다. env 라 헤드리스·PTY 가 공유. 미설정이면 키를 안 넣는다. */
export function buildBashTimeoutEnv(config: AgentConfig | undefined): Record<string, string> {
  if (!config) return {};
  const env: Record<string, string> = {};
  const def = normalizeBashTimeoutMs(config.bashDefaultTimeoutMs);
  if (def !== undefined) env['BASH_DEFAULT_TIMEOUT_MS'] = String(def);
  const max = normalizeBashTimeoutMs(config.bashMaxTimeoutMs);
  if (max !== undefined) env['BASH_MAX_TIMEOUT_MS'] = String(max);
  return env;
}

/**
 * §5.3 #9-1 (J~M) — 토큰 절약 env. 조립은 shared `buildTokenSaverEnv`(화면과 같은 답), 여기는 3층(에이전트 → 전역)만 채운다. 켠 축이 없으면 빈 객체.
 * 클로드 CLI 두 경로(헤드리스 `buildConfigEnv` · CMD PTY `terminalManager`)만 부른다 — 코덱스엔 뜻이 없다.
 */
export function buildAgentTokenSaverEnv(config: AgentConfig | undefined): Record<string, string> {
  return buildTokenSaverEnv(config, appStateGetTokenSaver());
}

/**
 * §5.3 #12-4 (J) — 실행 전 차단 표식 env. 훅 안전망(`hooks/handler.mjs`)이 서버·설정을 못 읽을 때 본다. 헤드리스·CMD PTY 가 부른다.
 * 끔도 `0` 을 명시 — 부모의 낡은 `1` 을 물려받지 않게.
 */
export function buildVerificationGateEnv(): Record<string, string> {
  return { [VERIFICATION_GATE_ENV]: isVerificationGateEnabled(userDefaultsService.get()) ? '1' : '0' };
}

/** §5.3 — 스폰 env 항목(중첩 깊이 · 자동 기억 끄기). env 축이라 `buildConfigArgs` 와 따로. */
function buildConfigEnv(config: AgentConfig | undefined, ctx?: ConfigArgsContext): Record<string, string> {
  if (!config) return {};
  const env: Record<string, string> = {};

  if (typeof config.subagentDepth === 'number') {
    env['CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH'] = String(config.subagentDepth);
  }

  Object.assign(env, buildBashTimeoutEnv(config));
  // §5.3 #9-1 (J~M) — 출력 상한·압축 조기화·비필수 호출 차단. 켠 축이 없으면 아무 키도 안 붙는다.
  Object.assign(env, buildAgentTokenSaverEnv(config));

  // ⚠ 위 `buildConfigArgs` 와 **같은 입력**을 줘야 한다 — 파일 이름이 본문 해시라, 한쪽만 키를
  //   더하면 인자가 가리키는 파일과 여기서 만든 파일이 서로 다른 장이 된다.
  const plan = prepareAgentSettings({
    memory: config.memory,
    fastMode: wantsFastMode(config),
    thinking: config.thinking,
    agentName: ctx?.agentName ?? 'agent',
    projectRoot: ctx?.projectRoot,
  });
  if (plan?.env) Object.assign(env, plan.env);

  return env;
}

/** §4 — 인터랙티브 PTY 스폰 인자. `-p`/stream 플래그를 붙이지 않는다(진짜 REPL — 구독 과금 + ToS 합법선). 설정 인자는 `buildConfigArgs` 공유, rules 는 `--append-system-prompt` 로 1회. */
export function buildInteractiveClaudeArgs(
  config: AgentConfig,
  opts: { includeRules?: boolean } = {},
): string[] {
  const args = buildConfigArgs(config);
  // includeRules 기본 false — 임베디드 터미널은 셸 프롬프트에 명령을 prefill 하는데
  // 멀티라인 rules 를 한 줄 명령에 넣으면 셸 파싱이 깨진다(데스크톱 터미널 매니저 경로).
  // 직접 spawn(argv 배열) 경로에서만 includeRules:true 로 rules 를 안전히 주입.
  if (opts.includeRules) {
    const rules = config.rules?.trim();
    if (rules) args.push('--append-system-prompt', rules);
  }
  return args;
}

/**
 * §4 (CMD ⑧) — CMD 셸에 prefill 할 한 줄. 실행 파일·훅 귀속은 `CMD_CLI_KINDS` 표가 정한다(§3.3). `managed === false` 면 우리 훅의 자식이 아니라
 * claude 인자(`--resume`·rules `--add-dir` 등)를 일절 안 붙인다. `'shell'` 은 순수 셸.
 * 개행은 **절대 붙이지 않는다** — 사람이 Enter 를 치는 것이 ToS 합법선이다(§4).
 */
export function buildInteractiveCliPrefill(opts: {
  config: AgentConfig;
  /** claude 실행본 절대경로(`getClaudeBin().binPath`). claude 갈래에서만 쓰인다. */
  claudeBinPath: string;
  /** rules 폴더(있으면 `--add-dir`). claude 갈래 전용. */
  rulesDir?: string | null;
  /** 직전 대화 sessionId(있으면 `--resume`). claude 갈래 전용. */
  resumeId?: string | null;
  /**
   * 이 줄을 받을 셸의 실행 파일(`pickShell().shell`) — 인용 규칙이 셸마다 다르다(cmd.exe · POSIX 셸 · fish).
   * 없으면 OS 기본(win32 = cmd.exe, 그 밖 = POSIX 셸)으로 본다.
   */
  shell?: string;
  /** 판정할 OS — 시험이 세 OS 를 다 돌 수 있게 인자로 받는다. 없으면 이 프로세스의 OS. */
  platform?: NodeJS.Platform;
  /** §4 (앱 전용 엔진) — 앱 전용 코덱스 실행본 경로. 있으면 맨 `codex` 대신 이 경로 + 업데이트 확인 끄기(`CODEX_MANAGED_TUI_ARGS`). */
  managedCodexBin?: string | null;
  /**
   * §4 (앱 전용 엔진) ④ — 사용자가 Version 탭 코덱스 칸에서 **보조로 고른** 실행본(`codexBinOverride()`).
   * 있으면 앱 전용보다 먼저 그 경로로 띄운다 — 그 설치본의 갱신은 그 주인의 것이라 업데이트 확인 끄기는 붙이지 않는다.
   */
  selectedCodexBin?: string | null;
}): { prefill: string; managed: boolean; kind: CmdCliKind } {
  const row = resolveCmdCliKind(opts.config.cliKind);
  const kind = row.value as CmdCliKind;

  if (!row.managed) {
    if (row.value === 'codex' && (opts.selectedCodexBin || opts.managedCodexBin)) {
      // 우리 훅의 자식이 아닌 것은 그대로다(`--resume`·rules 없음) — 바뀌는 것은 무엇을 띄우는가뿐이다.
      const family = interactiveShellFamily(opts.shell, opts.platform ?? process.platform);
      const argv = opts.selectedCodexBin
        ? [opts.selectedCodexBin]
        : [opts.managedCodexBin as string, ...CODEX_MANAGED_TUI_ARGS];
      return {
        prefill: buildShellCommandLine(argv, family),
        managed: false,
        kind,
      };
    }
    // 순수 셸(`bin === ''`)이면 빈 prefill — 사용자가 직접 친다.
    return { prefill: row.bin, managed: false, kind };
  }

  // §4 (CLI 사양 추종) (5) — 자동 압축 창은 CMD 에도 싣지 않는다(헤드리스와 같은 `buildConfigArgs`). 사람이
  //   직접 치는 세션이라 우리가 명령 사이 압축을 끼울 자리도 없어, VS Code 와 같이 모델 창 끝에서만 접힌다.
  const args = buildInteractiveClaudeArgs(opts.config, { includeRules: false });
  if (opts.rulesDir) args.push('--add-dir', opts.rulesDir);
  const fullArgs = opts.resumeId ? ['--resume', opts.resumeId, ...args] : args;
  // 셸 문법으로 감싼다 — 종전 "공백이 있으면 큰따옴표"는 `--agents` JSON 의 안쪽 따옴표를 그대로 둬
  //   cmd.exe·bash 가 JSON 을 쪼갰고, 맨몸 `opus[1m]` 은 mac zsh 가 글롭으로 읽어 명령을 거절했다.
  const family = interactiveShellFamily(opts.shell, opts.platform ?? process.platform);
  return {
    prefill: buildShellCommandLine([opts.claudeBinPath, ...fullArgs], family),
    managed: true,
    kind,
  };
}

/** §4 — CMD 에이전트 로컬 스토어 폴더(`~/.vibisual/cmd-agents/<agentId>/`). rules·세션맵 공용. */
function cmdAgentDir(agentId: string): string {
  // agentId 는 `agent-<hash>`(콜론/슬래시 없음)지만 방어적으로 안전한 문자만 남긴다.
  const safeId = agentId.replace(/[^\w.-]/g, '_');
  return path.join(os.homedir(), '.vibisual', 'cmd-agents', safeId);
}

/**
 * termId → { agentId, sessionToken, paneId, resumeKey } | null. pane 분할 termId 는 `term:<agentId>:<session>#<paneId>`(§4 CMD ⑤) —
 * pane 을 먼저 떼야 소유 탭 해석이 맞고, `--resume` 세션맵은 pane 별 대화라 `resumeKey` 에 pane 을 넣는다(`'0'` 은 옛 키와 같다).
 */
function parseTermId(termId: string): { agentId: string; sessionToken: string; paneId: string; resumeKey: string } | null {
  const cut = termId.indexOf(CMD_PANE_SEPARATOR);
  const base = cut >= 0 ? termId.slice(0, cut) : termId;
  const paneId = cut >= 0 ? termId.slice(cut + 1) || '0' : '0';
  const parts = base.split(':');
  if (parts.length < 3 || parts[0] !== 'term' || !parts[1]) return null;
  const sessionToken = parts.slice(2).join(':') || 'main';
  return {
    agentId: parts[1],
    sessionToken,
    paneId,
    resumeKey: paneId === '0' ? sessionToken : `${sessionToken}${CMD_PANE_SEPARATOR}${paneId}`,
  };
}

/**
 * §4 (CMD 터미널 업그레이드 ⑦) — desktop 의 터미널 매니저가 PTY env(카드 신고용 agentId/subAgentId)를
 * 채우려면 termId 를 우리와 **같은 규칙**으로 풀어야 한다. 파서를 두 벌 두면 pane 구분자 규칙이
 * 갈라지므로 이 하나를 내보낸다.
 */
export function parseCmdTermId(termId: string): { agentId: string; sessionToken: string; paneId: string; resumeKey: string } | null {
  return parseTermId(termId);
}

/**
 * §4 — CMD 에이전트의 Agent Rules 를 파일로: prefill 은 셸 한 줄이라 멀티라인을 못 넣는다(개행이 제출). `~/.vibisual/cmd-agents/<agentId>/CLAUDE.md` 에 쓰고 `--add-dir` 로 물린다.
 * 새 세션 스폰마다 다시 쓴다(떠 있는 세션엔 소급 안 됨). 카드 신고 프로토콜을 늘 덧붙이므로 rules 가 비어도 폴더를 돌려준다.
 * @returns 폴더 절대경로(쓰기 실패 때만 null = `--add-dir` 생략).
 */
export function prepareInteractiveRulesDir(
  agentId: string,
  config: AgentConfig,
  opts: { enforcementBlock?: string } = {},
): string | null {
  const rules = config.rules?.trim();
  const dir = cmdAgentDir(agentId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const sections = ['# Agent Rules (Vibisual CMD agent)'];
    if (rules) sections.push(rules);
    // §5.11 — 켠 집행 플러그인 지시. CMD 는 프롬프트를 우리가 조립하지 않아 rules 와 같은 통로로 넣는다(다음 세션부터).
    const enforcement = opts.enforcementBlock?.trim();
    if (enforcement) sections.push(enforcement);
    // 카드 신고 프로토콜(터미널 한 줄) — 항상 주입. claude 가 echo 한 줄로 IDE 카드를 띄울 수 있게.
    sections.push(buildCmdCardProtocolRules().trim());
    // §5.3 #12-4 (G)(J) — 켠 동안만 제한 문단을 쓴다. 기존 터미널의 설정 변경은 매 턴 훅 응답이 알린다.
    const verificationRules = buildVerificationPolicyRules({ enforced: isVerificationGateEnabled(userDefaultsService.get()) }).trim();
    if (verificationRules) sections.push(verificationRules);
    const body = `${sections.join('\n\n')}\n`;
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body, 'utf-8');
    return dir;
  } catch (err) {
    logger.warn(`[cmd-agent] rules dir write failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * §4 — CMD 세션 연속성: 훅 session_id 를 termId 별로 `sessions.json` 에 적어, 다시 켤 때 `claude --resume <id>` 로 prefill.
 * 터미널 부기라 체크포인트가 아닌 CMD 로컬 스토어에, 바뀔 때만 쓴다.
 */
export function recordCmdTermSession(termId: string, claudeSessionId: string): void {
  const parsed = parseTermId(termId);
  if (!parsed || !claudeSessionId) return;
  const dir = cmdAgentDir(parsed.agentId);
  const file = path.join(dir, 'sessions.json');
  try {
    let map: Record<string, string> = {};
    if (fs.existsSync(file)) {
      try { map = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, string>; } catch { map = {}; }
    }
    if (map[parsed.resumeKey] === claudeSessionId) return; // 변화 없음 — disk write 생략
    map[parsed.resumeKey] = claudeSessionId;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(map, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`[cmd-agent] session record failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** termId 의 직전 claude 대화 sessionId 조회(없으면 null). 터미널 스폰 시 `--resume` prefill 용. */
export function getCmdResumeSession(termId: string): string | null {
  const parsed = parseTermId(termId);
  if (!parsed) return null;
  const file = path.join(cmdAgentDir(parsed.agentId), 'sessions.json');
  try {
    if (!fs.existsSync(file)) return null;
    const map = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, string>;
    const id = map[parsed.resumeKey];
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/** §4 — CMD 에이전트의 claude 대화 UUID 목록(`sessions.json`). 훅이 session_id 를 합성 세션으로 바꿔 쓰므로 본문은 이 UUID 의 JSONL 에만 있다 — Results 패널이 이걸로 읽는다. */
export function getCmdSessionIds(agentId: string): string[] {
  const file = path.join(cmdAgentDir(agentId), 'sessions.json');
  try {
    if (!fs.existsSync(file)) return [];
    const map = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, string>;
    const ids = Object.values(map).filter((v): v is string => typeof v === 'string' && v.length > 0);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

/** claude CLI 경로 — `services/claudeBin.ts` 가 정본(§5.7 #23-1 버전 체크와 같은 바이너리). */
const CLAUDE_BIN = (): string => getClaudeBin().binPath;

/**
 * Persistent child — 매 턴 fresh spawn 대신 자식 하나를 두고 stdin 으로 다음 턴만 넣는다(부팅·재로드 비용 0). `VIBISUAL_PERSISTENT_CHILD=0` 이면 매 턴 spawn.
 * multi-turn stdin 을 못 하는 CLI 면 result 후 끝나고 다음 턴이 `--resume` 으로 폴백한다.
 */
const PERSISTENT_CHILD_ENABLED = process.env['VIBISUAL_PERSISTENT_CHILD'] !== '0';

/**
 * soft interrupt 뒤 마감을 기다리는 시간 — 넘으면 하드 킬로 폴백. **반드시 `TURN_RESUME_GRACE_MS` 보다 길어야 한다** —
 * 같으면 봉인 유예 중인 멀쩡한 세션을 폴백이 죽이고, 만료된 봉인이 그 자식에 다음 턴을 써 [즉시] 가 대화를 끝낸다.
 */
const SOFT_INTERRUPT_FALLBACK_MS = TURN_RESUME_GRACE_MS + 1500;

/** `control_request.request_id` 발급기 — CLI 응답을 짝지을 때 쓰는 값이라 유일하기만 하면 된다. */
let softInterruptSeq = 0;

/** Persistent child 에서 지금 처리 중인 명령 한 건 — 보낸 순간 set, 그 턴이 봉인될 때 delete. */
interface PersistentInFlight {
  cmd: QueuedCommand;
  turnCount: number;
  resultText: string | undefined;
  killed: boolean;
  maxTurns: number;
  parentCwd: string;
  /** §5.5 #17-18 — 이 명령을 보낸 뒤 본 대화의 모델 줄(`isMainThreadModelLine`)이 왔는가. */
  mainActivity: boolean;
  /** §5.5 #17-18 — 이 명령에 인터럽트를 보냈다. 그 뒤의 `result` 는 모델 줄이 없어도 이 명령의 끝이다. */
  interrupted?: boolean;
  /** §5.5 #17-18 — 활동 없이 온 `result` 를 건너뛴 뒤 걸어 둔 안전 마감(`EARLY_RESULT_SAFETY_MS`). */
  earlyResultTimer?: ReturnType<typeof setTimeout>;
  /** §5.5 #17-18 ⑩-5 — 붙든 `result` 가 남의 턴 도장이었나. 참이면 안전 마감이 그 본문을 이 명령의 답으로 싣지 않는다. */
  earlyResultForeign?: boolean;
}

/** 걸어 둔 안전 마감을 거둔다 — 모델 줄이 왔거나, 다른 경로가 그 명령을 마감했을 때. */
function clearEarlyResultWait(inFlight: PersistentInFlight | undefined): void {
  if (!inFlight?.earlyResultTimer) return;
  clearTimeout(inFlight.earlyResultTimer);
  inFlight.earlyResultTimer = undefined;
}

/** `isChildStdinWritable` 이 보는 것만 구조로 드러낸다 — `ChildProcess` 가 그대로 들어맞는다. */
type StdinBearingChild = {
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  stdin?: { destroyed?: boolean; writableEnded?: boolean; writable?: boolean } | null;
};

/**
 * §5.5 #17-18 — 다음 턴을 쓸 창구(stdin)가 열려 있는가. `terminateChildTree` 가 `stdin.end()` 를 먼저 불러 `close` 전까지 창구만 닫힌 창이 있다 —
 * 거기 쓰면 `ERR_STREAM_WRITE_AFTER_END` 가 `error` 이벤트로 올라 try/catch 를 지나 `uncaughtException`, dispatch 가 끊긴다(실측 2026-08-14).
 */
export function isChildStdinWritable(child: StdinBearingChild | null | undefined): boolean {
  if (!child) return false;
  // 이미 끝난 프로세스 — exitCode/signalCode 중 하나라도 값이 있으면 창구는 없다.
  if (child.exitCode !== null && child.exitCode !== undefined) return false;
  if (child.signalCode !== null && child.signalCode !== undefined) return false;
  const stdin = child.stdin;
  if (!stdin) return false;
  if (stdin.destroyed === true) return false;
  // `end()` 가 이미 불렸으면 여기에 쓰는 순간 write-after-end 다.
  if (stdin.writableEnded === true) return false;
  if (stdin.writable === false) return false;
  return true;
}

/** subagent 카운터 (라벨 생성용) */
let subCounter = 0;

/** 세션 id 를 다시 뽑아 보는 횟수 상한 — 난수 꼬리가 겹치는 것은 사실상 없지만 무한 루프는 만들지 않는다. */
const SUB_ID_MINT_ATTEMPTS = 50;

/** SubAgent 매니저 — 부모 에이전트별 실행 세션의 생성·상태·명령 실행(`claude -p`/`--resume`)·결과 수집. */
/**
 * sub 당 스트림 버퍼 상한 = IDE 가 되살릴 수 있는 대화 전부(§5.5). 작으면 긴 세션의 말풍선 사이 대화가 빈다(실측: 500 은 1시간 세션의 마지막 10분).
 * ⚠ `streamBufferStore.COMPACT_KEEP_LINES` 가 늘 이 값보다 커야 한다 — 작으면 복원이 조용히 깎인다.
 */
const MAX_STREAM_BUFFER = 2000;

/** 전체 세션 일괄 조회(`getStreamBuffersForAgent`)의 세션당 상한 — 클라가 안 보는 세션을 곧 깎으므로 꼬리만. 깊은 복원분은 단건 `getStreamBuffer`. */
const MAX_STREAM_BUFFER_BULK = 500;

/**
 * 스트림 쓰기 폴더를 모든 프로젝트에서 훑었는데 못 찾았을 때, 같은 세션을 다시 훑기까지 쉬는 시간.
 * 줄은 초당 수백 개씩 들어오므로 헛친 훑기(`stat` × 프로젝트 수)를 줄마다 반복하지 않게 한다.
 */
const STREAM_WRITE_DIR_RETRY_MS = 5_000;

/** 이벤트 ID 생성 (나노초 수준 충돌 방지용 랜덤 suffix) */
function makeEventId(): string {
  return `se-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Edit 계열 도구 — 클라 DiffView(parseEditToolInput)가 input JSON 전체를 JSON.parse 해야
 *  side-by-side diff 를 그린다. 여기서 자르면 JSON 이 깨져 파싱 실패 → diff 미표시(한 줄만/누락). */
const DIFF_INPUT_TOOLS = new Set([
  'Edit', 'MultiEdit', 'Write', 'NotebookEdit',
  // §5.5 #17-17 ⑨ — TodoWrite 도 전문 — 자르면 JSON 이 깨져 계획 블록(`parsePlanTodos`)·목표 동기화가 조용히 실패한다.
  'TodoWrite',
]);
/** 비-Edit 도구 input 미리보기 상한(문자). Edit 계열은 자르지 않는다(위 참조). */
const TOOL_INPUT_PREVIEW_LIMIT = 300;
/** §5.5 #17-12 ③ — 오류 사유 원문(stderr 꼬리·예외 메시지) 보관 상한(문자). 사유는 **꼬리**가 중요하다
 *  (마지막 스택/메시지가 원인) — 넘치면 앞을 버리고 뒤를 남긴다. */
const COMMAND_ERROR_DETAIL_LIMIT = 600;

/**
 * tool_use input(JSON) → 스트림 이벤트 content 문자열.
 * Edit 계열은 diff 렌더에 전체 JSON 이 필요하므로 절대 자르지 않는다(잘리면 JSON.parse 실패).
 * 그 외 도구는 미리보기라 상한까지만.
 */
function summarizeToolInput(name: string, input: unknown): string {
  if (input === undefined) return '';
  const json = JSON.stringify(input);
  if (DIFF_INPUT_TOOLS.has(name)) return json;
  return json.length > TOOL_INPUT_PREVIEW_LIMIT ? json.slice(0, TOOL_INPUT_PREVIEW_LIMIT) : json;
}

/**
 * §5.5 #17-13 ⑤-3 — 작업 이벤트에서 화면이 그리는 것만(모양 claude.exe 2.1.223):
 *   task_started      : task_id · description · subagent_type? · task_type? · prompt? · skip_transcript?
 *   task_notification : task_id · status(completed|failed|stopped) · summary · usage.duration_ms · skip_transcript?
 * 시작·끝 한 쌍이라 클라가 `task_id` 로 접는다. 다른 subtype 은 `[subtype]` 한 줄.
 */
function readTaskInfo(subtype: string, obj: Record<string, unknown>): StreamTaskInfo | null {
  if (subtype !== TASK_CHIP_START_SUBTYPE && subtype !== TASK_CHIP_END_SUBTYPE) return null;
  const id = typeof obj['task_id'] === 'string' ? obj['task_id'] : '';
  if (!id) return null;
  const text = (key: string): string | undefined => (typeof obj[key] === 'string' ? (obj[key] as string) : undefined);
  if (subtype === TASK_CHIP_START_SUBTYPE) {
    return { id, description: text('description'), subagentType: text('subagent_type') };
  }
  const rawStatus = text('status');
  const status = rawStatus === 'completed' || rawStatus === 'failed' || rawStatus === 'stopped'
    ? (rawStatus as StreamTaskStatus)
    : undefined;
  const usage = obj['usage'] as Record<string, unknown> | undefined;
  const durationMs = usage && typeof usage['duration_ms'] === 'number' ? (usage['duration_ms'] as number) : undefined;
  return { id, status, summary: text('summary'), durationMs };
}

/**
 * §4 — `--include-hook-events` 훅 줄에서 그릴 것만. ⚠ 본문 필드는 문서화돼 있지 않다 — 흔한 이름을 훑고 못 찾으면 줄을 만들지 않는다.
 * 라벨은 `hook_event_name`, `id` 는 훅 이름 + 자리표(시작·응답이 한 이름으로 묶인다).
 */
function readHookChipInfo(obj: Record<string, unknown>): StreamTaskInfo | null {
  const text = (key: string): string | undefined => {
    const v = obj[key];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const eventName = text('hook_event_name') ?? text('event') ?? text('hook_event');
  // 어떤 훅이 떴는지도 모르면 남길 뜻이 없다 — 민 칩 `[hook_started]` 은 종전에 버리던 그 줄이다.
  if (!eventName) return null;
  const command = text('hook_name') ?? text('command') ?? text('matcher');
  const summary = text('output') ?? text('stdout') ?? text('message') ?? text('reason');
  const durationRaw = obj['duration_ms'] ?? obj['durationMs'];
  const durationMs = typeof durationRaw === 'number' && Number.isFinite(durationRaw) ? durationRaw : undefined;
  return {
    id: `hook:${eventName}`,
    description: command ? `${eventName} — ${command}` : eventName,
    summary,
    durationMs,
  };
}

/** stream-json 한 줄 → 이벤트 배열(메시지 하나에 thinking·text·tool_use 가 함께 온다). Agent View JSONL tail(§5.7 #23-2)도 쓴다 — 모르는 type 은 []. */
export function parseStreamLine(
  obj: Record<string, unknown>,
  subAgentId: string,
  parentAgentId: string,
  opts: { partialMessages?: boolean; hookEvents?: boolean } = {},
): SubAgentStreamEvent[] {
  const type = obj['type'] as string | undefined;
  if (!type) return [];

  // §4 — `--include-partial-messages` 스폰(legacy)에서만 true: 델타를 흘리고 완성 메시지의 text/thinking 은 억제한다(둘 다면 두 번). persistent·JSONL 은 델타가 없다.
  const partial = opts.partialMessages === true;

  const makeBase = (): Omit<SubAgentStreamEvent, 'eventType' | 'content'> => ({
    id: makeEventId(),
    subAgentId,
    parentAgentId,
    timestamp: Date.now(),
  });

  // assistant 메시지 — content[] 배열의 각 블록을 독립 이벤트로 방출
  if (type === 'assistant') {
    const msg = obj['message'] as Record<string, unknown> | undefined;
    const content = msg?.['content'];
    if (!Array.isArray(content)) return [];
    const events: SubAgentStreamEvent[] = [];
    // §4 (스트림 ①) — 중첩 서브에이전트의 말(`--forward-subagent-text` → `parent_tool_use_id`). ⚠ 델타 없이 완성 메시지로만 온다(실측) — partial 가드에 태우면 통째로 사라진다.
    const nestedUnder = typeof obj['parent_tool_use_id'] === 'string' ? (obj['parent_tool_use_id'] as string) : undefined;
    /** 중첩 줄은 델타가 없으므로 완성 블록을 반드시 방출해야 한다. */
    const skipComplete = partial && !nestedUnder;
    const nest = nestedUnder ? { nestedUnderToolUseId: nestedUnder } : {};
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      const bt = b['type'] as string | undefined;
      // §4 — partial 이면 text/thinking 은 델타로 흘렸으니 건너뛴다. tool_use 는 델타가 부분 JSON 이라 늘 완성 블록에서.
      if (bt === 'text' && typeof b['text'] === 'string' && b['text']) {
        if (!skipComplete) events.push({ ...makeBase(), ...nest, eventType: 'text', content: b['text'] as string });
      } else if (bt === 'thinking' && typeof b['thinking'] === 'string' && b['thinking']) {
        if (!skipComplete) events.push({ ...makeBase(), ...nest, eventType: 'thinking', content: b['thinking'] as string });
      } else if (bt === 'tool_use') {
        const name = (b['name'] ?? 'unknown') as string;
        const input = b['input'];
        const summary = summarizeToolInput(name, input);
        const toolUseId = typeof b['id'] === 'string' ? (b['id'] as string) : undefined;
        events.push({ ...makeBase(), ...nest, eventType: 'tool_use', content: summary, toolName: name, toolUseId });
      }
    }
    return events;
  }

  // §4 — partial 모드의 델타 조각. 두 형태: ① 최상위 `content_block_delta` ② `stream_event` 로 감싼 것(`--include-partial-messages`).
  if (partial && (type === 'content_block_delta' || type === 'stream_event')) {
    const inner = type === 'stream_event'
      ? (obj['event'] as Record<string, unknown> | undefined)
      : obj;
    if (!inner || inner['type'] !== 'content_block_delta') return [];
    const delta = inner['delta'] as Record<string, unknown> | undefined;
    if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
      return [{ ...makeBase(), eventType: 'text', content: delta['text'] as string }];
    }
    if (delta?.['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
      return [{ ...makeBase(), eventType: 'thinking', content: delta['thinking'] as string }];
    }
    return [];
  }
  // partial 이 아니면 (또는 다른 stream_event 서브타입) 토큰 델타는 무시 — 완성 메시지만 렌더.
  if (type === 'content_block_delta' || type === 'stream_event') return [];

  // 도구 사용 (stream-json의 최상위 tool_use — 드물지만 호환)
  if (type === 'tool_use') {
    const tool = obj['tool'] as Record<string, unknown> | undefined;
    const name = (tool?.['name'] ?? obj['name'] ?? 'unknown') as string;
    const input = tool?.['input'] ?? obj['input'];
    const summary = summarizeToolInput(name, input);
    return [{ ...makeBase(), eventType: 'tool_use', content: summary, toolName: name }];
  }

  // 도구 결과 — user 메시지(content 배열) 또는 최상위 tool_result 모두 커버
  if (type === 'user') {
    // §4 (스트림 ②) — `--replay-user-messages` 접수 확인(`isReplay:true`) — 본문은 이미 그린 명령이라 칩 한 줄만.
    if (obj['isReplay'] === true) {
      return [{ ...makeBase(), eventType: 'system', content: formatSystemChip('command_received') }];
    }
    const msg = obj['message'] as Record<string, unknown> | undefined;
    const content = msg?.['content'];
    if (!Array.isArray(content)) return [];
    const nestedUnder = typeof obj['parent_tool_use_id'] === 'string' ? (obj['parent_tool_use_id'] as string) : undefined;
    const nest = nestedUnder ? { nestedUnderToolUseId: nestedUnder } : {};
    const events: SubAgentStreamEvent[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b['type'] === 'tool_result') {
        const bc = b['content'];
        const text = typeof bc === 'string'
          ? bc.slice(0, 500)
          : (Array.isArray(bc) ? JSON.stringify(bc).slice(0, 500) : '');
        // §5.5 #17-27 ⑪ — 결과에 `toolUseId` 를 싣는다 — 없으면 클라가 FIFO 로 짐작해, 결과가 안 오는 호출 하나에 뒤가 밀려 직전 파일을 따라간다.
        const forId = typeof b['tool_use_id'] === 'string' ? (b['tool_use_id'] as string) : undefined;
        events.push({ ...makeBase(), ...nest, eventType: 'tool_result', content: text, toolUseId: forId });
      }
    }
    return events;
  }
  if (type === 'tool_result') {
    const result = obj['tool_result'] as Record<string, unknown> | undefined;
    const content = result?.['content'];
    const text = typeof content === 'string'
      ? content.slice(0, 500)
      : (Array.isArray(content) ? JSON.stringify(content).slice(0, 500) : '');
    const name = (result?.['name'] ?? '') as string;
    // 최상위 형태도 같은 규약 — `tool_use_id` 는 결과 안쪽에도, 라인 최상위에도 올 수 있다.
    const rawId = result?.['tool_use_id'] ?? obj['tool_use_id'];
    const forId = typeof rawId === 'string' ? rawId : undefined;
    return [{ ...makeBase(), eventType: 'tool_result', content: text, toolName: name || undefined, toolUseId: forId }];
  }

  // 시스템 메시지 — 세션 메타(hook_started/hook_response/init)·notification(index.ts 가 처리)·turn_duration(내부 신호)은 버린다.
  // 나머지 subtype 은 `[subtype]` 으로 보낸다(SystemNode).
  if (type === 'system') {
    const subtype = obj['subtype'] as string | undefined;
    // §4 (CLI 사양 추종) — 훅 줄은 **기본 소음**이지만 `--include-hook-events` 로 일부러 켠 세션에서는
    //   그게 곧 사용자가 보려던 것이다. 켠 세션에서만 소음 목록에서 빼고, 아래에서 훅 payload 칩으로
    //   세운다. 나머지 넷(`init`·`notification`·`turn_duration`)은 종전 그대로 항상 버린다.
    const noisy = new Set(['init', 'notification', 'turn_duration']);
    if (!opts.hookEvents) {
      for (const s of HOOK_STREAM_SUBTYPES) noisy.add(s);
    }
    if (subtype && noisy.has(subtype)) return [];
    if (subtype && opts.hookEvents && isHookStreamSubtype(subtype)) {
      const info = readHookChipInfo(obj);
      return info ? [{ ...makeBase(), eventType: 'system', content: formatSystemChip(subtype, info) }] : [];
    }    // §5.5 #17-13 ⑤-3 (A) — CLI 가 직접 "인라인 대화록에서는 숨기라"고 표시한 살림성 작업
    //   (`skip_transcript` 필드 설명: "Ambient/housekeeping task. Consumers should hide this from
    //   the inline transcript; it may still appear in a tasks panel."). 우리 스트림이 곧 그 대화록이므로
    //   이벤트 자체를 만들지 않는다 — 버퍼·디스크·복원 예산에서 함께 빠진다.
    if (obj['skip_transcript'] === true) return [];
    // §5.5 #17-13 ⑤-3 (B) — 작업 칩은 payload 를 실어 보낸다(클라가 task_id 로 시작·끝을 한 줄로 접는다).
    const content = subtype ? formatSystemChip(subtype, readTaskInfo(subtype, obj)) : 'system';
    return [{ ...makeBase(), eventType: 'system', content }];
  }

  // §4 (스트림 ③) — `--prompt-suggestions` 예측. ⚠ probe 에서 실제 메시지가 안 와 모양을 모른다 — 흔한 이름을 훑고 없으면 만들지 않는다.
  if (type === 'prompt_suggestion') {
    for (const key of ['suggestion', 'prompt', 'text', 'content']) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) {
        const base = makeBase();
        // 제안 글은 칩 payload 의 `summary` 자리에 싣는다 — 이미 있는 그릇을 쓰면 클라가
        //   자르기·복원 예산을 종전 규칙 그대로 적용한다(새 렌더 경로를 만들지 않는다).
        //   `id` 는 이벤트 id — 제안끼리 시작·끝으로 잘못 묶이지 않게 매번 다르게 둔다.
        return [{ ...base, eventType: 'system', content: formatSystemChip('prompt_suggestion', { id: base.id, summary: v }) }];
      }
    }
    return [];
  }

  // 최종 결과 — UI에 다시 그리지 않는다(assistant text가 동일 본문을 이미 스트리밍으로 렌더).
  // cmd.result / sub.lastResult 저장은 child.close에서 stdout을 직접 파싱하므로 영향 없음.
  if (type === 'result') {
    return [];
  }

  return [];
}

/** 소유 탭 미상 항목의 절대 상한 — 누수 방지일 뿐 조용함으로 끝을 추정하지 않는다. 소유 탭을 아는 항목은 프로세스 소멸로만 걷힌다. */
const PENDING_SUBAGENT_MAX_AGE_MS = 4 * 60 * 60 * 1000;
/** §5.5 #17-9 ⑦(b) — 부모별로 남겨 두는 "방금 끝난 자식" 수. 목록이 아니라 **꼬리**라서 짧게 둔다. */
const MAX_FINISHED_SUBAGENT_TASKS = 5;

/** §5.3 #12-1 / §5.5 #17-9 ⑦ — 대차대조 항목 1건. `ts`(시작 시각)만 판정에 쓰이고 나머지는 표시 전용. */
interface PendingSubagentEntry {
  ts: number;
  subId?: string;
  description?: string;
  subagentType?: string;
  prompt?: string;
  /** §5.5 #17-9 ⑧ — `run_in_background` 자식인가. 배경 스폰의 `PostToolUse` 는 접수증이라 ⑦(b) 폴백을 태우면 곧바로 내려간다 — `SubagentStop` 으로만 내린다. */
  background?: boolean;
  /** ⑦(a) 자식 훅의 `agent_id` — 한 번 각인되면 이후 그 자식의 활동은 이 키로 곧장 찾는다. */
  agentId?: string;
  agentType?: string;
  currentTool?: string;
  currentToolDetail?: string;
  toolCount?: number;
  lastActivityAt?: number;
}

/** 조건에 맞는 항목 중 가장 오래된 것. ⑦(a) 의 자식 매칭 2·3단계가 함께 쓴다. */
function oldestOf(
  m: Map<string, PendingSubagentEntry>,
  match: (e: PendingSubagentEntry) => boolean,
): PendingSubagentEntry | undefined {
  let best: PendingSubagentEntry | undefined;
  for (const e of m.values()) {
    if (!match(e)) continue;
    if (!best || e.ts < best.ts) best = e;
  }
  return best;
}

/** `oldestOf` 의 열쇠판 — 항목을 **내리려면** 값이 아니라 열쇠가 필요하다(§5.5 #17-9 ⑪). */
function oldestKeyOf(
  m: Map<string, PendingSubagentEntry>,
  match: (e: PendingSubagentEntry) => boolean,
): string | undefined {
  let bestKey: string | undefined;
  let bestTs = Infinity;
  for (const [k, e] of m) {
    if (!match(e)) continue;
    if (e.ts < bestTs) { bestTs = e.ts; bestKey = k; }
  }
  return bestKey;
}

export class SubAgentManager {
  /** agentId → SubAgent[] */
  private registry = new Map<string, SubAgent[]>();
  /** subagentId → SubAgent 빠른 조회 */
  private index = new Map<string, SubAgent>();
  /** agentId → archived SubAgent[] (탭 닫힌 이력) — 폴더 버튼 "다시 열기" 목록 소스.
   *  자식 프로세스는 kill, 레지스트리/index에서는 제거되지만 메타는 여기에 보존.
   *  disk stream buffer도 유지되어 restore 시 원 파일에서 다시 로드됨. */
  private archive = new Map<string, SubAgent[]>();
  /** 완료 콜백 (서버에서 broadcast 등 연결용) */
  private onComplete: (() => void) | null = null;
  /** 스트림 이벤트 콜백 */
  private onStreamEvent: ((event: SubAgentStreamEvent) => void) | null = null;
  /** sub.status 가 변하면 부모 에이전트 ID 와 함께 호출 — 커스텀 부모 버블의 active/completed 갱신용 */
  private onSubStatusChange: ((parentAgentId: string) => void) | null = null;
  /**
   * §5.1 #2-1 (B) — 사용자 명령이 **처음 나가는** 순간(부모 에이전트 ID · 그 순간 같은 에이전트에 이미 처리 중인 턴이 있었나).
   * 묶음 버블의 이번 턴 장부가 여기서 열린다. 이 매니저는 그래프를 모르므로 index.ts 가 주입한다.
   */
  private onCommandStart: ((parentAgentId: string, busy: boolean) => void) | null = null;
  /**
   * §5.3 #10-2 — 이 세션이 띄우고 **아직 받지 못한** 위임 결과(cmdId·상태). 장부는 index.ts 가 쥐어 주입한다.
   * 턴이 완료로 끝나려는 자리마다 묻는다 — 결과를 받지 못한 턴을 완료로 적지 않기 위해서다.
   */
  private pendingDispatchResults: ((subAgentId: string) => Parameters<typeof formatUndeliveredDispatchJobs>[0]) | null = null;
  /** agent-view 매핑을 spawn 직후 무조건 저장하는 훅 — `onSubStatusChange` 는 상태가 그대로면 저장을 건너뛰어, 그 사이 크래시면 reattach 할 수 없다. */
  private onPersistNeeded: (() => void) | null = null;
  /** subagentId → 최근 스트림 이벤트 버퍼 (late-join용) */
  private streamBuffers = new Map<string, SubAgentStreamEvent[]>();
  /** 조회·출력·회수 검증 시계. WeakMap이라 버퍼가 없어지면 시계도 함께 회수된다. */
  private streamBufferAccessAt = new WeakMap<SubAgentStreamEvent[], number>();
  /**
   * sub → 마지막으로 읽은 파일 지문(`streamBufferStore`). 그대로면 `stat` 한 번으로 끝낸다.
   * ⚠ 버퍼를 버리는 곳(`sweepIdle`·제거·`restore`)에서 지문도 지운다 — 안 지우면 "변화 없음"으로 디스크 과거를 못 읽는다. 폴더가 바뀌면 지문은 무효(`dir`).
   */
  private streamDiskStamps = new Map<string, { dir: string; stamp: string | null }>();

  /** 지난번 그 폴더에서 읽은 지문. 폴더가 다르면 `undefined`(= 읽은 적 없음)로 친다. */
  private prevStreamStamp(subAgentId: string, dir: string): string | null | undefined {
    const prev = this.streamDiskStamps.get(subAgentId);
    return prev && prev.dir === dir ? prev.stamp : undefined;
  }
  /** subagentId → 실행 중인 자식 프로세스 (탭 닫기 시 종료용) */
  private runningChildren = new Map<string, ChildProcess>();
  /** §5.5 #17-9 ⑭ — 항목별 판정 상태(`<subId>::<taskId>`). `thresholdMult` 지수 백오프 — 긴 정당한 대기가 판정을 계속 태우지 않게. */
  private probeStates = new Map<string, { result?: BackgroundTaskProbeResult; thresholdMult: number }>();
  /** 지금 판정이 도는 항목들 — 같은 항목을 두 번 띄우지 않고, 화면에 "확인 중"을 세운다. */
  private probesInFlight = new Set<string>();
  /** 최근 판정 시각들(시간당 상한 계산용). 한 시간 넘은 것은 버린다. */
  private probeHistory: number[] = [];

  // ─── §2.4 세션 생존 판정 ("실행중…"이 진짜인가) ───
  //   위 백그라운드 판정과 **같은 예산 구조**를 쓴다(동시 1건 · 시간당 상한 · 지수 백오프).
  //   축을 나눠 두는 이유는 하나가 예산을 다 먹으면 다른 하나가 영영 못 묻기 때문이다.
  private sessionProbeSettings: SessionLivenessProbeSettings = DEFAULT_SESSION_PROBE_SETTINGS;
  private sessionProbeStates = new Map<string, { result?: SessionLivenessProbeResult; thresholdMult: number }>();
  private sessionProbesInFlight = new Set<string>();
  private sessionProbeHistory: number[] = [];
  /** 사용자 설정(머신 단위). 부팅 때 `AppState` 에서 주입되고, 없으면 기본값. */
  private bgTaskProbeSettings: BackgroundTaskProbeSettings = DEFAULT_BG_TASK_PROBE_SETTINGS;
  /** §5.3 — sub.id → 이번 스폰의 env(중첩 깊이 · 기억 끄기). spawn 때만 필요해 조립과 사용 자리가 떨어져 있다. */
  private pendingConfigEnv = new Map<string, Record<string, string>>();
  /**
   * §4 API 크레딧 — `execute` 가 이 턴을 크레딧 경로로 정했다(자식은 아직 안 섰다). legacy 경로가 이 표식을 보고
   * 매 턴 `--print` 새 스폰으로 가고, 스폰 자리가 크레딧 실행을 연다(`creditRuns`). 큐로 되돌려진 턴은 다음 `execute`
   * 가 다시 정한다.
   */
  private pendingCreditRoute = new Map<string, { cmdId: string }>();
  /** §4 API 크레딧 — 지금 크레딧으로 도는 자식(sub → 크레딧 실행 id + 그 자식). 다른 자식의 줄은 보지 않는다. */
  private creditRuns = new Map<string, { runId: string; child: ChildProcess }>();
  /**
   * §4 API 크레딧 — 기능이 켜진 채 **구독 경로**로 나가는 스폰. env 에서 `ANTHROPIC_API_KEY` 를 걷는다 — 경로는
   * 앱이 정하므로, 셸·secrets.json 에 남은 키가 몰래 크레딧을 쓰지 않게(키가 구독 로그인보다 우선이다).
   */
  private stripCreditKeyEnv = new Set<string>();
  /** §5.7 #23-2 — sub → 진행 중인 agent-view watcher(legacy `runningChildren` 의 짝). cancel/remove 때 `claude stop` + `detachWatcher`. */
  private runningAgentViewWatchers = new Map<string, { short: string; sessionId: string }>();
  /** 사용자가 stop() 호출로 명시 중지한 subagentId — close 핸들러에서 '유저 중지' vs '에러' 를 구분해
   *  cmd.result 를 `[Stopped by user]` 로 채우고 sub.status 를 idle 로 복귀시키기 위함. */
  private stoppedByUser = new Set<string>();
  /**
   * §5.3 #12-1 — 백그라운드 서브에이전트 대차대조: parent → (Task tool_use_id → 항목). PreToolUse(Task|Agent) ↑ / SubagentStop ↓.
   * 비어 있지 않은 동안 부모 버블을 completed/idle 로 내리지 않는다. 런타임 전용. 항목의 메타·자식 도구 정보(⑦(a))는 표시 전용.
   */
  private pendingSubagentTasks = new Map<string, Map<string, PendingSubagentEntry>>();
  /** §5.5 #17-9 ⑦(b) — 방금 끝난 자식(부모별 최근 `MAX_FINISHED_SUBAGENT_TASKS` 건, 새 것이 앞).
   *  결과(`PostToolUse(Task|Agent)` 의 `tool_response`)는 `SubagentStop` 보다 늦게 오므로 **여기 있는
   *  항목에 나중에 붙는다**. 런타임 전용 — 영속화 ❌. */
  private finishedSubagentTasks = new Map<string, FinishedSubagentTask[]>();
  /** parentAgentId → 마지막 훅 신호 시각 — 위 대차대조의 quiet-window 누수 안전장치 기준. */
  private pendingSubagentLastSignal = new Map<string, number>();
  /** §5.3 #12-1 — 위 대차대조 때문에 `active` 로 올려둔 sub 들(= 자기 턴은 끝났지만 자식이 백단에서
   *  도는 세션 탭). pending 이 비면 여기 있는 것만 idle 로 되돌린다 — 진짜 명령을 처리 중이라
   *  active 인 sub 를 잘못 강등하지 않기 위한 소유권 표식. */
  private bgPromotedSubs = new Set<string>();
  /** §5.5 #17-9 ⑰ — 셸만 남아 상태를 **안 올린** 사실을 한 번 남긴 sub 들(로그 중복 방지 전용).
   *  조용한 건너뜀 ❌ — CLI 가 `subagent_type` 을 언젠가 빼면 이 로그가 유일한 단서가 된다. */
  private shellOnlyLogged = new Set<string>();
  /** §5.5 #17-9 ⑰ — 명령 원문을 못 찾아 조사에서 뺀 항목(로그 중복 방지 전용). */
  private probeCommandMissLogged = new Set<string>();
  /** tool_use_id 미상 페이로드용 합성 키 시퀀스. */
  private pendingSubagentAnonSeq = 0;
  /** Persistent child — 자식이 turn 사이 idle(다음 stdin write 대기) 인가. true 면 reuse 가능.
   *  result 라인 도착 시 true, 새 stdin write 직전 false. */
  private persistentChildReady = new Map<string, boolean>();
  /** §4 (모델 칸 ④) — 지속 자식이 뜰 때의 모델 축 인자 지문. 재사용은 인자를 다시 싣지 않으므로 지문이 달라지면 자식을 갈아 끼운다. `SESSION_KEYED_MAP_MAX` 캡. */
  private persistentSpawnModelKey = new Map<string, string>();
  /** Stable connection definition; run ids and credentials never enter this key. */
  private persistentSpawnVerificationKey = new Map<string, string>();
  /** §4 — 자식이 `--include-hook-events` 로 떴는가(파서는 훅 줄을 기본으로 버린다 — 라인 처리기가 설정을 모르므로 스폰 때 적어 둔다). `SESSION_KEYED_MAP_MAX` 캡. */
  private streamHookEventsOn = new Map<string, boolean>();  /** Persistent child — 의도적 종료 마킹(stop/remove/shutdownAll). close 핸들러에서 crash 와 구분하기 위함.
   *  마킹 없이 close 되면 crash 경로로 sub.sessionId 보존(다음 execute 가 --resume 으로 복구). */
  private intentionalKill = new Set<string>();
  /** Persistent child — 턴 사이에 살아남는 stdout line buffer. fresh spawn 에선 매번 새로 만들지만
   *  persistent child 는 같은 stdout 스트림이 여러 턴을 흘리므로 map 으로 보존. */
  private persistentLineBuf = new Map<string, string>();
  /** Persistent child — 현재 진행 중인 turn 의 cmd/turnCount/resultText/killed/maxTurns/parentCwd.
   *  fresh spawn 또는 reuse 시점에 새 값으로 set, result 라인 도착 시 delete. */
  private persistentInFlightCmd = new Map<string, PersistentInFlight>();
  /**
   * §5.19 (D) — 로컬(All Model) 턴의 in-flight 표식. 자식·워처가 없어 이게 없으면 생존 대조가 도는 세션을 idle 로 내려 버블이 5초마다 완료 ↔ 동작을 오간다.
   * 러너의 `isLocalTurnRunning` 을 쓰지 않는다 — `finally` 정리가 `onDone` 뒤라 `finish()` 의 재계산이 완료를 건너뛴다. `finish()` 맨 앞에서 지운다.
   */
  private localInFlightCmd = new Map<string, QueuedCommand>();
  /**
   * §5.5 #17-12 ③-6 — 턴 동안 읽은 **끝 신호**(cmdId 별). 모델이 적어 보내는 끝 사유(assistant 줄
   * `message.stop_reason`)는 턴 중간에 오고 봉인은 그 뒤라, 그 사이를 들고 있는 장부다. 봉인 때 지운다.
   */
  private turnStopSignals = new Map<string, TurnStopSignal>();
  /** §5.5 #17-12 ③ — 자식 stderr 의 **마지막 꼬리**(sub 별). 종료 코드만으론 "왜 죽었는지"를
   *  말할 수 없어, 실패로 끝났을 때 사유로 실어 보낸다. 성공 경로에서는 쓰지 않고 spawn 마다 리셋. */
  private childStderrTails = new Map<string, string>();
  /** 부모 에이전트 → 프로젝트 해석 콜백 (영속화 경로 계산용) */
  private projectResolver: AgentProjectResolver | null = null;
  /** 소속 해석이 실패했을 때 훑을 프로젝트 후보(`findStreamDirFor` ③). 없으면 그 그물만 안 쓴다. */
  private allProjectsProvider: AllProjectsProvider | null = null;
  /** §5.3 #12-1-B — 로컬 도구 판정이 읽는 지금 설정. 없으면 턴 시작 때 받은 설정으로 판정한다(종전 동작). */
  private agentConfigResolver: AgentConfigResolver | null = null;
  /** §5.3 #12-3 — 로컬 도구 판정이 보는 자물쇠. 없으면 자물쇠를 보지 않는다(주입 전 단위 테스트 등). */
  private pathLockResolver: PathLockResolver | null = null;
  /** §5.3 #12-4 — 로컬 도구 판정이 부르는 검증 판정. 없으면 검증 판정을 하지 않는다(주입 전 단위 테스트 등). */
  private verificationChecker: VerificationCallChecker | null = null;
  /** sub → 스트림을 마지막으로 읽은 폴더(`findStreamDirFor` ②). `streamDiskStamps` 와 달리 회수·탭 닫기에서 지우지 않는다 — 소속을 잃었을 때의 실마리다. */
  private lastKnownStreamDirs = new Map<string, string>();
  /** 부모 → sub-streams 폴더를 마지막으로 짚은 자리. 같은 부모는 한 폴더라 파일이 아직 없는 새 세션도 소속 해석이 끊긴 동안 여기로 쓴다. 지우지 않는다. */
  private lastKnownAgentStreamDirs = new Map<string, string>();
  /** 과거를 못 이어붙인 채 시작된 버퍼 — 그 세션의 전부가 아니므로 읽기 경로가 믿고 돌려주면 클라의 긴 대화를 갈아엎는다. */
  private partialStreamBuffers = new Set<string>();
  /** 쓰기 폴더 훑기(`findStreamDirFor` ③)가 마지막으로 헛친 시각 — 줄마다 다시 훑지 않게 잠깐 쉰다. */
  private streamWriteDirMissAt = new Map<string, number>();
  /** §5.19 (H) — 호스트 도구 처리기. 없으면 그 도구들은 "이 세션에서는 못 쓴다"고 답한다. */
  private localHostToolHandler: LocalHostToolHandler | null = null;
  /** §5.19 (H) — 도구 이벤트를 훅으로 흘리는 곳. 없으면 아무 데도 안 간다(종전 동작). */
  private localHookEmitter: LocalHookEmitter | null = null;
  /**
   * §5.25 (F) "쓴 내용도 남는다" — 앱 소유 사전 훅이 허락한 `apply_patch` 의 바뀐 덩어리(sub × 파일).
   * 그 파일의 `file_change` 완료가 꺼내 가고, 그 sub 의 턴이 시작될 때 비워진다.
   */
  private readonly codexPatchEdits = new CodexPatchEditLedger();
  /** 턴 봉인 대차대조(sub 별) — CLI 백그라운드 작업의 시작/끝 셈. `turnSeal.ts` 참조. */
  private turnSealStates = new Map<string, TurnSealState>();
  /** 잠정 종료로 붙들어 둔 봉인(sub 별). 타이머가 끝나거나 다른 마감 경로가 오면 사라진다. */
  private deferredSeals = new Map<string, {
    timer: ReturnType<typeof setTimeout>;
    seal: () => void;
    /** 턴이 이어져 봉인을 취소할 때만 부른다 — 종료 감지를 되살리는 경로(agent-view watcher)용. */
    onResume?: () => void;
  }>();
  /**
   * §5.5 #17-9 ⑱ — **끝 통지로 곧 다시 돌 쉬는 세션**(sub 별 만료 타이머).
   * 여기 있는 탭은 `syncBgSubStatus` 가 대기 항목이 있는 탭과 똑같이 세어 내리지 않는다. 되살아난 턴의
   * 첫 모델 줄이 풀고(`releaseNoticeResumeHold`), 안 오면 `NOTICE_RESUME_WINDOW_MS` 뒤에 스스로 풀린다.
   */
  private noticeResumeHolds = new Map<string, ReturnType<typeof setTimeout>>();

  /** PTY(CMD) 세션 — 우리 자식이 아니라 장부 어디에도 없으므로 생존 대조가 죽었다고 내리지 않게 표식(`markCmdSubActivity` 가 붙인다). */
  private cmdDrivenSubs = new Set<string>();

  /** §4 (CMD ① QA) — pane 별 마지막 감지 상태 — pane 감지기들이 같은 sub 를 서로 덮어쓰지 않게. 런타임 전용. */
  private cmdPaneStates = new Map<string, Map<string, { state: CmdTerminalState; reason?: string }>>();

  /**
   * **스폰이 진행 중인 sub.** `execute` 가 `sub.status='active'` 를 올린 뒤 자식/워처가 실제로
   * 등록되기까지 사이가 있다(agent-view 경로는 `await attachWatcher` 라 그 사이가 실제로 벌어진다).
   * 그 창에 생존 대조가 끼어들면 이제 막 뜨는 세션을 죽은 것으로 오해한다.
   */
  private dispatchingSubs = new Set<string>();

  /** §5.5 #17-2 — 슬래시 턴이 미룬 브리핑. 첫 턴이 슬래시면 원문만 나가야 하므로 `contextSummary` 를 다음 비슬래시 턴에 싣는다(안 그러면 영영 못 받는다). */
  private contextSummaryPending = new Set<string>();

  /** 스폰 진행 표식 해제 — 자식/워처 등록 시점과 모든 실패 경로가 부른다. */
  private clearDispatching(subId: string): void {
    this.dispatchingSubs.delete(subId);
  }

  /** 턴 세대 도장 — 도는 명령 id 를 스트림 줄마다 찍어 클라가 시각이 아니라 턴으로 블록을 고른다. 마감 뒤 늦은 줄은 시작한 턴을 `liveTasks` 에서 되찾는다. */
  private currentTurnId = new Map<string, string>();

  /**
   * §5.3 #9-1 (P) — 우리가 끼운 조용한 명령(선행 `/compact`)의 턴 id — 이 줄은 버퍼·디스크·화면에 남기지 않는다(스트림은 세션 단위라 명령만 감추면 줄이 섞인다).
   * 지우지 않는다 — turnId 는 되쓰이지 않고, 지우는 자리를 흩으면 샌다. §3.2.4 F′축 상한만.
   */
  private silentTurnIds = new Set<string>();

  setOnComplete(cb: () => void): void {
    this.onComplete = cb;
  }

  setOnStreamEvent(cb: (event: SubAgentStreamEvent) => void): void {
    this.onStreamEvent = cb;
  }

  setOnSubStatusChange(cb: (parentAgentId: string) => void): void {
    this.onSubStatusChange = cb;
  }

  setOnCommandStart(cb: (parentAgentId: string, busy: boolean) => void): void {
    this.onCommandStart = cb;
  }

  setPendingDispatchResultsProvider(cb: (subAgentId: string) => Parameters<typeof formatUndeliveredDispatchJobs>[0]): void {
    this.pendingDispatchResults = cb;
  }

  setOnPersistNeeded(cb: () => void): void {
    this.onPersistNeeded = cb;
  }

  /**
   * §5.19 (H) — 로컬 세션의 **호스트 도구** 처리기(목표·질문 카드·계획 종료). 이 매니저는
   * 그래프도 목표 저장소도 모르므로 `index.ts` 가 주입한다 — `setProjectResolver` 와 같은 방식.
   */
  /** §5.19 (H) — 로컬 도구 이벤트를 훅 경로에 이어 준다(캔버스 파일 노드·감사 원장·포트 감지). */
  setLocalHookEmitter(emitter: LocalHookEmitter): void {
    this.localHookEmitter = emitter;
  }

  /**
   * §5.25 (F) "쓴 내용도 남는다" — 앱 소유 코덱스 사전 훅(`PreToolUse`)이 **허락한** `apply_patch` 를 적어 둔다.
   * 패치는 이 답을 받은 뒤에야 적용되므로 적기가 늘 완료(`file_change`)보다 앞선다. 모르는 sub 면 적지 않는다.
   * 적은 파일 수를 돌려준다.
   */
  noteCodexPatch(subAgentId: string, note: CodexPatchNote): number {
    if (!this.index.has(subAgentId)) return 0;
    return this.codexPatchEdits.note(subAgentId, note);
  }

  setLocalHostToolHandler(handler: LocalHostToolHandler): void {
    this.localHostToolHandler = handler;
  }

  setProjectResolver(resolver: AgentProjectResolver): void {
    this.projectResolver = resolver;
  }

  setAgentConfigResolver(resolver: AgentConfigResolver): void {
    this.agentConfigResolver = resolver;
  }

  setPathLockResolver(resolver: PathLockResolver): void {
    this.pathLockResolver = resolver;
  }

  setVerificationChecker(checker: VerificationCallChecker): void {
    this.verificationChecker = checker;
  }

  /** 소속을 잃은 세션의 스트림 폴더를 되찾을 때 훑을 후보 목록(§5.5 — 아래 `findStreamDirFor`). */
  setAllProjectsProvider(provider: AllProjectsProvider): void {
    this.allProjectsProvider = provider;
  }

  /** 부모 에이전트의 sub-streams 디렉토리 해석. 프로젝트 미확정이면 null. */
  private resolveStreamDir(parentAgentId: string): string | null {
    const info = this.projectResolver?.(parentAgentId);
    if (!info) return null;
    const dir = streamBufferStore.subStreamsDir(info, parentAgentId);
    this.lastKnownAgentStreamDirs.set(parentAgentId, dir);
    return dir;
  }

  /**
   * §5.5 #17-12 — 스트림을 쓸 폴더 — 소속 해석이 끊겨도 쓰기를 건너뛰지 않는다(건너뛴 구간은 회수·재시작 뒤 빈다).
   * 순서: ① 소속 해석 ② 마지막으로 쓴 폴더 ③ 전체 훑기(헛치면 쉰다).
   */
  private resolveStreamWriteDir(subAgentId: string, parentAgentId: string): string | null {
    const direct = this.resolveStreamDir(parentAgentId);
    if (direct) {
      this.lastKnownStreamDirs.set(subAgentId, direct);
      return direct;
    }
    const remembered = this.lastKnownStreamDirs.get(subAgentId) ?? this.lastKnownAgentStreamDirs.get(parentAgentId);
    if (remembered) return remembered;
    const now = Date.now();
    const missAt = this.streamWriteDirMissAt.get(subAgentId);
    if (missAt !== undefined && now - missAt < STREAM_WRITE_DIR_RETRY_MS) return null;
    const found = this.findStreamDirFor(subAgentId, parentAgentId);
    if (found) {
      this.streamWriteDirMissAt.delete(subAgentId);
      return found;
    }
    this.streamWriteDirMissAt.set(subAgentId, now);
    return null;
  }

  /** 과거 없이 시작된 버퍼를 폴더를 되찾은 지금 메운다 — 디스크 꼬리 뒤에 메모리에만 있던 줄을 잇고 디스크에도 적는다. */
  private healPartialStreamBuffer(subAgentId: string, dir: string): SubAgentStreamEvent[] {
    const mem = this.streamBuffers.get(subAgentId) ?? [];
    const r = streamBufferStore.loadBufferIfChanged(dir, subAgentId, MAX_STREAM_BUFFER, undefined);
    const onDisk = new Set(r.events.map((e) => e.id));
    const memoryOnly = mem.filter((e) => !onDisk.has(e.id));
    for (const e of memoryOnly) streamBufferStore.appendEvent(dir, e);
    const merged = [...r.events, ...memoryOnly];
    if (merged.length > MAX_STREAM_BUFFER) merged.splice(0, merged.length - MAX_STREAM_BUFFER);
    this.streamBuffers.set(subAgentId, merged);
    // 방금 줄을 덧붙였으므로 지문은 비워 둔다 — 다음 읽기가 "변화 없음"으로 옛 지문에 막히지 않게.
    this.streamDiskStamps.delete(subAgentId);
    this.partialStreamBuffers.delete(subAgentId);
    this.lastKnownStreamDirs.set(subAgentId, dir);
    return merged;
  }

  /**
   * 스트림이 실제로 놓인 폴더 — 소속 해석이 `null` 이어도 포기하지 않는다(빈 배열이 나가면 화면이 말풍선만 남아 굳는다).
   * 순서: ① 소속 해석 ② `lastKnownStreamDirs` ③ 모든 프로젝트를 `hasBuffer` 로 훑고 찾으면 ② 에 적는다.
   */
  private findStreamDirFor(subAgentId: string, parentAgentId: string): string | null {
    const direct = this.resolveStreamDir(parentAgentId);
    if (direct) {
      this.lastKnownStreamDirs.set(subAgentId, direct);
      return direct;
    }
    const remembered = this.lastKnownStreamDirs.get(subAgentId);
    if (remembered) return remembered;
    // ②-b 그 부모가 마지막으로 쓰던 폴더 — 폴더는 부모 단위라 이 세션 파일이 거기 실재하면 그 자리다.
    const agentDir = this.lastKnownAgentStreamDirs.get(parentAgentId);
    if (agentDir && streamBufferStore.hasBuffer(agentDir, subAgentId)) {
      this.lastKnownStreamDirs.set(subAgentId, agentDir);
      return agentDir;
    }
    for (const info of this.allProjectsProvider?.() ?? []) {
      const dir = streamBufferStore.subStreamsDir(info, parentAgentId);
      if (!streamBufferStore.hasBuffer(dir, subAgentId)) continue;
      this.lastKnownStreamDirs.set(subAgentId, dir);
      return dir;
    }
    return null;
  }

  /** 부모의 sub-streams 파일 통째 삭제 — **휴지통 영구 삭제 전용.** 탭 닫기·idle 회수·lifecycle 제거는 디스크에서 다시 읽는 경로라 여기 배선하면 안 된다. */
  purgeAgentStreams(parentAgentId: string): void {
    const dir = this.resolveStreamDir(parentAgentId);
    if (!dir) return;
    streamBufferStore.deleteAgentStreams(dir);
  }

  /**
   * 한 sub 의 스트림(REST) — 빈 배열은 화면 과거를 지우므로 쉽게 포기하지 않는다.
   * 복원 직후 `index` 에 sub 가 없으면 `parentAgentIdHint` 로 폴더를 정하고, 폴더는 `findStreamDirFor` 로 짚는다.
   */
  getStreamBuffer(subAgentId: string, parentAgentIdHint?: string): SubAgentStreamEvent[] {
    const events = this.readStreamBuffer(subAgentId, parentAgentIdHint);
    this.streamBufferAccessAt.set(events, Date.now());
    return events;
  }

  private readStreamBuffer(subAgentId: string, parentAgentIdHint?: string): SubAgentStreamEvent[] {
    const buf = this.streamBuffers.get(subAgentId);
    const partial = this.partialStreamBuffers.has(subAgentId);
    if (buf && buf.length > 0 && !partial) return buf;
    // idle 회수(sweepIdle)로 메모리에서 비워졌으면 디스크에서 복구 + 재캐시.
    const sub = this.index.get(subAgentId);
    const parentAgentId = sub?.parentAgentId ?? parentAgentIdHint;
    const dir = parentAgentId ? this.findStreamDirFor(subAgentId, parentAgentId) : null;
    // 과거를 못 이어붙인 버퍼는 폴더를 되찾는 즉시 디스크로 메운다. 못 찾았으면 **빈 배열**을 준다 —
    //   몇 줄짜리 버퍼를 "그 세션의 전부"로 내보내면 클라가 들고 있던 긴 대화를 그것으로 갈아엎는다
    //   (빈 응답은 클라가 버퍼를 교체하지 않고 다시 묻는다).
    if (partial) return dir ? this.healPartialStreamBuffer(subAgentId, dir) : [];
    if (dir) {
      // 메모리에 아무것도 없으면(`buf === undefined`) 지문을 믿지 않고 무조건 읽는다 — 회수됐거나
      // 아직 한 번도 안 읽은 것이라, 여기서 건너뛰면 디스크의 과거가 화면에 못 올라온다.
      const prev = buf === undefined ? undefined : this.prevStreamStamp(subAgentId, dir);
      const r = streamBufferStore.loadBufferIfChanged(dir, subAgentId, MAX_STREAM_BUFFER, prev);
      if (!r.changed) return buf ?? [];
      this.streamDiskStamps.set(subAgentId, { dir, stamp: r.stamp });
      // 빈 결과도 캐시한다 — 종전엔 `length > 0` 일 때만 담아, 파일이 없거나 빈 세션은
      // 호출마다 파일을 다시 열었다(읽기 폭주의 한 축).
      this.streamBuffers.set(subAgentId, r.events);
      return r.events;
    }
    return buf ?? [];
  }

  /** §5.5 #17-12 — 복원 창 위쪽의 과거 한 쪽(REST `…/older`, 디스크 본 파일 + 보관 파일). 폴더를 못 찾으면 `unresolved` — `hasMore: false` 와 갈라야 클라가 포기하지 않는다. */
  getOlderStreamEvents(
    subAgentId: string,
    parentAgentIdHint: string | undefined,
    cursor: { beforeId?: string; beforeTs?: number },
    limit?: number,
  ): streamBufferStore.OlderEventsPage & { unresolved?: true } {
    const sub = this.index.get(subAgentId);
    const parentAgentId = sub?.parentAgentId ?? parentAgentIdHint;
    const dir = parentAgentId ? this.findStreamDirFor(subAgentId, parentAgentId) : null;
    if (!dir) return { events: [], hasMore: false, unresolved: true };
    const want = limit !== undefined && Number.isFinite(limit) ? Math.floor(limit) : STREAM_HISTORY_PAGE_EVENTS;
    return streamBufferStore.loadEventsBefore(dir, subAgentId, cursor, Math.min(Math.max(1, want), STREAM_HISTORY_PAGE_MAX));
  }

  /** 에이전트의 전체 subagent 스트림 버퍼 반환 — 세션당 `MAX_STREAM_BUFFER_BULK` 까지(얕게). */
  getStreamBuffersForAgent(agentId: string): Record<string, SubAgentStreamEvent[]> {
    const subs = this.registry.get(agentId) ?? [];
    const result: Record<string, SubAgentStreamEvent[]> = {};
    for (const sub of subs) {
      let buf = this.streamBuffers.get(sub.id);
      // idle 회수로 비운 sub 는 디스크에서 다시 채운다(IDE 재오픈 시 빈 화면 방지). 모든 sub 를 도므로 지문이 그대로면 `stat` 만. 과거 없는 버퍼는 단건 경로와 같은 규칙.
      if (this.partialStreamBuffers.has(sub.id)) {
        const dir = this.findStreamDirFor(sub.id, agentId);
        buf = dir ? this.healPartialStreamBuffer(sub.id, dir) : undefined;
      } else if (!buf || buf.length === 0) {
        const dir = this.findStreamDirFor(sub.id, agentId);
        if (dir) {
          const prev = buf === undefined ? undefined : this.prevStreamStamp(sub.id, dir);
          const r = streamBufferStore.loadBufferIfChanged(dir, sub.id, MAX_STREAM_BUFFER, prev);
          if (r.changed) {
            this.streamDiskStamps.set(sub.id, { dir, stamp: r.stamp });
            this.streamBuffers.set(sub.id, r.events);
            buf = r.events;
          }
        }
      }
      // §5.5 — 여기서는 꼬리만 싣는다(깊은 복원분은 단건 `getStreamBuffer`).
      if (buf) this.streamBufferAccessAt.set(buf, Date.now());
      if (buf && buf.length > 0) {
        result[sub.id] = buf.length > MAX_STREAM_BUFFER_BULK ? buf.slice(buf.length - MAX_STREAM_BUFFER_BULK) : buf;
      }
    }
    return result;
  }

  /** §5.3 #12-1 — 밖에서 합성 system 줄(권한 Allow/Deny)을 끼우는 진입점 — `emitStreamEvent` 를 타서 버퍼·디스크·WS 가 한 벌. */
  emitSystemMessage(parentAgentId: string, subAgentId: string, content: string): void {
    const event: SubAgentStreamEvent = {
      id: `sys-${randomUUID()}`,
      subAgentId,
      parentAgentId,
      timestamp: Date.now(),
      eventType: 'system',
      content,
    };
    this.emitStreamEvent(event);
  }

  /** §5.5 #17-12 ③ — 오류 마감 사유를 `cmd.error`(상태바)와 `error` 스트림 줄 두 곳에 싣는다. 문장은 클라가 만든다 — 여기는 `[code:exitCode@engine] detail`(`@engine` 은 선택). */
  private failCommand(sub: SubAgent, cmd: QueuedCommand, error: CommandError): void {
    const detail = error.detail ? error.detail.trim().slice(-COMMAND_ERROR_DETAIL_LIMIT) : undefined;
    const code = this.usageLimitCodeFor(sub, error.code, detail);
    const engine = error.engine ?? this.engineOf(sub);
    cmd.error = {
      code,
      ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
      ...(detail ? { detail } : {}),
      engine,
    };
    const head = `[${code}${error.exitCode !== undefined ? `:${error.exitCode}` : ''}@${engine}]`;
    this.emitStreamEvent({
      id: makeEventId(),
      subAgentId: sub.id,
      parentAgentId: sub.parentAgentId,
      timestamp: Date.now(),
      eventType: 'error',
      content: detail ? `${head} ${detail}` : head,
    }, { recordActivity: error.code !== 'orphaned' });
    logger.warn(`SubAgent ${sub.id} command failed [${code}@${engine}]${error.exitCode !== undefined ? ` exit=${error.exitCode}` : ''}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }

  /**
   * §5.5 #17-12 ③-7 — 실패를 낸 엔진 — 사유 코드가 엔진 중립이라 없으면 코덱스 실패가 `Claude CLI` 로 불린다.
   * 근거는 `engineForProvider`(§5.25 (C), 모델 이름과 같은 값). 설정 없는 훅 버블은 `claude`.
   */
  private engineOf(sub: SubAgent): AgentEngineKind {
    return engineForProvider(this.agentConfigResolver?.(sub.parentAgentId)?.provider);
  }

  /**
   * §2.4 — 실패로 들어왔어도 원인이 한도면 사유를 `usageLimit` 으로(코덱스는 한도를 `{"type":"error"}` 로 낸다, §5.25 (F)). 상태는 그대로 — 사유 낱말만(③-1).
   * 근거는 이번 턴의 세션 깃발 또는 짧은 한도 통지 원문(`detectUsageLimitInText`). 원인이 분명한 사유(턴 상한·위임 누락·스폰 실패)는 건드리지 않는다.
   */
  private usageLimitCodeFor(sub: SubAgent, code: CommandError['code'], detail: string | undefined): CommandError['code'] {
    if (!USAGE_LIMIT_PROMOTABLE_ERROR_CODES.has(code)) return code;
    if (sub.usageLimit !== undefined) return 'usageLimit';
    return detail && detectUsageLimitInText(detail, Date.now()) ? 'usageLimit' : code;
  }

  /** A missing bridge is a failed setup, never a model-only verification success. */
  private rejectVerificationSetup(sub: SubAgent, cmd: QueuedCommand, detail: string): void {
    cmd.status = 'error';
    cmd.result = detail;
    // 표시 축이다 — 백단 셸이 남았다고 실패한 설정을 "도는 중"으로 세탁하지 않는다(⑰).
    sub.status = this.hasLiveAgentBackgroundWork(sub) ? 'active' : 'error';
    sub.lastActivityAt = Date.now();
    this.clearDispatching(sub.id);
    this.failCommand(sub, cmd, { code: 'spawn', detail });
    this.onSubStatusChange?.(sub.parentAgentId);
    this.onComplete?.();
  }

  /** §5.3 #10-2 — 띄운 위임의 결과를 못 받은 채 완료로 끝나려는 턴은 실패로 적는다(위임은 대기가 풀려도 돈다). 사유에 cmdId·상태를 실어 다음 턴이 다시 띄우지 않고 조회하게. */
  private failIfDispatchResultMissing(sub: SubAgent, cmd: QueuedCommand): void {
    if (cmd.status !== 'completed' || !this.pendingDispatchResults) return;
    const pending = this.pendingDispatchResults(sub.id);
    if (pending.length === 0) return;
    sub.status = 'error';
    cmd.status = 'error';
    this.failCommand(sub, cmd, { code: 'dispatchResult', detail: formatUndeliveredDispatchJobs(pending) });
  }

  /**
   * §5.5 #17-12 ③ — 이 매니저 **밖**에서 명령을 오류로 마감할 때의 진입점(부팅 reconcile 의 `[orphaned]` 등).
   * 세션을 찾을 수 있으면 스트림에도 한 줄 남기고, 못 찾으면 명령에 사유만 붙인다
   * (세션이 사라진 경우까지 실패로 만들면 정작 사유가 하나도 안 남는다).
   */
  markCommandError(subAgentId: string | null, cmd: QueuedCommand, error: CommandError): void {
    const sub = subAgentId ? this.index.get(subAgentId) : undefined;
    if (sub) { this.failCommand(sub, cmd, error); return; }
    const detail = error.detail ? error.detail.trim().slice(-COMMAND_ERROR_DETAIL_LIMIT) : undefined;
    // 세션이 사라진 자리라 엔진을 물을 데가 없다 — **클로드로 단정하지 않고 비워 둔다**
    //   (§5.5 #17-12 ③-7 · 화면은 엔진 이름 없이 `CLI` 라고만 말한다).
    cmd.error = {
      code: error.code,
      ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
      ...(detail ? { detail } : {}),
      ...(error.engine ? { engine: error.engine } : {}),
    };
  }

  /** 작업 칩을 세션의 백그라운드 장부에 반영 — 장부가 턴 봉인 지연과 화면(목록·도트·버블 완료)을 함께 몰므로 칩마다 상태 갱신도 태운다. */
  noteStreamTaskChip(subAgentId: string, subtype: string, task: StreamTaskInfo | null): void {
    const state = this.getTurnSealState(subAgentId);
    // 끝 칩은 `task_id` 만 들고 온다(종류·이름은 시작 칩에만 있다) — 지워지기 전에 읽어 둔다.
    const ending = subtype === TASK_CHIP_END_SUBTYPE && task?.id ? state.liveTasks.get(task.id) : undefined;
    const changed = noteTaskChip(
      state, subtype, task, Date.now(),
      this.currentTurnId.get(subAgentId),
    );
    if (!changed) return;
    const sub = this.index.get(subAgentId);
    if (!sub) return;
    // §5.5 #17-9 ⑪ — Task/Agent 자식의 끝 통지를 훅 대차대조에도 내린다 — 배경 스폰은 `SubagentStop` 만 내리는데 그게 유실되면 몇 시간째 "실행 중"으로 남는다.
    // 끝 통지는 추정이 아니라 사실이다.
    if (ending?.subagentType) {
      this.dropPendingBySubagentEndChip(sub.parentAgentId, subAgentId, ending, task?.summary);
    }
    // §5.3 #9-2 (C-1) — **끊겼다고 온 셸 작업**은 남은 프로세스도 거둔다. 상류는 Windows 에서 작업을 끊을 때
    //   `bash.exe` 만 끊어(anthropics/claude-code#27273·#76353) 그 아래 grep 이 고아로 남는다. 끝 통지는 사실이라
    //   이 자리에서 거두는 것은 "조용하니 죽었겠지"와 다르다. 스스로 끝난 것(`completed`·`failed`)은 건드리지 않는다.
    if (subtype === TASK_CHIP_END_SUBTYPE && task?.status === 'stopped' && task.id && ending && !ending.subagentType) {
      void this.reapStoppedTaskProcesses(sub, subAgentId, task.id);
    }
    // §5.5 #17-9 ⑱ — 끝 통지는 "끝"이 아니라 "곧 다시 돈다"다. 아래 `syncBgSubStatus` 가 탭을 내리기
    //   **전에** 붙들어야 한다(순서가 바뀌면 그 사이에 버블이 `completed` 로 넘어가 완료음이 난다).
    if (subtype === TASK_CHIP_END_SUBTYPE) this.noteNoticeAwaitingResume(sub);
    this.syncBgSubStatus(sub.parentAgentId);
    this.onSubStatusChange?.(sub.parentAgentId);
  }

  /**
   * §5.5 #17-9 ⑱ — 끝 통지가 오면 쉬는 세션은 곧 새 턴을 연다(3ms 뒤 열고 첫 모델 줄은 24초 뒤, 실측 2026-09-23) — 그 사이 내리면 완료음.
   * 봉인 유예 중이면 유예를 늘리고, 쉬는 persistent 자식이면 탭을 붙든다(첫 모델 줄이 풀고 없으면 `NOTICE_RESUME_WINDOW_MS` 뒤).
   */
  private noteNoticeAwaitingResume(sub: SubAgent): void {
    this.stretchDeferredSeal(sub.id, NOTICE_RESUME_WINDOW_MS, 'task notification arrived during the grace');
    const hold = shouldHoldForNoticeResume({
      bgPromoted: this.bgPromotedSubs.has(sub.id),
      subStatus: sub.status,
      processingCommand: this.isSubProcessingCommand(sub.id),
      childIdleAlive: this.persistentChildReady.get(sub.id) === true,
      dispatching: this.dispatchingSubs.has(sub.id),
      cmdDriven: this.cmdDrivenSubs.has(sub.id),
    });
    if (!hold) return;
    const subId = sub.id;
    const prev = this.noticeResumeHolds.get(subId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      // 그새 다시 걸렸거나(끝 칩이 또 옴) 풀린 뒤의 늦은 만료는 버린다.
      if (this.noticeResumeHolds.get(subId) !== timer) return;
      this.noticeResumeHolds.delete(subId);
      logger.warn(`SubAgent ${subId} task notification did not resume the session within ${NOTICE_RESUME_WINDOW_MS}ms — releasing the hold (§5.5 #17-9 ⑱)`);
      const cur = this.index.get(subId);
      if (!cur) return;
      this.syncBgSubStatus(cur.parentAgentId);
      this.onSubStatusChange?.(cur.parentAgentId);
    }, NOTICE_RESUME_WINDOW_MS);
    if (typeof timer.unref === 'function') timer.unref();
    this.noticeResumeHolds.set(subId, timer);
    logger.info(`SubAgent ${subId} task notification on an idle session — holding active until the resumed turn's first model line (≤${NOTICE_RESUME_WINDOW_MS}ms)`);
  }

  /**
   * §5.5 #17-9 ⑱ — 되살아난 턴이 말하기 시작 — 붙듦과 승격 표식을 함께 지운다(남기면 `syncBgSubStatus` 가 탭을 내린다). `result` 에서 `shouldSleepResumedTurn` 이 재운다.
   * `deliveredNotices` 는 비우지 않는다 — 통지 턴이 둘 이어질 때 그 셈으로 첫 턴의 `result` 가 3초 유예를 받아야 둘째 턴이 거둔다.
   * @returns 붙든 것이 있었으면 true.
   */
  private releaseNoticeResumeHold(subAgentId: string, cause: string): boolean {
    const timer = this.noticeResumeHolds.get(subAgentId);
    if (timer === undefined) return false;
    clearTimeout(timer);
    this.noticeResumeHolds.delete(subAgentId);
    this.bgPromotedSubs.delete(subAgentId);
    const sub = this.index.get(subAgentId);
    if (sub && this.syncBgSubStatus(sub.parentAgentId)) this.onSubStatusChange?.(sub.parentAgentId);
    logger.info(`SubAgent ${subAgentId} resumed after a task notification (${cause}) — hold released`);
    return true;
  }

  /** §5.5 #17-9 ⑱ — 붙듦을 **상태를 건드리지 않고** 걷는다(중지·제거·자식 종료처럼 다른 경로가 상태를 정하는 자리). */
  private clearNoticeResumeHold(subAgentId: string): boolean {
    const timer = this.noticeResumeHolds.get(subAgentId);
    if (timer === undefined) return false;
    clearTimeout(timer);
    this.noticeResumeHolds.delete(subAgentId);
    return true;
  }

  /**
   * §5.5 #17-9 ⑪ — 끝 칩으로 훅 항목 하나를 내린다. 열쇠가 달라(`tool_use_id` ↔ `task_id`) 같은 탭·`subagent_type`·`description` → 최고령으로 짝짓는다.
   * 못 찾으면 `SubagentStop` 이 이미 내린 것.
   */
  private dropPendingBySubagentEndChip(
    parentAgentId: string,
    subId: string,
    ending: LiveTaskInfo,
    summary?: string,
  ): void {
    const m = this.pendingSubagentTasks.get(parentAgentId);
    if (!m || m.size === 0) return;
    const sameKind = (e: PendingSubagentEntry): boolean =>
      e.subId === subId && e.subagentType === ending.subagentType;
    let key = ending.description
      ? oldestKeyOf(m, (e) => sameKind(e) && e.description === ending.description)
      : undefined;
    key ??= oldestKeyOf(m, sameKind);
    if (key === undefined) return;
    const e = m.get(key)!;
    m.delete(key);
    this.archiveSubagentTask(parentAgentId, key, e, summary);
    logger.info(`[bg-subagent] stop via stream end-chip parent=${parentAgentId} key=${key} sub=${subId} type=${ending.subagentType ?? '-'} pending=${m.size} (SubagentStop 미도달 — 끝 통지로 회수)`);
    if (m.size === 0) {
      this.pendingSubagentTasks.delete(parentAgentId);
      this.pendingSubagentLastSignal.delete(parentAgentId);
    }
  }

  /** 이 sub 의 턴 봉인 대차대조(없으면 만든다). */
  private getTurnSealState(subAgentId: string): TurnSealState {
    let state = this.turnSealStates.get(subAgentId);
    if (!state) { state = createTurnSealState(); this.turnSealStates.set(subAgentId, state); }
    return state;
  }

  /** 스트림 줄이 턴 봉인에 주는 영향 — 모든 경로가 여기를 지난다. 작업 칩은 대차대조에, 실제 작업 이벤트는 잠정 봉인 취소(이미 봉인 뒤면 sub 를 다시 `active`). */
  private noteTurnSealSignal(event: SubAgentStreamEvent): void {
    if (event.eventType === 'system') {
      const subtype = parseSystemSubtype(event.content);
      if (subtype !== null) {
        this.noteStreamTaskChip(event.subAgentId, subtype, parseSystemTaskInfo(event.content));
      }
      return;
    }
    if (!isTurnResumeSignal(event.eventType)) return;
    // 곁가지(비동기 서브에이전트 안쪽) 줄은 본 대화가 이어졌다는 신호가 아니다 — 그걸로 봉인을 풀면 끝난 명령이 `executing` 으로 붙들린다(§5.5 #17-18). 생존은 `liveTasks` 가 든다.
    if (event.nestedUnderToolUseId) {
      const nestedOwner = this.index.get(event.subAgentId);
      if (nestedOwner) nestedOwner.lastActivityAt = Date.now();
      return;
    }

    // §5.5 #17-9 ⑱ — 끝 통지로 붙들어 둔 탭은 되살아난 턴이 말하기 시작한 지금 푼다. persistent 는 보통
    //   그보다 이른 원시 모델 줄(`_handlePersistentStdoutLine`)에서 이미 풀렸다 — 여기는 그 밖의 경로용.
    this.releaseNoticeResumeHold(event.subAgentId, event.eventType);
    if (this.resumeHeldSeal(event.subAgentId, event.eventType)) return;

    // 봉인이 이미 끝난 뒤에 다시 흐르기 시작한 경우 — 화면을 진실로 되돌린다.
    const sub = this.index.get(event.subAgentId);
    if (sub && (sub.status === 'idle' || sub.status === 'completed')) {
      sub.status = 'active';
      sub.lastActivityAt = Date.now();
      logger.info(`SubAgent ${sub.id} woke up after its turn was sealed (${event.eventType}) — back to active`);
      this.onSubStatusChange?.(sub.parentAgentId);
    }
  }

  /** 턴 종료를 봉인하거나 잠정으로 미룬다(`turnSeal.ts`). `canResume` 거짓(legacy 종료·크래시·중지 — 자식이 이미 죽었다)이면 즉시 봉인. */
  private sealTurn(sub: SubAgent, canResume: boolean, seal: () => void, onResume?: () => void): void {
    this.cancelDeferredSeal(sub.id);
    const state = this.getTurnSealState(sub.id);
    if (!canResume || !mayTurnResume(state)) {
      noteTurnSealed(state);
      seal();
      return;
    }
    logger.info(
      `SubAgent ${sub.id} turn end is provisional (liveTasks=${state.liveTasks.size}, notices=${state.deliveredNotices})`
      + ` — holding ${TURN_RESUME_GRACE_MS}ms before sealing`,
    );
    const timer = this.armDeferredSealTimer(sub.id, TURN_RESUME_GRACE_MS);
    this.deferredSeals.set(sub.id, { timer, seal, ...(onResume ? { onResume } : {}) });
  }

  /**
   * 잠정 봉인의 만료 타이머를 건다 — 거는 곳이 둘(`sealTurn` · `stretchDeferredSeal`)이라 한 곳에 둔다.
   * 만료 때 **자기가 아직 현역 타이머인지** 확인한다 — 늘리면서 갈아 끼운 옛 타이머가 봉인하지 않게.
   */
  private armDeferredSealTimer(subAgentId: string, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      const deferred = this.deferredSeals.get(subAgentId);
      if (!deferred || deferred.timer !== timer) return;
      this.deferredSeals.delete(subAgentId);
      noteTurnSealed(this.getTurnSealState(subAgentId));
      logger.info(`SubAgent ${subAgentId} provisional turn end expired — sealing`);
      deferred.seal();
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  /** §5.5 #17-9 ⑱(d) — 붙든 봉인의 만료를 `ms` 뒤로 다시 건다(없으면 false) — 유예 중 끝 통지의 새 턴은 첫 토큰이 3초보다 늦다. 거두는 것은 첫 모델 줄(`resumeHeldSeal`). */
  private stretchDeferredSeal(subAgentId: string, ms: number, cause: string): boolean {
    const deferred = this.deferredSeals.get(subAgentId);
    if (!deferred) return false;
    clearTimeout(deferred.timer);
    deferred.timer = this.armDeferredSealTimer(subAgentId, ms);
    logger.info(`SubAgent ${subAgentId} provisional turn end stretched to ${ms}ms (${cause}) — waiting for the resumed turn`);
    return true;
  }

  /** 붙든 봉인을 "턴이 이어졌다"로 거둔다(없으면 false). 부르는 곳: `noteTurnSealSignal`, 그보다 이른 persistent stdout 모델 줄. */
  private resumeHeldSeal(subAgentId: string, cause: string): boolean {
    const deferred = this.deferredSeals.get(subAgentId);
    if (!deferred) return false;
    clearTimeout(deferred.timer);
    this.deferredSeals.delete(subAgentId);
    noteTurnResumed(this.getTurnSealState(subAgentId));
    deferred.onResume?.();
    logger.info(`SubAgent ${subAgentId} turn resumed (${cause}) — provisional seal cancelled`);
    return true;
  }

  /** 붙들어 둔 잠정 봉인을 버린다(다른 마감 경로가 먼저 도착했거나, 턴이 이어졌을 때). */
  private cancelDeferredSeal(subAgentId: string): void {
    const deferred = this.deferredSeals.get(subAgentId);
    if (!deferred) return;
    clearTimeout(deferred.timer);
    this.deferredSeals.delete(subAgentId);
  }

  /**
   * 붙들어 둔 봉인을 **지금 실행**한다 — 탭이 닫히는 것처럼 더 기다릴 수 없는 자리에서.
   * 그냥 버리면 그 명령이 `executing` 인 채로 큐에 남아 화면이 영영 실행 중으로 굳는다.
   */
  private flushDeferredSeal(subAgentId: string, reason = 'session closing'): void {
    const deferred = this.deferredSeals.get(subAgentId);
    if (!deferred) return;
    clearTimeout(deferred.timer);
    this.deferredSeals.delete(subAgentId);
    noteTurnSealed(this.getTurnSealState(subAgentId));
    logger.info(`SubAgent ${subAgentId} provisional turn end flushed (${reason}) — sealing now`);
    deferred.seal();
  }

  /** 줄에 자기 턴을 찍는다 — 시킨 턴이 주인: ① 끝 통지는 그 작업을 시작한 턴(몇 턴 뒤에 온다) ② 그 밖은 지금 도는 턴 ③ 없으면 비운다(클라가 시각으로 폴백). */
  private stampTurnId(event: SubAgentStreamEvent): void {
    if (event.turnId) return;
    if (event.eventType === 'system') {
      const subtype = parseSystemSubtype(event.content);
      if (subtype === TASK_CHIP_END_SUBTYPE) {
        const task = parseSystemTaskInfo(event.content);
        const owner = task?.id
          ? turnIdOfLiveTask(this.getTurnSealState(event.subAgentId), task.id)
          : undefined;
        if (owner) { event.turnId = owner; return; }
      }
    }
    const current = this.currentTurnId.get(event.subAgentId);
    if (current) event.turnId = current;
  }

  /** 스트림 이벤트를 버퍼에 추가 + 디스크 append + 콜백 호출. 서버의 고아 진단은 실제 활동이 아니다. */
  private emitStreamEvent(event: SubAgentStreamEvent, options: { recordActivity?: boolean } = {}): void {
    // 턴 세대 도장 — 이 줄이 **어느 명령의 것인가**. 클라는 이 값으로 명령 블록을 고르므로
    //   봉인 판정보다 **먼저** 찍는다(아래에서 버려지는 칩도 라이브 중계로는 나간다).
    this.stampTurnId(event);
    // 턴 봉인 판정은 **버려지는 칩까지 포함해** 모든 줄을 봐야 한다 — 아래 복원 예산 컷보다 먼저.
    this.noteTurnSealSignal(event);
    // §5.3 #9-1 (P)(a) — 조용한 압축의 줄은 어디에도 남기지 않되, 봉인 판정 뒤에 둔다(마감 신호는 받아야 다음 명령이 나간다).
    // `lastActivityAt` 은 갱신한다 — 압축은 평균 150초(실측)라 빠뜨리면 idle sweep 이 죽은 것으로 읽는다.
    if (event.turnId && this.silentTurnIds.has(event.turnId)) {
      const silentSub = this.index.get(event.subAgentId);
      if (silentSub && options.recordActivity !== false) silentSub.lastActivityAt = Date.now();
      return;
    }
    // §5.5 — 안 그려지는 상태 칩(`[task_progress]` 등)은 버퍼·디스크에 남기지 않는다(버퍼의 38%, 실측). 라이브 중계는 그대로 — 진행 표시가 이걸로 움직인다.
    if (isNeverRenderedStreamEvent(event)) {
      const liveOnlySub = this.index.get(event.subAgentId);
      if (liveOnlySub && options.recordActivity !== false) liveOnlySub.lastActivityAt = Date.now();
      this.onStreamEvent?.(event);
      return;
    }
    let buf = this.streamBuffers.get(event.subAgentId);
    if (!buf) {
      // idle 회수 뒤 재개면 디스크의 과거를 먼저 잇는다 — 폴더(`findStreamDirFor`)를 못 짚으면 그 세션은 지금부터의 몇 줄만 남는다.
      const dir0 = this.findStreamDirFor(event.subAgentId, event.parentAgentId);
      if (dir0) {
        const r = streamBufferStore.loadBufferIfChanged(dir0, event.subAgentId, MAX_STREAM_BUFFER, undefined);
        this.streamDiskStamps.set(event.subAgentId, { dir: dir0, stamp: r.stamp });
        buf = r.events;
      } else {
        // 과거를 못 이어붙였다 — 이 버퍼는 "그 세션의 전부"가 아니라는 표식을 남긴다. 읽기 경로는 이 표식을
        //   보고 이 몇 줄을 권위본으로 내보내지 않으며, 폴더를 되찾는 순간 디스크로 메운다.
        buf = [];
        this.partialStreamBuffers.add(event.subAgentId);
      }
      this.streamBuffers.set(event.subAgentId, buf);
    }
    // 디스크 영속화 — 프로젝트별 save 디렉토리 하위 sub-streams/<agentId>/<subId>.jsonl.
    //   §5.5 #17-12 — 소속 해석이 끊겨도 기억해 둔 폴더로 이어 쓴다(`resolveStreamWriteDir`).
    const dir = this.resolveStreamWriteDir(event.subAgentId, event.parentAgentId);
    // 과거 없이 시작된 버퍼가 이제 폴더를 찾았으면, 이 줄을 붙이기 **전에** 디스크 과거로 메우고
    //   메모리에만 있던 줄을 먼저 적는다 — 그래야 파일에서도 줄 순서가 뒤집히지 않는다.
    if (dir && this.partialStreamBuffers.has(event.subAgentId)) buf = this.healPartialStreamBuffer(event.subAgentId, dir);
    buf.push(event);
    this.streamBufferAccessAt.set(buf, Date.now());
    if (buf.length > MAX_STREAM_BUFFER) buf.splice(0, buf.length - MAX_STREAM_BUFFER);
    // 거짓-완료 방지 — 스트림 이벤트가 흐르는 동안 sub 를 "살아있음" 으로 갱신.
    // lastActivityAt 은 execute() 시작·child.close 두 곳에서만 찍혀, 명령이 길어지면
    // idle sweep 이 staleness 만 보고 실행 중 sub 를 idle 로 강등 → 부모 버블이 거짓 completed.
    const liveSub = this.index.get(event.subAgentId);
    if (liveSub && options.recordActivity !== false) liveSub.lastActivityAt = Date.now();
    if (dir) streamBufferStore.appendEvent(dir, event);
    this.onStreamEvent?.(event);
  }

  /** 카운터 반환 (체크포인트 저장용) */
  getCounter(): number {
    return subCounter;
  }

  /** 체크포인트 복원 — 메타 + 디스크 스트림. `project` 가 없으면 메타만, `archived` 는 탭 닫힌 sub(폴더 버튼). */
  restore(
    data: Record<string, SubAgent[]>,
    counter: number,
    project?: ProjectInfo,
    archived?: Record<string, SubAgent[]>,
  ): void {
    subCounter = counter;
    this.registry.clear();
    this.index.clear();
    this.streamBuffers.clear();
    this.streamDiskStamps.clear(); // 버퍼를 비웠으니 지문도 함께 — 남기면 아래 복원이 "변화 없음"에 막힌다.
    this.archive.clear();
    let loadedBuffers = 0;
    for (const [agentId, subs] of Object.entries(data)) {
      // active 상태였던 건 idle로 복원 (프로세스는 이미 죽었으므로)
      const restored = subs.map((s) => ({
        ...s,
        status: (s.status === 'active' ? 'idle' : s.status) as SubAgent['status'],
      }));
      this.registry.set(agentId, restored);
      const dir = project ? streamBufferStore.subStreamsDir(project, agentId) : null;
      // 체크포인트의 프로젝트가 곧 그 에이전트의 폴더다 — 기억해 두면 나중에 소속 해석이 끊겨도
      //   (프로젝트가 stub 으로 내려간 동안) 쓰기·읽기가 이 자리로 이어진다.
      if (dir) this.lastKnownAgentStreamDirs.set(agentId, dir);
      for (const s of restored) {
        this.index.set(s.id, s);
        if (dir) {
          const buf = streamBufferStore.loadBuffer(dir, s.id, MAX_STREAM_BUFFER);
          if (buf.length > 0) { this.streamBuffers.set(s.id, buf); this.lastKnownStreamDirs.set(s.id, dir); loadedBuffers++; }
        }
      }
    }
    if (archived) {
      for (const [agentId, subs] of Object.entries(archived)) {
        if (subs.length === 0) continue;
        this.archive.set(agentId, subs.map((s) => ({ ...s, status: 'idle' as const })));
      }
    }
    logger.info(`SubAgents restored: ${this.index.size} sub(s), ${loadedBuffers} stream buffer(s), ${this.archive.size} archived agent(s)`);
  }

  /**
   * §5.7 #23-2 — 부팅 때 `agentViewShort` 가 있는 sub 를 roster 와 대조: 살아 있으면 재부착 + `active`, 죽었으면 state.json 을 결과로 받고 idle/error.
   * `projectResolver` 가 먼저 set 돼 있어야 한다.
   * @param findExecutingCmd sub 의 최근 executing 명령(없으면 null) — 있어야 끝날 때 cmd 를 completed 로 닫는다.
   */
  async reattachAgentViewOnBoot(
    findExecutingCmd?: (subAgentId: string) => QueuedCommand | null,
  ): Promise<{ alive: number; gone: number; failed: number }> {
    const known = [...this.index.values()].filter((s) => !!s.agentViewShort && !!s.agentViewSessionId);
    if (known.length === 0) return { alive: 0, gone: 0, failed: 0 };

    const { reconcileOnBoot, readJobState } = await import('./claudeAgentViewService.js');
    const shorts = known.map((s) => s.agentViewShort!).filter(Boolean);
    const { alive } = reconcileOnBoot(shorts);
    const aliveShorts = new Set(alive.map((a) => a.short));

    let aliveCount = 0;
    let goneCount = 0;
    let failedCount = 0;

    // cmd 마무리 공용 헬퍼 — terminal state 와 sub 의 final result 로 cmd 봉합.
    //   부팅 봉합도 결과 판정은 산 경로와 **같은 자리**(`turnResultText`)를 거친다 — 답 없는 턴이
    //   앞 턴의 답을 물려받는 자리가 여기에도 있었다(③-4).
    const finalizeCmd = (
      sub: SubAgent,
      stateStr: string,
      reported: string | undefined,
      detail?: string,
      cwd?: string,
      sessionId?: string,
    ): void => {
      const cmd = findExecutingCmd?.(sub.id);
      if (!cmd) return;
      const isError = stateStr === 'failed';
      cmd.status = isError ? 'error' : 'completed';
      const resultText = cwd ? this.turnResultText(cmd, cwd, sessionId, reported) : reported;
      if (resultText) cmd.result = resultText;
      // §5.5 #17-12 ③ — 실패로 봉합되는 명령에는 사유를 함께 남긴다(옛 코드는 상태만 바꿔 "오류"만 남았다).
      if (isError) this.failCommand(sub, cmd, { code: 'agentView', ...(detail ? { detail } : {}) });
      // §5.5 #17-12 ③-6 — 앱이 내려가 있던 사이 [중지]는 우리 표식이 아니라 잡 상태(`stopped`)로만 남는다.
      this.stampTurnStopReason(sub, cmd, { userStopped: stateStr === 'stopped' });
    };

    for (const sub of known) {
      const short = sub.agentViewShort!;
      const sessionId = sub.agentViewSessionId!;
      const project = this.projectResolver?.(sub.parentAgentId);
      const cwd = project?.path ?? null;
      if (!cwd) { failedCount++; continue; }

      if (aliveShorts.has(short)) {
        // alive ≠ working — state 가 'working'·'needs-input' 일 때만 재부착한다. 그 밖은 gone 처럼 봉합 + idle(부활시키면 부모가 완료 사이클을 한 번 더 탄다).
        const currentState = readJobState(short);
        const stateStr = String(currentState?.state || '');
        const stillWorking = stateStr === 'working' || stateStr === 'needs-input';

        if (stillWorking) {
          try {
            const jsonlPath = getSessionJsonlPath(cwd, sessionId);
            sub.status = 'active';
            this.runningAgentViewWatchers.set(sub.id, { short, sessionId });
            await attachWatcher({
              short,
              sessionId,
              jsonlPath,
              subAgentId: sub.id,
              parentAgentId: sub.parentAgentId,
              // 과거 라인은 이미 클라가 가지고 있으므로 새로 부착 후 추가분만 받는다.
              skipExisting: true,
              onEvents: (events) => { for (const e of events) this.emitStreamEvent(e); },
              // §5.5 #17-12 ③-6 — 재부착 뒤에 온 끝 사유도 봉인이 읽게 한다(끝을 말하는 줄에서만 명령을 찾는다).
              onLine: (obj) => {
                if (readTurnStopSignal(obj)) this.noteTurnStopLine(findExecutingCmd?.(sub.id)?.id, obj);
              },
              onTerminal: (state) => {
                const ts = String(state.state || '');
                sub.status = ts === 'failed' ? 'error' : 'idle';
                sub.lastActivityAt = Date.now();
                // state.output.result 이 비어도 JSONL 의 마지막 assistant 메시지로 폴백.
                // turn_duration 발화 시점에 supervisor 가 output 을 아직 안 채웠을 수 있음.
                let resultText = (typeof state.output?.result === 'string' && state.output.result) || undefined;
                if (!resultText) {
                  try { resultText = readLastAssistantMessage(cwd, sessionId) ?? undefined; } catch { /* ignore */ }
                }
                if (resultText) sub.lastResult = resultText;
                finalizeCmd(sub, ts, resultText, state.detail, cwd, sessionId);
                // 이 세션의 실행이 끝났다 = 그 자식인 배경 작업도 끝났다(위 close 핸들러와 같은 근거).
                this.retireLiveBackgroundTasks(sub.id);
                this.clearPendingSubagentTasksForSession(sub.parentAgentId, sub.id);
                this.runningAgentViewWatchers.delete(sub.id);
                void detachWatcher(short);
                this.onSubStatusChange?.(sub.parentAgentId);
                this.onComplete?.();
              },
            });
            aliveCount++;
            logger.info(`[agent-view reattach] sub=${sub.id} short=${short} state=${stateStr} → resumed (working)`);
          } catch (err) {
            failedCount++;
            logger.warn(`[agent-view reattach] sub=${sub.id} short=${short} failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          // alive + 비-working: 다운타임 중 턴 종료 — gone 경로와 동일하게 봉합.
          sub.status = stateStr === 'failed' ? 'error' : 'idle';
          sub.lastActivityAt = Date.now();
          let resultText = (typeof currentState?.output?.result === 'string' && currentState.output.result) || undefined;
          if (!resultText) {
            try { resultText = readLastAssistantMessage(cwd, sessionId) ?? undefined; } catch { /* ignore */ }
          }
          if (resultText && !sub.lastResult) sub.lastResult = resultText;
          finalizeCmd(sub, stateStr, resultText, currentState?.detail, cwd, sessionId);
          // 다른 종료 경로처럼 부모 재계산 + 아카이브를 즉시 — 빠뜨리면 배지가 다음 10초 sweep 까지 낡는다.
          this.onSubStatusChange?.(sub.parentAgentId);
          this.onComplete?.();
          aliveCount++;
          logger.info(`[agent-view reattach] sub=${sub.id} short=${short} state=${stateStr || 'unknown'} → finalized (turn ended during downtime)`);
        }
      } else {
        // supervisor 에서 사라짐 → state.json 최종 상태 흡수 + 해당 cmd 도 즉시 봉합.
        const finalState = readJobState(short);
        if (finalState) {
          const stateStr = String(finalState.state || '');
          sub.status = stateStr === 'failed' ? 'error' : 'idle';
          sub.lastActivityAt = Date.now();
          const resultText = (typeof finalState.output?.result === 'string' && finalState.output.result) || undefined;
          if (resultText && !sub.lastResult) sub.lastResult = resultText;
          finalizeCmd(sub, stateStr, resultText, finalState.detail, cwd, sessionId);
          // gone 경로도 부모 재계산 + 아카이브를 즉시(위와 같은 이유).
          this.onSubStatusChange?.(sub.parentAgentId);
          this.onComplete?.();
        }
        goneCount++;
      }
    }

    if (aliveCount + goneCount > 0) {
      logger.info(`[agent-view reattach] alive=${aliveCount} gone=${goneCount} failed=${failedCount}`);
    }
    return { alive: aliveCount, gone: goneCount, failed: failedCount };
  }

  /** 부모 에이전트의 idle subagent 목록 */
  getIdleSubs(parentAgentId: string): SubAgent[] {
    const subs = this.registry.get(parentAgentId) ?? [];
    return subs.filter((s) => s.status === 'idle' || s.status === 'completed');
  }

  /** 부모 에이전트의 전체 subagent 목록 */
  getAllSubs(parentAgentId: string): SubAgent[] {
    return this.registry.get(parentAgentId) ?? [];
  }

  /**
   * 확인 dismiss — 근거까지 걷는다(§2.4). 버블 `error` 는 sub 상태의 파생값이라 버블만 내리면 다음 10초 스윕·재시작이 되살린다.
   * `error` sub 만 `idle` 로(`active`·결과·이력·스트림은 그대로). 사용자 클릭 전용 — 스윕이 실패를 세탁하지 않는다.
   * @returns 내린 sub 수(0이면 broadcast·저장 생략).
   */
  acknowledgeErrorSubs(parentAgentId: string): number {
    let cleared = 0;
    for (const sub of this.registry.get(parentAgentId) ?? []) {
      if (sub.status !== 'error') continue;
      sub.status = 'idle';
      cleared++;
    }
    if (cleared > 0) {
      logger.info(`SubAgent error acknowledged: ${cleared} sub(s) → idle (parent: ${parentAgentId})`);
    }
    return cleared;
  }

  /** 전체 서브에이전트 flat 목록 (세션 ID 역조회용) */
  getAllSubsFlat(): SubAgent[] {
    return [...this.index.values()];
  }

  getSub(subAgentId: string): SubAgent | undefined {
    return this.index.get(subAgentId);
  }

  /**
   * §5.3 #9-1 (P)(b) — "마지막 명령"을 이 글로 적고 기본 라벨이면 제목도 붙인다. 조용한 사전 압축 때 서버가 뒤에 선 명령의 글로 부른다
   * (`execute` 는 조용한 턴에 두 칸을 안 건드린다 — `/compact` 가 새지 않게).
   */
  noteLastCommand(subAgentId: string, text: string): void {
    const sub = this.index.get(subAgentId);
    if (sub) this.applyLastCommand(sub, text);
  }

  private applyLastCommand(sub: SubAgent, text: string): void {
    sub.lastCommand = text;
    // §5.5 #17-5 — 기본 라벨(Sub #N)이면 첫 프롬프트로 이름을 붙인다(직접 바꾼 이름은 클라 `subAgentLabels` 가 우선).
    if (DEFAULT_SUB_LABEL_RE.test(sub.label)) {
      const title = deriveTabTitle(text);
      if (title) sub.label = title;
    }
  }

  /** 이 sub 가 지금 실제로 실행 중인가 — 살아있는 자식 프로세스(legacy) 또는 agent-view watcher 보유.
   *  idle sweep 의 확정 진실(ground truth). lastActivityAt staleness 같은 추측이 이걸 이길 수 없다:
   *  "동작 중인 sub 를 거짓 완료/idle 처리" 의 단일 차단막. */
  isSubRunning(subId: string): boolean {
    // 로컬(All Model) 턴은 자식이 없다 — 그 사실을 여기 함께 두지 않으면 "자식이 없으니 안 돈다"가
    //   돌고 있는 세션을 걷어 낸다(§5.19 (D) `localInFlightCmd`).
    return this.runningChildren.has(subId)
      || this.runningAgentViewWatchers.has(subId)
      || this.localInFlightCmd.has(subId);
  }

  /**
   * 지금 한 턴을 처리 중인가 — `isSubRunning` 보다 좁다(그건 idle 대기 자식도 참이라 완료 가드로 쓰면 부모가 못 끝난다).
   * persistent/local: in-flight 명령 · legacy: 자식 생존 && persistent-ready 아님 · agent-view: watcher. 순간 비활성(result ~ 다음 dispatch)의 조기 완료를 막는다.
   */
  isSubProcessingCommand(subId: string): boolean {
    if (this.persistentInFlightCmd.has(subId)) return true;
    // 로컬(All Model): 러너가 한 턴을 도는 중. persistent 의 in-flight 와 **같은 뜻**이라 같은 자리에 둔다.
    if (this.localInFlightCmd.has(subId)) return true;
    if (this.runningAgentViewWatchers.has(subId)) return true;
    if (this.runningChildren.has(subId) && this.persistentChildReady.get(subId) !== true) return true;
    return false;
  }

  /** §5.3 #12-1 — sessionId 로 managed sub 역조회(훅 소유 해석). index 가 수십 건이라 선형 스캔. */
  findSubBySessionId(sessionId: string): SubAgent | undefined {
    if (!sessionId) return undefined;
    for (const s of this.index.values()) {
      if (s.sessionId === sessionId || s.agentViewSessionId === sessionId) return s;
    }
    return undefined;
  }

  /** §5.5 #17-9 ③(c) — termId 로 sub 역조회 — CMD 세션은 `sessionId` 가 비어 있어 훅의 `_vibisualOwnerTermId`(끝 토큰 = sub.id)로 푼다. */
  findSubByTermId(termId: string): SubAgent | undefined {
    const parsed = parseTermId(termId);
    if (!parsed) return undefined;
    return this.index.get(parsed.sessionToken);
  }

  /**
   * §5.3 #12-1 — 부모의 Task/Agent PreToolUse: 대차대조 ↑, 띄운 탭(`ownerSubId`)의 도트도 함께.
   * @returns 탭 도트가 바뀌었으면 true.
   */
  noteSubagentTaskStart(
    parentAgentId: string,
    toolUseId?: string,
    ownerSubId?: string,
    meta?: { description?: string; subagentType?: string; prompt?: string; background?: boolean },
  ): boolean {
    let m = this.pendingSubagentTasks.get(parentAgentId);
    if (!m) {
      m = new Map();
      this.pendingSubagentTasks.set(parentAgentId, m);
    }
    const key = toolUseId ?? `anon-${++this.pendingSubagentAnonSeq}`;
    // 소유 세션을 못 풀면 처리 중인 탭이 딱 하나일 때만 그 탭에 귀속한다(없으면 도트가 꺼진 채 끝난 것처럼 보인다). 둘 이상이면 미상.
    const resolvedSubId = ownerSubId ?? this.soleProcessingSubId(parentAgentId);
    m.set(key, {
      ts: Date.now(),
      subId: resolvedSubId,
      description: meta?.description,
      subagentType: meta?.subagentType,
      prompt: meta?.prompt,
      // §5.5 #17-9 ⑧ — 배경 스폰이면 PostToolUse 접수증으로 내리지 않는다(아래 noteSubagentTaskResult).
      background: meta?.background === true,
    });
    this.pendingSubagentLastSignal.set(parentAgentId, Date.now());
    logger.info(`[bg-subagent] start parent=${parentAgentId} key=${key} sub=${ownerSubId ?? '-'} bg=${meta?.background === true} pending=${m.size}`);
    return this.syncBgSubStatus(parentAgentId);
  }

  /** 처리 중인 탭이 딱 하나면 그 id, 아니면 `undefined` — 추측하지 않는다(남의 도트를 거짓으로 켜는 것이 더 나쁘다). */
  private soleProcessingSubId(parentAgentId: string): string | undefined {
    let found: string | undefined;
    for (const sub of this.registry.get(parentAgentId) ?? []) {
      if (!this.isSubProcessingCommand(sub.id)) continue;
      if (found) return undefined; // 둘 이상 — 가릴 수 없다.
      found = sub.id;
    }
    return found;
  }

  /**
   * §5.3 #12-1 — 대차대조를 세션 탭 도트에도 반영 — pending 이 있으면 active 로 올려 `bgPromotedSubs` 에 표식, 비면 표식 있는 sub 만 idle 로.
   * 처리 중인 sub 는 `isSubProcessingCommand` 로 보호.
   * @returns 바뀌었으면 true.
   */
  private syncBgSubStatus(parentAgentId: string): boolean {
    const m = this.pendingSubagentTasks.get(parentAgentId);
    const pendingSubIds = new Set<string>();
    if (m) {
      for (const e of m.values()) {
        if (e.subId) pendingSubIds.add(e.subId);
      }
    }
    // 스트림으로만 보이는 모델 자식도 같은 자격(훅이 못 푼 자식의 유일한 증인) — 표시용 목록(`listDisplayableLiveTasks`)을 쓰면 도는 탭이 "완료"로 굳는다(⑮).
    // **셸은 넣지 않는다**(⑰ — `hasLiveAgentTasks`): 끝 표식이 안 오는 셸 하나가 탭을 영구히 "실행 중"으로 붙든다. 셸은 활동바·목록·`KillShell` 이 따로 맡는다.
    for (const [subId, state] of this.turnSealStates) {
      if (this.index.get(subId)?.parentAgentId !== parentAgentId) continue;
      if (hasLiveAgentTasks(state)) { pendingSubIds.add(subId); continue; }
      // 조용한 건너뜀 ❌ — 셸만 남아 상태를 안 올린 사실은 한 번은 남긴다(§2.4 로그 규약).
      //   CLI 가 언젠가 `subagent_type` 을 빼면 여기서 드러난다.
      const shells = countLiveShells(state);
      if (shells > 0 && !this.shellOnlyLogged.has(subId)) {
        this.shellOnlyLogged.add(subId);
        capSetSize(this.shellOnlyLogged, SESSION_KEYED_MAP_MAX);
        logger.info('[bg-shell] sub=' + subId + ' 남은 항목이 셸 ' + shells + '개뿐 — 세션 상태는 올리지 않는다(§5.5 #17-9 ⑰). 활동바·백그라운드 목록에만 보인다.');
      }
    }
    // §5.5 #17-9 ⑱ — 끝 통지로 **곧 다시 돌** 탭도 같은 자격이다. CLI 는 이미 새 턴을 열었고, 첫 모델
    //   줄이 오기 전까지 서버가 그걸 모를 뿐이다. 여기서 빼면 그 사이에 탭이 내려가 완료음이 난다.
    for (const subId of this.noticeResumeHolds.keys()) {
      if (this.index.get(subId)?.parentAgentId === parentAgentId) pendingSubIds.add(subId);
    }
    let changed = false;
    for (const sub of this.registry.get(parentAgentId) ?? []) {
      if (pendingSubIds.has(sub.id)) {
        this.bgPromotedSubs.add(sub.id);
        // error 는 보존 — 자식이 돈다고 실패한 턴을 active 로 세탁하지 않는다.
        if (sub.status === 'idle' || sub.status === 'completed') {
          sub.status = 'active';
          sub.lastActivityAt = Date.now();
          changed = true;
        }
      } else if (this.bgPromotedSubs.delete(sub.id)) {
        if (sub.status === 'active' && !this.isSubProcessingCommand(sub.id)) {
          // 자식이 다 끝났고 이 탭도 처리 중이 아니다 → "완료, 미확인"(녹색).
          sub.status = 'idle';
          sub.lastActivityAt = Date.now();
          changed = true;
        }
      }
    }
    return changed;
  }

  /**
   * §5.3 #12-1 — SubagentStop: 대차대조 ↓(`parent_tool_use_id` 로 짝, id 없는 구버전은 최고령).
   * @returns drained = pending 이 0 이 됐다(즉시 recompute), subChanged = 탭 도트가 바뀌었다.
   */
  noteSubagentTaskStop(
    parentAgentId: string,
    toolUseId?: string,
    result?: string,
  ): { drained: boolean; subChanged: boolean } {
    this.pendingSubagentLastSignal.set(parentAgentId, Date.now());
    const m = this.pendingSubagentTasks.get(parentAgentId);
    if (!m || m.size === 0) return { drained: false, subChanged: false };
    // §5.5 #17-9 ⑦(b) — 내려가는 항목을 버리지 않고 "방금 끝난 것" 꼬리로 옮긴다.
    //   결과는 대개 이 뒤의 PostToolUse(Task) 가 붙여 준다(SubagentStop 이 먼저 오므로).
    const hit = toolUseId ? m.get(toolUseId) : undefined;
    if (hit) {
      m.delete(toolUseId as string);
      this.archiveSubagentTask(parentAgentId, toolUseId as string, hit, result);
    } else if (toolUseId) {
      // 장부에 없는 id = 이미 정리된 옛 턴의 자식([중지]·`즉시` 뒤 비워짐). 최고령 폴백으로 떨어지면 지금 턴의 자식을 지워 남의 결과를 붙이므로 버린다.
      logger.info(`[bg-subagent] stop for unknown key parent=${parentAgentId} key=${toolUseId} — stale child of a replaced turn, ignored`);
      return { drained: false, subChanged: false };
    } else {
      // id 미상 페이로드(구버전)만 최고령 회수 — 이 경우엔 대조할 열쇠 자체가 없다.
      let oldestKey: string | null = null;
      let oldestTs = Infinity;
      for (const [k, e] of m) {
        if (e.ts < oldestTs) { oldestTs = e.ts; oldestKey = k; }
      }
      if (oldestKey !== null) {
        const e = m.get(oldestKey);
        m.delete(oldestKey);
        if (e) this.archiveSubagentTask(parentAgentId, oldestKey, e, result);
      }
    }
    logger.info(`[bg-subagent] stop parent=${parentAgentId} key=${toolUseId ?? '(oldest)'} pending=${m.size}`);
    const drained = m.size === 0;
    if (drained) this.pendingSubagentTasks.delete(parentAgentId);
    // 탭 도트 동기화는 pending 이 남아 있어도(다른 자식이 계속 도는 중) 매번 재평가한다.
    const subChanged = this.syncBgSubStatus(parentAgentId);
    return { drained, subChanged };
  }

  /**
   * §5.5 #17-9 ⑦(a) — 자식 안의 도구 이벤트(훅 `agent_id`, 부모와 같은 `session_id`)를 그 항목에 얹는다.
   * 짝: ① 같은 `agentId` 각인 ② `agent_type` = `subagent_type` 인 각인 전 최고령 ③ 각인 전 최고령 — 없으면 아무것도 안 한다.
   * @returns 표시가 바뀌었으면 true.
   */
  noteSubagentChildActivity(
    parentAgentId: string,
    info: { agentId?: string; agentType?: string; toolName?: string; toolTarget?: string },
  ): boolean {
    const m = this.pendingSubagentTasks.get(parentAgentId);
    if (!m || m.size === 0) return false;
    this.pendingSubagentLastSignal.set(parentAgentId, Date.now());

    let target: PendingSubagentEntry | undefined;
    if (info.agentId) {
      for (const e of m.values()) {
        if (e.agentId === info.agentId) { target = e; break; }
      }
    }
    if (!target && info.agentType) {
      target = oldestOf(m, (e) => e.agentId === undefined && e.subagentType === info.agentType);
    }
    if (!target) {
      target = oldestOf(m, (e) => e.agentId === undefined);
    }
    if (!target) return false;

    if (info.agentId && target.agentId !== info.agentId) target.agentId = info.agentId;
    if (info.agentType) target.agentType = info.agentType;
    target.lastActivityAt = Date.now();
    if (!info.toolName) return true;
    target.toolCount = (target.toolCount ?? 0) + 1;
    target.currentTool = info.toolName;
    if (info.toolTarget) target.currentToolDetail = info.toolTarget;
    else delete target.currentToolDetail;
    return true;
  }

  /**
   * §5.5 #17-9 ⑦(b) — `PostToolUse(Task|Agent)` 의 최종 보고를 보관하고, 아직 pending 이면(Stop 유실) 내린다.
   * ⑧ 배경 스폰의 응답은 "띄웠다" 접수증이라 내리지 않는다(내리면 활동바가 `(0)`) — `SubagentStop` 만 내린다.
   * @param background 배경 스폰이었나 — 항목의 표식이 우선, 이건 폴백.
   * @returns 표시가 바뀌었으면 true.
   */
  noteSubagentTaskResult(
    parentAgentId: string,
    toolUseId: string | undefined,
    result: string | undefined,
    background?: boolean,
  ): boolean {
    // 이 이벤트도 "살아 있다" 신호다 — 종전에 `noteSubagentSignal` 이 하던 일을 여기서 이어받는다
    // (안 하면 다른 자식들의 quiet-window 기준 시각이 이 분기에서만 갱신되지 않는다).
    this.noteSubagentSignal(parentAgentId);
    const m = this.pendingSubagentTasks.get(parentAgentId);
    const pending = toolUseId ? m?.get(toolUseId) : undefined;
    if (pending) {
      if (pending.background || background === true) {
        // ⑧ 접수증 — 아직 도는 중이다. 대차대조도, "끝난 것" 꼬리도 건드리지 않는다.
        logger.info(`[bg-subagent] launch ack (background) parent=${parentAgentId} key=${toolUseId} pending=${m?.size ?? 0}`);
        return false;
      }
      this.noteSubagentTaskStop(parentAgentId, toolUseId as string, result);
      return true;
    }
    if (!result) return false;

    const list = this.finishedSubagentTasks.get(parentAgentId);
    if (!list || list.length === 0) return false;
    const byId = toolUseId ? list.find((t) => t.id === toolUseId) : undefined;
    const slot = byId ?? list.find((t) => t.result === undefined);
    if (!slot) return false;
    slot.result = result;
    return true;
  }

  /** §5.5 #17-9 ⑦(b) — 내려간 항목을 "방금 끝난 것" 꼬리로 옮긴다(새 것이 앞, 상한 초과분은 버림). */
  private archiveSubagentTask(
    parentAgentId: string, id: string, e: PendingSubagentEntry, result?: string,
    /** §5.5 #17-9 ⑭ — 무엇 때문에 내려갔는가. 정상 보고(`notification`)면 굳이 적지 않는다. */
    closedBy?: FinishedSubagentTask['closedBy'],
  ): void {
    // §5.5 #17-9 ⑦(b) — 결과 없이 내려가는 항목은 트랜스크립트에서 건진다([중지]·탭 닫기·크래시엔 훅이 안 온다 — `subagentResultRescue.ts`).
    const rescued = result ? undefined : this.rescueLostSubagentResult(id, e);
    const finished: FinishedSubagentTask = {
      id,
      parentAgentId,
      ...(e.subId ? { subAgentId: e.subId } : {}),
      ...(e.description ? { description: e.description } : {}),
      ...(e.subagentType ? { subagentType: e.subagentType } : {}),
      ...(e.agentType ? { agentType: e.agentType } : {}),
      startedAt: e.ts,
      endedAt: Date.now(),
      ...(e.toolCount ? { toolCount: e.toolCount } : {}),
      ...(closedBy ? { closedBy } : {}),
      ...(result ? { result } : {}),
      ...(rescued ? { result: rescued, resultRescued: true } : {}),
    };
    this.pushFinishedTask(parentAgentId, finished);
  }

  /** "방금 끝난 것" 꼬리에 한 장 얹는다(새 것이 앞, 상한 초과분은 버림). 훅 항목과 스트림 항목이 함께 쓴다. */
  private pushFinishedTask(parentAgentId: string, finished: FinishedSubagentTask): void {
    const list = this.finishedSubagentTasks.get(parentAgentId) ?? [];
    list.unshift(finished);
    if (list.length > MAX_FINISHED_SUBAGENT_TASKS) list.length = MAX_FINISHED_SUBAGENT_TASKS;
    this.finishedSubagentTasks.set(parentAgentId, list);
  }

  /** §5.5 #17-9 ⑦(b) — 트랜스크립트에서 최종 보고를 건진다. 소유 세션(`subId`)을 아는 항목만 — 남의 보고를 붙이는 것이 빈 카드보다 나쁘다. 실패는 `undefined`. */
  private rescueLostSubagentResult(id: string, e: PendingSubagentEntry): string | undefined {
    if (!e.subId) return undefined;
    const sessionId = this.index.get(e.subId)?.sessionId;
    if (!sessionId) return undefined;
    const text = rescueSubagentResult(sessionId, {
      toolUseId: id,
      ...(e.agentId ? { agentId: e.agentId } : {}),
    });
    if (text) {
      logger.info(`[bg-subagent] result rescued from transcript parent-key=${id} sub=${e.subId} chars=${text.length}`);
    }
    return text;
  }

  /** §5.5 #17-9 ⑦(b) — "방금 끝난 것" 스냅샷 투영. 하나도 없으면 필드 자체를 생략한다. */
  getFinishedSubagentTasks(): Record<string, FinishedSubagentTask[]> | undefined {
    if (this.finishedSubagentTasks.size === 0) return undefined;
    const out: Record<string, FinishedSubagentTask[]> = {};
    for (const [parentAgentId, list] of this.finishedSubagentTasks) {
      if (list.length > 0) out[parentAgentId] = list;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /** §5.3 #12-1 — 그 밖의 훅 이벤트는 생존 신호 — 마지막 신호 시각만 갱신. */
  noteSubagentSignal(parentAgentId: string): void {
    if (this.pendingSubagentTasks.has(parentAgentId)) {
      this.pendingSubagentLastSignal.set(parentAgentId, Date.now());
    }
  }

  /**
   * §5.3 #12-1 — 완료 강등 차단: 이 에이전트가 띄운 서브에이전트가 아직 도는가. **조용함은 죽음의 증거가 아니다**(긴 빌드·루프 대기).
   * 회수 근거는 종료 신고(`SubagentStop`/`PostToolUse`)와 세션 프로세스 소멸 둘뿐. 시간 기준은 소유 탭 미상 항목의 누수 상한 하나.
   */
  hasPendingSubagentTasks(parentAgentId: string): boolean {
    const m = this.pendingSubagentTasks.get(parentAgentId);
    if (!m || m.size === 0) return false;
    const now = Date.now();
    for (const [key, e] of m) {
      if (e.subId) continue; // 프로세스로 판정할 수 있다 — 시간으로 걷지 않는다.
      if (now - e.ts <= PENDING_SUBAGENT_MAX_AGE_MS) continue;
      m.delete(key);
      logger.warn(`[bg-subagent] max-age expired parent=${parentAgentId} key=${key} (소유 탭 미상 — 프로세스로 판정할 수 없는 항목의 누수 방지 상한)`);
    }
    if (m.size === 0) {
      this.pendingSubagentTasks.delete(parentAgentId);
      // 누수 안전장치로 pending 이 풀렸으면 승격해 둔 탭 도트도 함께 원위치(파란 점 고착 방지).
      this.syncBgSubStatus(parentAgentId);
      return false;
    }
    return true;
  }

  /** §5.5 #17-9 — 대차대조의 IDE 표시 투영. 없으면 `undefined` 로 필드를 생략한다(활동바 항목·배지가 사라진다). 런타임 전용. */
  getRunningSubagentTasks(): Record<string, RunningSubagentTask[]> | undefined {
    // **읽기만 한다.** 걷기는 `sweepOrphanedBackgroundTasks` 몫 — 여기서 걷으면 이미 계산된 버블과 한 스냅샷 안에서 어긋난다.
    const out: Record<string, RunningSubagentTask[]> = {};
    // 스트림 기반 백그라운드 작업을 먼저 깐다 — 훅이 보지 못하는 것들이라 이게 없으면
    //   그 작업을 기다리는 세션이 화면에서 "끝난 것"이 된다(§5.3 #12-1).
    for (const [parentAgentId, list] of this.collectLiveBackgroundTasks()) {
      out[parentAgentId] = list;
    }
    for (const [parentAgentId, m] of this.pendingSubagentTasks) {
      if (m.size === 0) continue;
      const list: RunningSubagentTask[] = [];
      for (const [id, e] of m) {
        list.push({
          id,
          parentAgentId,
          ...(e.subId ? { subAgentId: e.subId } : {}),
          ...(e.description ? { description: e.description } : {}),
          ...(e.subagentType ? { subagentType: e.subagentType } : {}),
          ...(e.prompt ? { prompt: e.prompt } : {}),
          startedAt: e.ts,
          // §5.5 #17-9 ⑦(a) — 자식이 실제로 도구를 쓰기 시작한 뒤에만 채워지는 것들.
          ...(e.agentId ? { agentId: e.agentId } : {}),
          ...(e.agentType ? { agentType: e.agentType } : {}),
          ...(e.currentTool ? { currentTool: e.currentTool } : {}),
          ...(e.currentToolDetail ? { currentToolDetail: e.currentToolDetail } : {}),
          ...(e.toolCount ? { toolCount: e.toolCount } : {}),
          ...(e.lastActivityAt ? { lastActivityAt: e.lastActivityAt } : {}),
        });
      }
      // 스트림 쪽이 먼저 깔려 있을 수 있으므로 합친다(둘은 서로 다른 작업이라 중복이 아니다 —
      //   같은 자식을 두 번 세지 않도록 `listDisplayableLiveTasks` 가 Task/Agent 칩을 이미 뺐다).
      const prev = out[parentAgentId];
      out[parentAgentId] = prev ? [...prev, ...list] : list;
    }
    // 오래 돈 것이 위로 — 사용자가 "제일 오래 붙잡고 있는 자식"을 먼저 본다.
    for (const list of Object.values(out)) list.sort((a, b) => a.startedAt - b.startedAt);
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /** 스트림 칩으로만 보이는 백그라운드 작업(`Bash run_in_background`·`Monitor` — 훅 대차대조는 Task 만 본다)을 부모별로 모은다. 없으면 기다리는 세션이 완료로 보인다. */
  private collectLiveBackgroundTasks(): Map<string, RunningSubagentTask[]> {
    const byParent = new Map<string, RunningSubagentTask[]>();
    for (const [subId, state] of this.turnSealStates) {
      const sub = this.index.get(subId);
      if (!sub) continue;
      const tasksDir = sub.sessionId ? resolveSessionTasksDir(sub.sessionId) : null;
      for (const { id, info } of listDisplayableLiveTasks(state)) {
        const list = byParent.get(sub.parentAgentId) ?? [];
        // §5.5 #17-9 ⑭ — "얼마나 조용한가"와 "물어본 결과"를 같은 자리에서 함께 싣는다.
        //   조용한 시간은 출력 파일 mtime 하나뿐이라(훅은 셸을 못 본다) 여기서 붙이지 않으면
        //   화면은 시작 시각만 알고 "멈춘 건지 도는 건지"는 영영 말하지 못한다.
        const lastOutputAt = tasksDir ? readTaskOutputState(tasksDir, id)?.lastOutputAtMs : undefined;
        const probeState = this.probeStates.get(probeKey(sub.id, id));
        list.push({
          id,
          parentAgentId: sub.parentAgentId,
          subAgentId: sub.id,
          ...(info.description ? { description: info.description } : {}),
          startedAt: info.startedAt,
          origin: 'stream',
          ...(lastOutputAt ? { lastOutputAt } : {}),
          ...(this.probesInFlight.has(probeKey(sub.id, id)) ? { probing: true } : {}),
          ...(probeState?.result ? { probe: probeState.result } : {}),
        });
        byParent.set(sub.parentAgentId, list);
      }
    }
    return byParent;
  }

  /**
   * §5.5 #17-9 ⑭ — 표식 없이 오래 조용한 작업 하나를 모델에게 묻는다(⓪·① 뒤 남은 자리 — 실측 전형이 정당한 대기다).
   * 비동기라 sweep 밖 — 한 건만 띄우고 즉시 반환(기다리면 5초 루프가 멈춘다). 예산이 안전장치: 동시 1건 · 시간당 상한 · 지수 백오프(anthropics/claude-code#55151).
   */
  maybeProbeQuietBackgroundTasks(now: number = Date.now()): void {
    const settings = this.bgTaskProbeSettings;
    if (!settings.enabled || settings.quietMinutes <= 0) return;
    if (this.probesInFlight.size >= BG_TASK_PROBE_CONCURRENCY) return;
    // 시간당 상한 — 지난 한 시간의 기록만 남기고 센다.
    this.probeHistory = this.probeHistory.filter((t) => now - t < 3_600_000);
    if (this.probeHistory.length >= BG_TASK_PROBE_MAX_PER_HOUR) return;

    const candidate = this.pickQuietTaskForProbe(now, settings.quietMinutes);
    if (!candidate) return;

    const key = probeKey(candidate.subId, candidate.taskId);
    this.probesInFlight.add(key);
    this.probeHistory.push(now);
    logger.info(`[bg-probe] 조사 착수 sub=${candidate.subId} key=${candidate.taskId} quiet=${candidate.evidence.quietMin}분 desc=${candidate.evidence.description ?? '-'}`);
    this.onSubStatusChange?.(candidate.parentAgentId); // "확인 중" 을 곧바로 화면에

    void runBackgroundTaskProbe(candidate.evidence, settings.model)
      .then((result) => this.applyProbeVerdict(candidate, result, settings))
      .catch((err) => { logger.warn(`[bg-probe] 판정 중 예외 — 항목은 그대로 둔다: ${String(err)}`); })
      .finally(() => {
        this.probesInFlight.delete(key);
        this.onSubStatusChange?.(candidate.parentAgentId);
      });
  }

  /** 조사할 항목 하나 — 가장 오래 조용한 스트림 작업(표식 없음 · 임계 초과 · 명령을 트랜스크립트에서 읽을 수 있음). 건너뛰면 사유를 로그로(⑰) — 조용히 빠지면 못 쫓는다. */
  private pickQuietTaskForProbe(
    now: number,
    quietMinutes: number,
  ): { subId: string; parentAgentId: string; taskId: string; command: string; sessionPid?: number; evidence: ProbeEvidence } | null {
    let best: { subId: string; parentAgentId: string; taskId: string; command: string; sessionPid?: number; evidence: ProbeEvidence } | null = null;

    for (const [subId, state] of this.turnSealStates) {
      if (state.liveTasks.size === 0) continue;
      const sub = this.index.get(subId);
      if (!sub?.sessionId) continue;
      const tasksDir = resolveSessionTasksDir(sub.sessionId, undefined, now);
      if (!tasksDir) continue;

      let shells: ReturnType<typeof scanActiveBackgroundShells> | null = null;
      for (const { id, info } of listDisplayableLiveTasks(state)) {
        const out = readTaskOutputState(tasksDir, id);
        // 파일이 없으면 조용한 시간을 잴 시계가 없고, 표식이 있으면 ⓪ 이 이미 답을 냈다.
        if (!out || out.end) continue;
        const quietMin = Math.floor((now - out.lastOutputAtMs) / 60_000);
        const key = probeKey(subId, id);
        const st = this.probeStates.get(key);
        // `alive` 로 나온 항목은 조용한 시간이 배수만큼 더 길어져야 다시 묻는다(지수 백오프).
        const threshold = quietMinutes * (st?.thresholdMult ?? 1);
        if (quietMin < threshold) continue;
        if (best && quietMin <= best.evidence.quietMin) continue;

        // 명령 원문은 그 세션 트랜스크립트에만 있다 — 한 세션당 한 번만 훑는다(증분 캐시).
        if (shells === null) {
          const cwd = this.projectResolver?.(sub.parentAgentId)?.path;
          if (!cwd) break;
          try {
            shells = scanActiveBackgroundShells(getSessionJsonlPath(cwd, sub.sessionId));
          } catch {
            shells = [];
          }
        }
        const shell = shells.find((s) => s.shellId === id);
        if (!shell) {
          // 명령을 모르면 판정할 근거가 없다 — 건너뛰되 **한 번은 남긴다**(조용한 건너뜀 ❌).
          const missKey = probeKey(subId, id);
          if (!this.probeCommandMissLogged.has(missKey)) {
            this.probeCommandMissLogged.add(missKey);
            capSetSize(this.probeCommandMissLogged, SESSION_KEYED_MAP_MAX);
            logger.warn(
              '[bg-probe] 명령 원문을 못 찾아 조사 제외 sub=' + subId + ' key=' + id
              + ' quiet=' + quietMin + '분 (트랜스크립트에 짝이 없다 — 승격 셸이면 스캔 관문을 의심하라)',
            );
          }
          continue;
        }

        best = {
          subId,
          parentAgentId: sub.parentAgentId,
          taskId: id,
          command: shell.command,
          ...(this.runningChildren.get(subId)?.pid ? { sessionPid: this.runningChildren.get(subId)!.pid as number } : {}),
          evidence: {
            taskId: id,
            ...(info.description ? { description: info.description } : {}),
            command: shell.command,
            startedAgoMin: Math.max(0, Math.floor((now - info.startedAt) / 60_000)),
            quietMin,
            outputBytes: (() => { try { return fs.statSync(shell.outputPath).size; } catch { return 0; } })(),
            outputTail: readOutputTail(shell.outputPath),
            paths: collectPathFacts(shell.command, now, process.platform),
          },
        };
      }
    }
    return best;
  }

  /**
   * §5.3 #9-2 (C-1) — 끊긴 셸 작업의 **남은 프로세스**를 거둔다. 매칭은 ⑭(e) 와 같은 함수(`terminateTaskProcesses` —
   * 세션 자손 중 명령을 담은 것 + 부모가 죽은 고아 중 인자가 명령의 일부인 것)라 판정이 두 벌이 되지 않는다.
   * 명령 원문을 못 찾거나 목록을 못 뜨면 **아무것도 하지 않는다**(모른다 ≠ 없다).
   */
  private async reapStoppedTaskProcesses(sub: SubAgent, subId: string, taskId: string): Promise<void> {
    if (!processGuard.isReapEnabled()) return;
    try {
      const sessionPid = this.runningChildren.get(subId)?.pid;
      const cwd = this.projectResolver?.(sub.parentAgentId)?.path;
      if (!sessionPid || !cwd || !sub.sessionId) return;
      const command = findBackgroundShellCommand(getSessionJsonlPath(cwd, sub.sessionId), taskId);
      if (!command) return;
      const killed = await terminateTaskProcesses(sessionPid, command);
      if (killed && killed > 0) {
        logger.info(`[process-guard] stopped task left ${killed} process(es) — reaped sub=${subId} key=${taskId}`);
        processGuard.reportTaskReaped({ parentAgentId: sub.parentAgentId, subAgentId: subId }, killed);
      }
    } catch (err) {
      logger.warn(`[process-guard] reaping stopped task failed sub=${subId} key=${taskId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 판정을 반영한다. **모르면 손대지 않는다** — `null`·`unknown`·`alive` 는 전부 항목을 남긴다.
   */
  private async applyProbeVerdict(
    candidate: { subId: string; parentAgentId: string; taskId: string; command: string; sessionPid?: number },
    result: BackgroundTaskProbeResult | null,
    settings: BackgroundTaskProbeSettings,
  ): Promise<void> {
    const key = probeKey(candidate.subId, candidate.taskId);
    if (!result) {
      // 답을 못 받았다 — 다음 회차에 곧바로 다시 묻지 않도록 간격만 벌린다.
      this.bumpProbeBackoff(key);
      return;
    }
    this.probeStates.set(key, {
      result,
      thresholdMult: result.verdict === 'finished'
        ? 1
        : Math.min(BG_TASK_PROBE_BACKOFF_MAX, (this.probeStates.get(key)?.thresholdMult ?? 1) * BG_TASK_PROBE_BACKOFF_FACTOR),
    });
    capMapSize(this.probeStates, SESSION_KEYED_MAP_MAX);
    logger.info(`[bg-probe] 판정 sub=${candidate.subId} key=${candidate.taskId} → ${result.verdict} · ${result.reason}`);

    if (result.verdict !== 'finished' || !settings.autoClose) return;

    const state = this.turnSealStates.get(candidate.subId);
    const info = state?.liveTasks.get(candidate.taskId);
    if (!state || !info) return; // 그 사이에 스스로 끝났다 — 정상 경로다.

    // 장부를 내리기 **전에** 프로세스를 끊는다. 순서를 뒤집으면 실패했을 때 그 사실을 카드에 못 적는다.
    let killedProcesses: number | null = null;
    if (settings.killProcess) {
      killedProcesses = await terminateTaskProcesses(candidate.sessionPid, candidate.command);
    }
    if (!state.liveTasks.delete(candidate.taskId)) return; // 그 사이 다른 경로가 내렸다
    this.archiveStreamTask(
      candidate.parentAgentId, candidate.subId, candidate.taskId, info, Date.now(), undefined,
      { closedBy: 'probe', probe: result, ...(killedProcesses !== null ? { killedProcesses } : {}) },
    );
    this.probeStates.delete(key);
    logger.info(`[bg-probe] 정리 완료 sub=${candidate.subId} key=${candidate.taskId} · 프로세스 ${killedProcesses ?? '미확인'}개`);
    this.syncBgSubStatus(candidate.parentAgentId);
  }

  /** 답을 못 받았을 때의 간격 벌리기 — 같은 항목에 판정을 반복해 태우지 않는다. */
  private bumpProbeBackoff(key: string): void {
    const prev = this.probeStates.get(key);
    this.probeStates.set(key, {
      ...(prev?.result ? { result: prev.result } : {}),
      thresholdMult: Math.min(BG_TASK_PROBE_BACKOFF_MAX, (prev?.thresholdMult ?? 1) * BG_TASK_PROBE_BACKOFF_FACTOR),
    });
    capMapSize(this.probeStates, SESSION_KEYED_MAP_MAX);
  }

  /** §5.5 #17-9 ⑭(g) — 사용자 설정 주입(머신 단위). 끄면 조사 자체를 하지 않는다. */
  setBackgroundTaskProbeSettings(settings: BackgroundTaskProbeSettings): void {
    this.bgTaskProbeSettings = settings;
  }

  /** 테스트·진단용 — 지금 걸린 판정 상태를 그대로 본다. */
  getBackgroundTaskProbeState(subId: string, taskId: string): BackgroundTaskProbeResult | undefined {
    return this.probeStates.get(probeKey(subId, taskId))?.result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // §2.4 — "실행중…"을 에이전트가 직접 확인한다
  // ─────────────────────────────────────────────────────────────────────────

  /** §2.4 — 사용자 설정 주입(머신 단위). 끄면 판정 자체를 하지 않는다(모델 호출 0). */
  setSessionProbeSettings(settings: SessionLivenessProbeSettings): void {
    this.sessionProbeSettings = settings;
  }

  /** 테스트·진단용 — 그 세션에 걸린 마지막 판정. */
  getSessionProbeState(subId: string): SessionLivenessProbeResult | undefined {
    return this.sessionProbeStates.get(subId)?.result;
  }

  /** §2.4 — 도는 중으로 표시된 세션 하나를 에이전트에게 묻는다. `hasLivingWork` 참인 것만(거짓이면 기존 장치가 걷었다). 비동기 — 한 건 띄우고 즉시 반환. */
  maybeProbeRunningSessions(
    queues: Map<string, QueuedCommand[]>,
    now: number = Date.now(),
  ): void {
    const settings = this.sessionProbeSettings;
    if (!settings.enabled) return;
    if (this.sessionProbesInFlight.size >= SESSION_PROBE_CONCURRENCY) return;
    this.sessionProbeHistory = this.sessionProbeHistory.filter((t) => now - t < 3_600_000);
    if (this.sessionProbeHistory.length >= SESSION_PROBE_MAX_PER_HOUR) return;

    const candidate = this.pickSessionForProbe(queues, now, settings.quietMinutes);
    if (!candidate) return;

    this.sessionProbesInFlight.add(candidate.subId);
    this.sessionProbeHistory.push(now);
    const sub = this.index.get(candidate.subId);
    if (sub) sub.probing = true;
    logger.info(
      `[session-probe] 확인 착수 sub=${candidate.subId} quiet=${candidate.evidence.quietMin ?? '?'}분 `
      + `label=${candidate.evidence.label ?? '-'}`,
    );
    this.onSubStatusChange?.(candidate.parentAgentId); // "확인 중" 을 곧바로 화면에

    void runSessionLivenessProbe(candidate.evidence, settings.model)
      .then((result) => { this.applySessionProbeVerdict(candidate, result, settings, queues); })
      .catch((err) => { logger.warn(`[session-probe] 판정 중 예외 — 세션은 그대로 둔다: ${String(err)}`); })
      .finally(() => {
        this.sessionProbesInFlight.delete(candidate.subId);
        const after = this.index.get(candidate.subId);
        if (after) delete after.probing;
        this.onSubStatusChange?.(candidate.parentAgentId);
      });
  }

  /** 명령은 큐 전체에서 `cmd.subAgentId` 로 찾는다 — `commandQueues` 키(훅 세션 id)와 `SubAgent.sessionId`(CLI UUID)는 다른 namespace 라 후자로 조회하면 늘 빈다. */
  private commandsOfSub(queues: Map<string, QueuedCommand[]>, subId: string): QueuedCommand[] {
    const out: QueuedCommand[] = [];
    for (const queue of queues.values()) {
      for (const cmd of queue) { if (cmd.subAgentId === subId) out.push(cmd); }
    }
    return out;
  }

  /** 판정에는 표시용 겹침 제거를 쓰지 않는다. 소유 미상인 자식도 이 탭의 작업일 수 있다. */
  private sessionProbeTasks(sub: SubAgent): { live: [string, LiveTaskInfo][]; pending: [string, PendingSubagentEntry][] } {
    return {
      live: [...(this.turnSealStates.get(sub.id)?.liveTasks ?? [])],
      pending: [...(this.pendingSubagentTasks.get(sub.parentAgentId) ?? [])]
        .filter(([, task]) => !task.subId || task.subId === sub.id),
    };
  }

  private sessionProbeTranscript(sub: SubAgent, now: number): ReturnType<typeof resolveSessionTranscript> {
    if (!sub.sessionId) return null;
    const preferEngine = this.agentConfigResolver?.(sub.parentAgentId)?.provider?.kind === 'codex-cli'
      ? ('codex' as const) : undefined;
    return resolveSessionTranscript(sub.sessionId, undefined, now, preferEngine ? { preferEngine } : undefined);
  }

  /** 모델 응답이 올 때도 같은 턴·대화록·작업을 보고 있는지 대조한다. 시간 경과 자체는 변화가 아니다. */
  private sessionProbeFingerprint(
    sub: SubAgent,
    queues: Map<string, QueuedCommand[]>,
    transcript: NonNullable<ReturnType<typeof resolveSessionTranscript>>,
  ): string {
    return JSON.stringify({
      sessionId: sub.sessionId, status: sub.status, activity: sub.lastActivityAt,
      transcript: [transcript.file, transcript.bytes, transcript.mtimeMs],
      commands: this.commandsOfSub(queues, sub.id).map((cmd) => [cmd.id, cmd.status, cmd.timestamp, cmd.startedAt]),
      tasks: this.sessionProbeTasks(sub),
      processAlive: this.isSubRunning(sub.id), processing: this.isSubProcessingCommand(sub.id),
      dispatching: this.dispatchingSubs.has(sub.id), deferred: this.deferredSeals.has(sub.id),
      noticeResume: this.noticeResumeHolds.has(sub.id),
      deliveredNotices: this.turnSealStates.get(sub.id)?.deliveredNotices ?? 0,
    });
  }

  /** 물어볼 세션 하나 — 가장 오래 조용한 것(`active` · `hasLivingWork` · 대화록 있음 · 임계 초과). 대화록이 없어 건너뛰면 사유를 로그로. */
  private pickSessionForProbe(
    queues: Map<string, QueuedCommand[]>,
    now: number,
    quietMinutes: number,
  ): { subId: string; parentAgentId: string; evidence: SessionProbeEvidence; fingerprint: string } | null {
    let best: { subId: string; parentAgentId: string; evidence: SessionProbeEvidence; fingerprint: string } | null = null;

    for (const sub of this.index.values()) {
      if (sub.status !== 'active') continue;
      // 기존 다섯 장치가 걷을 수 있는 자리면 그쪽에 맡긴다 — 두 축이 같은 세션을 다투면 안 된다.
      if (!this.hasLivingWork(sub.id)) continue;
      if (this.sessionProbesInFlight.has(sub.id)) continue;
      if (!sub.sessionId) continue;
      // §4 엔진 다리 — 엔진이 직접 "턴이 돌고, 최근에 진척이 있다"고 말하는 세션은 물을 이유가 없다.
      //   진척이 오래 끊긴 턴은 보증하지 않으므로 아래로 내려가 종전대로 묻는다(멈춘 턴 찾기는 판정의 몫).
      if (engineBridge.vouchesRunning(sub.id, now)) continue;

      // §5.25 (F) — 엔진마다 대화록이 놓이는 자리가 다르다. 코덱스면 그 규칙을 먼저 본다
      //   (힌트는 순서일 뿐 배제가 아니라, 설정이 바뀐 세션도 나머지 규칙에서 찾는다).
      const tx = this.sessionProbeTranscript(sub, now);
      if (!tx) {
        logger.info(`[session-probe] sub=${sub.id} 대화록을 못 찾아 건너뜀 (session=${sub.sessionId})`);
        continue;
      }

      let quietMin = Math.floor((now - tx.mtimeMs) / 60_000);
      const st = this.sessionProbeStates.get(sub.id);
      // `working` 으로 나온 세션은 조용한 시간이 배수만큼 더 길어져야 다시 묻는다(지수 백오프).
      const threshold = quietMinutes * (st?.thresholdMult ?? 1);
      if (quietMin < threshold) continue;
      // 수정 시각이 멈춘 대화록이 있다(Windows 코덱스 롤아웃은 생성 시각 그대로다) — 임계를 넘어 보일
      //   때만 마지막 줄의 시각으로 다시 잰다. 1초 전에 줄을 쓴 턴이 "8분 조용"으로 닫히던 자리다.
      const lastWriteAt = transcriptLastWriteMs(tx.file, tx.mtimeMs, now);
      quietMin = Math.floor((now - lastWriteAt) / 60_000);
      if (quietMin < threshold) continue;
      // §4 엔진 다리 (D)① — 턴 가장자리만 진척으로 센다(`tool.call` 은 막을 수 있는 훅이라 2.1.299 부터 답이 없으면 도구가 거부된다).
      // 다리가 턴이 돈다고 하면 대화록이 30분 조용할 때만 묻는다.
      if (engineBridge.vouchesRunning(sub.id, now, lastWriteAt)) continue;
      if (best && best.evidence.quietMin !== undefined && quietMin <= best.evidence.quietMin) continue;

      const tasks = this.sessionProbeTasks(sub);
      const queue = this.commandsOfSub(queues, sub.id);
      // §4 엔진 다리 — 다리가 붙어 있으면 엔진이 말한 사실을 증거 한 줄로 싣는다(없으면 종전 증거 그대로).
      const engine = engineBridge.sessionFacts(sub.id, now);
      best = {
        subId: sub.id,
        parentAgentId: sub.parentAgentId,
        fingerprint: this.sessionProbeFingerprint(sub, queues, tx),
        evidence: {
          subId: sub.id,
          ...(sub.label ? { label: sub.label } : {}),
          startedAgoMin: Math.max(0, Math.floor((now - sub.createdAt) / 60_000)),
          quietMin,
          transcriptBytes: tx.bytes,
          tail: summarizeTranscriptTail(tx.file),
          // 두 장부의 관측을 모두 싣는다. 같은 작업이 겹쳐도 '없다'는 오판을 막는 근거다.
          runningTaskCount: tasks.live.length + tasks.pending.length,
          queuedCommandCount: queue.filter((c) => c.status === 'queued').length,
          processAlive: this.isSubRunning(sub.id),
          ...(engine ? { engine: engine.line } : {}),
          ...(engine?.toolInFlight ? { lastTool: engine.toolInFlight } : {}),
        },
      };
    }
    return best;
  }

  /**
   * 판정을 반영한다. `finished` 만 세션을 내리고, `stuck` 은 **화면에 세우기만 한다** —
   * 멈춘 것처럼 보이는 세션과 긴 빌드를 기다리는 멀쩡한 세션은 증거로 구분되지 않아서,
   * 우리가 정하면 남의 작업을 죽인다(판단은 사용자 몫).
   */
  private applySessionProbeVerdict(
    candidate: { subId: string; parentAgentId: string; fingerprint: string; evidence?: { tail?: string } },
    result: SessionLivenessProbeResult | null,
    settings: SessionLivenessProbeSettings,
    queues: Map<string, QueuedCommand[]>,
  ): void {
    if (!this.sessionProbeSettings.enabled) return;
    const sub = this.index.get(candidate.subId);
    const transcript = sub && this.sessionProbeTranscript(sub, Date.now());
    if (!sub || !transcript || this.sessionProbeFingerprint(sub, queues, transcript) !== candidate.fingerprint) {
      logger.info(`[session-probe] 오래된 판정 무시 sub=${candidate.subId} — 진단 중 세션 근거가 바뀜`);
      return;
    }
    if (!result) {
      // 답을 못 받았다 — 다음 회차에 곧바로 다시 묻지 않도록 간격만 벌린다.
      this.bumpSessionProbeBackoff(candidate.subId);
      return;
    }
    const tasks = this.sessionProbeTasks(sub);
    if (result.verdict === 'finished' && (tasks.live.length > 0 || tasks.pending.length > 0
      || this.dispatchingSubs.has(sub.id) || this.deferredSeals.has(sub.id) || this.noticeResumeHolds.has(sub.id)
      || isCodexTurnRunning(sub.id)
      // §4 엔진 다리 — 엔진이 직접 "턴이 돈다"고 말하는 동안 모델의 해석으로 닫지 않는다.
      || engineBridge.isTurnRunning(sub.id))) {
      // 모델 해석은 실제 진행 작업·재개 대기보다 강한 근거가 못 된다. 코덱스 `exec` 이 살아 있으면 턴이 안 끝났다 — 닫으면 다음 명령이
      // `already has an active writer` 로 거절된다(실측 2026-10-02). 멎은 턴은 워치독(§5.25 (F))이 닫는다.
      logger.info(`[session-probe] 종료 판정 거부 sub=${candidate.subId} — 살아 있는 작업 또는 재개 대기가 남음`);
      this.bumpSessionProbeBackoff(candidate.subId);
      return;
    }
    if (result.verdict === 'finished' && candidate.evidence && !candidate.evidence.tail) {
      // 꼬리를 못 읽었으면 모델이 본 것은 "없음"뿐 — 끝남의 근거가 아니다(§2.4).
      logger.info(`[session-probe] 종료 판정 거부 sub=${candidate.subId} — 대화록 꼬리를 못 읽음(근거 없음)`);
      this.bumpSessionProbeBackoff(candidate.subId);
      return;
    }
    this.sessionProbeStates.set(candidate.subId, {
      result,
      // `finished` 는 곧 내려가므로 배수를 늘릴 이유가 없다. 나머지는 지수로 벌린다.
      thresholdMult: result.verdict === 'finished'
        ? 1
        : Math.min(
          SESSION_PROBE_BACKOFF_MAX,
          (this.sessionProbeStates.get(candidate.subId)?.thresholdMult ?? 1) * SESSION_PROBE_BACKOFF_FACTOR,
        ),
    });
    capMapSize(this.sessionProbeStates, SESSION_KEYED_MAP_MAX);

    sub.probe = result;
    logger.info(`[session-probe] 판정 sub=${candidate.subId} → ${result.verdict} · ${result.reason}`);

    if (result.verdict !== 'finished' || !settings.autoClose || !this.sessionProbeSettings.autoClose) return;
    if (sub.status !== 'active') return; // 그 사이 스스로 끝났다 — 정상 경로다.

    // 상태를 내리면서 **붙들려 있던 명령도 함께 푼다.** 하나만 하면 그 탭은 "쉬는 중"으로 보이면서
    // 새 명령은 못 받는 자리에 갇힌다(`sealZombieExecutingCommands` 가 지키는 것과 같은 짝).
    const closedAt = Date.now();
    sub.status = 'idle';
    sub.lastActivityAt = closedAt;
    for (const cmd of this.commandsOfSub(queues, sub.id)) {
      if (cmd.status !== 'executing') continue;
      cmd.status = 'completed';
      cmd.result = `[확인] 에이전트 판정으로 종료: ${result.reason}`;
      // §2.4 — 대신 닫은 턴은 끝 사유를 남긴다 — 비면 진짜 완료와 구별할 수 없다.
      this.stampTurnStopReason(sub, cmd, { userStopped: false, disconnected: true });
      this.failIfDispatchResultMissing(sub, cmd);
    }
    logger.info(`[session-probe] 종료 sub=${candidate.subId} · ${result.reason}`);
    this.onSubStatusChange?.(candidate.parentAgentId);
  }

  /** 답을 못 받았을 때의 간격 벌리기 — 같은 세션에 판정을 반복해 태우지 않는다. */
  private bumpSessionProbeBackoff(subId: string): void {
    const prev = this.sessionProbeStates.get(subId);
    this.sessionProbeStates.set(subId, {
      ...(prev?.result ? { result: prev.result } : {}),
      thresholdMult: Math.min(SESSION_PROBE_BACKOFF_MAX, (prev?.thresholdMult ?? 1) * SESSION_PROBE_BACKOFF_FACTOR),
    });
    capMapSize(this.sessionProbeStates, SESSION_KEYED_MAP_MAX);
  }

  /** 사용자가 턴을 끊었을 때 스트림 백그라운드 장부와 `deliveredNotices` 를 비운다 — 끊긴 자식은 끝 통지가 없어 유령으로 다음 턴에 섞인다. */
  private clearLiveBackgroundTasks(subAgentId: string): void {
    const state = this.turnSealStates.get(subAgentId);
    if (!state) return;
    if (state.liveTasks.size === 0 && state.deliveredNotices === 0) return;
    logger.info(`[bg-subagent] clearing ${state.liveTasks.size} live stream task(s) for stopped sub=${subAgentId}`);
    state.liveTasks.clear();
    state.deliveredNotices = 0;
  }

  /**
   * 세션 프로세스가 끝났다 = 그 백그라운드 작업도 끝났다(주 경로). `claude -p` 는 결과 뒤 ~5초에 배경 셸을 끝내고 배경 서브에이전트는 끝날 때까지 기다린다
   * (공식 문서 "Background tasks at exit"). 남은 것은 꼬리로.
   * @returns 내린 것이 있으면 true.
   */
  retireLiveBackgroundTasks(subAgentId: string, now: number = Date.now()): boolean {
    const state = this.turnSealStates.get(subAgentId);
    if (!state || state.liveTasks.size === 0) return false;
    const sub = this.index.get(subAgentId);
    for (const [id, info] of state.liveTasks) {
      logger.info(`[bg-subagent] session process ended — retiring live stream task sub=${subAgentId} key=${id} desc=${info.description ?? '-'}`);
      // 세션 프로세스가 끝나며 함께 걷힌 것이다 — 스스로 끝난 것이 아니므로 카드에 그렇게 적는다(⑭).
      if (sub) this.archiveStreamTask(sub.parentAgentId, subAgentId, id, info, now, undefined, { closedBy: 'process-gone' });
    }
    state.liveTasks.clear();
    state.deliveredNotices = 0;
    if (sub) this.syncBgSubStatus(sub.parentAgentId);
    return true;
  }

  /**
   * 스트림 칩 1건을 "방금 끝난 것" 꼬리로 옮긴다 — 훅 항목의 `archiveSubagentTask` 와 짝.
   * @param end §5.5 #17-9 ⑬ 파일 표식으로 회수한 경우의 종료 사실(있으면 결과 칸을 채운다).
   */
  private archiveStreamTask(
    parentAgentId: string,
    subAgentId: string,
    id: string,
    info: LiveTaskInfo,
    endedAt: number,
    end?: TaskEndMarker,
    /**
     * §5.5 #17-9 ⑭ — **무엇 때문에** 내려갔는가와, 판정으로 내렸다면 그 판정.
     * 내리는 길이 여럿인데 카드가 전부 똑같이 "끝남"으로만 보이면, 사용자는 자동으로 닫힌 것과
     * 스스로 끝난 것을 구별할 수 없다 — 그 구별이 없으면 자동 정리는 신뢰를 잃는다.
     */
    closure?: {
      closedBy?: FinishedSubagentTask['closedBy'];
      probe?: BackgroundTaskProbeResult;
      killedProcesses?: number;
    },
  ): void {
    this.pushFinishedTask(parentAgentId, {
      id,
      parentAgentId,
      subAgentId,
      ...(info.description ? { description: info.description } : {}),
      // 도는 동안 `collectLiveBackgroundTasks` 가 붙여 주던 표식을 끝난 뒤에도 그대로 들고 간다 —
      //   이게 빠지면 "방금 끝난 것" 칸에서 셸이 서브에이전트로 둔갑한다.
      origin: 'stream',
      ...(end?.kind === 'exited' ? { exitCode: end.exitCode } : {}),
      ...(end?.kind === 'killed' ? { killed: true } : {}),
      ...(closure?.closedBy ? { closedBy: closure.closedBy } : {}),
      ...(closure?.probe ? { probe: closure.probe } : {}),
      ...(closure?.killedProcesses !== undefined ? { killedProcesses: closure.killedProcesses } : {}),
      startedAt: info.startedAt,
      endedAt,
    });
  }

  /** 끊기면 잃는 일의 요약 — 앱 닫기 전에 물을지의 근거. 대화는 `--resume` 으로 잇지만 그 턴이 만들던 결과물은 안 돌아온다. 묻는 것은 데스크톱 쪽. */
  getRunningWorkSummary(): { sessions: number; backgroundTasks: number; labels: string[] } {
    const labels: string[] = [];
    for (const sub of this.index.values()) {
      if (!this.isSubProcessingCommand(sub.id)) continue;
      labels.push(sub.label);
    }
    let backgroundTasks = 0;
    for (const m of this.pendingSubagentTasks.values()) backgroundTasks += m.size;
    for (const state of this.turnSealStates.values()) {
      backgroundTasks += listDisplayableLiveTasks(state).length;
    }
    return { sessions: labels.length, backgroundTasks, labels };
  }

  /**
   * 실행 목록에서 그 항목만 내린다 — **프로세스는 안 죽인다**(CLI 가 밖에서 끊을 수단을 안 준다). 세션·버블이 완료로 갈 수 있게, 훅·스트림 장부 양쪽에서.
   * @returns 내렸으면 true.
   */
  dismissRunningTask(parentAgentId: string, taskId: string): boolean {
    const m = this.pendingSubagentTasks.get(parentAgentId);
    const hit = m?.get(taskId);
    if (m && hit) {
      m.delete(taskId);
      // 결과 없이 "방금 끝난 것" 꼬리로 옮긴다 — 소리 없이 사라지면 사용자가 무엇이 사라졌는지 모른다.
      this.archiveSubagentTask(parentAgentId, taskId, hit, undefined, 'user');
      if (m.size === 0) this.pendingSubagentTasks.delete(parentAgentId);
      logger.info(`[bg-subagent] dismissed by user parent=${parentAgentId} key=${taskId}`);
      this.syncBgSubStatus(parentAgentId);
      return true;
    }
    // 스트림 칩 쪽 — 이 에이전트에 속한 sub 들의 장부를 훑어 같은 id 를 내린다.
    for (const [subId, state] of this.turnSealStates) {
      if (this.index.get(subId)?.parentAgentId !== parentAgentId) continue;
      const info = state.liveTasks.get(taskId);
      if (!info || !state.liveTasks.delete(taskId)) continue;
      // 훅 항목과 달리 여기는 **그냥 지우고 끝**이었다. 같은 목록의 같은 × 를 눌렀는데 한쪽은 꼬리에
      //   남고 한쪽은 흔적 없이 사라지면 사용자는 무엇이 사라졌는지 되짚을 수 없다. ⑭ 로 닫는 길이
      //   늘어난 지금은 더더욱, **누가 내렸는지**가 카드에 남아야 자동 정리와 구별된다.
      this.archiveStreamTask(parentAgentId, subId, taskId, info, Date.now(), undefined, { closedBy: 'user' });
      logger.info(`[bg-subagent] dismissed stream task by user parent=${parentAgentId} sub=${subId} key=${taskId}`);
      this.syncBgSubStatus(parentAgentId);
      return true;
    }
    return false;
  }

  /**
   * 프로세스가 사라진 세션의 백그라운드 표시를 걷는 그물 — CLI 가 없어 끝 통지가 안 오는 자리. 주 경로는 끝 통지와 프로세스 종료 이벤트(`retireLiveBackgroundTasks`).
   * **시간으로 판정하지 않는다** — 근거는 "프로세스가 없으면 자식도 없다" 하나. 제외 목록은 `reconcileDeadActiveSubs` 와 같다. 소유 미상 훅 항목은 절대 상한 몫.
   * @returns 정리한 부모 id 목록.
   */
  sweepOrphanedBackgroundTasks(now: number = Date.now()): string[] {
    const touched = new Set<string>();

    // ⓪ 끝났다고 적힌 것은 걷는다(⑬ · `backgroundTaskOutput.ts`) — 상주 세션에선 ①② 가 성립하지 않는다. 근거가 하니스의 종료 표식이라 도는 작업을 끝냈다고 틀릴 수 없다.
    for (const [subId, state] of this.turnSealStates) {
      if (state.liveTasks.size === 0) continue;
      const sub = this.index.get(subId);
      if (!sub?.sessionId) continue;
      const tasksDir = resolveSessionTasksDir(sub.sessionId, undefined, now);
      if (!tasksDir) continue; // 폴더를 못 찾음 = 힌트 없음 — 조용히 종전 동작으로.
      for (const { id, info } of listDisplayableLiveTasks(state)) {
        const probe = readTaskOutputState(tasksDir, id);
        if (!probe?.end) continue;
        // 끝난 시각은 **파일이 마지막으로 바뀐 때**다. "우리가 알아챈 때"로 적으면 카드에 10분 부푼
        //   소요 시간이 남는다. 시작보다 앞설 수는 없으므로 하한을 건다.
        const endedAt = Math.max(info.startedAt, Math.min(probe.lastOutputAtMs, now));
        state.liveTasks.delete(id);
        this.archiveStreamTask(sub.parentAgentId, subId, id, info, endedAt, probe.end, { closedBy: 'end-marker' });
        const how = probe.end.kind === 'killed' ? 'killed' : `exit=${probe.end.exitCode}`;
        // §5.3 #9-2 (C-1) — `[killed]` 면 남은 프로세스도 거둔다(장부만 걷으면 산다 — 실측 2026-10-12, grep 하나가 5시간 72GB).
        // `exited with code N` 은 둔다 — 일부러 남긴 데몬일 수 있다.
        if (probe.end.kind === 'killed') void this.reapStoppedTaskProcesses(sub, subId, id);
        logger.info(`[bg-subagent] end-marker swept sub=${subId} key=${id} ${how} desc=${info.description ?? '-'} (출력 파일이 종료를 적었다 — 끝 통지 미도달)`);
        touched.add(sub.parentAgentId);
      }
    }

    // ① 스트림 칩 장부 — 훅이 못 보는 백그라운드 작업.
    for (const [subId, state] of this.turnSealStates) {
      const sub = this.index.get(subId);
      if (!sub) {
        // 탭이 사라졌는데 장부만 남았다 — 통째로 회수(누수 방지).
        this.turnSealStates.delete(subId);
        continue;
      }
      if (state.liveTasks.size === 0) continue;
      if (!this.isSessionProcessGone(subId)) continue;
      for (const { id, info } of takeOrphanLiveTasks(state, now)) {
        logger.warn(`[bg-subagent] orphan stream task swept sub=${subId} key=${id} desc=${info.description ?? '-'} (세션 프로세스 없음 — 종료 이벤트를 놓친 자리)`);
        this.archiveStreamTask(sub.parentAgentId, subId, id, info, now, undefined, { closedBy: 'process-gone' });
        touched.add(sub.parentAgentId);
      }
    }

    // ② 훅 대차대조 — 소유 탭을 아는 항목만. 결과는 `archiveSubagentTask` 가 트랜스크립트에서 건져 본다.
    for (const [parentAgentId, m] of this.pendingSubagentTasks) {
      for (const [key, e] of m) {
        if (!e.subId) continue;
        if (now - (e.lastActivityAt ?? e.ts) <= LIVE_TASK_ORPHAN_GRACE_MS) continue;
        if (!this.isSessionProcessGone(e.subId)) continue;
        m.delete(key);
        this.archiveSubagentTask(parentAgentId, key, e);
        logger.warn(`[bg-subagent] orphan task swept parent=${parentAgentId} key=${key} sub=${e.subId} (세션 프로세스 없음 — SubagentStop 미도달)`);
        touched.add(parentAgentId);
      }
      if (m.size === 0) {
        this.pendingSubagentTasks.delete(parentAgentId);
        this.pendingSubagentLastSignal.delete(parentAgentId);
      }
    }

    // ③ **소유 탭이 미상이라 ② 가 판정할 수 없는 항목**의 누수 방지 상한만 여기서 함께 돌린다.
    //    `hasPendingSubagentTasks` 가 그 상한을 그 안에서 처리하므로 호출 자체가 정리다. 조용함으로
    //    걷던 창(30분)은 폐기됐으므로, 이 호출이 도는 자식을 끝난 것으로 만들 수는 없다.
    for (const parentAgentId of [...this.pendingSubagentTasks.keys()]) {
      const before = this.pendingSubagentTasks.get(parentAgentId)?.size ?? 0;
      this.hasPendingSubagentTasks(parentAgentId);
      if ((this.pendingSubagentTasks.get(parentAgentId)?.size ?? 0) !== before) touched.add(parentAgentId);
    }

    // 승격해 둔 탭 도트를 함께 원위치 — 안 하면 장부만 비고 파란 점이 남는다.
    for (const parentAgentId of touched) this.syncBgSubStatus(parentAgentId);
    return [...touched];
  }

  /**
   * 이 세션에 **지금 아무 프로세스도 없는가** — 위 고아 판정의 유일한 근거.
   * `reconcileDeadActiveSubs` 의 제외 목록과 같은 사실을 본다: PTY(CMD) 세션은 우리가 띄운 자식이
   * 아니고, 스폰 진행 중이거나 잠정 봉인을 붙들어 둔 창은 "곧 도는" 자리라 죽었다고 말할 수 없다.
   */
  private isSessionProcessGone(subId: string): boolean {
    if (this.cmdDrivenSubs.has(subId)) return false;
    if (this.dispatchingSubs.has(subId)) return false;
    if (this.deferredSeals.has(subId)) return false;
    return !this.isSubRunning(subId) && !this.isSubProcessingCommand(subId);
  }

  /**
   * 스트림으로 보이는 모델 자식을 기다리는가 — 버블 완료 판정용(⑮). **셸은 세지 않는다**(⑰ — 셸 하나가 버블을 영원히 붙들면 안 된다).
   * 회수 축(`hasLiveBackgroundWork`·`hasLivingWork`)은 셸까지 센다 — `--resume` 이 못 살리는 명령을 죽이지 않게.
   */
  hasLiveBackgroundTasks(parentAgentId: string): boolean {
    for (const [subId, state] of this.turnSealStates) {
      if (this.index.get(subId)?.parentAgentId !== parentAgentId) continue;
      if (hasLiveAgentTasks(state)) return true;
    }
    return false;
  }

  /** §5.3 #12-1 — 중지·정리 때 대차대조를 즉시 비운다. */
  clearPendingSubagentTasks(parentAgentId: string): void {
    // §5.5 #17-9 ⑦(b) — 사용자가 중지시킨 자식도 "이 자식은 끝났다"는 사실은 같다. 결과 없이 꼬리로
    //   옮겨 화면에서 소리 없이 사라지지 않게 한다(quiet-window/max-age 안전장치 경로는 제외 —
    //   그쪽은 정말 끝났는지 우리가 모르는 자리다).
    const m = this.pendingSubagentTasks.get(parentAgentId);
    if (m) {
      for (const [key, e] of m) this.archiveSubagentTask(parentAgentId, key, e);
    }
    if (this.pendingSubagentTasks.delete(parentAgentId)) {
      logger.info(`[bg-subagent] cleared pending parent=${parentAgentId}`);
    }
    this.pendingSubagentLastSignal.delete(parentAgentId);
    // 승격해 둔 탭 도트도 함께 원위치 — 중지/정리 후 파란 점이 남지 않게.
    this.syncBgSubStatus(parentAgentId);
  }

  /**
   * §5.5 #17-10 — 그 탭(`subId`)이 띄운 항목만 지운다(부모 전체를 지우면 다른 탭 것까지 사라진다). 소유 미상 항목은 건드리지 않는다(절대 상한 몫).
   * @returns 지운 항목 수.
   */
  clearPendingSubagentTasksForSession(parentAgentId: string, subId: string): number {
    const m = this.pendingSubagentTasks.get(parentAgentId);
    if (!m || m.size === 0) return 0;
    let removed = 0;
    for (const [key, e] of m) {
      if (e.subId === subId) {
        m.delete(key);
        // ⑦(b) — 세션 스코프 중지도 같은 이유로 꼬리에 남긴다.
        this.archiveSubagentTask(parentAgentId, key, e);
        removed++;
      }
    }
    if (removed > 0) {
      logger.info(`[bg-subagent] cleared pending parent=${parentAgentId} sub=${subId} removed=${removed} left=${m.size}`);
    }
    // 남은 게 없을 때만 부모 엔트리·quiet-window 기준 시각을 정리한다 — 다른 탭 항목이 남아 있으면
    // 그 항목들의 생존 판정(lastSignal)을 여기서 없애면 안 된다.
    if (m.size === 0) {
      this.pendingSubagentTasks.delete(parentAgentId);
      this.pendingSubagentLastSignal.delete(parentAgentId);
    }
    // 승격해 둔 탭 도트 재평가 — 이 세션 것만 빠졌으니 다른 탭 도트는 그대로 유지된다.
    this.syncBgSubStatus(parentAgentId);
    return removed;
  }

  /** 우리가 스폰한 sub 의 세션인가 — 훅 캡처 입구가 이걸로 새 훅 버블을 만들지 않고 부모 버블에 귀속한다(증식 차단). `agentViewSessionId` 포함. */
  isManagedSession(sessionId: string): boolean {
    if (!sessionId) return false;
    for (const s of this.index.values()) {
      if (s.sessionId === sessionId || s.agentViewSessionId === sessionId) return true;
    }
    return false;
  }

  /** 커스텀 에이전트의 정규 대화 sub(sessionId 있는 것 → 가장 오래된 것). 이 하나를 재사용해야 `--resume` 연속성이 유지된다. */
  getPrimarySub(parentAgentId: string): SubAgent | undefined {
    const subs = this.registry.get(parentAgentId) ?? [];
    if (subs.length === 0) return undefined;
    return subs.find((s) => !!s.sessionId) ?? subs[0];
  }

  /** 병합 복원 — 기존 데이터에 추가 (프로젝트별 체크포인트 병합용).
   *  project 인자: cp.project. 해당 프로젝트의 sub-streams 디렉토리에서만 스트림을 읽는다.
   *  archived 인자: 아카이브도 함께 병합(동일 parentAgentId가 아직 없을 때만). */
  mergeSnapshot(
    data: Record<string, SubAgent[]>,
    counter: number,
    project?: ProjectInfo,
    archived?: Record<string, SubAgent[]>,
  ): void {
    subCounter = Math.max(subCounter, counter);
    for (const [agentId, subs] of Object.entries(data)) {
      if (this.registry.has(agentId)) continue;
      const items = subs.map((s) => {
        const item = { ...s, status: (s.status === 'active' ? 'idle' : s.status) as SubAgent['status'] };
        // §2.4 (잠듦) — 런타임 표식이다. 부팅 직후엔 회수해 둔 자식 자체가 없으므로 걷고 시작한다
        //   (남겨 두면 프로세스가 없는 다른 세션들과 표시가 어긋난다).
        delete item.dormant;
        delete item.dormantSince;
        // §4 (CMD ①②) — blocked·전경 프로세스도 **런타임 표식**이다. 부팅 직후엔 PTY 자체가
        //   없으므로 남겨 두면 "막혀 있다"고 거짓말한다(dormant 와 같은 이유로 걷고 시작한다).
        //   `paneTree` 는 그 탭의 **표시 상태**라 그대로 살린다.
        delete item.blocked;
        delete item.blockedSince;
        delete item.blockedReason;
        delete item.foregroundProcess;
        // §5.5 #17-24 ⑥ — 압축 중 표식도 런타임 표식이다. 부팅 직후엔 접는 자식이 없다(남기면 영영 "압축 중").
        delete item.compactingSince;
        return item;
      });
      this.registry.set(agentId, items);
      const dir = project ? streamBufferStore.subStreamsDir(project, agentId) : null;
      // restore 와 같은 이유로 폴더를 기억해 둔다(소속 해석이 끊긴 동안의 쓰기·읽기 폴백).
      if (dir && !this.lastKnownAgentStreamDirs.has(agentId)) this.lastKnownAgentStreamDirs.set(agentId, dir);
      for (const s of items) {
        this.index.set(s.id, s);
        if (dir && !this.streamBuffers.has(s.id)) {
          const buf = streamBufferStore.loadBuffer(dir, s.id, MAX_STREAM_BUFFER);
          if (buf.length > 0) {
            this.streamBuffers.set(s.id, buf);
            if (!this.lastKnownStreamDirs.has(s.id)) this.lastKnownStreamDirs.set(s.id, dir);
          }
        }
      }
    }
    if (archived) {
      for (const [agentId, subs] of Object.entries(archived)) {
        if (this.archive.has(agentId)) continue;
        if (subs.length === 0) continue;
        this.archive.set(agentId, subs.map((s) => ({ ...s, status: 'idle' as const })));
      }
    }
  }

  /**
   * 실행 표시를 실제 생존과 대조한다(시간 기준 `sweepIdle` 이 아니라 사실로). 자식·워처·처리 중 턴·봉인·백그라운드 자식이 모두 없으면 끝. 제외 목록은 `hasLivingWork`.
   * @returns 강등한 sub.id 목록.
   */
  reconcileDeadActiveSubs(): string[] {
    const demoted: string[] = [];
    for (const sub of this.index.values()) {
      if (sub.status !== 'active') continue;
      if (this.hasLivingWork(sub.id)) continue;

      sub.status = 'idle';
      // 상태 정리는 새 활동이 아니다. 시각을 갱신하면 바로 뒤 좀비 봉합이 같은 멎은 턴을
      // 방금 움직인 것으로 읽어 실행 잠금을 남긴다(살아 있는 자식/in-flight가 있는 경우).
      demoted.push(sub.id);
      logger.info(`SubAgent ${sub.id} was 'active' with no live work — reconciled to idle`);
    }
    return demoted;
  }

  /**
   * 살아 있는 일감이 있는가 — 상태 강등(`reconcileDeadActiveSubs`)과 명령 봉합(`sealZombieExecutingCommands`)이 반드시 같은 답을 쓴다
   * (갈리면 탭이 쉬는데 명령을 못 받는다). `sweepOrphanedBackgroundTasks` 제외 목록도 맞춘다.
   */
  private hasLivingWork(subId: string, now: number = Date.now()): boolean {
    // PTY(CMD) 세션 — 우리가 띄운 자식이 아니라 사용자가 치는 터미널이다. 상태는 훅이 몰고 가므로
    //   (`markCmdSubActivity`) 자식 유무로 판단할 수 없다.
    if (this.cmdDrivenSubs.has(subId)) return true;
    // 스폰 진행 중 — `active` 를 올린 직후 자식/워처 등록 전의 창.
    if (this.dispatchingSubs.has(subId)) return true;
    // 붙들어 둔 잠정 봉인 — 곧 이어질 수 있는 턴이라 우리가 일부러 끝을 미뤄 둔 것이다.
    if (this.deferredSeals.has(subId)) return true;
    // 자기 턴은 끝났어도 이 탭이 띄운 백그라운드 Task 가 남아 있으면 여전히 활동 중이다
    // (`syncBgSubStatus` 가 올려 둔 그 active 를 여기서 도로 내리면 도트가 깜빡인다).
    if (this.bgPromotedSubs.has(subId)) return true;
    // 스트림으로 보이는 백그라운드 작업도 같은 자격 — 끝나면 이 세션이 다시 깨어난다.
    //   거르지 않는다(§5.5 #17-9 ⑮ — 표시 목록을 생존 판정에 빌려 쓰면 증인이 사라진다).
    const seal = this.turnSealStates.get(subId);
    if (seal && hasLiveTasks(seal)) return true;
    // 자식·워처가 살아 있거나 한 턴을 처리 중이면 **대개는** 진짜로 도는 중이다 — 다만
    //   "살아 있다"와 "일하고 있다"는 같은 말이 아니다(아래 `isTurnStreamStalled`).
    if (this.isSubRunning(subId) || this.isSubProcessingCommand(subId)) {
      return !this.isTurnStreamStalled(subId, now);
    }
    return false;
  }

  /**
   * 프로세스 생존과 실제 일을 가르는 축(`TURN_STREAM_STALL_MS`) — in-flight 표식만 보면 출력이 끊긴 턴이 `busy` 로 영원히 잠긴다. 근거는 모든 경로에서 갱신되는 `lastActivityAt`.
   * 30분은 마지막 그물이라서다(워치독 20분·프로브 10분이 먼저) — 도는 세션을 죽이는 쪽이 더 나쁘다.
   */
  private isTurnStreamStalled(subId: string, now: number = Date.now()): boolean {
    const sub = this.index.get(subId);
    if (!sub) return false;
    const last = sub.lastActivityAt;
    if (typeof last !== 'number' || !Number.isFinite(last)) return false;
    return now - last >= TURN_STREAM_STALL_MS;
  }

  /**
   * 좀비 `executing` 봉합 — dispatch 가 `executing` sub 를 `busy` 로 잠가 완료 신호 하나만 잃어도 탭이 영영 막히므로 5초 스윕이 되돌린다.
   * 안전 3중: 소유 탭이 분명 · 나간 지 `graceMs` 경과 · `hasLivingWork` 거짓(PTY·백그라운드·봉인 유예 포함).
   * @param queues 세션별 명령 큐(호출자 소유).
   * @returns 봉합한 명령 + 세션 id — 큐에서 빼 아카이브로 옮기는 것은 호출자 몫.
   */
  sealZombieExecutingCommands(
    queues: Map<string, QueuedCommand[]>,
    graceMs: number,
    now: number = Date.now(),
  ): Array<{ sessionId: string; cmd: QueuedCommand }> {
    const sealed: Array<{ sessionId: string; cmd: QueuedCommand }> = [];
    for (const [sessionId, queue] of queues) {
      for (const cmd of queue) {
        if (cmd.status !== 'executing') continue;
        const subId = cmd.subAgentId;
        if (!subId) continue;
        // 나간 적이 없는 명령(`startedAt` 없음)은 애초에 이 상태로 굳을 수 없다 — 건드리지 않는다.
        if (!cmd.startedAt || now - cmd.startedAt < graceMs) continue;
        if (this.hasLivingWork(subId, now)) continue;

        // 왜 끊겼는지를 detail 이 말한다 — 자식이 아예 없었던 것과, 자식은 살아 있는데 출력이
        //   멎은 것은 사용자에게 전혀 다른 사건이다(뒤쪽은 CLI·MCP 쪽을 봐야 한다).
        const stalled = this.isTurnStreamStalled(subId, now);
        cmd.status = 'error';
        cmd.result = '[orphaned] 실행이 끊긴 뒤 완료 신호가 오지 않아 자동 종료 처리됨.';
        this.markCommandError(subId, cmd, {
          code: 'orphaned',
          detail: stalled ? 'stream stalled past live-work threshold' : 'no live work after grace',
        });
        const sub = this.index.get(subId);
        if (sub && sub.status === 'active') {
          sub.status = 'idle';
          // 한 좀비를 걷은 것이 새 활동은 아니다. 같은 탭의 다른 좀비도 같은 근거로 걷어야 한다.
        }
        sealed.push({ sessionId, cmd });
        logger.warn(
          `Zombie executing sealed: cmd=${cmd.id} sub=${subId} `
          + `(stuck ${Math.round((now - cmd.startedAt) / 1000)}s with no live work)`,
        );
      }
    }
    return sealed;
  }

  /**
   * §2.4 (잠듦) — 오래 쉰 claude 자식을 회수한다(실측: 11세션 5.5GB, CPU 0%). 캐시는 이미 만료(5분 TTL)라 아끼는 것은 부팅 수 초뿐 — 다음 명령은 `--resume` 으로 잇는다.
   * 반드시 `intentionalKill` 로 마킹 — 안 하면 크래시로 읽혀 `error` 가 된다. 백그라운드 작업이 있으면 제외 — `--resume` 은 배경 Bash·Monitor 를 못 살린다(claude-code#68625).
   * @param thresholdMs 마지막 활동 뒤 이만큼 지나면 회수(`SUBAGENT_DORMANT_IDLE_MS`).
   * @param hasPendingWork 곧 쓸 자식인가(대기 명령·루프) — 매니저는 큐·루프를 모르므로 호출자가 준다.
   * @returns 재운 sub.id 목록.
   */
  sweepDormantIdleSubs(thresholdMs: number, hasPendingWork?: (subId: string) => boolean): string[] {
    if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return [];
    const now = Date.now();
    const slept: string[] = [];
    for (const sub of this.index.values()) {
      if (sub.dormant) continue;
      if (!sub.sessionId) continue; // 같은 대화로 재개할 근거가 없는 자식은 보존한다.
      const child = this.runningChildren.get(sub.id);
      if (!child) continue; // 회수할 프로세스가 애초에 없다
      // 이 자식이 **다음 턴을 기다리며 놀고 있는** persistent child 인가. ready=false 는 스폰 중이거나
      //   한 턴을 처리하는 중이라는 뜻이라 건드리지 않는다(legacy 자식도 여기서 걸러진다).
      if (this.persistentChildReady.get(sub.id) !== true) continue;
      // 이미 창구가 닫힌 자식은 남의 종료 경로가 처리 중이다(§5.5 #17-18).
      if (!isChildStdinWritable(child)) continue;

      // ── reconcileDeadActiveSubs 와 같은 제외 셋 ──
      if (this.cmdDrivenSubs.has(sub.id)) continue;
      if (this.dispatchingSubs.has(sub.id)) continue;
      if (this.deferredSeals.has(sub.id)) continue;
      if (this.isSubProcessingCommand(sub.id)) continue;
      if (this.persistentInFlightCmd.has(sub.id)) continue;
      if (this.runningAgentViewWatchers.has(sub.id)) continue;

      // ── 백그라운드가 살아 있으면 재우지 않는다(이 회수가 유일하게 되살리지 못하는 것) ──
      if (this.hasLiveBackgroundWork(sub)) continue;
      // §4 엔진 다리 — 우리 장부로는 놀고 있어도 엔진이 "턴이 돈다"고 말하면 재우지 않는다
      //   (백그라운드 끝 통지로 스스로 깨어난 턴처럼 우리가 보내지 않은 턴이 있다).
      if (engineBridge.isTurnRunning(sub.id, now)) continue;

      // 아직 나가지 않은 명령이나 켜져 있는 루프가 있으면 곧 쓸 자식이다.
      if (hasPendingWork?.(sub.id)) continue;

      if (now - sub.lastActivityAt <= thresholdMs) continue;

      this.intentionalKill.add(sub.id);
      sub.dormant = true;
      sub.dormantSince = now;
      // stdin.end() → SIGTERM → grace 후 트리 강제 종료(손자 MCP/worker 고아 방지).
      terminateChildTree(child);
      slept.push(sub.id);
      logger.info(
        `SubAgent ${sub.id} idle ${Math.round((now - sub.lastActivityAt) / 1000)}s — persistent child reclaimed (dormant; next turn resumes via --resume)`,
      );
    }
    return slept;
  }

  /**
   * §2.4 · §4 (모델 칸 ④) — `hasLiveBackgroundWork`: 자식 안에서 백그라운드 작업이 도는가. 잠듦 회수와 모델 갈아 끼우기가 같은 판정을 쓴다 —
   * `--resume` 은 배경 작업을 못 살리므로 한쪽에만 항목을 늘리면 다른 쪽이 죽인다. "이 턴" 사정(처리 중·dispatch)은 부르는 쪽 몫.
   */
  /** §5.5 #17-9 ⑰ — 상태를 올려도 되는가(≠ 회수). `hasLiveBackgroundWork`(회수 축, 셸 포함)의 거울로 모델 자식만 센다 — 섞으면 끝난 대화가 돌거나 도는 셸이 죽는다. */
  private hasLiveAgentBackgroundWork(sub: Pick<SubAgent, 'id' | 'parentAgentId'>): boolean {
    if (this.deferredSeals.has(sub.id)) return true;
    const seal = this.turnSealStates.get(sub.id);
    if (seal && hasLiveAgentTasks(seal)) return true;
    const pending = this.pendingSubagentTasks.get(sub.parentAgentId);
    if (pending && [...pending.values()].some((e) => e.subId === undefined || e.subId === sub.id)) return true;
    return false;
  }

  private hasLiveBackgroundWork(sub: Pick<SubAgent, 'id' | 'parentAgentId'>): boolean {
    if (this.bgPromotedSubs.has(sub.id)) return true;
    // 붙들어 둔 잠정 봉인 = 앞 턴의 배경 작업을 기다리는 중이다.
    if (this.deferredSeals.has(sub.id)) return true;
    const seal = this.turnSealStates.get(sub.id);
    if (seal && hasLiveTasks(seal)) return true;
    // 소유 미상 자식(③(c))이 있으면 이 부모의 어느 세션도 내리지 않는다 — 모르는 채 내리면 백단 서브에이전트가 통지 없이 죽는다.
    const pending = this.pendingSubagentTasks.get(sub.parentAgentId);
    if (pending && [...pending.values()].some((e) => e.subId === undefined || e.subId === sub.id)) return true;
    return false;
  }

  /**
   * §2.4 (잠듦) — 이 세션이 다시 쓰이면 표식을 걷는다. dispatch 시점과 스폰 시점 **양쪽**에서 부른다:
   * dispatch 에서 걷어야 사용자가 명령을 넣는 즉시 화면의 '잠듦'이 사라지고, 스폰에서도 걷어야
   * dispatch 를 거치지 않는 경로(재개·되태우기)가 표식을 남기지 않는다.
   */
  private wakeSub(sub: SubAgent): void {
    if (sub.dormant === undefined && sub.dormantSince === undefined) return;
    delete sub.dormant;
    delete sub.dormantSince;
  }

  /**
   * §5.5 #17-24 ⑥ — 스트림 줄이 압축 시작·끝을 말하면 `compactingSince` 를 세우고 걷는다(압축 2.4~6분은 줄이 없어 "생각 중"으로만 보인다).
   * 판정은 shared `readCompactionSignal`, 세 경로가 부른다.
   */
  private noteCompactionLine(sub: SubAgent, obj: unknown): void {
    const signal = readCompactionSignal(obj);
    if (signal) this.setCompacting(sub, signal === 'start');
  }

  /**
   * §5.5 #17-24 ⑥ — 훅으로 온 압축의 시작·끝(`PreCompact` → 시작, `PostCompact`·압축 뒤에 오는 사건 → 끝).
   * agent-view(JSONL)에는 status 줄이 없어 시작을 이 길로만 안다. 스트림과 겹치면 먼저 온 쪽이 세운다.
   */
  noteCompactionHook(subId: string, phase: 'start' | 'end'): void {
    const sub = this.index.get(subId);
    if (sub) this.setCompacting(sub, phase === 'start');
  }

  /**
   * 표식을 세우거나 걷고, **바뀌었을 때만** 화면을 민다. 이미 서 있으면 시각을 덮지 않는다 — 압축이
   * 시작된 시각이 라이브 1줄 경과의 기준이라, 두 번째 신호(훅 뒤의 status 줄)가 시계를 되감으면 안 된다.
   */
  private setCompacting(sub: SubAgent, on: boolean): void {
    if (on) {
      if (sub.compactingSince !== undefined) return;
      sub.compactingSince = Date.now();
    } else {
      if (sub.compactingSince === undefined) return;
      delete sub.compactingSince;
    }
    this.onSubStatusChange?.(sub.parentAgentId);
  }

  /**
   * §2.4 — 한도 통지 줄이면 표식을 세운다(CLI 는 합성 통지 한 줄 후 정상 종료해 없으면 초록 "끝남"). 판정은 shared `detectUsageLimitStop`.
   * 한 턴에 한 번만 — 같은 통지가 두 번 와 덮으면 `at` 이 밀린다. 걷는 곳은 `clearUsageLimit`·`acknowledgeUsageLimits`.
   * @returns 새로 섰으면 `true`.
   */
  private noteUsageLimitLine(sub: SubAgent, obj: unknown): boolean {
    if (sub.usageLimit) return false;
    const stop = detectUsageLimitStop(obj, Date.now());
    if (!stop) return false;
    sub.usageLimit = stop;
    sub.lastActivityAt = Date.now();
    // §4 API 크레딧 — 구독이 막혔다는 사실이 경로 판정의 재료다(크레딧 실행이 받은 통지는 구독 얘기가 아니다).
    if (!this.creditRuns.has(sub.id)) apiCreditService.noteSubscriptionLimit(stop);
    logger.warn(
      `SubAgent ${sub.id} stopped by ${stop.kind} limit${
        stop.resetsAt ? ` (resets ${new Date(stop.resetsAt).toISOString()})` : ''
      }: ${stop.message ?? ''}`,
    );
    this.onSubStatusChange?.(sub.parentAgentId);
    return true;
  }

  /**
   * §4 API 크레딧 — 이 턴의 결제 경로(크레딧이면 키, 아니면 null). 판정은 shared `decideCreditRoute` 하나. 금액 상한은 없다 — Console 이 정하고 Anthropic 이 거절한다.
   * 기능이 꺼져 있으면 아무것도 안 바꾼다. 켜져 있고 구독이면 키를 걷는다(`stripCreditKeyEnv`).
   */
  private resolveCreditRoute(sub: SubAgent, cmd: QueuedCommand): { key: string } | null {
    this.pendingCreditRoute.delete(sub.id);
    this.stripCreditKeyEnv.delete(sub.id);
    if (!apiCreditService.isEnabled()) return null;
    const toSubscription = (why: string): null => {
      cmd.billingRoute = 'subscription';
      this.stripCreditKeyEnv.add(sub.id);
      if (why) logger.info(`SubAgent ${sub.id} cmd=${cmd.id} billing → subscription (${why})`);
      return null;
    };
    const decision = apiCreditService.decide();
    if (decision.route !== 'credits') return toSubscription(decision.reason === 'blocked' ? 'Anthropic refused credits recently' : '');
    // 구독으로 떠서 놀던 자식에 백그라운드 작업이 살아 있으면 이번 턴은 그 자식으로 보낸다 — 크레딧으로 가려면
    //   자식을 갈아 끼워야 하는데, 그러면 그 자식의 백그라운드 셸·감시가 함께 죽는다(§5.5 #17-9 ⑩).
    if (this.persistentChildReady.get(sub.id) === true && this.hasLiveBackgroundWork(sub)) {
      return toSubscription('idle child still holds background work');
    }
    const key = apiCreditService.keyForSpawn();
    if (!key) return toSubscription('stored key is not readable on this machine');
    cmd.billingRoute = 'credits';
    this.pendingCreditRoute.set(sub.id, { cmdId: cmd.id });
    logger.info(`SubAgent ${sub.id} cmd=${cmd.id} billing → API credits (${decision.reason})`);
    return { key };
  }

  /**
   * §4 API 크레딧 — 스폰 env 마무리. 구독 경로로 정해진 스폰이면 키를 걷고, 크레딧 경로면 우리 키 하나만 남긴다
   * (Windows 의 다른 대소문자 이름까지 — `withCreditKeyEnv`). 기능이 꺼진 스폰은 손대지 않는다.
   */
  private creditSpawnEnv(subId: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    if (this.stripCreditKeyEnv.has(subId)) return withCreditKeyEnv(env, HOST_PLATFORM);
    const run = this.pendingCreditRoute.get(subId);
    const key = env['ANTHROPIC_API_KEY'];
    if (run && key !== undefined) return withCreditKeyEnv(env, HOST_PLATFORM, key);
    return env;
  }

  /**
   * §4 API 크레딧 — 이 자식이 크레딧 실행이면 그 줄을 서비스에 넘긴다(실패를 말한 result 줄에서 Anthropic 의 거절을
   * 읽는다). 금액은 세지 않는다 — Console 이 센다.
   */
  private noteCreditLine(sub: SubAgent, obj: unknown, child: ChildProcess): void {
    const run = this.creditRuns.get(sub.id);
    if (!run || run.child !== child) return;
    apiCreditService.noteRunLine(run.runId, obj);
  }

  /**
   * §4 API 크레딧 — 크레딧 실행을 닫는다(어떤 경로로 끝났든 한 번). stderr 꼬리에서 Anthropic 의 거절(잔액 부족·지출
   * 한도·키 거부)을 마지막으로 읽는다. 크레딧 실행이 아니었으면 undefined.
   */
  private settleCreditRun(sub: SubAgent): ApiCreditRunEnd | undefined {
    const run = this.creditRuns.get(sub.id);
    this.pendingCreditRoute.delete(sub.id);
    if (!run) return undefined;
    this.creditRuns.delete(sub.id);
    const stderrTail = this.childStderrTails.get(sub.id);
    if (stderrTail) apiCreditService.noteFailureText(run.runId, stderrTail);
    return apiCreditService.endRun(run.runId);
  }

  /**
   * §5.5 #17-12 ③-6 — 스트림 한 줄이 턴의 끝에 대해 말하면 그 명령의 장부에 적는다.
   * `tool_use` 처럼 "이어진다"는 줄은 적지 않는다 — 턴 안의 **마지막 끝 사유**만 남는다.
   */
  private noteTurnStopLine(cmdId: string | undefined, obj: unknown): void {
    if (!cmdId) return;
    const signal = readTurnStopSignal(obj);
    if (!signal) return;
    const prev = this.turnStopSignals.get(cmdId);
    const next: TurnStopSignal = {};
    const modelStop = signal.modelStop ?? prev?.modelStop;
    if (modelStop) next.modelStop = modelStop;
    if (signal.maxTurns || prev?.maxTurns) next.maxTurns = true;
    this.turnStopSignals.set(cmdId, next);
    // 봉인 없이 사라지는 턴(크래시·스폰 실패)의 몫이 쌓이지 않게 상한을 건다.
    capMapSize(this.turnStopSignals, SESSION_KEYED_MAP_MAX);
  }

  /**
   * §5.5 #17-12 ③-6 — 턴을 닫는 자리에서 끝 이유를 한 칸에 적는다. **`status` 가 정해진 뒤에** 부른다
   * (실패인지가 사실 하나다). 판정은 shared `resolveTurnStopReason` 한 곳이고, 이 자리는 사실을 모을 뿐이다.
   */
  private stampTurnStopReason(
    sub: SubAgent,
    cmd: QueuedCommand,
    facts: { userStopped: boolean; maxTurns?: boolean; modelStop?: ModelStopReason; disconnected?: boolean },
  ): void {
    const signal = this.turnStopSignals.get(cmd.id);
    this.turnStopSignals.delete(cmd.id);
    const reason = resolveTurnStopReason({
      userStopped: facts.userStopped,
      // `execute` 가 턴을 시작할 때 비우므로, 닫을 때 서 있으면 이 턴에 걸린 것이다.
      usageLimited: sub.usageLimit !== undefined,
      // §2.4 — **끝 신호가 오지 않아 우리가 닫은 턴.** 스스로 끝난 턴과 화면에서 갈라야 한다.
      disconnected: facts.disconnected === true,
      maxTurns: facts.maxTurns === true || signal?.maxTurns === true,
      modelStop: facts.modelStop ?? signal?.modelStop,
      failed: cmd.status === 'error',
    });
    if (reason) cmd.stopReason = reason;
    else delete cmd.stopReason;
  }

  /** §2.4 — 결과 본문으로 한 번 더 본다(legacy·agent-view 는 스트림을 놓칠 수 있다). 짧은 통지 한 줄만 인정 — 통지를 인용한 긴 답까지 세면 멀쩡한 세션이 주황이 된다. */
  private noteUsageLimitText(sub: SubAgent, text: string | undefined): void {
    if (!text || sub.usageLimit) return;
    const stop = detectUsageLimitInText(text, Date.now());
    if (!stop) return;
    sub.usageLimit = stop;
    if (!this.creditRuns.has(sub.id)) apiCreditService.noteSubscriptionLimit(stop);
    logger.warn(`SubAgent ${sub.id} stopped by ${stop.kind} limit (from turn result): ${stop.message ?? ''}`);
    this.onSubStatusChange?.(sub.parentAgentId);
  }

  /** §2.4 — 다음 명령이 나가면 표식을 걷는다. 시간으로 만료하지 않는다(풀려도 세션은 끊긴 자리다). 걷는 길은 이것과 `acknowledgeUsageLimits` 뿐. */
  private clearUsageLimit(sub: SubAgent): void {
    if (sub.usageLimit === undefined) return;
    delete sub.usageLimit;
  }

  /**
   * §2.4 — 사용자가 확인하면 표식을 걷는다(다시 돌리기 전이라도). 표식만 끈다 — 상태·결과·이력·스트림은 남는다. 클릭 전용 — 스윕은 타지 않는다.
   * @param subAgentIds 확인할 세션들(표식 없으면 건너뜀).
   * @returns 걷힌 sub.id 목록(비면 broadcast·저장 생략).
   */
  acknowledgeUsageLimits(subAgentIds: Iterable<string>): string[] {
    const cleared: string[] = [];
    const parents = new Set<string>();
    for (const id of subAgentIds) {
      const sub = this.index.get(id);
      if (!sub || sub.usageLimit === undefined) continue;
      delete sub.usageLimit;
      cleared.push(sub.id);
      parents.add(sub.parentAgentId);
    }
    // 부모 버블의 색은 sub 들에서 다시 계산되는 파생값이다 — 걷은 뒤 한 번 알려야 캔버스가 따라온다.
    //   부모별로 한 번만 부른다(세션 열 개가 한꺼번에 걷혀도 재계산은 부모 수만큼이면 된다).
    for (const parentAgentId of parents) this.onSubStatusChange?.(parentAgentId);
    if (cleared.length > 0) {
      logger.info(`Usage limit acknowledged: ${cleared.length} session(s) cleared (${cleared.join(', ')})`);
    }
    return cleared;
  }

  /** §2.4 (한도 정지) — 이 에이전트에서 한도로 멈춘 채 남은 세션 id. 확인 손짓 둘(한 줄 · 전부)이 같은 판정을 쓰게 여기 하나로 둔다. */
  listUsageLimitedSubIds(parentAgentId: string): string[] {
    return (this.registry.get(parentAgentId) ?? [])
      .filter((s) => s.usageLimit !== undefined)
      .map((s) => s.id);
  }

  /** `thresholdMs` 넘게 조용한 active/completed sub 를 idle 로 내리고 바뀐 id 를 돌려준다. */
  sweepIdle(thresholdMs: number): string[] {
    const now = Date.now();
    const changed: string[] = [];
    for (const sub of this.index.values()) {
      if (sub.status !== 'active' && sub.status !== 'completed') continue;
      // 살아 있는 자식/watcher 가 있는 sub 는 idle 로 내리지 않는다 — 활동 시각은 추측, `isSubRunning` 은 사실이다.
      // 없으면 5분 넘게 도는 명령이 idle 이 되고 `recomputeCustomAgentStatus` 가 부모 버블을 'completed' 로 바꿔 거짓 완료가 뜬다.
      if (this.isSubRunning(sub.id)) continue;
      // §4 엔진 다리 — 같은 원칙(확정이 이긴다). 엔진이 "턴이 돈다"고 말하면 활동 시각이 오래돼도
      //   내리지 않는다 — 훅 없이 긴 도구 하나를 도는 CMD 탭이 5분 뒤 '쉬는 중'으로 거짓 강등되던 자리.
      if (engineBridge.isTurnRunning(sub.id, now)) continue;
      if (now - sub.lastActivityAt > thresholdMs) {
        sub.status = 'idle';
        changed.push(sub.id);
      }
    }
    // 완료 처리에서 이미 idle이 된 Claude/Codex도 포함한다. 상태 전이와 캐시 수명은 별개다.
    this.sweepIdleStreamBuffers(thresholdMs);
    return changed;
  }

  /** 디스크에서 되살릴 수 있는 유휴 캐시만 회수한다. 대화·실패 상태는 바꾸지 않는다. */
  sweepIdleStreamBuffers(thresholdMs: number): string[] {
    if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return [];
    const now = Date.now();
    const released: string[] = [];
    for (const [subId, buffer] of this.streamBuffers) {
      const sub = this.index.get(subId);
      if (sub?.status === 'active') continue;
      // 아카이브/아직 복원되지 않은 세션도 힌트 조회로 캐시될 수 있다.
      const parentAgentId = sub?.parentAgentId ?? buffer[0]?.parentAgentId;
      if (this.cmdDrivenSubs.has(subId) || this.dispatchingSubs.has(subId)
        || this.runningAgentViewWatchers.has(subId) || this.isSubProcessingCommand(subId)
        || (!sub && this.runningChildren.has(subId))
        || (parentAgentId && this.hasLiveBackgroundWork({ id: subId, parentAgentId }))) continue;
      const lastUse = Math.max(sub?.lastActivityAt ?? 0, this.streamBufferAccessAt.get(buffer) ?? 0);
      if (now - lastUse <= thresholdMs) continue;
      // 저장 장애에서는 매 30초 스윕마다 재파싱하지 않고 한 유휴 구간 뒤에 다시 확인한다.
      this.streamBufferAccessAt.set(buffer, now);
      // 폴더 미확정·쓰기 실패로 메모리가 유일본일 수 있다. pending flush 뒤 복원분을
      // 확인하고, 빠진 줄이 하나라도 있으면 유지한다(파일 존재만으로는 충분하지 않다).
      if (buffer.length > 0) {
        const dir = parentAgentId ? this.findStreamDirFor(subId, parentAgentId) : null;
        if (!dir) continue;
        const restored = streamBufferStore.loadBuffer(dir, subId, MAX_STREAM_BUFFER);
        const persistedIds = new Set(restored.map((event) => event.id));
        if (buffer.some((event) => !persistedIds.has(event.id))) continue;
      }
      this.streamBuffers.delete(subId);
      this.streamDiskStamps.delete(subId);
      this.partialStreamBuffers.delete(subId);
      released.push(subId);
    }
    return released;
  }

  /**
   * §4 — CMD 세션 탭의 sub 상태를 hook 스트림으로 맞춘다(tool→active, Stop→idle). CMD hook 은 session_id 가 부모 버블로 바뀌므로
   * termId(`term:<agentId>:<subId>`) 끝의 sub.id 로 탭을 찾는다. `lastActivityAt` 도 밀어 idle sweep 의 거짓 강등을 막는다.
   * @returns 바뀌었으면 true(broadcast 판단용).
   */
  markCmdSubActivity(termId: string, isStop: boolean): boolean {
    const parsed = parseTermId(termId);
    if (!parsed) return false;
    const sub = this.index.get(parsed.sessionToken);
    if (!sub) return false; // 'main' 탭 등 sub 없는 termId → no-op
    // 이 탭은 PTY 로 도는 세션이다 — 우리가 띄운 자식이 없으므로 생존 대조에서 제외해야 한다.
    //   (표식이 없으면 "자식이 없으니 죽었다"로 오판해 멀쩡히 돌던 CMD 탭을 강등한다.)
    this.cmdDrivenSubs.add(sub.id);
    const prev = sub.status;
    sub.lastActivityAt = Date.now();
    if (isStop) {
      // 턴 종료 — "완료, 미확인"(idle=녹색). 다음 활동 이벤트가 오면 다시 active.
      // error 는 그대로 보존(거짓 idle 세탁 금지).
      if (sub.status === 'active') sub.status = 'idle';
    } else if (sub.status !== 'active') {
      sub.status = 'active';
    }
    return sub.status !== prev;
  }

  /**
   * §4 (CMD 터미널 업그레이드 ①) — 클라가 바이트 흐름에서 감지한 `working|idle|blocked` 를 서버가 확정한다(§3.1).
   * blocked 는 직교 플래그다(`SubAgentStatus` 를 늘리지 않는다): working→active · blocked→active + `blocked=true` · idle→idle(`error` 보존).
   * `cmdDrivenSubs` 도 붙인다(생존 대조·잠듦 회수 제외). `lastActivityAt` 은 working 에서만 민다 — 아니면 idle 판정이 스스로를 되살린다.
   * @returns 보이는 값이 바뀌었으면 true.
   */
  applyCmdTerminalSignal(signal: CmdTerminalSignal): boolean {
    const parsed = parseTermId(signal.termId);
    if (!parsed) return false;
    const sub = this.index.get(parsed.sessionToken);
    if (!sub) return false; // 'main' 탭 등 sub 없는 termId → no-op

    this.cmdDrivenSubs.add(sub.id);

    const prevStatus = sub.status;
    const prevBlocked = sub.blocked === true;
    const prevProcess = sub.foregroundProcess;

    if (signal.foregroundProcess) {
      sub.foregroundProcess = signal.foregroundProcess.slice(0, 64);
    }

    // ── pane 별 상태를 모아 **세션 하나의 결론**으로 합친다 ────────────────────
    // 분할 탭에서는 pane 마다 감지기가 따로 돌아 같은 sub 를 서로 덮어썼다 — pane A 가 blocked,
    // pane B 가 working 이면 탭 도트가 1초 간격으로 깜빡여 분할을 쓰는 순간 상태 표시가 무의미해졌다.
    const perPane = this.cmdPaneStates.get(sub.id) ?? new Map<string, { state: CmdTerminalState; reason?: string }>();
    perPane.set(parsed.paneId, signal.reason ? { state: signal.state, reason: signal.reason } : { state: signal.state });
    // 닫힌 pane 의 유령이 세션 상태를 붙들지 않게 정리한다. 트리가 진실이고, 트리가 없으면 단일 pane 이다.
    if (sub.paneTree) {
      const live = new Set(collectCmdPaneIds(sub.paneTree));
      for (const id of [...perPane.keys()]) if (!live.has(id)) perPane.delete(id);
    } else {
      for (const id of [...perPane.keys()]) if (id !== '0') perPane.delete(id);
    }
    this.cmdPaneStates.set(sub.id, perPane);

    // 합의 규칙: 하나라도 돌면 working > 하나라도 막혔으면 blocked > 전부 조용하면 idle.
    //   ("돌고 있는 pane 이 있는데 막혔다고 부르지 않는다" 가 사용자가 기대하는 순서다.)
    let state: CmdTerminalState = 'idle';
    let reason: string | undefined;
    for (const v of perPane.values()) {
      if (v.state === 'working') { state = 'working'; reason = undefined; break; }
      if (v.state === 'blocked' && state !== 'blocked') { state = 'blocked'; reason = v.reason; }
    }

    // §4 엔진 다리 — 엔진이 턴을 직접 알리는 탭은 바이트 흐름이 status 를 못 뒤집는다(타이핑도 바이트). blocked·활동 시각만 보탠다.
    const engineOwnsStatus = engineBridge.ownsCmdStatus(sub.id);

    if (state === 'working') {
      sub.lastActivityAt = Date.now();
      if (sub.blocked) {
        delete sub.blocked;
        delete sub.blockedSince;
        delete sub.blockedReason;
      }
      if (!engineOwnsStatus && sub.status !== 'active') sub.status = 'active';
    } else if (state === 'blocked') {
      // 멈춰 있지만 살아 있다 — 사용자를 부르는 상태라 `active` 를 유지한 채 플래그만 세운다.
      if (!sub.blocked) {
        sub.blocked = true;
        sub.blockedSince = Date.now();
      }
      sub.blockedReason = reason ? reason.slice(0, CMD_BLOCK_REASON_MAX) : undefined;
      if (sub.status !== 'active' && sub.status !== 'error') sub.status = 'active';
    } else {
      if (sub.blocked) {
        delete sub.blocked;
        delete sub.blockedSince;
        delete sub.blockedReason;
      }
      // `error` 는 강등 대상이 아니다(§2.4 — 실패를 거짓 idle 로 세탁하지 않는다).
      if (!engineOwnsStatus && sub.status === 'active') sub.status = 'idle';
    }

    return sub.status !== prevStatus || (sub.blocked === true) !== prevBlocked || sub.foregroundProcess !== prevProcess;
  }

  /** §4 (CMD ① QA) — 이 세션의 pane 별 감지 상태를 버린다(탭 닫기·아카이브 정리용). */
  forgetCmdPaneStates(subAgentId: string): void {
    this.cmdPaneStates.delete(subAgentId);
  }
  /** §4 (CMD 터미널 업그레이드 ⑤) — pane 분할 트리를 바꾼다(표시 상태라 체크포인트에 실린다). `null` = 단일 pane. 바뀌었으면 true. */
  setCmdPaneTree(subAgentId: string, tree: CmdPaneNode | null): boolean {
    const sub = this.index.get(subAgentId);
    if (!sub) return false;
    const before = JSON.stringify(sub.paneTree ?? null);
    if (tree) sub.paneTree = tree;
    else delete sub.paneTree;
    // 사라진 pane 의 감지 상태를 함께 버린다 — 남겨 두면 닫힌 pane 의 'working' 이 세션을
    // 영원히 돌고 있는 것으로 붙든다(§4 CMD ① QA).
    const live = new Set(collectCmdPaneIds(sub.paneTree ?? null));
    const perPane = this.cmdPaneStates.get(subAgentId);
    if (perPane) for (const id of [...perPane.keys()]) if (!live.has(id)) perPane.delete(id);
    return JSON.stringify(sub.paneTree ?? null) !== before;
  }

  /**
   * §5.5 #17-36 — 탭의 메모를 **통째로** 바꾼다(부분 페이로드는 나머지를 지운다 — `PUT /api/agent-config` 와 같은 사고).
   * 메모는 `sub` 안에 살아 세션과 함께 사라진다.
   */
  setSessionMemos(subAgentId: string, memos: SessionMemo[]): boolean {
    const sub = this.index.get(subAgentId);
    if (!sub) return false;
    const before = JSON.stringify(sub.memos ?? []);
    if (memos.length > 0) sub.memos = memos;
    else delete sub.memos;
    return JSON.stringify(sub.memos ?? []) !== before;
  }

  /** §5.5 #17-36 — 이 세션 탭의 메모 목록(없으면 빈 배열). */
  getSessionMemos(subAgentId: string): SessionMemo[] {
    return this.index.get(subAgentId)?.memos ?? [];
  }

  /** 소유 에이전트가 최종 삭제될 때 열린 메모와 닫은 기록 모두 정리한다. 탭 닫기·휴지통 이동에는 호출하지 않는다. */
  clearAgentMemos(parentAgentId: string): void {
    for (const sub of this.registry.get(parentAgentId) ?? []) delete sub.memos;
    for (const sub of this.archive.get(parentAgentId) ?? []) delete sub.memos;
  }

  /** §4 (CMD ①) — 이 sub 가 지금 사용자 입력을 기다리며 막혀 있는가(알림·표시 판정용). */
  isCmdBlocked(subAgentId: string): boolean {
    return this.index.get(subAgentId)?.blocked === true;
  }

  /** 전체 subagent 목록 (agentId → SubAgent[]) — 스냅샷용 */
  getSnapshot(): Record<string, SubAgent[]> {
    const result: Record<string, SubAgent[]> = {};
    for (const [agentId, subs] of this.registry) {
      if (subs.length > 0) result[agentId] = subs.map((s) => ({ ...s }));
    }
    return result;
  }

  /** 살아 있는 세션과 **아카이브까지** 본다 — 닫힌 세션의 대화는 `sub-streams/<agentId>/<subId>.jsonl` 에 남아, id 를 물려받으면 남의 대화 파일에 이어 쓴다. */
  private isSubIdTaken(id: string): boolean {
    if (this.index.has(id)) return true;
    for (const list of this.archive.values()) {
      if (list.some((s) => s.id === id)) return true;
    }
    return false;
  }

  /**
   * 시각 + 난수 꼬리로 id 를 뽑고 겹치면 다시 뽑는다 — `sub-<밀리초>` 만이면 코드가 연달아 만드는 자리(워커·워처·dispatch)에서 겹쳐 탭이 덮인다.
   * id 모양을 파싱하는 코드는 없어(판별은 맵 조회) 옛 id 도 그대로 유효하다.
   */
  private mintSubId(): string {
    for (let i = 0; i < SUB_ID_MINT_ATTEMPTS; i += 1) {
      const id = `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      if (!this.isSubIdTaken(id)) return id;
    }
    // 여기까지 왔으면 난수가 아니라 다른 것이 고장 난 것이다 — 그래도 겹칠 수 없는 값으로 끝낸다.
    return `sub-${Date.now().toString(36)}-${subCounter}-${randomUUID().slice(0, 8)}`;
  }

  /** subagent 생성. preferredId 가 주어지면(클라이언트 optimistic create) 그 id 를 쓴다 — 충돌 시 무시. */
  create(parentAgentId: string, preferredId?: string): SubAgent {
    subCounter++;
    const id = preferredId && !this.isSubIdTaken(preferredId)
      ? preferredId
      : this.mintSubId();
    const sub: SubAgent = {
      id,
      sessionId: '', // 첫 실행 시 Claude가 세션 생성
      label: `Sub #${subCounter}`,
      parentAgentId,
      status: 'idle',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    let list = this.registry.get(parentAgentId);
    if (!list) { list = []; this.registry.set(parentAgentId, list); }
    list.push(sub);
    this.index.set(sub.id, sub);

    logger.info(`SubAgent created: ${sub.id} (parent: ${parentAgentId})`);
    return sub;
  }

  /**
   * §5.26 (G) 5단계 — 죽은 세션을 이 탭에 입힌다: `sessionId` 만 채우면 다음 명령이 `--resume` 으로 잇는다.
   * ⚠ 살아 있는 세션 id 면 한 대화를 두 탭이 민다 — 생사 판정은 호출부 몫(단위 시험이 프로세스 조회를 안 타게). 빈 탭에만 앉는다.
   */
  adoptSession(subAgentId: string, sessionId: string, label?: string): boolean {
    const sub = this.index.get(subAgentId);
    if (!sub || !sessionId) return false;
    if (sub.sessionId && sub.sessionId !== sessionId) return false;
    sub.sessionId = sessionId;
    if (label?.trim()) sub.label = label.trim().slice(0, 120);
    sub.lastActivityAt = Date.now();
    logger.info(`SubAgent ${sub.id} adopted dead session ${sessionId.slice(0, 8)} (§5.26 resurrect)`);
    return true;
  }

  /** 탭 닫기 = 소프트 아카이브: 자식을 끊고 메모리에서 빼 archive 로 옮긴다. 디스크 스트림은 남긴다(restore 때 읽는다). */
  remove(subAgentId: string): boolean {
    const sub = this.index.get(subAgentId);
    if (!sub) return false;
    const providerCommand = this.localInFlightCmd.get(subAgentId);

    this.cmdPaneStates.delete(subAgentId);
    // §5.3 #12-1-B — 탭이 사라지면 그 세션의 대기 카드는 답할 곳이 없고, "이 세션에선 허용" 기억도 주인이 없다.
    permissionBroker.cancelForSubAgent(subAgentId, 'agent-stopped');
    permissionSessionGrants.forgetSubAgent(subAgentId);

    const child = this.runningChildren.get(subAgentId);
    if (child) {
      this.intentionalKill.add(subAgentId);
      // SIGTERM 은 직접 자식만 종료 → 남은 claude 손자 트리는 terminateChildTree 가 grace 후 회수.
      terminateChildTree(child);
      this.runningChildren.delete(subAgentId);
    }
    // 붙들어 둔 잠정 봉인은 **버리지 말고 지금 봉인**한다 — 안 그러면 그 명령이 executing 인 채로 남는다.
    this.flushDeferredSeal(subAgentId);
    // §5.5 #17-9 ⑱ — 끝 통지 붙듦도 걷는다(사라진 탭에 늦은 만료가 오지 않게).
    this.clearNoticeResumeHold(subAgentId);
    this.turnSealStates.delete(subAgentId);
    // 생존 대조용 표식도 함께 회수 — 탭이 사라지면 남겨 둘 이유가 없다(누수 방지).
    this.cmdDrivenSubs.delete(subAgentId);
    this.dispatchingSubs.delete(subAgentId);
    this.currentTurnId.delete(subAgentId);
    // persistent maps cleanup — remove 시 sub 자체가 archive 되므로 turn-in-flight 추적도 폐기.
    this.persistentChildReady.delete(subAgentId);
    this.persistentSpawnModelKey.delete(subAgentId);
    this.persistentSpawnVerificationKey.delete(subAgentId);
    this.persistentLineBuf.delete(subAgentId);
    this.persistentInFlightCmd.delete(subAgentId);
    // 로컬 턴 표식도 같은 이유로 함께 — 남기면 사라진 탭이 부모 버블을 영영 "실행중"으로 붙든다.
    this.localInFlightCmd.delete(subAgentId);
    if (providerCommand) {
      providerCommand.status = 'completed';
      providerCommand.result = `[Stopped by user]${providerCommand.result ? `\n\n${providerCommand.result}` : ''}`;
      sub.lastResult = providerCommand.result;
      this.stampTurnStopReason(sub, providerCommand, { userStopped: true });
    }

    // §5.7 #23-2 — agent-view: supervisor 의 worker + worktree 도 제거.
    const av = this.runningAgentViewWatchers.get(subAgentId);
    if (av) {
      void detachWatcher(av.short);
      void rmSession(av.short); // supervisor 측 worker + worktree cleanup
      this.runningAgentViewWatchers.delete(subAgentId);
    } else if (sub.agentViewShort) {
      // 진행 중이 아니지만 영속화된 short 가 있으면 supervisor 정리.
      void rmSession(sub.agentViewShort);
    }

    const list = this.registry.get(sub.parentAgentId);
    if (list) {
      const idx = list.findIndex((s) => s.id === subAgentId);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) {
        this.registry.delete(sub.parentAgentId);
        // §5.5 #17-9 ⑦(b) — 그 에이전트의 세션이 하나도 안 남으면 "방금 끝난 것" 꼬리도 함께 정리
        //   (런타임 전용 표시라 남겨 둘 근거가 없다).
        this.finishedSubagentTasks.delete(sub.parentAgentId);
      }
    }
    this.index.delete(subAgentId);
    this.streamBuffers.delete(subAgentId);
    this.streamDiskStamps.delete(subAgentId);
    // §5.5 #17-2 — 세션이 사라지면 미뤄 둔 브리핑 표식도 함께 지운다(런타임 전용 장부라 남길 이유가 없다).
    this.contextSummaryPending.delete(subAgentId);

    // archive로 이동 — sessionId·label·tokens 등 메타 보존
    const archived: SubAgent = { ...sub, status: 'idle', lastActivityAt: sub.lastActivityAt };
    let arch = this.archive.get(sub.parentAgentId);
    if (!arch) { arch = []; this.archive.set(sub.parentAgentId, arch); }
    arch.push(archived);

    // These providers own their runners outside runningChildren. Invalidate ownership
    // before aborting: a synchronous or late callback must not revive an archived turn.
    stopLocalTurn(subAgentId);
    stopCodexTurn(subAgentId);
    this.stoppedByUser.delete(subAgentId);
    if (providerCommand) {
      this.onSubStatusChange?.(sub.parentAgentId);
      this.onComplete?.();
    }

    logger.info(`SubAgent archived: ${subAgentId} (parent: ${sub.parentAgentId})`);
    return true;
  }

  /**
   * **도는 턴만 끊는다 — 프로세스는 살린다.** 트리를 SIGTERM 하면 백그라운드 감시(`Monitor`·`Bash run_in_background`)도 죽는다(§5.5 #17-9 ⑩).
   * CLI(2.1.228)는 stdin `control_request`(`subtype: interrupt`)로 쿼리를 끊고 셸 작업은 건드리지 않는다. persistent 자식에게만 통한다.
   * `SOFT_INTERRUPT_FALLBACK_MS` 안에 마감되지 않으면 하드 킬. @returns 보냈으면 true(덧말은 그 턴 마감 때 이어 나간다).
   */
  softInterrupt(subAgentId: string): boolean {
    const child = this.runningChildren.get(subAgentId);
    const inFlight = this.persistentInFlightCmd.get(subAgentId);
    // persistent 자식 + 지금 처리 중인 턴이 있을 때만. 둘 중 하나라도 없으면 보낼 곳이 없다.
    if (!child || !inFlight) return false;
    const stdin = child.stdin;
    if (!stdin || stdin.destroyed) return false;

    const interruptedCmdId = inFlight.cmd.id;
    try {
      stdin.write(JSON.stringify({
        type: 'control_request',
        request_id: `vibisual-interrupt-${++softInterruptSeq}`,
        request: { subtype: 'interrupt' },
      }) + '\n', 'utf8');
    } catch (err) {
      logger.warn(`SubAgent ${subAgentId} soft interrupt write failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
    // §5.5 #17-18 — 끊긴 턴은 모델 줄 없이 `result` 로 끝날 수 있다. 그 `result` 는 이 명령의 끝이다.
    inFlight.interrupted = true;
    logger.info(`SubAgent ${subAgentId} soft interrupt sent (cmd=${interruptedCmdId}) — child kept alive`);
    // §5.3 #12-1-B — 끊긴 턴이 띄워 둔 권한 카드는 답할 곳이 없다. 60초를 채워 기본 허용으로 풀리지 않게 닫는다.
    permissionBroker.cancelForSubAgent(subAgentId, 'agent-stopped');

    // 안전판 — 창을 넘기도록 같은 명령이 그대로 in-flight 면 CLI 가 인터럽트를 안 받은 것으로 보고
    //   종전 경로(하드 킬)로 넘어간다. 이 폴백은 감시를 못 살리지만 **멈추지 않는 것보다는 낫다**.
    setTimeout(() => {
      if (this.persistentInFlightCmd.get(subAgentId)?.cmd.id !== interruptedCmdId) return;
      // 봉인이 붙들려 있다면 **인터럽트는 먹었다** — CLI 가 이미 답을 냈고 백단 여운 때문에 마감만
      //   미뤄진 상태다. 여기서 죽이면 응답한 세션을 죽이는 것이라, 죽이는 대신 그 봉인을 확정해
      //   다음 턴으로 넘긴다(자식·감시 모두 살아 있고 덧말은 그 자리에서 이어 나간다).
      if (this.sealHeldTurnNow(subAgentId)) {
        logger.info(`SubAgent ${subAgentId} soft interrupt honored but seal was held — sealed now instead of hard stop`);
        return;
      }
      logger.warn(`SubAgent ${subAgentId} soft interrupt not honored in ${SOFT_INTERRUPT_FALLBACK_MS}ms — falling back to hard stop`);
      this.stop(subAgentId);
    }, SOFT_INTERRUPT_FALLBACK_MS).unref?.();

    return true;
  }

  /**
   * §5.5 #17-18 — 붙들어 둔 턴 끝을 지금 확정한다([즉시] 덧말의 첫 길). 없으면 false.
   * `result` 뒤 봉인만 미룬 상태엔 끊을 턴이 없다 — 인터럽트하면 3초 뒤 하드 킬이 감시까지 죽인다. `seal()` 이 다음 명령을 같은 자식에 잇는다.
   */
  sealHeldTurnNow(subAgentId: string): boolean {
    if (!this.deferredSeals.has(subAgentId)) return false;
    this.flushDeferredSeal(subAgentId, 'immediate follow-up');
    return true;
  }

  /**
   * §5.5 #17-18 — 내려가는 자식 때문에 못 보낼 때 큐로 되돌린다: `execute` 가 세운 것을 되돌려 그 `close` 의 `onComplete` 가 `--resume` 으로 다시 집게 한다.
   * in-flight 는 이 명령 것일 때만 지운다 — 붙들린 직전 턴 것을 지우면 그 명령이 `executing` 으로 굳는다.
   */
  private _requeueForDyingChild(sub: SubAgent, cmd: QueuedCommand): void {
    if (this.persistentInFlightCmd.get(sub.id)?.cmd.id === cmd.id) {
      this.persistentInFlightCmd.delete(sub.id);
    }
    this.persistentChildReady.delete(sub.id);
    this.clearDispatching(sub.id);
    if (this.currentTurnId.get(sub.id) === cmd.id) this.currentTurnId.delete(sub.id);
    cmd.status = 'queued';
    delete cmd.startedAt;
    // `execute` 가 올려 둔 active 도 되돌린다 — 이 명령은 아직 나가지 않았다. 남기면 옛 자식의 close 를
    //   기다리는 동안(Windows 는 손자가 파이프를 쥐고 있어 늦게 온다) 아무것도 돌지 않는 탭이 "처리 중"으로
    //   선다. 백그라운드 작업 때문에 올라가 있는 active 는 그 장부의 몫이라 건드리지 않는다.
    if (sub.status === 'active' && !this.bgPromotedSubs.has(sub.id)) sub.status = 'idle';
    sub.lastActivityAt = Date.now();
    logger.warn(
      `SubAgent ${sub.id} child is shutting down (stdin closed) — requeued cmd=${cmd.id};`
      + ' its close will dispatch it as a fresh --resume spawn',
    );
  }

  /**
   * `stop()` — 사용자 중지: 자식 트리를 끊고 sub/cmd 는 남긴다. persistent 턴은 바로 `[Stopped by user]` 로 마감하고 그 `onComplete` 가
   * 다음 차례를 집으므로, 큐·루프를 비울 호출자는 **이 호출 전에** 비운다. 실행 중이 아니면 false.
   */
  /**
   * §5.13 (R-10) — 명령 한 건의 시간 상한. 그 명령이 아직 실행 중이면 사용자 중지와 같은 길(`stop`)로 끊고, 끊은 이유를
   * 명령에 남긴다(`runLimitHit`). 엔진과 무관하게 걸리는 유일한 상한이라 여기(실행 시작 자리) 한 곳에서 단다.
   */
  private armRunTimeLimit(sub: SubAgent, cmd: QueuedCommand): void {
    const ms = runLimitMs(cmd.runLimits);
    if (!ms) return;
    cmd.runLimitsApplied = { ...cmd.runLimitsApplied, maxMinutes: cmd.runLimits!.maxMinutes! };
    const subId = sub.id;
    const timer = setTimeout(() => {
      if (cmd.status !== 'executing' || this.currentTurnId.get(subId) !== cmd.id) return;
      logger.info(`SubAgent ${subId}: command ${cmd.id} reached its ${cmd.runLimits?.maxMinutes} minute limit — stopping`);
      cmd.runLimitHit = 'maxMinutes';
      this.stop(subId);
    }, ms);
    (timer as { unref?: () => void }).unref?.();
  }

  stop(subAgentId: string): boolean {
    const sub = this.index.get(subAgentId);
    if (!sub) return false;

    // §5.3 #12-1 — 중지 때 백그라운드 대차대조도 비운다(끊긴 자식은 끝 신고를 못 한다). §5.5 #17-10 — **이 세션 것만**(다른 탭 표시를 지우지 않게).
    // §5.5 #17-9 ⑱ — 끝 통지 붙듦도 먼저 걷는다(아래 `syncBgSubStatus` 가 붙든 채로 세지 않게).
    this.clearNoticeResumeHold(subAgentId);
    this.clearPendingSubagentTasksForSession(sub.parentAgentId, subAgentId);
    // 스트림 칩의 백그라운드 작업도 비운다 — 트리째 끝나지만 끝 통지는 안 와, 안 비우면 중지 뒤에도 "N개 도는 중"이 남는다.
    this.clearLiveBackgroundTasks(subAgentId);
    // §5.3 #12-1-B — 그 세션이 띄워 둔 권한 카드는 취소로 닫는다. 안 닫으면 60초 뒤 기본 허용으로 풀려
    //   일어나지도 않을 호출이 원장에 "시간 초과 · 허용"으로 남는다. 세션 기억은 지우지 않는다(세션은 이어진다).
    permissionBroker.cancelForSubAgent(subAgentId, 'agent-stopped');

    // §5.19 — 로컬 LLM 세션에는 자식이 없다. 생성만 끊고 러너가 onDone 으로 마감하게 둔다
    //   (모델은 내리지 않는다 — 다음 턴에 그대로 다시 쓴다).
    if (stopLocalTurn(subAgentId)) {
      this.stoppedByUser.add(subAgentId);
      logger.info(`SubAgent stop requested by user (local): ${subAgentId}`);
      return true;
    }

    // §5.25 (F) — 코덱스 세션의 자식은 러너가 들고 있어 `runningChildren` 에 없다.
    //   여기서 끊지 않으면 [중지]가 아무것도 못 멈춘 채 다음 경로로 흘러간다.
    if (stopCodexTurn(subAgentId)) {
      this.stoppedByUser.add(subAgentId);
      logger.info(`SubAgent stop requested by user (codex): ${subAgentId}`);
      return true;
    }

    // §5.7 #23-2 — agent-view: supervisor 에 stop 요청, 후처리는 finishTerminal.
    const av = this.runningAgentViewWatchers.get(subAgentId);
    if (av) {
      this.stoppedByUser.add(subAgentId);
      void stopSession(av.short);
      logger.info(`SubAgent stop requested by user (agent-view): ${subAgentId} short=${av.short}`);
      return true;
    }

    // legacy 경로: SIGTERM. persistent child 의 경우에도 동일 — intentionalKill 마킹으로
    // close 핸들러가 crash 경로(sessionId 보존) 가 아닌 user-stop 경로로 분기한다.
    const child = this.runningChildren.get(subAgentId);
    if (!child) return false;
    this.stoppedByUser.add(subAgentId);
    this.intentionalKill.add(subAgentId);
    // 자식 트리 종료 — Windows 는 부모가 살아 있을 때 트리째(`taskkill /T`), POSIX 는 SIGTERM 뒤 그룹 회수.
    terminateChildTree(child);
    this.settleStoppedPersistentTurn(sub);
    // §5.5 #17-9 ⑱(c) — 쉬던 자식이면 위 마감이 상태를 안 건드리니 **다시 세어** 지금 내린다(안 세면 `close` 까지 [중지]가 남고 늦은 끝 칩이 붙듦을 다시 건다).
    if (this.syncBgSubStatus(sub.parentAgentId)) this.onSubStatusChange?.(sub.parentAgentId);
    logger.info(`SubAgent stop requested by user: ${subAgentId}`);
    return true;
  }

  /**
   * §5.5 #17-18 — [중지]한 persistent 턴을 `close` 를 기다리지 않고 지금 마감한다 — Windows 의 `close` 는 파이프를 쥔 손자까지 죽어야 온다.
   * 붙든 봉인이 있으면 그게 마감, 없으면 `[Stopped by user]`. 새 명령은 큐로 돌아가(`_requeueForDyingChild`) `close` 뒤 `--resume` 으로 뜬다.
   * legacy(`--print`)면 아무것도 안 한다 — 그 마감은 `close` 의 stdout 이 필요하다.
   */
  private settleStoppedPersistentTurn(sub: SubAgent): void {
    if (!this.persistentLineBuf.has(sub.id)) return;
    const inFlight = this.persistentInFlightCmd.get(sub.id);
    clearEarlyResultWait(inFlight);
    if (this.deferredSeals.has(sub.id)) {
      this.flushDeferredSeal(sub.id, 'user stop');
      // 봉인이 다음 턴을 위해 세운 준비 표식은 끊긴 자식에겐 거짓이다.
      this.persistentChildReady.delete(sub.id);
    } else if (inFlight) {
      this.persistentInFlightCmd.delete(sub.id);
      this.persistentChildReady.delete(sub.id);
      this._finalizeLegacyCommand(sub, inFlight.cmd, inFlight.parentCwd, undefined, inFlight.turnCount, inFlight.killed, inFlight.maxTurns, null, '', /*deleteRunningChild=*/false);
    }
    // 마감할 턴이 없었어도(자식이 놀고 있었다) 중지 표식은 여기서 소진한다 — `close` 의 쉬게 하기 분기는
    //   이 표식을 읽지 않아, 남기면 **다음 명령**이 끝날 때 `[Stopped by user]` 로 잘못 닫힌다.
    this.stoppedByUser.delete(sub.id);
  }

  /**
   * §5.5 #17-9 — 한 부모 아래 **모든 세션 탭**을 끊는다. 대차대조(§5.3 #12-1)를 한 번만 비우려고 `stop()` 대신 자식을 직접 끊는다.
   * @returns 종료 신호를 보낸 세션 id.
   */
  stopAll(parentAgentId: string): string[] {
    // 백그라운드 서브에이전트 대차대조 즉시 해제 — 끊긴 자식은 끝 신고를 못 하므로, 안 비우면
    // pending 가드가 중지된 에이전트를 계속 활성으로 붙잡는다(= 중지했는데 계속 도는 것처럼 보임).
    // §5.5 #17-9 ⑱ — 끝 통지 붙듦도 같은 이유로 먼저 걷는다(`stop()` 과 같은 순서).
    for (const s of this.registry.get(parentAgentId) ?? []) this.clearNoticeResumeHold(s.id);
    this.clearPendingSubagentTasks(parentAgentId);
    // §5.3 #12-1-B — 이 버블의 대기 카드 전부(세션 id 없이 도착한 카드 포함)를 취소로 닫는다.
    permissionBroker.cancelForAgent(parentAgentId, 'agent-stopped');

    const stopped: string[] = [];
    // 복사본을 돈다 — 아래 즉시 마감이 `onComplete` 로 다음 명령을 흘려보내는 사이 목록이 바뀌어도 안전하게.
    for (const sub of [...(this.registry.get(parentAgentId) ?? [])]) {
      // 스트림 칩 장부도 세션마다 비운다 — `stop()` 과 같은 이유(끊긴 자식은 끝 통지를 안 보낸다).
      this.clearLiveBackgroundTasks(sub.id);
      // §5.19 — 로컬 LLM 세션(자식 없음)도 함께 끊는다.
      if (stopLocalTurn(sub.id)) {
        this.stoppedByUser.add(sub.id);
        stopped.push(sub.id);
        continue;
      }
      // §5.25 (F) — 코덱스 세션도 함께 끊는다(자식은 러너가 트리째 회수한다).
      if (stopCodexTurn(sub.id)) {
        this.stoppedByUser.add(sub.id);
        stopped.push(sub.id);
        continue;
      }
      // agent-view 경로: supervisor 에 stop 요청. finishTerminal 에서 후처리.
      const av = this.runningAgentViewWatchers.get(sub.id);
      if (av) {
        this.stoppedByUser.add(sub.id);
        void stopSession(av.short);
        stopped.push(sub.id);
        continue;
      }
      // legacy/persistent 경로: SIGTERM → grace 후 트리 강제 종료(손자 node worker/MCP 고아 방지).
      const child = this.runningChildren.get(sub.id);
      if (!child) continue;
      this.stoppedByUser.add(sub.id);
      this.intentionalKill.add(sub.id);
      terminateChildTree(child);
      // §5.5 #17-18 — `stop()` 과 같은 이유로 `close` 를 기다리지 않고 지금 마감한다.
      this.settleStoppedPersistentTurn(sub);
      stopped.push(sub.id);
    }
    // §5.5 #17-9 ⑱(c) — `stop()` 과 같은 이유로 **다시 센다.** 위 대차대조 정리가 한 번 셌지만 그때는 스트림 장부가
    //   아직 남아 있어, 살아 있던 백단 자식 덕에 떠 있던 쉬는 탭이 `close` 가 올 때까지 [중지] 그대로였다.
    if (this.syncBgSubStatus(parentAgentId)) this.onSubStatusChange?.(parentAgentId);
    logger.info(`SubAgent stop-all requested by user: parent=${parentAgentId} stopped=${stopped.length}`);
    return stopped;
  }

  /** 부모 에이전트의 archive 목록 — 폴더 팝업 소스. 최근 활동 순 정렬. */
  getArchived(parentAgentId: string): SubAgent[] {
    const list = this.archive.get(parentAgentId) ?? [];
    return [...list].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  /** archive → 레지스트리 복구. 스트림 버퍼는 disk에서 다시 로드.
   *  미존재/요청 부모 불일치 시 null, 이미 registry에 있으면(중복 호출) 기존 인스턴스 그대로 반환. */
  restoreFromArchive(subAgentId: string, expectedParentId?: string): SubAgent | null {
    // 이미 live면 그 인스턴스 반환
    const live = this.index.get(subAgentId);
    if (live) return expectedParentId && live.parentAgentId !== expectedParentId ? null : live;

    // archive에서 찾기
    let found: SubAgent | null = null;
    let parentId = '';
    for (const [pid, list] of this.archive) {
      if (expectedParentId && pid !== expectedParentId) continue;
      const idx = list.findIndex((s) => s.id === subAgentId);
      if (idx >= 0) {
        found = list[idx]!;
        parentId = pid;
        list.splice(idx, 1);
        if (list.length === 0) this.archive.delete(pid);
        break;
      }
    }
    if (!found) return null;

    // registry로 복귀
    let regList = this.registry.get(parentId);
    if (!regList) { regList = []; this.registry.set(parentId, regList); }
    const revived: SubAgent = { ...found, status: 'idle' };
    regList.push(revived);
    this.index.set(revived.id, revived);

    // 디스크 스트림 버퍼 재로드 — 폴더는 읽기 경로와 같은 길(`findStreamDirFor`)로 짚는다.
    //   소속 해석 하나에 기대면 프로젝트 탭을 오간 뒤 되살린 세션이 빈 화면으로 선다.
    const dir = this.findStreamDirFor(revived.id, parentId);
    if (dir) {
      const buf = streamBufferStore.loadBuffer(dir, revived.id, MAX_STREAM_BUFFER);
      if (buf.length > 0) this.streamBuffers.set(revived.id, buf);
    }

    logger.info(`SubAgent restored from archive: ${revived.id} (parent: ${parentId})`);
    return revived;
  }

  /** 아카이브 전체 스냅샷 (체크포인트 저장용) */
  getArchiveSnapshot(): Record<string, SubAgent[]> {
    const result: Record<string, SubAgent[]> = {};
    for (const [agentId, subs] of this.archive) {
      if (subs.length > 0) result[agentId] = subs.map((s) => ({ ...s }));
    }
    return result;
  }

  /** `orderedIds` 가 지금 레지스트리와 같은 집합일 때만 재배열하고 true. */
  reorder(parentAgentId: string, orderedIds: string[]): boolean {
    const list = this.registry.get(parentAgentId);
    if (!list || list.length !== orderedIds.length) return false;
    if (new Set(orderedIds).size !== orderedIds.length) return false;
    const currentIds = new Set(list.map((s) => s.id));
    if (!orderedIds.every((id) => currentIds.has(id))) return false;

    const byId = new Map(list.map((s) => [s.id, s] as const));
    const reordered = orderedIds.map((id) => byId.get(id)!);
    this.registry.set(parentAgentId, reordered);
    return true;
  }

  /**
   * sub 세션에서 명령 실행(agentConfig → CLI 인자). `opts.customParent` 면 Agent View(`--bg`) 대신 legacy `claude -p` 만 탄다 —
   * supervisor 는 spawn 마다 sessionId 를 새로 발급해 대화가 끊긴다. legacy 는 첫 턴의 `sub.sessionId` 로 `--resume` 한다.
   */
  execute(
    cmd: QueuedCommand,
    parentCwd: string,
    contextSummary: string,
    agentConfig?: AgentConfig,
    livePreamble?: string,
    opts?: {
      customParent?: boolean;
      /**
       * §5.5 #17-28 — 주입원 창에서 끈 줄을 실제로 끄는 CLI 인자(예: `--disable-slash-commands`).
       * 매 턴 새 프로세스라 다음 프롬프트부터 그대로 먹는다. 끈 것이 없으면 오지 않는다.
       */
      extraArgs?: string[];
      /** Native Codex configuration overrides for this turn's context sources. */
      codexContextArgs?: string[];
      verificationConfig?: VerificationToolsConfig;
      codexEdgeInstructionsEnabled?: boolean;
      codexEdgeConfig?: CodexEdgeConfig;
      codexToolHook?: CodexToolHookConfig;
      /** §5.25 (H) — 코덱스 턴의 권한 다리(승인 카드·감사 원장). 코덱스 버블에만 온다. */
      codexPermissionHook?: CodexPermissionHookConfig;
      /**
       * §5.3 #12-4 (E) ② — 이 턴에 브라우저 확인 권한이 없다. 훅 밖에서 도는 호스팅 브라우저·컴퓨터 도구를
       * 기능 스위치로 끈다(PreToolUse 를 지나지 않아 검증 판정이 닿지 않는다).
       */
      codexHostedBrowserOff?: boolean;
      /** 같은 목적의 환경변수(예: `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`). */
      extraEnv?: Record<string, string>;
      /**
       * §5.5 #17-28 ⑧(c) — 세션 내내 안 변하는 산문(의도 선언·목표 창 규약)을 **시스템 프롬프트로**
       * 한 벌만 실어 보낸다. 매 턴 사용자 메시지에 쌓지 않으므로 턴이 늘어도 이력이 붇지 않고,
       * 압축(compact)에도 쓸려 나가지 않는다. 지속 자식은 프로세스당 1회 = 세션 1회다.
       */
      appendSystemPrompt?: string;
    },
  ): void {
    let sub: SubAgent | undefined;

    if (cmd.subAgentId) {
      sub = this.index.get(cmd.subAgentId);
    }
    if (!sub) {
      // agentId 추출 — cmd에서 역참조 필요하므로 외부에서 parentAgentId 전달
      // 이 경우 새 subagent를 create해야 함 — 호출자가 처리
      logger.warn(`SubAgent not found: ${cmd.subAgentId}`);
      return;
    }

    sub.status = 'active';
    // 자식/워처가 등록되기 전까지는 "죽은 active" 로 오해받지 않게 표식을 든다(생존 대조 제외).
    this.wakeSub(sub); // §2.4 (잠듦) — 명령이 들어온 순간 표식을 걷는다
    this.clearUsageLimit(sub); // §2.4 (한도 정지) — 다시 돌린 세션은 더 이상 멈춰 있지 않다
    this.dispatchingSubs.add(sub.id);
    // §5.3 #9-1 (P)(b) — 조용한 압축은 "마지막 명령"도 탭 제목도 건드리지 않는다. 그 자리는 끼우는 순간
    //   서버가 뒤에 선 사용자 명령의 글로 이미 적었다(`noteLastCommand`) — 압축이 도는 동안 탭·세션 목록·
    //   명령 센터에 `/compact` 가 보이면 사용자가 넣은 명령이 도는 것처럼 보이지 않는다.
    if (!cmd.silent) this.applyLastCommand(sub, cmd.text);
    sub.lastActivityAt = Date.now();
    cmd.status = 'executing';
    // 이 턴의 도장 — 지금부터 이 세션이 뱉는 줄은 전부 이 명령의 것이다.
    this.currentTurnId.set(sub.id, cmd.id);
    // §5.3 #9-1 (P) — 조용한 명령이면 이 턴이 뱉는 줄은 전부 감춘다(아래 `emitStreamEvent`).
    //   여기서 등록하는 이유는 하나다 — 도장을 찍는 자리와 같은 곳이라야 "감출 턴"과 "그 턴의
    //   줄"이 어긋날 수 없다.
    if (cmd.silent) {
      this.silentTurnIds.add(cmd.id);
      capSetSize(this.silentTurnIds, SESSION_KEYED_MAP_MAX);
    }

    // §5.5 #17-18 ⑥ — 이 명령이 **실제로 나간** 시각. 말풍선 자리는 큐 시각(`timestamp`)이 아니라 이 값으로 고정한다.
    // §5.19 (D) — 로컬 갈림(아래 `return`)보다 먼저 둔다 — 뒤면 로컬 턴만 시작 시각·시작 통지를 못 받는다.
    // §5.5 #17-18 ⑥-5 — **한 명령에 한 번만** — 재개(§5.3 #12-1 `restartResumed`)·큐 되돌림에서 덮으면 말풍선이 제 출력 아래로 간다.
    const firstDispatch = cmd.startedAt === undefined;
    if (cmd.startedAt === undefined) cmd.startedAt = Date.now();
    // §5.1 #2-1 (B) — 새 명령이 묶음의 이번 턴을 연다(이 명령 때의 사진만, 지난 턴 것은 안 가져온다). 처음 나갈 때만 —
    //   재개·큐 되돌림은 같은 턴, 조용한 명령은 사용자 턴이 아니다. 처리 중인 앞 턴이 있으면 그 턴에 이어 붙는다.
    if (firstDispatch && !cmd.silent) {
      const busy = this.getAllSubs(sub.parentAgentId).some((s) => this.isSubProcessingCommand(s.id));
      this.onCommandStart?.(sub.parentAgentId, busy);
    }
    this.armRunTimeLimit(sub, cmd);
    this.onSubStatusChange?.(sub.parentAgentId);

    // §5.19 — All Model(로컬 LLM) 갈림. **이 한 곳**이 이 기능이 기존 실행 경로에 내는 유일한 자국이다.
    //   `provider` 가 없으면 아래 claude 스폰 경로가 지금까지와 한 줄도 다르지 않게 흐른다.
    if (opts?.verificationConfig && !verificationToolsAvailable(opts.verificationConfig)) {
      this.rejectVerificationSetup(sub, cmd, 'Verification tools unavailable: Node.js or verification-tools.mjs missing');
      return;
    }
    if (agentConfig?.provider) {
      // §5.19 (H) · §5.25 (F) — 도구가 일할 자리는 이 세션의 프로젝트 루트다(클로드 스폰 cwd 와 같은 값).
      //   프로바이더가 둘이 된 뒤로도 **갈림은 여전히 이 한 곳**이다(§4 확장 슬롯).
      if (agentConfig.provider.kind === 'codex-cli') {
        this.executeCodexProvider(sub, cmd, agentConfig, parentCwd, contextSummary, livePreamble, opts);
      } else {
        this.executeLocalProvider(sub, cmd, agentConfig, parentCwd, contextSummary, livePreamble);
      }
      return;
    }

    // 저장된 sessionId 의 CLI JSONL 이 없으면 `--resume` 이 "No conversation found" 로 실패한다 — 비워서 fresh spawn 으로 보낸다.
    if (sub.sessionId) {
      const jsonlPath = getSessionJsonlPath(parentCwd, sub.sessionId);
      if (!fs.existsSync(jsonlPath)) {
        logger.warn(`SubAgent ${sub.id} sessionId stale (${sub.sessionId}, JSONL missing: ${jsonlPath}) — clearing and re-spawning fresh`);
        sub.sessionId = '';
      }
    }

    // `contextSummary` 는 첫 스폰에만, `livePreamble`(매 턴 바뀌는 엣지 등)은 매 턴. 첨부 그림 경로는 말미에 줄마다(공백 든 경로가 안 쪼개지게).
    // §5.5 #17-2 — 조립은 `composeTurnPrompt`. 슬래시 명령은 원문 그대로 — 앞서는 글자가 있으면 CLI 가 명령으로 못 집는다(실측 turns 0·$0 → 1·$0.0125).
    const turn = composeTurnPrompt({
      text: cmd.text,
      attachments: cmd.attachments ?? [],
      preamble: livePreamble ?? '',
      contextSummary,
      hasSession: !!sub.sessionId,
      carryContextSummary: this.contextSummaryPending.has(sub.id),
    });
    const prompt = turn.prompt;
    // 첫 턴이 슬래시라 브리핑을 못 실었으면 다음 비슬래시 턴까지 들고 있는다(실었으면 표식을 지운다).
    if (turn.deferContextSummary) {
      this.contextSummaryPending.add(sub.id);
    } else if (turn.contextSummaryDelivered) {
      this.contextSummaryPending.delete(sub.id);
    }
    if (turn.slashPassthrough) {
      logger.info(`SubAgent ${sub.id} slash passthrough — sending "${cmd.text.trim().slice(0, 40)}" to CLI verbatim (no preamble)`);
    }

    // AgentConfig → CLI 인자. §5.3 — 기억 폴더가 에이전트·프로젝트로 갈려 그 맥락을 함께 넘긴다.
    //   §4 (CLI 사양 추종) (5) — 자동 압축 창은 스폰에 싣지 않는다(턴 경계 판정 index.ts `maybeCompactAfterTurn` 이 읽는다).
    const configCtx: ConfigArgsContext = {
      verificationConfig: opts?.verificationConfig,
      agentName: sub!.parentAgentId,
      projectRoot: parentCwd,
    };
    // §5.5 #17-28 — 주입원 창이 끈 줄의 CLI 인자를 뒤에 얹는다. 같은 인자가 이미 있으면 넣지 않는다.
    let configArgs: string[];
    try {
      configArgs = agentConfig || opts?.verificationConfig ? buildConfigArgs(agentConfig ?? DEFAULT_AGENT_CONFIG, configCtx) : [];
    } catch (error) {
      this.rejectVerificationSetup(sub, cmd, error instanceof Error ? error.message : String(error));
      return;
    }
    for (const extra of opts?.extraArgs ?? []) {
      if (!configArgs.includes(extra)) configArgs.push(extra);
    }
    // §4 엔진 다리 — 설정이 없는 맨 스폰(`configArgs` 가 빈 배열)도 우리가 띄우는 세션이다. 설정이 있으면
    //   `buildConfigArgs` 가 이미 붙였으므로 여기서는 아무것도 늘지 않는다.
    appendEngineBridgeArgs(configArgs);
    // §5.5 #17-28 ⑧(c) — 안 변하는 규약은 프롬프트가 아니라 시스템 프롬프트로. `--append-system-prompt`
    //   는 `--print` 전용이 아니라 일반 플래그라 지속 자식·매 턴 spawn 양쪽에 그대로 붙는다(설치본
    //   2.1.246 `--help` 확인). 이미 붙어 있으면 덧붙이지 않는다(중복 주입 방지).
    const appendSystemPrompt = opts?.appendSystemPrompt?.trim();
    if (appendSystemPrompt && !configArgs.includes('--append-system-prompt')) {
      configArgs.push('--append-system-prompt', appendSystemPrompt);
    }
    // 환경변수 축(중첩 깊이 · 자동 기억 끄기 · 주입원 창의 spawn 스위치) — 스폰부가 env 에 얹는다.
    this.pendingConfigEnv.set(sub!.id, { ...buildConfigEnv(agentConfig, configCtx), ...(opts?.extraEnv ?? {}) });
    // §3.2.4 F축 — sub.id 가 키라 스폰할수록 는다(지우는 곳이 없었다). 다음 스폰 때 다시 조립되는
    // 값이라 오래된 것은 버려도 안전하다 — 되살아난 sub 는 그 시점 설정으로 새로 만든다.
    capMapSize(this.pendingConfigEnv, SESSION_KEYED_MAP_MAX);

    // maxTurns — 무한 루프 안전장치. 명령 한 건마다 assistant 메시지를 세고, 0 = 무제한, 양수면 닿을 때 끊는다(legacy SIGTERM / agent-view `claude stop`).
    // §5.13 (R-10) — 명령 한 건의 턴 상한과 설정 상한 중 좁은 쪽이 이긴다.
    const maxTurns = effectiveMaxTurns(agentConfig?.maxTurns ?? DEFAULT_AGENT_CONFIG.maxTurns ?? 0, cmd.runLimits);
    if (cmd.runLimits?.maxTurns) cmd.runLimitsApplied = { ...cmd.runLimitsApplied, maxTurns };
    // §4 — API 비용 상한(달러). 0/undefined = 무제한, 양수면 `--print` 스폰에 `--max-budget-usd`.
    const maxBudgetUsd = (agentConfig?.maxBudgetUsd && agentConfig.maxBudgetUsd > 0) ? agentConfig.maxBudgetUsd : 0;
    // §4 API 크레딧 — 크레딧이면 키를 env 로 싣는다. 금액 상한은 안 붙인다 — 한도·잔액은 Console 이 정하고 Anthropic 이 거절한다.
    //   크레딧 턴은 `--print` 새 스폰으로 보낸다 — 떠 있던 자식·Agent View 엔 그 키가 없다.
    const credit = this.resolveCreditRoute(sub, cmd);
    if (credit) {
      this.pendingConfigEnv.set(sub.id, { ...(this.pendingConfigEnv.get(sub.id) ?? {}), ANTHROPIC_API_KEY: credit.key });
    }
    // §4 (CLI 사양 추종) — 과부하 폴백 모델. `--print` 전용 플래그라 legacy 헤드리스 경로에만 실린다
    //   (Agent View `--bg` 경로에는 안 붙는다 — maxBudgetUsd 와 같은 제약).
    const fallbackModel = agentConfig?.fallbackModel?.trim() ?? '';
    // §4 (스트림 3종) — `--print` 전용이 아니라 **비대화형이면 통하는** 축이라 persistent 경로에도 실린다
    //   (`--include-partial-messages` 와 같은 성질 — 설치본 2.1.241 에서 `--print` 없이도 인자 검증 통과 확인).
    //   그래서 `printFlags` 가 아니라 별도 묶음으로 넘겨 두 스폰 형태가 같은 것을 받게 한다.
    const streamFlags: string[] = [];
    if (isForwardSubagentTextEnabled(agentConfig?.forwardSubagentText)) streamFlags.push('--forward-subagent-text');
    if (agentConfig?.replayUserMessages) streamFlags.push('--replay-user-messages');
    if (agentConfig?.promptSuggestions) streamFlags.push('--prompt-suggestions', 'true');
    // §4 (CLI 사양 추종) — 훅 생명주기를 스트림에 싣는다(stream-json 전용, 두 스폰 공용). ⚠ 플래그만으로는 안 보인다 — 아래 `streamHookEventsOn` 과 한 쌍이다.
    if (agentConfig?.includeHookEvents) streamFlags.push('--include-hook-events');
    this.streamHookEventsOn.set(sub!.id, agentConfig?.includeHookEvents === true);
    capMapSize(this.streamHookEventsOn, SESSION_KEYED_MAP_MAX);
    // 커스텀 에이전트는 늘 legacy — supervisor 의 sessionId 회전(`execute` 주석).
    if (opts?.customParent || opts?.verificationConfig) {
      this._executeViaLegacy(cmd, sub!, parentCwd, prompt, configArgs, maxTurns, maxBudgetUsd, fallbackModel, streamFlags);
      return;
    }

    // §4 — 비용 상한·크레딧 턴은 legacy `--print` 새 스폰으로 — Agent View(`--bg`)엔 `--max-budget-usd` 가 안 먹고, 키는 그 스폰 env 에만 실린다.
    if (maxBudgetUsd > 0 || credit) {
      this._executeViaLegacy(cmd, sub!, parentCwd, prompt, configArgs, maxTurns, maxBudgetUsd, fallbackModel, streamFlags);
      return;
    }

    // §5.7 #23-2 — Agent View 게이트(커스텀 외 SubAgent/Team/Pipeline). `claude --bg` 면 supervisor 가 자식을 쥐어 서버 재시작에도 턴이 산다. 게이트는 60초 memo.
    void isAgentViewEnabled().then((gate) => {
      if (gate.enabled) {
        void this._executeViaAgentView(cmd, sub!, parentCwd, prompt, configArgs, maxTurns);
      } else {
        this._executeViaLegacy(cmd, sub!, parentCwd, prompt, configArgs, maxTurns, maxBudgetUsd, fallbackModel, streamFlags);
      }
    }).catch((err) => {
      logger.warn(`SubAgent ${sub!.id} agent-view gate check failed: ${err instanceof Error ? err.message : String(err)} — falling back to legacy`);
      this._executeViaLegacy(cmd, sub!, parentCwd, prompt, configArgs, maxTurns, maxBudgetUsd, fallbackModel, streamFlags);
    });
  }

  /** §5.7 #23-2 — Agent View 경로: `claude --bg` dispatch + JSONL watcher(서버 재시작에도 턴이 산다). */
  private async _executeViaAgentView(
    cmd: QueuedCommand,
    sub: SubAgent,
    parentCwd: string,
    prompt: string,
    configArgs: string[],
    maxTurns: number,
  ): Promise<void> {
    let turnCount = 0;
    let killed = false;
    let terminalProcessed = false;

    try {
      // resume 모드: 이미 sessionId 가 있으면 같은 conversation 이어붙이기.
      // `--bg --resume <id>` 는 supervisor 가 사용자에게 안내한 정식 경로(docs: "use --resume <id> to continue").
      const args = sub.sessionId
        ? ['--resume', sub.sessionId, ...configArgs]
        : [...configArgs];

      logger.info(`SubAgent ${sub.id} agent-view dispatch: "${cmd.text.slice(0, 50)}..."${args.length > 0 ? ` [args: ${args.join(' ')}]` : ''}`);

      const { short, sessionId, jsonlPath } = await spawnBackground(prompt, args, parentCwd, {
        VIBISUAL_SUBAGENT_ID: sub.id,
        VIBISUAL_PARENT_AGENT_ID: sub.parentAgentId,
      });

      sub.sessionId = sessionId;
      sub.agentViewShort = short;
      sub.agentViewSessionId = sessionId;
      this.runningAgentViewWatchers.set(sub.id, { short, sessionId });
      // 워처가 섰으니 이제 생존 대조가 이 sub 를 사실로 판정할 수 있다.
      this.clearDispatching(sub.id);
      logger.info(`SubAgent ${sub.id} agent-view spawned: short=${short} sessionId=${sessionId}`);
      // 매핑을 즉시 영속한다 — 다음 체크포인트 전에 죽으면 `reattachAgentViewOnBoot` 가 살아 있는 워커를 못 찾아 세션을 잃는다.
      this.onPersistNeeded?.();

      // 진짜 마감 — 재진입 가드(`terminalProcessed`)는 호출부(`onTerminal`)가 든다.
      const finishTerminal = async (state: AgentViewJobState): Promise<void> => {
        this.cancelDeferredSeal(sub.id);

        // 결과 텍스트 — state.json output.result 우선, 폴백으로 JSONL last assistant(③-4 규칙 경유).
        const resultText: string | undefined = this.turnResultText(
          cmd,
          parentCwd,
          sub.sessionId,
          (typeof state.output?.result === 'string' && state.output.result) || undefined,
        );
        if (resultText) {
          sub.lastResult = resultText;
          cmd.result = resultText;
        }
        // §2.4 (한도 정지) — 스트림을 놓쳤을 때의 마지막 그물. 결과 본문이 통지 그 자체면 세운다.
        this.noteUsageLimitText(sub, resultText);

        // 토큰 집계 — 기존 readSessionTokenData 그대로 (같은 JSONL).
        try {
          const tokenData = sub.sessionId ? readSessionTokenData(parentCwd, sub.sessionId) : null;
          if (tokenData && tokenData.turns.length > 0) {
            const prevInput = sub.totalInputTokens ?? 0;
            const prevOutput = sub.totalOutputTokens ?? 0;
            let totalIn = 0;
            let totalOut = 0;
            for (const t of tokenData.turns) {
              totalIn += t.inputTokens + t.cacheReadTokens + t.cacheCreateTokens;
              totalOut += t.outputTokens;
            }
            sub.totalInputTokens = totalIn;
            sub.totalOutputTokens = totalOut;
            cmd.inputTokens = Math.max(0, totalIn - prevInput);
            cmd.outputTokens = Math.max(0, totalOut - prevOutput);
            const lastTurn = tokenData.turns[tokenData.turns.length - 1];
            if (lastTurn?.model) sub.modelName = lastTurn.model;
            logger.info(`SubAgent ${sub.id} agent-view tokens: in=${totalIn} out=${totalOut} delta_in=${cmd.inputTokens} delta_out=${cmd.outputTokens}`);
          }
        } catch (err) {
          logger.debug(`SubAgent ${sub.id} agent-view token read failed: ${err instanceof Error ? err.message : String(err)}`);
        }

        // 상태 산정 — legacy 와 동일한 분류(user stop / killed / failed / done).
        const userStopped = this.stoppedByUser.delete(sub.id);
        const stateStr = String(state.state || '');
        const isFailed = stateStr === 'failed';
        sub.status = userStopped ? 'idle' : ((killed || isFailed) ? 'error' : 'idle');
        sub.lastActivityAt = Date.now();
        cmd.status = userStopped ? 'completed' : (killed ? 'error' : (isFailed ? 'error' : 'completed'));
        if (userStopped) {
          cmd.result = `[Stopped by user]${resultText ? `\n\n${resultText}` : ''}`;
        } else if (killed) {
          cmd.result = `[Stopped: max turns reached (${turnCount}/${maxTurns})]${resultText ? `\n\n${resultText}` : ''}`;
        }
        // §5.5 #17-12 ③ — agent-view 경로도 사유를 남긴다(최대 턴 중단인지, 잡 자체가 실패인지).
        if (cmd.status === 'error') {
          if (killed) this.failCommand(sub, cmd, { code: 'maxTurns', detail: `${turnCount}/${maxTurns}` });
          else this.failCommand(sub, cmd, { code: 'agentView', ...(state.detail ? { detail: state.detail } : {}) });
        }
        if (!userStopped) this.failIfDispatchResultMissing(sub, cmd);
        this.stampTurnStopReason(sub, cmd, { userStopped, maxTurns: killed });

        logger.info(`SubAgent ${sub.id} agent-view finished (state=${stateStr}, killed=${killed}, userStopped=${userStopped}, turns=${turnCount}, result=${resultText ? 'yes' : 'no'})`);

        // 이 세션의 실행이 끝났다 = 그 자식인 배경 작업도 끝났다(위 close 핸들러와 같은 근거).
        this.retireLiveBackgroundTasks(sub.id);
        this.clearPendingSubagentTasksForSession(sub.parentAgentId, sub.id);
        this.runningAgentViewWatchers.delete(sub.id);
        this.clearDispatching(sub.id);
        // §5.5 #17-24 ⑥ — 실행이 끝났으면 접는 중일 수 없다(끝 줄을 놓친 압축 표식을 여기서 걷는다).
        this.setCompacting(sub, false);
        try { await detachWatcher(short); } catch { /* ignore */ }
        this.onSubStatusChange?.(sub.parentAgentId);
        this.onComplete?.();
      };

      await attachWatcher({
        short,
        sessionId,
        jsonlPath,
        subAgentId: sub.id,
        parentAgentId: sub.parentAgentId,
        onEvents: (events) => {
          for (const evt of events) this.emitStreamEvent(evt);
        },
        onLine: (obj) => {
          // §2.4 (한도 정지) — agent-view 는 JSONL 을 그대로 읽으므로 `quotaLimits` 봉투까지 온다
          //   (리셋 시각을 숫자로 얻는 유일한 경로다).
          this.noteUsageLimitLine(sub, obj);
          this.noteTurnStopLine(cmd.id, obj);
          // §5.5 #17-24 ⑥ — JSONL 에는 status 줄이 없어 끝 신호(`compact_boundary`·대화 줄)만 온다. 시작은 PreCompact 훅이 세운다.
          this.noteCompactionLine(sub, obj);
          // assistant 메시지 = 1턴. maxTurns 초과 시 supervisor 에 stop 발사.
          if (obj['type'] === 'assistant' && !killed) {
            turnCount++;
            if (maxTurns > 0 && turnCount >= maxTurns) {
              killed = true;
              void stopSession(short);
              logger.warn(`SubAgent ${sub.id} agent-view killed: max turns reached (${turnCount}/${maxTurns})`);
            }
          }
        },
        // `turn_duration` / terminal state 도 **턴 경계**일 뿐이다 — 백그라운드 작업 통지가 밀려
        //   있으면 `--bg` worker 가 그 자리에서 다시 돌기 시작한다(`turnSeal.ts`). 잠정이면 붙들어
        //   두고, 턴이 이어지면 watcher 의 종료 감지를 되살려 **다음** 진짜 종료를 잡는다.
        onTerminal: (state) => {
          if (terminalProcessed) return;
          terminalProcessed = true;
          this.sealTurn(
            sub,
            /*canResume=*/true,
            () => { void finishTerminal(state); },
            () => { terminalProcessed = false; resumeAgentViewWatch(short); },
          );
        },
      });
    } catch (err) {
      logger.warn(`SubAgent ${sub.id} agent-view dispatch failed: ${err instanceof Error ? err.message : String(err)} — falling back to legacy`);
      // dispatch 자체 실패 시 (예: supervisor down) legacy path 로 폴백.
      this._executeViaLegacy(cmd, sub, parentCwd, prompt, configArgs, maxTurns);
    }
  }

  /**
   * §5.7 #23-2 — legacy `claude -p`(stream-json stdin). `VIBISUAL_PERSISTENT_CHILD` 면 sub 당 자식 하나를 살려 두고 다음 턴은 stdin 으로 쓴다(`=0` 이면 매 턴 spawn).
   * **첫 턴도 persistent 다** — `Monitor`·`Bash run_in_background` 는 CLI 의 자식이라 result 뒤 종료하면 통지 없이 죽고
   * 다음 명령에 `No completion record was found …` 가 뜬다(§5.5 #17-9 ⑩). 자식이 뜻밖에 죽어도 `sub.sessionId` 가 남아 다음 execute 가 새 spawn 으로 잇는다.
   */
  private _executeViaLegacy(
    cmd: QueuedCommand,
    sub: SubAgent,
    parentCwd: string,
    prompt: string,
    configArgs: string[],
    maxTurns: number,
    maxBudgetUsd = 0,
    /** §4 (CLI 사양 추종) — `--fallback-model` 값. 빈 문자열이면 미전달. */
    fallbackModel = '',
    /** §4 (스트림 3종) — persistent·legacy **양쪽**에 실리는 스트림 확장 플래그. 빈 배열이면 종전과 같다. */
    streamFlags: string[] = [],
  ): void {
    // §4 — 비용 상한·크레딧 턴은 매 턴 fresh `--print` 다(`--max-budget-usd` 는 `--print` 전용, 상주 자식은 키를 다음 턴까지 들고 간다).
    // sessionId 유무는 조건이 아니다 — 첫 턴부터 살려야 그 턴의 감시가 산다.
    const creditTurn = this.pendingCreditRoute.get(sub.id)?.cmdId === cmd.id;
    const usePersistent = PERSISTENT_CHILD_ENABLED && maxBudgetUsd <= 0 && !creditTurn;

    // ─── REUSE PATH ─────────────────────────────────────────────────────
    // 살아있는 자식 + ready=true 면 fresh spawn 없이 stdin write 만으로 다음 턴 시작.
    // node boot + claude init + JSONL 재로드 + MCP 재연결 + hook 재초기화 비용 = 0.
    const existingChild = this.runningChildren.get(sub.id);
    // §5.5 #17-18 — **창구가 닫힌 자식(`stdin.end()` 받음)은 재사용도 덮어쓰기도 안 한다** — 쓰면 write-after-end 가 프로세스를 흔들고,
    //   덮어 띄우면 옛 자식의 close 핸들러가 새 장부를 지운다. 큐로 되돌려 반드시 오는 `close` 의 `onComplete` 에 맡긴다.
    if (existingChild && !isChildStdinWritable(existingChild)) {
      this._requeueForDyingChild(sub, cmd);
      this.onSubStatusChange?.(sub.parentAgentId);
      return;
    }
    // §4 API 크레딧 — `--print` 새 스폰이 필요한데 놀던 persistent 자식이 있으면 내리고 명령은 큐로 돌린다(덮으면 옛 자식·인증이 장부 밖에 남는다).
    //   배경 작업이 살아 있으면 내리지 않는다 — 함께 죽는다.
    if (!usePersistent && existingChild && this.persistentChildReady.get(sub.id) === true && !this.hasLiveBackgroundWork(sub)) {
      logger.info(`SubAgent ${sub.id} per-turn --print spawn needed (budget/credits) — retiring idle persistent child; cmd=${cmd.id} resumes on a fresh spawn`);
      this.persistentSpawnModelKey.delete(sub.id);
      this.intentionalKill.add(sub.id);
      this._requeueForDyingChild(sub, cmd);
      terminateChildTree(existingChild);
      this.onSubStatusChange?.(sub.parentAgentId);
      return;
    }
    // §4 (상태바 모델 칸 ④) — 모델 축이 바뀌면 놀던 자식을 갈아 끼운다(재사용은 인자를 다시 안 실어 옛 모델로 답한다).
    //   턴은 큐로, 자식은 의도된 종료로 — `close` 가 `--resume` 으로 다시 집는다. 배경 작업이 살아 있으면 내리지 않는다.
    if (usePersistent && existingChild && this.persistentChildReady.get(sub.id) === true) {
      const verificationDecision = decideVerificationReuse(
        this.persistentSpawnVerificationKey.get(sub.id), verificationMcpKeyOf(configArgs), this.hasLiveBackgroundWork(sub),
      );
      if (verificationDecision === 'blocked') {
        this.rejectVerificationSetup(sub, cmd, 'Verification tools cannot reconnect while this session has live background work. Finish that work or run verification in another session.');
        return;
      }
      if (verificationDecision === 'respawn') {
        this.persistentSpawnVerificationKey.delete(sub.id);
        this.intentionalKill.add(sub.id);
        this._requeueForDyingChild(sub, cmd);
        terminateChildTree(existingChild);
        this.onSubStatusChange?.(sub.parentAgentId);
        return;
      }
      const decision = decidePersistentReuse({
        spawnedKey: this.persistentSpawnModelKey.get(sub.id),
        wantKey: modelAxesKeyOf(configArgs),
        hasLiveBackgroundWork: this.hasLiveBackgroundWork(sub),
      });
      if (decision === 'respawn') {
        logger.info(
          `SubAgent ${sub.id} model/compact-window axes changed since spawn (${this.persistentSpawnModelKey.get(sub.id)?.replace(/\n/g, ' ')}`
          + ` -> ${modelAxesKeyOf(configArgs).replace(/\n/g, ' ')}) — retiring idle persistent child; cmd=${cmd.id} resumes on a fresh spawn`,
        );
        this.persistentSpawnModelKey.delete(sub.id);
        this.intentionalKill.add(sub.id);
        this._requeueForDyingChild(sub, cmd);
        terminateChildTree(existingChild);
        this.onSubStatusChange?.(sub.parentAgentId);
        return;
      }
      if (decision === 'reuse-held') {
        logger.info(`SubAgent ${sub.id} model/compact-window axes changed but background work is still running in the child — reusing it for this turn`);
      }
    }
    if (usePersistent && existingChild && this.persistentChildReady.get(sub.id) === true) {
      this.persistentChildReady.set(sub.id, false);
      this.persistentInFlightCmd.set(sub.id, {
        cmd, turnCount: 0, resultText: undefined, killed: false, maxTurns, parentCwd, mainActivity: false,
      });
      try {
        const inputLine = JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: prompt }] },
        }) + '\n';
        existingChild.stdin?.write(inputLine, 'utf8');
        // 재사용 경로는 자식이 이미 서 있다 — 표식만 걷는다.
        this.clearDispatching(sub.id);
        logger.info(`SubAgent ${sub.id} persistent child REUSED — sending next prompt via stdin (no fresh spawn)`);
      } catch (err) {
        // stdin write 실패 — child 가 이미 죽었을 수 있음. close 핸들러가 정리할 것.
        logger.warn(`SubAgent ${sub.id} persistent stdin write failed: ${err instanceof Error ? err.message : String(err)} — child may have died, will respawn next turn`);
        this.persistentInFlightCmd.delete(sub.id);
        this.persistentChildReady.delete(sub.id);
        cmd.status = 'error';
        // sub 도 내린다 — close 핸들러는 in-flight 가 지워져 sub 를 안 건드리므로, 안 내리면 죽은 자식이 idle sweep 까지 "실행 중"이다.
        sub.status = 'error';
        sub.lastActivityAt = Date.now();
        this.clearDispatching(sub.id);
        this.failCommand(sub, cmd, { code: 'stdin', detail: err instanceof Error ? err.message : String(err) });
        this.onSubStatusChange?.(sub.parentAgentId);
        this.onComplete?.();
      }
      return;
    }

    // FRESH SPAWN — 프롬프트는 argv 대신 stream-json stdin 으로 쓴다(Windows 에서 argv 가 OEM(cp949)로 읽혀 한글이 깨진다).
    // persistent 는 `--print` 없이 살아 재사용, legacy 는 `--print` 로 result 뒤 끝난다. `--include-partial-messages` 는 parseStreamLine partial 가드와 짝.
    // §4 — `--max-budget-usd`·`--fallback-model` 은 `--print` 전용이라 persistent 엔 못 싣는다(그래서 비용 상한이면 persistent 를 끈다).
    const printFlags = ['--include-partial-messages', ...streamFlags];
    if (maxBudgetUsd > 0) printFlags.push('--max-budget-usd', String(maxBudgetUsd));
    if (fallbackModel) printFlags.push('--fallback-model', fallbackModel);

    const args = usePersistent
      ? [
          // 첫 턴은 이어붙일 대화가 없다 — `--resume` 만 빼고 나머지는 같다(스폰 형태 한 벌).
          ...(sub.sessionId ? ['--resume', sub.sessionId] : []),
          ...configArgs,
          // 토큰 스트리밍은 persistent 에도 싣는다 — CLI 의 "requires --print" 검사는 실은 비대화형 판정이라 파이프 자식은 통과한다(2.1.228 실측).
          //   빼면 기본 경로인 persistent 턴이 실시간 누적을 잃는다. §4 스트림 3종도 같다.
          '--include-partial-messages', ...streamFlags,
          '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        ]
      : (sub.sessionId
          ? ['--resume', sub.sessionId, '--print', ...configArgs, ...printFlags, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']
          : ['--print', ...configArgs, ...printFlags, '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);

    logger.info(`SubAgent ${sub.id} ${usePersistent ? 'persistent spawning' : 'legacy executing'}: "${cmd.text.slice(0, 50)}..."${configArgs.length > 0 ? ` [config: ${configArgs.join(' ')}]` : ''}`);

    // §4 (실행본 자가 복구) — **무엇으로 띄우려 했는지**를 붙잡아 둔다. spawn 이 ENOENT 로 죽었을 때
    //   재해석 결과와 이 값을 대조해야 "경로가 실제로 바뀌었으니 다시 태울 만하다"를 판정할 수 있다.
    const triedBin = CLAUDE_BIN();
    /** ENOENT 로 실행본이 사라져 이 명령을 되태우기로 한 경우 — 판단은 'error', 실행은 'close' 에서. */
    let retryForMissingBin = false;

    try {
      const child = spawn(triedBin, args, {
        cwd: parentCwd,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin 으로 프롬프트를 쓴다.
        shell: false,
        // POSIX 한정 detached — 그룹 리더가 아니면 `-pid` 킬이 ESRCH 로 단일 pid 킬이 되어 MCP 서버·node worker(손자)가 mac/linux 에 고아로 남는다.
        //   stdio 파이프엔 영향 없다. `unref()` 는 절대 붙이지 말 것.
        ...processGroupSpawnOptions(),
        // §4 (앱 전용 엔진) ⑤ — 앱 전용 실행본이면 엔진 자체 갱신을 끈다(`claudeSpawnEnv`). 판은 앱이 바꾼다.
        // §4 API 크레딧 — 구독 경로로 정해진 스폰이면 마지막에 키를 걷는다(`creditSpawnEnv`). 크레딧 경로의 키는
        //   위 `pendingConfigEnv` 에 실려 온다.
        env: this.creditSpawnEnv(sub.id, claudeSpawnEnv({
          ...process.env,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          PYTHONIOENCODING: 'utf-8',
          // §5.3 #12-1 — 전역 PreToolUse 훅이 우리 세션을 알아보는 표식(CLI 세션 id 가 나오기 전에도).
          VIBISUAL_SUBAGENT_ID: sub.id,
          VIBISUAL_PARENT_AGENT_ID: sub.parentAgentId,
          VIBISUAL_OWNER_AGENT_ID: sub.parentAgentId,
          // §5.3 — 중첩 깊이(`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`) · 자동 기억 끄기. 설정이 없으면 빈 객체.
          ...(this.pendingConfigEnv.get(sub.id) ?? {}),
        }, triedBin)),
      });
      this.runningChildren.set(sub.id, child);
      // §4 API 크레딧 — 이 명령을 크레딧으로 띄웠으면 지금 장부에 실행을 연다(자식이 실제로 선 순간이 시작이다).
      //   persistent 자식에는 열지 않는다 — 크레딧 경로는 언제나 `--print` 한 턴짜리다.
      const creditPending = this.pendingCreditRoute.get(sub.id);
      if (creditPending && creditPending.cmdId === cmd.id && !usePersistent) {
        this.pendingCreditRoute.delete(sub.id);
        this.creditRuns.set(sub.id, { runId: apiCreditService.beginRun(sub.id, cmd.id), child });
      }
      // 콜백은 sub id 가 아니라 이 스폰의 소유권을 확인한다. 이전 자식의 늦은 출력·오류·close 가
      //   재개한 자식의 세션·턴·백그라운드 작업 장부를 바꾸면 안 된다.
      const isCurrentChild = (): boolean => this.runningChildren.get(sub.id) === child;
      // §5.5 #17-18 — 새 자식이 섰다 = 앞 자식은 이미 내려갔다(창구가 닫힌 자식이 있으면 여기까지 오지 않는다).
      //   그 자식에게 붙였던 중지·종료 표식이 남아 있으면 **이 명령**의 끝을 잘못 판정하므로 여기서 걷는다.
      this.stoppedByUser.delete(sub.id);
      this.intentionalKill.delete(sub.id);
      this.wakeSub(sub); // §2.4 (잠듦) — 자식이 다시 섰으니 표식 해제
      // §5.5 #17-18 — **stdin 오류는 예외가 아니라 이벤트로 온다** — 안 들으면 `uncaughtException` 이 돌던 dispatch 체인을 끊는다(실측 crash.log).
      //   로그만 남기고 뒷정리는 반드시 오는 `close` 에 맡긴다.
      child.stdin?.on('error', (err: Error) => {
        logger.warn(`SubAgent ${sub.id} stdin error: ${err.message} — child is going down; close handler settles it`);
      });
      // 자식이 떴으니 이제 생존 대조가 이 sub 를 사실로 판정할 수 있다.
      this.clearDispatching(sub.id);
      // §5.5 #17-12 ③ — 새 자식이면 앞 실행의 stderr 꼬리는 남기지 않는다(옛 사유가 새 실패에 붙지 않게).
      this.childStderrTails.delete(sub.id);
      registerSpawnedPid(child.pid);
      child.once('exit', () => unregisterSpawnedPid(child.pid));
      // §5.3 #9-2 — 손자까지 우리 묶음에 넣는다(Windows Job Object · mac/Linux 그룹 + 기억). 상주 자식이 내려가면
      //   그 세션이 끝난 것이라 남은 것을 정리한다. 일회성(legacy) 실행은 명령마다 내려가므로 정리하지 않고
      //   상한·압박 감시만 받는다 — 정리하면 에이전트가 띄운 개발 서버가 명령마다 꺼진다.
      processGuard.guardChild(child, { parentAgentId: sub.parentAgentId, subAgentId: sub.id }, 'claude', { reapOnExit: usePersistent });
      // §5.5 #17-18 — 아래 마감은 전부 `close` 에 걸려 있다. 트리 종료가 놓친 손자가 파이프를 쥐고 있으면
      //   그 `close` 가 몇 분씩 안 와 끝난 턴이 "도는 중"으로 남고, 새 명령은 그 뒤에 줄을 섰다.
      forceCloseAfterExit(child);

      if (usePersistent) {
        // §4 (상태바 모델 칸 ④) — 이 자식이 **어떤 모델 축으로 떴는지**. 재사용 직전 대조의 한쪽이다.
        this.persistentSpawnModelKey.set(sub.id, modelAxesKeyOf(configArgs));
        this.persistentSpawnVerificationKey.set(sub.id, verificationMcpKeyOf(configArgs) ?? '');
        capMapSize(this.persistentSpawnVerificationKey, SESSION_KEYED_MAP_MAX);
        capMapSize(this.persistentSpawnModelKey, SESSION_KEYED_MAP_MAX);
        this.persistentChildReady.set(sub.id, false);
        this.persistentLineBuf.set(sub.id, '');
        this.persistentInFlightCmd.set(sub.id, {
          cmd, turnCount: 0, resultText: undefined, killed: false, maxTurns, parentCwd, mainActivity: false,
        });
      }

      // 프롬프트를 stream-json 한 줄로 stdin 에 쓴다. legacy 는 `stdin.end()` 로 닫아 응답 뒤 끝나고, persistent 는 열어 두어 다음 줄을 기다린다.
      try {
        const inputLine = JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        }) + '\n';
        child.stdin?.setDefaultEncoding('utf8');
        child.stdin?.write(inputLine, 'utf8');
        if (!usePersistent) child.stdin?.end();
      } catch (err) {
        logger.warn(`SubAgent ${sub.id} stdin write failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Legacy 경로 전용 closure state — persistent 경로는 persistentInFlightCmd 맵 사용.
      let stdout = '';
      let turnCount = 0;
      let killed = false;
      let lineBuf = '';

      child.stdout?.on('data', (chunk: Buffer) => {
        if (!isCurrentChild()) return;
        // UTF-8 을 명시한다 — 기본 toString() 이 플랫폼에 따라 OEM 으로 떨어질 수 있다.
        const text = chunk.toString('utf8');

        // ── PERSISTENT 경로: 맵 기반 line 버퍼 + result 라인 인라인 검출 ──
        if (usePersistent) {
          let buf = this.persistentLineBuf.get(sub!.id) ?? '';
          buf += text;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          this.persistentLineBuf.set(sub!.id, buf);
          for (const line of lines) {
            // 앞 줄의 턴 마감 콜백에서 재스폰했을 수도 있다.
            if (!isCurrentChild()) return;
            this._handlePersistentStdoutLine(line, sub!, child);
          }
          return;
        }

        // ── LEGACY 경로: closure 기반 ──
        stdout += text;
        lineBuf += text;
        const lines = lineBuf.split('\n');
        lineBuf = lines.pop() ?? ''; // 마지막 불완전 라인은 다음 chunk에서 이어서 파싱
        for (const line of lines) {
          if (!isCurrentChild()) return;
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line) as Record<string, unknown>;
            // 첫 system/init 라인에서 session_id 즉시 캡처.
            const lineSessionId = obj['type'] === 'system' ? obj['session_id'] : undefined;
            if (typeof lineSessionId === 'string' && lineSessionId.length > 0) {
              if (!sub!.sessionId) {
                sub!.sessionId = lineSessionId;
                logger.info(`SubAgent ${sub!.id} session assigned (stream): ${sub!.sessionId}`);
              } else if (lineSessionId !== sub!.sessionId && isSlashCommandText(cmd.text)) {
                // §5.5 #17-2 — `/clear` 의 세션 회전 추종(persistent 경로와 같은 규약).
                //   legacy 는 매 턴 fresh spawn + `--resume` 이라 여기서 안 따라가면 **바로 다음 턴**이
                //   비우기 전 대화로 되돌아간다.
                logger.info(`SubAgent ${sub!.id} session rotated by slash command: ${sub!.sessionId} → ${lineSessionId}`);
                sub!.sessionId = lineSessionId;
              }
            }
            // type:"assistant" = Claude가 응답한 1턴 (도구 호출 포함)
            if (obj['type'] === 'assistant') {
              turnCount++;
              if (maxTurns > 0 && turnCount >= maxTurns && !killed) {
                killed = true;
                this.intentionalKill.add(sub!.id);
                terminateChildTree(child);
                logger.warn(`SubAgent ${sub!.id} killed: max turns reached (${turnCount}/${maxTurns})`);
              }
            }
            // §2.4 (한도 정지) — 한도 통지는 실패가 아니라 **정상 종료로 오는 합성 한 줄**이라
            //   종료 코드만 보는 마감 경로가 놓친다. 세 스트림 경로에서 같은 판정을 태운다.
            this.noteUsageLimitLine(sub!, obj);
            // §4 API 크레딧 — 크레딧 실행이면 계량기에 먹인다(한도에 닿으면 이 자리에서 멈춤이 걸린다).
            this.noteCreditLine(sub!, obj, child);
            // §5.5 #17-12 ③-6 — 모델이 적어 보낸 끝 사유를 봉인 때까지 들고 있는다.
            this.noteTurnStopLine(cmd.id, obj);
            // §5.5 #17-24 ⑥ — 압축 시작(`status:"compacting"`)·끝을 세 스트림 경로에서 같은 판정으로.
            this.noteCompactionLine(sub!, obj);
            // §4 — legacy `--print` 스폰은 `--include-partial-messages` 라 토큰 델타가 온다(`partialMessages: true`). 한 줄이 여러 블록일 수 있다.
            const streamEvts = parseStreamLine(obj, sub!.id, sub!.parentAgentId, { partialMessages: true, hookEvents: this.streamHookEventsOn.get(sub!.id) === true });
            for (const evt of streamEvts) this.emitStreamEvent(evt);
          } catch { /* 불완전 JSON — 다음 라인에서 처리 */ }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (!isCurrentChild()) return;
        const text = chunk.toString('utf8');
        logger.debug(`SubAgent ${sub!.id} stderr: ${text.slice(0, 200)}`);
        // §5.5 #17-12 ③ — 꼬리만 보관. 실패로 끝났을 때 "왜"를 말할 유일한 재료다(성공하면 안 쓴다).
        const prev = this.childStderrTails.get(sub!.id) ?? '';
        this.childStderrTails.set(sub!.id, (prev + text).slice(-COMMAND_ERROR_DETAIL_LIMIT));
      });

      child.on('error', (err) => {
        if (!isCurrentChild()) return;
        logger.warn(`SubAgent ${sub!.id} spawn error: ${err.message}`);
        // §4 (실행본 자가 복구) — ENOENT = 쥔 `claude` 가 사라졌다(확장 자동 갱신). 재해석 경로가 **방금 실패한 경로와 다를 때만** 되태운다(무한 재시도 퓨즈).
        //   requeue 는 뒤이어 오는 'close'(code -4058)에서 한 번만 — 여기서 하면 그 'close' 가 명령을 다시 마감한다.
        if (noteClaudeSpawnFailure(err) && getClaudeBin().binPath !== triedBin) {
          retryForMissingBin = true;
          logger.warn(
            `SubAgent ${sub!.id} claude binary vanished (${triedBin}) — requeueing cmd=${cmd.id}`
            + ` for the re-resolved binary (${getClaudeBin().binPath})`,
          );
          return;
        }
        sub!.status = 'error';
        sub!.lastActivityAt = Date.now();
        cmd.status = 'error';
        this.clearDispatching(sub!.id);
        // §4 API 크레딧 — 뜨지 못한 실행도 장부에서 닫는다(쓴 돈은 0 이지만 도는 실행으로 남으면 한도를 붙든다).
        this.settleCreditRun(sub!);
        this.failCommand(sub!, cmd, { code: 'spawn', detail: err.message });
        // 형제 종료 경로들과 같은 짝 — 이 호출이 빠지면 sub 도트 변화가 부모 재계산·broadcast 를 못 탄다.
        this.onSubStatusChange?.(sub!.parentAgentId);
        this.onComplete?.();
      });

      child.on('close', (code) => {
        // 공유 장부를 건드리기 **전** 에 판정한다. 배경 작업 정리나 ENOENT 되태우기도 새 자식의
        //   몫을 지울 수 있다. legacy 탭을 닫아 자식 자체가 없는 경우의 기존 명령 마감은 유지한다.
        if (!isCurrentChild() && (usePersistent || this.runningChildren.has(sub!.id))) {
          if (!this.runningChildren.has(sub!.id)) this.intentionalKill.delete(sub!.id);
          logger.info(`SubAgent ${sub!.id} stale child closed (code=${code}) — current child left untouched`);
          return;
        }
        // §5.5 #17-24 ⑥ — 자식이 내려갔으면 접는 중일 수 없다(압축 도중 크래시·의도된 종료·되태우기 모두).
        this.setCompacting(sub!, false);
        // §4 (실행본 자가 복구) — 실행본이 사라져 되태우기로 한 경우: 아래 정리·마감을 **전부 건너뛰고**
        //   명령을 큐로 돌려놓는다. `onComplete` 가 부르는 다음 dispatch 가 재해석된 경로로 다시 띄운다.
        //   (여기서 걸러 두면 이어지는 persistent/legacy 마감 분기가 이 명령을 실패로 못박지 않는다.)
        if (retryForMissingBin) {
          if (this.runningChildren.get(sub!.id) === child) this.runningChildren.delete(sub!.id);
          // §4 API 크레딧 — 이 실행은 닫고, 되태운 실행은 다음 execute 가 경로를 다시 정해 새로 연다.
          this.settleCreditRun(sub!);
          this._requeueForDyingChild(sub!, cmd);
          this.onSubStatusChange?.(sub!.parentAgentId);
          this.onComplete?.();
          return;
        }

        // §5.5 #17-9 ⑱ — 자식이 내려갔으니 붙듦을 걷고 **다시 센다** — 아래 정리는 쉬던 자식의 크래시를 안 세어 `active` 가 남는다(실측 2분 뒤에도).
        if (this.clearNoticeResumeHold(sub!.id) && this.syncBgSubStatus(sub!.parentAgentId)) {
          this.onSubStatusChange?.(sub!.parentAgentId);
        }

        // **여기가 백그라운드 작업의 실제 종료 시점이다** — 배경 셸은 이 프로세스의 자식이라 함께 끝난다(공식: 결과 약 5초 뒤).
        //   `sweepOrphanedBackgroundTasks` 는 이 이벤트를 놓쳤을 때의 그물이다.
        if (this.retireLiveBackgroundTasks(sub!.id)) this.onSubStatusChange?.(sub!.parentAgentId);
        // 훅 대차대조도 같다 — `claude -p` 는 배경 서브에이전트를 끝까지 기다리므로(공식, 기본 상한 10분) 프로세스가 내려갔으면 그 자식도 끝났다.
        //   안 비우면 `SubagentStop` 을 놓친 항목이 세션을 활동 중으로 붙든다.
        this.clearPendingSubagentTasksForSession(sub!.parentAgentId, sub!.id);

        // ── PERSISTENT 경로: intentional vs crash 분기 ──
        if (usePersistent) {
          const wasIntentional = this.intentionalKill.delete(sub!.id);
          this.runningChildren.delete(sub!.id);
          this.persistentChildReady.delete(sub!.id);
          this.persistentLineBuf.delete(sub!.id);
          const inFlight = this.persistentInFlightCmd.get(sub!.id);
          this.persistentInFlightCmd.delete(sub!.id);

          if (!wasIntentional) {
            // 크래시 — sub.sessionId 는 의도적으로 유지(다음 execute 가 --resume 으로 자연 복구).
            logger.warn(`SubAgent ${sub!.id} persistent child exited unexpectedly (code=${code}) — preserving sessionId for resume on next turn`);
            if (inFlight) {
              inFlight.cmd.status = 'error';
              inFlight.cmd.result = `[Persistent child crashed (code=${code}); retry on next turn]`;
              this.failCommand(sub!, inFlight.cmd, {
                code: 'crash',
                ...(code !== null ? { exitCode: code } : {}),
                ...(this.childStderrTails.get(sub!.id) ? { detail: this.childStderrTails.get(sub!.id)! } : {}),
              });
              sub!.status = 'error';
              sub!.lastActivityAt = Date.now();
              this.onSubStatusChange?.(sub!.parentAgentId);
              this.onComplete?.();
            }
            return;
          }

          // 의도된 종료(stop/remove/shutdown) — in-flight 가 있으면 finalize, 없으면 단순 정리.
          if (inFlight) {
            this._finalizeLegacyCommand(sub!, inFlight.cmd, inFlight.parentCwd, undefined, inFlight.turnCount, inFlight.killed, inFlight.maxTurns, code, '', /*deleteRunningChild=*/false);
          } else {
            sub!.status = 'idle';
            sub!.lastActivityAt = Date.now();
            this.onSubStatusChange?.(sub!.parentAgentId);
            this.onComplete?.();
          }
          return;
        }

        // ── LEGACY 경로: 기존 close 핸들러 ──
        this._finalizeLegacyCommand(sub!, cmd, parentCwd, undefined, turnCount, killed, maxTurns, code, stdout, /*deleteRunningChild=*/true);
      });
    } catch (err) {
      logger.warn(`SubAgent ${sub!.id} spawn failed: ${err instanceof Error ? err.message : String(err)}`);
      // §4 (실행본 자가 복구) — 동기 throw 경로. 자식이 없어 'close' 가 오지 않으므로 여기서 바로 되태운다.
      if (noteClaudeSpawnFailure(err) && getClaudeBin().binPath !== triedBin) {
        this._requeueForDyingChild(sub, cmd);
        this.onSubStatusChange?.(sub.parentAgentId);
        this.onComplete?.();
        return;
      }
      sub.status = 'error';
      sub.lastActivityAt = Date.now();
      cmd.status = 'error';
      this.clearDispatching(sub.id);
      this.settleCreditRun(sub); // §4 API 크레딧 — 뜨지 못한 실행도 닫는다(도는 실행 수가 남지 않게).
      this.failCommand(sub, cmd, { code: 'spawn', detail: err instanceof Error ? err.message : String(err) });
      this.onSubStatusChange?.(sub.parentAgentId);
      this.onComplete?.();
    }
  }

  /**
   * persistent 자식의 stdout 한 줄 — `result` 가 턴 끝, 자식은 살려 둔다.
   * 순서 함정: finalize → `onComplete` → `processNextCommand` → `execute` 가 동기라 `persistentChildReady = true` 를 **finalize 전에** 세워야 재사용된다.
   */
  private _handlePersistentStdoutLine(line: string, sub: SubAgent, child: ChildProcess): void {
    if (!line.trim()) return;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(line) as Record<string, unknown>; } catch { return; }

    // session_id 캡처 — 첫 system 라인. persistent 경로는 --resume 이라 이미 sub.sessionId 가 있지만,
    // claude 가 새 session 으로 회전시키는 케이스가 있으면 따라간다.
    const lineSessionId = obj['type'] === 'system' ? obj['session_id'] : undefined;
    if (typeof lineSessionId === 'string' && lineSessionId.length > 0) {
      if (!sub.sessionId) {
        sub.sessionId = lineSessionId;
        logger.info(`SubAgent ${sub.id} session assigned (persistent stream): ${sub.sessionId}`);
      } else if (lineSessionId !== sub.sessionId
        && isSlashCommandText(this.persistentInFlightCmd.get(sub.id)?.cmd.text ?? '')) {
        // §5.5 #17-2 — `/clear` 는 **새 세션으로 갈아탄다**(실측 `c00a…` → `f2dc…`). 여기서 안 따라가면
        //   자식이 죽은 뒤 다음 턴이 `--resume <비우기 전 id>` 로 옛 대화를 되살려 초기화가 없던 일이 된다.
        //   회전 추종은 **슬래시 통과 턴에 한정** — 모델 턴의 캡처 규칙은 종전 그대로다.
        logger.info(`SubAgent ${sub.id} session rotated by slash command: ${sub.sessionId} → ${lineSessionId}`);
        sub.sessionId = lineSessionId;
      }
    }

    const inFlight = this.persistentInFlightCmd.get(sub.id);

    // §5.5 #17-18 — 본 대화의 모델 줄은 "이 세션이 지금 말하고 있다"의 **가장 이른** 증거다. 파싱된
    //   이벤트를 기다리면 토큰 줄(`stream_event`)·빈 thinking 은 끝내 신호가 되지 못해, 첫 글자가 나오기
    //   전 수 초 동안 붙든 봉인이 먼저 만료됐다. 곁가지 줄은 본 대화가 아니므로 세지 않는다.
    if (isMainThreadModelLine(obj)) {
      if (inFlight) {
        // §5.5 #17-18 ⑩-1 — **누가 말했는가**를 도장으로 가린다. 남의 턴이 뱉은 줄에 이 래치를
        //   켜면, 그 턴이 낸 끝이 이 명령의 끝으로 읽혀 답도 없이 완료음이 울린다. 도장이 비어
        //   있으면(마감 뒤 흘러든 여운) 이 명령의 것으로 본다 — 새 좀비를 만들지 않기 위해서다.
        const stamp = this.currentTurnId.get(sub.id);
        if (stamp === undefined || stamp === inFlight.cmd.id) {
          inFlight.mainActivity = true;
          clearEarlyResultWait(inFlight);
        }
      }
      // §5.5 #17-9 ⑱ — 끝 통지로 열린 턴의 첫 줄이다. 붙들어 둔 탭은 이제 제 턴으로 돈다.
      this.releaseNoticeResumeHold(sub.id, `raw ${String(obj['type'])}`);
      this.resumeHeldSeal(sub.id, `raw ${String(obj['type'])}`);
    }

    // assistant 턴 카운트 + maxTurns 가드.
    if (obj['type'] === 'assistant' && inFlight && !inFlight.killed) {
      inFlight.turnCount++;
      if (inFlight.maxTurns > 0 && inFlight.turnCount >= inFlight.maxTurns) {
        inFlight.killed = true;
        this.intentionalKill.add(sub.id);
        terminateChildTree(child);
        logger.warn(`SubAgent ${sub.id} killed: max turns reached (${inFlight.turnCount}/${inFlight.maxTurns})`);
      }
    }

    // §2.4 (한도 정지) — legacy 경로와 같은 판정(위 주석 참조).
    this.noteUsageLimitLine(sub, obj);
    // §5.5 #17-12 ③-6 — 끝 사유는 result 줄이 봉인을 부르기 **전에** 적어야 그 봉인이 읽는다.
    this.noteTurnStopLine(inFlight?.cmd.id, obj);
    // §5.5 #17-24 ⑥ — 압축 시작·끝(legacy 경로와 같은 판정). status 줄은 화면에 그리지 않아도 여기서는 읽는다.
    this.noteCompactionLine(sub, obj);

    // 스트림 이벤트 — 클라 중계.
    const streamEvts = parseStreamLine(obj, sub.id, sub.parentAgentId, { hookEvents: this.streamHookEventsOn.get(sub.id) === true });
    for (const evt of streamEvts) this.emitStreamEvent(evt);

    // ── CRITICAL: result 라인 = turn 종료. child 는 살려둔다. ──
    if (obj['type'] === 'result' && inFlight) {
      const resultText: string | undefined =
        typeof obj['result'] === 'string' ? (obj['result'] as string) : undefined;
      // §5.5 #17-12 ③ — CLI 자기 신고 실패는 여기서만 지나가므로 finalize 로 넘겨 사유가 되게 한다.
      const cliError: string | undefined = obj['is_error'] === true
        ? (resultText || (typeof obj['subtype'] === 'string' ? (obj['subtype'] as string) : undefined))
        : undefined;
      if (typeof obj['total_input_tokens'] === 'number') sub.totalInputTokens = obj['total_input_tokens'] as number;
      if (typeof obj['total_output_tokens'] === 'number') sub.totalOutputTokens = obj['total_output_tokens'] as number;

      // `result` 는 턴 경계일 뿐 명령 끝이 아니다 — 밀린 백그라운드 통지가 있으면 CLI 가 다시 돈다(`turnSeal.ts`). 마감은 `sealTurn` 에 맡긴다.
      //   붙든 동안 `persistentInFlightCmd` 를 살려 둔다 — 지우면 이어진 턴의 `result` 를 못 알아본다.
      const sealInFlightTurn = (text: string | undefined, error: string | undefined, unownedResult = false): void => {
        clearEarlyResultWait(inFlight);
        this.sealTurn(sub, /*canResume=*/true, () => {
          // ORDER MATTERS — 함정 주석 참조.
          // 1) line 버퍼 리셋 (이 줄 이후의 다음 턴 chunk 가 들어와도 깨끗히 시작).
          this.persistentLineBuf.set(sub.id, '');
          // 2) ready=true 를 finalize **전** 에 set. finalize 가 onComplete → processNextCommand → execute 를 동기 호출
          //    하므로, ready=true 가 그 호출 전에 set 안 되면 reuse 분기가 영영 안 탄다.
          this.persistentChildReady.set(sub.id, true);
          // 3) in-flight 폐기 — 다음 턴이 fresh value 로 set.
          this.persistentInFlightCmd.delete(sub.id);
          // 4) finalize — child.kill / stdin.end 호출 ❌ (자식 살려둠).
          this._finalizeLegacyCommand(sub, inFlight.cmd, inFlight.parentCwd, text, inFlight.turnCount, inFlight.killed, inFlight.maxTurns, 0, '', /*deleteRunningChild=*/false, error, { unownedResult });
        });
      };

      // §5.5 #17-18 — 이 명령이 말하기 전에 온 `result` 는 끝이 아니다 — `--resume` 자식이 밀린 통지를 먼저 처리한 끝이다(`isResultBeforeOwnTurn`).
      //   봉인하면 답 없이 완료음이 난다. ⑩-1 — 도장이 이 명령 것이 아니면 남의 끝, 비었으면(마감 뒤 여운) 이 명령 것으로 본다.
      const resultStamp = this.currentTurnId.get(sub.id);
      const foreignTurn = resultStamp !== undefined && resultStamp !== inFlight.cmd.id;
      if (isResultBeforeOwnTurn({
        mainActivity: inFlight.mainActivity,
        foreignTurn,
        cliError: cliError !== undefined,
        killed: inFlight.killed,
        interrupted: inFlight.interrupted === true,
        slashCommand: isSlashCommandText(inFlight.cmd.text),
      })) {
        this.cancelDeferredSeal(sub.id);
        noteTurnSealed(this.getTurnSealState(sub.id));
        clearEarlyResultWait(inFlight);
        // §5.5 #17-18 ⑩-5 — 남의 도장이 찍혀 있었다면 그 본문은 이 명령의 답이 아니다. 안전 마감이
        //   끝내 봉인할 때 싣지 않도록 표식만 남긴다(답은 JSONL 폴백이 이 명령의 것으로 되찾는다).
        if (foreignTurn) inFlight.earlyResultForeign = true;
        logger.info(
          `SubAgent ${sub.id} result is not cmd=${inFlight.cmd.id}'s end`
          + ` (${foreignTurn ? `foreign turn stamp=${resultStamp}` : 'no words yet'});`
          + ` waiting for its own turn (safety ${EARLY_RESULT_SAFETY_MS}ms)`,
        );
        const timer = setTimeout(() => {
          inFlight.earlyResultTimer = undefined;
          if (this.persistentInFlightCmd.get(sub.id) !== inFlight || inFlight.mainActivity) return;
          logger.warn(`SubAgent ${sub.id} cmd=${inFlight.cmd.id} stayed silent ${EARLY_RESULT_SAFETY_MS}ms after an early result — sealing it`);
          sealInFlightTurn(resultText, undefined, inFlight.earlyResultForeign === true);
        }, EARLY_RESULT_SAFETY_MS);
        if (typeof timer.unref === 'function') timer.unref();
        inFlight.earlyResultTimer = timer;
        return;
      }

      logger.info(`SubAgent ${sub.id} persistent result detected (turns=${inFlight.turnCount}) — child stays alive`);
      sealInFlightTurn(resultText, cliError);
    } else if (obj['type'] === 'result') {
      // **되살아난 턴의 끝** — 명령이 이미 마감돼 `inFlight` 가 없으니 여기서 세션만 재운다. 안 그러면 재진입이 올린 `active` 가 남는다
      //   (persistent 자식은 살아 있어 `reconcileDeadActiveSubs` 도 못 걷는다).
      this.sealTurn(sub, /*canResume=*/true, () => {
        // 유예 사이에 다음 명령이 나갔을 수 있으므로 재우기 직전에 다시 판정한다.
        if (!shouldSleepResumedTurn({
          subStatus: sub.status,
          processingCommand: this.isSubProcessingCommand(sub.id),
          dispatching: this.dispatchingSubs.has(sub.id),
          cmdDriven: this.cmdDrivenSubs.has(sub.id),
        })) return;
        sub.status = 'idle';
        sub.lastActivityAt = Date.now();
        // §5.5 #17-9 ⑱(e) — 다른 백그라운드 자식이 아직 돌면 탭은 다시 승격된다(`_finalizeLegacyCommand`
        //   와 같은 순서 — 재우기 → 승격 대조 → 상태 통지). idle 로 두면 그 자식의 끝 칩이 왔을 때 붙들
        //   자격(`active`)이 없어, CLI 가 그 통지로 새 턴을 여는 사이에 버블이 `completed` 로 넘어간다(완료음).
        this.syncBgSubStatus(sub.parentAgentId);
        logger.info(this.bgPromotedSubs.has(sub.id)
          ? `SubAgent ${sub.id} resumed turn ended with no in-flight command — other background children still running, stays active`
          : `SubAgent ${sub.id} resumed turn ended with no in-flight command — back to idle`);
        this.onSubStatusChange?.(sub.parentAgentId);
      });
    }
  }

  /**
   * §5.25 (F) — 코덱스 턴. `executeLocalProvider` 와 **같은 뼈대**(스폰 표식 · 생존 근거 ·
   * finish 한 곳)를 쓰되, 턴 루프를 우리가 돌지 않아 훨씬 짧다 — 대화 이력·컨텍스트 자르기·재개는
   * CLI 몫이라 `messages[]` 를 들지 않는다.
   */
  private executeCodexProvider(
    sub: SubAgent,
    cmd: QueuedCommand,
    config: AgentConfig,
    parentCwd: string,
    contextSummary: string,
    livePreamble?: string,
    opts?: {
      extraEnv?: Record<string, string>;
      codexContextArgs?: string[];
      verificationConfig?: VerificationToolsConfig;
      codexEdgeInstructionsEnabled?: boolean;
      appendSystemPrompt?: string;
      codexEdgeConfig?: CodexEdgeConfig;
      codexToolHook?: CodexToolHookConfig;
      codexPermissionHook?: CodexPermissionHookConfig;
      codexHostedBrowserOff?: boolean;
    },
  ): void {
    const provider = config.provider;
    if (!provider) return;
    this.clearDispatching(sub.id);
    // §5.19 (D) 와 같은 이유로 **스폰 표식을 걷는 그 자리에서** 생존 근거를 세운다 — 한 순간도
    //   "아무 근거 없는 active" 가 되지 않게(그 틈이 5초 생존 대조에 걸려 도는 세션을 강등한다).
    this.localInFlightCmd.set(sub.id, cmd);
    const isCurrentTurn = (): boolean => this.index.get(sub.id) === sub && this.localInFlightCmd.get(sub.id) === cmd;

    // §5.25 (O) — `imagePath` 는 **있을 때만** 싣는다. 빈 값으로 붙이면 그림 없는 줄까지
    //   "그림이 있었는데 못 열었다"로 읽힌다(영속 파일에도 그 거짓이 그대로 남는다).
    const emit = (eventType: StreamEventType, content: string, imagePath?: string): void => {
      const event: SubAgentStreamEvent = {
        id: makeEventId(),
        subAgentId: sub.id,
        parentAgentId: sub.parentAgentId,
        timestamp: Date.now(),
        eventType,
        content,
        ...(imagePath ? { imagePath } : {}),
      };
      this.emitStreamEvent(event);
      for (const image of linkedImageEvents(event, process.platform)) this.emitStreamEvent(image);
    };

    const emitTool = (
      eventType: 'tool_use' | 'tool_result',
      content: string,
      toolName: string,
      toolUseId: string,
    ): void => {
      this.emitStreamEvent({
        id: makeEventId(),
        subAgentId: sub.id,
        parentAgentId: sub.parentAgentId,
        timestamp: Date.now(),
        eventType,
        content,
        toolName,
        toolUseId,
      });
    };

    /**
     * 이 턴을 끝맺는다(성공·실패·중지 모두). **멱등하다** — `onDone` 과 정지 워치독(`onIdle({stalled:true})`)이 같은 문으로 와서,
     * 두 번 닫으면 완료 통지·토큰 적산·다음 명령 펌프가 두 번 돈다.
     */
    let closed = false;
    const finish = (error: string | undefined, finalText: string): void => {
      if (closed || !isCurrentTurn()) {
        logger.info(`SubAgent ${sub.id} codex turn already settled - ignoring late close for cmd=${cmd.id}`);
        return;
      }
      closed = true;
      if (this.localInFlightCmd.get(sub.id) === cmd) this.localInFlightCmd.delete(sub.id);
      this.cancelDeferredSeal(sub.id);
      if (this.currentTurnId.get(sub.id) === cmd.id) this.currentTurnId.delete(sub.id);
      const userStopped = this.stoppedByUser.delete(sub.id);
      sub.lastActivityAt = Date.now();
      // §2.4 (한도 정지) — 코덱스는 한도를 `{"type":"error"}` 로 신고한다(§5.25 (F)). 실패 사유와
      //   최종 본문 둘 다 통지 자리라 함께 본다.
      this.noteUsageLimitText(sub, error ?? finalText);
      if (error && !userStopped) {
        sub.status = 'error';
        cmd.status = 'error';
        this.failCommand(sub, cmd, { code: 'cli', detail: error });
      } else {
        sub.status = 'idle';
        cmd.status = 'completed';
        const text = userStopped ? `[Stopped by user]${finalText ? `

${finalText}` : ''}` : finalText;
        if (text) {
          sub.lastResult = text;
          cmd.result = text;
        }
        if (!userStopped) this.failIfDispatchResultMissing(sub, cmd);
      }
      // §5.5 #17-12 ③-6 — `turn.completed` 는 끝 사유를 싣지 않는다. 중지·한도 외에는 평범한 끝이다.
      this.stampTurnStopReason(sub, cmd, { userStopped });
      this.onSubStatusChange?.(sub.parentAgentId);
      this.onComplete?.();
    };

    // §5.25 (F) — 코덱스에는 시스템 프롬프트 플래그가 없다. 클로드 세션이 받는 것(프로젝트 규칙·
    //   카드 지시문·목표·기억)을 **프롬프트 앞에 붙여** 같은 내용을 같은 순서로 싣는다.
    const stableContext = [contextSummary.trim(), opts?.appendSystemPrompt?.trim() ?? '']
      .filter((part) => part.length > 0)
      .join('\n\n');
    const systemPrompt = buildLocalSystemPrompt(stableContext, livePreamble, config.rules);
    const edgeInstructions = opts?.codexEdgeConfig && opts.codexEdgeInstructionsEnabled !== false
      ? codexEdgeInstructions(opts.codexEdgeConfig) : '';
    const prompt = systemPrompt ? `${systemPrompt}${edgeInstructions}

${cmd.text}` : `${edgeInstructions}${cmd.text}`;

    let fileEventSeq = 0;
    // §5.25 (F) "쓴 내용도 남는다" — 지난 턴에 적용되지 못한(거부·실패) 패치 칸이 이번 턴의 같은 파일에 붙지 않게.
    this.codexPatchEdits.clearOwner(sub.id);
    const bashBridge = createCodexBashBridge(`${sub.id}:${cmd.id}`, parentCwd);

    logger.info(`SubAgent ${sub.id} codex turn: model=${provider.modelId} "${cmd.text.slice(0, 50)}..."`);
    runCodexTurn({
      verificationConfig: opts?.verificationConfig,
      contextArgs: opts?.codexContextArgs,
      toolHook: opts?.codexToolHook,
      edgeConfig: opts?.codexEdgeConfig,
      ...(opts?.codexPermissionHook ? { permissionHook: opts.codexPermissionHook } : {}),
      ...(opts?.codexHostedBrowserOff ? { hostedBrowserOff: true } : {}),
      subAgentId: sub.id,
      cwd: parentCwd,
      prompt,
      model: provider.modelId,
      ...(cmd.attachments?.length ? { images: cmd.attachments } : {}),
      env: { ...buildBashTimeoutEnv(config), ...(opts?.extraEnv ?? {}) },
      ...(provider.reasoningEffort ? { reasoningEffort: provider.reasoningEffort } : {}),
      webSearch: provider.webSearch,
      networkAccess: provider.networkAccess,
      executionRequirements: cmd.executionRequirements,
      modelVerbosity: provider.modelVerbosity,
      reasoningSummary: provider.reasoningSummary,
      personality: provider.personality,
      serviceTier: provider.serviceTier,
      autoCompactTokenLimit: provider.autoCompactTokenLimit,
      ...(config.permissionMode ? { permissionMode: config.permissionMode } : {}),
      // 이어가기 — 클로드의 `--resume` 과 같은 자리(`SubAgent.sessionId`)를 쓴다.
      ...(sub.sessionId ? { resumeThreadId: sub.sessionId } : {}),
      // §5.25 (I) — 훅이 켜져 있어도 이 대화가 **버블 하나**로 남게 하는 소유자 태그.
      ownerAgentId: sub.parentAgentId,
      onActivity: (at) => {
        if (closed || !isCurrentTurn()) return;
        // Use the existing live-only status path: no chat line, disk record,
        // or full graph broadcast for stdout fragments and stderr progress.
        this.emitStreamEvent({
          id: makeEventId(), subAgentId: sub.id, parentAgentId: sub.parentAgentId,
          timestamp: at, eventType: 'system', content: '[status]',
        });
      },
      onThread: (threadId) => {
        if (!isCurrentTurn()) return;
        if (sub.sessionId !== threadId) {
          sub.sessionId = threadId;
          logger.info(`SubAgent ${sub.id} codex thread assigned: ${threadId}`);
        }
      },
      onUsage: (usage) => {
        if (!isCurrentTurn()) return;
        // §5.19 (D) 와 같은 방식 — `getAgentConfig` 의 살아 있는 객체에 적어 스냅샷·체크포인트를 탄다.
        //   Cached input and reasoning output are subsets of input/output totals; exec usage is a turn aggregate (current context comes from the rollout).
        provider.tokensIn = (provider.tokensIn ?? 0) + usage.inputTokens;
        provider.tokensOut = (provider.tokensOut ?? 0) + usage.outputTokens;
        cmd.inputTokens = usage.inputTokens;
        cmd.outputTokens = usage.outputTokens;
        this.onSubStatusChange?.(sub.parentAgentId);
      },
      onEvent: (ev) => {
        if (!isCurrentTurn()) return;
        for (const hook of bashBridge(ev)) {
          this.localHookEmitter?.({ agentId: sub.parentAgentId, subAgentId: sub.id }, hook);
        }
        if (ev.eventType === 'tool_use' || ev.eventType === 'tool_result') {
          emitTool(ev.eventType, ev.content, ev.toolName ?? 'Tool', ev.toolUseId ?? makeEventId());
          return;
        }
        emit(ev.eventType, ev.content, ev.imagePath);
      },
      onFileWrites: (paths) => {
        if (!isCurrentTurn()) return;
        // §5.25 (F) — 파일·폴더 버블은 **기존 훅 문**으로 흘린다. 새 그래프 경로를 만들지 않는다
        //   (이 매니저는 그래프를 모른다 — `localHookEmitter` 가 그 주입선이다).
        for (const filePath of paths) {
          fileEventSeq += 1;
          // §5.25 (F) "쓴 내용도 남는다" — `file_change` 는 경로만 싣는다. 무엇을 썼는지는 사전 훅이 적어 둔
          //   패치 칸에 있다. 칸이 없으면(훅이 못 붙은 턴) 지어내지 않고 버블·화살표만 세운다.
          const fileEdit = this.codexPatchEdits.take(sub.id, filePath, parentCwd);
          const event: LocalHookToolEvent = {
            phase: 'post',
            toolName: 'Write',
            toolInput: { path: filePath },
            toolUseId: `codex-file-${sub.id}-${fileEventSeq}`,
            cwd: parentCwd,
            toolResponse: '',
            ...(fileEdit ? { fileEdit } : {}),
          };
          this.localHookEmitter?.({ agentId: sub.parentAgentId, subAgentId: sub.id }, event);
        }
      },
      onIdle: (info) => {
        if (!isCurrentTurn()) return;
        if (!info.stalled) {
          // 1단계 — 알림만. 여기서 걷지 않는다(긴 도구 하나가 조용한 것과 구분되지 않는다).
          logger.warn(`SubAgent ${sub.id} codex turn quiet for ${Math.round(info.idleMs / 1000)}s (cmd=${cmd.id})`);
          return;
        }
        // 2단계 — **2차 마감 입구.** 러너가 트리를 종료하고 마감 경로를 태우지만, 그 경로가
        //   `close` 를 못 받고 묻히는 자리가 실제로 있다(파이프를 물려받은 손자). 그때도 명령이
        //   `executing` 에 굳지 않도록 여기서 먼저 닫는다 — 뒤늦은 `onDone` 은 위 멱등 가드가 막는다.
        finish(`codex turn stalled: no output for ${Math.round(info.idleMs / 1000)}s`, '');
      },
      onDone: (error, finalText) => finish(error, finalText),
    });
  }

  /**
   * §5.19 (D) 로컬 LLM 턴(우리 러너). 중립 `SubAgentStreamEvent` 만 뱉고 끝맺음도 기존 계약이라 화면을 새로 만들지 않는다.
   * 자식이 없어 `runningChildren` 에 안 넣고, 스폰 표식을 바로 걷어 "죽은 active" 대조가 오해하지 않게 한다.
   */
  private executeLocalProvider(
    sub: SubAgent,
    cmd: QueuedCommand,
    config: AgentConfig,
    parentCwd: string,
    contextSummary: string,
    livePreamble?: string,
  ): void {
    const provider = config.provider;
    if (!provider) return;
    this.clearDispatching(sub.id);
    // §5.19 (D) — 이 턴이 도는 동안의 **유일한 생존 근거**. 스폰 표식을 걷는 바로 그 자리에서
    //   세운다(한 순간도 "아무 근거 없는 active" 가 되지 않게 — 그 틈이 5초 생존 대조에 걸려
    //   돌고 있는 세션을 idle 로 강등하고 부모 버블을 거짓 완료로 만들던 자리다).
    this.localInFlightCmd.set(sub.id, cmd);
    const isCurrentTurn = (): boolean => this.index.get(sub.id) === sub && this.localInFlightCmd.get(sub.id) === cmd;

    const emit = (eventType: StreamEventType, content: string): void => {
      if (!isCurrentTurn()) return;
      this.emitStreamEvent({
        id: makeEventId(),
        subAgentId: sub.id,
        parentAgentId: sub.parentAgentId,
        timestamp: Date.now(),
        eventType,
        content,
      });
    };

    /**
     * §5.19 (H) — 도구 카드용. `toolUseId` 를 함께 실어야 화면이 호출과 결과를 **짝으로** 그린다
     * (§5.5 #17-27 ⑪ — 짝이 없으면 FIFO 로 밀려 직전 파일을 따라가는 사고가 난다).
     */
    const emitTool = (
      eventType: 'tool_use' | 'tool_result',
      content: string,
      toolName: string,
      toolUseId: string,
    ): void => {
      if (!isCurrentTurn()) return;
      this.emitStreamEvent({
        id: makeEventId(),
        subAgentId: sub.id,
        parentAgentId: sub.parentAgentId,
        timestamp: Date.now(),
        eventType,
        content,
        toolName,
        toolUseId,
      });
    };

    /** 이 턴을 끝맺는다. 성공·실패·중지가 전부 여기로 모인다. */
    const finish = (error: string | undefined, finalText: string, done?: LocalTurnDoneInfo): void => {
      if (!isCurrentTurn()) return;
      // **맨 먼저** 지운다 — 아래 `recomputeCustomAgentStatus` 가 이 표식을 "도는 중"으로 읽는다(러너의 `isLocalTurnRunning` 은 `finally` 라 늦다).
      if (this.localInFlightCmd.get(sub.id) === cmd) this.localInFlightCmd.delete(sub.id);
      this.cancelDeferredSeal(sub.id);
      if (this.currentTurnId.get(sub.id) === cmd.id) this.currentTurnId.delete(sub.id);
      const userStopped = this.stoppedByUser.delete(sub.id);
      sub.lastActivityAt = Date.now();
      if (error && !userStopped) {
        sub.status = 'error';
        cmd.status = 'error';
        this.failCommand(sub, cmd, { code: 'local', detail: error });
      } else {
        sub.status = 'idle';
        cmd.status = 'completed';
        const text = userStopped ? `[Stopped by user]${finalText ? `\n\n${finalText}` : ''}` : finalText;
        if (text) {
          sub.lastResult = text;
          cmd.result = text;
        }
        if (!userStopped) this.failIfDispatchResultMissing(sub, cmd);
      }
      // §5.5 #17-12 ③-6 — 러너가 넘긴 엔진의 끝 낱말(`stop`·`length`·`content_filter`)과 왕복 상한.
      this.stampTurnStopReason(sub, cmd, {
        userStopped,
        maxTurns: done?.maxRounds === true,
        modelStop: normalizeModelStopReason(done?.finishReason),
      });
      this.onSubStatusChange?.(sub.parentAgentId);
      this.onComplete?.();
    };

    // §5.19 (D) ① — 클로드 세션이 받는 것(규칙·지시문·목표·기억)을 로컬도 받는다. 순서(안정 → 가변)는 프리픽스 캐시 때문에 `buildLocalSystemPrompt` 가 정한다.
    const systemPrompt = buildLocalSystemPrompt(contextSummary, livePreamble, config.rules);

    // 큐 적재 후 제공자를 바꾼 경우도 이미지를 조용히 빼고 실행하지 않는다.
    if (cmd.attachments?.length) {
      finish('local-images-unsupported', '');
      return;
    }

    if (!provider.modelId) {
      // 모델을 아직 안 고른 버블. 조용히 아무 일도 안 일어나는 대신 사유를 남긴다.
      finish('no model selected', '');
      return;
    }

    // §5.19 (D) ④ — 로컬에서 뜻 있는 슬래시 명령은 우리가 처리한다(안 그러면 `/clear` 도 모델에게 간다).
    const slash = parseLocalSlash(cmd.text);
    if (slash) {
      void (async (): Promise<void> => {
        let said: string;
        if (slash.kind === 'clear') said = clearLocalSession(sub.id);
        else if (slash.kind === 'context') said = describeLocalContext(sub.id, systemPrompt, provider.contextSize ?? 0);
        else if (slash.kind === 'compact') {
          said = await compactLocalSession(sub.id, provider.modelId, provider.contextSize ?? 0, slash.arg);
        } else said = unsupportedSlashMessage(slash.name);
        emit('system', said);
        finish(undefined, said);
      })();
      return;
    }

    /**
     * §5.19 (H) — 도구 실행 직전 판정: 모드가 먼저, 사람이 그다음(규칙은 `resolveLocalToolGate`). `ask` 면 기존 권한 브로커를 불러 같은 팝업이 뜬다.
     * 거절 사유는 던지지 않고 모델에게 돌려준다.
     */
    const requestTool = async (
      toolName: string,
      toolInput: Record<string, unknown>,
    ): Promise<LocalToolVerdict> => {
      if (!isCurrentTurn()) return { allowed: false, reason: 'this turn is no longer active' };
      /*
       * §5.3 #12-1-B — 카드에서 누른 "항상"은 **턴 도중에** 저장된다. 목록 두 칸(`disallowedTools` ·
       * `askTools`)은 지금 저장분에서 읽어야 같은 턴의 다음 호출이 그 답을 본다. 모드는 턴 설정 그대로 —
       * 계획 승인(ExitPlanMode)이 이 턴 객체의 모드를 고쳐 편집을 연다.
       */
      const live = this.agentConfigResolver?.(sub.parentAgentId);
      const disallowedTools = live ? live.disallowedTools : config.disallowedTools;
      const askTools = live ? live.askTools : config.askTools;
      // 못 쓰는 목록은 모드 단축보다 먼저 본다 — 훅 경로(`/api/permission-check`)와 같은 순수 함수다.
      if (isToolDisallowed(disallowedTools, toolName)) {
        return { allowed: false, reason: `${toolName} is on this agent's disallowed-tools list, so it was blocked without asking the user` };
      }
      /*
       * §5.3 #12-4 (E) ③ — 검증은 시킬 때만. 훅 경로와 **같은 판정 객체**(이 턴 명령의 범위·기록)를 부른다.
       *   금지 목록 뒤, 자물쇠·모드 판정보다 먼저다. 사람에게 묻지 않고, 거부 사유는 모델에게 그대로 돌려준다.
       */
      const verification = this.verificationChecker?.(cmd, toolName, toolInput, parentCwd);
      if (verification?.verdict === 'deny') {
        return { allowed: false, reason: verification.message ?? 'verification is not allowed in this task' };
      }
      /*
       * §5.3 #12-3 — 자물쇠는 모드 판정보다 먼저다(훅 경로와 같은 순서 · 같은 판정기). 묻지 않는 모드는
       * 거부하고, 그 외는 카드 — 무응답은 언제나 거부, "항상"은 잠금 풀기뿐이다.
       */
      const lockHits = this.pathLockResolver?.(toolName, toolInput, parentCwd) ?? [];
      if (lockHits.length > 0) {
        const lockedTargets = lockHits.map((h) => h.target).join(', ');
        if ((config.permissionMode || 'default') === 'dontAsk') {
          return { allowed: false, reason: `${lockedTargets} is locked by the user in Vibisual and this agent runs in permission mode "dontAsk", so it was blocked without asking. Do not retry it or work around it with another command` };
        }
        const lockProject = this.projectResolver?.(sub.parentAgentId);
        const lockDecision = await permissionBroker.request(
          {
            agentId: sub.parentAgentId,
            subAgentId: sub.id,
            agentLabel: sub.label,
            agentColor: config.color ?? '#6b7280',
            projectName: lockProject?.name ?? '',
            toolName,
            toolInput,
            lockHits: lockHits.slice(0, PATH_LOCK_CARD_HITS_MAX),
            alwaysAllow: 'unlock',
          },
          'deny',
        );
        if (lockDecision.decision === 'allow') return { allowed: true };
        if (lockDecision.cancelled) {
          return { allowed: false, reason: 'the permission request was cancelled before anyone answered (the session was stopped), so the tool was not run' };
        }
        return {
          allowed: false,
          reason: lockDecision.reason === 'timeout'
            ? `${lockedTargets} is locked by the user and no one answered the approval card within 60s, so it was not run. Do not retry it or work around it`
            : (lockDecision.reason || `the user denied access to ${lockedTargets}, which is locked in Vibisual. Do not retry it or work around it`),
        };
      }
      const gate = resolveLocalToolGate(config.permissionMode, toolName);
      /*
       * §5.3 #12-1-A — 설정창에서 지목한 도구는 모드가 통과시켜도 묻는다 — 훅 경로(`/api/permission-check`)와 같은 순수 함수(두 벌이면 판정이 갈린다).
       * `deny` 는 되묻지 않는다(이미 안전한 답) — 되물을 것은 통과시킨 것뿐이다.
       */
      const askedByTool = gate === 'allow' && shouldAskForTool(askTools, toolName);
      if (gate === 'allow' && !askedByTool) return { allowed: true };
      if (gate === 'deny') {
        const mode = config.permissionMode || 'default';
        return { allowed: false, reason: `permission mode "${mode}" does not allow ${toolName}` };
      }
      // §5.3 #12-1-B — 모드가 묻는 호출에서 [이 세션에선 허용]을 눌렀으면 같은 도구는 다시 묻지 않는다.
      //   확인 목록이 붙잡은 호출에는 기억을 읽지 않는다(사용자가 "매번 물어봐"라고 지목한 도구다).
      if (!askedByTool && permissionSessionGrants.has(sub.parentAgentId, sub.id, toolName)) {
        return { allowed: true };
      }
      const project = this.projectResolver?.(sub.parentAgentId);
      const decision = await permissionBroker.request(
        {
          agentId: sub.parentAgentId,
          subAgentId: sub.id,
          agentLabel: sub.label,
          agentColor: config.color ?? '#6b7280',
          projectName: project?.name ?? '',
          toolName,
          toolInput,
          ...(askedByTool ? { askedByTool: true } : {}),
          // "항상"이 적힐 칸은 서버가 정해 카드에 싣는다 — 확인 목록이 붙잡았으면 그 목록, 모드가 물었으면 세션 기억.
          alwaysAllow: askedByTool ? 'ask-tools' : 'session',
          alwaysReject: 'disallowed-tools',
        },
        config.permissionTimeoutPolicy === 'deny' ? 'deny' : 'allow',
      );
      if (decision.decision === 'allow') return { allowed: true };
      if (decision.cancelled) {
        return { allowed: false, reason: 'the permission request was cancelled before anyone answered (the session was stopped), so the tool was not run' };
      }
      return { allowed: false, reason: decision.reason || 'the user denied this tool call' };
    };

    let finalText = '';
    const args: LocalTurnArgs = {
      subAgentId: sub.id,
      prompt: cmd.text,
      modelId: provider.modelId,
      projectRoot: parentCwd,
      onToolRequest: requestTool,
      onToolEvent: emitTool,
      onToolSupport: (support) => {
        if (!isCurrentTurn()) return;
        // 판정을 설정에 남긴다 — `getAgentConfig` 가 돌려주는 것이 **살아 있는 객체**라
        //   여기 쓰면 스냅샷·체크포인트를 그대로 탄다(새 영속 필드 발명 ❌). 스냅샷 캐시가
        //   한 박자 늦을 수 있으나 바로 아래 상태 통지가 방송을 끌어온다.
        if (provider.toolSupport !== support) provider.toolSupport = support;
        this.onSubStatusChange?.(sub.parentAgentId);
      },
      onUsage: (promptTokens, completionTokens, contextLimit) => {
        if (!isCurrentTurn()) return;
        // §5.19 (D) — 창이 얼마나 찼는지. 도구 판정과 **같은 자리·같은 방식**이다
        //   (`getAgentConfig` 가 돌려주는 살아 있는 객체에 적으면 스냅샷·체크포인트를 그대로 탄다).
        //   턴마다 값이 바뀌므로 방송은 아래 상태 통지에 얹어 보낸다 — 새 WS 메시지 ❌.
        provider.contextUsed = promptTokens;
        provider.contextLimit = contextLimit;
        // 누적은 **왕복마다** 더한다 — 한 턴에 도구를 세 번 돌면 그 세 번이 다 들어가야 사실이다.
        provider.tokensIn = (provider.tokensIn ?? 0) + promptTokens;
        provider.tokensOut = (provider.tokensOut ?? 0) + completionTokens;
        this.onSubStatusChange?.(sub.parentAgentId);
      },
      onEvent: (eventType, content) => {
        if (eventType === 'result') finalText = content;
        // 최종 본문은 화면에 **다시** 그리지 않는다 — 같은 답이 이미 `text` 델타로 흘렀다.
        //   판정은 `isRenderableLocalEvent` 한 곳에 두고, 걸린 이벤트도 위에서 본문은 챙긴다.
        if (!isRenderableLocalEvent(eventType)) return;
        emit(eventType, content);
      },
      onDone: (error, done) => finish(error, finalText, done),
    };
    if (provider.toolSupport) args.toolSupport = provider.toolSupport;
    if (systemPrompt) args.systemPrompt = systemPrompt;
    // §5.19 (H) — 목표창·질문 카드·계획 종료는 러너가 아니라 여기서 넘어간 처리기가 맡는다.
    args.onHookEvent = (event) => {
      if (!isCurrentTurn()) return;
      this.localHookEmitter?.({ agentId: sub.parentAgentId, subAgentId: sub.id }, event);
    };
    args.onHostTool = async (toolName, input) => {
      if (!isCurrentTurn()) return 'this turn is no longer active';
      const handler = this.localHostToolHandler;
      if (!handler) return `${toolName} is not available in this session`;
      try {
        return await handler(
          { agentId: sub.parentAgentId, subAgentId: sub.id, agentLabel: sub.label, config },
          toolName,
          input,
        );
      } catch (err) {
        // 호스트 쪽 사고로 턴을 죽이지 않는다 — 모델에게 말로 돌려주면 다른 수를 고른다.
        return `${toolName} failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    };
    if (provider.contextSize && provider.contextSize > 0) args.contextSize = provider.contextSize;
    if (typeof provider.temperature === 'number') args.temperature = provider.temperature;

    logger.info(`SubAgent ${sub.id} local turn: model=${provider.modelId} "${cmd.text.slice(0, 50)}..."`);
    runLocalTurn(args);
  }

  /**
   * §5.19 (D) — 로컬 세션의 [중지]. 자식을 죽이는 대신 생성을 끊는다(모델은 다음 턴에 다시 쓴다).
   * 로컬 세션이 아니면 false — 호출자가 기존 중지 경로로 넘어간다.
   */
  stopLocalSession(subAgentId: string): boolean {
    // §5.25 (F) — 프로바이더 세션 둘을 한 창구로 받는다(호출자는 어느 엔진인지 몰라도 된다).
    return stopLocalTurn(subAgentId) || stopCodexTurn(subAgentId);
  }

  /**
   * §5.5 #17-12 ③-4 — 이 턴의 답(마감하는 모든 경로가 거친다).
   * ① 답 없는 턴(`/compact`·`/clear`)은 결과가 없다 — 폴백을 타면 앞 턴 답을 저장한다(실측 `/compact` 27건 전부 직전 답과 동일).
   * ② 트랜스크립트 폴백은 턴 시작 뒤에 쓰인 글만 받는다(시각 없는 옛 줄 `ts` 0 은 받는다).
   */
  private turnResultText(
    cmd: QueuedCommand,
    parentCwd: string,
    sessionId: string | undefined,
    reported: string | undefined,
  ): string | undefined {
    let recovered: LastAssistantEntry | null = null;
    // 답 없는 턴은 어차피 결과가 없다 — 트랜스크립트를 읽을 이유도 없다.
    if (!reported && sessionId && !isAnswerlessTurnText(cmd.text)) {
      try { recovered = readLastAssistantEntry(parentCwd, sessionId); } catch { /* 트랜스크립트가 없으면 신고분만 */ }
    }
    return resolveTurnResult(cmd.text, reported, recovered, cmd.startedAt ?? cmd.timestamp);
  }

  /**
   * 턴 끝 마무리 + 콜백. legacy·persistent 가 함께 쓰고 `deleteRunningChild` 로 가른다.
   * @param stdout legacy 는 누적 stdout(재파싱), persistent 는 빈 문자열 + resultText.
   * @param initialCliError §5.5 #17-12 ③ — result 의 `is_error` 본문. persistent 만 넘긴다(legacy 는 stdout 에서 줍는다).
   */
  private _finalizeLegacyCommand(
    sub: SubAgent,
    cmd: QueuedCommand,
    parentCwd: string,
    initialResultText: string | undefined,
    turnCount: number,
    killed: boolean,
    maxTurns: number,
    code: number | null,
    stdout: string,
    deleteRunningChild: boolean,
    initialCliError?: string,
    opts?: {
      /**
       * §5.5 #17-18 ⑩-5 — 넘겨받은 결과 본문의 **주인이 확인되지 않았다.** 그러면 싣지 않는다 —
       * 비워 두면 아래 `turnResultText` 가 JSONL 에서 이 명령의 진짜 답을 되찾는다.
       */
      unownedResult?: boolean;
    },
  ): void {
    // 붙들어 둔 잠정 봉인이 있으면 여기서 버린다 — 자식 종료·크래시·사용자 중지가 먼저 도착한 경우다.
    //   (잠정 타이머가 스스로 이 함수를 부른 경우엔 이미 지워져 있어 무해하다.)
    this.cancelDeferredSeal(sub.id);
    // 어떤 경로로 왔든 이 명령은 여기서 끝난다 — 스폰 진행 표식이 남아 있으면 걷는다.
    this.clearDispatching(sub.id);
    // 이 턴의 도장을 내린다. 뒤늦게 흘러드는 백단 여운은 도장 없이 오고, 그중 끝 통지는
    //   `stampTurnId` 가 **시작한 턴**을 되찾아 찍으므로 제 블록으로 돌아간다.
    if (this.currentTurnId.get(sub.id) === cmd.id) this.currentTurnId.delete(sub.id);
    // §5.5 #17-18 ⑩-5 — 주인이 확인되지 않은 본문은 여기서 버린다. 남의 턴이 낸 글을 이 명령의
    //   답으로 얼리면 사용자는 자기 질문 아래에서 묻지도 않은 것에 대한 답을 본다.
    let resultText = opts?.unownedResult ? undefined : initialResultText;
    let cliError = initialCliError;

    // Legacy close 경로: stdout 누적분에서 session_id + result + tokens 재파싱.
    if (stdout) {
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          const lineSessionId = obj['type'] === 'system' ? obj['session_id'] : undefined;
          if (typeof lineSessionId === 'string' && lineSessionId.length > 0) {
            if (!sub.sessionId) {
              sub.sessionId = lineSessionId;
              logger.info(`SubAgent ${sub.id} session assigned: ${sub.sessionId}`);
            } else if (lineSessionId !== sub.sessionId && isSlashCommandText(cmd.text)) {
              // §5.5 #17-2 — 스트림 핸들러가 놓쳤을 때의 안전망도 같은 규약으로(`/clear` 세션 회전 추종).
              logger.info(`SubAgent ${sub.id} session rotated by slash command: ${sub.sessionId} → ${lineSessionId}`);
              sub.sessionId = lineSessionId;
            }
          }
          // §5.5 #17-12 ③ — CLI 가 스스로 신고한 실패(사용량 한도·인증 실패 등)는 종료 코드보다 훨씬
          //   구체적이라 사유 1순위다. 본문이 없으면 subtype(`error_during_execution` 등)이라도 남긴다.
          if (obj['type'] === 'result' && obj['is_error'] === true && !cliError) {
            const body = typeof obj['result'] === 'string' ? obj['result'] : '';
            const subtype = typeof obj['subtype'] === 'string' ? obj['subtype'] : '';
            cliError = body || subtype || undefined;
          }
          if (obj['type'] === 'result' && typeof obj['result'] === 'string' && !resultText) {
            resultText = obj['result'];
            if (typeof obj['total_input_tokens'] === 'number') sub.totalInputTokens = obj['total_input_tokens'] as number;
            if (typeof obj['total_output_tokens'] === 'number') sub.totalOutputTokens = obj['total_output_tokens'] as number;
          }
        } catch { /* skip non-json */ }
      }
    }

    // 이 턴의 답은 무엇인가 — CLI 가 신고한 결과 우선, 없으면 JSONL 폴백(③-4 의 두 규칙을 거친다).
    resultText = this.turnResultText(cmd, parentCwd, sub.sessionId, resultText);

    if (resultText) {
      sub.lastResult = resultText;
      cmd.result = resultText;
    }
    // §2.4 (한도 정지) — 스트림을 놓쳤을 때의 마지막 그물(legacy `--print` 는 완성 블록을 억제한다).
    this.noteUsageLimitText(sub, resultText);

    // 토큰 사용량 — JSONL 누적 read (persistent 경로도 매 턴 누적 갱신 필요).
    if (sub.sessionId) {
      try {
        const tokenData = readSessionTokenData(parentCwd, sub.sessionId);
        if (tokenData && tokenData.turns.length > 0) {
          const prevInput = sub.totalInputTokens ?? 0;
          const prevOutput = sub.totalOutputTokens ?? 0;
          let totalIn = 0;
          let totalOut = 0;
          for (const t of tokenData.turns) {
            totalIn += t.inputTokens + t.cacheReadTokens + t.cacheCreateTokens;
            totalOut += t.outputTokens;
          }
          sub.totalInputTokens = totalIn;
          sub.totalOutputTokens = totalOut;
          cmd.inputTokens = Math.max(0, totalIn - prevInput);
          cmd.outputTokens = Math.max(0, totalOut - prevOutput);
          const lastTurn = tokenData.turns[tokenData.turns.length - 1];
          if (lastTurn?.model) sub.modelName = lastTurn.model;
          logger.info(`SubAgent ${sub.id} tokens: in=${totalIn}, out=${totalOut}, delta_in=${cmd.inputTokens}, delta_out=${cmd.outputTokens}`);
        }
      } catch (err) {
        logger.debug(`SubAgent ${sub.id} token read failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const userStopped = this.stoppedByUser.delete(sub.id);
    // §4 API 크레딧 — 크레딧 실행이었으면 여기서 닫는다(정상·실패·중지 무엇이든 한 번). Anthropic 이 그 실행을
    //   거절했으면(Console 의 크레딧 잔액 부족·월 지출 한도) 그것은 알 수 없는 실패가 아니라 **Console 의 한도**다 —
    //   아래에서 `creditCap` 으로 적는다. 키 거부는 종전대로 CLI 실패다(Console 의 금액 한도가 아니다).
    const credit = this.settleCreditRun(sub);
    const refusal = credit?.refusal && credit.refusal.reason !== 'key-invalid' ? credit.refusal : undefined;
    const creditCap = !!refusal && !userStopped && !killed;
    const isErr = killed || creditCap || (code !== null && code !== 0);
    sub.status = userStopped ? 'idle' : (isErr ? 'error' : 'idle');
    sub.lastActivityAt = Date.now();
    cmd.status = userStopped ? 'completed' : ((killed || creditCap) ? 'error' : ((code === null || code === 0) ? 'completed' : 'error'));
    if (userStopped) cmd.result = `[Stopped by user]${resultText ? `\n\n${resultText}` : ''}`;
    else if (killed) cmd.result = `[Stopped: max turns reached (${turnCount}/${maxTurns})]${resultText ? `\n\n${resultText}` : ''}`;
    else if (creditCap) cmd.result = `[Stopped: API credits refused by Anthropic]${resultText ? `\n\n${resultText}` : ''}`;

    // §5.5 #17-12 ③ — 오류로 끝났으면 **왜** 인지를 명령에 남긴다. 종전엔 상태만 error 로 바꾸고
    //   종료 코드·stderr 를 통째로 버려서, 화면에는 "오류" 한 단어만 남고 사용자가 원인을 알 길이 없었다.
    if (cmd.status === 'error') {
      const stderrTail = this.childStderrTails.get(sub.id)?.trim();
      if (killed) {
        this.failCommand(sub, cmd, { code: 'maxTurns', detail: `${turnCount}/${maxTurns}` });
      } else if (creditCap && refusal) {
        // 사유 문장은 Anthropic 원문 그대로 — 무엇이 막았는지(잔액·한도)와 언제 다시 열리는지가 거기 있다.
        this.failCommand(sub, cmd, { code: 'creditCap', detail: refusal.detail ?? refusal.reason });
      } else if (cliError) {
        this.failCommand(sub, cmd, {
          code: 'cli',
          ...(code !== null && code !== 0 ? { exitCode: code } : {}),
          detail: cliError,
        });
      } else {
        this.failCommand(sub, cmd, {
          code: 'exit',
          ...(code !== null ? { exitCode: code } : {}),
          ...(stderrTail ? { detail: stderrTail } : {}),
        });
      }
    }
    if (!userStopped) this.failIfDispatchResultMissing(sub, cmd);
    this.stampTurnStopReason(sub, cmd, { userStopped, maxTurns: killed });

    logger.info(`SubAgent ${sub.id} finished (code=${code === null ? 'persistent' : code}, killed=${killed}, userStopped=${userStopped}, turns=${turnCount}, result=${resultText ? 'yes' : 'no'})`);
    if (deleteRunningChild) this.runningChildren.delete(sub.id);
    // §5.3 #12-1 — 자기 턴은 끝났지만 이 탭이 띄운 백그라운드 서브에이전트가 아직 돌면 도트를 다시
    //   active 로 올린다(부모 버블의 대차대조와 탭 도트가 어긋나 "버블은 동작, 점은 녹색"이던 버그).
    this.syncBgSubStatus(sub.parentAgentId);
    this.onSubStatusChange?.(sub.parentAgentId);
    this.onComplete?.();
  }

  /**
   * 앱 종료 시(Electron before-quit) 모든 persistent child 를 깨끗이 종료.
   * intentionalKill 마킹 → stdin.end → SIGTERM → 2초 후 SIGKILL fallback.
   */
  async shutdownAllPersistentChildren(): Promise<void> {
    if (this.runningChildren.size === 0) return;
    const ids = [...this.runningChildren.keys()];
    logger.info(`shutdownAllPersistentChildren: terminating ${ids.length} child(ren) [${ids.join(', ')}]`);
    const promises: Promise<void>[] = [];
    for (const [subId, child] of this.runningChildren) {
      this.intentionalKill.add(subId);
      const pid = child.pid;
      try { child.stdin?.end(); } catch { /* ignore */ }
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      promises.push(new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          // SIGKILL 은 직접 자식만 죽여 손자 트리가 고아로 남는다 → 트리째 강제 종료.
          killTree(pid);
          unregisterSpawnedPid(pid);
          resolve();
        }, 2000);
        child.once('exit', () => { clearTimeout(timer); unregisterSpawnedPid(pid); resolve(); });
      }));
    }
    await Promise.all(promises);
    logger.info('shutdownAllPersistentChildren: done');
  }

}

export const subAgentManager = new SubAgentManager();
