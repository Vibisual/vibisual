/**
 * bashCommandPaths.ts — §2.1 #3 · Bash 명령에서 경로를 뽑는 **공용 셸 파서**.
 *
 * 여기 사는 것은 두 가지다.
 *  1. **셸 토크나이저·세그먼트 분해** — 읽기(`services/bashReadPaths.ts`)와 쓰기(아래)가 **한 벌을
 *     나눠 쓴다.** 두 벌이 되면 한쪽만 고쳐져 어긋난다(읽기는 안 버리는데 쓰기는 버리는 명령이 생긴다).
 *  2. **쓰기 경로 추출기** — `>` 리다이렉트·heredoc·`tee`·`sed -i`·`cp`/`mv` 목적지·`touch`.
 *
 * 읽기 추출기가 서버에 사는데 이쪽이 shared 인 이유: **감사 원장(§5.22)의 `target` 이 같은 답을
 * 봐야 한다.** 종전 Bash 줄은 명령만 있고 "어느 파일인지"가 비어 있었는데, 그 칸을 채우는
 * `summarizeToolCall` 은 shared 순수 함수라 서버 모듈을 부를 수 없다.
 *
 * 판정 원칙은 읽기와 같다 — **모르는 것을 쓰기로 넘겨짚지 않는다.** 화이트리스트 밖은 버린다.
 * 쓰기 오탐의 대가는 읽기보다 크다(가짜 diff·워크트리 이주까지 번진다).
 *
 * 순수 함수 모듈(디스크 접근 ❌ · `process.platform` 읽기 ❌ — 플랫폼은 **인자로 받는다**)이라
 * 개발기 한 대에서 세 OS 를 전부 단위 테스트할 수 있다(멀티플랫폼 1축).
 */
import { pathKey, type PlatformName } from './pathCase.js';

/** 한 Bash 명령에서 뽑는 **쓰기** 경로 상한 — 읽기(`BASH_READ_PATH_LIMIT`)와 같은 이유로 4. */
export const BASH_WRITE_PATH_LIMIT = 4;

/**
 * 플랫폼을 모를 때 쓰는 값 — **접는 쪽**이다(`pathCase.ts` 규약: 모르면 안전하게 접는다).
 * 서버는 `HOST_PLATFORM` 을 실어 보내므로 이 기본값은 브라우저·감사 표시 경로에서만 쓰인다.
 */
const FALLBACK_PLATFORM: PlatformName = 'win32';

// ─────────────────────────────────────────────────────────────────────────────
// 토크나이저 — 읽기·쓰기 공용
// ─────────────────────────────────────────────────────────────────────────────

/** 세그먼트를 가르는 연산자. 자체 토큰으로 남는다. */
export const SHELL_SEGMENT_SEPARATORS: ReadonlySet<string> = new Set(['&&', '||', ';', '|']);

/**
 * 따옴표를 존중하며 토큰으로 자른다. 연산자(`&&` `||` `;` `|` 개행)는 자체 토큰으로 남긴다.
 *
 * `>` 는 **자르지 않는다** — 리다이렉트는 `>out.txt` 처럼 붙어 오기도 하고 `> out.txt` 처럼
 * 떨어져 오기도 해서, 쓰기 추출기가 두 모양을 같이 본다.
 */
export function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  const push = (): void => {
    if (hasContent) tokens.push(cur);
    cur = '';
    hasContent = false;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (quote) {
      if (ch === quote) quote = null;
      else { cur += ch; hasContent = true; }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; hasContent = true; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { push(); continue; }
    if (ch === '\n' || ch === ';') { push(); tokens.push(';'); continue; }
    if (ch === '&' && command[i + 1] === '&') { push(); tokens.push('&&'); i++; continue; }
    if (ch === '|' && command[i + 1] === '|') { push(); tokens.push('||'); i++; continue; }
    if (ch === '|') { push(); tokens.push('|'); continue; }
    cur += ch;
    hasContent = true;
  }
  push();
  return tokens;
}

/** 토큰 목록을 세그먼트(`&&` `||` `;` `|` 개행 기준)로 자른다. 빈 세그먼트는 버린다. */
export function splitShellSegments(tokens: readonly string[]): string[][] {
  const segments: string[][] = [];
  let cur: string[] = [];
  for (const tok of tokens) {
    if (SHELL_SEGMENT_SEPARATORS.has(tok)) { segments.push(cur); cur = []; continue; }
    cur.push(tok);
  }
  segments.push(cur);
  return segments.filter((s) => s.length > 0);
}

/** `/usr/bin/cat` · `cat.exe` → `cat` */
export function normalizeShellCommandName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? raw;
  return base.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}

/** 파일로 볼 수 없는 인자 — stdin·널 장치·변수·글롭·숫자. */
export function isUnusableShellArg(arg: string): boolean {
  if (!arg || arg === '-') return true;
  if (arg.startsWith('$')) return true;
  if (/[*?]/.test(arg)) return true;
  if (/^\d+$/.test(arg)) return true;
  const lower = arg.toLowerCase();
  return lower === 'nul' || lower.startsWith('/dev/');
}

/** 경로처럼 생겼는가 — 구분자가 있거나 확장자가 붙어 있으면 경로로 본다. */
export function looksLikeShellPath(arg: string): boolean {
  return /[\\/]/.test(arg) || /\.[A-Za-z0-9]{1,8}$/.test(arg);
}

/** Windows 드라이브(`C:/`, `C:\`) 또는 POSIX 루트. */
export function isAbsoluteShellPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/');
}

/** git bash 가 쓰는 MSYS 드라이브 경로(`/c/work/...`)를 네이티브(`c:/work/...`)로.
 *  이 변환을 안 하면 같은 파일이 프로젝트 밖 `(ext) /c/work/...` 고아 버블로 새로 박힌다. */
export function toNativeDriveShellPath(p: string): string {
  const m = p.match(/^\/([A-Za-z])\/(.*)$/);
  return m ? `${m[1]}:/${m[2]}` : p;
}

/** `cd <dir>` 세그먼트면 그 경로를, 아니면 null. */
export function readShellCdTarget(segment: readonly string[]): string | null {
  if (segment.length < 2) return null;
  if (normalizeShellCommandName(segment[0]!) !== 'cd') return null;
  const target = segment.slice(1).find((t) => !t.startsWith('-'));
  return target && !isUnusableShellArg(target) ? target : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 쓰기 경로 추출
// ─────────────────────────────────────────────────────────────────────────────

/** `FOO=1 cmd …` 처럼 명령 앞에 붙는 환경변수 대입. 명령 이름을 찾을 때 건너뛴다. */
const ENV_ASSIGN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** `>out.txt` · `2>>log` · `>` · `2>&1` — 앞머리에서만 매칭한다(따옴표 안의 `a > b` 오탐 차단). */
const REDIRECT_PATTERN = /^(\d*)(>>?)(.*)$/;

/** heredoc 시작(`<<EOF` · `<<-EOF`). 토크나이저가 따옴표를 벗기므로 `<<'EOF'` 도 이 모양으로 온다. */
const HEREDOC_PATTERN = /^<<-?(.+)$/;

/** 인자를 파일 목록으로 읽는 쓰기 명령(플래그는 건너뛴다). */
const WRITE_FILE_ARG_COMMANDS: ReadonlySet<string> = new Set(['tee', 'touch']);

/**
 * 첫 비-플래그 인자가 스크립트고 나머지가 파일 — **`-i` 가 있을 때만** 쓰기다.
 * (`sed -n '1,20p' f` 는 읽기라 읽기 추출기 몫이다.)
 */
const IN_PLACE_SCRIPT_COMMANDS: ReadonlySet<string> = new Set(['sed', 'perl']);

/** 마지막 인자가 **목적지**인 명령. 원본(앞 인자)은 읽기라 여기서 세지 않는다. */
const DESTINATION_LAST_COMMANDS: ReadonlySet<string> = new Set(['cp', 'mv', 'install']);

/** 값이 뒤 토큰으로 오는 플래그 — 그 값을 파일로 오인하지 않게. */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-e', '-f', '--expression', '--file', '-m', '--mode', '-t', '--target-directory',
]);

/** 세그먼트에서 명령 이름을 읽는다(앞머리 환경변수 대입은 건너뛴다). */
function segmentCommandName(segment: readonly string[]): string {
  for (const tok of segment) {
    if (ENV_ASSIGN_PATTERN.test(tok)) continue;
    return normalizeShellCommandName(tok);
  }
  return '';
}

/** 그 세그먼트의 비-플래그 인자들(명령 이름·플래그·플래그 값·리다이렉트 제외). */
function positionalArgs(segment: readonly string[]): string[] {
  const out: string[] = [];
  let seenCommand = false;
  let endOfFlags = false;
  for (let i = 0; i < segment.length; i++) {
    const tok = segment[i]!;
    if (!seenCommand) {
      if (ENV_ASSIGN_PATTERN.test(tok)) continue;
      seenCommand = true;
      continue;
    }
    if (REDIRECT_PATTERN.test(tok) || HEREDOC_PATTERN.test(tok) || tok.startsWith('<')) {
      // 리다이렉트 대상은 아래 `redirectTargets` 가 따로 본다 — 값이 떨어져 오면 그 토큰도 건너뛴다.
      if (/^\d*>>?$/.test(tok)) i++;
      continue;
    }
    if (!endOfFlags && tok === '--') { endOfFlags = true; continue; }
    if (!endOfFlags && tok.startsWith('-') && tok.length > 1) {
      if (VALUE_FLAGS.has(tok)) i++;
      continue;
    }
    out.push(tok);
  }
  return out;
}

/** 세그먼트의 리다이렉트 대상들(`>f` · `>> f` · `2>err`). `>&1` 류와 널 장치는 뺀다. */
function redirectTargets(segment: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < segment.length; i++) {
    const tok = segment[i]!;
    const m = tok.match(REDIRECT_PATTERN);
    if (!m) continue;
    let target = m[3] ?? '';
    if (target.startsWith('&')) continue; // `2>&1` — 파일이 아니라 다른 fd 다.
    if (!target) {
      const next = segment[i + 1];
      if (!next || SHELL_SEGMENT_SEPARATORS.has(next)) continue;
      target = next;
      i++;
    }
    if (target.startsWith('|')) target = target.slice(1); // `>|f` (noclobber 무시)
    if (!target || isUnusableShellArg(target)) continue;
    out.push(target);
  }
  return out;
}

/** 이 세그먼트가 명령으로 **고치는** 파일들(리다이렉트 제외 — 그쪽은 따로 본다). */
function commandWriteTargets(segment: readonly string[]): string[] {
  const name = segmentCommandName(segment);
  if (!name) return [];

  if (WRITE_FILE_ARG_COMMANDS.has(name)) return positionalArgs(segment);

  if (IN_PLACE_SCRIPT_COMMANDS.has(name)) {
    // `-i` 가 없으면 읽기다(읽기 추출기 몫). `-i.bak` 처럼 접미사가 붙어도 제자리 수정이다.
    const inPlace = segment.some((t) => t === '-i' || /^-i\S*$/.test(t) || t.startsWith('--in-place'));
    if (!inPlace) return [];
    const args = positionalArgs(segment);
    // `-e`/`-f` 로 스크립트가 공급됐으면 첫 인자부터 파일이다.
    const scriptByFlag = segment.some((t) => VALUE_FLAGS.has(t));
    return scriptByFlag ? args : args.slice(1);
  }

  if (DESTINATION_LAST_COMMANDS.has(name)) {
    const args = positionalArgs(segment);
    // `-t <dir>` 형태(목적지가 플래그 값)는 목적지가 폴더라 파일 라우팅이 걸러 낸다 — 마지막 인자만 본다.
    if (args.length < 2) return [];
    return [args[args.length - 1]!];
  }

  return [];
}

/**
 * Bash 명령 문자열에서 **고친 파일 경로**를 뽑는다(§2.1 #3 쓰기 축).
 *
 * - 세그먼트(`&&` `||` `;` `|` 개행)로 잘라 각각 판정한다.
 * - **heredoc 본문은 건너뛴다** — 본문 줄이 그대로 명령처럼 파싱되면 남의 글이 우리 판정이 된다.
 * - 선행 `cd <dir>` 는 이후 세그먼트의 기준 경로로 반영된다(상대 경로 해석용).
 * - 반환 경로는 **원문 그대로**(정규화·소문자화 ❌) — 호출부가 기존 `normalize()` 한 곳에서 처리한다.
 *
 * @param command Bash `tool_input.command`
 * @param limit 상한 (기본 `BASH_WRITE_PATH_LIMIT`)
 * @param opts `platform` 은 중복 제거 키의 대소문자 규칙 + `/c/...` 변환 여부를 정한다.
 * @returns 중복 제거된 경로 목록. `cd` 로 base 가 잡혔으면 상대 경로에 그 base 를 붙여 돌려준다.
 */
export function extractBashWritePaths(
  command: string,
  limit: number = BASH_WRITE_PATH_LIMIT,
  opts?: { platform?: PlatformName },
): string[] {
  if (!command || typeof command !== 'string' || limit <= 0) return [];
  const platform = opts?.platform ?? FALLBACK_PLATFORM;
  const toNative = platform === 'win32' ? toNativeDriveShellPath : (p: string): string => p;

  const segments = splitShellSegments(tokenizeShellCommand(command));

  const seen = new Set<string>();
  const out: string[] = [];
  let base: string | null = null;
  /** heredoc 본문을 먹는 중이면 그 종료 표식. */
  let heredocDelimiter: string | null = null;

  for (const segment of segments) {
    if (heredocDelimiter !== null) {
      // 종료 표식만 홀로 선 세그먼트를 만나야 본문이 끝난다.
      if (segment.length === 1 && segment[0] === heredocDelimiter) heredocDelimiter = null;
      continue;
    }

    const cdTarget = readShellCdTarget(segment);
    if (cdTarget) { base = cdTarget.replace(/[\\/]+$/, ''); continue; }

    const candidates = [...redirectTargets(segment), ...commandWriteTargets(segment)];

    // 이 세그먼트가 heredoc 을 열었으면 **경로를 챙긴 뒤** 본문 건너뛰기를 켠다
    // (`cat > f <<'EOF'` 의 `f` 는 이 세그먼트에 있다).
    for (const tok of segment) {
      const h = tok.match(HEREDOC_PATTERN);
      if (h?.[1]) { heredocDelimiter = h[1]; break; }
    }

    for (const raw of candidates) {
      if (isUnusableShellArg(raw)) continue;
      if (raw.startsWith('-')) continue;
      const joined = isAbsoluteShellPath(raw) || !base ? raw : `${base}/${raw}`;
      const resolved = toNative(joined);
      // 중복 제거 키 — linux 에서 접으면 `src/Foo.ts` 와 `src/foo.ts` 중 하나가 조용히 사라진다.
      const key = pathKey(resolved, platform);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(resolved);
      if (out.length >= limit) return out;
    }
  }

  return out;
}
