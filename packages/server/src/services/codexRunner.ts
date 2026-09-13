import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { codexEdgeOverrides, type CodexEdgeConfig } from './codexEdges.js';
import { prepareCodexEdgeHook } from './codexHookTrust.js';
import { resolveCodexPermission, type AgentProvider } from '@vibisual/shared';
import { getCodexBin } from './codexCli.js';
import { buildCliInvocation } from './claudeCliRun.js';
import { augmentedEnv } from './binLocator.js';
import { processGroupSpawnOptions, killTree } from './processTree.js';
import { mapCodexLine, codexFileChangePaths, type CodexMappedEvent, type CodexUsage } from './codexStreamMap.js';
import { logger } from '../logger.js';

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

type CodexOverrides = Pick<AgentProvider, 'webSearch' | 'networkAccess' | 'modelVerbosity'>;

export interface CodexTurnArgs extends CodexOverrides {
  edgeConfig?: CodexEdgeConfig;
  subAgentId: string;
  /** 이 세션의 작업 폴더. `-C` 로 넘어간다. */
  cwd: string;
  /** 사용자 프롬프트(우리가 붙이는 컨텍스트까지 합친 최종 본문). */
  prompt: string;
  /** 모델 slug. **항상 명시한다**(§5.25 (G) — 사용자 개인 설정 기본값에 끌려가지 않게). */
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
}

interface RunningTurn {
  child: ChildProcess;
  /** 사용자가 [중지]를 눌렀나 — 종료 사유를 실패로 적지 않기 위한 표식. */
  stopped: boolean;
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
 */
export function stopCodexTurn(subAgentId: string): boolean {
  const preparation = preparing.get(subAgentId);
  if (preparation) { preparation.abort(); return true; }
  const turn = running.get(subAgentId);
  if (!turn) return false;
  turn.stopped = true;
  killTree(turn.child.pid);
  return true;
}

/**
 * 스폰 인자 조립. **순수 함수라 테스트로 고정한다** — 여기가 틀리면 모든 코덱스 턴이 같은
 * 방식으로 죽고, 그 사고는 실행해 보지 않으면 안 보인다.
 */
export function buildCodexExecArgs(args: {
  edgeConfig?: CodexEdgeConfig;
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
  out.push('-m', args.model);
  // `exec` 에는 `--ask-for-approval` 플래그가 없다(루트 명령 전용) — 같은 값을 설정 오버라이드로
  //   싣는다. 사용자의 설정 파일은 건드리지 않는다(§5.25 (G)).
  out.push('-c', `approval_policy=${approval}`);
  if (args.reasoningEffort) out.push('-c', `model_reasoning_effort=${args.reasoningEffort}`);
  if (args.webSearch) out.push('-c', `web_search=${args.webSearch}`);
  if (args.modelVerbosity) out.push('-c', `model_verbosity=${args.modelVerbosity}`);
  if (sandbox === 'workspace-write' && typeof args.networkAccess === 'boolean') {
    out.push('-c', `sandbox_workspace_write.network_access=${args.networkAccess}`);
  }
  if (args.edgeConfig) out.push(...codexEdgeOverrides(args.edgeConfig));
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
  if (args.edgeConfig && (!args.edgeConfig.nodeBin || !existsSync(args.edgeConfig.helperPath))) {
    args.onDone('Codex edge enforcement unavailable: Node.js or codex-edges.mjs missing', '');
    return;
  }
  const binPath = getCodexBin();
  if (!binPath) {
    args.onDone('codex CLI not found', '');
    return;
  }
  if (!args.model) {
    args.onDone('no model selected', '');
    return;
  }

  if (args.edgeConfig?.restrictedTools.length && !hookTrust) {
    const controller = new AbortController();
    preparing.set(args.subAgentId, controller);
    void prepareCodexEdgeHook(binPath, args.cwd, args.edgeConfig, controller.signal).then((trust) => {
      preparing.delete(args.subAgentId);
      if (controller.signal.aborted) args.onDone(undefined, '');
      else startCodexTurn(args, trust);
    }).catch((error) => {
      preparing.delete(args.subAgentId);
      args.onDone(controller.signal.aborted ? undefined : `Codex edge enforcement unavailable: ${error.message}`, '');
    });
    return;
  }

  const execArgs = buildCodexExecArgs({
    edgeConfig: args.edgeConfig,
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
        ...(args.ownerAgentId ? { VIBISUAL_OWNER_AGENT_ID: args.ownerAgentId } : {}),
        ...(args.ownerTermId ? { VIBISUAL_OWNER_TERM_ID: args.ownerTermId } : {}),
        ...(args.edgeConfig ? { VIBISUAL_CODEX_EDGE_IDS: JSON.stringify(args.edgeConfig.edgeIds) } : {}),
      }),
      // 오래 사는 자식이라 POSIX 에서 그룹 리더로 띄운다 — 안 그러면 [중지]가 손자를 남긴다.
      ...processGroupSpawnOptions(),
    });
  } catch (err) {
    args.onDone(`spawn failed: ${err instanceof Error ? err.message : String(err)}`, '');
    return;
  }

  const turn: RunningTurn = { child, stopped: false };
  running.set(args.subAgentId, turn);

  // 프롬프트는 stdin 한 곳으로만 보낸다(위 주석 참조).
  try {
    child.stdin?.write(args.prompt);
    child.stdin?.end();
  } catch (err) {
    logger.warn(`[codex] stdin write failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let stdoutBuffer = '';
  let stderrTail = '';
  let finalText = '';
  let turnError: string | undefined;
  /** 턴이 끝났다고 신고된 뒤에도 프로세스 종료까지 몇 밀리초가 남는다 — 사유는 첫 것을 지킨다. */
  let sawTurnEnd = false;

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
    for (const ev of mapped.events) args.onEvent(ev);

    // 파일 버블 — 고친 파일이 있으면 경로를 흘린다. 매핑 결과가 아니라 원문에서 다시 뽑는 이유는
    //   화면 이벤트(도구 카드)와 캔버스(파일 버블)가 서로 다른 것을 필요로 하기 때문이다.
    const paths = extractFileWrites(line);
    if (paths.length > 0) args.onFileWrites(paths);
  };

  child.stdout?.on('data', (chunk) => {
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
    const text = String(chunk);
    stderrTail = (stderrTail + text).slice(-2000);
  });

  child.on('error', (err) => {
    running.delete(args.subAgentId);
    args.onDone(`spawn failed: ${err.message}`, finalText);
  });

  child.on('close', (code) => {
    // 남은 꼬리 줄(개행 없이 끝난 마지막 줄)도 처리한다.
    if (stdoutBuffer.trim()) handleLine(stdoutBuffer);
    stdoutBuffer = '';
    running.delete(args.subAgentId);

    if (turn.stopped) {
      args.onDone(undefined, finalText);
      return;
    }
    if (turnError) {
      args.onDone(turnError, finalText);
      return;
    }
    if (code !== null && code !== 0) {
      const tail = stderrTail.trim().slice(-300);
      args.onDone(tail || `codex exited with code ${code}`, finalText);
      return;
    }
    if (!sawTurnEnd && !finalText) {
      // 정상 종료인데 턴 종료도 답도 없다 — 조용한 실패라 사유를 남긴다.
      const tail = stderrTail.trim().slice(-300);
      args.onDone(tail || 'codex produced no output', '');
      return;
    }
    args.onDone(undefined, finalText);
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
