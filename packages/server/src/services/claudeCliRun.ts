import { spawn } from 'node:child_process';
import { getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';
import { logger } from '../logger.js';

/**
 * §4 — `claude` 하위명령을 **한 번 실행하고 출력을 받아오는** 공통 창구.
 *
 * `claudeAuthService`(로그인 상태 판정)와 `claudeUsageProbe`(사용량 조회)가 같은 모양의 실행을
 * 필요로 해서, 종전 auth 서비스 안에 있던 private `runClaude` 를 그대로 끌어올린 것이다 —
 * spawn 옵션(특히 Windows 셸 경유·`windowsHide`)이 두 벌로 갈라지면 한쪽만 고쳐지는 사고가 난다.
 *
 * **오래 사는 자식이 아니다.** 프로세스 그룹(`processGroupSpawnOptions`)은 **일부러 안 붙인다** —
 * `auth status --json` · `-p "/usage"` 처럼 손자를 만들지 않고 즉시 끝나는 probe 라, 회수도
 * killTree 가 아니라 단일 kill 로 충분하다. 안 붙인 이유가 여기 없으면 다음 사람이 "빠뜨렸다"고
 * 보고 무의미하게 넓힌다.
 */

export interface ClaudeCliRunResult {
  code: number | null;
  /** stdout + stderr 합본. */
  out: string;
  /** spawn 자체가 실패했거나(바이너리 없음) 타임아웃으로 죽였을 때. */
  failure?: 'spawn' | 'timeout';
}

export interface ClaudeCliRunOptions {
  /** 실행 디렉터리. 안 주면 부모 프로세스의 cwd. */
  cwd?: string;
  /** 추가 환경변수(부모 env 위에 덮어쓴다). */
  extraEnv?: Record<string, string>;
}

/** spawn 에 넘길 실행 형태 — 셸 경유 여부까지 포함. */
export interface CliInvocation {
  file: string;
  args: string[];
  shell: boolean;
}

/**
 * `cmd.exe /d /s /c` 가 메타문자로 읽는 글자들. cross-spawn 이 쓰는 집합과 같다 —
 * 여기서 빠진 글자 하나가 그대로 명령 주입 통로가 되므로 임의로 줄이지 말 것.
 */
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

/**
 * **실행본 경로**를 cmd 명령줄에 넣을 형태로 바꾼다.
 *
 * 인자와 달리 따옴표로 감싸지 않는다 — 감싸면 `cmd /d /s /c` 가 줄 전체의 바깥 따옴표를
 * 벗기는 규칙과 겹쳐 경로 해석이 깨진다(실측: "파일 이름, 디렉터리 이름 또는 볼륨 레이블
 * 구문이 잘못되었습니다"). 대신 메타문자를 `^` 로 **한 번만** 덮는다. Windows 경로에는
 * `"` 가 올 수 없으므로 혹시 섞여 있으면 잘라 낸다 — 인용 상태를 뒤집는 유일한 글자다.
 */
function escapeCmdCommand(value: string): string {
  return value.replace(/"/g, '').replace(CMD_META_CHARS, '^$1');
}

/**
 * **인자 하나**를 cmd 명령줄에 넣을 형태로 바꾼다. 2단이다.
 *
 * 1. `CommandLineToArgvW` 규칙으로 따옴표를 만든다 — 역슬래시 뭉치는 배로 늘리고 `"` 는
 *    `\"` 로 escape 한 뒤 전체를 `"…"` 로 감싼다. 자식이 argv 를 복원할 때 원래 문자열을
 *    **그대로** 돌려받는다.
 * 2. 메타문자를 `^` 로 **두 번** 덮는다. `.cmd` shim 은 안에서 `%*` 로 인자를 다시 펼치기
 *    때문에 cmd 가 같은 줄을 두 번 읽는다 — 한 번만 덮으면 두 번째 읽기에서 벗겨진 `&` 가
 *    되살아난다.
 *
 * 종전 `quoteForShell` 은 `[\s&|<>^]` 이 없는 값(예: `"` 하나뿐인 모델명)을 **그대로**
 * 흘려 보냈다. 그 `"` 하나가 cmd 의 인용 상태를 뒤집으면, 뒤따르는 인자에서 따옴표로 감싼
 * `&` 가 인용 **밖**으로 나와 실행됐다(PoC 로 실행까지 확인). 개행이 든 값이 조용히 잘려
 * 나가던 것(`runBackgroundTaskProbe`·`runSessionLivenessProbe` 의 프롬프트)도 같은 뿌리다.
 */
function escapeCmdArgument(value: string): string {
  const quoted = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(CMD_META_CHARS, '^$1').replace(CMD_META_CHARS, '^$1');
}

/**
 * 실행본 경로 + 인자 → 실제 spawn 형태.
 *
 * **`platform` 을 인자로 받는다**(멀티플랫폼 규칙 — 함수 안에서 `process.platform` 을 읽으면
 * 그 분기는 개발기 한 곳에서만 돌아 영영 검증되지 않는다).
 *
 * - Windows 에서 실행본이 `.cmd`/`.bat` shim(예: npm 전역 설치)이면 **셸 경유가 필수**다
 *   (Node 는 배치 파일을 직접 exec 하지 못한다). 이때만 cmd 인용 규칙이 끼어들므로 경로는
 *   `escapeCmdCommand`, 인자는 `escapeCmdArgument` 로 덮는다 — 안 덮으면 `C:\Program Files\…`
 *   처럼 **공백이 든 설치 경로**에서 명령이 두 동강 나고, 그보다 나쁘게는 인자에 섞인 `"`·`&`
 *   가 **명령 주입**이 된다(§보안 감사 2026-09-09).
 * - 그 외(네이티브 `claude.exe`, mac/linux 실행본)는 셸을 끼우지 않는다. 셸이 없으면 인용
 *   규칙 자체가 사라져 공백 문제도 함께 사라진다.
 */
export function buildCliInvocation(
  binPath: string,
  args: readonly string[],
  platform: NodeJS.Platform,
): CliInvocation {
  const needsShell = platform === 'win32' && /\.(cmd|bat)$/i.test(binPath);
  if (!needsShell) return { file: binPath, args: [...args], shell: false };
  return {
    file: escapeCmdCommand(binPath),
    args: args.map(escapeCmdArgument),
    shell: true,
  };
}

/** claude 하위명령 1회 실행 — 실패해도 throw 하지 않고 `failure` 로 알린다. */
export function runClaudeCli(
  args: readonly string[],
  timeoutMs: number,
  options: ClaudeCliRunOptions = {},
): Promise<ClaudeCliRunResult> {
  let binPath: string | undefined;
  try {
    binPath = getClaudeBin()?.binPath;
  } catch {
    /* PATH 미발견 */
  }
  if (!binPath) return Promise.resolve({ code: null, out: '', failure: 'spawn' });

  const invocation = buildCliInvocation(binPath, args, process.platform);

  // 실측(2026-09-09): `cmd.exe /d /s /c` 는 명령줄에 든 **개행에서 줄을 끊는다.** 인용 안쪽,
  // `^` 줄연결, `^^`+빈 줄, CRLF 까지 다섯 형태를 다 재 봤지만 개행이 살아남는 형태는 없었다
  // (cross-spawn 도 같은 한계를 가진다). 즉 Windows `.cmd` shim 경유일 때 여러 줄 프롬프트는
  // **첫 줄까지만** 자식에게 간다. 조용히 잘리면 probe 가 근거 일부만 보고 판정하므로, 고칠 수
  // 없는 자리라도 잘렸다는 사실은 남긴다.
  if (invocation.shell && args.some((a) => /[\r\n]/.test(a))) {
    logger.warn('[claude-cli] .cmd shim 경유 — 개행이 든 인자는 첫 줄까지만 전달된다(cmd.exe 한계)');
  }

  return new Promise<ClaudeCliRunResult>((resolve) => {
    let done = false;
    let out = '';
    const finish = (r: ClaudeCliRunResult): void => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(invocation.file, invocation.args, {
        shell: invocation.shell,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.extraEnv ? { env: { ...process.env, ...options.extraEnv } } : {}),
      });
    } catch {
      return finish({ code: null, out: '', failure: 'spawn' });
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ code: null, out, failure: 'timeout' });
    }, timeoutMs);
    child.stdout?.on('data', (c) => {
      out += String(c);
    });
    child.stderr?.on('data', (c) => {
      out += String(c);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      noteClaudeSpawnFailure(err);
      finish({ code: null, out, failure: 'spawn' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code, out });
    });
  });
}
