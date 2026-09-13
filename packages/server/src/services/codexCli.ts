import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { CODEX_HOME_ENV, CODEX_HOME_DIRNAME } from '@vibisual/shared';
import { resolveBinary, augmentedEnv, resetBinLocatorCache } from './binLocator.js';
import { buildCliInvocation } from './claudeCliRun.js';
import { logger } from '../logger.js';

/**
 * §5.25 (D)(E) — `codex` 실행본을 찾고, 하위명령을 **한 번 실행해 출력을 받아오는** 공통 창구.
 *
 * 클로드 쪽 `claudeBin.ts` + `claudeCliRun.ts` 가 하는 일의 코덱스 판이다. 다만 클로드처럼
 * 출처가 여러 갈래(VS Code 확장 번들·네이티브 인스톨러·npm)가 아니라 **npm 전역 설치 한 갈래**라
 * 판정이 훨씬 짧다 — 없는 갈래를 미리 만들지 않는다.
 *
 * **PATH 만 믿지 않는다**(멀티플랫폼 3축): Finder 로 띄운 mac 앱은 Homebrew·npm 전역 경로가 없는
 * 최소 PATH 를 받는다. 그래서 탐색은 `resolveBinary()` 에 맡기고, 자식에게는 보강된 PATH 를 준다.
 *
 * **오래 사는 자식이 아니다** — `login status`·`--version` 처럼 즉시 끝나는 probe 라
 * 프로세스 그룹(`processGroupSpawnOptions`)을 일부러 붙이지 않는다(claudeCliRun 과 같은 판단).
 * 턴을 도는 `codex exec` 쪽은 `codexRunner.ts` 가 따로 그룹을 붙여 띄운다.
 */

export interface CodexCliRunResult {
  code: number | null;
  /** stdout + stderr 합본. */
  out: string;
  /** spawn 자체가 실패했거나(바이너리 없음) 타임아웃으로 죽였을 때. */
  failure?: 'spawn' | 'timeout';
}

export interface CodexCliRunOptions {
  cwd?: string;
  extraEnv?: Record<string, string>;
}

let cachedBin: string | null | undefined;

/**
 * 코덱스 홈 디렉터리.
 *
 * **세 OS 가 같다** — 코덱스는 OS별 설정 폴더(`%APPDATA%` / `~/Library/Application Support` /
 * `~/.config`)를 쓰지 않고 홈 아래 한 곳을 쓴다. 그래서 여기엔 플랫폼 분기가 없고, 대신
 * 환경변수 오버라이드(`CODEX_HOME`)를 존중한다.
 *
 * **env·home 을 인자로 받는다** — 함수 안에서 `process.env` 를 읽으면 그 분기는 테스트에서
 * 영영 검증되지 않는다(멀티플랫폼 규칙 4축).
 */
export function codexHomeIn(env: NodeJS.ProcessEnv, home: string): string {
  const override = env[CODEX_HOME_ENV];
  if (typeof override === 'string' && override.trim()) return override.trim();
  return path.join(home, CODEX_HOME_DIRNAME);
}

/** 지금 프로세스 기준의 코덱스 홈. */
export function codexHome(): string {
  return codexHomeIn(process.env, os.homedir());
}

/**
 * `codex --version` 출력에서 버전만 뗀다.
 *
 * 실측 출력은 `codex-cli 0.152.1` 이지만 **형식을 못박지 않는다** — 어디에 있든 첫 번째
 * `숫자.숫자.숫자` 를 집는다(앞에 배너가 붙거나 이름이 바뀌어도 살아남게).
 */
export function parseCodexVersion(raw: string): string | undefined {
  const m = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(raw);
  return m?.[1];
}

/** 실행본 경로. 못 찾으면 null. 결과는 캐시하며 설치 후 `invalidateCodexBinCache()` 로 지운다. */
export function getCodexBin(): string | null {
  if (cachedBin !== undefined) return cachedBin;
  cachedBin = resolveBinary('codex');
  if (cachedBin) logger.info(`[codex] bin resolved: ${cachedBin}`);
  return cachedBin;
}

/** 설치 직후처럼 PATH 가 바뀌었을 수 있는 시점에 부른다. */
export function invalidateCodexBinCache(): void {
  cachedBin = undefined;
  resetBinLocatorCache();
}

/** codex 하위명령 1회 실행 — 실패해도 throw 하지 않고 `failure` 로 알린다. */
export function runCodexCli(
  args: readonly string[],
  timeoutMs: number,
  options: CodexCliRunOptions = {},
): Promise<CodexCliRunResult> {
  const binPath = getCodexBin();
  if (!binPath) return Promise.resolve({ code: null, out: '', failure: 'spawn' });

  // Windows 의 `codex.cmd` shim 은 Node 가 직접 exec 하지 못한다 — 셸 경유·따옴표 처리는
  //   클로드 쪽이 이미 아는 형태라 그 함수를 그대로 빌린다(두 벌이 되면 한쪽만 고쳐진다).
  const invocation = buildCliInvocation(binPath, args, process.platform);

  return new Promise<CodexCliRunResult>((resolve) => {
    let done = false;
    let out = '';
    const finish = (r: CodexCliRunResult): void => {
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
        env: augmentedEnv(options.extraEnv ? { ...process.env, ...options.extraEnv } : undefined),
        ...(options.cwd ? { cwd: options.cwd } : {}),
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
    child.on('error', () => {
      clearTimeout(timer);
      // 실행본이 사라졌을 수 있다 — 다음 판정이 다시 찾도록 캐시를 비운다.
      cachedBin = undefined;
      finish({ code: null, out, failure: 'spawn' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code, out });
    });
  });
}
