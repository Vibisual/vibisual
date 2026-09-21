import { spawn, type ChildProcess } from 'node:child_process';
import { observeChildStreamErrors } from './childStreamErrors.js';
import { existsSync } from 'node:fs';
import { codexEdgeOverrides, codexTurnHooks, type CodexEdgeConfig, type CodexPermissionHookConfig } from './codexEdges.js';
import { prepareCodexHooks } from './codexHookTrust.js';
import { AGENT_CARD_ENV_AUTH, AGENT_CARD_ENV_TOKEN, resolveCodexPermission, type AgentProvider } from '@vibisual/shared';
import { getCodexBin } from './codexCli.js';
import { buildCliInvocation } from './claudeCliRun.js';
import { augmentedEnv } from './binLocator.js';
import { processGroupSpawnOptions, killTree } from './processTree.js';
import { mapCodexLine, codexFileChangePaths, type CodexMappedEvent, type CodexUsage } from './codexStreamMap.js';
import { createCodexPendingCallLedger } from './codexPendingCalls.js';
import { CODEX_TURN_IDLE_CHECK_MS, CODEX_TURN_IDLE_NOTICE_MS, CODEX_TURN_IDLE_SETTLE_MS, CODEX_MCP_CALL_DEADLINE_MS } from '@vibisual/shared';
import { logger } from '../logger.js';
import type { CodexToolHookConfig } from './codexEdges.js';
import { codexToolOverrides } from './codexToolOverrides.js';
import { codexVerificationOverrides, verificationToolsAvailable, type VerificationToolsConfig } from './verificationToolsConfig.js';

/**
 * §5.25 (F) — 코덱스 턴 하나를 돌린다.
 *
 * 클로드 경로와 같은 모양(외부 CLI 를 자식으로 띄우고 JSONL 을 읽는다)이지만, **턴 루프를 우리가
 * 돌지 않는다**는 점이 §5.19 로컬 러너와 다르다 — 대화 이력·컨텍스트 자르기·재개는 CLI 몫이라
 * 우리가 `messages[]` 를 들지 않는다.
 *
 * **프롬프트는 stdin 으로 준다.** 인자로 주면 OS 별 명령줄 길이 상한(Windows 는 약 32K)에 걸려
 * 긴 프롬프트가 조용히 잘린다. 인자와 stdin 을 **함께** 주면 코덱스가 stdin 을 별도 블록으로
 * 덧붙이므로(공식 동작), 프롬프트는 stdin **한 곳**으로만 보낸다.
 */

type CodexOverrides = Pick<AgentProvider, 'webSearch' | 'networkAccess' | 'modelVerbosity' | 'reasoningSummary' | 'personality' | 'serviceTier' | 'autoCompactTokenLimit'>;

export interface CodexTurnArgs extends CodexOverrides {
  verificationConfig?: VerificationToolsConfig;
  /** Native Codex context overrides, computed from the same sources shown in the context panel. */
  contextArgs?: string[];
  toolHook?: CodexToolHookConfig;
  edgeConfig?: CodexEdgeConfig;
  /**
   * §5.25 (H) — 권한 다리. 있으면 매 턴 PreToolUse·PermissionRequest 훅이 승인 창구와 감사 원장으로
   * 잇는다. `required` 인데 못 붙이면 턴을 거절한다(승인 모드·감사 경계가 조용히 꺼진 채 돌지 않게).
   */
  permissionHook?: CodexPermissionHookConfig;
  subAgentId: string;
  /** 이 세션의 작업 폴더. `-C` 로 넘어간다. */
  cwd: string;
  /** 사용자 프롬프트(우리가 붙이는 컨텍스트까지 합친 최종 본문). */
  prompt: string;
  /** 모델 slug. 비어 있으면 CLI 설정의 모델을 사용한다(첫 로그인에는 모델 캐시가 없을 수 있다). */
  model: string;
  /** 추론 강도. 모델이 신고한 단계만 올라온다. 없으면 안 싣는다. */
  reasoningEffort?: string;
  /** 우리 권한 모드. 코덱스의 두 축으로 옮겨진다(§5.25 (H)). */
  permissionMode?: string;
  /** 이어갈 스레드 id. 없으면 새 스레드. */
  resumeThreadId?: string;
  /** 프롬프트와 함께 Codex vision 입력으로 넘길 이미지 경로. */
  images?: string[];
  /** Agent Studio 카드/목표 프로토콜 등이 사용하는 턴별 환경변수. */
  env?: Record<string, string>;
  /**
   * §5.25 (I) — 이 자식이 물려받을 소유자 태그.
   *
   * 사용자가 코덱스 훅을 켜 두면 **우리가 띄운 세션의 훅도** 우리 서버로 들어온다. 이 값이 없으면
   * 그 이벤트가 주인 없는 세션으로 읽혀 같은 대화에 **버블이 하나 더** 생긴다(클로드 CMD 버블이
   * 이미 겪은 자리 — `VIBISUAL_OWNER_AGENT_ID` 가 그 해법이었다). `handler.mjs` 가 이 env 를 읽어
   * 본문에 실어 주므로 서버는 기존 귀속 경로를 그대로 탄다.
   */
  ownerAgentId?: string;
  ownerTermId?: string;
  onEvent: (event: CodexMappedEvent) => void;
  onThread: (threadId: string) => void;
  onUsage: (usage: CodexUsage) => void;
  /** 캔버스 파일 버블용 — 코덱스가 고친 파일 경로(§5.25 (F)). */
  onFileWrites: (paths: string[]) => void;
  /** 턴 종료. `error` 가 있으면 실패다. */
  onDone: (error: string | undefined, finalText: string) => void;
  /** Actual stdout/stderr activity, including chunks without a mapped UI event. */
  onActivity?: (at: number) => void;
  /**
   * **자식은 살아 있는데 출력이 끊겼다.** 두 단계로 온다:
   *  - `stalled: false` — 1단계(`CODEX_TURN_IDLE_NOTICE_MS`). 알림일 뿐 아무것도 닫지 않는다.
   *  - `stalled: true` — 2단계(`CODEX_TURN_IDLE_SETTLE_MS`). 이 호출 **직후** 우리가 트리를 종료하고
   *    마감 경로를 태운다. 받는 쪽은 이걸 **2차 마감 입구**로 써도 된다 — `onDone` 은 멱등해야 한다.
   */
  onIdle?: (info: { idleMs: number; stalled: boolean }) => void;
}

/**
 * 턴 마감 대기 시간과 트리 종료 함수. 기본값으로 돌고, 테스트만 줄여 넣는다.
 *
 * 왜 `close` 하나만 기다리지 않는가 — Node 의 `close` 는 **stdio 가 전부 닫혀야** 온다. 코덱스가 띄운
 * 셸 명령 중 하나가 우리 파이프를 물려받은 채 트리에서 빠져나가면(중간 프로세스가 먼저 끝나 부모를
 * 잃은 손자는 `taskkill /T` 가 못 찾는다), 코덱스 본체가 죽어도 `close` 는 그 손자가 끝날 때까지 안 온다.
 * 그동안 턴은 "실행 중"으로 남고 [중지]는 이미 죽은 pid 만 다시 죽인다 — 실제로 14분을 붙잡혔다.
 */
export interface CodexTurnLifecycleOptions {
  /** 본체 `exit` 뒤 `close` 를 기다리는 최대 시간. 남은 출력이 흘러들 여유다. */
  exitCloseGraceMs?: number;
  /** [중지] 뒤 `exit` 도 `close` 도 안 올 때 강제로 마감하기까지의 시간. */
  stopSettleTimeoutMs?: number;
  /** 정지 워치독 점검 주기. 이 타이머만이 **자식이 살아 있는 동안** 도는 유일한 타이머다. */
  idleCheckMs?: number;
  /** 1단계 — 출력이 이만큼 끊기면 위로 알린다(마감하지 않는다). */
  idleNoticeMs?: number;
  /** 2단계 — 이만큼 끊기면 트리를 종료하고 마감한다. */
  idleSettleMs?: number;
  /** 짝 없는 MCP 도구 호출을 합성 결과로 닫기까지의 시한. */
  mcpCallDeadlineMs?: number;
  killTree?: (pid: number | undefined) => void;
}

const DEFAULT_EXIT_CLOSE_GRACE_MS = 2000;
const DEFAULT_STOP_SETTLE_TIMEOUT_MS = 3000;

interface RunningTurn {
  child: ChildProcess;
  /** 사용자가 [중지]를 눌렀나 — 종료 사유를 실패로 적지 않기 위한 표식. */
  stopped: boolean;
  /** 본체가 끝났나(`exit`). 파이프를 쥔 손자 때문에 `close` 는 한참 뒤일 수 있다. */
  exited: boolean;
  /** 트리 종료 → `exit` 가 오면 곧바로, 안 오면 시한 뒤 마감한다. 여러 번 불려도 한 번만 끝낸다. */
  requestStop: () => void;
}

const running = new Map<string, RunningTurn>();
const preparing = new Map<string, AbortController>();

/** 이 세션의 코덱스 턴이 지금 도는가. */
export function isCodexTurnRunning(subAgentId: string): boolean {
  return running.has(subAgentId) || preparing.has(subAgentId);
}

/**
 * §5.25 (F) — [중지]. 클로드 경로와 같이 **자식을 트리째 종료**한다
 * (로컬 러너의 "생성 중단"과 다르다 — 여기서 도는 것은 남의 프로세스다).
 * 마감은 `close` 를 기다리지 않는다 — {@link CodexTurnLifecycleOptions} 참조.
 */
export function stopCodexTurn(subAgentId: string): boolean {
  const preparation = preparing.get(subAgentId);
  if (preparation) { preparation.abort(); return true; }
  const turn = running.get(subAgentId);
  if (!turn) return false;
  turn.requestStop();
  return true;
}

/**
 * 스폰 인자 조립. **순수 함수라 테스트로 고정한다** — 여기가 틀리면 모든 코덱스 턴이 같은
 * 방식으로 죽고, 그 사고는 실행해 보지 않으면 안 보인다.
 */
export function buildCodexExecArgs(args: {
  verificationConfig?: VerificationToolsConfig;
  contextArgs?: readonly string[];
  toolHook?: CodexToolHookConfig;
  edgeConfig?: CodexEdgeConfig;
  permissionHook?: CodexPermissionHookConfig;
  platform?: NodeJS.Platform;
  cwd: string;
  model: string;
  reasoningEffort?: string;
  permissionMode?: string;
  resumeThreadId?: string;
  images?: readonly string[];
} & CodexOverrides): string[] {
  const { sandbox, approval } = resolveCodexPermission(args.permissionMode);
  // `-C`와 `-s`는 `exec resume`가 받지 않는 상위 옵션이다. 반드시 하위명령보다 앞에 둔다.
  // 실제 CLI는 `codex exec resume <id> -C ...`를 `unexpected argument '-C'`로 거부한다.
  const out: string[] = ['exec', '-C', args.cwd, '-s', sandbox];
  if (args.resumeThreadId) out.push('resume', args.resumeThreadId);
  out.push('--json');
  // 프로젝트가 git 저장소가 아닐 수 있다 — 그때 코덱스는 기본적으로 실행을 거절한다.
  out.push('--skip-git-repo-check');
  // 선택한 모델만 덮어쓴다. 캐시가 아직 없는 첫 실행도 CLI 기본값으로 시작할 수 있어야 한다.
  if (args.model) out.push('-m', args.model);
  // `exec` 에는 `--ask-for-approval` 플래그가 없다(루트 명령 전용) — 같은 값을 설정 오버라이드로
  //   싣는다. 사용자의 설정 파일은 건드리지 않는다(§5.25 (G)).
  out.push('-c', `approval_policy=${approval}`);
  // §5.25 (H) — `exec` 는 승인 검토자가 사람(user, 기본값)이면 on-request 를 never 로 낮춘다(0.154 실측) —
  //   그래서 "요청 시 승인" 모드가 한 번도 묻지 않았다. 검토자를 auto_review 로 두면 on-request 가 살고,
  //   검토자 모델보다 **먼저** 도는 PermissionRequest 훅이 우리 승인 카드로 답한다. 훅이 없으면 모델이
  //   사람 대신 판정하게 되므로 권한 다리가 붙는 턴에만 싣는다(훅은 실패해도 반드시 거부로 답한다).
  if (approval === 'on-request' && args.permissionHook) out.push('-c', 'approvals_reviewer="auto_review"');
  if (args.reasoningEffort) out.push('-c', `model_reasoning_effort=${args.reasoningEffort}`);
  if (args.webSearch) out.push('-c', `web_search=${args.webSearch}`);
  if (args.modelVerbosity) out.push('-c', `model_verbosity=${args.modelVerbosity}`);
  if (args.reasoningSummary) out.push('-c', `model_reasoning_summary=${JSON.stringify(args.reasoningSummary)}`);
  if (args.personality) out.push('-c', `personality=${JSON.stringify(args.personality)}`);
  if (args.serviceTier) out.push('-c', `service_tier=${JSON.stringify(args.serviceTier)}`);
  if (Number.isSafeInteger(args.autoCompactTokenLimit) && args.autoCompactTokenLimit! > 0) out.push('-c', `model_auto_compact_token_limit=${args.autoCompactTokenLimit}`);
  if (sandbox === 'workspace-write' && typeof args.networkAccess === 'boolean') {
    out.push('-c', `sandbox_workspace_write.network_access=${args.networkAccess}`);
  }
  out.push(...(args.contextArgs ?? []));
  if (args.edgeConfig) out.push(...codexEdgeOverrides(args.edgeConfig, { hooks: false }));
  if (args.verificationConfig) out.push(...codexVerificationOverrides(args.verificationConfig));
  out.push(...codexToolOverrides(args.toolHook?.policy));
  out.push(...codexTurnHooks(args.edgeConfig, args.permissionHook, args.platform ?? process.platform, args.toolHook).overrides);
  for (const imagePath of args.images ?? []) {
    if (imagePath.trim()) out.push('-i', imagePath);
  }
  return out;
}

/**
 * 턴 시작. 실패도 `onDone(error, ...)` 으로만 알린다(throw ❌ — 호출자는 이벤트 루프 안이다).
 */
export function runCodexTurn(args: CodexTurnArgs): void {
  startCodexTurn(args);
}

function startCodexTurn(args: CodexTurnArgs, hookTrust?: string[]): void {
  if (args.verificationConfig && !verificationToolsAvailable(args.verificationConfig)) {
    args.onDone('Verification tools unavailable: Node.js or verification-tools.mjs missing', '');
    return;
  }
  if (args.toolHook && (!args.toolHook.nodeBin || !existsSync(args.toolHook.helperPath))) {
    args.onDone('Codex tool permissions unavailable: Node.js or codex-edges.mjs missing', '');
    return;
  }
  if (args.edgeConfig && (!args.edgeConfig.nodeBin || !existsSync(args.edgeConfig.helperPath))) {
    args.onDone('Codex edge enforcement unavailable: Node.js or codex-edges.mjs missing', '');
    return;
  }
  const binPath = getCodexBin();
  if (!binPath) {
    args.onDone('codex CLI not found', '');
    return;
  }

  if (args.permissionHook && (!args.permissionHook.nodeBin || !existsSync(args.permissionHook.helperPath))) {
    if (args.permissionHook.required) {
      args.onDone('Codex permission hooks unavailable: Node.js or codex-edges.mjs missing', '');
      return;
    }
    logger.warn('[codex] permission hooks unavailable (Node.js or codex-edges.mjs missing); running without audit bridge');
    startCodexTurn({ ...args, permissionHook: undefined }, hookTrust);
    return;
  }

  const hooks = codexTurnHooks(args.edgeConfig, args.permissionHook, process.platform, args.toolHook);
  if (hooks.expected.length && !hookTrust) {
    const controller = new AbortController();
    preparing.set(args.subAgentId, controller);
    const overrides = [...(args.edgeConfig ? codexEdgeOverrides(args.edgeConfig, { hooks: false }) : []), ...hooks.overrides];
    void prepareCodexHooks(binPath, args.cwd, overrides, hooks.expected, controller.signal).then((trust) => {
      preparing.delete(args.subAgentId);
      if (controller.signal.aborted) args.onDone(undefined, '');
      else startCodexTurn(args, trust);
    }).catch((error) => {
      preparing.delete(args.subAgentId);
      if (controller.signal.aborted) args.onDone(undefined, '');
      else if (args.toolHook) args.onDone(`Codex tool permissions unavailable: ${error.message}`, '');
      else if (args.edgeConfig?.restrictedTools.length) args.onDone(`Codex edge enforcement unavailable: ${error.message}`, '');
      else if (args.permissionHook?.required) args.onDone(`Codex permission hooks unavailable: ${error.message}`, '');
      else if (args.permissionHook) {
        // 승인 모드도 감사 경계도 이 턴을 붙잡지 않는다 — 원장 기록만 잃고 종전처럼 돈다.
        logger.warn(`[codex] permission hooks unavailable: ${error.message}; running without audit bridge`);
        startCodexTurn({ ...args, permissionHook: undefined });
      } else args.onDone(`Codex hooks unavailable: ${error.message}`, '');
    });
    return;
  }

  const execArgs = buildCodexExecArgs({
    verificationConfig: args.verificationConfig,
    contextArgs: args.contextArgs,
    toolHook: args.toolHook,
    edgeConfig: args.edgeConfig,
    ...(args.permissionHook ? { permissionHook: args.permissionHook } : {}),
    cwd: args.cwd,
    model: args.model,
    webSearch: args.webSearch,
    networkAccess: args.networkAccess,
    modelVerbosity: args.modelVerbosity,
    ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
    ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
    ...(args.resumeThreadId ? { resumeThreadId: args.resumeThreadId } : {}),
    ...(args.images?.length ? { images: args.images } : {}),
  });
  if (hookTrust) execArgs.push(...hookTrust);
  const invocation = buildCliInvocation(binPath, execArgs, process.platform);

  let child: ChildProcess;
  try {
    child = spawn(invocation.file, invocation.args, {
      shell: invocation.shell,
      windowsHide: true,
      cwd: args.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: augmentedEnv({
        ...process.env,
        ...(args.env ?? {}),
        // Keep only Vibisual auth available under Codex's default TOKEN-name exclusion.
        ...(args.env?.[AGENT_CARD_ENV_TOKEN] ? { [AGENT_CARD_ENV_AUTH]: args.env[AGENT_CARD_ENV_TOKEN] } : {}),
        ...(args.ownerAgentId ? { VIBISUAL_OWNER_AGENT_ID: args.ownerAgentId } : {}),
        ...(args.ownerTermId ? { VIBISUAL_OWNER_TERM_ID: args.ownerTermId } : {}),
        ...(args.edgeConfig ? { VIBISUAL_CODEX_EDGE_IDS: JSON.stringify(args.edgeConfig.edgeIds) } : {}),
        // §5.25 (H) — 권한 다리가 승인 카드를 이 세션의 스트림 줄로 되돌리는 키.
        // §5.3 #10-2 — 엣지 다리는 같은 키로 dispatch 결과를 이 턴에 묶는다(결과를 받기 전엔 완료로 끝나지 않게).
        ...(args.permissionHook || args.toolHook || args.edgeConfig || args.verificationConfig ? { VIBISUAL_SUBAGENT_ID: args.subAgentId } : {}),
      }),
      // 오래 사는 자식이라 POSIX 에서 그룹 리더로 띄운다 — 안 그러면 [중지]가 손자를 남긴다.
      ...processGroupSpawnOptions(),
    });
  } catch (err) {
    args.onDone(`spawn failed: ${err instanceof Error ? err.message : String(err)}`, '');
    return;
  }

  attachCodexTurn(child, args);

  // 프롬프트는 stdin 한 곳으로만 보낸다(위 주석 참조).
  try {
    child.stdin?.write(args.prompt);
    child.stdin?.end();
  } catch (err) {
    logger.warn(`[codex] stdin write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 띄운 자식에 턴 수명을 건다 — 출력 해석, [중지], 마감. **`onDone` 은 정확히 한 번** 부른다.
 *
 * 마감 경로는 셋이고 먼저 온 것이 이긴다:
 *   ① `close` — 평소 경로. 출력이 전부 흘러든 뒤라 판정이 가장 정확하다.
 *   ② `exit` 뒤 `exitCloseGraceMs` — 본체는 끝났는데 물려받은 파이프 때문에 `close` 가 안 오는 경우.
 *   ③ [중지] 뒤 `exit` 즉시, 또는 그것도 없으면 `stopSettleTimeoutMs` — 사용자가 멈추라 했다.
 *
 * 테스트가 가짜 자식으로 이 수명을 고정하도록 내보낸다(스폰·실행본 탐색과 분리).
 */
export function attachCodexTurn(
  child: ChildProcess,
  args: Pick<CodexTurnArgs, 'subAgentId' | 'onEvent' | 'onThread' | 'onUsage' | 'onFileWrites' | 'onDone' | 'onIdle' | 'onActivity'>,
  options: CodexTurnLifecycleOptions = {},
): void {
  const exitCloseGraceMs = options.exitCloseGraceMs ?? DEFAULT_EXIT_CLOSE_GRACE_MS;
  const stopSettleTimeoutMs = options.stopSettleTimeoutMs ?? DEFAULT_STOP_SETTLE_TIMEOUT_MS;
  const idleCheckMs = options.idleCheckMs ?? CODEX_TURN_IDLE_CHECK_MS;
  const idleNoticeMs = options.idleNoticeMs ?? CODEX_TURN_IDLE_NOTICE_MS;
  const idleSettleMs = options.idleSettleMs ?? CODEX_TURN_IDLE_SETTLE_MS;
  const kill = options.killTree ?? killTree;
  /** 짝 없는 MCP 호출의 미결 원장 — 이 턴과 생애가 같다(§5.25 (F)). */
  const pendingCalls = createCodexPendingCallLedger(options.mcpCallDeadlineMs ?? CODEX_MCP_CALL_DEADLINE_MS);

  let stdoutBuffer = '';
  let stderrTail = '';
  let finalText = '';
  let turnError: string | undefined;
  /** 턴이 끝났다고 신고된 뒤에도 프로세스 종료까지 몇 밀리초가 남는다 — 사유는 첫 것을 지킨다. */
  let sawTurnEnd = false;
  let settled = false;
  let exitCode: number | null = null;
  let settleTimer: NodeJS.Timeout | undefined;
  /** 마지막으로 이 자식이 무언가를 뱉은 시각 — 정지 워치독의 유일한 사실. */
  let lastActivityAt = Date.now();
  /** 1단계 알림을 이미 보냈는가(한 정지 구간에 한 번만 보낸다). */
  let idleNoticed = false;
  let idleTimer: NodeJS.Timeout | undefined;
  let lastReportedActivityAt: number | undefined;

  const clearSettleTimer = (): void => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = undefined;
  };

  const clearIdleTimer = (): void => {
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = undefined;
  };

  const noteActivity = (): void => {
    if (settled) return;
    lastActivityAt = Date.now();
    idleNoticed = false;
    // Reuse the watchdog interval to bound UI traffic. Timers alone never
    // report activity; quiet reasoning/tools must remain distinguishable.
    if (lastReportedActivityAt === undefined || lastActivityAt - lastReportedActivityAt >= idleCheckMs) {
      lastReportedActivityAt = lastActivityAt;
      args.onActivity?.(lastActivityAt);
    }
  };

  const emitAll = (events: CodexMappedEvent[]): void => {
    for (const ev of events) args.onEvent(ev);
  };

  const finish = (error: string | undefined, text: string): void => {
    if (settled) return;
    settled = true;
    clearSettleTimer();
    clearIdleTimer();
    // 아직 짝을 못 찾은 도구 카드를 **전부** 닫는다 — 안 닫으면 턴이 끝난 대화에 도는 중 카드가 남는다.
    emitAll(pendingCalls.flush('turn closed'));
    // 같은 세션의 **다음 턴**이 이미 자리를 잡았을 수 있다(즉시 덧말 → 중지 → 새 턴). 늦게 온 옛 자식의
    //   `close` 가 새 턴 표식을 지우면 그 턴은 [중지]로 못 멈춘다 — 내 것일 때만 지운다.
    if (running.get(args.subAgentId) === turn) running.delete(args.subAgentId);
    args.onDone(error, text);
  };

  const conclude = (code: number | null): void => {
    if (settled) return;
    // 남은 꼬리 줄(개행 없이 끝난 마지막 줄)도 처리한다.
    if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
    stdoutBuffer = '';

    if (turn.stopped) {
      finish(undefined, finalText);
      return;
    }
    if (turnError) {
      finish(turnError, finalText);
      return;
    }
    if (code !== null && code !== 0) {
      const tail = stderrTail.trim().slice(-300);
      finish(tail || `codex exited with code ${code}`, finalText);
      return;
    }
    if (!sawTurnEnd && !finalText) {
      // 정상 종료인데 턴 종료도 답도 없다 — 조용한 실패라 사유를 남긴다.
      const tail = stderrTail.trim().slice(-300);
      finish(tail || 'codex produced no output', '');
      return;
    }
    finish(undefined, finalText);
  };

  /**
   * `close` 없이 마감한다. 타이머 뒤 한 번 더 `setImmediate` 로 미루는 이유 — 이벤트 루프가 오래 막혔다
   * 풀리면 타이머가 파이프 읽기보다 먼저 돈다. 한 칸 미루면 그 사이 도착한 출력(마지막 답)을 먼저 읽는다.
   */
  const settleWithoutClose = (): void => {
    settleTimer = undefined;
    setImmediate(() => {
      if (settled) return;
      // 시한 안에 `exit` 조차 없었다 — 첫 트리 종료가 빗나갔다. 아직 우리 자식이라 pid 가 유효하니 한 번 더 보낸다.
      if (turn.stopped && !turn.exited) kill(child.pid);
      conclude(exitCode);
      if (turn.stopped) {
        // 사용자가 멈춘 턴이다 — 빠져나간 손자의 출력은 더 받지 않는다.
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    });
  };

  const armSettleTimer = (ms: number): void => {
    clearSettleTimer();
    settleTimer = setTimeout(settleWithoutClose, ms);
    settleTimer.unref?.();
  };

  const turn: RunningTurn = {
    child,
    stopped: false,
    exited: false,
    requestStop: () => {
      if (settled) return;
      const first = !turn.stopped;
      turn.stopped = true;
      if (turn.exited) {
        // 본체는 이미 끝났다 — 죽은 pid 에 트리 종료를 다시 보내지 않는다(그 번호를 OS 가 재사용했을 수 있다).
        armSettleTimer(0);
        return;
      }
      if (first) kill(child.pid);
      if (!settleTimer) armSettleTimer(stopSettleTimeoutMs);
    },
  };
  running.set(args.subAgentId, turn);

  /**
   * **정지 워치독** — 자식이 살아 있는 동안 도는 유일한 타이머.
   *
   * 종전에는 마감 타이머가 `exit`(:child.on) 과 [중지] 두 곳에서만 걸렸다. 그래서 자식이
   * 살아 있는데 출력만 끊기면 **타이머가 하나도 돌지 않아** 턴이 영원히 열려 있었다
   * (2026-09-20 MCP `CONNECT_TIMEOUT` 사고). 두 단계로 나누는 이유는, 조용한 것이 곧
   * 멈춘 것은 아니기 때문이다 — 1단계는 알리기만 하고 2단계만 걷는다.
   */
  const watchdogTick = (): void => {
    if (settled) return;
    const now = Date.now();
    // 미결 도구 카드부터 닫는다. 턴이 계속 돌더라도 화면의 거짓 "도는 중"은 여기서 끝난다.
    emitAll(pendingCalls.overdue(now));
    // 본체가 끝났거나 사용자가 멈춘 턴은 마감 주인이 따로 있다 — 두 주인이 다투지 않게 비킨다.
    if (turn.exited || turn.stopped) return;
    const idleMs = now - lastActivityAt;
    if (idleMs >= idleSettleMs) {
      clearIdleTimer();
      turnError ??= `codex turn stalled: no output for ${Math.round(idleMs / 1000)}s`;
      // 받는 쪽의 **2차 마감 입구**를 먼저 연다 — 아래 마감이 `close` 를 못 받고 묻히더라도
      //   명령이 `executing` 에 굳지 않게(그쪽 마감은 멱등이라 두 번 닫히지 않는다).
      args.onIdle?.({ idleMs, stalled: true });
      logger.warn(`[codex] turn stalled sub=${args.subAgentId} idle=${Math.round(idleMs / 1000)}s - killing tree`);
      kill(child.pid);
      armSettleTimer(0);
      return;
    }
    if (!idleNoticed && idleMs >= idleNoticeMs) {
      idleNoticed = true;
      args.onIdle?.({ idleMs, stalled: false });
    }
  };
  idleTimer = setInterval(watchdogTick, idleCheckMs);
  idleTimer.unref?.();

  observeChildStreamErrors(child, (stream, error) => {
    if (settled) return;
    // A stopped turn can still have queued writes. Preserve its exit/close deadline,
    // fallback tree kill and pipe cleanup instead of settling early on that error.
    if (turn.stopped) return;
    if (stream === 'stdin' && sawTurnEnd) return;
    turnError ??= `codex ${stream} failed: ${error.message}`;
    if (!turn.exited) kill(child.pid);
    finish(turnError, finalText);
  });

  const handleLine = (line: string): void => {
    const mapped = mapCodexLine(line);
    if (!mapped) {
      if (line.trim()) logger.debug(`[codex] unmapped line: ${line.slice(0, 200)}`);
      return;
    }
    if (mapped.threadId) args.onThread(mapped.threadId);
    if (mapped.usage) args.onUsage(mapped.usage);
    if (mapped.finalText) finalText = mapped.finalText;
    if (mapped.turnEnded) sawTurnEnd = true;
    if (mapped.error && !turnError) turnError = mapped.error;
    for (const ev of mapped.events) {
      // 원장이 먼저 본다 — `tool_use` 는 등록, `tool_result` 는 해제. 화면으로 나가는 것은 그대로다.
      pendingCalls.note(ev);
      args.onEvent(ev);
    }

    // 파일 버블 — 고친 파일이 있으면 경로를 흘린다. 매핑 결과가 아니라 원문에서 다시 뽑는 이유는
    //   화면 이벤트(도구 카드)와 캔버스(파일 버블)가 서로 다른 것을 필요로 하기 때문이다.
    const paths = extractFileWrites(line);
    if (paths.length > 0) args.onFileWrites(paths);
  };

  child.stdout?.on('data', (chunk) => {
    if (settled || chunk.length === 0) return;
    noteActivity();
    stdoutBuffer += String(chunk);
    let idx = stdoutBuffer.indexOf('\n');
    while (idx >= 0) {
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      handleLine(line);
      idx = stdoutBuffer.indexOf('\n');
    }
  });

  child.stderr?.on('data', (chunk) => {
    if (settled || chunk.length === 0) return;
    // 진행 로그도 활동이다 — 이걸 안 세면 stdout 이 조용한 긴 도구가 정지로 읽힌다.
    noteActivity();
    const text = String(chunk);
    stderrTail = (stderrTail + text).slice(-2000);
  });

  child.on('error', (err) => {
    // 스폰 실패 뒤 `close` 가 뒤따를 수 있다 — `finish` 가 한 번만 알린다.
    finish(`spawn failed: ${err.message}`, finalText);
  });

  child.on('exit', (code) => {
    turn.exited = true;
    exitCode = code;
    if (settled) return;
    armSettleTimer(turn.stopped ? 0 : exitCloseGraceMs);
  });

  child.on('close', (code) => {
    conclude(code);
  });
}

/**
 * 한 줄에서 "고친 파일 경로"만 뽑는다. 캔버스 파일 버블용이라 **쓰기만** 센다
 * (읽기는 코덱스가 별도 item 으로 말해 주지 않는다 — 없는 것을 넘겨짚지 않는다).
 */
export function extractFileWrites(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const o = parsed as Record<string, unknown>;
  // 완료된 변경만 센다 — 시작 시점에는 아직 파일이 없을 수 있고, 실행되지 않은 변경에
  //   쓰기 화살표를 세우면 그건 거짓이다(§2.1 Bash 쓰기 축이 사후에만 흘리는 것과 같은 이유).
  if (o['type'] !== 'item.completed') return [];
  const item = o['item'];
  if (!item || typeof item !== 'object') return [];
  const rec = item as Record<string, unknown>;
  if (rec['type'] !== 'file_change') return [];
  return codexFileChangePaths(rec);
}
