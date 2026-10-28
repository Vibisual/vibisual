/**
 * §2.1 #3 · §5.1 #1-1 — 셸로 읽은 파일/폴더 경로 추출기(순수, 디스크 접근 없음). 화이트리스트 명령만 보고,
 * 바꾸는 낌새(리다이렉트·`tee`·`sed -i`)가 있으면 그 세그먼트를 버린다 — 바꾸는 플래그는 명령마다 다르다(`grep -i` 는 읽기, §5.1 #1-1 (E)).
 * 셸 껍데기(`bash -lc`·`pwsh -Command`)는 세그먼트 걷기가 벗기고(§5.1 #1-1 (B)) 껍데기 자신은 `MUTATING_COMMANDS` 로 버려진다.
 * shared 에 둬 서버·IDE 세션 지도가 같은 판정을 쓴다(§5.5 #17-50). 플랫폼은 인자다.
 */
// 경로 대소문자 정책 SSOT — 접을지는 넘겨받은 플랫폼이 정한다(linux 는 접지 않는다 · 디스크 접근 없음).
import { pathKey, type PlatformName } from './pathCase.js';
// 셸 토크나이저·세그먼트 걷기·경로 모양 판정은 **쓰기 축과 한 벌**이다(`bashCommandPaths.ts`).
// 두 벌이 되면 한쪽만 고쳐져 "읽기는 안 버리는데 쓰기는 버리는" 명령이 생긴다(§2.1 #3).
import {
  FALLBACK_PLATFORM,
  forEachShellSegment,
  shellCommandIndex,
  shellInPlaceEdit,
  joinShellPath,
  normalizeShellCommandName as normalizeCommandName,
  isUnusableShellArg as isUnusableArg,
  looksLikeShellPath as looksLikePath,
  toNativeDriveShellPath as toNativeDrivePath,
  type ShellDialect,
} from './bashCommandPaths.js';

/** 한 Bash 명령에서 뽑는 경로 상한 — `find`/`ls` 류 대량 경로가 버블을 폭증시키지 않게. */
export const BASH_READ_PATH_LIMIT = 4;

/** 읽기로 확실한 명령의 인자 해석 방식. */
type ArgShape =
  /** 모든 비-플래그 인자가 파일 (cat/head/tail/nl/wc/less/more) */
  | 'files'
  /** 첫 비-플래그 인자는 스크립트, 나머지가 파일 (sed) */
  | 'script-then-files'
  /** 첫 비-플래그 인자는 패턴, 나머지가 경로 (grep/rg) */
  | 'pattern-then-paths'
  /** 경로처럼 생긴 인자만 채택 (type/Get-Content — 셸 빌트인 오탐 차단) */
  | 'path-like-only'
  /** PowerShell `Select-String` — `-Path`/`-LiteralPath`(없으면 둘째 자리 인자)가 경로, 첫 자리는 패턴 */
  | 'select-string';

interface CmdSpec {
  shape: ArgShape;
  /** 뒤 토큰을 값으로 먹는 플래그 — 그 값을 파일로 오인하지 않게. 명령마다 다르다
   *  (`head -n 20` 의 `-n` 은 값을 먹지만 `sed -n` 의 `-n` 은 먹지 않는다). */
  valueFlags?: readonly string[];
  /** 이 플래그가 쓰이면 스크립트/패턴이 플래그로 공급된 것 — 첫 비-플래그 인자도 파일이다. */
  inlineScriptFlags?: readonly string[];
  /** 경로 인자가 **검색 범위**다(파일이면 그 파일, 폴더면 그 아래) — 폴더는 Grep 도구와 같은 길로 간다. */
  search?: boolean;
}

const LINE_COUNT_FLAGS = ['-n', '-c', '--lines', '--bytes'] as const;
const MATCHER_FLAGS = ['-e', '-f', '--regexp', '--file'] as const;
const RG_VALUE_FLAGS = [
  '-e', '-f', '-m', '-A', '-B', '-C', '-g', '-t', '-T', '-d', '--regexp', '--file',
  '--max-count', '--after-context', '--before-context', '--context', '--glob',
  '--type', '--type-not', '--color', '--colour', '--max-depth', '--threads',
] as const;

const READ_COMMANDS: Record<string, CmdSpec> = {
  cat: { shape: 'files' },
  nl: { shape: 'files' },
  less: { shape: 'files' },
  more: { shape: 'files' },
  wc: { shape: 'files' },
  head: { shape: 'files', valueFlags: LINE_COUNT_FLAGS },
  tail: { shape: 'files', valueFlags: LINE_COUNT_FLAGS },
  sed: { shape: 'script-then-files', valueFlags: MATCHER_FLAGS, inlineScriptFlags: MATCHER_FLAGS },
  grep: { shape: 'pattern-then-paths', valueFlags: RG_VALUE_FLAGS, inlineScriptFlags: MATCHER_FLAGS, search: true },
  egrep: { shape: 'pattern-then-paths', valueFlags: RG_VALUE_FLAGS, inlineScriptFlags: MATCHER_FLAGS, search: true },
  fgrep: { shape: 'pattern-then-paths', valueFlags: RG_VALUE_FLAGS, inlineScriptFlags: MATCHER_FLAGS, search: true },
  rg: { shape: 'pattern-then-paths', valueFlags: RG_VALUE_FLAGS, inlineScriptFlags: MATCHER_FLAGS, search: true },
  type: { shape: 'path-like-only' },
  'get-content': { shape: 'path-like-only' },
  gc: { shape: 'path-like-only' },
  'select-string': { shape: 'select-string', search: true },
  sls: { shape: 'select-string', search: true },
};

/** **바꾸는 플래그**는 명령마다 다르다 — `-i`·`-o` 를 모든 명령에 걸면 `grep -i`·`grep -o` 읽기까지 버려진다. */
const COMMAND_MUTATING: Readonly<Record<string, (args: readonly string[]) => boolean>> = {
  // GNU/BSD sed 제자리 수정 — `-i`·`-Ei`·`-i.bak`·`--in-place` (쓰기 축과 같은 판정).
  sed: (args) => shellInPlaceEdit('sed', args),
  // less 의 로그 파일 쓰기.
  less: (args) => args.some((t) => /^-[oO]/.test(t) || /^--(log-file|LOG-FILE)/.test(t)),
};

/** 세그먼트의 첫 명령이 이것이면 통째로 버린다 — 읽기 여부를 우리가 판정할 수 없는 것들(셸 껍데기는 걷기가 따로 벗긴다). */
const MUTATING_COMMANDS = new Set([
  'rm', 'mv', 'cp', 'tee', 'touch', 'mkdir', 'rmdir', 'chmod', 'chown', 'ln',
  'truncate', 'dd', 'install', 'patch', 'git', 'npm', 'pnpm', 'yarn', 'node',
  'python', 'python3', 'powershell', 'pwsh', 'cmd', 'bash', 'sh', 'zsh', 'awk',
]);

/** 해롭지 않은 리다이렉트 — `2>/dev/null` · `2>&1` · `> /dev/null`(띄어 씀) · PowerShell `$null`. */
const NULL_SINK = /^(\/dev\/null|nul|\$null)$/i;

/** 해롭지 않은 리다이렉트만 걷어낸다. 남은 리다이렉트는 쓰기 신호로 본다. */
function stripHarmlessRedirects(segment: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < segment.length; i++) {
    const tok = segment[i]!;
    if (/^(\d*|&|\*)>>?&\d$/.test(tok)) continue;
    const attached = tok.match(/^(\d*|&|\*)>>?(.+)$/);
    if (attached && NULL_SINK.test(attached[2]!)) continue;
    if (/^(\d*|&|\*)>>?$/.test(tok) && NULL_SINK.test(segment[i + 1] ?? '')) { i++; continue; }
    out.push(tok);
  }
  return out;
}

/** 세그먼트가 무언가를 바꾸는가 — 리다이렉트가 남았거나 그 명령의 "바꾸는 플래그"가 있으면 버린다. */
function isMutatingSegment(segment: readonly string[], name: string): boolean {
  if (segment.some((tok) => /^(\d*|&|\*)>/.test(tok))) return true;
  return COMMAND_MUTATING[name]?.(segment.slice(1)) ?? false;
}

/** 셸에서 읽은 대상 한 칸. `search` 면 검색 범위(파일 또는 폴더)다. */
export interface BashReadTarget {
  path: string;
  search: boolean;
}

/** PowerShell `Select-String` 의 경로 — `-Path`/`-LiteralPath`, 없으면 패턴 다음 자리. 쉼표로 여럿. */
function selectStringPaths(args: readonly string[]): string[] {
  const VALUE = new Set(['pattern', 'path', 'literalpath', 'lp', 'include', 'exclude', 'encoding', 'context', 'culture', 'inputobject']);
  const named = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    const m = t.match(/^-([A-Za-z][\w-]*)(?::(.*))?$/);
    if (m) {
      const key = m[1]!.toLowerCase();
      if (m[2] !== undefined) { named.set(key, m[2]); continue; }
      if (VALUE.has(key) && args[i + 1] !== undefined) { named.set(key, args[i + 1]!); i++; }
      continue;
    }
    positional.push(t);
  }
  const raw = named.get('path') ?? named.get('literalpath') ?? named.get('lp')
    ?? positional[named.has('pattern') ? 0 : 1];
  return raw ? raw.split(',').map((v) => v.trim()).filter(Boolean) : [];
}

/** 한 세그먼트(명령이 맨 앞)에서 읽은 대상들을 뽑는다. 읽기 명령이 아니면 빈 배열. */
function targetsFromSegment(segment: readonly string[], name: string): BashReadTarget[] {
  const spec = READ_COMMANDS[name];
  if (!spec) return [];
  const search = spec.search === true;
  const args = segment.slice(1);

  if (spec.shape === 'select-string') {
    return selectStringPaths(args).filter((c) => !isUnusableArg(c)).map((path) => ({ path, search }));
  }

  const valueFlags = new Set<string>(spec.valueFlags ?? []);
  const inlineScriptFlags = new Set<string>(spec.inlineScriptFlags ?? []);
  const positional: string[] = [];
  let endOfFlags = false;
  let scriptSuppliedByFlag = false;

  for (let i = 0; i < args.length; i++) {
    const tok = args[i]!;
    if (!endOfFlags && tok === '--') { endOfFlags = true; continue; }
    if (!endOfFlags && tok.startsWith('-') && tok.length > 1) {
      if (inlineScriptFlags.has(tok)) scriptSuppliedByFlag = true;
      // `-n5` / `--lines=5` 처럼 값이 붙은 형태는 다음 토큰을 먹지 않는다.
      if (valueFlags.has(tok)) i++;
      continue;
    }
    positional.push(tok);
  }

  let candidates: string[];
  switch (spec.shape) {
    case 'files':
      candidates = positional;
      break;
    case 'script-then-files':
    case 'pattern-then-paths':
      // 첫 비-플래그 인자는 스크립트/패턴이라 파일이 아니다.
      // 단 `-e`/`-f` 로 이미 공급됐으면 첫 인자부터 파일이다.
      candidates = scriptSuppliedByFlag ? positional : positional.slice(1);
      break;
    case 'path-like-only':
      candidates = positional.filter(looksLikePath);
      break;
  }

  return candidates.filter((c) => !isUnusableArg(c)).map((path) => ({ path, search }));
}

/**
 * 읽은 파일/폴더 대상(§2.1 #3). 세그먼트(`&&` `||` `;` `|` `&` 개행)마다 판정하고 앞선 `cd` 는 이후 상대 경로의 기준이다.
 * 경로는 원문 그대로(정규화는 호출부 `normalize()`). `search` = grep/rg/Select-String 의 경로 인자(폴더면 Grep 도구 길).
 * @param opts.platform 중복 제거 키·`/c/...` 변환 기본값(생략 = `FALLBACK_PLATFORM`)
 * @param opts.windowsDrivePaths `/c/...` → `c:/...`(생략 = win32)
 * @param opts.dialect PowerShell 도구면 `'powershell'`
 */
export function extractBashReadTargets(
  command: string,
  limit: number = BASH_READ_PATH_LIMIT,
  opts?: { platform?: PlatformName; windowsDrivePaths?: boolean; dialect?: ShellDialect },
): BashReadTarget[] {
  if (!command || typeof command !== 'string' || limit <= 0) return [];
  const platform = opts?.platform ?? FALLBACK_PLATFORM;
  const toNative = (opts?.windowsDrivePaths ?? platform === 'win32')
    ? toNativeDrivePath
    : (p: string): string => p;

  const seen = new Set<string>();
  const out: BashReadTarget[] = [];

  forEachShellSegment(command, (rawSegment, ctx) => {
    const at = shellCommandIndex(rawSegment);
    if (at < 0) return false;
    const name = normalizeCommandName(rawSegment[at]!);
    if (MUTATING_COMMANDS.has(name)) return false;
    const segment = stripHarmlessRedirects(rawSegment.slice(at));
    if (isMutatingSegment(segment, name)) return false;

    for (const t of targetsFromSegment(segment, name)) {
      const resolved = toNative(joinShellPath(ctx.base, t.path));
      // 중복 제거 키 — linux 에서 접으면 `src/Foo.ts` 와 `src/foo.ts` 중 하나가 조용히 사라진다.
      const key = pathKey(resolved, platform);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: resolved, search: t.search });
      if (out.length >= limit) return true;
    }
    return false;
  }, opts?.dialect ? { dialect: opts.dialect } : undefined);

  return out;
}

/**
 * `extractBashReadTargets` 의 경로만(같은 `opts`). 상한 기본 `BASH_READ_PATH_LIMIT`.
 * @returns 중복 제거된 경로 — `cd` base 가 잡혔으면 상대 경로에 붙인다.
 */
export function extractBashReadPaths(
  command: string,
  limit: number = BASH_READ_PATH_LIMIT,
  opts?: { platform?: PlatformName; windowsDrivePaths?: boolean; dialect?: ShellDialect },
): string[] {
  return extractBashReadTargets(command, limit, opts).map((t) => t.path);
}
