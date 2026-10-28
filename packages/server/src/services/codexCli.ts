import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findManagedBin, isManagedEngineBin } from './managedEngineLayout.js';
import { CODEX_HOME_ENV, CODEX_HOME_DIRNAME, type CodexBinSource } from '@vibisual/shared';
import { resolveBinary, augmentedEnv, resetBinLocatorCache } from './binLocator.js';
import { samePath } from './pathKey.js';
import { buildCliInvocation } from './claudeCliRun.js';
import { logger } from '../logger.js';

/**
 * §5.25 (D)(E) — `codex` 실행본을 찾고 하위명령을 **한 번 실행해 출력을 받는** 공통 창구(클로드의 `claudeBin.ts` + `claudeCliRun.ts` 에 해당).
 * **PATH 만 믿지 않는다**(멀티플랫폼 3축) — Finder 로 띄운 mac 앱은 Homebrew·npm 전역 경로가 없는 최소 PATH 를 받는다. 탐색은 `resolveBinary()`, 자식에게는 보강된 PATH 를 준다.
 * **오래 사는 자식이 아니다** — `login status`·`--version` 같은 즉시 끝나는 probe 라 프로세스 그룹을 일부러 안 붙인다. 턴을 도는 `codex exec` 는 `codexRunner.ts` 가 그룹을 붙여 띄운다.
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
  /** 이 실행본으로 돌린다(Version 탭이 설치본마다 판을 물을 때). 없으면 지금 쓰는 실행본. */
  binPath?: string;
}

let cachedBin: string | null | undefined;

/**
 * 코덱스 홈 디렉터리. **세 OS 가 같다** — OS별 설정 폴더(`%APPDATA%` 등)가 아니라 홈 아래 한 곳이라 플랫폼 분기가 없고, `CODEX_HOME` 오버라이드를 존중한다.
 * env·home 은 인자로 받는다(함수 안에서 `process.env` 를 읽으면 그 분기가 시험되지 않는다).
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

/** `codex --version` 출력에서 버전만 뗀다. 실측 출력은 `codex-cli 0.152.1` 이지만 형식을 못박지 않고 첫 `숫자.숫자.숫자` 를 집는다(배너·이름이 바뀌어도 살아남게). */
export function parseCodexVersion(raw: string): string | undefined {
  const m = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(raw);
  return m?.[1];
}

/**
 * 공식 install.ps1/install.sh 의 기본 위치 + CODEX_INSTALL_DIR 재정의.
 * Windows 는 ~/.local/bin 이 아니라 LocalAppData/Programs/OpenAI/Codex/bin 이다.
 * 플랫폼·환경·홈을 주입해 PATH 갱신 전의 설치 직후를 세 OS 모두 검증한다.
 */
export function codexStandaloneCandidatesIn(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const name = platform === 'win32' ? 'codex.exe' : 'codex';
  const defaultDir = platform === 'win32'
    ? p.join(env['LOCALAPPDATA'] || p.join(home, 'AppData', 'Local'), 'Programs', 'OpenAI', 'Codex', 'bin')
    : p.join(home, '.local', 'bin');
  const override = env['CODEX_INSTALL_DIR']?.trim();
  return [...(override ? [p.join(override, name)] : []), p.join(defaultDir, name)];
}

/**
 * §4 (앱 전용 엔진) ④ — 사용자가 Version 탭 코덱스 칸에서 **보조로 고른** 경로(`UserDefaults.codexBinPath`).
 * `claudeBin.readClaudeBinOverride` 와 같은 이유로 글로벌 설정 파일을 동기로 직접 읽는다(서비스 import ❌).
 */
const USER_DEFAULTS_FILE = path.join(os.homedir(), '.vibisual', 'user-defaults.json');

/** 고른 경로 원문 — 미설정·빈 문자열·파일 없음·파싱 실패면 null. 존재 검증은 `codexBinOverride` 가 한다. */
export function readCodexBinOverride(file: string = USER_DEFAULTS_FILE): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { codexBinPath?: unknown };
    const p = parsed?.codexBinPath;
    if (typeof p === 'string' && p.trim().length > 0) return p.trim();
  } catch {
    /* 파일 없음/파싱 실패 — 고른 것 없음 */
  }
  return null;
}

/**
 * 쓸 수 있는 보조 선택 — 그 파일이 있고, 앱 전용 폴더 안이 아닐 때만. 앱 전용 판을 가리키는 옛 선택은 "기본"과 같다
 * (판 경로로 굳히면 앱이 판을 바꿔도 옛 판에 남는다). 사라진 파일을 고른 채면 기본으로 떨어진다.
 */
export function codexBinOverride(raw: string | null = readCodexBinOverride()): string | null {
  if (!raw) return null;
  if (isManagedEngineBin('codex', raw)) return null;
  try {
    return fs.statSync(raw).isFile() ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 실행본 경로. 못 찾으면 null. 결과는 캐시하고 설치 후 `invalidateCodexBinCache()` 로 지운다. 캐시된 경로가 사라졌으면(판 정리·폴더 삭제) 그 자리에서 다시 찾는다.
 * §4 (앱 전용 엔진) — 순서: Version 탭에서 **보조로 고른** 설치본(Claude `claudeBinPath` 와 같은 규칙) → **앱 전용 사본**(`~/.vibisual/cli-engines/codex/versions/<판>` — 판을 바꾸는 권한이 앱에 있다) → 사용자 PATH 의 npm·독립 설치본(첫 받기 전·오프라인일 때만).
 */
export function getCodexBin(): string | null {
  if (cachedBin !== undefined && (cachedBin === null || fs.existsSync(cachedBin))) return cachedBin;
  cachedBin = codexBinOverride()
    ?? findManagedBin('codex')
    ?? resolveBinary('codex', codexStandaloneCandidatesIn(process.platform, process.env, os.homedir()));
  if (cachedBin) logger.info(`[codex] bin resolved: ${cachedBin}${isManagedEngineBin('codex', cachedBin) ? ' (app-managed)' : ''}`);
  return cachedBin;
}

/** 실행본 경로의 출처 — 앱 전용 폴더 안이면 `managed`, 공식 독립 설치 위치면 `standalone`, 그 밖은 `path`. */
export function classifyCodexBinSourceIn(
  binPath: string,
  standaloneCandidates: readonly string[],
  isManaged: (p: string) => boolean,
): CodexBinSource {
  if (isManaged(binPath)) return 'managed';
  if (standaloneCandidates.some((c) => samePath(c, binPath))) return 'standalone';
  return 'path';
}

/**
 * Version 탭 코덱스 칸의 고르기 목록 — 앱 전용(지금 판) · 고른 것 · PATH 의 것 · 공식 독립 설치 위치. 같은 실행본은 한 줄.
 * 앱 전용 판은 맨 앞에 두되 화면은 그것을 "기본" 자리에 싣는다(다른 설치본 묶음에 다시 싣지 않는다).
 */
export function discoverCodexBins(): Array<{ binPath: string; source: CodexBinSource }> {
  const standalone = codexStandaloneCandidatesIn(process.platform, process.env, os.homedir());
  const out: Array<{ binPath: string; source: CodexBinSource }> = [];
  const push = (p: string | null): void => {
    if (!p || out.some((e) => samePath(e.binPath, p))) return;
    out.push({ binPath: p, source: classifyCodexBinSourceIn(p, standalone, (x) => isManagedEngineBin('codex', x)) });
  };
  push(findManagedBin('codex'));
  push(readCodexBinOverride());
  push(resolveBinary('codex'));
  for (const c of standalone) {
    try {
      if (fs.statSync(c).isFile()) push(c);
    } catch { /* 없음 */ }
  }
  return out;
}

/** 지금 쓰는 코덱스가 앱 전용 사본인가(CMD 에 절대 경로 · 업데이트 확인 끄기를 실을지). */
export function isManagedCodexBin(binPath: string | null | undefined): boolean {
  return !!binPath && isManagedEngineBin('codex', binPath);
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
  const binPath = options.binPath ?? getCodexBin();
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
      // 실행본이 사라졌을 수 있다 — 다음 판정이 다시 찾도록 캐시를 비운다(지정 실행본으로 물은 것은 캐시와 무관).
      if (!options.binPath) cachedBin = undefined;
      finish({ code: null, out, failure: 'spawn' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ code, out });
    });
  });
}
