import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ProjectInfo, SubAgent, SubAgentStatus, QueuedCommand, CommandError, AgentConfig, SubAgentStreamEvent, StreamEventType, AgentViewJobState, RunningSubagentTask, FinishedSubagentTask, StreamTaskInfo, StreamTaskStatus, CmdTerminalSignal, CmdTerminalState, CmdPaneNode, CmdCliKind } from '@vibisual/shared';
import { CMD_PANE_SEPARATOR, CMD_BLOCK_REASON_MAX, collectCmdPaneIds, resolveCmdCliKind, DEFAULT_AGENT_CONFIG, isOpusModel, supportsFastMode, isForwardSubagentTextEnabled, resolveAliasToLatest, buildCmdCardProtocolRules, isNeverRenderedStreamEvent, formatSystemChip, normalizeBashTimeoutMs, TASK_CHIP_START_SUBTYPE, TASK_CHIP_END_SUBTYPE, parseSystemSubtype, parseSystemTaskInfo, capMapSize, SESSION_KEYED_MAP_MAX, resolveLocalToolGate } from '@vibisual/shared';
import {
  createTurnSealState, noteTaskChip, mayTurnResume, noteTurnResumed, noteTurnSealed,
  listDisplayableLiveTasks, turnIdOfLiveTask, takeOrphanLiveTasks, LIVE_TASK_ORPHAN_GRACE_MS,
  isTurnResumeSignal, TURN_RESUME_GRACE_MS, shouldSleepResumedTurn,
  type TurnSealState, type LiveTaskInfo,
} from './turnSeal.js';
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
} from './localRunner.js';
import { permissionBroker } from './permissionBroker.js';
import { rescueSubagentResult } from './subagentResultRescue.js';
import { modelRegistryService } from './modelRegistryService.js';
import { readLastAssistantMessage, readSessionTokenData, getSessionJsonlPath } from './sessionDiscovery.js';
import * as streamBufferStore from './streamBufferStore.js';
import { getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';
// §5.5 #17-2 — 턴 프롬프트 조립(슬래시 명령은 앞말 없이 원문 그대로). 순수 모듈 + 단위 테스트.
import { composeTurnPrompt, isSlashCommandText } from './turnPrompt.js';
import { isAgentViewEnabled, spawnBackground, stopSession, rmSession } from './claudeAgentViewService.js';
import { attach as attachWatcher, detach as detachWatcher, resumeWatch as resumeAgentViewWatch } from './claudeAgentViewWatcher.js';
import { killTree, terminateChildTree, registerSpawnedPid, unregisterSpawnedPid, processGroupSpawnOptions } from './processTree.js';
import { prepareMcpConfig } from './mcpConfigService.js';
import { prepareAgentSettings } from './agentMemoryService.js';

/** parentAgentId → 소속 ProjectInfo 해석. index.ts에서 graphManager 기반으로 주입. */
export type AgentProjectResolver = (parentAgentId: string) => ProjectInfo | null;

/**
 * §5.19 (H) — 로컬 세션의 **호스트 도구** 한 건. 파일이 아니라 우리 화면·설정을 움직인다
 * (`TodoWrite` → 목표창 · `AskUserQuestion` → 질문 카드 · `ExitPlanMode` → 권한 모드).
 *
 * 돌려주는 문자열이 그대로 도구 결과가 되어 모델에게 간다 — 실패도 던지지 말고 **말로** 돌려라
 * (모델이 다른 수를 고를 수 있어야 한다).
 */
/**
 * §5.19 (H) — 로컬 세션의 도구 호출 한 건을 **훅 이벤트로** 흘리는 자리. `index.ts` 가 그래프에
 * 이어 준다(이 매니저는 그래프를 모른다 — `setProjectResolver` 와 같은 주입선).
 *
 * 도구 이벤트만이다. 생명주기는 로컬 턴이 이미 자기가 관리하므로 여기로 보내지 않는다.
 */
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

/**
 * §5.5 #17-5 v2.68 — 첫 사용자 프롬프트에서 서브에이전트 탭 제목을 추론.
 * VS Code 가 Claude Code 세션 이름을 주제로 정하는 동작을 무과금(요약 LLM 호출 ❌)으로 모사한다.
 * 첫 비어있지 않은 줄을 취해 마크다운 장식·감싼 따옴표를 벗기고 ~60자로 컷.
 * 추출 실패(빈 결과) 시 빈 문자열 반환 → 호출부가 기본 라벨(Sub #N)을 유지한다.
 */
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

/**
 * §4 — CLI `--model` 이 **bare alias 로** 인식·해소하는 패밀리.
 * 이 셋은 `--model opus` 처럼 짧은 이름만 줘도 CLI 가 현재 latest 로 알아서 해소한다.
 * 이 목록 밖의 패밀리(fable/mythos 등)는 CLI 가 bare alias 를 모르므로 그대로 넘기면
 * 기본 모델(opus)로 조용히 폴백된다 → 반드시 레지스트리 latest 풀ID 로 치환해서 넘겨야 한다.
 */
const CLI_NATIVE_ALIASES = new Set<string>(['opus', 'sonnet', 'haiku']);

/**
 * AgentConfig → claude CLI 인자 배열 변환.
 * 기본값과 같은 항목은 CLI 인자로 넘기지 않음 (불필요한 제한 방지).
 */
/** 스폰 맥락 — 기억 폴더를 프로젝트 아래에 잡으려면 이름과 루트가 필요하다(§5.3 v4.89). */
interface ConfigArgsContext {
  /** 기억 폴더 이름이 될 에이전트 식별자. */
  agentName?: string;
  /** 프로젝트 루트(= 스폰 cwd). 'project'/'local' 범위에서만 쓰인다. */
  projectRoot?: string;
}

/**
 * §4 (Fast 모드) — 이 설정이 실제로 Fast 를 요청하는가.
 *
 * 사용자가 켜 뒀더라도 **Opus 계열이 아니면 CLI 가 사유도 없이 조용히 무시**하므로, 그런 조합에서는
 * 애초에 키를 만들지 않는다 — 안 그러면 sonnet 에이전트가 아무 효과도 없는 `--settings` 를 달고 뜬다.
 * 판정 대상은 `--model` 로 나가는 값과 같아야 하니 풀ID 핀(`modelVersion`)을 alias 보다 먼저 본다.
 */
function wantsFastMode(config: AgentConfig): boolean {
  if (!config.fastMode) return false;
  return supportsFastMode(config.modelVersion?.trim() || config.model);
}

function buildConfigArgs(config: AgentConfig, ctx?: ConfigArgsContext): string[] {
  const args: string[] = [];

  // 모델 — §4 v2.40: alias 해소를 CLI 에 위임. Vibisual 측 변환 ❌.
  //   - `--model opus` → CLI 가 자체적으로 현재 latest Opus(=4.8) 로 해소
  //   - `--model opus[1m]` → alias + 1M 도 그대로 작동 (CLI 2.1.154 확인됨)
  //   - 사용자가 `modelVersion` 으로 풀ID 핀했으면 그것 우선
  //   - 정적 가드(`AVAILABLE_AGENT_MODEL_IDS.includes(...)`) 제거 — 신규 모델 출시 시 코드 수정 불필요.
  //     CLI 가 모델명 검증 담당. 잘못된 값이면 spawn 시점에 에러.
  if (config.model) {
    const pinned = config.modelVersion?.trim();
    let base = pinned || config.model;
    // §4 — 신규 패밀리(fable/mythos 등) bare alias 는 CLI 가 못 알아들어 기본 모델(opus)로 폴백된다.
    //   modelVersion 풀ID 핀이 없고 CLI-native alias(opus/sonnet/haiku)도 아니면, 레지스트리에서
    //   그 패밀리 latest 풀ID(예: fable → claude-fable-5)로 치환해 실제로 그 모델이 뜨게 한다.
    //   레지스트리에 해당 패밀리가 없으면 bare 그대로 둔다(CLI 가 검증·에러 노출).
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

  // 퍼미션 모드 — CLI 내부 enum 6종(`default`=표시명 Manual / acceptEdits / auto / dontAsk / plan /
  //   bypassPermissions). `'default'` 는 CLI 기본값이라 플래그를 붙이지 않는다(종전 동작 유지).
  //   `auto`·`dontAsk` 는 그대로 통과 — 판정 의미는 CLI 가 갖고, 우리 승인 게이트의 대응 매핑은
  //   §5.3 #12-1(`/api/permission-check`)에 있다.
  if (config.permissionMode && config.permissionMode !== 'default') {
    if (config.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', config.permissionMode);
    }
  }

  // 사고 깊이 (effort)
  if (config.effort && config.effort !== 'default') {
    args.push('--effort', config.effort);
  }

  // 허용 도구 — CLI `--tools` 플래그로 에이전트 가시 툴 제한.
  // UI 에 노출된 AVAILABLE_AGENT_TOOLS 는 CLI 전체 툴셋의 부분집합일 수 있으므로
  // "전체 매칭 시 플래그 생략" 최적화는 사용 안 함 — 항상 명시해 UI 와 런타임 일치 보장.
  // 빈 배열은 `--tools ""` 로 전부 disable.
  if (config.tools) {
    args.push('--tools', config.tools.join(','));
  }

  // 차단 도구
  if (config.disallowedTools && config.disallowedTools.length > 0) {
    args.push('--disallowedTools', config.disallowedTools.join(','));
  }

  // §5.5 #17-20 ⑥ v4.74 — MCP 디버그 도구 연결.
  //   이 함수는 **헤드리스 경로와 CMD 인터랙티브 경로가 공유하는 단 하나의 조립 지점**이라
  //   여기 한 번 꽂으면 두 경로가 동시에 도구를 갖는다(§5.11 v4.65 가 "한 곳만 배선하면 첫 턴
  //   1회로 끝난다"고 배운 함정의 반대편 — 여기는 진짜로 한 곳이다).
  //   `--tools` 는 **내장 도구 전용**이라 MCP 도구를 막지 않는다. 대신 승인 팝업이 매 호출마다
  //   뜨지 않도록 `--allowedTools mcp__<서버>` 로 그 서버의 도구를 통째로 열어 준다.
  const mcp = prepareMcpConfig(config.mcpServers);
  if (mcp) {
    args.push('--mcp-config', mcp.configPath);
    args.push('--allowedTools', mcp.allowedTools.join(','));
  }

  // 격리 모드 — worktree 면 별도 git worktree 에서 실행.
  //   ⚠ 옛 `--isolation <값>` 은 현 CLI 에 **없는 플래그**다. 붙이면 파싱 단계에서
  //   `error: unknown option '--isolation'` 로 스폰이 즉시 죽는다(실측 2.1.223) — 그동안
  //   Isolation=worktree 로 설정한 커스텀 에이전트가 뜨지 못한 원인. 현행 표현은 `-w, --worktree [name]`
  //   이며 이름은 CLI 가 붙인다. `'none'` 은 플래그 없음 = 부모 cwd 실행.
  //   우리 축(`AgentConfig.isolation`)의 값 이름은 사용자 의미라 그대로 두고 CLI 표현만 옮긴다.
  if (config.isolation === 'worktree') {
    args.push('--worktree');
  }

  // §4 (CLI 사양 추종) — 아래 넷은 인터랙티브·헤드리스 양쪽에서 유효한 일반 플래그라 여기서 붙인다.
  //   (`--fallback-model` 은 `--print` 전용이라 여기가 아니라 스폰부 printFlags 에 있다.)
  const autoCompact = config.autoCompact?.trim();
  if (autoCompact) {
    args.push('--autocompact', autoCompact);
  }
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

  // §5.3 v4.89 자기 기억 + §4 Fast 모드 — **설정 파일 한 장**으로 나간다.
  //   `--settings` 로 들어간 값은 사용자 설정 계층과 병합되므로 사용자 설정을 지우지 않고
  //   필요한 키만 바꿔 끼운다. 기억 `'off'` 는 파일이 아니라 환경변수 쪽이라 여기서는 인자가
  //   늘지 않는다(스폰부가 처리).
  //   ⚠ `--settings` 를 **두 번 붙이면 병합이 아니라 뒤엣것이 앞엣것을 통째로 덮는다**(실측).
  //   그래서 기억용·Fast 용을 따로 붙일 수 없고 `prepareAgentSettings` 가 한 장으로 조립한다.
  const settingsPlan = prepareAgentSettings({
    memory: config.memory,
    fastMode: wantsFastMode(config),
    agentName: ctx?.agentName ?? 'agent',
    projectRoot: ctx?.projectRoot,
  });
  if (settingsPlan?.settingsPath) {
    args.push('--settings', settingsPlan.settingsPath);
  }

  return args;
}

/**
 * §4 (CLI 사양 추종) — Bash 도구 타임아웃 env.
 *
 * CLI 는 `timeout` 미지정 명령에 2분, 지정하더라도 **10분(600,000ms)을 상한**으로 자른다.
 * 그 둘을 각각 `BASH_DEFAULT_TIMEOUT_MS` / `BASH_MAX_TIMEOUT_MS` 로 푼다 — 플래그가 아니라
 * 환경변수라 헤드리스(`claude -p`) 와 인터랙티브 PTY 두 스폰 경로가 같은 함수를 공유한다.
 * 미설정(undefined) 이면 키 자체를 넣지 않아 종전과 바이트 단위로 같은 env 로 뜬다.
 */
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
 * §5.3 v4.89 — 스폰 env 에 얹을 항목(중첩 깊이 · 자동 기억 끄기).
 * 인자가 아니라 환경변수로 가는 축이라 `buildConfigArgs` 와 분리한다.
 */
function buildConfigEnv(config: AgentConfig | undefined, ctx?: ConfigArgsContext): Record<string, string> {
  if (!config) return {};
  const env: Record<string, string> = {};

  if (typeof config.subagentDepth === 'number') {
    env['CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH'] = String(config.subagentDepth);
  }

  Object.assign(env, buildBashTimeoutEnv(config));

  const plan = prepareAgentSettings({
    memory: config.memory,
    fastMode: wantsFastMode(config),
    agentName: ctx?.agentName ?? 'agent',
    projectRoot: ctx?.projectRoot,
  });
  if (plan?.env) Object.assign(env, plan.env);

  return env;
}

/**
 * §4 v2.63 — 인터랙티브(임베디드 PTY) 스폰용 claude CLI 인자.
 *
 * 헤드리스 경로(`buildConfigArgs` + `-p --print --input-format … --output-format …`)와 달리
 * **`-p`/stream 플래그를 붙이지 않는다** — 진짜 인터랙티브 REPL 로 띄워 사용자가 직접 몰게 한다
 * (구독 과금 + Anthropic ToS 합법선, §4 v2.63). `buildConfigArgs` 가 만드는 설정 인자
 * (model/permission/effort/tools/disallowedTools/isolation)는 그대로 공유 — "내가 설정한 세팅 그대로".
 * 헤드리스 경로는 rules 를 매 턴 프롬프트(contextSummary)에 주입하지만 인터랙티브는 그 경로가 없으므로
 * rules 를 `--append-system-prompt` 로 1회 주입한다.
 */
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
 * §4 (CMD 터미널 업그레이드 ⑧) — CMD 터미널 셸에 **prefill 할 한 줄**을 조립한다.
 *
 * 종전에는 `claude` 가 코드에 박혀 있어 CMD 버블이 다른 에이전트 CLI 를 못 띄웠다. 이제
 * `AgentConfig.cliKind` 가 `CMD_CLI_KINDS` 표의 어느 줄인지만 고르고, 실행 파일·훅 귀속 여부는
 * 그 표가 정한다(§3.3 하드코딩 금지 — 새 CLI 는 표에 한 줄 추가로 끝난다).
 *
 * `managed === false`(claude 가 아닌 CLI)면 **우리 훅의 자식이 아니다** — `--resume`·rules
 * `--add-dir`·우리가 조립한 claude 인자를 일절 붙이지 않는다(§5.5 #17-20 ④ v4.74 실행 런처와
 * 같은 규율). `'shell'` 은 아무것도 넣지 않아 순수 셸이 된다.
 *
 * 개행은 **절대 붙이지 않는다** — 사람이 Enter 를 치는 것이 §4 v2.63 이 세운 ToS 합법선이다.
 */
export function buildInteractiveCliPrefill(opts: {
  config: AgentConfig;
  /** claude 실행본 절대경로(`getClaudeBin().binPath`). claude 갈래에서만 쓰인다. */
  claudeBinPath: string;
  /** rules 폴더(있으면 `--add-dir`). claude 갈래 전용. */
  rulesDir?: string | null;
  /** 직전 대화 sessionId(있으면 `--resume`). claude 갈래 전용. */
  resumeId?: string | null;
}): { prefill: string; managed: boolean; kind: CmdCliKind } {
  const row = resolveCmdCliKind(opts.config.cliKind);
  const kind = row.value as CmdCliKind;

  if (!row.managed) {
    // 순수 셸(`bin === ''`)이면 빈 prefill — 사용자가 직접 친다.
    return { prefill: row.bin, managed: false, kind };
  }

  const args = buildInteractiveClaudeArgs(opts.config, { includeRules: false });
  if (opts.rulesDir) args.push('--add-dir', opts.rulesDir);
  const fullArgs = opts.resumeId ? ['--resume', opts.resumeId, ...args] : args;
  return {
    prefill: [opts.claudeBinPath, ...fullArgs].map(quoteInteractiveArg).join(' '),
    managed: true,
    kind,
  };
}

/** 공백 포함 인자만 따옴표 — 셸 prefill 한 줄 구성용. */
function quoteInteractiveArg(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

/** §4 v2.64 — CMD 에이전트 로컬 스토어 폴더(`~/.vibisual/cmd-agents/<agentId>/`). rules·세션맵 공용. */
function cmdAgentDir(agentId: string): string {
  // agentId 는 `agent-<hash>`(콜론/슬래시 없음)지만 방어적으로 안전한 문자만 남긴다.
  const safeId = agentId.replace(/[^\w.-]/g, '_');
  return path.join(os.homedir(), '.vibisual', 'cmd-agents', safeId);
}

/**
 * termId → { agentId, sessionToken, paneId, resumeKey }. 형식이 어긋나면 null.
 *
 * §4 (CMD 터미널 업그레이드 ⑤) — pane 분할 termId 는 `term:<agentId>:<session>#<paneId>` 다.
 * pane 토큰은 **세션 소유 해석과 무관**하므로 여기서 먼저 떼어 낸다 — 떼지 않으면
 * `slice(2).join(':')` 이 sessionToken 에 pane 을 먹어 `index.get(sessionToken)`(소유 탭 해석)이
 * 영영 빗나간다. 반대로 `--resume` 세션맵은 pane 마다 **다른 claude 대화**를 물므로 pane 을
 * 포함한 `resumeKey` 로 키를 잡는다(pane `'0'` = 종전 키 그대로라 기존 sessions.json 과 호환).
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
 * §4 v2.63 — CMD(인터랙티브 터미널) 에이전트의 Agent Rules 를 **파일 기반**으로 claude 에 전달.
 *
 * 인터랙티브 prefill 은 셸 한 줄이라 멀티라인 rules 를 `--append-system-prompt` 인자로 못 넣는다
 * (개행이 셸 명령을 조기 제출시킴). 대신 Vibisual 관리 폴더(`~/.vibisual/cmd-agents/<agentId>/CLAUDE.md`)에
 * rules 를 써 두고, 터미널 매니저가 `--add-dir <dir>` 로 그 폴더를 물려준다. claude 는 add-dir 된 폴더의
 * CLAUDE.md 를 자동 참조(메모리/지시)하므로 멀티라인·따옴표·레포 오염 문제 없이 rules 가 적용된다.
 *   - 사용자 레포가 아니라 `~/.vibisual` 아래라 공개/커밋 위험 없음.
 *   - 에이전트 단위 폴더라 그 에이전트의 모든 CMD 세션이 같은 rules 공유. 새 세션 스폰 때마다 최신 rules 로 재기록
 *     → AgentSettings 에서 rules 수정 후 "+" 새 세션을 열면 반영(이미 떠 있는 세션엔 소급 X).
 *
 * §4 v2.83 — 사용자 rules 유무와 무관하게 **카드 신고 프로토콜**(`buildCmdCardProtocolRules`)을 항상 덧붙인다.
 * 그래야 인터랙티브 claude 가 작업 신고/질문/검수 카드를 터미널 한 줄 인쇄로 띄울 수 있다(IDE 가 캡처해 카드화).
 * 따라서 이제 rules 가 비어도 폴더 경로를 반환한다(=`--add-dir` 항상 켜짐).
 *
 * @returns 폴더 절대경로(쓰기 실패 시에만 null = `--add-dir` 생략).
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
    // §5.11 v4.65 — 켠 집행 플러그인의 지시. 헤드리스는 매 턴 프롬프트로 싣지만 CMD 는 우리가 프롬프트를
    //   조립하지 않으므로(사람이 REPL 을 직접 몬다) rules 와 **같은 통로**로 넣는다. 켠 것이 없으면
    //   빈 문자열이라 이 절이 생기지 않는다(종전 파일과 바이트 단위로 같다). 이미 떠 있는 세션에는
    //   소급되지 않고 다음 세션부터 적용 — rules 와 같은 규칙이다.
    const enforcement = opts.enforcementBlock?.trim();
    if (enforcement) sections.push(enforcement);
    // 카드 신고 프로토콜(터미널 한 줄) — 항상 주입. claude 가 echo 한 줄로 IDE 카드를 띄울 수 있게.
    sections.push(buildCmdCardProtocolRules().trim());
    const body = `${sections.join('\n\n')}\n`;
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), body, 'utf-8');
    return dir;
  } catch (err) {
    logger.warn(`[cmd-agent] rules dir write failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * §4 v2.64 — CMD(인터랙티브 터미널) 세션 연속성. 인터랙티브 claude 가 쏘는 hook 의 session_id
 * (claude 대화 UUID)를 termId 별로 `~/.vibisual/cmd-agents/<agentId>/sessions.json` 에 저장한다.
 * 앱을 완전히 종료하면 PTY(cmd.exe+claude) 자체는 죽지만 claude 는 대화를 JSONL 로 남기므로,
 * 재시작 후 같은 termId 로 터미널을 다시 열 때 `claude --resume <id>` 로 prefill 해 직전 대화를
 * 이어받는다(SCENARIO §23-2 의 헤드리스 `--resume` 연속성 패턴을 인터랙티브로 확장).
 * 그래프 상태가 아니라 터미널 프로세스 부기라 체크포인트가 아닌 CMD 로컬 스토어(rules CLAUDE.md
 * 와 같은 폴더)에 둔다. 값이 바뀔 때만 write — 같은 REPL 의 session id 는 안정적이라 사실상 1회.
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

/**
 * §4 v2.68 — CMD 에이전트의 모든 claude 대화 sessionId(UUID) 목록(중복 제거).
 *
 * `recordCmdTermSession` 이 termId(=세션 탭) 별로 `sessions.json` 에 적어둔 값(=claude 대화 UUID)을 모은다.
 * CMD 결과 목록 소싱 전용: hook 이 session_id 를 CMD 버블 합성 세션으로 rewrite 하므로 대화 본문은
 * 합성 세션이 아니라 이 UUID 의 JSONL 에만 쌓인다 → `buildAgentEvents` 가 이 UUID 로 `readUserMessages`
 * 해야 CMD 대화(프롬프트/응답)가 Results 패널에 뜬다. 파일/맵이 없으면 빈 배열.
 */
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

/** claude CLI 경로 — `services/claudeBin.ts` 가 SSOT (§5.7 #23-1 v1.59 버전 체크와 동일 바이너리). */
const CLAUDE_BIN = (): string => getClaudeBin().binPath;

/**
 * Persistent child process — VS Code Claude Code 확장과 같은 long-lived 모델.
 * 매 턴 fresh spawn (`claude -p --print --resume <id>`) 대신 에이전트당 1개 자식을 띄워두고
 * stdin 으로 다음 턴 메시지만 추가. 2턴째부터 node boot + claude init + JSONL 재로드 +
 * MCP 재연결 + hook 재초기화 비용이 0.
 *
 * 안전장치 — `VIBISUAL_PERSISTENT_CHILD=0` 으로 즉시 옛 동작(매 턴 fresh spawn) 복원.
 * claude 바이너리가 multi-turn stdin 을 지원 안 하는 버전이면 자식이 result 후 자연 종료 →
 * crash 복구 경로가 sub.sessionId 보존 → 다음 턴이 --resume 으로 자동 폴백.
 */
const PERSISTENT_CHILD_ENABLED = process.env['VIBISUAL_PERSISTENT_CHILD'] !== '0';

/**
 * soft interrupt(`control_request`)를 보낸 뒤 그 턴이 마감되기를 기다리는 시간. 이 창을 넘기면
 * **종전 하드 킬로 폴백**한다 — CLI 가 인터럽트에 `result` 를 안 돌려주는 판본에서도 세션이
 * "영원히 도는 중"으로 남지 않게 하는 안전판이다(폴백하면 감시는 종전처럼 함께 죽는다).
 *
 * **반드시 `TURN_RESUME_GRACE_MS` 보다 길어야 한다.** 마감은 `result` 도착이 아니라 **봉인**에서
 * 일어나고, 백단 여운이 있으면 그 봉인이 유예 창만큼 붙들린다. 두 창이 같으면(둘 다 3,000ms 였다)
 * "인터럽트가 먹었지만 아직 봉인 전"인 찰나에 폴백이 먼저 깨어나 **멀쩡히 응답한 세션을 하드 킬**
 * 하고, 곧 만료된 봉인이 그 죽어가는 자식에게 다음 턴을 써 넣었다 — 그것이 [즉시] 를 누르면 대화가
 * 끝나 버린 사고의 방아쇠다. 관계를 값으로 못 박아 두 창이 다시 겹치지 않게 한다.
 */
const SOFT_INTERRUPT_FALLBACK_MS = TURN_RESUME_GRACE_MS + 1500;

/** `control_request.request_id` 발급기 — CLI 응답을 짝지을 때 쓰는 값이라 유일하기만 하면 된다. */
let softInterruptSeq = 0;

/** `isChildStdinWritable` 이 보는 것만 구조로 드러낸다 — `ChildProcess` 가 그대로 들어맞는다. */
type StdinBearingChild = {
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  stdin?: { destroyed?: boolean; writableEnded?: boolean; writable?: boolean } | null;
};

/**
 * §5.5 #17-18 — **이 자식이 지금 다음 턴을 받을 수 있는 창구를 갖고 있는가.**
 *
 * `terminateChildTree`(사용자 [중지] · [즉시] 덧말의 하드 킬 폴백 · 앱 종료)는 SIGTERM 보다
 * **`stdin.end()` 를 먼저** 부른다. 그래서 프로세스가 아직 살아 있고(`close` 가 오기 전) 우리 장부에도
 * 그대로 남아 있는데 **창구만 먼저 닫힌 창**이 존재한다. 그 창에 다음 턴을 써 버리면 Node 는
 * `ERR_STREAM_WRITE_AFTER_END` 를 **stream 의 `error` 이벤트로** 올리므로 감싼 `try/catch` 가 못 잡고
 * 메인 프로세스 `uncaughtException` 이 된다 — 그 순간 dispatch 체인이 끊겨 **사용자가 방금 친 덧말이
 * 한 글자도 나가지 못한 채 대화가 끝난 것처럼 멈춘다**(실측: 2026-08-14 `crash.log` 2건, 스택이
 * 잠정 봉인 타이머 → finalize → `processNextCommand` → 이 write 로 이어진다).
 *
 * 그래서 재사용 판정은 "자식이 장부에 있는가"가 아니라 **"쓸 수 있는 창구인가"** 여야 한다.
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

/**
 * SubAgent 매니저 — 부모 에이전트별 독립 실행 세션 관리.
 *
 * 책임:
 * - subagent 생성/조회/상태 관리
 * - 명령 실행 (claude -p / --resume)
 * - 실행 완료 시 결과 수집 + 콜백
 */
/**
 * 스트림 이벤트 버퍼 최대 크기 (subagent당) = **IDE 가 되살릴 수 있는 대화의 전부**.
 *
 * §5.5 v4.92 — 500 → 2000. 사용자 말풍선(completedCommands)과 카드는 체크포인트에 사실상 무제한
 * 남는데 AI 본문·도구만 이 창에 갇혀 있어, 긴 세션을 다시 열면 **말풍선과 카드만 남고 그 사이
 * 대화가 통째로 빈** 화면이 됐다(실측: 1시간 1,015 이벤트 세션에서 500 창이 마지막 10분만 덮음).
 * 탭을 옮기면 클라 비활성 컷(300) 뒤 이 복원분이 유일한 소스라 여기가 곧 상한이다.
 *
 * ⚠ 올릴 때는 `streamBufferStore.COMPACT_KEEP_LINES`(디스크에 남기는 줄 수)가 항상 이 값보다
 *   커야 한다 — 작으면 복원이 그 줄 수로 조용히 깎인다.
 */
const MAX_STREAM_BUFFER = 2000;

/**
 * **전체 세션을 한 번에** 싣는 조회(`getStreamBuffersForAgent` — IDE 열 때 1회)의 세션당 상한.
 *
 * §5.5 v4.92 — 상한을 올리면서도 IDE 여는 비용은 종전 그대로 두기 위한 분리. 그 응답은 에이전트의
 * 모든 세션을 담는데, 클라는 보고 있지 않은 세션을 곧바로 `STREAM_EVENTS_MAX_PER_INACTIVE_SESSION`
 * 으로 깎는다 — 세션 10개에 2,000개씩 실어 보내야 9할이 버려진다. 깊은 복원분은 사용자가 실제로
 * 여는 세션만 `getStreamBuffer`(단건 경로)로 받아 간다.
 */
const MAX_STREAM_BUFFER_BULK = 500;

/** 이벤트 ID 생성 (나노초 수준 충돌 방지용 랜덤 suffix) */
function makeEventId(): string {
  return `se-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Edit 계열 도구 — 클라 DiffView(parseEditToolInput)가 input JSON 전체를 JSON.parse 해야
 *  side-by-side diff 를 그린다. 여기서 자르면 JSON 이 깨져 파싱 실패 → diff 미표시(한 줄만/누락). */
const DIFF_INPUT_TOOLS = new Set([
  'Edit', 'MultiEdit', 'Write', 'NotebookEdit',
  // §5.5 #17-17 ⑨ v4.59 — TodoWrite 도 전문이 필요하다. input 은 계획 전체(todos 배열)라
  //   300자에서 자르면 JSON 이 깨져 클라 계획 블록(`parsePlanTodos`)과 목표 단계 동기화가
  //   **둘 다 조용히 실패**한다(항목 두어 개만 넘어도 발생 — 계획이 일반 도구 상자로 폴백하던 원인).
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
 * §5.5 #17-13 ⑤-3 — CLI 작업 이벤트에서 **화면이 그리는 것만** 추린다.
 *
 * 실행본 스키마(claude.exe 2.1.223):
 *   task_started      : task_id · description · subagent_type? · task_type? · prompt? · skip_transcript?
 *   task_notification : task_id · status(completed|failed|stopped) · summary · usage.duration_ms · skip_transcript?
 * 두 이벤트는 CLI 자신의 표현으로 한 작업의 **edge bookends**(시작·끝 한 쌍)라, 클라가 `task_id` 로 접는다.
 * 나머지 subtype 은 payload 없이 종전 그대로 `[subtype]` 한 줄이다.
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

/** stream-json 라인 → SubAgentStreamEvent 배열 변환.
 *  하나의 assistant 메시지는 thinking + text + tool_use 블록을 동시에 담을 수 있어 배열로 반환.
 *  §5.7 #23-2 v1.60 — Agent View JSONL tail 경로(`claudeAgentViewWatcher`)에서도 동일 함수 재사용
 *  하려고 export. JSONL 은 stream-json 의 상위셋(메타 라인 추가)이라 모르는 type 은 자연스럽게 [] 반환. */
export function parseStreamLine(
  obj: Record<string, unknown>,
  subAgentId: string,
  parentAgentId: string,
  opts: { partialMessages?: boolean } = {},
): SubAgentStreamEvent[] {
  const type = obj['type'] as string | undefined;
  if (!type) return [];

  // §4 v2.88 — `--include-partial-messages` 가 켜진 스폰(legacy --print)에서만 true.
  //   true 면 토큰 델타(content_block_delta / stream_event)를 텍스트로 흘리고, 뒤따라오는
  //   완성 `assistant` 메시지의 text/thinking 는 **억제**한다(둘 다 그리면 본문이 2번 누적).
  //   false(persistent · Agent View JSONL)면 델타가 애초에 안 와서 기존 그대로 완성 메시지만 렌더.
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
    // §4 (스트림 3종 ①) — 중첩 서브에이전트(Task)가 한 말인가.
    //   `--forward-subagent-text` 가 켜져 있으면 원문이 `parent_tool_use_id` 로 소속을 알려 준다.
    //   ⚠ **이 줄들은 델타가 없다**(실측: 전달된 서브에이전트 텍스트는 완성 `assistant` 메시지로만 온다).
    //   그래서 아래 partial 가드를 그대로 두면 켜도 화면에 아무것도 안 나온다 — 플래그만 붙이면
    //   되는 줄 알기 쉬운 자리이고, 실제로 그렇게 하면 조용히 통째로 사라진다.
    const nestedUnder = typeof obj['parent_tool_use_id'] === 'string' ? (obj['parent_tool_use_id'] as string) : undefined;
    /** 중첩 줄은 델타가 없으므로 완성 블록을 반드시 방출해야 한다. */
    const skipComplete = partial && !nestedUnder;
    const nest = nestedUnder ? { nestedUnderToolUseId: nestedUnder } : {};
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      const bt = b['type'] as string | undefined;
      // §4 v2.88 — partial 모드면 text/thinking 은 이미 델타로 흘렸으므로 완성 블록은 건너뛴다(중복 방지).
      //   tool_use 는 델타(input_json_delta)가 부분 JSON 이라 못 쓰므로 항상 완성 블록에서 방출.
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

  // §4 v2.88 — content_block_delta 의 텍스트/사고 조각을 이벤트로.
  //   partial 모드에서만 처리(아니면 완성 assistant 메시지와 중복). delta 는 두 형태로 올 수 있다:
  //   ① 최상위 `{type:'content_block_delta', delta:{…}}`  ② `{type:'stream_event', event:{type:'content_block_delta', delta:{…}}}`(`--include-partial-messages` 래핑).
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
    // §4 (스트림 3종 ②) — `--replay-user-messages` 가 되돌려 준 **접수 확인**.
    //   원문 실측: `{"type":"user", …, "isReplay":true}`. 이 줄이 오면 "우리가 보낸 명령이 CLI 에
    //   실제로 들어갔다"가 스트림으로 증명된다 — 본문은 우리가 이미 화면에 그려 둔 그 명령이므로
    //   되풀이하지 않고 **칩 한 줄**로만 남긴다(대화록 중복 방지).
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
        // §5.5 #17-27 ⑪ — 결과가 **어느 호출의 것인지**를 함께 보낸다. `SubAgentStreamEvent.toolUseId` 규약은
        //   처음부터 양쪽(호출·결과)을 전제했는데 결과 쪽이 비어 있어, 클라 추종이 호출 순서(FIFO)로
        //   짐작할 수밖에 없었다 — 결과가 끝내 오지 않는 호출(중지·거부)이 하나만 있어도 그 뒤로 계속
        //   한 칸씩 밀려 **직전 파일을 따라가는** 사고가 났다. 원문에 이미 있는 값이라 새로 만들 것이 없다.
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

  // 시스템 메시지 — hook_started/hook_response/init 같은 세션 메타는 UI 노이즈라 버린다.
  // session_id는 클라가 필요로 하지 않음(서버가 내부적으로 subAgent.sessionId에 저장).
  // notification: index.ts classifyNotification 이 이미 버블 뱃지 + 브라우저 알림으로 처리 → 본문 중복.
  // turn_duration: claudeAgentViewWatcher 의 "턴 종료" 내부 신호 → 사용자에게 의미 없음.
  // 나머지 subtype(task_started 등)은 [subtype] 형태로 보내고, 클라가 왼쪽 레일 노드로 렌더한다(SystemNode).
  if (type === 'system') {
    const subtype = obj['subtype'] as string | undefined;
    const noisy = new Set(['hook_started', 'hook_response', 'hook_completed', 'init', 'notification', 'turn_duration']);
    if (subtype && noisy.has(subtype)) return [];
    // §5.5 #17-13 ⑤-3 (A) — CLI 가 직접 "인라인 대화록에서는 숨기라"고 표시한 살림성 작업
    //   (`skip_transcript` 필드 설명: "Ambient/housekeeping task. Consumers should hide this from
    //   the inline transcript; it may still appear in a tasks panel."). 우리 스트림이 곧 그 대화록이므로
    //   이벤트 자체를 만들지 않는다 — 버퍼·디스크·복원 예산에서 함께 빠진다.
    if (obj['skip_transcript'] === true) return [];
    // §5.5 #17-13 ⑤-3 (B) — 작업 칩은 payload 를 실어 보낸다(클라가 task_id 로 시작·끝을 한 줄로 접는다).
    const content = subtype ? formatSystemChip(subtype, readTaskInfo(subtype, obj)) : 'system';
    return [{ ...makeBase(), eventType: 'system', content }];
  }

  // §4 (스트림 3종 ③) — `--prompt-suggestions` 가 턴마다 보내는 "다음에 칠 만한 프롬프트" 예측.
  //   ⚠ 이 계정 probe 에서는 실제 메시지가 오지 않아(서버 측 게이팅 추정) **payload 모양을 단정하지
  //   않는다** — 흔한 이름 몇 개를 순서대로 훑고, 문자열을 못 찾으면 아무것도 만들지 않는다.
  //   모양이 달라도 잘못된 본문을 지어내지 않고 조용히 넘어가는 쪽을 택했다.
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

/**
 * **소유 탭이 미상인 항목**의 절대 상한 — 장부가 무한히 자라지 않게 하는 마지막 누수 방지.
 *
 * 종전에는 여기에 30분 quiet-window 가 함께 있어 "이만큼 조용하면 끝난 걸로 친다"고 추정했다.
 * 그 추정은 긴 빌드·패키징·폴링처럼 **정상적으로 조용한** 자식을 끝난 것으로 만들어 폐기했다
 * (`hasPendingSubagentTasks` 머리말). 이 상한은 그 대체물이 아니다 — 우리가 프로세스를 볼 수 없어
 * **사실로 판정할 길이 아예 없는** 항목에만 걸리고, 소유 탭을 아는 항목은 프로세스 소멸로만 걷힌다.
 */
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
  /**
   * §5.5 #17-9 ⑧ — 이 자식이 `run_in_background: true` 로 떠났는가(`tool_input` 그대로).
   * 배경 스폰은 **띄우자마자** `PostToolUse` 가 "띄웠다" 접수증을 물고 돌아오므로, ⑦(b) 의
   * "결과가 왔다 = 끝났다" 폴백을 그대로 태우면 항목이 수 밀리초 만에 내려간다(= 활동바가
   * 내내 `(0)`). 이 표식이 붙은 항목은 `SubagentStop` 으로만 내린다.
   */
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
  /** v1.74 — "지금 즉시 체크포인트 저장" 요청. agent-view 매핑(agentViewShort/SessionId)을
   *  spawn 직후 영속화하기 위한 무조건 저장 훅. onSubStatusChange 는 status 변화가 없으면
   *  저장을 건너뛰어, 데몬 매핑이 디스크에 안 남는 윈도우(서버 크래시 시 reattach 불가)가 생긴다. */
  private onPersistNeeded: (() => void) | null = null;
  /** subagentId → 최근 스트림 이벤트 버퍼 (late-join용) */
  private streamBuffers = new Map<string, SubAgentStreamEvent[]>();
  /**
   * subagentId → 마지막으로 디스크에서 읽었을 때의 파일 지문(`streamBufferStore` 규약).
   *
   * 읽기 경로가 **결과가 비면 캐시하지 않아**(`if (loaded.length > 0)`) 파일이 없거나 빈 세션은
   * 호출마다 파일을 다시 열었고, 내용이 있는 세션도 호출마다 꼬리를 다시 파싱했다. 지문이 그대로면
   * `stat` 한 번으로 끝낸다. ⚠ 버퍼를 버리는 곳(`sweepIdle`·제거·`restore`)에서는 **이 지문도 함께
   * 지워야** 한다 — 안 지우면 "변화 없음"으로 판정해 디스크에 멀쩡한 과거를 못 읽어 온다.
   *
   * `dir` 를 함께 들고 있는 이유: 복원 직후처럼 부모를 힌트로만 알 때는 폴더가 나중에 달라질 수
   * 있다. 폴더가 바뀌면 지난 지문은 **다른 파일의 것**이라 무효로 보고 다시 읽는다.
   */
  private streamDiskStamps = new Map<string, { dir: string; stamp: string | null }>();

  /** 지난번 그 폴더에서 읽은 지문. 폴더가 다르면 `undefined`(= 읽은 적 없음)로 친다. */
  private prevStreamStamp(subAgentId: string, dir: string): string | null | undefined {
    const prev = this.streamDiskStamps.get(subAgentId);
    return prev && prev.dir === dir ? prev.stamp : undefined;
  }
  /** subagentId → 실행 중인 자식 프로세스 (탭 닫기 시 종료용) */
  private runningChildren = new Map<string, ChildProcess>();
  /**
   * §5.3 v4.89 — sub.id → 이번 스폰에 얹을 환경변수(중첩 깊이 · 자동 기억 끄기).
   * 인자(`configArgs`)와 달리 env 는 spawn 시점에만 필요해 조립 지점과 사용 지점이 떨어져 있다.
   */
  private pendingConfigEnv = new Map<string, Record<string, string>>();
  /** §5.7 #23-2 v1.60 — subagentId → 진행 중인 agent-view watcher 메타.
   *  legacy path 의 runningChildren 와 짝. cancel/remove 시 `claude stop` + `detachWatcher` 발사. */
  private runningAgentViewWatchers = new Map<string, { short: string; sessionId: string }>();
  /** 사용자가 stop() 호출로 명시 중지한 subagentId — close 핸들러에서 '유저 중지' vs '에러' 를 구분해
   *  cmd.result 를 `[Stopped by user]` 로 채우고 sub.status 를 idle 로 복귀시키기 위함. */
  private stoppedByUser = new Set<string>();
  /** §5.3 #12-1 v3.43 — 헤드리스 감독관의 "백그라운드 서브에이전트" 대차대조.
   *  parentAgentId → (부모 Task/Agent tool_use_id → 시작 시각). PreToolUse(Task|Agent) ↑ /
   *  SubagentStop(서브의 parent_tool_use_id 로 매칭) ↓. size>0 인 동안 recompute/sweep/expire 가
   *  부모 버블을 completed/idle 로 강등하지 않는다 — 부모 턴이 끝나 sub 가 idle 이어도 자식들이
   *  백단에서 도는 중 = "대기 중인 활성". 런타임 전용(영속화 ❌ — 재시작 시 리셋, 살아있는
   *  워커는 reattach 경로가 별도 복구).
   *  §5.5 #17-9 v3.51 — 항목에 `tool_input` 메타(description/subagentType/prompt)를 함께 싣는다.
   *  대차대조 판정에는 쓰이지 않고 오직 IDE 표시(`getRunningSubagentTasks`)용이다.
   *  §5.5 #17-9 ⑦(a) — 자식이 도구를 쓸 때마다 오는 `PreToolUse`(공통 필드 `agent_id`/`agent_type`)로
   *  `agentId`·`agentType`·`currentTool`·`currentToolDetail`·`toolCount`·`lastActivityAt` 가 갱신된다.
   *  전부 표시 전용 — 대차대조 증감(PreToolUse(Task|Agent) ↑ / SubagentStop ↓)은 그대로다. */
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
  /** tool_use_id 미상 페이로드용 합성 키 시퀀스. */
  private pendingSubagentAnonSeq = 0;
  /** Persistent child — 자식이 turn 사이 idle(다음 stdin write 대기) 인가. true 면 reuse 가능.
   *  result 라인 도착 시 true, 새 stdin write 직전 false. */
  private persistentChildReady = new Map<string, boolean>();
  /** Persistent child — 의도적 종료 마킹(stop/remove/shutdownAll). close 핸들러에서 crash 와 구분하기 위함.
   *  마킹 없이 close 되면 crash 경로로 sub.sessionId 보존(다음 execute 가 --resume 으로 복구). */
  private intentionalKill = new Set<string>();
  /** Persistent child — 턴 사이에 살아남는 stdout line buffer. fresh spawn 에선 매번 새로 만들지만
   *  persistent child 는 같은 stdout 스트림이 여러 턴을 흘리므로 map 으로 보존. */
  private persistentLineBuf = new Map<string, string>();
  /** Persistent child — 현재 진행 중인 turn 의 cmd/turnCount/resultText/killed/maxTurns/parentCwd.
   *  fresh spawn 또는 reuse 시점에 새 값으로 set, result 라인 도착 시 delete. */
  private persistentInFlightCmd = new Map<string, {
    cmd: QueuedCommand;
    turnCount: number;
    resultText: string | undefined;
    killed: boolean;
    maxTurns: number;
    parentCwd: string;
  }>();
  /**
   * §5.19 (D) — **로컬(All Model) 턴의 in-flight 표식.** `persistentInFlightCmd` 의 로컬 판본이다.
   *
   * 로컬 턴은 자식 프로세스도 워처도 없다. 그래서 "지금 도는가"를 묻는 술어들
   * (`isSubRunning` · `isSubProcessingCommand`)이 **전부 false** 를 냈고, 5초마다 도는
   * `reconcileDeadActiveSubs` 가 멀쩡히 돌던 세션을 "자식 없는 죽은 active" 로 읽어 idle 로
   * 강등했다. 그 idle 을 `recomputeCustomAgentStatus` 가 부모 버블의 `completed` 로 세탁하고,
   * 곧이어 러너의 다음 도구 이벤트가 `touchAgent` 로 버블을 다시 `active` 로 올린다 —
   * 명령 한 번에 **완료 ↔ 동작이 5초마다 되풀이**되던 자리가 여기다(2026-08-25 사용자 보고;
   * 체크포인트 실측: 25초 사이 도구 5건 + `fadeStartedAt` 재각인 2회).
   *
   * 러너에도 같은 사실을 아는 `isLocalTurnRunning` 이 있지만 **판정의 주인으로 쓰지 않는다** —
   * 러너의 정리는 `finally` 라 `onDone` **뒤**에 돌고, 그러면 `finish()` 가 부르는 상태 재계산이
   * 아직 "도는 중"을 보고 완료를 건너뛴다. 여기서 `finish()` 맨 앞에 지우면 순서가 정확하다.
   */
  private localInFlightCmd = new Map<string, QueuedCommand>();
  /** §5.5 #17-12 ③ — 자식 stderr 의 **마지막 꼬리**(sub 별). 종료 코드만으론 "왜 죽었는지"를
   *  말할 수 없어, 실패로 끝났을 때 사유로 실어 보낸다. 성공 경로에서는 쓰지 않고 spawn 마다 리셋. */
  private childStderrTails = new Map<string, string>();
  /** 부모 에이전트 → 프로젝트 해석 콜백 (영속화 경로 계산용) */
  private projectResolver: AgentProjectResolver | null = null;
  /** §5.19 (H) — 호스트 도구 처리기. 없으면 그 도구들은 "이 세션에서는 못 쓴다"고 답한다. */
  private localHostToolHandler: LocalHostToolHandler | null = null;
  /** §5.19 (H) — 도구 이벤트를 훅으로 흘리는 곳. 없으면 아무 데도 안 간다(종전 동작). */
  private localHookEmitter: LocalHookEmitter | null = null;
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
   * **PTY(CMD 인터랙티브 터미널)로 도는 세션.** 이 탭들은 우리가 헤드리스 자식을 띄운 게 아니라
   * 사용자가 직접 치는 터미널이라 `runningChildren`·`runningAgentViewWatchers` 어디에도 없다.
   * 아래 생존 대조가 "자식이 없으니 죽었다"로 잘못 강등하지 않도록 여기 표식을 남긴다
   * (표식은 `markCmdSubActivity` 가 그 탭을 처음 만질 때 붙는다).
   */
  private cmdDrivenSubs = new Set<string>();

  /**
   * §4 (CMD ① QA) — **pane 별** 마지막 감지 상태(subId → paneId → 상태).
   * 분할 탭에서 pane 마다 감지기가 따로 돌아 같은 sub 를 서로 덮어쓰던 것을 막는 자리다.
   * 런타임 전용 — 영속하지 않는다(PTY 가 없는 부팅 직후엔 어차피 의미가 없다).
   */
  private cmdPaneStates = new Map<string, Map<string, { state: CmdTerminalState; reason?: string }>>();

  /**
   * **스폰이 진행 중인 sub.** `execute` 가 `sub.status='active'` 를 올린 뒤 자식/워처가 실제로
   * 등록되기까지 사이가 있다(agent-view 경로는 `await attachWatcher` 라 그 사이가 실제로 벌어진다).
   * 그 창에 생존 대조가 끼어들면 이제 막 뜨는 세션을 죽은 것으로 오해한다.
   */
  private dispatchingSubs = new Set<string>();

  /**
   * §5.5 #17-2 — **슬래시 턴이 미뤄 둔 브리핑**(subAgentId).
   *
   * `contextSummary`(카드 지시문·의도 선언·목표·Brain 브리핑)는 그 세션의 **첫 프롬프트에만** 실린다.
   * 그래서 세션의 첫 턴이 `/compact` 같은 슬래시 명령이면 — 그 턴은 원문만 나가야 CLI 가 명령으로
   * 집으므로 — 브리핑을 실을 자리가 없고, 그대로 두면 그 세션은 브리핑을 **영영** 못 받는다.
   * 여기 담아 두었다가 다음 비슬래시 턴에 실어 보낸다. 런타임 전용(세션이 사라지면 함께 지운다).
   */
  private contextSummaryPending = new Set<string>();

  /** 스폰 진행 표식 해제 — 자식/워처 등록 시점과 모든 실패 경로가 부른다. */
  private clearDispatching(subId: string): void {
    this.dispatchingSubs.delete(subId);
  }

  /**
   * **턴 세대 도장** — 지금 이 세션에서 도는 명령의 id. 스트림 한 줄 한 줄에 각인해,
   * 클라가 도착 시각이 아니라 **자기 턴**으로 명령 블록을 고르게 한다.
   *
   * dispatch 에서 세우고 마감에서 지운다. 마감 뒤에 늦게 흘러드는 줄(백단 작업의 여운)은
   * 도장이 비는데, 그때는 그 작업을 시작한 턴을 `liveTasks` 에서 되찾아 찍는다.
   */
  private currentTurnId = new Map<string, string>();

  setOnComplete(cb: () => void): void {
    this.onComplete = cb;
  }

  setOnStreamEvent(cb: (event: SubAgentStreamEvent) => void): void {
    this.onStreamEvent = cb;
  }

  setOnSubStatusChange(cb: (parentAgentId: string) => void): void {
    this.onSubStatusChange = cb;
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

  setLocalHostToolHandler(handler: LocalHostToolHandler): void {
    this.localHostToolHandler = handler;
  }

  setProjectResolver(resolver: AgentProjectResolver): void {
    this.projectResolver = resolver;
  }

  /** 부모 에이전트의 sub-streams 디렉토리 해석. 프로젝트 미확정이면 null. */
  private resolveStreamDir(parentAgentId: string): string | null {
    const info = this.projectResolver?.(parentAgentId);
    if (!info) return null;
    return streamBufferStore.subStreamsDir(info, parentAgentId);
  }

  /**
   * 이 부모 에이전트의 sub-streams 파일을 통째로 삭제 — **휴지통 영구 삭제 전용**(v4.67).
   * 종전엔 jsonl 을 지우는 경로가 아예 없어(`deleteBuffer` 호출부 0곳) 한 번 만들어진 스트림
   * 파일이 영원히 남았다. 되살아날 수 없는 영구 삭제에서만 정리한다 — 탭 닫기·idle 회수·
   * lifecycle 제거는 디스크에서 다시 읽는 복구 경로라 여기에 배선하면 안 된다.
   */
  purgeAgentStreams(parentAgentId: string): void {
    const dir = this.resolveStreamDir(parentAgentId);
    if (!dir) return;
    streamBufferStore.deleteAgentStreams(dir);
  }

  /**
   * 특정 subagent의 버퍼된 스트림 이벤트 반환 (REST API용).
   *
   * `parentAgentIdHint` — 라우트가 아는 부모 에이전트 id. 세션을 **복원한 직후**에는 클라가
   * 곧바로 깊은 복원분을 요청하는데 서버 `index` 에는 아직 그 sub 가 없을 수 있고, 그러면
   * 디스크에 파일이 멀쩡히 있는데도 빈 배열이 나가 화면이 얕은 창에 갇혔다. 부모를 알면
   * 폴더는 정해지므로(`sub-streams/<agentId>/<subId>.jsonl`) 힌트로 그대로 읽는다.
   */
  getStreamBuffer(subAgentId: string, parentAgentIdHint?: string): SubAgentStreamEvent[] {
    const buf = this.streamBuffers.get(subAgentId);
    if (buf && buf.length > 0) return buf;
    // idle 회수(sweepIdle)로 메모리에서 비워졌으면 디스크에서 복구 + 재캐시.
    const sub = this.index.get(subAgentId);
    const parentAgentId = sub?.parentAgentId ?? parentAgentIdHint;
    const dir = parentAgentId ? this.resolveStreamDir(parentAgentId) : null;
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

  /** 에이전트의 전체 subagent 스트림 버퍼 반환 — 세션당 `MAX_STREAM_BUFFER_BULK` 까지(얕게). */
  getStreamBuffersForAgent(agentId: string): Record<string, SubAgentStreamEvent[]> {
    const subs = this.registry.get(agentId) ?? [];
    const result: Record<string, SubAgentStreamEvent[]> = {};
    const dir = this.resolveStreamDir(agentId);
    for (const sub of subs) {
      let buf = this.streamBuffers.get(sub.id);
      // idle 회수로 메모리에서 비워진 sub 는 디스크에서 복구 + 재캐시(IDE 재오픈 시 빈 화면 방지).
      // ⚠ 이 조회는 그 에이전트의 **모든 sub** 를 도므로, 한 번 부를 때마다 세션 수만큼 파일을 열었다.
      //   지문이 그대로면 `stat` 한 번으로 넘어간다(반복 호출 비용이 세션 수 × 파일 크기 → 세션 수 × stat).
      if ((!buf || buf.length === 0) && dir) {
        const prev = buf === undefined ? undefined : this.prevStreamStamp(sub.id, dir);
        const r = streamBufferStore.loadBufferIfChanged(dir, sub.id, MAX_STREAM_BUFFER, prev);
        if (r.changed) {
          this.streamDiskStamps.set(sub.id, { dir, stamp: r.stamp });
          this.streamBuffers.set(sub.id, r.events);
          buf = r.events;
        }
      }
      // §5.5 v4.92 — 메모리 캐시는 상한 전체를 들고 있어도 **여기서는 꼬리만** 실어 보낸다.
      //   보고 있는 세션의 깊은 복원분은 단건 경로(`getStreamBuffer`)가 따로 준다.
      if (buf && buf.length > 0) {
        result[sub.id] = buf.length > MAX_STREAM_BUFFER_BULK ? buf.slice(buf.length - MAX_STREAM_BUFFER_BULK) : buf;
      }
    }
    return result;
  }

  /**
   * §5.3 #12-1 v1.96 — 외부에서 합성 system 라인을 sub stream 에 끼워 넣는 진입점.
   * 권한 승인 broker 가 사용자의 Allow/Deny 결정을 그 sub 의 stream 에 한 줄로 남길 때 호출.
   * 정규 emit 경로(`emitStreamEvent`)를 그대로 타서 버퍼·디스크·WS broadcast 가 일관되게 처리됨.
   */
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

  /**
   * §5.5 #17-12 ③ — 명령을 오류로 마감하면서 **왜** 인지를 함께 남긴다.
   *
   * 두 표면에 같은 사유를 싣는다:
   *  1) `cmd.error` — 명령과 함께 아카이브·체크포인트로 남아, 하단 상태바가 "오류" 대신 사유를 말한다.
   *  2) `error` 스트림 이벤트 — 실패한 그 시점(턴 끝)에 대화 안에 한 줄로 남는다.
   *
   * 사람이 읽을 문장은 만들지 않는다 — 로케일이 있는 쪽(클라)이 코드로 만들고, 여기서는
   * `[code:exitCode] detail` 형식으로 코드·원문만 실어 보낸다(system 줄의 `[subtype]` 규약과 동형).
   */
  private failCommand(sub: SubAgent, cmd: QueuedCommand, error: CommandError): void {
    const detail = error.detail ? error.detail.trim().slice(-COMMAND_ERROR_DETAIL_LIMIT) : undefined;
    cmd.error = {
      code: error.code,
      ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
      ...(detail ? { detail } : {}),
    };
    const head = error.exitCode !== undefined ? `[${error.code}:${error.exitCode}]` : `[${error.code}]`;
    this.emitStreamEvent({
      id: makeEventId(),
      subAgentId: sub.id,
      parentAgentId: sub.parentAgentId,
      timestamp: Date.now(),
      eventType: 'error',
      content: detail ? `${head} ${detail}` : head,
    });
    logger.warn(`SubAgent ${sub.id} command failed [${error.code}]${error.exitCode !== undefined ? ` exit=${error.exitCode}` : ''}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
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
    cmd.error = {
      code: error.code,
      ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
      ...(detail ? { detail } : {}),
    };
  }

  /**
   * 작업 칩(`task_started` / `task_notification`) 한 장을 그 세션의 백그라운드 장부에 반영한다.
   *
   * 이 장부는 두 가지를 동시에 몰고 간다 — ① 턴 봉인 지연(`turnSeal.ts`), ② **화면**(실행 목록·세션
   * 도트·부모 버블 완료 판정). ② 는 나중에 붙은 것이라, 칩이 오갈 때 상태 갱신을 함께 태우지 않으면
   * 백단 작업이 늘거나 줄어도 화면이 꿈쩍하지 않는다(= 끝난 것처럼 보인다).
   */
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
    // §5.5 #17-9 ⑪ — Task/Agent 자식의 **끝 통지**를 훅 대차대조에도 내려 준다.
    //   배경 스폰(`run_in_background`)은 `PostToolUse` 가 접수증이라 ⑧ 이 내리지 않으므로 내리는
    //   길이 `SubagentStop` 하나뿐인데, 그 신호가 유실되거나 `parent_tool_use_id` 가 우리 열쇠와
    //   어긋나면 항목이 **영영** 남았다(세션이 살아 있으면 `sweepOrphanedBackgroundTasks` 도
    //   손대지 않고, 소유 탭을 아는 항목이라 절대 상한도 비껴간다). 그래서 사용자 화면에는 이미
    //   끝난 자식이 몇 시간째 "실행 중"으로 붙어 있었다(사용자 보고).
    //   끝 통지는 **추정이 아니라 사실**이라(§ turnSeal.ts 머리말의 두 근거 중 ①) 이 자리에서
    //   내리는 것은 "조용하니 죽었겠지"와 전혀 다르다.
    if (ending?.subagentType) {
      this.dropPendingBySubagentEndChip(sub.parentAgentId, subAgentId, ending, task?.summary);
    }
    this.syncBgSubStatus(sub.parentAgentId);
    this.onSubStatusChange?.(sub.parentAgentId);
  }

  /**
   * §5.5 #17-9 ⑪ — 스트림 끝 통지로 훅 대차대조 항목 하나를 내린다.
   *
   * 두 장부는 열쇠가 다르다 — 훅 항목은 부모의 `tool_use_id`, 스트림 칩은 CLI 가 발급한 `task_id`.
   * 그래서 **그 자식이 무엇이었는지**로 짝을 찾는다: 같은 탭(`subId`)이 띄운, 같은 `subagent_type`
   * 항목 중 이름(`description`)이 같은 것 → 없으면 최고령. 범위를 탭+종류로 좁히므로 다른 종류의
   * 자식을 대신 내리는 일은 없고, 같은 종류가 여럿이면 어차피 모두 이 통지를 한 번씩 받는다.
   *
   * 아무것도 못 찾으면 조용히 지나간다 — `SubagentStop` 이 이미 제때 내렸다는 뜻이다(정상 경로).
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

  /**
   * 스트림 한 줄이 턴 봉인 판정에 주는 영향을 반영한다 — `emitStreamEvent` 의 **모든** 경로
   * (legacy / persistent / agent-view JSONL)가 여기를 지나므로 이 한 곳이면 전부 덮인다.
   *
   * 두 가지를 한다:
   *  1) 작업 칩(`task_started` / `task_notification`)을 대차대조에 반영.
   *  2) 실제 작업 이벤트가 오면 **잠정 봉인을 취소**하고 "턴이 이어졌다"로 기록한다.
   *     이미 봉인이 끝난 뒤(늦게 깨어난 백그라운드 작업)라면 sub 를 다시 `active` 로 올려
   *     화면이 "끝났다"고 거짓말하지 않게 한다.
   */
  private noteTurnSealSignal(event: SubAgentStreamEvent): void {
    if (event.eventType === 'system') {
      const subtype = parseSystemSubtype(event.content);
      if (subtype !== null) {
        this.noteStreamTaskChip(event.subAgentId, subtype, parseSystemTaskInfo(event.content));
      }
      return;
    }
    if (!isTurnResumeSignal(event.eventType)) return;

    const deferred = this.deferredSeals.get(event.subAgentId);
    if (deferred) {
      clearTimeout(deferred.timer);
      this.deferredSeals.delete(event.subAgentId);
      noteTurnResumed(this.getTurnSealState(event.subAgentId));
      deferred.onResume?.();
      logger.info(`SubAgent ${event.subAgentId} turn resumed (${event.eventType}) — provisional seal cancelled`);
      return;
    }

    // 봉인이 이미 끝난 뒤에 다시 흐르기 시작한 경우 — 화면을 진실로 되돌린다.
    const sub = this.index.get(event.subAgentId);
    if (sub && (sub.status === 'idle' || sub.status === 'completed')) {
      sub.status = 'active';
      sub.lastActivityAt = Date.now();
      logger.info(`SubAgent ${sub.id} woke up after its turn was sealed (${event.eventType}) — back to active`);
      this.onSubStatusChange?.(sub.parentAgentId);
    }
  }

  /**
   * 턴 종료를 **봉인하거나 잠정으로 미룬다**(`turnSeal.ts` 의 정책을 실행하는 자리).
   *
   * `canResume` 은 "자식이 아직 살아 있어 이 턴이 다시 돌 수 있는가" 다 — 자식이 이미 죽은
   * 마감 경로(legacy `--print` 종료 · 크래시 · 사용자 중지)는 재진입이 물리적으로 불가능하므로
   * 종전 그대로 즉시 봉인한다.
   */
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
    const timer = setTimeout(() => {
      this.deferredSeals.delete(sub.id);
      noteTurnSealed(this.getTurnSealState(sub.id));
      logger.info(`SubAgent ${sub.id} provisional turn end expired — sealing`);
      seal();
    }, TURN_RESUME_GRACE_MS);
    if (typeof timer.unref === 'function') timer.unref();
    this.deferredSeals.set(sub.id, { timer, seal, ...(onResume ? { onResume } : {}) });
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

  /**
   * 이 줄에 **자기 턴**을 각인한다. 우선순위는 하나뿐이다 — **그 일을 시킨 턴이 주인**이다.
   *
   *  ① 백그라운드 작업의 끝 통지(`task_notification`)는 그 작업을 **시작한 턴**의 도장을 쓴다.
   *     통지는 몇 턴 뒤에 올 수 있고, 도착 시점의 턴에 붙이면 남의 명령이 한 일로 보인다.
   *  ② 그 밖의 줄은 **지금 도는 턴**의 것이다(한 세션의 본 대화는 한 번에 하나만 돈다).
   *  ③ 도는 턴이 없으면(마감 뒤 여운) 도장을 비워 둔다 — 클라가 종전 시각 기준으로 폴백한다.
   */
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

  /** 스트림 이벤트를 버퍼에 추가 + 디스크 append + 콜백 호출 */
  private emitStreamEvent(event: SubAgentStreamEvent): void {
    // 턴 세대 도장 — 이 줄이 **어느 명령의 것인가**. 클라는 이 값으로 명령 블록을 고르므로
    //   봉인 판정보다 **먼저** 찍는다(아래에서 버려지는 칩도 라이브 중계로는 나간다).
    this.stampTurnId(event);
    // 턴 봉인 판정은 **버려지는 칩까지 포함해** 모든 줄을 봐야 한다 — 아래 복원 예산 컷보다 먼저.
    this.noteTurnSealSignal(event);
    // §5.5 v4.92 — 내용 없는 SDK 상태 칩(`[task_progress]`·`[thinking_tokens]` 등)은 **복원 예산에서 뺀다**.
    //   어느 밀도에서도 한 글자도 안 그려지면서 버퍼의 38%(실측)를 먹어 대화를 밀어내던 것들이다.
    //   라이브 중계(onStreamEvent)는 그대로 — 진행 표시·라이브 1줄은 이 칩들로 움직이므로 끊으면 안 된다.
    //   버퍼·디스크에만 안 남기므로, 다시 열었을 때 같은 슬롯이 실제 대화로 채워진다.
    if (isNeverRenderedStreamEvent(event)) {
      const liveOnlySub = this.index.get(event.subAgentId);
      if (liveOnlySub) liveOnlySub.lastActivityAt = Date.now();
      this.onStreamEvent?.(event);
      return;
    }
    let buf = this.streamBuffers.get(event.subAgentId);
    if (!buf) {
      // idle 회수(sweepIdle)로 비워진 뒤 재개되는 경우, 디스크에서 과거를 복원해 이어붙인다 —
      // 메모리 버퍼 완전성 보장(이게 없으면 재개 후 getStreamBuffersForAgent 가 과거 누락분만 반환).
      const dir0 = this.resolveStreamDir(event.parentAgentId);
      if (dir0) {
        const r = streamBufferStore.loadBufferIfChanged(dir0, event.subAgentId, MAX_STREAM_BUFFER, undefined);
        this.streamDiskStamps.set(event.subAgentId, { dir: dir0, stamp: r.stamp });
        buf = r.events;
      } else {
        buf = [];
      }
      this.streamBuffers.set(event.subAgentId, buf);
    }
    buf.push(event);
    if (buf.length > MAX_STREAM_BUFFER) buf.splice(0, buf.length - MAX_STREAM_BUFFER);
    // 거짓-완료 방지 — 스트림 이벤트가 흐르는 동안 sub 를 "살아있음" 으로 갱신.
    // lastActivityAt 은 execute() 시작·child.close 두 곳에서만 찍혀, 명령이 길어지면
    // idle sweep 이 staleness 만 보고 실행 중 sub 를 idle 로 강등 → 부모 버블이 거짓 completed.
    const liveSub = this.index.get(event.subAgentId);
    if (liveSub) liveSub.lastActivityAt = Date.now();
    // 디스크 영속화 — 프로젝트별 save 디렉토리 하위 sub-streams/<agentId>/<subId>.jsonl
    const dir = this.resolveStreamDir(event.parentAgentId);
    if (dir) streamBufferStore.appendEvent(dir, event);
    this.onStreamEvent?.(event);
  }

  /** 카운터 반환 (체크포인트 저장용) */
  getCounter(): number {
    return subCounter;
  }

  /** 체크포인트에서 복원 — SubAgent 메타 + 디스크 persist된 스트림 버퍼도 함께 로드.
   *  project 인자: 해당 체크포인트 소속 프로젝트. 프로젝트별 save 디렉토리에서 스트림 파일을 찾기 위해 필요.
   *  미지정(= 1.x 호환 호출)이면 스트림 복원을 건너뛰고 메타만 복원한다.
   *  archived 인자: 아카이브된(탭 닫힌) 서브에이전트 목록(폴더 버튼 소스). */
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
      for (const s of restored) {
        this.index.set(s.id, s);
        if (dir) {
          const buf = streamBufferStore.loadBuffer(dir, s.id, MAX_STREAM_BUFFER);
          if (buf.length > 0) { this.streamBuffers.set(s.id, buf); loadedBuffers++; }
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
   * §5.7 #23-2 v1.60 — 서버 부팅 시 호출.
   * 영속화된 subagent 중 `agentViewShort` 가 있는 것들에 대해 supervisor roster 와 cross-reference 해서
   * 살아있으면 watcher 재부착하고 sub.status = 'active' 로 되돌린다.
   * 죽었으면 state.json 최종 상태를 마지막 결과로 흡수하고 sub.status 는 idle/error 로 마무리.
   *
   * 내부에서 `projectResolver` 로 부모 에이전트 → cwd 를 해석한다(인덱스에 set 되어 있어야 함).
   *
   * @param findExecutingCmd subAgentId → 그 sub 의 가장 최근 executing 명령. 없으면 null.
   *                         호출자(index.ts) 가 graphManager 의 commandQueues 를 스캔하는 함수 주입.
   *                         이게 있어야 terminal 시점에 cmd.status='completed' 로 마무리 가능.
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
    const finalizeCmd = (sub: SubAgent, stateStr: string, resultText: string | undefined, detail?: string): void => {
      const cmd = findExecutingCmd?.(sub.id);
      if (!cmd) return;
      const isError = stateStr === 'failed';
      cmd.status = isError ? 'error' : 'completed';
      if (resultText) cmd.result = resultText;
      // §5.5 #17-12 ③ — 실패로 봉합되는 명령에는 사유를 함께 남긴다(옛 코드는 상태만 바꿔 "오류"만 남았다).
      if (isError) this.failCommand(sub, cmd, { code: 'agentView', ...(detail ? { detail } : {}) });
    };

    for (const sub of known) {
      const short = sub.agentViewShort!;
      const sessionId = sub.agentViewSessionId!;
      const project = this.projectResolver?.(sub.parentAgentId);
      const cwd = project?.path ?? null;
      if (!cwd) { failedCount++; continue; }

      if (aliveShorts.has(short)) {
        // v1.60 fix: alive ≠ working. roster 에 있어도 state.json 의 state 가 'idle'/'done' 등
        // 비-working 이면 턴은 이미 끝난 것 — sub 를 'active' 로 부활시키면 부모 에이전트가
        // idle→active→completed 사이클을 타게 된다. state 가 'working' 또는 'needs-input' 일 때만
        // 실제 진행 중으로 보고 watcher 재부착. 그 외엔 gone 경로와 동일하게 cmd 봉합 + idle 마무리.
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
                finalizeCmd(sub, ts, resultText, state.detail);
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
          finalizeCmd(sub, stateStr, resultText, currentState?.detail);
          // v1.62 fix — 다른 terminal 경로(stillWorking/finishTerminal/legacy)와 동일하게
          // 부모 커스텀 버블 재계산 + cmd 아카이브를 즉시 트리거. 누락 시 부모 배지가
          // 다음 10초 주기 sweep 까지 stale 상태로 남는다.
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
          finalizeCmd(sub, stateStr, resultText, finalState.detail);
          // v1.62 fix — gone 경로도 부모 재계산 + 아카이브 즉시 트리거 (위 분기와 동일 이유).
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

  /** 전체 서브에이전트 flat 목록 (세션 ID 역조회용) */
  getAllSubsFlat(): SubAgent[] {
    return [...this.index.values()];
  }

  /** v1.33 — subAgentId 로 직접 조회. projectGraph reconcile 경로용. 없으면 undefined. */
  getSub(subAgentId: string): SubAgent | undefined {
    return this.index.get(subAgentId);
  }

  /**
   * §5.5 #17-8 v2.95 — 세션 자기요약. 카드가 하나도 없는 세션을 한 줄로 요약하기 위해, 그 세션의
   * claude 대화를 `--resume` 해 헤드리스 1턴(짧은 한국어 요약 프롬프트)을 spawn 하고 결과 텍스트를 돌려준다.
   * "자기가 자기를 요약" — 세션 자신의 컨텍스트로 도므로 별도 transcript 주입이 불필요.
   *
   * sessionId 해석: 헤드리스/persistent 는 `sub.sessionId`, CMD 인터랙티브는 termId 기반
   * `getCmdResumeSession('term:<agentId>:<subId>')`. 둘 다 없으면(대화 전무) null 텍스트.
   * cwd 는 projectResolver(parentAgentId).path. 30s 타임아웃. 표시 전용이라 실패는 조용히 error.
   */
  async summarizeSession(parentAgentId: string, subId: string): Promise<{ ok: boolean; text?: string; error?: string }> {
    const sub = this.index.get(subId);
    const info = this.projectResolver?.(parentAgentId);
    const cwd = info?.path;
    if (!cwd) return { ok: false, error: 'project-not-resolved' };

    // 세션의 claude 대화 sessionId 해석 — 헤드리스 sub.sessionId 우선, 없으면 CMD termId 매핑.
    let sessionId = sub?.sessionId && sub.sessionId.length > 0 ? sub.sessionId : '';
    if (!sessionId) {
      const cmdSid = getCmdResumeSession(`term:${parentAgentId}:${subId}`);
      if (cmdSid) sessionId = cmdSid;
    }
    if (!sessionId) return { ok: false, error: 'no-conversation' };

    // JSONL 이 사라진 스테일 세션이면 --resume 이 확정 실패 — 미리 가드.
    try {
      const jsonlPath = getSessionJsonlPath(cwd, sessionId);
      if (!fs.existsSync(jsonlPath)) return { ok: false, error: 'no-conversation' };
    } catch { /* 경로 계산 실패는 spawn 에 맡김 */ }

    const prompt =
      '지금까지 이 세션에서 한 작업을 한국어로 3줄 이내로 요약해줘. ' +
      '무엇을 했는지 한두 줄, 사용자가 확인하거나 직접 해야 할 게 남았으면 마지막 한 줄로. ' +
      '머리말·인사·코드블록 없이 핵심만.';

    return new Promise((resolve) => {
      const args = ['--resume', sessionId, '--print', '--output-format', 'json', '--input-format', 'stream-json', '--verbose'];
      let child: ChildProcess;
      try {
        child = spawn(CLAUDE_BIN(), args, {
          cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          // POSIX 프로세스 그룹 리더로 — 아래 done() 이 killTree 로 회수하는데, detached 없이는
          //   `-pid` 그룹 킬이 ESRCH 로 떨어져 claude 손자(MCP 서버·worker)가 mac/linux 에서 살아남는다.
          ...processGroupSpawnOptions(),
          env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', PYTHONIOENCODING: 'utf-8' },
        });
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
        return;
      }
      registerSpawnedPid(child.pid);
      child.once('exit', () => unregisterSpawnedPid(child.pid));
      // §5.5 #17-18 과 같은 사유 — stdin 오류(`write-after-end`·`EPIPE`)는 write() 를 감싼 try/catch 를
      //   지나쳐 stream 의 `error` 이벤트로 온다. 듣는 사람이 없으면 메인 프로세스 uncaughtException 이
      //   되어 그 순간 돌던 체인을 끊는다. 여기서 받아 로그로만 남기고 마무리는 close/timeout 에 맡긴다.
      child.stdin?.on('error', (err: Error) => {
        logger.warn(`summarizeSession stdin error: ${err.message} — child is going down`);
      });

      let stdout = '';
      let settled = false;
      const done = (r: { ok: boolean; text?: string; error?: string }): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // 결과는 이미 캡처됨 — 직접 자식만 죽이면 claude 손자(node worker/MCP)가 고아로 남는다. 트리째 회수.
        killTree(child.pid);
        unregisterSpawnedPid(child.pid);
        resolve(r);
      };
      const timer = setTimeout(() => done({ ok: false, error: 'timeout' }), 30_000);

      try {
        const inputLine = JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: prompt }] },
        }) + '\n';
        child.stdin?.setDefaultEncoding('utf8');
        child.stdin?.write(inputLine, 'utf8');
        child.stdin?.end();
      } catch { /* stdin 실패는 close 에서 처리 */ }

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.on('error', (err) => { noteClaudeSpawnFailure(err); done({ ok: false, error: err.message }); });
      child.on('close', () => {
        // `--output-format json` = 마지막에 result 객체 1개. 여러 줄일 수 있어 result 타입만 추출.
        let text = '';
        for (const line of stdout.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const obj = JSON.parse(trimmed) as Record<string, unknown>;
            if (typeof obj['result'] === 'string') text = obj['result'] as string;
            else if (obj['type'] === 'result' && typeof obj['result'] === 'string') text = obj['result'] as string;
          } catch { /* 부분 라인 무시 */ }
        }
        text = text.trim();
        if (text) done({ ok: true, text });
        else done({ ok: false, error: 'empty' });
      });
    });
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

  /** 이 sub 가 **지금 한 턴(명령)을 실제로 처리 중**인가 — `isSubRunning` 보다 좁다.
   *  `isSubRunning` 은 idle 로 대기하는 persistent 자식(명령 사이 살아만 있는)도 true 라
   *  완료 판정 가드로 쓰면 부모가 영영 completed 로 못 간다. 이 술어는 "처리 중"만 잡는다:
   *   - persistent: in-flight 명령 보유(`persistentInFlightCmd`).
   *   - local(All Model): in-flight 턴 보유(`localInFlightCmd`) — 자식이 없어 다른 근거가 없다.
   *   - legacy: 자식 생존 && persistent-ready 가 아님(legacy 자식은 명령 동안만 존재).
   *   - agent-view: watcher 보유.
   *  용도 — `recomputeCustomAgentStatus` 가 sub.status 가 순간 비활성으로 읽혀도(예: result 직후
   *  finalize→idle 과 다음 명령 dispatch 사이) 자식이 아직 턴을 돌리는 중이면 부모를 완료로
   *  강등하지 않게 한다(= 헤드리스 감독관 조기 완료 차단). idle 대기 자식은 여기서 제외되므로
   *  진짜 끝났을 때는 정상적으로 완료된다. */
  isSubProcessingCommand(subId: string): boolean {
    if (this.persistentInFlightCmd.has(subId)) return true;
    // 로컬(All Model): 러너가 한 턴을 도는 중. persistent 의 in-flight 와 **같은 뜻**이라 같은 자리에 둔다.
    if (this.localInFlightCmd.has(subId)) return true;
    if (this.runningAgentViewWatchers.has(subId)) return true;
    if (this.runningChildren.has(subId) && this.persistentChildReady.get(subId) !== true) return true;
    return false;
  }

  /** §5.3 #12-1 v3.43 — sessionId 로 managed sub 역조회 (훅 이벤트의 소유 에이전트 해석용).
   *  isManagedSession 과 동일 스캔 — index 는 수십 건 규모라 훅 이벤트당 비용 무시 가능. */
  findSubBySessionId(sessionId: string): SubAgent | undefined {
    if (!sessionId) return undefined;
    for (const s of this.index.values()) {
      if (s.sessionId === sessionId || s.agentViewSessionId === sessionId) return s;
    }
    return undefined;
  }

  /** §5.5 #17-9 ③(c) v4.95 — termId 로 세션 탭(sub) 역조회.
   *  CMD(인터랙티브 터미널) 세션은 JSONL 파이프가 없어 `sub.sessionId` 가 끝내 비어 있으므로
   *  `findSubBySessionId` 로는 소유 탭이 항상 미상이다. 훅이 실어 오는 `_vibisualOwnerTermId`
   *  (끝 토큰 = sub.id)로 푸는 폴백 — `markCmdSubActivity` 와 같은 조회를 재사용한다. */
  findSubByTermId(termId: string): SubAgent | undefined {
    const parsed = parseTermId(termId);
    if (!parsed) return undefined;
    return this.index.get(parsed.sessionToken);
  }

  /** §5.3 #12-1 v3.43 — 부모의 Task/Agent PreToolUse: 백그라운드 서브에이전트 대차대조 ↑.
   *  `ownerSubId` 는 이 Task 를 띄운 세션 탭(sub) — 그 탭 도트를 대차대조와 함께 구동한다.
   *  @returns sub 도트 상태가 바뀌었으면 true (호출자 broadcast 판단용). */
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
    // 소유 세션 역조회가 실패하면(훅이 `session_id`/termId 로 탭을 못 풀 때) 그 자식은 **주인이 없는 채**
    //   장부에 오른다. 그러면 부모 버블만 active 로 오르고 **그 탭 도트는 계속 꺼져 있어**, 자식이 도는
    //   내내 세션이 끝난 것처럼 보였다(사용자 보고). 지금 한 턴을 처리 중인 탭이 딱 하나면 그 탭이
    //   주인일 수밖에 없으므로 그리로 귀속한다 — 둘 이상이면 추측하지 않고 미상으로 둔다.
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

  /**
   * 이 에이전트에서 **지금 한 턴을 처리 중인 탭이 딱 하나면** 그 id — 아니면 `undefined`.
   *
   * 훅이 소유 세션을 못 풀었을 때의 폴백 근거다. 자식을 띄우는 것은 "지금 도는 턴"이므로,
   * 도는 탭이 하나뿐이면 그 탭이 주인인 것이 확실하다. 둘 이상이면 **추측하지 않는다** —
   * 남의 탭에 자식을 붙이면 그 탭 도트가 거짓으로 켜지고, 그건 안 켜지는 것보다 나쁘다.
   */
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
   * §5.3 #12-1 — 백그라운드 대차대조를 **세션 탭(sub) 도트에도** 반영.
   *
   * 배경: v3.43 대차대조는 부모 **버블**만 active 로 유지했다. 부모(감독관) 턴이 끝나면
   * `_finalizeLegacyCommand` 가 sub.status 를 idle 로 내리므로, 자식이 백단에서 도는 동안
   * 버블은 동작 이펙트인데 **탭 도트만 녹색(idle=완료·미확인)** 으로 어긋났다. v2.64 의
   * `markCmdSubActivity`(CMD 탭 도트 연속 동기화)와 같은 부류의 누락 — 여기서 메운다.
   *
   * pending 이 걸린 sub 는 active 로 올리고(그 사실을 `bgPromotedSubs` 에 표식), pending 이
   * 비면 **표식이 있는 sub 만** idle 로 되돌린다. 실제 명령을 처리 중인 sub 는
   * `isSubProcessingCommand` 로 보호 — 진행 중인 턴을 거짓 idle 로 세탁하지 않는다.
   *
   * @returns 하나라도 바뀌었으면 true (호출자 broadcast 판단용).
   */
  private syncBgSubStatus(parentAgentId: string): boolean {
    const m = this.pendingSubagentTasks.get(parentAgentId);
    const pendingSubIds = new Set<string>();
    if (m) {
      for (const e of m.values()) {
        if (e.subId) pendingSubIds.add(e.subId);
      }
    }
    // 스트림으로만 보이는 백그라운드 작업(`Bash run_in_background` · `Monitor`)을 가진 탭도
    //   같은 자격이다 — 그 탭은 자기 턴이 끝났어도 그 작업이 끝나면 다시 깨어난다.
    for (const [subId, state] of this.turnSealStates) {
      if (this.index.get(subId)?.parentAgentId !== parentAgentId) continue;
      if (listDisplayableLiveTasks(state).length > 0) pendingSubIds.add(subId);
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

  /** §5.3 #12-1 v3.43 — SubagentStop: 대차대조 ↓. 서브의 parent_tool_use_id 가 부모 Task 의
   *  tool_use_id 와 같아 그걸로 매칭, id 미상(구버전 페이로드)이면 최고령 항목 회수.
   *  @returns drained = 이 감소로 pending 이 0 이 됐다(호출자가 즉시 recompute 해 진짜 완료를 반영),
   *           subChanged = 세션 탭 도트가 바뀌었다(호출자 broadcast 판단용). */
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
      // **id 를 들고 왔는데 우리 장부에 없다** = 이미 정리된 옛 턴의 자식이다(사용자가 [중지]로 끊었거나
      //   덧말 `즉시` 가 그 턴을 갈아치웠다 — 그때 `clearPendingSubagentTasksForSession` 가 장부를 비운다).
      //   여기서 아래 최고령 폴백으로 떨어지면 **지금 턴이 방금 띄운 자식을 대신 지워** 그 자식의 카드에
      //   남의 결과를 붙인다(사용자 보고: "뒤섞여서 뭐가 어떤 작업인지 모른다"). 모르는 id 는 버린다.
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
   * §5.5 #17-9 ⑦(a) — **자식 안에서 난 도구 이벤트**를 그 자식의 대차대조 항목에 얹는다.
   *
   * 공식 훅 공통 입력 필드 `agent_id` 는 서브에이전트 안에서 훅이 발화할 때만 존재하고, 그 이벤트는
   * 부모와 **같은 `session_id`** 로 도착한다(우리 SubagentStop 귀속이 이미 그 사실 위에 서 있다).
   * 그래서 새 수집 경로 없이 "지금 무슨 도구를 무엇에 대고 쓰는지"를 알 수 있다.
   *
   * 어느 항목의 자식인지는 세 단계로 푼다:
   *   ① 이미 같은 `agentId` 가 각인된 항목 (한 번 붙으면 그 뒤로는 항상 여기서 끝난다)
   *   ② `agent_type` 이 그 항목의 `subagent_type` 과 같고 아직 각인 전인 것 중 최고령
   *   ③ 그래도 없으면 각인 전 항목 중 최고령
   * 셋 다 실패하면 아무것도 하지 않는다(남의 자식을 아무 카드에나 붙이지 않는다).
   *
   * @returns 표시가 실제로 바뀌었으면 true (호출자 broadcast 판단용).
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
   * §5.5 #17-9 ⑦(b) — `PostToolUse(Task|Agent)` 로 도착한 **자식의 최종 보고**를 보관한다.
   *
   * 순서상 `SubagentStop`(대차대조 ↓)이 먼저 오고 이 이벤트가 뒤따르므로, 대개 대상은 이미 "끝난 것"
   * 목록에 있다. 그래도 아직 pending 이면(SubagentStop 유실) 여기서 내려 준다 — 결과가 왔다는 것은
   * 그 자식이 확실히 끝났다는 뜻이기 때문이다.
   *
   * ⑧ **예외 — 배경 스폰**(`run_in_background: true`): 이 도구는 자식을 띄우자마자 반환하므로
   * 여기 오는 `tool_response` 는 최종 보고가 아니라 **"띄웠다" 접수증**이다. 그걸 완료로 읽으면
   * 항목이 수 밀리초 만에 내려가 자식이 도는 내내 활동바가 `(0)` 이 된다(사용자 보고). 배경
   * 항목은 내리지 않고 "살아 있다" 신호만 갱신하며, 내리는 것은 `SubagentStop` 하나다.
   *
   * @param background 이 `PostToolUse` 가 배경 스폰의 것이었나(`tool_input.run_in_background`).
   *                   항목에 이미 표식이 있으면 그쪽이 우선 — 인자는 표식이 없는 항목의 폴백이다.
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
  private archiveSubagentTask(parentAgentId: string, id: string, e: PendingSubagentEntry, result?: string): void {
    // §5.5 #17-9 ⑦(b) 확장 — 결과를 못 받고 내려가는 항목은 **디스크에서 한 번 건져 본다**.
    //   훅(`SubagentStop` / `PostToolUse`)은 자식이 제 발로 끝났을 때만 오므로, 프로세스 트리가
    //   끊긴 자리(사용자 [중지] · 탭 닫기 · 크래시)에서는 결과 칸이 영영 빈다 — 정작 자식이 해 놓은
    //   일은 트랜스크립트로 온전히 남아 있는데도. `subagentResultRescue.ts` 머리말의 실측 참조.
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

  /**
   * §5.5 #17-9 ⑦(b) 확장 — 훅으로 끝내 오지 않은 자식의 최종 보고를 그 세션의 트랜스크립트에서 건진다.
   *
   * 세션을 아는 항목(`subId`)만 시도한다 — 소유 세션이 미상이면 어느 세션의 `subagents/` 를 뒤져야
   * 할지 알 수 없고, 남의 자식 보고를 이 카드에 붙이는 것이 빈 카드보다 나쁘다(§5.5 #17-9: "뒤섞여서
   * 뭐가 어떤 작업인지 모른다"). 실패는 조용히 `undefined` — 종전과 같은 빈 카드로 돌아갈 뿐이다.
   */
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

  /** §5.3 #12-1 v3.43 — 그 외 훅 이벤트 = 살아있다는 신호. quiet-window 기준 시각만 갱신(pending 없으면 no-op). */
  noteSubagentSignal(parentAgentId: string): void {
    if (this.pendingSubagentTasks.has(parentAgentId)) {
      this.pendingSubagentLastSignal.set(parentAgentId, Date.now());
    }
  }

  /**
   * §5.3 #12-1 v3.43 — 완료 강등 차단 술어: 이 에이전트가 스스로 띄운 서브에이전트가 아직 도는가.
   *
   * **조용함은 죽음의 증거가 아니다.** 종전에는 항목별 30분 quiet-window 로 "이만큼 조용하면 끝난
   * 걸로 친다"고 추정했는데, 자식은 긴 빌드·패키징·폴링·대기로 얼마든지 조용할 수 있어서 그 추정은
   * **멀쩡히 도는 자식을 끝난 것으로** 만든다(사용자 지시: "루프 대기 중일 수도 있잖아, 시간으로
   * 잡아내면 엄청난 문제가 생긴다"). 그 창은 폐기했다 — 자동 회수의 근거는 **실제 종료 신고**
   * (`SubagentStop`/`PostToolUse`)와 그 자식을 담고 있던 **세션 프로세스의 소멸**
   * (`sweepOrphanedBackgroundTasks`) 둘뿐이고, 둘 다 추정이 아니라 사실이다.
   *
   * 남는 시간 기준은 **소유 탭이 미상이라 프로세스로 판정할 길이 아예 없는 항목**의 절대 상한
   * 하나뿐이다(외부 훅 세션이 띄운 자식 — 우리는 그 프로세스를 모른다). 이것은 "끝났다는 판정"이
   * 아니라 장부가 무한히 자라지 않게 하는 마지막 누수 방지이며, 프로세스를 아는 항목에는 적용되지
   * 않는다.
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

  /**
   * §5.5 #17-9 v3.51 — 대차대조(pendingSubagentTasks)를 IDE 표시용 스냅샷으로 투영.
   * 실행 중인 항목이 하나도 없으면 `undefined` 를 돌려 스냅샷 필드 자체를 생략한다
   * (클라 활동바 항목/배지가 자동으로 사라지는 근거). 런타임 전용 — 체크포인트에 담지 않는다.
   */
  getRunningSubagentTasks(): Record<string, RunningSubagentTask[]> | undefined {
    // **이 함수는 읽기만 한다.** 장부를 걷는 일은 `sweepOrphanedBackgroundTasks` 한 곳이 하고,
    //   그 호출자(5초 대조 루프)가 세션 도트·부모 버블 재계산·broadcast 까지 한 벌로 끝낸다.
    //   여기서 걷으면 **한 스냅샷 안에서 어긋난다** — 부모 버블(`agents`)은 이 객체를 조립하기 전에
    //   이미 계산돼 있어서, 목록만 0 이 되고 버블은 여전히 도는 중인 채로 나간다.
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

  /**
   * 스트림 칩(`task_started`)으로만 보이는 백그라운드 작업을 부모별로 모은다.
   *
   * 훅 대차대조(`pendingSubagentTasks`)는 `PreToolUse(Task|Agent)` 만 보므로
   * `Bash run_in_background` · `Monitor` 처럼 **도구가 Task 가 아닌** 백그라운드 작업은 잡지 못한다.
   * 그 작업들은 CLI 가 스트림에 흘리는 칩으로만 존재하고, 종전에는 그 신호가 봉인을 3초 미루는 데만
   * 쓰였다 — 그래서 그것을 기다리는 세션이 화면에서 완료로 보였다(사용자 보고).
   */
  private collectLiveBackgroundTasks(): Map<string, RunningSubagentTask[]> {
    const byParent = new Map<string, RunningSubagentTask[]>();
    for (const [subId, state] of this.turnSealStates) {
      const sub = this.index.get(subId);
      if (!sub) continue;
      for (const { id, info } of listDisplayableLiveTasks(state)) {
        const list = byParent.get(sub.parentAgentId) ?? [];
        list.push({
          id,
          parentAgentId: sub.parentAgentId,
          subAgentId: sub.id,
          ...(info.description ? { description: info.description } : {}),
          startedAt: info.startedAt,
          origin: 'stream',
        });
        byParent.set(sub.parentAgentId, list);
      }
    }
    return byParent;
  }

  /**
   * 이 세션의 스트림 기반 백그라운드 작업 장부를 비운다 — **사용자가 그 턴을 끊었을 때**.
   *
   * 끊긴 자식들은 프로세스 트리와 함께 죽으므로 끝 통지(`task_notification`)가 오지 않는다.
   * 비우지 않으면 그 항목이 유령으로 남아 다음 턴에 섞여 든다(실행 목록에 남의 작업이 뜨고,
   * 버블이 완료로 못 가고, 봉인도 계속 미뤄진다). `deliveredNotices` 도 함께 초기화한다 —
   * 끊긴 턴이 남긴 통지 셈을 다음 턴이 물려받을 이유가 없다.
   */
  private clearLiveBackgroundTasks(subAgentId: string): void {
    const state = this.turnSealStates.get(subAgentId);
    if (!state) return;
    if (state.liveTasks.size === 0 && state.deliveredNotices === 0) return;
    logger.info(`[bg-subagent] clearing ${state.liveTasks.size} live stream task(s) for stopped sub=${subAgentId}`);
    state.liveTasks.clear();
    state.deliveredNotices = 0;
  }

  /**
   * **이 세션의 프로세스가 끝났다** — 그 자식인 백그라운드 작업도 함께 끝났다는 뜻이므로 장부에서 내린다.
   *
   * 이것이 **주 경로**다. 추정이 아니라 규약이다: `claude -p` 는 최종 결과를 낸 뒤 **약 5초에 배경 Bash
   * 셸을 종료한다**(공식 문서 "Background tasks at exit"). 즉 그 작업들은 우리 자식 프로세스보다 오래
   * 살 수 없고, 프로세스 종료 이벤트가 곧 그것들의 실제 종료 시점이다. 배경 **서브에이전트**는 예외로
   * `claude -p` 가 끝날 때까지 기다려 주므로(기본 상한 10분), 그것이 도는 동안에는 프로세스가 살아 있고
   * 이 함수도 불리지 않는다 — 두 규약이 정확히 우리 판정과 같은 방향이다.
   *
   * 끝 통지(`task_notification`)를 받아 이미 내려간 항목은 여기 남아 있지 않으므로, 남은 것만 꼬리로
   * 옮긴다(소리 없이 사라지지 않게).
   *
   * @returns 실제로 내린 것이 있으면 true.
   */
  retireLiveBackgroundTasks(subAgentId: string, now: number = Date.now()): boolean {
    const state = this.turnSealStates.get(subAgentId);
    if (!state || state.liveTasks.size === 0) return false;
    const sub = this.index.get(subAgentId);
    for (const [id, info] of state.liveTasks) {
      logger.info(`[bg-subagent] session process ended — retiring live stream task sub=${subAgentId} key=${id} desc=${info.description ?? '-'}`);
      if (sub) this.archiveStreamTask(sub.parentAgentId, subAgentId, id, info, now);
    }
    state.liveTasks.clear();
    state.deliveredNotices = 0;
    if (sub) this.syncBgSubStatus(sub.parentAgentId);
    return true;
  }

  /** 스트림 칩 1건을 "방금 끝난 것" 꼬리로 옮긴다 — 훅 항목의 `archiveSubagentTask` 와 짝. */
  private archiveStreamTask(
    parentAgentId: string,
    subAgentId: string,
    id: string,
    info: LiveTaskInfo,
    endedAt: number,
  ): void {
    this.pushFinishedTask(parentAgentId, {
      id,
      parentAgentId,
      subAgentId,
      ...(info.description ? { description: info.description } : {}),
      startedAt: info.startedAt,
      endedAt,
    });
  }

  /**
   * 지금 **끊기면 잃는 일**의 요약 — 앱을 닫기 전에 물어볼지 판단하는 근거.
   *
   * 헤드리스 자식은 우리 프로세스의 자식이라 앱이 내려가면 함께 죽는다. 대화 자체는 `sub.sessionId`
   * 로 남아 다음 턴이 `--resume` 으로 잇지만(그 재개는 부팅 reconcile 이 자동으로 한다),
   * **커밋 전 편집처럼 그 턴이 만들던 결과물은 돌아오지 않는다.** 그러니 닫기 전에 한 번 묻는 것이
   * 유일한 예방이다 — 판정은 여기서 사실로 내고, 묻는 것은 데스크톱 쪽이 한다.
   */
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
   * 실행 중 목록에서 **그 항목 하나만** 내린다 — 사용자가 "이건 더 안 기다린다"고 판단했을 때.
   *
   * **프로세스를 죽이는 것이 아니다.** CLI 는 개별 자식을 밖에서 끊는 수단을 주지 않으므로(끊는 것은
   * 그 자식을 띄운 에이전트 자신이 `TaskStop` 으로 한다), 여기서 하는 일은 **우리 장부에서 내리는 것**
   * 뿐이다. 그래야 그 세션·버블이 완료로 갈 수 있고 [중지]가 헛돌지 않는다. 유일한 대안이 "세션 전체를
   * 끊기"뿐이라 멀쩡한 형제 작업까지 죽여야 했던 자리를 메운다.
   *
   * 훅 장부와 스트림 칩 장부 **양쪽**에서 찾는다(사용자에게는 같은 목록의 한 줄이다).
   * @returns 실제로 내렸으면 true.
   */
  dismissRunningTask(parentAgentId: string, taskId: string): boolean {
    const m = this.pendingSubagentTasks.get(parentAgentId);
    const hit = m?.get(taskId);
    if (m && hit) {
      m.delete(taskId);
      // 결과 없이 "방금 끝난 것" 꼬리로 옮긴다 — 소리 없이 사라지면 사용자가 무엇이 사라졌는지 모른다.
      this.archiveSubagentTask(parentAgentId, taskId, hit, undefined);
      if (m.size === 0) this.pendingSubagentTasks.delete(parentAgentId);
      logger.info(`[bg-subagent] dismissed by user parent=${parentAgentId} key=${taskId}`);
      this.syncBgSubStatus(parentAgentId);
      return true;
    }
    // 스트림 칩 쪽 — 이 에이전트에 속한 sub 들의 장부를 훑어 같은 id 를 내린다.
    for (const [subId, state] of this.turnSealStates) {
      if (this.index.get(subId)?.parentAgentId !== parentAgentId) continue;
      if (!state.liveTasks.delete(taskId)) continue;
      logger.info(`[bg-subagent] dismissed stream task by user parent=${parentAgentId} sub=${subId} key=${taskId}`);
      this.syncBgSubStatus(parentAgentId);
      return true;
    }
    return false;
  }

  /**
   * **프로세스가 사라진 세션에 남은 백그라운드 작업 표시를 걷는다** — 끝 통지가 영영 오지 않는 자리.
   *
   * 배경(사용자 보고 — "명령은 한참 전에 끝난 것 같은데 계속 활동 중으로 떠 있다"). 백그라운드 작업
   * (`Bash run_in_background` · `Monitor` · `Task` 자식)은 그 세션 CLI 프로세스의 자식이라 **프로세스가
   * 죽으면 함께 죽는다**. 그런데 그 죽음은 `task_notification` 이나 `SubagentStop` 으로 오지 않는다 —
   * 통지를 보낼 CLI 가 이미 없기 때문이다. 그래서 장부에 남은 시작 기록이 유령이 되고, 그 유령이
   * `hasLiveBackgroundTasks`/`hasPendingSubagentTasks` 를 타고 세션 도트와 **부모 버블까지 active 로
   * 붙들었다**.
   *
   * **이 함수는 그물이지 주 경로가 아니다.** 정상 경로는 둘이고 둘 다 이벤트다 — 끝 통지
   * (`task_notification`)를 받거나, 그 세션의 **프로세스 종료 이벤트**에서 `retireLiveBackgroundTasks`
   * 가 내린다. 여기 남는 것은 그 두 이벤트를 **놓친** 자리뿐이다(앱 재시작으로 장부만 복원됐거나,
   * 종료 이벤트가 유실됐거나, 우리가 스폰하지 않은 세션).
   *
   * **끝 통지는 정상적으로 온다 — 못 오는 경우만 여기서 다룬다.** 실측(2026-08-14, P_MPS_GPT
   * 69개 세션 스트림)에서 시작 칩과 끝 칩은 대부분 정확히 짝을 이뤘다(예: 한 세션 16/16, 다른
   * 세션 228/223). CLI 는 `[task_notification] {"status":"completed","summary":"… exit code 0"}` 로
   * 확실히 알려 준다. 짝이 안 맞는 것은 **그 통지가 도착하기 전에 세션이 끝난** 경우뿐이다 —
   * 통지는 다음 턴 경계에 실려 오는데 그 턴이 마지막이면 실어 보낼 자리가 없다.
   *
   * 그래서 **시간으로는 판정하지 않는다.** 종전 안전판(스트림 칩 4시간 · 훅 30분 quiet-window)은
   * 전부 폐기했다 — 백그라운드 작업은 몇 시간짜리 패키징이거나 끝을 정하지 않은 폴링일 수 있어,
   * 조용하거나 오래됐다는 이유로 걷으면 **도는 작업을 끝난 것으로** 표시한다(사용자 지시). 여기서
   * 쓰는 근거는 사실 하나다: 그 세션에 프로세스가 없으면 그 자식인 작업도 없다.
   *
   * 판정 제외는 `reconcileDeadActiveSubs` 와 **같은 목록**이다(두 곳이 갈리면 한쪽이 거짓말한다).
   * 소유 탭이 미상인 훅 항목은 어느 세션의 프로세스를 봐야 할지 알 수 없으므로 건드리지 않는다 —
   * 그쪽만 절대 상한(`PENDING_SUBAGENT_MAX_AGE_MS`)이 누수를 막는다.
   *
   * @returns 정리가 일어난 부모 에이전트 id 목록(호출자의 broadcast·상태 재계산 판단용).
   */
  sweepOrphanedBackgroundTasks(now: number = Date.now()): string[] {
    const touched = new Set<string>();

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
        this.archiveStreamTask(sub.parentAgentId, subId, id, info, now);
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
   * 이 에이전트가 **스트림으로만 보이는 백그라운드 작업**을 기다리는 중인가.
   * 버블 완료 판정이 훅 대차대조와 함께 이 신호도 봐야 "끝난 걸로 착각"이 사라진다.
   */
  hasLiveBackgroundTasks(parentAgentId: string): boolean {
    for (const [subId, state] of this.turnSealStates) {
      if (this.index.get(subId)?.parentAgentId !== parentAgentId) continue;
      if (listDisplayableLiveTasks(state).length > 0) return true;
    }
    return false;
  }

  /** §5.3 #12-1 v3.43 — 사용자 중지/에이전트 정리 시 대차대조 즉시 해제(잔존 활성 고착 방지). */
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
   * §5.5 #17-10 v3.53 — **세션 스코프** 대차대조 해제. 그 세션 탭(`subId`)이 띄운 항목만 지운다.
   *
   * 종전 세션 1개 중지가 `clearPendingSubagentTasks(parentAgentId)` 로 **부모 전체** 대차대조를 지워,
   * 한 탭을 멈추면 다른 탭이 띄운 백그라운드 서브에이전트 표시·활성 판정까지 함께 사라졌다.
   * 소유 세션이 미상(`subId` 없음)인 항목은 어느 탭 것인지 알 수 없으므로 **건드리지 않는다**
   * (다른 탭 것을 오삭제하느니 quiet-window 안전장치에 맡긴다).
   *
   * @returns 실제로 지운 항목 수.
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

  /** v1.77 (Direction A) — sessionId 가 Vibisual 이 스폰한 sub 의 세션이면 true.
   *  모든 훅 캡처 입구(session-start / liveness / processHookEvent)에서 이 술어로
   *  "managed 세션은 새 훅 버블 금지, 부모 커스텀 버블에 귀속" 을 강제 → 증식 차단.
   *  Vibisual 이 직접 스폰한 세션만 매칭하므로 사용자 인터랙티브 세션(나=Claude Code)은
   *  영향 없음. agentViewSessionId 도 포함(레거시 --bg 잔여 호환). */
  isManagedSession(sessionId: string): boolean {
    if (!sessionId) return false;
    for (const s of this.index.values()) {
      if (s.sessionId === sessionId || s.agentViewSessionId === sessionId) return true;
    }
    return false;
  }

  /** v1.77 (Direction A) — 커스텀 에이전트의 "정규(하나의) 대화 sub".
   *  이미 대화가 성립된 sub(sessionId 보유)를 최우선, 없으면 가장 오래된 sub.
   *  커스텀 에이전트는 명령마다 새 sub 를 만들지 않고 이 하나를 계속 재사용해야
   *  sub.sessionId 가 안정되고 `--resume` 연속성이 유지된다(없으면 undefined → 호출자 create). */
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
        return item;
      });
      this.registry.set(agentId, items);
      const dir = project ? streamBufferStore.subStreamsDir(project, agentId) : null;
      for (const s of items) {
        this.index.set(s.id, s);
        if (dir && !this.streamBuffers.has(s.id)) {
          const buf = streamBufferStore.loadBuffer(dir, s.id, MAX_STREAM_BUFFER);
          if (buf.length > 0) this.streamBuffers.set(s.id, buf);
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
   * **실행 표시를 실제 프로세스 생존과 대조한다** — 화면이 "돌고 있다"고 말하는데 아무것도 안 도는
   * 상태를 걷어 내는 자리.
   *
   * `sweepIdle` 은 이 일을 **시간**으로만 했다(5분 무활동). 그래서 어떤 경로가 `active` 를 남긴 채
   * 자식을 잃으면 최대 5분 동안 화면이 거짓말을 했고, 그동안 [중지]는 멈출 게 없는 헛버튼이었다.
   * 여기서는 **사실**로 판정한다 — 자식도 워처도 없고, 처리 중인 턴도, 붙들어 둔 봉인도, 이 탭이
   * 띄운 백그라운드 자식도 없으면 그 세션은 끝난 것이다.
   *
   * 잘못 강등하지 않기 위한 제외가 셋이다:
   *  - **PTY(CMD) 세션** — 우리가 띄운 자식이 아니라 사용자가 치는 터미널이다(`cmdDrivenSubs`).
   *    이 탭들의 상태는 훅이 몰고 가므로(`markCmdSubActivity`) 자식 유무로 판단할 수 없다.
   *  - **스폰 진행 중** — `active` 를 올린 직후 자식/워처 등록 전의 창(`dispatchingSubs`).
   *  - **붙들어 둔 잠정 봉인** — 곧 이어질 수 있는 턴이라 우리가 일부러 끝을 미뤄 둔 것이다.
   *
   * @returns 강등된 sub.id 목록(호출자 broadcast 판단용).
   */
  reconcileDeadActiveSubs(): string[] {
    const demoted: string[] = [];
    for (const sub of this.index.values()) {
      if (sub.status !== 'active') continue;
      if (this.cmdDrivenSubs.has(sub.id)) continue;
      if (this.dispatchingSubs.has(sub.id)) continue;
      if (this.deferredSeals.has(sub.id)) continue;
      // 자식·워처가 살아 있거나 한 턴을 처리 중이면 진짜로 도는 중이다.
      if (this.isSubRunning(sub.id) || this.isSubProcessingCommand(sub.id)) continue;
      // 자기 턴은 끝났어도 이 탭이 띄운 백그라운드 Task 가 남아 있으면 여전히 활동 중이다
      // (`syncBgSubStatus` 가 올려 둔 그 active 를 여기서 도로 내리면 도트가 깜빡인다).
      if (this.bgPromotedSubs.has(sub.id)) continue;
      // 스트림으로만 보이는 백그라운드 작업도 같은 자격 — 끝나면 이 세션이 다시 깨어난다.
      const seal = this.turnSealStates.get(sub.id);
      if (seal && listDisplayableLiveTasks(seal).length > 0) continue;

      sub.status = 'idle';
      sub.lastActivityAt = Date.now();
      demoted.push(sub.id);
      logger.info(`SubAgent ${sub.id} was 'active' with no live process — reconciled to idle`);
    }
    return demoted;
  }

  /**
   * §2.4 (잠듦) — **유휴가 길어진 세션의 claude 자식 프로세스를 회수한다.**
   *
   * persistent-child 모델(§5.3)은 다음 턴의 부팅 비용을 없애려고 자식을 살려 두는데, 그 "다음 턴"이
   * 영영 오지 않는 세션도 앱을 켜 둔 내내 자리를 차지했다(실측: 세션 11개 약 5.5GB, CPU 전부 0%).
   * 유휴가 길어지면 프롬프트 캐시가 이미 만료돼(서브에이전트는 구독에서도 5분 TTL) 살려 둬서 아끼는
   * 것은 부팅·JSONL 재로드·MCP 재연결(수 초)뿐이고, 그 대가가 세션당 500MB 안팎이다.
   *
   * **사용자가 잃는 것은 없다** — 대화는 디스크 JSONL 에 있고 `sub.sessionId` 를 그대로 두므로, 다음
   * 명령이 기존 크래시 복구 경로와 **같은** `--resume` fresh spawn 으로 이어 간다(새 복귀 경로 ❌).
   * 종료는 반드시 **의도된 것으로 마킹**한다(`intentionalKill`) — 안 하면 close 핸들러가 크래시로 읽어
   * 멀쩡히 끝난 세션을 `error` 로 물들인다.
   *
   * 제외는 `reconcileDeadActiveSubs` 와 **같은 사실 목록**에 백그라운드 한 항목을 더한 것이다. 그
   * 마지막 항목이 핵심인데, `--resume` 은 대화는 되살려도 **백그라운드 Bash·Monitor 작업은 복원하지
   * 않는다**(공식 문서 "Background Bash and monitor tasks aren't"). 그것을 무시하고 회수한 Claude
   * Desktop 은 "작업이 조용히 죽는데 화면엔 running 으로 남는" 버그를 안았다(claude-code#68625) —
   * 그 자리를 처음부터 피한다.
   *
   * @param thresholdMs 마지막 활동으로부터 이만큼 지나면 회수(`SUBAGENT_DORMANT_IDLE_MS`).
   * @param hasPendingWork 이 sub 가 곧 쓸 자식인가 — 대기 중인 명령이나 켜져 있는 반복 명령(루프).
   *                       매니저는 큐도 루프도 모르므로(§3.4 의존성 방향) 호출자가 주입한다.
   * @returns 재운 sub.id 목록(호출자 broadcast 판단용).
   */
  sweepDormantIdleSubs(thresholdMs: number, hasPendingWork?: (subId: string) => boolean): string[] {
    const now = Date.now();
    const slept: string[] = [];
    for (const sub of this.index.values()) {
      if (sub.dormant) continue;
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
      if (this.bgPromotedSubs.has(sub.id)) continue;
      const seal = this.turnSealStates.get(sub.id);
      if (seal && listDisplayableLiveTasks(seal).length > 0) continue;
      // 훅이 소유 세션을 못 푼 자식(`subId` 미상)은 **누구의 것인지 모른다**(§5.5 #17-9 ③(c) —
      //   session_id/termId 로 탭을 못 풀고 처리 중인 탭도 하나가 아니면 미상으로 남는 실재 경로).
      //   그럴 땐 이 부모의 **어느 세션도** 재우지 않는다 — 모르는 채 재우면 그 자식을 띄운 세션의
      //   프로세스를 뺏어 백단에서 돌던 서브에이전트가 통지도 없이 죽는다.
      const pending = this.pendingSubagentTasks.get(sub.parentAgentId);
      if (pending && [...pending.values()].some((e) => e.subId === undefined || e.subId === sub.id)) continue;

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
   * 마지막 활동 시각으로부터 thresholdMs 초과한 active/completed subagent → idle 전환.
   * 변경된 sub.id 목록 반환.
   */
  sweepIdle(thresholdMs: number): string[] {
    const now = Date.now();
    const changed: string[] = [];
    for (const sub of this.index.values()) {
      if (sub.status !== 'active' && sub.status !== 'completed') continue;
      // 거짓-완료 방지 — 살아있는 자식 프로세스/watcher 를 가진 sub 는 절대 idle 로 강등하지 않는다.
      // lastActivityAt staleness 는 추측이고 isSubRunning 은 확정 진실 — 확정이 이긴다.
      // (이 가드가 없으면 5분 넘게 도는 명령이 idle 처리되고 recomputeCustomAgentStatus 가
      //  그 idle 을 부모 커스텀 버블의 'completed' 로 세탁 → 동작 중인데 완료 거짓보고.)
      if (this.isSubRunning(sub.id)) continue;
      if (now - sub.lastActivityAt > thresholdMs) {
        sub.status = 'idle';
        changed.push(sub.id);
        // 성능: idle 로 강등된 sub 의 스트림 버퍼 메모리 회수. 디스크(streamBufferStore)에
        // 영속돼 있으므로 재오픈 시 getStreamBuffer(For Agent)/emitStreamEvent 가 복구한다.
        this.streamBuffers.delete(sub.id);
        // 지문도 함께 버린다 — 남기면 재오픈 때 "파일 그대로"로 판정해 회수한 과거를 못 읽어 온다.
        this.streamDiskStamps.delete(sub.id);
      }
    }
    return changed;
  }

  /**
   * §4 — CMD(인터랙티브 터미널) 세션 탭의 per-sub 상태를 그 세션의 redirect 된 hook 스트림으로
   * **연속 동기화**. termId(`term:<agentId>:<subId>`)로 그 탭의 sub 를 찾아 tool 이벤트→active,
   * Stop→idle(완료·미확인=녹색) 로 매긴다.
   *
   * 배경: CMD 에이전트의 hook 은 session_id 를 부모 CMD 버블 세션으로 rewrite 하므로
   * (`_vibisualOwnerAgentId`) 부모 버블만 active/idle 이 갱신되고 **각 세션 탭(sub)의 status 는
   * hook 과 연결돼 있지 않았다** → 탭 도트가 생성 시 idle(녹색) 에 멈춰, 동작 중에도 파란 active 로
   * 바뀌지 않던 버그. termId 의 끝 토큰이 곧 sub.id 라(`term:agentId:subId`) 이걸로 그 탭만 정확히
   * 구동한다. lastActivityAt 도 매 이벤트마다 갱신 → 5분 idle sweep 의 거짓-강등도 자연히 막힌다.
   *
   * @returns 상태가 바뀌었으면 true (호출자 broadcast 판단용).
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
   * §4 (CMD 터미널 업그레이드 ①) — 터미널 출력에서 읽어 낸 상태 신호를 **서버가 확정**한다.
   *
   * 클라(터미널 뷰)는 바이트 흐름만 보고 `working|idle|blocked` 를 *감지*해 올릴 뿐이고,
   * 무엇을 세울지는 여기서 정한다(§3.1 서버 = SSOT). `SubAgentStatus` 유니온은 늘리지 않는다 —
   * blocked 는 §2.4 '잠듦'(dormant)과 같은 **직교 플래그**다.
   *
   * - `working` : 바이트가 흐르는 중 → `status='active'` + blocked 걷기(훅 판본과 같은 결론).
   * - `blocked` : 사용자 입력을 기다리며 멈춤 → `status` 는 `active` 유지(세션은 살아 있다) +
   *   `blocked=true`. 훅이 없는 CLI(codex·gemini 등)도 이 경로로 상태가 보인다.
   * - `idle`    : 조용해진 지 오래 → `status='idle'`(단 `error` 는 보존 — 거짓 idle 세탁 금지).
   *
   * `cmdDrivenSubs` 표식은 `markCmdSubActivity` 와 **같은 이유**로 여기서도 붙인다(생존 대조·
   * 잠듦 회수 제외). 다만 `lastActivityAt` 은 실제 출력이 있었던 `working` 에서만 밀어 — idle
   * 판정이 자기 자신을 영원히 되살리는 것을 막는다.
   *
   * @returns 화면에 보이는 값이 하나라도 바뀌었으면 true(호출자 broadcast 판단용).
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

    if (state === 'working') {
      sub.lastActivityAt = Date.now();
      if (sub.blocked) {
        delete sub.blocked;
        delete sub.blockedSince;
        delete sub.blockedReason;
      }
      if (sub.status !== 'active') sub.status = 'active';
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
      if (sub.status === 'active') sub.status = 'idle';
    }

    return sub.status !== prevStatus || (sub.blocked === true) !== prevBlocked || sub.foregroundProcess !== prevProcess;
  }

  /** §4 (CMD ① QA) — 이 세션의 pane 별 감지 상태를 버린다(탭 닫기·아카이브 정리용). */
  forgetCmdPaneStates(subAgentId: string): void {
    this.cmdPaneStates.delete(subAgentId);
  }
  /**
   * §4 (CMD 터미널 업그레이드 ⑤) — 세션 탭의 pane 분할 트리를 갈아 끼운다.
   * 그 탭의 **표시 상태**라 체크포인트에 그대로 실린다(`getSnapshot` 이 SubAgent 를 통째 복제).
   * `null` 이면 단일 pane 으로 되돌린다.
   * @returns 실제로 바뀌었으면 true.
   */
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

  /** subagent 생성. preferredId 가 주어지면(클라이언트 optimistic create) 그 id 를 쓴다 — 충돌 시 무시. */
  create(parentAgentId: string, preferredId?: string): SubAgent {
    subCounter++;
    const id = preferredId && !this.index.has(preferredId)
      ? preferredId
      : `sub-${Date.now().toString(36)}`;
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
   * 서브에이전트 탭 닫기 — 소프트 아카이브.
   * 실행 중이면 SIGTERM으로 자식 종료 → 레지스트리/index/in-memory 스트림 버퍼에서 제거 →
   * 메타를 archive Map으로 이동. disk stream buffer는 유지(restore 시 재로드).
   * 제거(archive) 성공 시 true.
   */
  remove(subAgentId: string): boolean {
    const sub = this.index.get(subAgentId);
    if (!sub) return false;

    this.cmdPaneStates.delete(subAgentId);

    const child = this.runningChildren.get(subAgentId);
    if (child) {
      this.intentionalKill.add(subAgentId);
      // SIGTERM 은 직접 자식만 종료 → 남은 claude 손자 트리는 terminateChildTree 가 grace 후 회수.
      terminateChildTree(child);
      this.runningChildren.delete(subAgentId);
    }
    // 붙들어 둔 잠정 봉인은 **버리지 말고 지금 봉인**한다 — 안 그러면 그 명령이 executing 인 채로 남는다.
    this.flushDeferredSeal(subAgentId);
    this.turnSealStates.delete(subAgentId);
    // 생존 대조용 표식도 함께 회수 — 탭이 사라지면 남겨 둘 이유가 없다(누수 방지).
    this.cmdDrivenSubs.delete(subAgentId);
    this.dispatchingSubs.delete(subAgentId);
    this.currentTurnId.delete(subAgentId);
    // persistent maps cleanup — remove 시 sub 자체가 archive 되므로 turn-in-flight 추적도 폐기.
    this.persistentChildReady.delete(subAgentId);
    this.persistentLineBuf.delete(subAgentId);
    this.persistentInFlightCmd.delete(subAgentId);
    // 로컬 턴 표식도 같은 이유로 함께 — 남기면 사라진 탭이 부모 버블을 영영 "실행중"으로 붙든다.
    this.localInFlightCmd.delete(subAgentId);

    // §5.7 #23-2 v1.60 — agent-view 정리: supervisor 의 worker + worktree 도 함께 제거.
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

    logger.info(`SubAgent archived: ${subAgentId} (parent: ${sub.parentAgentId})`);
    return true;
  }

  /**
   * **도는 턴만 끊는다(soft interrupt) — 프로세스는 살려 둔다.**
   *
   * 종전의 [즉시] 덧말은 자식 트리를 SIGTERM 으로 끊었는데, 그 트리 안에는 그 세션이 띄워 둔
   * **백그라운드 감시**(`Monitor` · `Bash run_in_background`)도 들어 있다(§5.5 #17-9 ⑩). 그래서
   * 사용자가 도중에 말 한마디를 얹을 때마다 감시가 조용히 함께 죽고, 다음 명령에서 CLI 가
   * `No completion record was found …` 를 밀어 넣었다. 감시를 살리려면 **프로세스를 죽이지 않고**
   * 그 턴만 끊어야 한다.
   *
   * CLI(2.1.228)는 stream-json stdin 으로 SDK 제어 메시지를 받는다 —
   * `{"type":"control_request","request_id":…,"request":{"subtype":"interrupt"}}`. 실제 구현을 확인해
   * 보면 이 경로는 진행 중 쿼리를 abort 하고 **에이전트/워크플로 작업만** 정리하며, 셸 계열 작업
   * (`Monitor`·백그라운드 Bash)은 건드리지 않는다 — 우리가 원하는 그 경계다.
   *
   * stdin 이 열려 있는 **persistent 자식에게만** 통한다(legacy 는 write 직후 `end()` 라 창구가 없다).
   * 보낸 뒤 `SOFT_INTERRUPT_FALLBACK_MS` 안에 그 명령이 마감되지 않으면 종전 하드 킬로 넘어간다.
   *
   * @returns 인터럽트를 실제로 보냈으면 true. 이때 호출자는 **끊었다**로 취급하면 되고, 큐에 남은
   *          덧말은 그 턴이 마감되는 시점에 종전 경로 그대로 이어진다.
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
    logger.info(`SubAgent ${subAgentId} soft interrupt sent (cmd=${interruptedCmdId}) — child kept alive`);

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
   * §5.5 #17-18 — **붙들어 둔 턴 끝을 지금 확정한다**([즉시] 덧말이 먼저 시도하는 길). 붙든 게 없으면 false.
   *
   * `result` 는 이미 왔고 백단 여운 때문에 봉인만 미뤄 둔 상태라면 **끊을 턴이 없다.** 그런데 종전
   * [즉시] 는 이 상태도 "처리 중"으로 읽어 인터럽트를 쏘고, CLI 는 답할 턴이 없으니 3초 뒤 하드 킬
   * 폴백으로 내려가 **프로세스와 그 세션의 백그라운드 감시까지 죽였다**(§5.5 #17-9 ⑩ 이 없애려 한 바로
   * 그 죽음). 그 자리에서 할 일은 죽이는 게 아니라 **봉인을 확정해 다음 턴으로 넘기는 것**이다 —
   * 봉인의 `seal()` 이 `onComplete` → `processNextCommand` 를 부르므로, 큐에 있는 그 덧말이 같은 자식에게
   * 이어서 나간다(대화·감시 모두 그대로).
   */
  sealHeldTurnNow(subAgentId: string): boolean {
    if (!this.deferredSeals.has(subAgentId)) return false;
    this.flushDeferredSeal(subAgentId, 'immediate follow-up');
    return true;
  }

  /**
   * §5.5 #17-18 — **아직 내려가는 중인 자식 때문에 이 턴을 지금 보낼 수 없을 때** 큐로 되돌린다.
   *
   * `execute` 가 세워 둔 것(dispatch 표식 · 턴 도장 · `executing`)을 원위치로 돌려, 그 자식의 `close` 가
   * 부르는 `onComplete` → `processNextCommand` 가 이 명령을 **fresh spawn(`--resume`)으로** 그대로 다시
   * 집게 한다. 대화 맥락도, 사용자가 방금 친 덧말도 잃지 않는다 — 종전엔 이 자리가 write-after-end
   * 예외였고, 그 예외가 덧말을 통째로 삼킨 채 세션을 멈춰 세웠다.
   *
   * in-flight 는 **이 명령 것일 때만** 지운다 — 직전 턴이 붙들려 있으면 그 마감의 대상이라 건드리면
   * 그 명령이 `executing` 인 채로 굳는다.
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
    sub.lastActivityAt = Date.now();
    logger.warn(
      `SubAgent ${sub.id} child is shutting down (stdin closed) — requeued cmd=${cmd.id};`
      + ' its close will dispatch it as a fresh --resume spawn',
    );
  }

  /**
   * 실행 중인 서브에이전트를 사용자가 중지. 자식 프로세스 SIGTERM, sub/cmd 는 registry 에 그대로 둔다.
   * close 핸들러가 stoppedByUser 플래그를 보고 status/result 를 맞춘다.
   * 실행 중이 아니면 false (큐잉된 명령은 이 API 로 취소하지 않음 — CommandQueue 의 삭제 UI 로 처리).
   */
  stop(subAgentId: string): boolean {
    const sub = this.index.get(subAgentId);
    if (!sub) return false;

    // §5.3 #12-1 v3.43 — 사용자 명시 중지: 백그라운드 서브에이전트 대차대조도 즉시 해제.
    // 여기서 안 비우면 그 항목은 **끊긴 자식이라 끝 신고를 못 하고**, 시간 만료도 없으므로
    // (조용함으로 걷지 않는다) 다음 프로세스 대조가 올 때까지 활성으로 붙잡는다.
    // §5.5 #17-10 v3.53 — 단, **이 세션이 띄운 항목만**. 종전엔 부모 전체를 지워 한 탭을 멈추면
    // 다른 탭이 띄운 백그라운드 서브에이전트 표시까지 함께 사라졌다.
    this.clearPendingSubagentTasksForSession(sub.parentAgentId, subAgentId);
    // 스트림 칩으로만 보이던 백그라운드 작업(`Bash run_in_background` · `Monitor`)도 함께 정리한다.
    //   이 자식들은 우리가 죽이는 프로세스 트리 안에 있어 실제로 끝나는데, 장부를 안 비우면
    //   **끝 통지가 영영 안 와** 그 항목이 유령으로 남는다(시간 만료가 없으므로 스스로 사라지지 않는다).
    //   이제 이 장부는 화면(실행 목록·도트·버블 완료 판정)까지 몰기 때문에, 안 비우면 중지 뒤에도
    //   "아직 N개 도는 중"이 뜨고 버블이 완료로 못 간다.
    this.clearLiveBackgroundTasks(subAgentId);

    // §5.19 — 로컬 LLM 세션에는 자식이 없다. 생성만 끊고 러너가 onDone 으로 마감하게 둔다
    //   (모델은 내리지 않는다 — 다음 턴에 그대로 다시 쓴다).
    if (stopLocalTurn(subAgentId)) {
      this.stoppedByUser.add(subAgentId);
      logger.info(`SubAgent stop requested by user (local): ${subAgentId}`);
      return true;
    }

    // §5.7 #23-2 v1.60 — agent-view 경로: supervisor 에 stop 요청. finishTerminal 에서 후처리.
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
    // SIGTERM(직접 자식) → grace 후 트리 강제 종료로 손자(node worker/MCP) 고아 방지.
    terminateChildTree(child);
    logger.info(`SubAgent stop requested by user: ${subAgentId}`);
    return true;
  }

  /**
   * §5.5 #17-9 v3.51 — **에이전트 전체 중지**. 한 부모(감독관) 아래 **모든 세션 탭**의 실행을 끊는다.
   *
   * 배경: 종전 [중지] 는 `stop(subId)` 로 그 탭 하나의 자식만 끊어, 다른 탭이 돌고 있거나 감독관이
   * 백단에 Task 서브에이전트를 여러 개 띄워 둔 상태에선 "눌러도 안 멈추는" 것처럼 보였다.
   *
   * 대차대조(§5.3 #12-1 v3.43)는 여기서 한 번만 해제한다 — `stop()` 을 세션마다 부르면 같은
   * `clearPendingSubagentTasks` 가 N번 돌아 낭비되므로, 자식 종료는 세션별로 직접 수행한다.
   *
   * @returns 실제로 종료 신호를 보낸 세션 id 목록.
   */
  stopAll(parentAgentId: string): string[] {
    // 백그라운드 서브에이전트 대차대조 즉시 해제 — 끊긴 자식은 끝 신고를 못 하므로, 안 비우면
    // pending 가드가 중지된 에이전트를 계속 활성으로 붙잡는다(= 중지했는데 계속 도는 것처럼 보임).
    this.clearPendingSubagentTasks(parentAgentId);

    const stopped: string[] = [];
    for (const sub of this.registry.get(parentAgentId) ?? []) {
      // 스트림 칩 장부도 세션마다 비운다 — `stop()` 과 같은 이유(끊긴 자식은 끝 통지를 안 보낸다).
      this.clearLiveBackgroundTasks(sub.id);
      // §5.19 — 로컬 LLM 세션(자식 없음)도 함께 끊는다.
      if (stopLocalTurn(sub.id)) {
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
      stopped.push(sub.id);
    }
    logger.info(`SubAgent stop-all requested by user: parent=${parentAgentId} stopped=${stopped.length}`);
    return stopped;
  }

  /** 부모 에이전트의 archive 목록 — 폴더 팝업 소스. 최근 활동 순 정렬. */
  getArchived(parentAgentId: string): SubAgent[] {
    const list = this.archive.get(parentAgentId) ?? [];
    return [...list].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  /** archive → 레지스트리 복구. 스트림 버퍼는 disk에서 다시 로드.
   *  미존재 시 null, 이미 registry에 있으면(중복 호출) 기존 인스턴스 그대로 반환. */
  restoreFromArchive(subAgentId: string): SubAgent | null {
    // 이미 live면 그 인스턴스 반환
    const live = this.index.get(subAgentId);
    if (live) return live;

    // archive에서 찾기
    let found: SubAgent | null = null;
    let parentId = '';
    for (const [pid, list] of this.archive) {
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

    // 디스크 스트림 버퍼 재로드 — 프로젝트 해석 가능하면
    const info = this.projectResolver?.(parentId);
    if (info) {
      const dir = streamBufferStore.subStreamsDir(info, parentId);
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

  /**
   * 서브에이전트 탭 순서 변경 — orderedIds가 현재 레지스트리 구성과 일치해야 함.
   * 일치(set 동등)하면 재배열 후 true, 아니면 무시하고 false.
   */
  reorder(parentAgentId: string, orderedIds: string[]): boolean {
    const list = this.registry.get(parentAgentId);
    if (!list || list.length !== orderedIds.length) return false;
    const currentIds = new Set(list.map((s) => s.id));
    if (!orderedIds.every((id) => currentIds.has(id))) return false;

    const byId = new Map(list.map((s) => [s.id, s] as const));
    const reordered = orderedIds.map((id) => byId.get(id)!);
    this.registry.set(parentAgentId, reordered);
    return true;
  }

  /** 명령 실행 — subagent 세션에서. agentConfig가 있으면 CLI 인자로 적용.
   *  v1.77 (Direction A): opts.customParent=true 면 `--bg`(Agent View) 경로를 절대 타지 않고
   *  legacy `claude -p` 로만 실행한다. 이유 — supervisor 가 spawn 마다 sessionId 를 새로
   *  발급해(=대화 연속성 상실 + 각 세션이 새 훅 버블로 증식) 커스텀 에이전트의 "하나의
   *  안정 세션" 목표와 구조적으로 충돌. legacy 는 sub.sessionId 를 첫 턴에 캡처해 이후
   *  `--resume <동일 id>` 로 같은 대화를 잇는다(서버 재시작해도 sub.sessionId 영속 → 재개). */
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
    this.dispatchingSubs.add(sub.id);
    sub.lastCommand = cmd.text;
    sub.lastActivityAt = Date.now();
    // §5.5 #17-5 v2.68 — 라벨이 아직 기본값(Sub #N)이면 첫 프롬프트로 주제명 자동 부여.
    //   사용자가 직접 바꾼 이름은 클라(subAgentLabels)가 displayLabel 에서 항상 우선하므로
    //   서버는 기본 라벨만 갱신하면 "직접 바꾼 게 아니라면 자동 명명"이 성립한다.
    if (DEFAULT_SUB_LABEL_RE.test(sub.label)) {
      const title = deriveTabTitle(cmd.text);
      if (title) sub.label = title;
    }
    cmd.status = 'executing';
    // 이 턴의 도장 — 지금부터 이 세션이 뱉는 줄은 전부 이 명령의 것이다.
    this.currentTurnId.set(sub.id, cmd.id);

    // §5.5 #17-18 ⑥ — 이 명령이 **실제로 나간** 시각. 화면은 큐에 넣은 시각(`timestamp`)이 아니라
    //   이 값으로 말풍선 자리를 고정해 "여기서 턴이 끊겼다"를 그린다(대기·합치기는 둘 사이가
    //   몇 분씩 벌어진다). 흡수된 덧말은 이 명령에 실려 나가므로 base 의 이 값 하나가 그 턴의 시작이다.
    //
    // §5.19 (D) — **로컬 갈림보다 먼저** 둔다. 종전에는 아래 `return` 뒤에 있어서 로컬 턴만
    //   시작 시각을 못 받고, 시작을 알리는 상태 통지도 못 나갔다 — 사용자가 명령을 보내도 버블이
    //   곧바로 "실행중"으로 바뀌지 않고 러너의 첫 도구 이벤트를 기다렸다. 두 경로가 같은 순간에
    //   같은 말을 하게 한다(실행 → 실행중).
    //
    // §5.5 #17-18 ⑥-5 — **한 명령에 한 번만** 찍는다. 종전엔 dispatch 마다 덮어써서, 앱이 내려가
    //   끊긴 명령을 부팅 reconcile 이 되살려 다시 보낼 때(§5.3 #12-1 `restartResumed`) 이 값이
    //   **재개한 시각**으로 갈아 끼워졌다 — 말풍선이 그 명령이 이미 뱉어 놓은 출력보다 **아래**로
    //   내려가, 사용자에겐 "내가 친 명령이 제 결과 밑에 있는" 뒤죽박죽 화면이 됐다(사용자 보고).
    //   재개는 **같은 턴의 이어달리기**지 새 턴이 아니므로 자리는 처음 나간 그 시각이 옳다.
    //   창구가 닫혀 큐로 되돌린 재시도(#17-18 ② 큐 되돌림)도 같은 이유로 첫 시각을 유지한다.
    if (cmd.startedAt === undefined) cmd.startedAt = Date.now();
    this.onSubStatusChange?.(sub.parentAgentId);

    // §5.19 — All Model(로컬 LLM) 갈림. **이 한 곳**이 이 기능이 기존 실행 경로에 내는 유일한 자국이다.
    //   `provider` 가 없으면 아래 claude 스폰 경로가 지금까지와 한 줄도 다르지 않게 흐른다.
    if (agentConfig?.provider) {
      // §5.19 (H) — 도구가 일할 자리는 이 세션의 프로젝트 루트다(클로드 스폰 cwd 와 같은 값).
      this.executeLocalProvider(sub, cmd, agentConfig, parentCwd, contextSummary, livePreamble);
      return;
    }

    // 스테일 세션 자가복구 — 저장된 sessionId 에 해당하는 Claude CLI JSONL 이 사라졌으면
    // `--resume <id>` 가 exit 1 + "No conversation found" 로 확정 실패한다.
    // (원인: Claude Code 내부 세션 정리 / cwd 슬러그 매칭 실패 / worktree→master 이동 등.)
    // 여기서 sub.sessionId 를 비워 fresh-spawn 경로로 강제 전환 — 다음 프롬프트가 자동 정상화.
    if (sub.sessionId) {
      const jsonlPath = getSessionJsonlPath(parentCwd, sub.sessionId);
      if (!fs.existsSync(jsonlPath)) {
        logger.warn(`SubAgent ${sub.id} sessionId stale (${sub.sessionId}, JSONL missing: ${jsonlPath}) — clearing and re-spawning fresh`);
        sub.sessionId = '';
      }
    }

    // v1.33 — resume 경로에도 최신 "live preamble" (outbound 엣지 등 매 턴 바뀌는 정보) 은 prepend.
    // contextSummary 전체는 첫 스폰에서만, livePreamble 은 매 턴 반복 — 엣지 추가/삭제 즉시 반영.
    // v1.35 — paste 첨부 이미지 경로를 프롬프트 말미에 append.
    // Claude CLI 는 argv 로 이미지 자체를 받지 않지만 경로를 읽어 Read 툴로 해석한다.
    // 경로는 개행으로 구분 — 공백 포함 경로(Windows 등)가 토큰 쪼개지는 것을 방지.
    //
    // §5.5 #17-2 — 조립 자체는 순수 모듈 `composeTurnPrompt` 하나가 맡는다. 슬래시 명령이면
    //   앞말도 `Task:` 래핑도 붙이지 않고 **원문 그대로** 보낸다 — 맨 앞 한 글자라도 앞서면
    //   CLI 가 내장 명령으로 집지 못하고 모델에게 평문으로 넘긴다(실측: 앞선 한 줄에 turns 0·$0 →
    //   turns 1·$0.0125). 슬래시가 아니면 종전 조립과 바이트 단위로 같다.
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

    // AgentConfig → CLI 인자 변환
    // §5.3 v4.89 — 기억 폴더는 "어느 에이전트가, 어느 프로젝트에서" 로 갈리므로 맥락을 함께 넘긴다.
    const configCtx: ConfigArgsContext = { agentName: sub!.parentAgentId, projectRoot: parentCwd };
    // §5.5 #17-28 — 주입원 창이 끈 줄의 CLI 인자를 뒤에 얹는다. 같은 인자가 이미 있으면 넣지 않는다.
    const configArgs = agentConfig ? buildConfigArgs(agentConfig, configCtx) : [];
    for (const extra of opts?.extraArgs ?? []) {
      if (!configArgs.includes(extra)) configArgs.push(extra);
    }
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

    // ──────────────────────────────────────────────────────────────
    // maxTurns 턴 제한 — 무한루프 방지 안전장치
    //
    // - 각 execute() 호출(= 프롬프트 명령 1건)마다 독립적인 turnCount 생성
    // - 서브에이전트가 여러 개여도 각자 execute()가 호출되므로 카운트 간섭 없음
    // - assistant 메시지 = 1턴
    // - maxTurns > 0 일 때만 제한 — turnCount >= maxTurns 도달 시 강제 종료(legacy: SIGTERM / agent-view: `claude stop`)
    // - config 없으면 DEFAULT_AGENT_CONFIG.maxTurns(0=무제한) 사용. 사용자가 양수 지정 시에만 캡.
    // ──────────────────────────────────────────────────────────────
    const maxTurns = agentConfig?.maxTurns ?? DEFAULT_AGENT_CONFIG.maxTurns ?? 0;
    // §4 v2.88 — API 비용 상한(달러). undefined/0 = 무제한(기존 동작). 양수면 헤드리스 --print 스폰에 --max-budget-usd 전달.
    const maxBudgetUsd = (agentConfig?.maxBudgetUsd && agentConfig.maxBudgetUsd > 0) ? agentConfig.maxBudgetUsd : 0;
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

    // v1.77 (Direction A) — 커스텀 에이전트는 Agent View 게이트를 건너뛰고 무조건 legacy.
    // (supervisor sessionId 회전 → 증식·연속성 상실. 위 docstring 참조.)
    if (opts?.customParent) {
      this._executeViaLegacy(cmd, sub!, parentCwd, prompt, configArgs, maxTurns, maxBudgetUsd, fallbackModel, streamFlags);
      return;
    }

    // §4 v2.88 — 비용 상한이 걸린 에이전트는 Agent View(`--bg`, --print 아님)로 보내면 --max-budget-usd 가
    //   안 먹는다 → legacy fresh `--print` 스폰으로 강제해 상한이 매 턴 실제 적용되게 한다.
    if (maxBudgetUsd > 0) {
      this._executeViaLegacy(cmd, sub!, parentCwd, prompt, configArgs, maxTurns, maxBudgetUsd, fallbackModel, streamFlags);
      return;
    }

    // §5.7 #23-2 v1.60 — Agent View 게이트 (커스텀이 아닌 SubAgent/Team/Pipeline 전용).
    // 활성화 시 `claude --bg` 로 dispatch 후 supervisor 가 자식을 보유 → 서버 재시작 시에도 turn 보존.
    // 게이트는 캐시되므로 매 execute() 마다 호출해도 비싸지 않음(60s memoized).
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

  /**
   * §5.7 #23-2 v1.60 — Agent View 경로: `claude --bg` dispatch + JSONL watcher.
   * supervisor 가 자식 process 를 보유하므로 Vibisual 서버 재시작 시점에도 turn 이 끊기지 않는다.
   */
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
      // v1.74 — 매핑을 **즉시** 영속화. 이게 없으면 spawn 후 다음 (무관한) 체크포인트
      // 트리거 전에 서버가 죽을 때 agentViewShort/SessionId 가 디스크에 안 남아
      // reattachAgentViewOnBoot 가 supervisor 의 살아있는 워커를 못 찾고 세션이 유실된다
      // (= 사용자 보고 "재시작 시 세션 먹통/연속성 없음" 의 근본 원인).
      this.onPersistNeeded?.();

      // 진짜 마감 — 재진입 가드(`terminalProcessed`)는 호출부(`onTerminal`)가 든다.
      const finishTerminal = async (state: AgentViewJobState): Promise<void> => {
        this.cancelDeferredSeal(sub.id);

        // 결과 텍스트 — state.json output.result 우선, 폴백으로 JSONL last assistant.
        let resultText: string | undefined =
          (typeof state.output?.result === 'string' && state.output.result) || undefined;
        if (!resultText && sub.sessionId) {
          resultText = readLastAssistantMessage(parentCwd, sub.sessionId) ?? undefined;
        }
        if (resultText) {
          sub.lastResult = resultText;
          cmd.result = resultText;
        }

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

        logger.info(`SubAgent ${sub.id} agent-view finished (state=${stateStr}, killed=${killed}, userStopped=${userStopped}, turns=${turnCount}, result=${resultText ? 'yes' : 'no'})`);

        // 이 세션의 실행이 끝났다 = 그 자식인 배경 작업도 끝났다(위 close 핸들러와 같은 근거).
        this.retireLiveBackgroundTasks(sub.id);
        this.clearPendingSubagentTasksForSession(sub.parentAgentId, sub.id);
        this.runningAgentViewWatchers.delete(sub.id);
        this.clearDispatching(sub.id);
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
   * §5.7 #23-2 v1.60 — Legacy `claude -p` 경로(stream-json over stdin).
   *
   * v2.x persistent-child 모델 — `VIBISUAL_PERSISTENT_CHILD` 가 켜져 있으면 매 턴 fresh spawn 대신
   * sub 당 자식 1개를 long-lived 로 유지하고 stdin 으로 다음 턴만 추가.
   *   • 1st turn (no sessionId)            : persistent fresh spawn (--resume 없이, no --print).
   *   • 2nd turn (sessionId, no live child): persistent fresh spawn (--resume, no --print).
   *   • 3rd+ turn (live ready child)       : reuse — stdin 으로 prompt 만 write, return.
   *
   * **첫 턴도 persistent 인 이유 — 백그라운드 감시의 동반 사망**(§5.5 #17-9 ⑩). `Monitor` ·
   * `Bash run_in_background` 은 그 세션 CLI 프로세스의 **자식**이라 프로세스가 죽으면 함께 죽고,
   * 그 죽음은 통지로도 오지 않는다. 종전엔 첫 턴만 legacy(`--print` + `stdin.end()`)여서 자식이
   * result 직후 반드시 종료했고, **그 턴에 띄운 감시는 예외 없이 죽었다** — 다음 명령을 내리는
   * 순간 CLI 가 재개 부팅에서 그것을 찾아 `No completion record was found for this background
   * shell command from the previous session` 을 세션에 밀어 넣는다(사용자 보고: "백단에서 뭐 쓴 적
   * 없는 세션인데 명령만 내리면 이 경고가 뜬다"). 첫 턴도 자식을 살려 두면 이 자리가 사라진다.
   * sessionId 는 종전에도 첫 `system/init` 라인에서 캡처하고 있어(아래 stdout 핸들러) 연속성은 그대로다.
   *
   * 안전장치: VIBISUAL_PERSISTENT_CHILD=0 → 매 턴 fresh spawn 으로 즉시 폴백.
   * 크래시 복구: persistent child 가 의도치 않게 종료되면 sub.sessionId 보존 → 다음 execute 가
   * 자동으로 fresh persistent spawn 으로 복구. claude 바이너리가 multi-turn stdin 미지원이면
   * 자연히 이 경로를 타게 됨(기능적으로는 옛 매 턴 spawn 과 동등).
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
    // §4 v2.88 — 비용 상한(maxBudgetUsd>0)이 걸리면 매 턴 fresh `--print` 스폰이어야 `--max-budget-usd` 가
    //   실제 적용된다(CLI 제약: --max-budget-usd 는 --print 전용). persistent 재사용은 --print 를 떼므로 끈다.
    // sessionId 유무는 더 이상 조건이 아니다 — 첫 턴부터 자식을 살려 둬야 그 턴에 띄운
    //   백그라운드 감시가 다음 명령까지 살아남는다(위 함정 주석).
    const usePersistent = PERSISTENT_CHILD_ENABLED && maxBudgetUsd <= 0;

    // ─── REUSE PATH ─────────────────────────────────────────────────────
    // 살아있는 자식 + ready=true 면 fresh spawn 없이 stdin write 만으로 다음 턴 시작.
    // node boot + claude init + JSONL 재로드 + MCP 재연결 + hook 재초기화 비용 = 0.
    const existingChild = this.runningChildren.get(sub.id);
    // §5.5 #17-18 — **창구가 닫힌 자식은 재사용도, 덮어쓰기도 하지 않는다.** 장부에 있는 그 자식이
    //   [중지] · [즉시] 덧말의 하드 킬 폴백 · 앱 종료로 `stdin.end()` 를 이미 받았다면, 여기에 쓰는 것은
    //   write-after-end 이고 그 예외는 `try/catch` 를 지나쳐 프로세스를 흔든다. fresh spawn 으로 덮는 것도
    //   답이 아니다 — 곧 도착할 **옛 자식의 close 핸들러가 새 자식의 장부를 지운다**. 그 `close` 는
    //   SIGTERM + 트리 강제 종료로 반드시 오므로, 이 명령은 큐로 되돌려 그 마감이 부르는 `onComplete`
    //   에 다음 차례를 맡긴다(그때는 자식이 없어 `--resume` fresh spawn 으로 그대로 이어진다).
    if (existingChild && !isChildStdinWritable(existingChild)) {
      this._requeueForDyingChild(sub, cmd);
      return;
    }
    if (usePersistent && existingChild && this.persistentChildReady.get(sub.id) === true) {
      this.persistentChildReady.set(sub.id, false);
      this.persistentInFlightCmd.set(sub.id, {
        cmd, turnCount: 0, resultText: undefined, killed: false, maxTurns, parentCwd,
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
        // sub 도 함께 내린다 — `execute` 가 방금 `active` 로 올려 둔 참이라 여기서 안 내리면
        //   **자식이 죽었는데 화면은 계속 실행 중**으로 남는다. 뒤따르는 close 핸들러는 위에서
        //   in-flight 를 이미 지웠으므로 그 분기에서 sub 를 손대지 않아, 5분 idle sweep 전까지
        //   아무도 이 거짓말을 걷지 않는다(그 사이 [중지]는 멈출 게 없는 헛버튼이 된다).
        sub.status = 'error';
        sub.lastActivityAt = Date.now();
        this.clearDispatching(sub.id);
        this.failCommand(sub, cmd, { code: 'stdin', detail: err instanceof Error ? err.message : String(err) });
        this.onSubStatusChange?.(sub.parentAgentId);
        this.onComplete?.();
      }
      return;
    }

    // ─── FRESH SPAWN ────────────────────────────────────────────────────
    // v1.33 Windows 인코딩 픽스 — 기존엔 prompt 를 argv(-p <prompt>) 로 넘겼으나 claude.exe 가
    // Windows 에서 argv 를 OEM(cp949) 로 해석하는 경로가 있어 한글/CJK 가 mojibake 됨.
    // 대신 `--input-format stream-json` 으로 stdin 에 user 메시지를 UTF-8 로 써 넘기면 argv 경로를
    // 완전히 우회해 UTF-8 가 보존된다. output-format 은 기존처럼 stream-json 사용.
    //
    // persistent: --print 없음. 자식이 result 후 stdin 대기 상태로 살아있어 다음 턴 재사용 가능.
    // legacy:     기존대로 --print 포함. 자식이 result 후 자연 종료.
    // §4 v2.88 — `--print` 전용 헤드리스 플래그(CLI: 둘 다 --print 필수).
    //   --include-partial-messages: 토큰 단위 스트리밍(버블 본문 실시간 누적). parseStreamLine partial 가드와 짝.
    //   --max-budget-usd <n>: API 비용 상한(양수일 때만). persistent(no --print) 경로엔 못 붙으므로 위에서 끔.
    //   --fallback-model <m>: 기본 모델 과부하/불가 시 대체 모델(§4 CLI 사양 추종). 역시 --print 전용이라
    //     이 자리에서만 붙는다 — persistent 경로(--print 없음)에는 실리지 않는다.
    const printFlags = ['--include-partial-messages', ...streamFlags];
    if (maxBudgetUsd > 0) printFlags.push('--max-budget-usd', String(maxBudgetUsd));
    if (fallbackModel) printFlags.push('--fallback-model', fallbackModel);

    const args = usePersistent
      ? [
          // 첫 턴은 이어붙일 대화가 없다 — `--resume` 만 빼고 나머지는 같다(스폰 형태 한 벌).
          ...(sub.sessionId ? ['--resume', sub.sessionId] : []),
          ...configArgs,
          // 토큰 단위 스트리밍은 persistent 에서도 실린다. CLI 의 "requires --print" 검사는 실제로는
          //   **비대화형 판정**(`!process.stdout.isTTY` 포함)이라, 파이프로 띄우는 우리 자식은 통과한다
          //   (2.1.228 실측). 이 줄이 없으면 첫 턴이 persistent 로 오면서 말풍선 실시간 누적을 잃는다.
          //   §4 (스트림 3종) 도 같은 성질이라 여기 함께 실린다 — persistent 가 기본 경로이므로
          //   여기에 안 실으면 "켰는데 대부분의 턴에서 안 온다"가 된다.
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
        stdio: ['pipe', 'pipe', 'pipe'], // v1.33 — stdin 으로 prompt 주입하려 pipe.
        shell: false,
        // POSIX 한정 detached — 이 자식은 우리가 `terminateChildTree`/`killTree` 로 회수하는데,
        //   그룹 리더가 아니면 `-pid` 가 ESRCH 로 실패해 단일 pid 킬로 강등되고 claude 가 띄운
        //   MCP 서버·node worker(손자)가 mac/linux 에서 고아로 남는다. detached 는 그룹만 만들 뿐
        //   stdio 파이프(위 stdin prompt 주입)에는 영향이 없다. unref() 는 절대 붙이지 말 것.
        ...processGroupSpawnOptions(),
        env: {
          ...process.env,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          PYTHONIOENCODING: 'utf-8',
          // §5.3 #12-1 v1.43 — 글로벌 PreToolUse 훅이 Vibisual 관할 세션을 식별하기 위한 마커.
          // 세션ID 가 아직 claude 쪽에 발급되기 전(첫 실행) 에도 구분 가능.
          VIBISUAL_SUBAGENT_ID: sub.id,
          VIBISUAL_PARENT_AGENT_ID: sub.parentAgentId,
          // §5.3 v4.89 — 중첩 깊이(CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH) · 자동 기억 끄기.
          //   설정이 없으면 빈 객체라 종전 스폰과 동일하다.
          ...(this.pendingConfigEnv.get(sub.id) ?? {}),
        },
      });
      this.runningChildren.set(sub.id, child);
      this.wakeSub(sub); // §2.4 (잠듦) — 자식이 다시 섰으니 표식 해제
      // §5.5 #17-18 — **stdin 오류는 예외가 아니라 이벤트로 온다.** `write-after-end` · `EPIPE` 는
      //   `write()` 를 감싼 try/catch 를 지나쳐 이 stream 의 `error` 로 올라오고, 듣는 사람이 없으면
      //   메인 프로세스 `uncaughtException` 이 되어 **그 순간 돌던 dispatch 체인을 끊는다**(사용자에게는
      //   "덧말을 넣었더니 대화가 끝나고 세션이 멈췄다"로 보인다 — 실측 crash.log). 여기서 받아 로그로만
      //   남기고, 뒷정리는 반드시 오는 `close` 핸들러 한 곳에 맡긴다.
      child.stdin?.on('error', (err: Error) => {
        logger.warn(`SubAgent ${sub.id} stdin error: ${err.message} — child is going down; close handler settles it`);
      });
      // 자식이 떴으니 이제 생존 대조가 이 sub 를 사실로 판정할 수 있다.
      this.clearDispatching(sub.id);
      // §5.5 #17-12 ③ — 새 자식이면 앞 실행의 stderr 꼬리는 남기지 않는다(옛 사유가 새 실패에 붙지 않게).
      this.childStderrTails.delete(sub.id);
      registerSpawnedPid(child.pid);
      child.once('exit', () => unregisterSpawnedPid(child.pid));

      if (usePersistent) {
        this.persistentChildReady.set(sub.id, false);
        this.persistentLineBuf.set(sub.id, '');
        this.persistentInFlightCmd.set(sub.id, {
          cmd, turnCount: 0, resultText: undefined, killed: false, maxTurns, parentCwd,
        });
      }

      // v1.33 — prompt 를 stream-json 한 줄로 stdin 에 UTF-8 바이트로 write.
      // content 를 text block 배열로 감싸서 보내면 Claude 가 단일 user 턴으로 처리.
      // legacy: stdin.end() 로 더 이상 입력 없음을 통지 → Claude 가 응답 후 종료.
      // persistent: stdin 을 열어둔다 → 자식이 result 후 다음 user 라인을 기다리며 살아있음.
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
        // v1.33 — 명시적 UTF-8 디코딩. 기본 toString() 은 보통 utf8 이지만 플랫폼/Node 버전에
        // 따라 OEM fallback 될 수 있어 안전하게 고정.
        const text = chunk.toString('utf8');

        // ── PERSISTENT 경로: 맵 기반 line 버퍼 + result 라인 인라인 검출 ──
        if (usePersistent) {
          let buf = this.persistentLineBuf.get(sub!.id) ?? '';
          buf += text;
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          this.persistentLineBuf.set(sub!.id, buf);
          for (const line of lines) {
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
            // 스트림 이벤트 파싱 + 클라이언트 중계 (한 라인이 여러 블록 가능)
            // §4 v2.88 — legacy --print 스폰은 `--include-partial-messages` 가 붙어 토큰 델타가 온다 → partialMessages:true.
            const streamEvts = parseStreamLine(obj, sub!.id, sub!.parentAgentId, { partialMessages: true });
            for (const evt of streamEvts) this.emitStreamEvent(evt);
          } catch { /* 불완전 JSON — 다음 라인에서 처리 */ }
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        logger.debug(`SubAgent ${sub!.id} stderr: ${text.slice(0, 200)}`);
        // §5.5 #17-12 ③ — 꼬리만 보관. 실패로 끝났을 때 "왜"를 말할 유일한 재료다(성공하면 안 쓴다).
        const prev = this.childStderrTails.get(sub!.id) ?? '';
        this.childStderrTails.set(sub!.id, (prev + text).slice(-COMMAND_ERROR_DETAIL_LIMIT));
      });

      child.on('error', (err) => {
        logger.warn(`SubAgent ${sub!.id} spawn error: ${err.message}`);
        // §4 (실행본 자가 복구) — ENOENT = 우리가 든 `claude` 가 그 사이 사라졌다(확장 자동 갱신이 옛
        //   폴더를 통째로 지운다). 캐시를 버린 뒤 **재해석 결과가 방금 실패한 경로와 다를 때만** 되태운다
        //   — 같으면 되태워도 같은 곳에서 죽으므로, 이 비교가 곧 무한 재시도 방지 퓨즈다.
        //   실제 requeue 는 'close' 에서 한 번만 한다: ENOENT 는 'error' 다음에 'close'(code -4058) 가
        //   이어 오므로, 여기서 큐에 돌려놓으면 뒤이은 'close' 가 그 명령을 다시 마감해 버린다.
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
        this.failCommand(sub!, cmd, { code: 'spawn', detail: err.message });
        // 형제 종료 경로들과 같은 짝 — 이 호출이 빠지면 sub 도트 변화가 부모 재계산·broadcast 를 못 탄다.
        this.onSubStatusChange?.(sub!.parentAgentId);
        this.onComplete?.();
      });

      child.on('close', (code) => {
        // §4 (실행본 자가 복구) — 실행본이 사라져 되태우기로 한 경우: 아래 정리·마감을 **전부 건너뛰고**
        //   명령을 큐로 돌려놓는다. `onComplete` 가 부르는 다음 dispatch 가 재해석된 경로로 다시 띄운다.
        //   (여기서 걸러 두면 이어지는 persistent/legacy 마감 분기가 이 명령을 실패로 못박지 않는다.)
        if (retryForMissingBin) {
          if (this.runningChildren.get(sub!.id) === child) this.runningChildren.delete(sub!.id);
          this._requeueForDyingChild(sub!, cmd);
          this.onSubStatusChange?.(sub!.parentAgentId);
          this.onComplete?.();
          return;
        }

        // **이 자리가 백그라운드 작업의 실제 종료 시점이다.** 배경 Bash 셸은 이 프로세스의 자식이라
        //   프로세스가 사라지면 함께 사라진다(공식 규약: `claude -p` 는 최종 결과 뒤 약 5초에 그 셸을
        //   종료한다). 그러니 여기서 장부를 내리면 시간 추정도, 주기 대조가 우리를 따라잡기를 기다릴
        //   일도 없다 — `sweepOrphanedBackgroundTasks` 는 이 이벤트를 놓쳤을 때의 그물일 뿐이다.
        if (this.retireLiveBackgroundTasks(sub!.id)) this.onSubStatusChange?.(sub!.parentAgentId);
        // 훅 대차대조(Task/Agent 자식)도 **같은 사실 위에 있다.** 배경 서브에이전트는 그 결과가 최종
        //   출력의 일부라 `claude -p` 가 끝날 때까지 기다려 주므로(공식 규약, 기본 상한 10분), 이
        //   프로세스가 내려갔다는 것은 그 자식들이 끝났거나 상한에 걸려 회수됐다는 뜻이다. 종전에는
        //   이 정리가 사용자 [중지] 경로에만 있어서, `SubagentStop` 을 놓친 항목이 주기 대조가 걷어
        //   줄 때까지 그 세션을 활동 중으로 붙들었다 — 두 장부가 같은 이벤트를 보게 맞춘다.
        this.clearPendingSubagentTasksForSession(sub!.parentAgentId, sub!.id);

        // ── PERSISTENT 경로: intentional vs crash 분기 ──
        if (usePersistent) {
          // §5.5 #17-18 — **내가 아직 그 sub 의 자식인가.** 창구가 닫힌 자식을 건너뛰고 새 자식을 띄운
          //   뒤라면 이 close 는 **옛 세대**의 것이다 — 그때 아래 정리를 그대로 돌리면 살아 있는 새 자식을
          //   장부에서 지워 그 세션을 유령으로 만든다. 옛 세대는 아무것도 건드리지 않고 물러난다
          //   (`intentionalKill` 표식도 남겨 둔다 — 그건 지금 자식의 종료를 판정할 재료다).
          if (this.runningChildren.get(sub!.id) !== child) {
            logger.info(`SubAgent ${sub!.id} stale persistent child closed (code=${code}) — current child left untouched`);
            return;
          }
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
      this.failCommand(sub, cmd, { code: 'spawn', detail: err instanceof Error ? err.message : String(err) });
      this.onSubStatusChange?.(sub.parentAgentId);
      this.onComplete?.();
    }
  }

  /**
   * Persistent child stdout 라인 핸들러.
   * `result` 라인 도착이 turn 의 종료 신호 — child 는 죽이지 않고 다음 stdin write 대기 상태로 둔다.
   *
   * 순서 함정: `_finalizeLegacyCommand` → `onComplete` → `processNextCommand` → `execute` 가 동기 호출 체인이라,
   * 다음 execute 의 reuse 분기가 `persistentChildReady === true` 를 보려면 finalize **전** 에 ready=true 가
   * set 되어 있어야 한다. 그 다음 턴이 이미 큐에 쌓여 있으면 그 자리에서 stdin write 로 즉시 reuse 됨.
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

    // 스트림 이벤트 — 클라 중계.
    const streamEvts = parseStreamLine(obj, sub.id, sub.parentAgentId);
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

      // `result` 는 **턴 경계**일 뿐 아직 "명령 종료"가 아니다 — 백그라운드 작업 통지가 밀려 있으면
      //   CLI 가 이 자리에서 세션을 다시 돌린다(`turnSeal.ts` 의 실측 타임라인). 그래서 아래 마감은
      //   통째로 `sealTurn` 에 맡기고, 잠정이면 붙들어 둔다. 붙들린 동안 `persistentInFlightCmd` 도
      //   그대로 살려 둔다 — 미리 지우면 이어진 턴의 다음 `result` 를 못 알아봐서 진짜 종료를 놓친다.
      logger.info(`SubAgent ${sub.id} persistent result detected (turns=${inFlight.turnCount}) — child stays alive`);
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
        this._finalizeLegacyCommand(sub, inFlight.cmd, inFlight.parentCwd, resultText, inFlight.turnCount, inFlight.killed, inFlight.maxTurns, 0, '', /*deleteRunningChild=*/false, cliError);
      });
    } else if (obj['type'] === 'result') {
      // **되살아난 턴의 종료.** 백그라운드 통지로 봉인 뒤 다시 돌기 시작한 턴은 그 턴을 시킨 명령이
      //   이미 마감돼 `inFlight` 가 없다. 그래서 위 블록이 통째로 건너뛰어지고, 재진입이 올려 둔
      //   (`noteTurnSealSignal`) `active` 를 내려 줄 자리가 **어디에도 없었다** — 세션이 사용자 답을
      //   기다리는 내내 탭 점이 파랗게 돌았다. persistent 자식은 일부러 살려 두므로 생존 대조
      //   (`reconcileDeadActiveSubs`)도 이 세션을 걷지 못한다.
      //   닫아 줄 명령이 없을 뿐 턴은 분명히 끝났으니, 같은 봉인 정책으로 **세션 상태만** 재운다
      //   (명령·토큰 마감은 주인이 없어 할 일이 없다).
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
        logger.info(`SubAgent ${sub.id} resumed turn ended with no in-flight command — back to idle`);
        this.onSubStatusChange?.(sub.parentAgentId);
      });
    }
  }

  /**
   * turn 종료 시 cmd/sub 마무리 + 콜백 트리거.
   * legacy(child 종료 후)·persistent(child 살림) 양쪽이 공유 — `deleteRunningChild` 가 분기.
   *
   * @param stdout  legacy 경로는 누적 stdout 을 줘서 init/result 라인을 재파싱하게 한다.
   *                persistent 경로는 result 라인을 이미 인라인 처리했으므로 빈 문자열 + resultText 미리 채워서 호출.
   * @param initialCliError §5.5 #17-12 ③ — CLI 가 result 라인에서 `is_error` 로 신고한 실패 본문(있을 때).
   *                persistent 경로는 그 라인을 인라인 처리하므로 여기로 넘겨주고, legacy 경로는 stdout 에서 직접 줍는다.
   */
  /**
   * §5.19 (D) — 로컬 LLM 턴. `claude` 를 띄우지 않고 우리 러너가 직접 돈다.
   *
   * **화면은 하나도 새로 만들지 않는다** — `SubAgentStreamEvent` 일곱 종이 이미 프로바이더
   * 중립이라, 여기서 그 이벤트만 뱉으면 말풍선·턴 봉인·바닥 추종·검색·카드 레일이 그대로
   * 붙는다. 끝맺음도 기존 계약(`clearDispatching` → 상태 → `onSubStatusChange` → `onComplete`)
   * 그대로라 명령 큐가 다음 명령으로 자연히 넘어간다.
   *
   * 자식 프로세스가 없는 경로라 `runningChildren` 에 등록하지 않는다. 대신 스폰 진행 표식을
   * 즉시 걷어 "죽은 active" 대조가 이 세션을 오해하지 않게 한다.
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

    const emit = (eventType: StreamEventType, content: string): void => {
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
    const finish = (error: string | undefined, finalText: string): void => {
      // **맨 먼저** 내린다 — 아래 상태 통지가 부르는 `recomputeCustomAgentStatus` 는 이 표식을
      //   "아직 도는 중"으로 읽으므로, 남겨 둔 채 통지하면 진짜 완료가 그 자리에서 묻힌다.
      //   (러너의 `isLocalTurnRunning` 을 주인으로 못 쓰는 이유도 같다 — 그쪽 정리는 `finally` 라
      //    `onDone` 뒤에 돈다.) 같은 턴이 두 번 끝맺어도 지우기는 멱등이다.
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
      }
      this.onSubStatusChange?.(sub.parentAgentId);
      this.onComplete?.();
    };

    // §5.19 (D) ① — 클로드 세션이 받는 것을 로컬도 받는다. 종전에는 이 버블의 `rules` 한 칸이
    //   전부라, 로컬 모델은 프로젝트 규칙도 카드 지시문도 목표도 기억도 한 글자를 못 봤다.
    //   순서(안정 → 가변)는 `buildLocalSystemPrompt` 가 정한다 — 프리픽스 캐시가 걸린 문제다.
    const systemPrompt = buildLocalSystemPrompt(contextSummary, livePreamble, config.rules);

    if (!provider.modelId) {
      // 모델을 아직 안 고른 버블. 조용히 아무 일도 안 일어나는 대신 사유를 남긴다.
      finish('no model selected', '');
      return;
    }

    // §5.19 (D) ④ — 로컬에서 뜻이 있는 슬래시 명령은 **우리가** 처리한다. 종전에는 갈림이
    //   `composeTurnPrompt` 앞이라 `/clear` 조차 사용자 말로 모델에게 갔다.
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
     * §5.19 (H) — 도구 실행 직전의 판정. **모드가 먼저, 사람이 그다음**이다.
     *
     * 판정 규칙은 `resolveLocalToolGate` 한 곳에 있고, 여기서는 `ask` 일 때만 **기존 권한
     * 브로커**를 부른다 — 훅이 없는 로컬 경로에서도 같은 승인 팝업이 뜨는 이유가 이 한 줄이다.
     * 거절 사유는 던지지 않고 **모델에게 돌려준다**(모델이 다른 수를 고를 수 있어야 한다).
     */
    const requestTool = async (
      toolName: string,
      toolInput: Record<string, unknown>,
    ): Promise<LocalToolVerdict> => {
      const gate = resolveLocalToolGate(config.permissionMode, toolName);
      if (gate === 'allow') return { allowed: true };
      if (gate === 'deny') {
        const mode = config.permissionMode || 'default';
        return { allowed: false, reason: `permission mode "${mode}" does not allow ${toolName}` };
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
        },
        config.permissionTimeoutPolicy === 'deny' ? 'deny' : 'allow',
      );
      if (decision.decision === 'allow') return { allowed: true };
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
        // 판정을 설정에 남긴다 — `getAgentConfig` 가 돌려주는 것이 **살아 있는 객체**라
        //   여기 쓰면 스냅샷·체크포인트를 그대로 탄다(새 영속 필드 발명 ❌). 스냅샷 캐시가
        //   한 박자 늦을 수 있으나 바로 아래 상태 통지가 방송을 끌어온다.
        if (provider.toolSupport !== support) provider.toolSupport = support;
        this.onSubStatusChange?.(sub.parentAgentId);
      },
      onUsage: (promptTokens, completionTokens, contextLimit) => {
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
      onDone: (error) => finish(error, finalText),
    };
    if (provider.toolSupport) args.toolSupport = provider.toolSupport;
    if (systemPrompt) args.systemPrompt = systemPrompt;
    // §5.19 (H) — 목표창·질문 카드·계획 종료는 러너가 아니라 여기서 넘어간 처리기가 맡는다.
    args.onHookEvent = (event) => {
      this.localHookEmitter?.({ agentId: sub.parentAgentId, subAgentId: sub.id }, event);
    };
    args.onHostTool = async (toolName, input) => {
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
    return stopLocalTurn(subAgentId);
  }

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
  ): void {
    // 붙들어 둔 잠정 봉인이 있으면 여기서 버린다 — 자식 종료·크래시·사용자 중지가 먼저 도착한 경우다.
    //   (잠정 타이머가 스스로 이 함수를 부른 경우엔 이미 지워져 있어 무해하다.)
    this.cancelDeferredSeal(sub.id);
    // 어떤 경로로 왔든 이 명령은 여기서 끝난다 — 스폰 진행 표식이 남아 있으면 걷는다.
    this.clearDispatching(sub.id);
    // 이 턴의 도장을 내린다. 뒤늦게 흘러드는 백단 여운은 도장 없이 오고, 그중 끝 통지는
    //   `stampTurnId` 가 **시작한 턴**을 되찾아 찍으므로 제 블록으로 돌아간다.
    if (this.currentTurnId.get(sub.id) === cmd.id) this.currentTurnId.delete(sub.id);
    let resultText = initialResultText;
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

    // stdout에서 못 읽으면 JSONL 폴백.
    if (!resultText && sub.sessionId) {
      resultText = readLastAssistantMessage(parentCwd, sub.sessionId) ?? undefined;
    }

    if (resultText) {
      sub.lastResult = resultText;
      cmd.result = resultText;
    }

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
    const isErr = killed || (code !== null && code !== 0);
    sub.status = userStopped ? 'idle' : (isErr ? 'error' : 'idle');
    sub.lastActivityAt = Date.now();
    cmd.status = userStopped ? 'completed' : (killed ? 'error' : ((code === null || code === 0) ? 'completed' : 'error'));
    if (userStopped) cmd.result = `[Stopped by user]${resultText ? `\n\n${resultText}` : ''}`;
    else if (killed) cmd.result = `[Stopped: max turns reached (${turnCount}/${maxTurns})]${resultText ? `\n\n${resultText}` : ''}`;

    // §5.5 #17-12 ③ — 오류로 끝났으면 **왜** 인지를 명령에 남긴다. 종전엔 상태만 error 로 바꾸고
    //   종료 코드·stderr 를 통째로 버려서, 화면에는 "오류" 한 단어만 남고 사용자가 원인을 알 길이 없었다.
    if (cmd.status === 'error') {
      const stderrTail = this.childStderrTails.get(sub.id)?.trim();
      if (killed) {
        this.failCommand(sub, cmd, { code: 'maxTurns', detail: `${turnCount}/${maxTurns}` });
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
