import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { claudeSpawnEnv, getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';
import { resolveBinary } from './binLocator.js';
import { logger } from '../logger.js';

/**
 * §4 — `claude` 하위명령을 **한 번 실행하고 출력을 받는** 공통 창구(`claudeAuthService`·`claudeUsageProbe`). spawn 옵션(Windows 셸 경유·`windowsHide`)이 두 벌로 갈리면 한쪽만 고쳐진다.
 * **오래 사는 자식이 아니다** — `auth status --json`·`-p "/usage"` 는 손자 없이 바로 끝나는 probe 라 프로세스 그룹(`processGroupSpawnOptions`)은 **일부러 안 붙인다** — 단일 kill 로 회수한다(빠뜨린 것이 아니다).
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
 * **실행본 경로**를 cmd 명령줄에 넣을 형태로. 따옴표로 감싸지 않는다 — `cmd /d /s /c` 의 바깥 따옴표 벗기기와 겹쳐 경로 해석이 깨진다(실측: "파일 이름, 디렉터리 이름 또는 볼륨 레이블 구문이 잘못되었습니다").
 * 메타문자는 `^` 로 **한 번만** 덮는다. Windows 경로엔 `"` 가 올 수 없으므로 섞여 있으면 잘라 낸다(인용 상태를 뒤집는 유일한 글자).
 */
function escapeCmdCommand(value: string): string {
  return value.replace(/"/g, '').replace(CMD_META_CHARS, '^$1');
}

/**
 * **인자 하나**를 cmd 명령줄에 넣을 형태로 — 2단이다.
 * 1. `CommandLineToArgvW` 규칙으로 따옴표를 만든다(역슬래시 뭉치는 배로, `"` 는 `\"`, 전체를 `"…"`) — 자식이 원래 문자열을 그대로 돌려받는다.
 * 2. 메타문자를 `^` 로 **두 번** 덮는다 — `.cmd` shim 은 `%*` 로 인자를 다시 펼쳐 cmd 가 같은 줄을 두 번 읽으므로, 한 번만 덮으면 벗겨진 `&` 가 되살아난다.
 * 메타문자가 없어 보이는 값도 그대로 흘리지 않는다 — `"` 하나가 인용 상태를 뒤집으면 뒤 인자의 따옴표 속 `&` 가 실행된다(PoC 로 확인).
 */
function escapeCmdArgument(value: string): string {
  const quoted = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(CMD_META_CHARS, '^$1').replace(CMD_META_CHARS, '^$1');
}

/**
 * 실행본 경로 + 인자 → 실제 spawn 형태. `platform` 은 인자로 받는다(멀티플랫폼 규칙).
 * - Windows `.cmd`·`.bat` shim(npm 전역 설치 등)은 **셸 경유가 필수**다(Node 는 배치 파일을 직접 exec 못 한다). 이때만 경로는 `escapeCmdCommand`, 인자는 `escapeCmdArgument` 로 덮는다.
 * 안 덮으면 `C:\Program Files\…` 같은 공백 경로에서 명령이 두 동강 나고, 인자의 `"`·`&` 가 명령 주입이 된다(§보안 감사 2026-09-09).
 * - 그 외(네이티브 `claude.exe`, mac/linux 실행본)는 셸을 끼우지 않는다 — 인용 규칙도 공백 문제도 함께 사라진다.
 */
export function buildCliInvocation(
  binPath: string,
  args: readonly string[],
  platform: NodeJS.Platform,
  shim: CmdShimReader = defaultCmdShimReader,
): CliInvocation {
  const needsShell = platform === 'win32' && /\.(cmd|bat)$/i.test(binPath);
  if (!needsShell) return { file: binPath, args: [...args], shell: false };
  // npm 전역 설치(`claude.cmd`·`codex.cmd`)는 셸 없이 그 안의 프로그램을 직접 띄운다 — cmd.exe 를 타면 개행 든 인자
  //   (에이전트 규칙 `--append-system-prompt`)가 첫 줄에서 잘리고, 오래 사는 엔진 앞에 cmd.exe 가 하나 더 낀다.
  const target = resolveCmdShimTarget(binPath, shim);
  if (target) return { file: target.file, args: [...target.prefixArgs, ...args], shell: false };
  return {
    file: escapeCmdCommand(binPath),
    args: args.map(escapeCmdArgument),
    shell: true,
  };
}

/** `.cmd` 심을 읽어 풀 때 쓰는 입출력 — 순수 판정을 세 OS 에서 시험하려고 주입한다. */
export interface CmdShimReader {
  read(file: string): string | null;
  isFile(file: string): boolean;
  /** `%_prog%` 가 심 옆 `node.exe` 가 아닐 때 쓰는 Node. */
  node(): string | null;
}

const defaultCmdShimReader: CmdShimReader = {
  read(file) {
    try {
      const st = fs.statSync(file);
      // 심은 수백 바이트다 — 큰 배치 파일은 우리가 아는 형태가 아니다.
      return st.isFile() && st.size <= 16_384 ? fs.readFileSync(file, 'utf8') : null;
    } catch {
      return null;
    }
  },
  isFile(file) {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  },
  node: () => resolveBinary('node'),
};

/**
 * Windows `.cmd` 심이 실제로 띄우는 프로그램. npm cmd-shim(`"%_prog%"  "%dp0%\node_modules\…\cli.js" %*`,
 * 네이티브 대상은 `"%dp0%\…\x.exe" %*`)과 절대경로 한 줄 런처(`"C:\…\node.exe" "C:\…\x.mjs" %*`)만 푼다.
 * 모르는 변수·없는 파일·토큰 셋 이상이면 null — 그때는 종전대로 셸을 탄다(추측으로 다른 프로그램을 띄우지 않는다).
 */
export function resolveCmdShimTarget(
  shimPath: string,
  shim: CmdShimReader,
): { file: string; prefixArgs: string[] } | null {
  const text = shim.read(shimPath);
  if (!text) return null;
  const line = text.split(/\r?\n/).reverse().find((l) => l.includes('%*'));
  if (!line) return null;
  const head = line.slice(0, line.indexOf('%*'));
  const quoted = [...head.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  if (quoted.length === 0 || quoted.length > 2) return null;
  const dir = path.win32.dirname(path.win32.resolve(shimPath)) + path.win32.sep;
  const tokens: string[] = [];
  for (const raw of quoted) {
    let value = raw.replace(/%~dp0/gi, dir).replace(/%dp0%/gi, dir);
    if (/%_prog%/i.test(value)) {
      const local = path.win32.join(dir, 'node.exe');
      const node = shim.isFile(local) ? local : shim.node();
      if (!node) return null;
      value = value.replace(/%_prog%/gi, node);
    }
    if (value.includes('%')) return null;
    const normalized = path.win32.normalize(value);
    if (!path.win32.isAbsolute(normalized) || !shim.isFile(normalized)) return null;
    tokens.push(normalized);
  }
  // 심이 다른 배치 파일을 부르면 풀어도 같은 문제가 남는다.
  if (/\.(cmd|bat)$/i.test(tokens[0]!)) return null;
  return { file: tokens[0]!, prefixArgs: tokens.slice(1) };
}

/**
 * 엔진 실행본(claude·codex)을 오래 사는 자식으로 띄우는 공용 창구. 옵션의 `shell` 은 무시하고 실행 형태가 정한다.
 * `spawn(bin, args, { shell: false })` 로 직접 부르면 Windows `.cmd` 심에서 Node 가 `EINVAL` 로 거절한다(CVE-2024-27980 이후).
 */
export function spawnEngineProcess(binPath: string, args: readonly string[], options: SpawnOptions): ChildProcess {
  const invocation = buildCliInvocation(binPath, args, process.platform);
  if (invocation.shell && args.some((a) => /[\r\n]/.test(a))) {
    logger.warn('[engine-spawn] .cmd shim via cmd.exe — arguments containing newlines are cut at the first line');
  }
  return spawn(invocation.file, invocation.args, { ...options, shell: invocation.shell });
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

  // 실측(2026-09-09): `cmd.exe /d /s /c` 는 명령줄의 **개행에서 줄을 끊는다** — 인용 안쪽·`^` 줄연결·`^^`+빈 줄·CRLF 어느 형태도 살아남지 않았다(cross-spawn 도 같다).
  // 그래서 `.cmd` shim 경유의 여러 줄 프롬프트는 첫 줄까지만 간다. 고칠 수 없지만 probe 가 근거 일부만 보고 판정하므로 잘렸다는 사실은 남긴다.
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
        // §4 (앱 전용 엔진) ⑤ — 앱 전용 실행본이면 엔진 자체 갱신을 끈다(`claudeSpawnEnv`).
        env: claudeSpawnEnv(options.extraEnv ? { ...process.env, ...options.extraEnv } : process.env, binPath),
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
