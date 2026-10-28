/**
 * binLocator.ts — **외부 실행 파일을 찾는 단 하나의 자리**(멀티플랫폼). 지우지 말 것.
 * Finder/Dock 으로 띄운 macOS 앱은 `launchd` 에서 나와 PATH 가 `/usr/bin:/bin:/usr/sbin:/sbin` 뿐이다 — Homebrew(`/opt/homebrew/bin`·`/usr/local/bin`)가 없어, PATH 만 믿는 코드는 깔린 도구도 예외·로그 없이 "없음"으로 답한다.
 * `claudeBin.ts`(`pathAndKnownCandidates`)·`mediaTools.ts`(`knownLocations`)의 패턴을 하나로 뽑아 나머지(에디터 실행·디버그 어댑터·MCP 실행 파일·brew 대행·로컬 도구 셸)가 같은 규율을 탄다.
 * ① PATH 를 보강해서 본다(현재 PATH → 필요할 때 1회 읽은 로그인 셸 PATH → 알려진 설치 위치). ② 로그인 셸은 많아야 한 번 띄우고 프로세스 수명 동안 캐시한다(매번 띄우면 파일 열 때마다 프로세스가 뜬다).
 * ③ 플랫폼·env·존재확인을 주입받게 둔다 — 그래야 세 OS 를 그 OS 에 가지 않고 단위 테스트로 고정한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** 로그인 셸 PATH 조회 상한 — 없으면 없는 대로 간다. 사용자를 여기서 기다리게 하지 않는다. */
export const LOGIN_SHELL_PATH_TIMEOUT_MS = 2_500;

/** 로그인 셸 출력에서 우리 줄만 골라내는 표식(MOTD·배너가 함께 찍히는 셸이 있다). */
const LOGIN_PATH_MARKER = '__VIBISUAL_PATH__';

/**
 * 탐색에 쓰는 주입 가능한 환경. 실제 호출은 `currentContext()` 가 만든 것을 쓰고,
 * 테스트는 세 플랫폼을 그대로 흉내 낸 것을 넣는다.
 */
export interface BinLocatorContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** 홈 디렉터리(`~` 후보를 푸는 기준). */
  home: string;
  /** 이 절대경로가 **실행 가능한 파일**인가. */
  isExecutableFile: (candidate: string) => boolean;
  /** 로그인 셸에서 읽어 둔 PATH 문자열(없으면 null). 순수 부분은 셸을 띄우지 않는다 — 읽기는 런타임 래퍼의 몫. */
  loginShellPath: string | null;
}

/** 그 플랫폼의 경로 유틸 — 테스트에서 platform 을 갈아끼워도 구분자가 따라오게 한다. */
function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** PATH 구분자. */
export function pathDelimiterFor(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':';
}

/** env 에서 PATH 를 읽는다 — Windows 는 키 대소문자가 제각각이라 전부 훑는다(`Path`/`PATH`). */
function readPathValue(env: NodeJS.ProcessEnv): string {
  const direct = env['PATH'] ?? env['Path'] ?? env['path'];
  if (typeof direct === 'string') return direct;
  for (const [k, v] of Object.entries(env)) {
    if (k.toLowerCase() === 'path' && typeof v === 'string') return v;
  }
  return '';
}

/**
 * PATH 문자열을 디렉터리 목록으로.
 * fish 는 `$PATH` 가 리스트라 `echo "$PATH"` 가 공백으로 이어 붙인다 — 구분자로 자른 한 덩어리에 공백이 있으면 공백으로 한 번 더 자른다(통째로 버리는 것보다 낫다).
 */
export function splitPathValue(value: string, platform: NodeJS.Platform): string[] {
  const delim = pathDelimiterFor(platform);
  const parts = value.split(delim).map((p) => p.trim()).filter((p) => p.length > 0);
  if (platform !== 'win32' && parts.length === 1 && (parts[0] ?? '').includes(' ')) {
    return (parts[0] ?? '').split(/\s+/).filter((p) => p.length > 0);
  }
  return parts;
}

/** **알려진 설치 위치** — PATH 가 비었거나 잘려도 훑는 자리. "깔면 여기 놓인다"가 널리 정해진 것만 넣는다(없는 폴더는 stat 한 번이라 놓치는 쪽이 훨씬 비싸다). */
export function knownBinDirs(ctx: Pick<BinLocatorContext, 'platform' | 'env' | 'home'>): string[] {
  const p = pathFor(ctx.platform);
  const home = ctx.home;
  if (ctx.platform === 'win32') {
    const localAppData = ctx.env['LOCALAPPDATA'] ?? p.join(home, 'AppData', 'Local');
    const appData = ctx.env['APPDATA'] ?? p.join(home, 'AppData', 'Roaming');
    return [
      // winget 이 만드는 링크 폴더 — 갓 설치한 직후에는 PATH 갱신이 셸 재시작을 기다린다.
      p.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      p.join(appData, 'npm'),                     // npm 전역(.cmd shim)
      p.join(home, '.local', 'bin'),
      p.join(home, 'go', 'bin'),
      p.join(home, '.cargo', 'bin'),
      p.join(home, '.dotnet', 'tools'),
      p.join(localAppData, 'Programs'),
    ];
  }
  if (ctx.platform === 'darwin') {
    return [
      '/opt/homebrew/bin',                        // Apple Silicon Homebrew ← launchd PATH 에 없다
      '/opt/homebrew/sbin',
      '/usr/local/bin',                           // Intel Homebrew / 수동 설치
      '/usr/local/sbin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      '/opt/local/bin',                           // MacPorts
      p.join(home, '.local', 'bin'),
      p.join(home, 'go', 'bin'),
      p.join(home, '.cargo', 'bin'),
      p.join(home, '.dotnet', 'tools'),
    ];
  }
  return [
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    '/snap/bin',                                  // snap 패키지
    '/var/lib/flatpak/exports/bin',               // flatpak (시스템)
    p.join(home, '.local', 'bin'),
    p.join(home, 'go', 'bin'),
    p.join(home, '.cargo', 'bin'),
    p.join(home, '.dotnet', 'tools'),
  ];
}

/** 순서를 지키며 중복만 걷어 낸다(win/mac 은 대소문자 무시). */
function dedupeDirs(dirs: string[], platform: NodeJS.Platform): string[] {
  const foldCase = platform === 'win32' || platform === 'darwin';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs) {
    if (!d) continue;
    const key = foldCase ? d.toLowerCase() : d;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * 보강된 탐색 경로 — **현재 PATH → 로그인 셸 PATH → 알려진 설치 위치** 순.
 * 현재 PATH 가 맨 앞이다 — 사용자가 PATH 로 앞세운 버전을 존중한다(보강은 뒤에 더할 뿐 밀어내지 않는다).
 */
export function augmentedPathDirs(ctx: BinLocatorContext): string[] {
  const fromEnv = splitPathValue(readPathValue(ctx.env), ctx.platform);
  const fromLogin = ctx.loginShellPath ? splitPathValue(ctx.loginShellPath, ctx.platform) : [];
  return dedupeDirs([...fromEnv, ...fromLogin, ...knownBinDirs(ctx)], ctx.platform);
}

/** 보강된 PATH 문자열. */
export function augmentedPathValue(ctx: BinLocatorContext): string {
  return augmentedPathDirs(ctx).join(pathDelimiterFor(ctx.platform));
}

/** Windows 에서 확장자 없이 부른 이름에 붙여 볼 확장자들. */
function pathExtensions(ctx: Pick<BinLocatorContext, 'platform' | 'env'>): string[] {
  if (ctx.platform !== 'win32') return [''];
  const raw = ctx.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD';
  const exts = raw.split(';').map((e) => e.trim()).filter((e) => e.length > 0);
  // 확장자를 **먼저** 본다. Git for Windows 가 깔아 두는 확장자 없는 셸 스크립트(`…/usr/bin/vim`,
  //   `…/bin/code`)를 먼저 집으면 CreateProcess 가 못 띄운다 — cmd.exe 의 해석 순서와 맞춘다.
  return [...exts.map((e) => e.toLowerCase()), ...exts, ''];
}

/** `name` 이 그 플랫폼에서 가질 수 있는 파일 이름들(Windows 는 PATHEXT 를 붙인 변형 포함). */
export function binFileNames(name: string, ctx: Pick<BinLocatorContext, 'platform' | 'env'>): string[] {
  if (ctx.platform !== 'win32') return [name];
  const hasExt = /\.[a-z0-9]+$/i.test(name);
  if (hasExt) return [name];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ext of pathExtensions(ctx)) {
    const candidate = `${name}${ext}`;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

/**
 * 주입된 환경에서 실행 파일 하나를 찾는다 — **절대경로**, 못 찾으면 null.
 * @param extraCandidates 알려진 **파일 경로**(디렉터리 아님). PATH·알려진 폴더에서 못 찾았을 때 마지막으로 본다 — mac `.app` 번들 안 CLI 런처(`/Applications/…/Contents/Resources/app/bin/code`)처럼 어떤 PATH 에도 없는 자리.
 */
export function resolveBinaryIn(
  name: string,
  ctx: BinLocatorContext,
  extraCandidates: readonly string[] = [],
): string | null {
  const p = pathFor(ctx.platform);
  const trimmed = name.trim();
  if (!trimmed) return null;

  // 경로가 든 이름(`./x`, `/usr/bin/x`, `C:\x\y.exe`)은 PATH 를 훑지 않고 그 자리만 본다.
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    for (const candidate of binFileNames(trimmed, ctx)) {
      if (ctx.isExecutableFile(candidate)) return candidate;
    }
    return null;
  }

  const names = binFileNames(trimmed, ctx);
  for (const dir of augmentedPathDirs(ctx)) {
    for (const fileName of names) {
      const candidate = p.join(dir, fileName);
      if (ctx.isExecutableFile(candidate)) return candidate;
    }
  }
  for (const candidate of extraCandidates) {
    if (candidate && ctx.isExecutableFile(candidate)) return candidate;
  }
  return null;
}

/** 자식 프로세스에 물려줄 env — PATH 만 보강한다(나머지는 그대로). */
export function augmentedEnvIn(ctx: BinLocatorContext, base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const source = base ?? ctx.env;
  const out: NodeJS.ProcessEnv = {};
  // Windows 는 `Path`/`PATH` 가 섞여 들어온다 — 케이스 변형을 먼저 걷어 내고 하나만 남긴다
  //   (두 벌이 남으면 어느 쪽이 먹히는지 플랫폼·런타임마다 달라 재현이 안 되는 버그가 된다).
  for (const [k, v] of Object.entries(source)) {
    if (k.toLowerCase() === 'path') continue;
    out[k] = v;
  }
  out['PATH'] = augmentedPathValue({ ...ctx, env: source });
  return out;
}

// ─── 런타임 래퍼 (실제 프로세스 · 실제 파일시스템) ────────────────────────────────

/**
 * 존재 + (POSIX) 실행권한. `claudeBin.isUsableBin` 과 같은 판정 + Windows 앱 실행 별칭 보정.
 * **앱 실행 별칭 보정을 지우지 말 것** — `%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` 는 재분석 지점이라 `statSync` 가 `EACCES`, `existsSync` 가 `false` 다(2026-08-26 실측).
 * `where.exe`·`CreateProcess`(= `spawn`)는 정상 실행하므로, 보정이 없으면 PATH 의 winget 을 우리만 못 찾아 ffmpeg 설치 대행이 통째로 죽는다.
 */
export function isExecutableFileSync(candidate: string): boolean {
  try {
    const st = fs.statSync(candidate);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  } catch {
    if (process.platform !== 'win32') return false;
    try {
      // lstat 은 링크 자체를 본다 — 재분석 지점이 여기서만 보인다(대상은 못 따라간다).
      const link = fs.lstatSync(candidate);
      return link.isSymbolicLink() || link.isFile();
    } catch {
      return false;
    }
  }
}

/**
 * 로그인 셸 PATH 를 읽을 필요가 있는가. PATH 에 사용자 자리(`/opt/homebrew/bin`·`/usr/local/bin`·`~/.local/bin`)가 있으면 셸에서 떴거나 프로필이 탄 것이라 필요 없다.
 * 셋 다 없으면 `launchd` 최소 PATH(= Finder/Dock 실행)일 확률이 높다.
 */
export function needsLoginShellPath(ctx: Pick<BinLocatorContext, 'platform' | 'env' | 'home'>): boolean {
  if (ctx.platform !== 'darwin' && ctx.platform !== 'linux') return false;
  const dirs = new Set(splitPathValue(readPathValue(ctx.env), ctx.platform));
  const hints = ['/opt/homebrew/bin', '/usr/local/bin', path.posix.join(ctx.home, '.local', 'bin')];
  return !hints.some((h) => dirs.has(h));
}

/** 로그인 셸 출력에서 PATH 만 뽑는다(배너·MOTD 가 섞여 와도 우리 표식 줄만 본다). */
export function parseLoginShellOutput(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const at = line.indexOf(LOGIN_PATH_MARKER);
    if (at < 0) continue;
    const value = line.slice(at + LOGIN_PATH_MARKER.length).trim();
    if (value.length > 0) return value;
  }
  return null;
}

/** `undefined` = 아직 안 읽음, `null` = 읽었는데 없음/실패. 프로세스 수명 동안 1회. */
let cachedLoginShellPath: string | null | undefined;

/**
 * 사용자 로그인 셸의 PATH — **많아야 한 번** 읽는다.
 * `-l` 이 필요하다 — Homebrew 의 `eval "$(brew shellenv)"` 는 관례상 `~/.zprofile`·`~/.bash_profile` 에 있고, 그 파일은 로그인 셸일 때만 읽힌다.
 */
export function loginShellPath(): string | null {
  if (cachedLoginShellPath !== undefined) return cachedLoginShellPath;
  cachedLoginShellPath = null;
  const ctx = { platform: process.platform, env: process.env, home: os.homedir() };
  if (!needsLoginShellPath(ctx)) return cachedLoginShellPath;
  const shell = process.env['SHELL'];
  if (!shell || !shell.startsWith('/')) return cachedLoginShellPath;
  try {
    const out = execFileSync(shell, ['-l', '-c', `echo "${LOGIN_PATH_MARKER}$PATH"`], {
      encoding: 'utf8',
      timeout: LOGIN_SHELL_PATH_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    cachedLoginShellPath = parseLoginShellOutput(out);
  } catch {
    // 셸이 없거나 프로필이 죽거나 오래 걸린다 — 보강을 못 했을 뿐, 알려진 위치 후보는 그대로 산다.
    cachedLoginShellPath = null;
  }
  return cachedLoginShellPath;
}

/** 지금 이 프로세스의 실제 탐색 환경. */
export function currentContext(): BinLocatorContext {
  return {
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    isExecutableFile: isExecutableFileSync,
    loginShellPath: loginShellPath(),
  };
}

/**
 * 이 컴퓨터에서 `name` 실행 파일의 절대경로 — 못 찾으면 null.
 * `which`/`where` 를 부르지 않는다 — 우리 프로세스의 PATH 만 봐서, PATH 가 잘린 바로 그 상황에서 똑같이 못 찾는다.
 */
export function resolveBinary(name: string, extraCandidates: readonly string[] = []): string | null {
  return resolveBinaryIn(name, currentContext(), extraCandidates);
}

/** 자식 프로세스에 물려줄, PATH 가 보강된 env. */
export function augmentedEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return augmentedEnvIn(currentContext(), base);
}

/** 보강된 PATH 문자열만 필요할 때. */
export function augmentedPath(): string {
  return augmentedPathValue(currentContext());
}

/** 캐시 폐기 — 테스트, 그리고 "방금 설치했다"를 아는 자리에서만. */
export function resetBinLocatorCache(): void {
  cachedLoginShellPath = undefined;
}
