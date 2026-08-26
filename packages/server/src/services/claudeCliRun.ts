import { spawn } from 'node:child_process';
import { getClaudeBin, noteClaudeSpawnFailure } from './claudeBin.js';

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

/** 셸 명령줄에 넣을 때만 감싼다 — 이미 따옴표가 있거나 공백이 없으면 그대로. */
function quoteForShell(value: string): string {
  if (!/[\s&|<>^]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * 실행본 경로 + 인자 → 실제 spawn 형태.
 *
 * **`platform` 을 인자로 받는다**(멀티플랫폼 규칙 — 함수 안에서 `process.platform` 을 읽으면
 * 그 분기는 개발기 한 곳에서만 돌아 영영 검증되지 않는다).
 *
 * - Windows 에서 실행본이 `.cmd`/`.bat` shim(예: npm 전역 설치)이면 **셸 경유가 필수**다
 *   (Node 는 배치 파일을 직접 exec 하지 못한다). 이때는 경로·인자를 따옴표로 감싼다 —
 *   감싸지 않으면 `C:\Program Files\…` 처럼 **공백이 든 설치 경로**에서 명령이 두 동강 난다.
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
    file: quoteForShell(binPath),
    args: args.map(quoteForShell),
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
