import { existsSync, statSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import * as pty from 'node-pty';
import { observePtyTransportErrors } from './ptyTransportErrors';
import { getClaudeBin, claudeManagedEnvFor, findManagedBin, codexBinOverride, buildInteractiveCliPrefill, buildBashTimeoutEnv, buildAgentTokenSaverEnv, buildVerificationGateEnv, prepareInteractiveRulesDir, buildInteractivePluginBlockForAgent, getCmdResumeSession, parseCmdTermId, recordDiagnostic, killTree, processGuard, type CmdTerminalController } from '@vibisual/server';
import { isPathWithin } from '@vibisual/shared';
import type { AgentConfig } from '@vibisual/shared';
import {
  TERMINAL_SCROLLBACK_LINES,
  TERMINAL_SCROLLBACK_BYTES_PER_LINE,
  clampTerminalScrollback,
  CMD_PROCESS_POLL_MS,
  shouldBufferPtyChunk,
  CMD_PREFILL_MAX_DEFER_MS,
  cmdPrefillDelay,
} from '@vibisual/shared';

// 임베디드 인터랙티브 터미널 매니저 — SCENARIO.md §4. `interactive-terminal` 에이전트의 IDE xterm.js 가 이 PTY 에 붙는다.
// 셸을 띄우고 CLI 를 prefill 한다: Windows `claude.cmd` shim 은 node-pty 로 직접 spawn 하면 실패하고, 사람이 Enter 를 쳐야 진짜 인터랙티브
// 세션이다(구독 과금 · ToS 합법선, 헤드리스 위장 ❌). I/O 는 전용 IPC(`vibisual:term:*`) — 고빈도 바이트가 graph broadcast 를 부풀리지 않게.
// 출력은 `TermSink`(데스크톱 IPC · 모바일 `/ws`), termId 당 부착 1개(마지막 승), 재부착 시 buffer replay.

/** 터미널 출력을 받는 쪽. id 는 부착자 식별(창 파괴/연결 종료 시 일괄 정리용), isAlive 는 사라진 대상에 send 하지 않는 가드. */
export interface TermSink {
  id: string;
  sendData(termId: string, data: string): void;
  sendExit(termId: string, exitCode: number): void;
  isAlive(): boolean;
}

interface TermSession {
  pty: pty.IPty;
  /**
   * §7.10 — 이 PTY 가 도는 폴더(실제로 넘긴 값 — `spec.cwd` 가 없으면 홈). 워크트리 삭제 때 안에서 돌던 것을 골라 죽이는 유일한 단서다
   * (살아 있으면 Windows 는 폴더를 반만 지운다).
   */
  cwd: string;
  /** 현재 붙어있는 출력 대상. IDE 를 닫았다 열거나 다른 뷰어가 붙으면 같은 termId 로 reattach 하며 갱신. */
  sink: TermSink;
  /** scrollback 링버퍼 — reattach 시 새 xterm 에 한 번에 replay 해 이전 출력을 복원(§4). */
  buffer: string;
  /** 이 세션의 링버퍼 상한(바이트). §4 (③) scrollback 설정에서 파생 — 세션마다 다를 수 있다. */
  bufferMax: number;
  /** 마지막으로 적용한 PTY 크기 — 동일 크기 중복 resize(=불필요한 TUI 재그리기/scrollback 누적) 방지. */
  cols: number;
  rows: number;
  /**
   * §4 (CMD ③) — 마지막 `pty.resize()` 시각(ms, 0 = 없음). ConPTY 는 리사이즈마다 화면을 다시 뱉으므로 `CMD_RESIZE_REPAINT_MS` 안의 청크는
   * 링버퍼에 안 쌓는다(`shouldBufferPtyChunk`) — 쌓으면 replay 가 배너를 리사이즈 횟수만큼 되풀이한다.
   */
  resizedAt: number;
  /** §4 (②) 마지막으로 표본한 전경 프로세스명. 표본 실패 시 직전 값 유지. */
  process?: string;
  /** §4 (②) 표본 시각(ms) — `CMD_PROCESS_POLL_MS` 스로틀. */
  processAt: number;
  /**
   * §4 (CMD) — 아직 입력줄에 넣지 않은 prefill 과 그 예약. 그 사이 리사이즈가 오면 다시 미룬다 — ConPTY 가 다시 그리며 입력줄 글자를 잘라 낸다.
   * `deadline` 은 창을 계속 끌어도 결국 채워지게 하는 한도 시각.
   */
  pendingPrefill?: { text: string; deadline: number; timer: ReturnType<typeof setTimeout> };
}

const sessions = new Map<string, TermSession>();

/**
 * §4 (CMD) — 입력줄 채우기를 예약·재예약하는 단일 창구(`resizeTerminal` 이 안 쓴 prefill 을 보면 다시 불러 되감는다).
 * @param deadline 되감기 한도 시각(`cmdPrefillDelay`). 처음엔 생략 — 지금부터 `CMD_PREFILL_MAX_DEFER_MS`.
 */
function schedulePrefill(termId: string, text: string, deadline?: number): void {
  const s = sessions.get(termId);
  if (!s) return;
  if (s.pendingPrefill) clearTimeout(s.pendingPrefill.timer);
  const limit = deadline ?? Date.now() + CMD_PREFILL_MAX_DEFER_MS;
  const timer = setTimeout(() => {
    const cur = sessions.get(termId);
    if (cur !== s) return;
    cur.pendingPrefill = undefined;
    writeToTerminal(termId, text);
  }, cmdPrefillDelay(Date.now(), limit));
  s.pendingPrefill = { text, deadline: limit, timer };
}

/** 예약해 둔 입력줄 채우기를 취소한다(세션 종료·회수 시 — 죽은 PTY 에 쓰면 예외가 난다). */
function cancelPrefill(s: TermSession): void {
  if (!s.pendingPrefill) return;
  clearTimeout(s.pendingPrefill.timer);
  s.pendingPrefill = undefined;
}

/** §4 (② QA) — node-pty `process` 는 플랫폼에 따라 전체 경로(`C:\\WINDOWS\\system32\\cmd.exe`)를 준다 — 탭 보조 표기라 파일명만, 확장자 없이. */
function prettyProcessName(raw: string): string {
  const base = raw.trim().split(/[\\/]/).pop() ?? raw.trim();
  return base.replace(/\.(exe|cmd|bat|com)$/i, '').slice(0, 32);
}

/**
 * §4 (③) — scrollback 줄 수를 링버퍼 바이트 상한으로 환산한다. xterm 과 같은 한 값(`TERMINAL_SCROLLBACK_LINES` 또는 사용자 설정)에서
 * 둘 다 나와야 한다 — 어긋나면 화면엔 있는데 Ctrl+F 로는 안 찾히는 구간이 생긴다.
 */
function bufferMaxFor(scrollbackLines: number | undefined): number {
  return clampTerminalScrollback(scrollbackLines ?? TERMINAL_SCROLLBACK_LINES) * TERMINAL_SCROLLBACK_BYTES_PER_LINE;
}

export interface CreateTerminalSpec {
  termId: string;
  /** 작업 디렉토리 — 보통 그 에이전트가 속한 프로젝트 루트(ProjectInfo.path). */
  cwd: string;
  /** 그 에이전트의 AgentConfig — model/permission/effort/tools/isolation/cliKind 를 prefill 에 반영. */
  config: AgentConfig;
  cols?: number;
  rows?: number;
  /**
   * §5.5 #17-20 ④ — 실행 런처. 있으면 CLI 대신 이 명령을 그대로 셸에 넣고, rules `--add-dir`·`VIBISUAL_OWNER_AGENT_ID` 태그도 건너뛴다
   * (사용자의 서버는 우리 훅의 자식이 아니다).
   */
  command?: string;
  /** command 를 사용자 Enter 없이 바로 실행할지(실행 런처 = true). CLI prefill 은 언제나 false. */
  autoRun?: boolean;
  /** command 에 실어 줄 추가 환경변수(디버그 모드의 `NODE_OPTIONS` 등). */
  env?: Record<string, string>;
  /** §4 (③) — 이 터미널의 scrollback 줄 수(옵션창 Advanced). 미지정 시 기본값. */
  scrollbackLines?: number;
}

/**
 * §4 (⑦) — 카드 신고용 loopback 신원(main 이 리스너를 띄운 뒤 1회 주입). 있어야 PTY 안 에이전트가 헤드리스와 같은 카드 엔드포인트를 curl 로 부른다
 * (없으면 `::VIBISUAL-CARD::` 마커 인쇄 폴백).
 */
let cardIdentity: { port: number; token: string; identityFile?: string } | null = null;

export function setTerminalCardIdentity(next: { port: number; token: string; identityFile?: string } | null): void {
  cardIdentity = next;
}

/**
 * 이 터미널에 띄울 셸 + 인자.
 * **macOS 는 로그인 셸(`-l`) — 지우지 말 것.** Finder/Dock 실행은 `launchd` 최소 PATH 라 Homebrew 의 `node`·`git`·`claude` 가 `command not found` 이고,
 * `brew shellenv` 는 로그인 셸만 읽는 `~/.zprofile` 에 있다. Linux 는 그대로 — 세션이 이미 PATH 를 주고, 로그인 bash 는 `~/.bashrc` 를 안 읽는다.
 * prefill 과 무관하다(`-c` 가 아니라 대화형 셸의 stdin 에 넣고 Enter 는 사람이 친다).
 */
/** 실행 권한 확인은 프로세스당 한 번이면 된다(파일은 그 사이에 바뀌지 않는다). */
let spawnHelperChecked = false;

/**
 * node-pty `spawn-helper` 에 실행 권한이 없으면 돌려준다 — 없으면 mac 에서 모든 `pty.spawn` 이 `posix_spawnp failed.` 로 죽는다(2026-08-29 실기).
 * npm tarball 이 모드를 644 로 누르고 node-pty 는 안 되돌린다. 정본 수리는 after-pack.cjs, 여기는 그물을 빠져나온 배치(로컬 `pnpm install` 등)를 구한다.
 * 실패해도 던지지 않는다(읽기 전용 설치면 spawn 이 원래 오류를 내게 두고 진단에 남긴다).
 */
function ensureSpawnHelperExecutable(platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32' || spawnHelperChecked) return;
  spawnHelperChecked = true;
  const roots: string[] = [];
  try {
    // 번들 출력이 CJS 라 require.resolve 가 그대로 산다(node-pty 는 외부 의존성으로 남는다).
    roots.push(dirname(dirname(require.resolve('node-pty'))));
  } catch { /* 해석 실패 — 아래 패키지 경로로 폴백 */ }
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'app', 'node_modules', 'node-pty'));

  for (const root of roots) {
    for (const helper of [
      join(root, 'prebuilds', `${platform}-${process.arch}`, 'spawn-helper'),
      join(root, 'build', 'Release', 'spawn-helper'),
    ]) {
      try {
        if (!existsSync(helper)) continue;
        if (statSync(helper).mode & 0o111) continue;
        chmodSync(helper, 0o755);
        recordDiagnostic('main', 'warn', `node-pty spawn-helper 에 실행 권한이 없어 755 로 복구했다: ${helper}`);
      } catch (err) {
        recordDiagnostic('main', 'error', `spawn-helper 권한 복구 실패: ${helper} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

export function pickShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): { shell: string; shellArgs: string[] } {
  if (platform === 'win32') {
    return { shell: env['COMSPEC'] ?? 'cmd.exe', shellArgs: [] };
  }
  const shell = env['SHELL'] ?? '/bin/bash';
  return { shell, shellArgs: platform === 'darwin' ? ['-l'] : [] };
}

/**
 * 임베디드 터미널 생성 또는 재부착. 같은 termId 가 살아 있으면 재스폰하지 않고 붙어 scrollback 을 replay 한다(진행 중 세션 보존, §4).
 * 없을 때만 셸을 cwd 에서 띄우고 CLI 명령을 prefill 한다.
 */
export function createTerminal(sink: TermSink, spec: CreateTerminalSpec): { ok: boolean; error?: string } {
  try {
    // 재부착 — 살아있는 PTY 가 있으면 sink 만 갱신하고 그동안의 출력을 한 번에 replay.
    const existing = sessions.get(spec.termId);
    if (existing) {
      existing.sink = sink;
      // §4 (③) — 설정이 바뀌었으면 이번 부착부터 새 상한을 적용한다(다음 write 에서 잘린다).
      existing.bufferMax = bufferMaxFor(spec.scrollbackLines);
      if (sink.isAlive() && existing.buffer) {
        // replay 전에 xterm 을 비운다(화면·scrollback clear + 커서 home) — 안 그러면 재마운트마다 직전 화면 위에 같은 배너가 또 찍힌다.
        // buffer 안의 커서/erase 시퀀스가 재생되므로 최종 화면은 CLI 현재 상태와 같다.
        sink.sendData(spec.termId, `\x1b[2J\x1b[3J\x1b[H${existing.buffer}`);
      }
      // 크기는 **측정된 값이 왔을 때만** 반영한다. 클라가 아직 레이아웃되지 않아 xterm 기본
      // 80x24 를 보내면 그대로 PTY 를 줄였다 늘리며 리페인트가 두 번 난다 → 클라는 fit 성공 시에만
      // cols/rows 를 싣고(IDETerminalView), 여기서는 온 값만 신뢰한다.
      resizeTerminal(spec.termId, spec.cols ?? 0, spec.rows ?? 0);
      return { ok: true };
    }

    // mac/linux — 첫 spawn 전에 node-pty 의 spawn-helper 실행 권한을 확인한다(위 주석 참고).
    ensureSpawnHelperExecutable();

    const cwd = spec.cwd && existsSync(spec.cwd) ? spec.cwd : homedir();
    const { shell, shellArgs } = pickShell();
    const cols = spec.cols && spec.cols > 0 ? spec.cols : 80;
    const rows = spec.rows && spec.rows > 0 ? spec.rows : 24;

    // §5.5 #17-20 ④ — 실행 런처인가(CLI 가 아니라 사용자의 명령). 이 갈래는 아래에서 rules 폴더·소유자 태그·CLI 인자를 전부 건너뛴다.
    const runCommand = spec.command?.trim();
    const isRunLauncher = !!runCommand;

    // §4 — 이 CMD 버블의 agentId / 세션 탭 id. termId 파서는 서버와 한 벌을 쓴다(§4 ⑤ pane 구분자 규칙이 갈라지면 소유 해석이 조용히 어긋난다).
    const parsed = parseCmdTermId(spec.termId);
    const agentId = parsed?.agentId ?? '';
    const subAgentId = parsed?.sessionToken ?? '';

    // §4 (⑧) — 무엇을 띄울지 먼저 정한다. claude 가 아니면 우리 훅의 자식이 아니므로 rules 폴더·소유자 태그·카드 토큰을 붙이지 않는다.
    const { binPath } = getClaudeBin();
    const rulesDirNeeded = !isRunLauncher && !!agentId;
    // rules 는 claude 갈래에서만 의미가 있다 — managed 판정을 위해 prefill 을 먼저 만들어 본다.
    const probe = buildInteractiveCliPrefill({ config: spec.config, claudeBinPath: binPath });
    const managed = probe.managed && !isRunLauncher;

    // §4 — rules 를 파일로 미리 써 둔다(prefill 의 `--add-dir <rulesDir>` 와 짝, spawn 전에 있어야 아래 env 플래그를 켠다).
    // §5.11 — 켠 집행 플러그인의 지시도 같은 파일에. 프로젝트는 서버가 그래프로 푼다 — 터미널 cwd 는 워크트리·하위 폴더라 켬/끔 키와 어긋난다.
    const rulesDir = rulesDirNeeded && managed
      ? prepareInteractiveRulesDir(agentId, spec.config, { enforcementBlock: buildInteractivePluginBlockForAgent(agentId) })
      : null;

    const child = pty.spawn(shell, shellArgs, {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      // process.env 를 그대로 물려 사용자 OAuth/PATH 가 CLI 에 닿게 한다(인증 대행 ❌). 소유자 태그는 이 PTY 의 자식에만 — AGENT_ID: hook 을 CMD 버블에 귀속,
      // TERM_ID: sessionId 를 termId 별로 적어 재시작 뒤 `--resume`. CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 이 없으면 `--add-dir` 의 CLAUDE.md 가
      // 컨텍스트에 안 들어가 rules 가 강제되지 않는다(rules 가 있을 때만 켠다).
      env: {
        ...(process.env as Record<string, string>),
        // UTF-8 강제(다른 spawn 경로와 같다) — 없으면 PTY 안 python Stop 훅이 한글을 cp949 로 찍어 node-pty 의 UTF-8 디코딩에서 U+FFFD 로 깨진다.
        // PYTHONIOENCODING 이 핵심이다.
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
        PYTHONIOENCODING: 'utf-8',
        // 실행 런처(§5.5 #17-20)와 비-claude CLI(§4 ⑧)는 우리 훅의 자식이 아니므로 소유자 태그를
        //   붙이지 않는다 — 사용자의 서버·타 CLI 가 우리 자식으로 오인되면 버블맵이 오염된다.
        ...(agentId && managed ? { VIBISUAL_OWNER_AGENT_ID: agentId } : {}),
        VIBISUAL_OWNER_TERM_ID: spec.termId,
        ...(rulesDir ? { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' } : {}),
        // §4 (⑦) — 카드 신고 loopback 신원. 이게 실려야 PTY 안의 에이전트가 헤드리스와 같은
        //   카드 엔드포인트를 curl 로 부를 수 있다(없으면 마커 인쇄 폴백).
        ...(managed && cardIdentity
          ? {
              VIBISUAL_HOOK_PORT: String(cardIdentity.port),
              VIBISUAL_HOOK_TOKEN: cardIdentity.token,
              VIBISUAL_AGENT_ID: agentId,
              VIBISUAL_SUB_AGENT_ID: subAgentId,
              ...(cardIdentity.identityFile ? { VIBISUAL_HOOK_IDENTITY: cardIdentity.identityFile } : {}),
            }
          : {}),
        // §4 (CLI 사양 추종) — Bash 타임아웃. 헤드리스 스폰(buildConfigEnv)과 같은 함수를 써
        //   "설정한 세팅 그대로"가 인터랙티브 터미널에도 적용된다. claude 갈래에만.
        ...(managed ? buildBashTimeoutEnv(spec.config) : {}),
        // §5.3 #9-1 (J~M) — 토큰 절약 축. 같은 규율로 헤드리스와 **한 벌**을 쓴다 —
        //   설정 창에서 켠 절약이 사용자가 직접 치는 CMD 세션에도 그대로 걸린다.
        ...(managed ? buildAgentTokenSaverEnv(spec.config) : {}),
        // §5.3 #12-4 (J) — 검증 실행 전 차단을 켠 채 여는 터미널이면 훅 안전망 표식. 헤드리스와 같은 함수(끄면 빈 객체).
        ...(managed ? buildVerificationGateEnv() : {}),
        // §4 (앱 전용 엔진) ⑤ — 앱 전용 claude 를 띄우는 세션이면 엔진 자체 갱신을 끈다(판은 앱이 바꾼다).
        //   CMD 의 claude 갈래와, 로그인 창이 넘겨 준 실행본(`VIBISUAL_CLAUDE_LOGIN_BIN`)이 앱 전용일 때만 —
        //   사용자가 고른 자기 설치본에는 얹지 않는다(판정은 경로 — `claudeManagedEnvFor`).
        ...(managed ? claudeManagedEnvFor(binPath) : {}),
        ...(spec.env?.['VIBISUAL_CLAUDE_LOGIN_BIN'] ? claudeManagedEnvFor(spec.env['VIBISUAL_CLAUDE_LOGIN_BIN']) : {}),
        // 디버그 모드가 실어 보내는 것(NODE_OPTIONS 등) + 실행 구성의 env.
        ...(spec.env ?? {}),
      },
    });

    const session: TermSession = {
      pty: child,
      cwd,
      sink,
      buffer: '',
      bufferMax: bufferMaxFor(spec.scrollbackLines),
      cols,
      rows,
      resizedAt: 0,
      processAt: 0,
    };
    sessions.set(spec.termId, session);
    // §5.3 #9-2 — CMD 터미널도 같은 감시에 넣는다(손자까지 · 메모리 상한). 터미널이 닫히면 그 안에서 띄운 것도
    //   끝난다 — POSIX 터미널이 닫힐 때 그 안의 작업이 함께 끝나는 것과 같은 결. 실행 런처(사용자 명령)도 같다.
    processGuard.adopt(child.pid, agentId && subAgentId ? { parentAgentId: agentId, subAgentId } : null, 'pty', { reapOnExit: true });

    observePtyTransportErrors(child, (side, error) => failTerminalTransport(spec.termId, session, side, error));

    child.onData((data) => {
      if (sessions.get(spec.termId) !== session) return;
      // §4 (CMD ③) — 리사이즈 직후 ConPTY 가 되뱉는 화면 전체 리페인트는 **화면에는 그대로 보내되
      //   링버퍼에는 쌓지 않는다**. 리페인트는 "지금 화면"이라 sink 에는 반드시 가야 하지만, 버퍼에
      //   쌓으면 재부착 replay 가 리사이즈 횟수만큼 같은 배너·프롬프트를 되풀이한다.
      if (shouldBufferPtyChunk(data, session.resizedAt, Date.now())) {
        session.buffer += data;
        if (session.buffer.length > session.bufferMax) {
          session.buffer = session.buffer.slice(-session.bufferMax);
        }
      } else {
        // 한 리사이즈당 한 벌만 걸러 낸다 — 그 뒤 실제 출력은 정상 누적.
        session.resizedAt = 0;
      }
      if (session.sink.isAlive()) session.sink.sendData(spec.termId, data);
    });
    child.onExit(({ exitCode }) => {
      cancelPrefill(session);
      // 세션 판정보다 먼저 — 같은 탭 id 를 새 PTY 가 이어받았어도 이 PTY 의 본체는 끝났다.
      processGuard.rootExited(child.pid);
      // An older PTY can exit after a replacement has claimed the same tab id.
      if (sessions.get(spec.termId) !== session) return;
      sessions.delete(spec.termId);
      if (session.sink.isAlive()) session.sink.sendExit(spec.termId, exitCode);
    });

    // §5.5 #17-20 ④ — 실행 런처 갈래. `autoRun` 이면 개행까지 붙여 바로 실행하고(사용자가 [실행]을 이미 눌렀다), 아니면 CLI prefill 처럼 입력만 채운다.
    if (isRunLauncher && runCommand) {
      schedulePrefill(spec.termId, spec.autoRun === false ? runCommand : `${runCommand}\r`);
      return { ok: true };
    }

    // CLI 명령 prefill — 셸 프롬프트가 먼저 그려지게 지연 후 write, 개행 없음(Enter 는 사람이 — ToS 합법선). 최초 spawn 때만.
    // §4 — 재시작 뒤 이 termId 의 직전 claude 대화가 있으면 `--resume <id>`(PTY 는 죽어도 대화는 JSONL 에 남는다). claude 가 아니면 생략.
    const resumeId = managed ? getCmdResumeSession(spec.termId) : null;
    const { prefill } = buildInteractiveCliPrefill({
      config: spec.config,
      claudeBinPath: binPath,
      rulesDir,
      resumeId,
      // 이 줄을 받을 셸 — 인용 규칙이 cmd.exe·POSIX 셸·fish 마다 다르다(`interactiveCommandLine.ts`).
      shell,
      // §4 (앱 전용 엔진) — 앱 전용 코덱스가 있으면 코덱스 갈래가 맨 이름 대신 그 실행본을 띄운다.
      managedCodexBin: findManagedBin('codex'),
      // ④ — 사용자가 Version 탭에서 다른 설치본을 보조로 골라 두었으면 그것이 먼저다.
      selectedCodexBin: codexBinOverride(),
    });
    if (prefill) schedulePrefill(spec.termId, prefill);

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordDiagnostic('main', 'error', `terminal create failed: ${message}`, err instanceof Error ? err.stack : undefined);
    return { ok: false, error: message };
  }
}

/** renderer 의 xterm 키 입력을 PTY stdin 으로 전달. */
export function writeTerminal(termId: string, data: string): void {
  writeToTerminal(termId, data);
}

function writeToTerminal(termId: string, data: string): boolean {
  const s = sessions.get(termId);
  if (!s) return false;
  try { s.pty.write(data); return true; } catch (error) {
    failTerminalTransport(termId, s, 'input', error);
    return false;
  }
}

function failTerminalTransport(termId: string, session: TermSession, side: string, error: unknown): void {
  if (sessions.get(termId) !== session) return;
  cancelPrefill(session);
  sessions.delete(termId);
  recordDiagnostic('main', 'error', `terminal ${side} failed: ${error instanceof Error ? error.message : String(error)}`);
  try { if (session.sink.isAlive()) session.sink.sendExit(termId, 1); } catch { /* viewer already closed */ }
  try { session.pty.kill(); } catch { /* already exited */ }
  killTree(session.pty.pid);
}

/** xterm 리사이즈를 PTY 에 반영. */
export function resizeTerminal(termId: string, cols: number, rows: number): void {
  const s = sessions.get(termId);
  if (!s) return;
  // 동일 크기면 skip — 같은 크기로 반복 resize 하면 claude REPL 이 화면을 다시 그려 scrollback 이 쌓인다.
  if (cols > 0 && rows > 0 && (cols !== s.cols || rows !== s.rows)) {
    s.cols = cols;
    s.rows = rows;
    // §4 (CMD ③) — 이 뒤에 오는 ConPTY 리페인트를 링버퍼에서 걸러 내기 위한 표식.
    s.resizedAt = Date.now();
    try { s.pty.resize(cols, rows); } catch { /* PTY already gone */ }
    // §4 (CMD) — 아직 입력줄을 채우지 않았다면 그 시각을 뒤로 미룬다. 지금 채우면 방금 부른
    //   리사이즈의 ConPTY 리페인트가 그 글자를 새 폭으로 재배치하며 잘라 낸다(pendingPrefill 주석).
    if (s.pendingPrefill) schedulePrefill(termId, s.pendingPrefill.text, s.pendingPrefill.deadline);
  }
}

/**
 * §4 (CMD ②) — 전경 프로세스명·크기. CMD 탭은 자동 이름(§5.5 #17-5)이 없어 이 값이 라벨 **보조** 표기가 된다(덮어쓰지 않는다).
 * `CMD_PROCESS_POLL_MS` 로 스로틀, `process` 가 비면 직전 표본 유지.
 */
export function getTerminalInfo(termId: string): { process?: string; cols: number; rows: number } | null {
  const s = sessions.get(termId);
  if (!s) return null;
  const now = Date.now();
  if (now - s.processAt >= CMD_PROCESS_POLL_MS) {
    s.processAt = now;
    try {
      const name = s.pty.process;
      if (typeof name === 'string' && name.trim()) s.process = prettyProcessName(name);
    } catch { /* PTY gone mid-sample */ }
  }
  return { ...(s.process ? { process: s.process } : {}), cols: s.cols, rows: s.rows };
}

/** 터미널 1개 종료 — 탭 명시 닫기 전용(§4: IDE 닫기로는 죽이지 않는다, 재부착 위해 보존). */
export function killTerminal(termId: string): void {
  const s = sessions.get(termId);
  if (!s) return;
  cancelPrefill(s);
  sessions.delete(termId);
  const pid = s.pty.pid;
  try { s.pty.kill(); } catch { /* already exited */ }
  // pty.kill() 은 셸(cmd.exe)만 종료 → 그 아래 claude·node worker 트리는 고아로 남는다(Windows).
  // taskkill /T /F 로 PTY 프로세스 트리 전체를 회수한다.
  killTree(pid);
}

/** 특정 부착자(sink)에 속한 모든 터미널 종료 — 창이 파괴될 때(앱/별창 닫힘). */
export function killTerminalsForSink(sinkId: string): void {
  for (const [termId, s] of sessions) {
    if (s.sink.id === sinkId) killTerminal(termId);
  }
}

/**
 * §7.10 — 그 폴더 안의 터미널을 전부 트리째 죽이고 개수를 돌려준다(워크트리 삭제 앞단, 확인은 팝업이 받았다). 없으면 dev 서버·빌드가 파일을 잡아
 * 삭제가 반만 되고 `node_modules` 만 남는다. 포함 판정은 `isPathWithin` 한 곳 — linux 에서 대소문자를 접으면 남의 폴더 터미널까지 죽인다.
 */
export function killTerminalsUnder(rootPath: string): number {
  const ids = listTerminalsUnder(rootPath);
  for (const termId of ids) killTerminal(termId);
  return ids.length;
}

/** §7.10 — 죽이지 않고 세기만 한다(삭제 팝업의 예고용). 죽이는 쪽과 같은 판정이어야 예고한 숫자와 실제가 어긋나지 않는다. */
export function listTerminalsUnder(rootPath: string): string[] {
  if (!rootPath) return [];
  return [...sessions]
    .filter(([, s]) => isPathWithin(s.cwd, rootPath, process.platform))
    .map(([termId]) => termId);
}

/** before-quit 정리 — 살아있는 모든 PTY 종료. */
export function killAllTerminals(): void {
  for (const termId of [...sessions.keys()]) killTerminal(termId);
}

/**
 * §4 (CMD ⑥) — loopback REST(`/api/cmd/*`)의 제어 인터페이스(server 코어는 desktop 을 import 하지 않아 main 이 주입, §3.4).
 * `write` 는 받은 그대로 넣는다 — 개행 걷기는 호출부 `sendCmdTerminal` 의 책임(Enter 는 사람이).
 */
export const terminalController: CmdTerminalController = {
  list: () => [...sessions.keys()],
  exists: (termId) => sessions.has(termId),
  write: writeToTerminal,
  readBuffer: (termId) => sessions.get(termId)?.buffer ?? null,
  killUnder: (rootPath) => killTerminalsUnder(rootPath),
  listUnder: (rootPath) => listTerminalsUnder(rootPath),
};
