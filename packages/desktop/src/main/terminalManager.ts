import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as pty from 'node-pty';
import { getClaudeBin, buildInteractiveCliPrefill, buildBashTimeoutEnv, prepareInteractiveRulesDir, buildInteractivePluginBlockForAgent, getCmdResumeSession, parseCmdTermId, recordDiagnostic, killTree, type CmdTerminalController } from '@vibisual/server';
import type { AgentConfig } from '@vibisual/shared';
import {
  TERMINAL_SCROLLBACK_LINES,
  TERMINAL_SCROLLBACK_BYTES_PER_LINE,
  clampTerminalScrollback,
  CMD_PROCESS_POLL_MS,
  shouldBufferPtyChunk,
} from '@vibisual/shared';

// 임베디드 인터랙티브 터미널 매니저 — SCENARIO.md §4 v2.63.
//
// 6/15 프로그래매틱 과금 분리 대응. `AgentConfig.executionMode === 'interactive-terminal'` 인
// 커스텀 에이전트를 더블클릭하면 IDE 창 안 xterm.js 가 이 매니저의 PTY 에 붙는다.
//
// 왜 셸(cmd.exe)을 띄우고 CLI 를 *prefill* 하나:
//   1) Windows 의 claude 는 보통 `claude.cmd` shim 이라 node-pty(ConPTY/CreateProcess)로 직접
//      spawn 하면 실패한다 → 시스템 셸을 거친다.
//   2) prefill(명령을 미리 입력해두고 사용자가 Enter)은 "사람이 루프 안" 을 보장 — 진짜
//      인터랙티브 세션이라 **구독 과금** + Anthropic ToS 합법선(헤드리스 위장 ❌, §4 v2.63).
//   3) claude 인터랙티브 REPL 도 hook 을 발사하므로 버블맵 시각화는 그대로 유지된다.
//
// 터미널 I/O 는 GraphSnapshot/WS 가 아니라 §5.4 #14-1 별창·§4 v2.44 업데이트 선례대로 shell-state
// 전용 IPC 채널(`vibisual:term:*`)로 흐른다(고빈도 바이트 스트림이 graph broadcast 를 부풀리지 않게).
//
// §4 v3.33 — 출력 대상을 `WebContents` 고정에서 `TermSink` 로 추상화. 데스크톱은 IPC 싱크
// (`vibisual:term:*`, ipc.ts), 모바일 웹 접속(§4 v3.16)은 `/ws` 싱크(mobileAccess.ts)로 같은
// PTY 바이트를 흘린다. 부착은 termId 당 1개(마지막 부착자 승) — 재부착 시 buffer replay.
//
// §4 (CMD 터미널 업그레이드) — herdr 벤치마킹 3축이 이 파일에 닿는 부분:
//   ② 전경 프로세스명을 주기 표본해 탭 라벨 보조 표기로 올린다(`getTerminalInfo`).
//   ③ scrollback 상한이 xterm 과 **같은 값**(`TERMINAL_SCROLLBACK_LINES` 파생)에서 나온다.
//   ⑥ `cmdTerminalController` 로 PTY 를 loopback REST 에 연다(prefill 까지만 — Enter 주입 ❌).
//   ⑦ 카드 신고용 loopback 신원(포트·토큰·agentId·subAgentId)을 PTY env 로 실어 준다.
//   ⑧ 무엇을 prefill 할지는 `buildInteractiveCliPrefill` 이 `CMD_CLI_KINDS` 표를 보고 정한다.

/**
 * 터미널 출력을 받는 쪽 추상화(§4 v3.33). id 는 부착자 식별(창 파괴/연결 종료 시 일괄 정리용),
 * isAlive 는 이미 사라진 대상에 send 하지 않기 위한 가드.
 */
export interface TermSink {
  id: string;
  sendData(termId: string, data: string): void;
  sendExit(termId: string, exitCode: number): void;
  isAlive(): boolean;
}

interface TermSession {
  pty: pty.IPty;
  /** 현재 붙어있는 출력 대상. IDE 를 닫았다 열거나 다른 뷰어가 붙으면 같은 termId 로 reattach 하며 갱신. */
  sink: TermSink;
  /** scrollback 링버퍼 — reattach 시 새 xterm 에 한 번에 replay 해 이전 출력을 복원(§4 v2.63). */
  buffer: string;
  /** 이 세션의 링버퍼 상한(바이트). §4 (③) scrollback 설정에서 파생 — 세션마다 다를 수 있다. */
  bufferMax: number;
  /** 마지막으로 적용한 PTY 크기 — 동일 크기 중복 resize(=불필요한 TUI 재그리기/scrollback 누적) 방지. */
  cols: number;
  rows: number;
  /**
   * §4 (CMD ③) — 마지막 `pty.resize()` 시각(ms, 0 = 없음). ConPTY 는 리사이즈마다 화면을 통째로
   * 다시 뱉으므로, 이 뒤 `CMD_RESIZE_REPAINT_MS` 안에 오는 리페인트 청크는 **화면에는 보내되
   * 링버퍼에는 안 쌓는다**(`shouldBufferPtyChunk`). 안 그러면 재부착 replay 가 같은 배너를
   * 리사이즈 횟수만큼 되풀이한다.
   */
  resizedAt: number;
  /** §4 (②) 마지막으로 표본한 전경 프로세스명. 표본 실패 시 직전 값 유지. */
  process?: string;
  /** §4 (②) 표본 시각(ms) — `CMD_PROCESS_POLL_MS` 스로틀. */
  processAt: number;
}

const sessions = new Map<string, TermSession>();

/**
 * §4 (② QA) — node-pty 의 `process` 는 플랫폼에 따라 콘솔 제목/전체 경로를 준다
 * (Windows 의 ConPTY 는 `C:\\WINDOWS\\system32\\cmd.exe` 같은 값을 흘린다).
 * 탭 옆에 붙는 **보조 표기**라 경로째 실으면 읽히지 않으므로 파일명만 남기고 확장자를 뗀다.
 */
function prettyProcessName(raw: string): string {
  const base = raw.trim().split(/[\\/]/).pop() ?? raw.trim();
  return base.replace(/\.(exe|cmd|bat|com)$/i, '').slice(0, 32);
}

/**
 * §4 (③) — scrollback 줄 수를 링버퍼 바이트 상한으로 환산한다.
 * 종전 상수 256KB 는 xterm 기본 1000줄과 어긋나 "화면엔 있는데 Ctrl+F 로는 안 찾히는" 구간을
 * 만들었다. 이제 **한 값**(`TERMINAL_SCROLLBACK_LINES` 또는 사용자 설정)에서 둘 다 나온다.
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
   * §5.5 #17-20 ④ v4.74 — 실행 런처. 이 값이 있으면 **CLI 를 띄우지 않고** 이 명령을 그대로
   * 셸에 넣는다(사용자의 dev 서버·빌드·언리얼 실행). claude 경로의 rules `--add-dir` 와
   * `VIBISUAL_OWNER_AGENT_ID` 태그도 함께 건너뛴다 — 사용자의 서버는 우리 훅의 자식이 아니다.
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
 * §4 (⑦) — 카드 신고용 loopback 신원. desktop main 이 리스너를 띄운 뒤 1회 주입한다.
 * 이 값이 있어야 PTY 안의 에이전트가 헤드리스와 **같은** 카드 엔드포인트를 curl 로 부를 수 있다
 * (없으면 종전대로 `::VIBISUAL-CARD::` 마커 인쇄 폴백 — 두 경로 모두 같은 카드를 띄운다).
 */
let cardIdentity: { port: number; token: string; identityFile?: string } | null = null;

export function setTerminalCardIdentity(next: { port: number; token: string; identityFile?: string } | null): void {
  cardIdentity = next;
}

function pickShell(): { shell: string; shellArgs: string[] } {
  if (process.platform === 'win32') {
    return { shell: process.env['COMSPEC'] ?? 'cmd.exe', shellArgs: [] };
  }
  return { shell: process.env['SHELL'] ?? '/bin/bash', shellArgs: [] };
}

/**
 * 임베디드 터미널 생성 또는 **재부착(attach)**.
 *
 * 같은 termId 가 이미 살아있으면(=IDE 를 닫았다 다시 열었거나 탭을 다시 그린 경우) **재스폰하지 않고**
 * 그 PTY 에 다시 붙어 scrollback 버퍼를 replay 한다 → 진행 중이던 세션이 그대로 보존된다(§4 v2.63).
 * 없을 때만 셸을 cwd 에서 새로 띄우고 CLI 실행 명령을 prefill 한다.
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
        // replay 전에 xterm 을 비운다(화면 clear + scrollback clear + 커서 home). 같은 termId 가
        // 여러 번 재부착(remount)돼도 직전 화면 위에 buffer 가 덧쌓이지 않고 항상 현재 세션 출력만
        // 한 벌 보이게 한다("재마운트 때마다 같은 배너가 또 찍힘" 버그 차단). buffer 안의 커서/erase
        // 시퀀스는 그대로 재생되므로 최종 화면은 CLI 의 현재 상태와 동일하다.
        sink.sendData(spec.termId, `\x1b[2J\x1b[3J\x1b[H${existing.buffer}`);
      }
      // 크기는 **측정된 값이 왔을 때만** 반영한다. 클라가 아직 레이아웃되지 않아 xterm 기본
      // 80x24 를 보내면 그대로 PTY 를 줄였다 늘리며 리페인트가 두 번 난다 → 클라는 fit 성공 시에만
      // cols/rows 를 싣고(IDETerminalView), 여기서는 온 값만 신뢰한다.
      if (spec.cols && spec.rows && spec.cols > 0 && spec.rows > 0 &&
          (spec.cols !== existing.cols || spec.rows !== existing.rows)) {
        existing.cols = spec.cols;
        existing.rows = spec.rows;
        existing.resizedAt = Date.now();
        try { existing.pty.resize(spec.cols, spec.rows); } catch { /* gone */ }
      }
      return { ok: true };
    }

    const cwd = spec.cwd && existsSync(spec.cwd) ? spec.cwd : homedir();
    const { shell, shellArgs } = pickShell();
    const cols = spec.cols && spec.cols > 0 ? spec.cols : 80;
    const rows = spec.rows && spec.rows > 0 ? spec.rows : 24;

    // §5.5 #17-20 ④ v4.74 — 실행 런처인가(=CLI 가 아니라 사용자의 명령을 띄우는가).
    //   이 갈래는 아래에서 rules 폴더·소유자 태그·CLI 인자를 전부 건너뛴다.
    const runCommand = spec.command?.trim();
    const isRunLauncher = !!runCommand;

    // §4 v2.64 — 이 CMD 버블의 agentId / 세션 탭 id. termId 파서는 서버와 **한 벌**을 쓴다
    //   (§4 ⑤ pane 구분자 규칙이 두 곳으로 갈라지면 소유 해석이 조용히 어긋난다).
    const parsed = parseCmdTermId(spec.termId);
    const agentId = parsed?.agentId ?? '';
    const subAgentId = parsed?.sessionToken ?? '';

    // §4 (⑧) — 무엇을 띄울지 먼저 정한다. claude 가 아니면 우리 훅의 자식이 아니므로
    //   rules 폴더·소유자 태그·카드 토큰을 붙이지 않는다(v4.74 실행 런처와 같은 규율).
    const { binPath } = getClaudeBin();
    const rulesDirNeeded = !isRunLauncher && !!agentId;
    // rules 는 claude 갈래에서만 의미가 있다 — managed 판정을 위해 prefill 을 먼저 만들어 본다.
    const probe = buildInteractiveCliPrefill({ config: spec.config, claudeBinPath: binPath });
    const managed = probe.managed && !isRunLauncher;

    // §4 v2.64 — rules(시스템 프롬프트)를 파일로 미리 써 둔다(있으면 그 폴더 절대경로). 아래 prefill 의
    //   `--add-dir <rulesDir>` 와 짝. spawn 전에 계산하는 이유: rulesDir 유무로 아래 env 플래그를 켜기 위함.
    // §5.11 v4.65 — 이 프로젝트에서 켠 집행 플러그인의 지시도 같은 파일에 함께 쓴다(켠 것이 없으면 빈 문자열).
    //   프로젝트 해결은 서버가 그래프로 한다 — 터미널이 아는 cwd 는 워크트리·하위 폴더일 수 있어 켬/끔 키와 어긋난다.
    const rulesDir = rulesDirNeeded && managed
      ? prepareInteractiveRulesDir(agentId, spec.config, { enforcementBlock: buildInteractivePluginBlockForAgent(agentId) })
      : null;

    const child = pty.spawn(shell, shellArgs, {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      // process.env 를 그대로 물려줘 사용자 OAuth/PATH 가 CLI 에 닿게 한다(별도 인증 대행 ❌).
      // + 소유자 태그(VIBISUAL_OWNER_AGENT_ID/_TERM_ID) 주입 — 이 PTY 의 자식(claude/hook)만 영향.
      //   AGENT_ID: hook 이벤트를 CMD 버블에 귀속(§4 v2.64). TERM_ID: claude 대화 sessionId 를
      //   termId 별로 기록 → 앱 재시작 후 `--resume` 연속성.
      // + CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 — `--add-dir` 폴더의 CLAUDE.md 를 claude 가
      //   **시작 시 컨텍스트에 자동 주입**하게 하는 플래그. 이게 없으면 add-dir 는 폴더를 "읽을 수 있게"만
      //   열 뿐 rules 가 자동 적용되지 않아 "참고용"에 그친다(강제 X). rules 가 있을 때만 켠다.
      env: {
        ...(process.env as Record<string, string>),
        // UTF-8 강제 — legacy(subAgentManager) / agent-view(claudeAgentViewService) spawn 경로와 동일.
        //   이게 없으면 PTY 안의 claude → python Stop 훅(verify_gate.py 등)이 한글을 Windows 콘솔
        //   기본 코드페이지(cp949)로 찍고, node-pty 가 UTF-8 로 디코딩하면서 전부 ◆(U+FFFD)로 깨진다.
        //   PYTHONIOENCODING 이 핵심(파이썬 stdout 을 코드페이지와 무관하게 UTF-8 로 고정).
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
        // 디버그 모드가 실어 보내는 것(NODE_OPTIONS 등) + 실행 구성의 env.
        ...(spec.env ?? {}),
      },
    });

    const session: TermSession = {
      pty: child,
      sink,
      buffer: '',
      bufferMax: bufferMaxFor(spec.scrollbackLines),
      cols,
      rows,
      resizedAt: 0,
      processAt: 0,
    };
    sessions.set(spec.termId, session);

    child.onData((data) => {
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
      if (session.sink.isAlive()) session.sink.sendExit(spec.termId, exitCode);
      sessions.delete(spec.termId);
    });

    // §5.5 #17-20 ④ v4.74 — 실행 런처 갈래. CLI 를 부르지 않고 사용자의 명령을 그대로 넣는다.
    //   `autoRun` 이면 개행까지 붙여 바로 실행하고(사용자가 [실행]을 이미 눌렀으므로),
    //   아니면 CLI prefill 과 같은 규약으로 입력만 채워 둔다.
    if (isRunLauncher && runCommand) {
      setTimeout(() => {
        const s = sessions.get(spec.termId);
        if (s) s.pty.write(spec.autoRun === false ? runCommand : `${runCommand}\r`);
      }, 350);
      return { ok: true };
    }

    // CLI 실행 명령 prefill — 셸 배너/프롬프트가 먼저 그려지도록 살짝 지연 후 write.
    // newline 미포함 = 사용자가 직접 Enter(사람이 루프 안 — ToS 합법선).
    // 최초 spawn 시에만 — reattach 경로는 위에서 이미 return.
    // §4 v2.64 — 앱 재시작 후 이 termId 의 직전 claude 대화가 있으면 `--resume <id>` 로 이어받는다
    //   (PTY 는 죽지만 대화는 JSONL 에 남는다). claude 가 아닌 CLI 는 우리가 대화를 부기하지 않으므로 생략.
    const resumeId = managed ? getCmdResumeSession(spec.termId) : null;
    const { prefill } = buildInteractiveCliPrefill({
      config: spec.config,
      claudeBinPath: binPath,
      rulesDir,
      resumeId,
    });
    if (prefill) {
      setTimeout(() => {
        const s = sessions.get(spec.termId);
        if (s) s.pty.write(prefill);
      }, 350);
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordDiagnostic('main', 'error', `terminal create failed: ${message}`, err instanceof Error ? err.stack : undefined);
    return { ok: false, error: message };
  }
}

/** renderer 의 xterm 키 입력을 PTY stdin 으로 전달. */
export function writeTerminal(termId: string, data: string): void {
  const s = sessions.get(termId);
  if (s) s.pty.write(data);
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
  }
}

/**
 * §4 (CMD 터미널 업그레이드 ②) — 그 터미널의 전경 프로세스명·크기.
 *
 * herdr 의 `pane process-info` 자리다. CMD 탭은 사람이 직접 치므로 첫 프롬프트 기반 자동 이름
 * (§5.5 #17-5)의 근거가 없어 `Sub #N` 에 머물렀다 — 이 값이 탭 라벨 **보조** 표기가 된다
 * (라벨 자체를 덮어쓰지 않는다). `CMD_PROCESS_POLL_MS` 로 스로틀해 표본 비용을 묶는다.
 *
 * node-pty 의 `process` 는 플랫폼에 따라 셸 이름만 주기도 한다 — 값이 비면 직전 표본을 유지한다.
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

/** 터미널 1개 종료 — 탭 명시 닫기 전용(§4 v2.63: IDE 닫기로는 죽이지 않음, 재부착 위해 보존). */
export function killTerminal(termId: string): void {
  const s = sessions.get(termId);
  if (!s) return;
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

/** before-quit 정리 — 살아있는 모든 PTY 종료. */
export function killAllTerminals(): void {
  for (const termId of [...sessions.keys()]) killTerminal(termId);
}

/**
 * §4 (CMD 터미널 업그레이드 ⑥) — loopback REST(`/api/cmd/*`)가 쓰는 제어 인터페이스.
 *
 * server 코어는 desktop 을 import 하지 않으므로(§3.4) main 이 부팅 시 이것을 주입한다.
 * `write` 는 받은 문자열을 **그대로** 넣을 뿐이며, 개행을 걷어 내는 것은 호출부
 * (`sendCmdTerminal`)의 책임이다 — Enter 는 사람이 친다(§4 v2.63 ToS 합법선).
 */
export const terminalController: CmdTerminalController = {
  list: () => [...sessions.keys()],
  exists: (termId) => sessions.has(termId),
  write: (termId, data) => {
    const s = sessions.get(termId);
    if (!s) return false;
    try { s.pty.write(data); return true; } catch { return false; }
  },
  readBuffer: (termId) => sessions.get(termId)?.buffer ?? null,
};
