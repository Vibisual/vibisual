import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import * as pty from 'node-pty';
import type { WebContents } from 'electron';
import { resolveClaudeBin, buildInteractiveClaudeArgs, prepareInteractiveRulesDir, getCmdResumeSession, recordDiagnostic } from '@vibisual/server';
import type { AgentConfig } from '@vibisual/shared';

// 임베디드 인터랙티브 터미널 매니저 — SCENARIO.md §4 v2.63.
//
// 6/15 프로그래매틱 과금 분리 대응. `AgentConfig.executionMode === 'interactive-terminal'` 인
// 커스텀 에이전트를 더블클릭하면 IDE 창 안 xterm.js 가 이 매니저의 PTY 에 붙는다.
//
// 왜 셸(cmd.exe)을 띄우고 claude 를 *prefill* 하나:
//   1) Windows 의 claude 는 보통 `claude.cmd` shim 이라 node-pty(ConPTY/CreateProcess)로 직접
//      spawn 하면 실패한다 → 시스템 셸을 거친다.
//   2) prefill(명령을 미리 입력해두고 사용자가 Enter)은 "사람이 루프 안" 을 보장 — 진짜
//      인터랙티브 세션이라 **구독 과금** + Anthropic ToS 합법선(헤드리스 위장 ❌, §4 v2.63).
//   3) claude 인터랙티브 REPL 도 hook 을 발사하므로 버블맵 시각화는 그대로 유지된다.
//
// 터미널 I/O 는 GraphSnapshot/WS 가 아니라 §5.4 #14-1 별창·§4 v2.44 업데이트 선례대로 shell-state
// 전용 IPC 채널(`vibisual:term:*`)로 흐른다(고빈도 바이트 스트림이 graph broadcast 를 부풀리지 않게).

interface TermSession {
  pty: pty.IPty;
  /** 현재 붙어있는 renderer. IDE 를 닫았다 다시 열면(=컴포넌트 remount) 같은 termId 로 reattach 하며 갱신. */
  wc: WebContents;
  /** scrollback 링버퍼 — reattach 시 새 xterm 에 한 번에 replay 해 이전 출력을 복원(§4 v2.63). */
  buffer: string;
}

const sessions = new Map<string, TermSession>();

/** scrollback 버퍼 상한(바이트). 초과 시 앞부분을 잘라 최근 출력만 유지. */
const TERM_BUFFER_MAX = 256 * 1024;

export interface CreateTerminalSpec {
  termId: string;
  /** 작업 디렉토리 — 보통 그 에이전트가 속한 프로젝트 루트(ProjectInfo.path). */
  cwd: string;
  /** 그 에이전트의 AgentConfig — model/permission/effort/tools/isolation 을 claude 인자로 prefill. */
  config: AgentConfig;
  cols?: number;
  rows?: number;
}

/** 공백 포함 인자만 따옴표 — 셸 prefill 한 줄 구성용. */
function quoteArg(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
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
 * 그 PTY 에 다시 붙어 scrollback 버퍼를 replay 한다 → 진행 중이던 claude 세션이 그대로 보존된다(§4 v2.63).
 * 없을 때만 셸을 cwd 에서 새로 띄우고 claude 실행 명령을 prefill 한다.
 */
export function createTerminal(wc: WebContents, spec: CreateTerminalSpec): { ok: boolean; error?: string } {
  try {
    // 재부착 — 살아있는 PTY 가 있으면 wc 만 갱신하고 그동안의 출력을 한 번에 replay.
    const existing = sessions.get(spec.termId);
    if (existing) {
      existing.wc = wc;
      if (!wc.isDestroyed() && existing.buffer) {
        wc.send('vibisual:term:data', { termId: spec.termId, data: existing.buffer });
      }
      if (spec.cols && spec.rows && spec.cols > 0 && spec.rows > 0) {
        try { existing.pty.resize(spec.cols, spec.rows); } catch { /* gone */ }
      }
      return { ok: true };
    }

    const cwd = spec.cwd && existsSync(spec.cwd) ? spec.cwd : homedir();
    const { shell, shellArgs } = pickShell();
    const cols = spec.cols && spec.cols > 0 ? spec.cols : 80;
    const rows = spec.rows && spec.rows > 0 ? spec.rows : 24;

    // §4 v2.64 — 이 CMD 버블의 agentId(termId=`term:<agentId>:<session>`의 중간 토큰).
    //   아래 env VIBISUAL_OWNER_AGENT_ID 로 셸→claude→hook handler 까지 상속돼, claude 가 쏘는
    //   hook 이벤트가 별개 Hook 버블이 아니라 이 CMD 버블로 귀속된다(server processHookEvent).
    const agentId = spec.termId.split(':')[1] ?? '';

    // §4 v2.64 — rules(시스템 프롬프트)를 파일로 미리 써 둔다(있으면 그 폴더 절대경로). 아래 prefill 의
    //   `--add-dir <rulesDir>` 와 짝. spawn 전에 계산하는 이유: rulesDir 유무로 아래 env 플래그를 켜기 위함.
    const rulesDir = agentId ? prepareInteractiveRulesDir(agentId, spec.config) : null;

    const child = pty.spawn(shell, shellArgs, {
      name: 'xterm-color',
      cols,
      rows,
      cwd,
      // process.env 를 그대로 물려줘 사용자 OAuth/PATH 가 claude 에 닿게 한다(별도 인증 대행 ❌).
      // + 소유자 태그(VIBISUAL_OWNER_AGENT_ID/_TERM_ID) 주입 — 이 PTY 의 자식(claude/hook)만 영향.
      //   AGENT_ID: hook 이벤트를 CMD 버블에 귀속(§4 v2.64). TERM_ID: claude 대화 sessionId 를
      //   termId 별로 기록 → 앱 재시작 후 `--resume` 연속성.
      // + CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 — `--add-dir` 폴더의 CLAUDE.md 를 claude 가
      //   **시작 시 컨텍스트에 자동 주입**하게 하는 플래그. 이게 없으면 add-dir 는 폴더를 "읽을 수 있게"만
      //   열 뿐 rules 가 자동 적용되지 않아 "참고용"에 그친다(강제 X). rules 가 있을 때만 켠다.
      env: {
        ...(process.env as Record<string, string>),
        ...(agentId ? { VIBISUAL_OWNER_AGENT_ID: agentId } : {}),
        VIBISUAL_OWNER_TERM_ID: spec.termId,
        ...(rulesDir ? { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' } : {}),
      },
    });

    const session: TermSession = { pty: child, wc, buffer: '' };
    sessions.set(spec.termId, session);

    child.onData((data) => {
      session.buffer += data;
      if (session.buffer.length > TERM_BUFFER_MAX) {
        session.buffer = session.buffer.slice(-TERM_BUFFER_MAX);
      }
      if (!session.wc.isDestroyed()) session.wc.send('vibisual:term:data', { termId: spec.termId, data });
    });
    child.onExit(({ exitCode }) => {
      if (!session.wc.isDestroyed()) session.wc.send('vibisual:term:exit', { termId: spec.termId, exitCode });
      sessions.delete(spec.termId);
    });

    // claude 실행 명령 prefill — 셸 배너/프롬프트가 먼저 그려지도록 살짝 지연 후 write.
    // newline 미포함 = 사용자가 직접 Enter(사람이 루프 안 — ToS 합법선).
    // 최초 spawn 시에만 — reattach 경로는 위에서 이미 return.
    const { binPath } = resolveClaudeBin();
    // rules(멀티라인 시스템 프롬프트)는 prefill 한 줄에 못 넣으므로 §4 v2.63 파일 경유:
    //   ~/.vibisual/cmd-agents/<agentId>/CLAUDE.md 에 써 두고 `--add-dir` + env 플래그로 시작 시 자동 주입.
    //   rulesDir 는 위(spawn 전)에서 이미 계산.
    // §4 v2.64 — 앱 재시작 후 이 termId 의 직전 claude 대화가 있으면 `--resume <id>` 로 이어받는다.
    //   (PTY 프로세스는 종료로 죽지만 claude 대화는 JSONL 에 남아 resume 가능 — 사용자가 Enter 로 실행.)
    const resumeId = getCmdResumeSession(spec.termId);
    const args = buildInteractiveClaudeArgs(spec.config, { includeRules: false });
    if (rulesDir) args.push('--add-dir', rulesDir);
    const fullArgs = resumeId ? ['--resume', resumeId, ...args] : args;
    const prefill = [binPath, ...fullArgs].map(quoteArg).join(' ');
    setTimeout(() => {
      const s = sessions.get(spec.termId);
      if (s) s.pty.write(prefill);
    }, 350);

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
  if (cols > 0 && rows > 0) {
    try { s.pty.resize(cols, rows); } catch { /* PTY already gone */ }
  }
}

/** 터미널 1개 종료 — 탭 명시 닫기 전용(§4 v2.63: IDE 닫기로는 죽이지 않음, 재부착 위해 보존). */
export function killTerminal(termId: string): void {
  const s = sessions.get(termId);
  if (!s) return;
  sessions.delete(termId);
  try { s.pty.kill(); } catch { /* already exited */ }
}

/** 특정 webContents 에 속한 모든 터미널 종료 — 창이 파괴될 때(앱/별창 닫힘). */
export function killTerminalsForWebContents(wcId: number): void {
  for (const [termId, s] of sessions) {
    if (s.wc.id === wcId) killTerminal(termId);
  }
}

/** before-quit 정리 — 살아있는 모든 PTY 종료. */
export function killAllTerminals(): void {
  for (const termId of [...sessions.keys()]) killTerminal(termId);
}
