/**
 * §2.1 #3 — Bash 로 읽은 파일도 버블로 뜨게 하기 위한 경로 추출기.
 *
 * 파일/폴더 버블은 원래 `FILE_PATH_KEYS` 다섯 도구(Read/Write/Edit/Grep/Glob)의 경로 인자에서만
 * 생겼다. 그런데 실사용에서 에이전트는 `sed -n '1,140p' <파일>` · `cat` · `rg <패턴> <경로>` 처럼
 * **Bash 로 읽는 일이 그만큼 잦고**, 그 읽기는 캔버스에 한 획도 남지 않았다.
 *
 * 이 모듈은 Bash 명령 문자열에서 **읽기로 확실한 접근만** 뽑는다. 판정 원칙 둘:
 *  1. **모르는 것을 읽기로 넘겨짚지 않는다** — 화이트리스트에 있는 명령만 본다.
 *  2. **바꾸는 낌새가 하나라도 있으면 그 세그먼트를 통째로 버린다** — 리다이렉트·`tee`·`sed -i` 등.
 *
 * 순수 함수 모듈(디스크 접근 ❌)이라 단위 테스트로 고정한다.
 */
// 경로 대소문자 정책 SSOT — win32/darwin 만 접고 linux 는 접지 않는다(디스크 접근 없음).
import { pathKey } from './pathKey.js';
// 셸 토크나이저·경로 모양 판정은 **쓰기 축과 한 벌**이다(shared `bashCommandPaths.ts`).
// 두 벌이 되면 한쪽만 고쳐져 "읽기는 안 버리는데 쓰기는 버리는" 명령이 생긴다(§2.1 #3).
import {
  tokenizeShellCommand,
  splitShellSegments,
  stripHeredocBodies,
  normalizeShellCommandName as normalizeCommandName,
  readShellCdTarget as readCdTarget,
  isUnusableShellArg as isUnusableArg,
  looksLikeShellPath as looksLikePath,
  isAbsoluteShellPath as isAbsolutePath,
  toNativeDriveShellPath as toNativeDrivePath,
} from '@vibisual/shared';

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
  | 'path-like-only';

interface CmdSpec {
  shape: ArgShape;
  /** 뒤 토큰을 값으로 먹는 플래그 — 그 값을 파일로 오인하지 않게. 명령마다 다르다
   *  (`head -n 20` 의 `-n` 은 값을 먹지만 `sed -n` 의 `-n` 은 먹지 않는다). */
  valueFlags?: readonly string[];
  /** 이 플래그가 쓰이면 스크립트/패턴이 플래그로 공급된 것 — 첫 비-플래그 인자도 파일이다. */
  inlineScriptFlags?: readonly string[];
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
  grep: { shape: 'pattern-then-paths', valueFlags: RG_VALUE_FLAGS, inlineScriptFlags: MATCHER_FLAGS },
  egrep: { shape: 'pattern-then-paths', valueFlags: RG_VALUE_FLAGS, inlineScriptFlags: MATCHER_FLAGS },
  fgrep: { shape: 'pattern-then-paths', valueFlags: RG_VALUE_FLAGS, inlineScriptFlags: MATCHER_FLAGS },
  rg: { shape: 'pattern-then-paths', valueFlags: RG_VALUE_FLAGS, inlineScriptFlags: MATCHER_FLAGS },
  type: { shape: 'path-like-only' },
  'get-content': { shape: 'path-like-only' },
  gc: { shape: 'path-like-only' },
};

/** 이 플래그가 보이면 그 세그먼트는 읽기가 아니다(파일을 고치거나 다른 곳에 쓴다). */
const MUTATING_FLAGS = [/^-i$/, /^--in-place/, /^-o$/, /^--output/];

/** 세그먼트의 첫 명령이 이것이면 통째로 버린다 — 읽기 여부를 우리가 판정할 수 없는 것들. */
const MUTATING_COMMANDS = new Set([
  'rm', 'mv', 'cp', 'tee', 'touch', 'mkdir', 'rmdir', 'chmod', 'chown', 'ln',
  'truncate', 'dd', 'install', 'patch', 'git', 'npm', 'pnpm', 'yarn', 'node',
  'python', 'python3', 'powershell', 'pwsh', 'cmd', 'bash', 'sh', 'zsh', 'awk',
]);


/** `2>/dev/null` · `2>&1` 처럼 무해한 리다이렉트만 걷어낸다. 남은 `>` 는 쓰기 신호로 본다. */
function stripHarmlessRedirects(segment: readonly string[]): string[] {
  const out: string[] = [];
  for (const tok of segment) {
    if (/^\d?>>?&\d$/.test(tok)) continue;
    if (/^\d?>>?(\/dev\/null|nul)$/i.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

/** 세그먼트가 무언가를 바꾸는가 — 하나라도 걸리면 그 세그먼트는 통째로 버린다. */
function isMutatingSegment(segment: readonly string[]): boolean {
  return segment.some(
    (tok) => tok.includes('>') || MUTATING_FLAGS.some((re) => re.test(tok)),
  );
}

/** 한 세그먼트에서 읽은 파일 경로들을 뽑는다. 읽기 명령이 아니면 빈 배열. */
function pathsFromSegment(segment: readonly string[]): string[] {
  if (segment.length === 0) return [];
  const spec = READ_COMMANDS[normalizeCommandName(segment[0]!)];
  if (!spec) return [];

  const valueFlags = new Set<string>(spec.valueFlags ?? []);
  const inlineScriptFlags = new Set<string>(spec.inlineScriptFlags ?? []);
  const args = segment.slice(1);
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

  return candidates.filter((c) => !isUnusableArg(c));
}

/**
 * Bash 명령 문자열에서 **읽은 파일/폴더 경로**를 뽑는다.
 *
 * - 세그먼트(`&&` `||` `;` `|` 개행)로 잘라 각각 판정한다.
 * - 선행 `cd <dir>` 는 이후 세그먼트의 기준 경로로 반영된다(상대 경로 해석용).
 * - 반환 경로는 **원문 그대로**(정규화·소문자화 ❌) — 호출부가 기존 `normalize()` 한 곳에서 처리한다.
 *
 * @param command Bash `tool_input.command`
 * @param limit 상한 (기본 `BASH_READ_PATH_LIMIT`)
 * @param opts `windowsDrivePaths` 를 켜면 git bash 의 `/c/...` 를 `c:/...` 로 바꾼다(기본 = win32).
 * @returns 중복 제거된 경로 목록. `cd` 로 base 가 잡혔으면 상대 경로에 그 base 를 붙여 돌려준다.
 */
export function extractBashReadPaths(
  command: string,
  limit: number = BASH_READ_PATH_LIMIT,
  opts?: { windowsDrivePaths?: boolean },
): string[] {
  if (!command || typeof command !== 'string' || limit <= 0) return [];
  const toNative = (opts?.windowsDrivePaths ?? process.platform === 'win32')
    ? toNativeDrivePath
    : (p: string): string => p;

  // heredoc **본문**은 셸이 명령으로 실행하지 않는 글이다. 종전에는 본문 줄도 그대로 세그먼트가
  //   되어, 문서 안에 예시로 적힌 `sed -n '1,5p' secrets/key.pem` 한 줄이 "그 파일을 읽었다"는
  //   버블·화살표를 세웠다. 쓰기 축은 이 판정을 갖고 있었고 읽기 축만 없어서 생긴 어긋남이라,
  //   판정을 shared 로 올려 **두 축이 같은 함수를 쓴다**(§2.1 #3 — 토크나이저는 한 벌).
  const segments = stripHeredocBodies(splitShellSegments(tokenizeShellCommand(command)));

  const seen = new Set<string>();
  const out: string[] = [];
  let base: string | null = null;

  for (const rawSegment of segments) {
    if (rawSegment.length === 0) continue;

    const cdTarget = readCdTarget(rawSegment);
    if (cdTarget) { base = cdTarget.replace(/[\\/]+$/, ''); continue; }

    if (MUTATING_COMMANDS.has(normalizeCommandName(rawSegment[0]!))) continue;

    const segment = stripHarmlessRedirects(rawSegment);
    if (isMutatingSegment(segment)) continue;

    for (const p of pathsFromSegment(segment)) {
      const joined = isAbsolutePath(p) || !base ? p : `${base}/${p}`;
      const resolved = toNative(joined);
      // 중복 제거 키 — linux 에서 접으면 `src/Foo.ts` 와 `src/foo.ts` 중 하나가 조용히 사라진다.
      const key = pathKey(resolved);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(resolved);
      if (out.length >= limit) return out;
    }
  }

  return out;
}
