/**
 * bashCommandPaths.ts — §2.1 #3 · §5.1 #1-1 · 셸 명령에서 경로를 뽑는 **공용 셸 파서**.
 *
 * 여기 사는 것은 세 가지다.
 *  1. **셸 토크나이저·세그먼트 걷기** — 읽기(`services/bashReadPaths.ts`)·쓰기(아래)·훑기 자리·경로 자물쇠·검증
 *     정책이 **한 벌을 나눠 쓴다.** 두 벌이 되면 한쪽만 고쳐져 어긋난다(읽기는 안 버리는데 쓰기는 버리는 명령이 생긴다).
 *  2. **셸 껍데기 벗기기**(§5.1 #1-1 (B)) — `bash -lc '…'`·`pwsh -Command '…'`·`cmd /c …` 안의 스크립트를 같은 규칙으로
 *     다시 본다. 코덱스는 셸 명령을 **늘** 이 모양으로 낸다(Windows `"…pwsh.exe" -Command '…'`, POSIX `bash -lc '…'`).
 *     Codex 자신도 같은 일을 한다(`parse_command` — 껍데기를 벗겨 읽기·검색을 판정한다).
 *  3. **쓰기 경로 추출기** — `>` 리다이렉트·heredoc·`tee`·`sed -i`·`cp`/`mv` 목적지·`touch`·PowerShell 쓰기 cmdlet 등.
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
 * 읽기 추출기(`bashReadPaths.ts`)도 같은 값을 쓴다 — 읽기·쓰기가 모를 때 다르게 접으면 한 명령이 둘로 갈린다.
 */
export const FALLBACK_PLATFORM: PlatformName = 'win32';

// ─────────────────────────────────────────────────────────────────────────────
// §5.1 #1-1 (A) — 셸 도구
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 셸 명령을 `tool_input.command` 로 받는 Claude Code 도구.
 *
 * 공식 문서(Tools reference · PowerShell tool): Windows 에서는 `PowerShell` 이 기본으로 켜지고 **주 셸**이 되며,
 * "셸 명령을 보는 훅은 `Bash|PowerShell` 을 함께 잡으라 — `Bash` 만으로는 부족하다"고 적혀 있다. 종전 그래프는 `Bash`
 * 하나만 봐서 PowerShell 로 내린 명령은 감사 원장에만 남고 버블·이력·보험 사본이 0 이었다(2026-10-22 실측).
 * 코덱스·로컬 모델의 셸 명령은 방출기가 `Bash` 로 싣는다.
 */
export const SHELL_TOOL_NAMES: readonly string[] = ['Bash', 'PowerShell'];

/** 이 도구 이름이 셸 명령 도구인가 — 그래프·스윕·보험·화면이 같은 판정을 본다. */
export function isShellToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && SHELL_TOOL_NAMES.includes(name);
}

/** 명령 글의 말씨 — 따옴표·주석·구분자·here-string 규칙이 다르다. */
export type ShellDialect = 'posix' | 'powershell' | 'cmd';

/** 그 도구가 받는 명령의 말씨. 모르는 이름은 POSIX(종전 그대로). */
export function shellDialectOfTool(name: string | null | undefined): ShellDialect {
  return name === 'PowerShell' ? 'powershell' : 'posix';
}

// ─────────────────────────────────────────────────────────────────────────────
// 토크나이저 — 읽기·쓰기 공용
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 세그먼트를 가르는 연산자. 자체 토큰으로 남는다.
 *
 * 단독 `&` 도 가른다(§5.1 #1-1 (E)) — bash 의 뒤로 돌리기(`npm run dev & cat log.txt`), cmd 의 명령 구분,
 * PowerShell 의 호출 연산자(`& "C:\x.exe" args` — 다음 낱말이 실행 대상) 모두 앞뒤가 다른 명령이다. 종전에는
 * 앞 명령의 인자로 붙어 뒤의 읽기가 통째로 사라졌다(검증 정책만 따로 `&`→`;` 로 바꿔 보고 있었다).
 */
export const SHELL_SEGMENT_SEPARATORS: ReadonlySet<string> = new Set(['&&', '||', ';', '|', '&']);

/**
 * 따옴표를 존중하며 토큰으로 자른다. 연산자(`&&` `||` `;` `|` `&` 개행)는 자체 토큰으로 남긴다.
 *
 * `>` 는 **리다이렉트 토큰의 머리**로 남긴다 — `>out.txt` 처럼 붙어 오기도 하고 `> out.txt` 처럼 떨어져 오기도
 * 해서, 쓰기 추출기가 두 모양을 같이 본다. 낱말 **중간**의 `>` 는 거기서 끊는다(`echo hi>out.txt` = `echo hi` +
 * `>out.txt` — 셸이 그렇게 읽는다). 앞이 숫자뿐(`2>err`)·`&`(`&>`)·`*`(PowerShell `*>`)이면 fd 표기라 붙여 둔다.
 *
 * 낱말이 시작되는 자리의 `#` 부터 줄 끝까지는 주석이다(POSIX·PowerShell — cmd 에는 없다). 주석 속 경로를
 * 명령으로 읽지 않는다.
 *
 * @param dialect PowerShell 은 작은따옴표 안의 `''`(따옴표 글자) · here-string(`@'…'@`) · 블록 주석(`<#…#>`)을 안다.
 *   cmd 는 작은따옴표가 글자이고 `;` 가 구분자가 아니다. 기본은 POSIX(종전 그대로).
 */
export function tokenizeShellCommand(command: string, dialect: ShellDialect = 'posix'): string[] {
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
    const next = command[i + 1];

    if (quote) {
      if (ch === quote) {
        // PowerShell 작은따옴표 안의 `''` 는 따옴표 글자 하나다(`'it''s'` → `it's`).
        if (dialect === 'powershell' && quote === "'" && next === "'") { cur += "'"; i++; continue; }
        quote = null;
      } else { cur += ch; hasContent = true; }
      continue;
    }
    // PowerShell here-string — 본문은 실행되지 않는 글이다(통째로 한 토큰). 닫는 표식은 줄 맨 앞의 `'@`/`"@`.
    if (dialect === 'powershell' && ch === '@' && (next === "'" || next === '"') && /[\r\n]/.test(command[i + 2] ?? '')) {
      const terminator = `\n${next}@`;
      const end = command.indexOf(terminator, i + 2);
      if (end < 0) { cur += command.slice(i); hasContent = true; break; }
      cur += command.slice(i, end + terminator.length);
      hasContent = true;
      i = end + terminator.length - 1;
      continue;
    }
    // PowerShell 블록 주석 `<# … #>`.
    if (dialect === 'powershell' && ch === '<' && next === '#') {
      const end = command.indexOf('#>', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    // 줄 잇기 — POSIX `\`·PowerShell 백틱·cmd `^` 바로 뒤의 줄바꿈은 같은 명령이다(긴 명령을 여러 줄로 쓴 꼴).
    //   종전에는 그 줄바꿈이 구분자가 되어 `cp a \` ↵ `b` 가 두 명령으로 갈렸다.
    const escapeChar = dialect === 'powershell' ? '`' : dialect === 'cmd' ? '^' : '\\';
    if (ch === escapeChar && (next === '\n' || (next === '\r' && command[i + 2] === '\n'))) {
      i += next === '\r' ? 2 : 1;
      continue;
    }
    // 이스케이프한 공백(`Application\ Support` — macOS·Linux 에서 흔하다)은 낱말 안의 공백이다.
    //   다른 백슬래시는 글자 그대로 둔다(Windows 경로 `C:\work\a.ts` 를 지키려는 종전 규약).
    if (ch === escapeChar && (next === ' ' || next === '\t')) {
      cur += next;
      hasContent = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (dialect === 'cmd' && ch === "'") { cur += ch; hasContent = true; continue; }
      quote = ch;
      hasContent = true;
      continue;
    }
    // 낱말 머리의 `#` — 줄 끝까지 주석(개행은 남겨 구분자가 되게 한다).
    if (ch === '#' && !hasContent && dialect !== 'cmd') {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { push(); continue; }
    if (ch === '\n' || (ch === ';' && dialect !== 'cmd')) { push(); tokens.push(';'); continue; }
    if (ch === '&') {
      if (next === '&') { push(); tokens.push('&&'); i++; continue; }
      // `2>&1`·`>&2`·`<&3` — 다른 fd 를 가리키는 리다이렉트다(구분자 ❌).
      if (/^(\d*|\*)>>?$/.test(cur) || /^\d*<$/.test(cur)) { cur += ch; hasContent = true; continue; }
      // `&>file`·`&>>file` — 표준 출력·오류를 함께 보내는 리다이렉트(bash).
      if (next === '>') { push(); cur = '&'; hasContent = true; continue; }
      push();
      tokens.push('&');
      continue;
    }
    // `>|` 는 파이프가 아니라 **noclobber 무시 리다이렉트**다(`set -o noclobber` 아래의 덮어쓰기).
    //   여기서 끊으면 `>` 만 남아 대상이 사라지고(쓴 파일 기록 0건) 그 파일 이름은 다음 세그먼트의
    //   **명령**으로 둔갑한다 — `redirectTargets` 의 `target.startsWith('|')` 갈래가 영영 안 돌던
    //   이유가 이것이다(그 갈래는 이 토큰이 통째로 와야 성립한다).
    if (ch === '|' && /^(\d*|&|\*)>>?$/.test(cur)) { cur += ch; hasContent = true; continue; }
    if (ch === '|' && next === '|') { push(); tokens.push('||'); i++; continue; }
    if (ch === '|') { push(); tokens.push('|'); continue; }
    // 낱말 중간의 `>` 는 리다이렉트의 시작이다. fd 표기(숫자뿐·`&`·`*`)와 `>>` 의 둘째 `>` 는 붙여 둔다.
    if (ch === '>' && hasContent && !/^(\d+|&|\*)$/.test(cur) && !cur.endsWith('>')) push();
    cur += ch;
    hasContent = true;
  }
  push();
  return tokens;
}

/** 토큰 목록을 세그먼트(`&&` `||` `;` `|` `&` 개행 기준)로 자른다. 빈 세그먼트는 버린다. */
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

/** heredoc 시작(`<<EOF` · `<<-EOF`). 토크나이저가 따옴표를 벗기므로 `<<'EOF'` 도 이 모양으로 온다. */
const HEREDOC_PATTERN = /^<<-?(.+)$/;

/**
 * 이 세그먼트가 heredoc 을 열었으면 그 **종료 표식**을, 아니면 `null`.
 *
 * 두 모양을 다 본다. `<<EOF` 는 한 토큰이고, `<< EOF` 는 토크나이저가 공백에서 끊어 구분자가
 * **다음 토큰**으로 온다. 떨어져 온 모양을 먼저 보는 것이 중요하다 — `<<-` 는 `HEREDOC_PATTERN`
 * 에도 걸리는데 그때 구분자를 `-` 로 잘못 읽어, 오지 않는 표식을 기다리며 명령 끝까지 삼킨다.
 */
export function readHeredocDelimiter(segment: readonly string[]): string | null {
  for (let i = 0; i < segment.length; i++) {
    const tok = segment[i]!;
    if (tok === '<<' || tok === '<<-') {
      const next = segment[i + 1];
      if (next && !SHELL_SEGMENT_SEPARATORS.has(next)) return next;
      continue;
    }
    const h = tok.match(HEREDOC_PATTERN);
    if (h?.[1]) return h[1];
  }
  return null;
}

/**
 * heredoc **본문** 세그먼트를 걷어 낸다 — 읽기·쓰기가 같은 답을 보게 하는 한 곳.
 *
 * 본문은 셸이 명령으로 실행하지 않는 **글**이다. 그것을 세그먼트로 파싱하면 남의 글이 우리 판정이
 * 된다: `cat > doc.md <<'EOF'` 안에 예시로 적힌 `sed -n '1,5p' secrets/key.pem` 한 줄이
 * "에이전트가 그 파일을 읽었다"는 화살표를 세운다(실측 — 쓰기 축은 막고 있었고 읽기 축은 뚫려
 * 있었다. 토크나이저를 한 벌로 나눠 쓰면서 이 판정만 한쪽에 있었던 것이 원인이다).
 *
 * **여는 세그먼트는 남긴다** — `cat > f <<'EOF'` 의 `f` 는 거기 있고 그것은 진짜 쓰기다.
 * 종료 표식만 홀로 선 세그먼트에서 본문이 끝난다(표식을 못 만나면 명령 끝까지가 본문이다).
 */
export function stripHeredocBodies(segments: readonly (readonly string[])[]): string[][] {
  const out: string[][] = [];
  let delimiter: string | null = null;
  for (const segment of segments) {
    if (delimiter !== null) {
      if (segment.length === 1 && segment[0] === delimiter) delimiter = null;
      continue;
    }
    out.push([...segment]);
    delimiter = readHeredocDelimiter(segment);
  }
  return out;
}

/** `/usr/bin/cat` · `cat.exe` → `cat` */
export function normalizeShellCommandName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? raw;
  return base.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}

/** 파일로 볼 수 없는 인자 — stdin·널 장치·변수(PowerShell `$null` 포함)·글롭·숫자. */
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

/** 폴더를 옮기는 명령 — bash `cd`·`pushd` · cmd `chdir` · PowerShell `Set-Location`(`sl`)·`Push-Location`. */
const CD_COMMANDS: ReadonlySet<string> = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location']);

/** `cd <dir>`(그리고 위 이웃들) 세그먼트면 그 경로를, 아니면 null. */
export function readShellCdTarget(segment: readonly string[]): string | null {
  if (segment.length < 2) return null;
  if (!CD_COMMANDS.has(normalizeShellCommandName(segment[0]!))) return null;
  for (let i = 1; i < segment.length; i++) {
    // PowerShell `-Path`·`-LiteralPath` — 값이 뒤에 온다.
    if (/^-(path|literalpath|lp)$/i.test(segment[i]!)) {
      const v = segment[i + 1];
      return v && !isUnusableShellArg(v) ? v : null;
    }
  }
  // cmd `cd /d C:\work` 의 `/d` 는 드라이브까지 바꾸라는 스위치다.
  const target = segment.slice(1).find((t) => !t.startsWith('-') && !/^\/d$/i.test(t));
  return target && !isUnusableShellArg(target) ? target : null;
}

/** `.`·`..` 조각을 접는다(디스크 ❌ — 글자만). 상대 경로가 위로 넘어가면 `..` 를 남긴다. */
function collapseDotSegments(p: string): string {
  const unified = p.replace(/\\/g, '/');
  const root = unified.match(/^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+\/?|\/)/)?.[0] ?? '';
  const out: string[] = [];
  for (const part of unified.slice(root.length).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!root) out.push('..');
      continue;
    }
    out.push(part);
  }
  const body = out.join('/');
  if (!root) return body || '.';
  return root.endsWith('/') ? `${root}${body}` : `${root}/${body}`;
}

/**
 * 기준 폴더에 경로를 잇는다 — 절대경로이거나 기준이 없으면 **원문 그대로**(종전 규약: 정규화·소문자화 ❌, 호출부의
 * `normalize()` 한 곳에서 처리). 이었으면 `.`·`..` 를 글자로 접는다(그대로 두면 노드 열쇠에 `..` 가 남는다).
 */
export function joinShellPath(base: string | null, raw: string): string {
  if (isAbsoluteShellPath(raw) || !base) return raw;
  const joined = `${base.replace(/[\\/]+$/, '')}/${raw}`;
  return /(^|[\\/])\.\.?([\\/]|$)/.test(joined) ? collapseDotSegments(joined) : joined;
}

/** `cd` 대상을 지금 기준에 잇는다 — `cd a && cd b` 는 `a/b` 다(종전엔 뒤의 `b` 만 남았다). */
function joinCdBase(base: string | null, target: string): string {
  const t = target.replace(/[\\/]+$/, '') || target;
  return joinShellPath(base, t);
}

/** PowerShell `-EncodedCommand`(base64 UTF-16LE) 를 푼다. 풀지 못하면 null. 검증 정책·껍데기 벗기기 공용. */
export function decodePowerShellEncodedCommand(value: string): string | null {
  try {
    if (typeof atob !== 'function') return null;
    const bin = atob(value.trim());
    let out = '';
    for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8));
    return out;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5.1 #1-1 (B) — 셸 껍데기 벗기기 · 세그먼트 걷기
// ─────────────────────────────────────────────────────────────────────────────

/** 껍데기 안으로 들어가는 깊이 상한 — 앱 감지(`commandApps.ts`)와 같은 4. */
export const SHELL_WRAPPER_DEPTH_MAX = 4;

/** `-c` 로 스크립트를 받는 POSIX 셸. */
const POSIX_SHELL_NAMES: ReadonlySet<string> = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash', 'fish', 'git-bash']);
/** PowerShell 실행본(Windows PowerShell 5.1 · PowerShell 7). */
const POWERSHELL_NAMES: ReadonlySet<string> = new Set(['powershell', 'pwsh']);

/** 명령 앞에 붙어 진짜 실행 대상을 미루는 것들 — 그 뒤의 낱말이 명령이다. */
const COMMAND_LAUNCHERS: ReadonlySet<string> = new Set(['env', 'command', 'exec', 'nohup', 'time', 'sudo']);
/** 런처가 값을 뒤에 받는 플래그(`sudo -u user …`). */
const LAUNCHER_VALUE_FLAGS: ReadonlySet<string> = new Set(['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t']);

/** `FOO=1 cmd …` 처럼 명령 앞에 붙는 환경변수 대입. 명령 이름을 찾을 때 건너뛴다. */
const ENV_ASSIGN_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * 세그먼트에서 **실행되는 명령**의 자리 — 앞머리 환경변수 대입과 런처(`env`·`sudo`·`nohup` …)는 건너뛴다.
 * 명령이 없으면 -1.
 */
export function shellCommandIndex(segment: readonly string[]): number {
  let i = 0;
  while (i < segment.length) {
    const tok = segment[i]!;
    if (ENV_ASSIGN_PATTERN.test(tok)) { i++; continue; }
    if (COMMAND_LAUNCHERS.has(normalizeShellCommandName(tok))) {
      i++;
      while (i < segment.length && (segment[i]!.startsWith('-') || ENV_ASSIGN_PATTERN.test(segment[i]!))) {
        if (LAUNCHER_VALUE_FLAGS.has(segment[i]!)) i++;
        i++;
      }
      continue;
    }
    return i;
  }
  return -1;
}

/** 껍데기 한 겹 — 안의 스크립트와 그 말씨, 그리고 껍데기가 정한 시작 폴더(pwsh `-WorkingDirectory`). */
export interface ShellInvocation {
  script: string;
  dialect: ShellDialect;
  cwd?: string;
}

/** 여러 토큰으로 갈라 온 스크립트를 다시 한 줄로 — 공백이 든 토큰은 따옴표로 지켜 준다. */
function rejoinScript(parts: readonly string[], dialect: ShellDialect): string {
  if (parts.length === 1) return parts[0]!;
  return parts.map((p) => (/\s/.test(p) ? (dialect === 'cmd' ? `"${p}"` : `'${p.replace(/'/g, "''")}'`) : p)).join(' ');
}

/**
 * 이 세그먼트가 셸 껍데기(`bash -lc '…'` · `pwsh -Command '…'`·`-EncodedCommand` · `cmd /c …`)면 그 안을, 아니면 null.
 *
 * 스크립트 **파일**을 돌리는 꼴(`bash build.sh` · `pwsh -File x.ps1`)은 안을 볼 수 없어 null 이다(넘겨짚지 않는다).
 * POSIX `-c` 뒤의 남은 인자는 `$0`·`$1` 이지 코드가 아니다.
 */
export function readShellInvocation(segment: readonly string[]): ShellInvocation | null {
  const at = shellCommandIndex(segment);
  if (at < 0) return null;
  const name = normalizeShellCommandName(segment[at]!);
  const args = segment.slice(at + 1);

  if (POSIX_SHELL_NAMES.has(name)) {
    const flag = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
    const script = flag >= 0 ? args[flag + 1] : undefined;
    return script ? { script, dialect: 'posix' } : null;
  }

  if (POWERSHELL_NAMES.has(name)) {
    let cwd: string | undefined;
    for (let k = 0; k < args.length; k++) {
      const a = args[k]!;
      if (/^-(?:wd|workingdirectory)$/i.test(a)) {
        if (args[k + 1]) cwd = args[k + 1];
        k++;
        continue;
      }
      if (/^-(?:e|ec|en|enc|encodedcommand)$/i.test(a)) {
        const decoded = args[k + 1] ? decodePowerShellEncodedCommand(args[k + 1]!) : null;
        return decoded ? { script: decoded, dialect: 'powershell', ...(cwd ? { cwd } : {}) } : null;
      }
      if (/^-(?:c|co|com|comm|comma|comman|command)$/i.test(a)) {
        const rest = args.slice(k + 1);
        return rest.length > 0 ? { script: rejoinScript(rest, 'powershell'), dialect: 'powershell', ...(cwd ? { cwd } : {}) } : null;
      }
      if (/^-(?:f|file)$/i.test(a)) return null;
      // 값을 뒤에 받는 실행 옵션 — 그 값을 스크립트로 오인하지 않게.
      if (/^-(?:ex|ep|executionpolicy|w|windowstyle|of|outputformat|if|inputformat|config|configurationname|v|version|settingsfile|custompipename)$/i.test(a)) {
        k++;
        continue;
      }
    }
    return null;
  }

  if (name === 'cmd') {
    const flag = args.findIndex((a) => /^\/[ck]$/i.test(a));
    const rest = flag >= 0 ? args.slice(flag + 1) : [];
    return rest.length > 0 ? { script: rejoinScript(rest, 'cmd'), dialect: 'cmd' } : null;
  }

  return null;
}

/** 걷기 중 한 세그먼트의 사정. */
export interface ShellSegmentContext {
  /** 이 세그먼트가 도는 기준 폴더(앞의 `cd`·껍데기 시작 폴더를 이은 것, 원문 그대로). 없으면 null = 실행 cwd. */
  base: string | null;
  /** 이 세그먼트의 말씨. */
  dialect: ShellDialect;
  /** 껍데기 깊이(0 = 바깥). */
  depth: number;
  /** 이 세그먼트가 셸 껍데기라 안쪽을 따로 걷는다 — 바깥 토큰에는 스크립트 글 전체가 한 낱말로 들어 있다. */
  wrapper: boolean;
}

/**
 * 셸 명령을 세그먼트 단위로 걷는다 — 읽기·쓰기·훑기 자리가 **같은 걷기**를 쓴다(§2.1 #3 · §5.1 #1-1).
 *
 * - 세그먼트(`&&` `||` `;` `|` `&` 개행)로 자르고 heredoc 본문은 걷어 낸다(셸이 실행하지 않는 글이다).
 * - `cd`·`Set-Location` 은 이후 세그먼트의 기준 폴더가 된다(이어 붙인다). 그 세그먼트는 방문하지 않는다.
 * - 셸 껍데기는 바깥 세그먼트를 방문한 뒤(바깥의 `> out.txt` 같은 리다이렉트를 위해) **안쪽 스크립트를 같은 규칙으로**
 *   걷는다. 안쪽의 `cd` 는 바깥으로 새지 않는다(서브셸).
 *
 * @param visit `true` 를 돌려주면 걷기를 멈춘다(상한을 채웠을 때).
 * @param opts.onCd `cd` 를 만날 때마다 이은 기준 폴더로 불린다(훑기 자리가 기준 폴더도 자리로 삼는다). `true` 면 멈춘다.
 */
export function forEachShellSegment(
  command: string,
  visit: (segment: readonly string[], ctx: ShellSegmentContext) => boolean | void,
  opts?: { dialect?: ShellDialect; base?: string | null; maxDepth?: number; onCd?: (base: string) => boolean | void },
): void {
  if (!command || typeof command !== 'string') return;
  const maxDepth = opts?.maxDepth ?? SHELL_WRAPPER_DEPTH_MAX;
  const walk = (text: string, dialect: ShellDialect, base0: string | null, depth: number): boolean => {
    const segments = stripHeredocBodies(splitShellSegments(tokenizeShellCommand(text, dialect)));
    let base = base0;
    for (const segment of segments) {
      const cdTarget = readShellCdTarget(segment);
      if (cdTarget) {
        base = joinCdBase(base, cdTarget);
        if (opts?.onCd?.(base) === true) return true;
        continue;
      }
      const invocation = depth < maxDepth ? readShellInvocation(segment) : null;
      if (visit(segment, { base, dialect, depth, wrapper: invocation !== null }) === true) return true;
      if (invocation) {
        const innerBase = invocation.cwd ? joinCdBase(base, invocation.cwd) : base;
        if (walk(invocation.script, invocation.dialect, innerBase, depth + 1)) return true;
      }
    }
    return false;
  };
  walk(command, opts?.dialect ?? 'posix', opts?.base ?? null, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 쓰기 경로 추출
// ─────────────────────────────────────────────────────────────────────────────

/** `>out.txt` · `2>>log` · `&>all.log` · `*>all.log`(PowerShell) · `>` · `2>&1` — 앞머리에서만 매칭한다(따옴표 안의 `a > b` 오탐 차단). */
const REDIRECT_PATTERN = /^(\d*|&|\*)(>>?)(.*)$/;
/** 값이 뒤 토큰으로 떨어져 오는 리다이렉트 연산자 그 자체. */
const BARE_REDIRECT_PATTERN = /^(\d*|&|\*)>>?\|?$/;

/** 인자를 파일 목록으로 읽는 쓰기 명령(플래그는 건너뛴다). */
const WRITE_FILE_ARG_COMMANDS: ReadonlySet<string> = new Set(['tee', 'touch']);

/**
 * 첫 비-플래그 인자가 스크립트고 나머지가 파일 — **제자리 수정 플래그가 있을 때만** 쓰기다.
 * (`sed -n '1,20p' f` 는 읽기라 읽기 추출기 몫이다.)
 */
const IN_PLACE_SCRIPT_COMMANDS: ReadonlySet<string> = new Set(['sed', 'perl']);

/** 마지막 인자가 **목적지**인 명령. 원본(앞 인자)은 읽기라 여기서 세지 않는다. */
const DESTINATION_LAST_COMMANDS: ReadonlySet<string> = new Set(['cp', 'mv', 'install']);

/** 값이 뒤 토큰으로 오는 플래그 — 그 값을 파일로 오인하지 않게. */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-e', '-f', '--expression', '--file', '-m', '--mode', '-t', '--target-directory',
]);

/** 묶음(`-Ei`) 안에서 값을 뒤에 받는 옵션 — 그 글자부터 뒤는 그 옵션의 값이다. */
const IN_PLACE_VALUE_LETTERS: Readonly<Record<string, ReadonlySet<string>>> = {
  // GNU sed: -e 스크립트 · -f 스크립트 파일 · -l 줄 길이.
  sed: new Set(['e', 'f', 'l']),
  // perlrun: -e/-E 코드 · -M/-m 모듈 · -I 경로 · -x 폴더 · -C/-d/-D 값.
  perl: new Set(['e', 'E', 'M', 'm', 'I', 'x', 'C', 'd', 'D']),
};

/**
 * `sed`·`perl` 이 **제자리 수정**으로 불렸는가(§5.1 #1-1 (E)).
 *
 * GNU sed: `-i` 는 접미사를 선택으로 받으므로 묶음의 **끝**에 와야 맨 `-i` 다 — `-Ei`·`-ni` 는 제자리 수정이고
 * `-iE` 는 접미사 `E` 를 단 제자리 수정이다(어느 쪽이든 파일을 고친다). perlrun: `-spi.bak` = `-s -p -i.bak`.
 * 종전에는 `-i`·`-i<접미사>` 꼴만 봐서 `sed -Ei`·`perl -pi` 가 통째로 빠졌다.
 */
export function shellInPlaceEdit(name: string, args: readonly string[]): boolean {
  const valueLetters = IN_PLACE_VALUE_LETTERS[name];
  if (!valueLetters) return false;
  for (const tok of args) {
    if (tok === '--in-place' || tok.startsWith('--in-place=')) return true;
    if (tok.startsWith('--') || !/^-[A-Za-z]/.test(tok)) continue;
    for (const c of tok.slice(1)) {
      if (c === 'i') return true;
      if (valueLetters.has(c)) break;
    }
  }
  return false;
}

/** 그 세그먼트의 비-플래그 인자들(명령 이름·플래그·플래그 값·리다이렉트 제외). */
function positionalArgs(segment: readonly string[]): string[] {
  const out: string[] = [];
  const start = shellCommandIndex(segment);
  if (start < 0) return out;
  let endOfFlags = false;
  for (let i = start + 1; i < segment.length; i++) {
    const tok = segment[i]!;
    if (REDIRECT_PATTERN.test(tok) || tok.startsWith('<')) {
      // 리다이렉트 대상은 아래 `redirectTargets` 가 따로 본다 — 값이 떨어져 오면 그 토큰도 건너뛴다.
      //   **출력(`>`)만 건너뛰던 것이 오탐의 원인이었다.** 입력 리다이렉트와 heredoc 도 값이 떨어져
      //   올 수 있는데 그 토큰이 그대로 남아, `tee out.txt < in.txt` 의 `in.txt`(읽기일 뿐이다)와
      //   `tee out.txt << EOF` 의 구분자 `EOF` 가 **고친 파일**로 기록됐다. 쓰기 오탐의 대가는
      //   읽기보다 크다(가짜 diff) — 그래서 값이 떨어져 오는 네 모양을 전부 건너뛴다.
      if (BARE_REDIRECT_PATTERN.test(tok) || tok === '<' || tok === '<<' || tok === '<<-') i++;
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

/** 세그먼트의 리다이렉트 대상들(`>f` · `>> f` · `2>err` · `&>f` · `*>f`). `>&1` 류와 널 장치는 뺀다. */
function redirectTargets(segment: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < segment.length; i++) {
    const tok = segment[i]!;
    const m = tok.match(REDIRECT_PATTERN);
    if (!m) continue;
    let target = m[3] ?? '';
    if (target.startsWith('&')) continue; // `2>&1` — 파일이 아니라 다른 fd 다.
    // `>|f` (noclobber 무시) — **비어 있는지 보기 전에** 벗긴다. 순서를 뒤집으면 `>| f` 처럼
    //   떨어져 온 모양에서 `target` 이 `'|'` 라 "비지 않았다"로 읽혀 다음 토큰을 안 가져오고,
    //   벗긴 뒤엔 빈 문자열이라 그대로 버려진다(그 쓰기가 통째로 사라진다).
    if (target.startsWith('|')) target = target.slice(1);
    if (!target) {
      const next = segment[i + 1];
      if (!next || SHELL_SEGMENT_SEPARATORS.has(next)) continue;
      target = next;
      i++;
    }
    if (isUnusableShellArg(target)) continue;
    out.push(target);
  }
  return out;
}

/** 경로 끝 이름(`a/b/c.ts` → `c.ts`). 끝 구분자는 무시한다. */
function shellBaseName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).pop() ?? trimmed;
}

/** 폴더 안 그 이름 — 목적지가 폴더일 때 옮겨진 파일의 자리. */
function intoFolder(dir: string, source: string): string | null {
  const name = shellBaseName(source);
  if (!name || isUnusableShellArg(name) || name === '.' || name === '..') return null;
  return `${dir.replace(/[\\/]+$/, '')}/${name}`;
}

/**
 * 쓰기 대상 한 칸. `intoName` 이 있으면 **목적지가 폴더일 때** 실제로 쓰인 파일은 `path/intoName` 이다
 * (`cp a.ts out` 의 `out` 이 이미 있는 폴더면 `out/a.ts`). 순수 모듈은 디스크를 보지 않으므로 그 판정은 디스크를 보는
 * 호출부(서버)가 그 시점에 한다 — 그래서 후보를 둘 내지 않고 한 칸에 담는다(상한 4칸을 잡동사니가 먹지 않게).
 */
export interface ShellWriteTarget {
  path: string;
  intoName?: string;
}

/** 목적지 + 원본들 → 쓰기 대상. 폴더가 확실하면(끝 구분자 · 원본이 여럿) 그 안의 이름으로, 하나면 판정을 미룬다. */
function destinationEntries(dest: string, sources: readonly string[], forceDir: boolean): ShellWriteTarget[] {
  if (forceDir || /[\\/]$/.test(dest) || sources.length > 1) {
    return sources.map((src) => intoFolder(dest, src)).filter((p): p is string => p !== null).map((path) => ({ path }));
  }
  const name = sources[0] !== undefined ? shellBaseName(sources[0]) : '';
  const usable = name && !isUnusableShellArg(name) && name !== '.' && name !== '..';
  return [usable ? { path: dest, intoName: name } : { path: dest }];
}

/**
 * `cp`/`mv`/`install` 의 목적지. GNU coreutils: 마지막 피연산자가 **있는 폴더**면 원본들이 그 안으로 간다.
 * `dir/` 처럼 끝이 구분자거나 원본이 여럿이면 폴더가 확실하다. `-t DIR` 은 목적지가 앞에 온다. `-T` 는 폴더로 보지 말라는 뜻이다.
 * 원본이 하나뿐이면 목적지가 파일인지 폴더인지 글자로는 모른다 — `intoName` 을 달아 호출부가 그 시점의 디스크로 고른다.
 */
function destinationTargets(segment: readonly string[], name: string): ShellWriteTarget[] {
  const start = shellCommandIndex(segment);
  const rest = segment.slice(start + 1);
  if (name === 'install' && rest.some((t) => t === '-d' || t === '--directory')) return [];
  let targetDir: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!;
    if (t === '-t' || t === '--target-directory') { targetDir = rest[i + 1]; break; }
    if (t.startsWith('--target-directory=')) { targetDir = t.slice('--target-directory='.length); break; }
  }
  const args = positionalArgs(segment);
  if (targetDir) return destinationEntries(targetDir, args, true);
  if (args.length < 2) return [];
  const dest = args[args.length - 1]!;
  if (rest.includes('-T') || rest.includes('--no-target-directory')) return [{ path: dest }];
  return destinationEntries(dest, args.slice(0, -1), false);
}

/** PowerShell 식 인자 — `-Name 값`·`-Name:값`(이름은 대소문자 무시). `valueParams` 에 없는 이름은 스위치다. */
function powerShellArgs(args: readonly string[], valueParams: ReadonlySet<string>): { named: Map<string, string>; positional: string[] } {
  const named = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    if (REDIRECT_PATTERN.test(t) || t.startsWith('<')) {
      if (BARE_REDIRECT_PATTERN.test(t) || t === '<') i++;
      continue;
    }
    const m = t.match(/^-([A-Za-z][\w-]*)(?::(.*))?$/);
    if (m) {
      const key = m[1]!.toLowerCase();
      if (m[2] !== undefined) { named.set(key, m[2]); continue; }
      if (valueParams.has(key)) {
        const v = args[i + 1];
        if (v !== undefined) { named.set(key, v); i++; }
        continue;
      }
      named.set(key, '');
      continue;
    }
    positional.push(t);
  }
  return { named, positional };
}

/** PowerShell 경로 값 — 쉼표로 여러 개를 줄 수 있다(`-Path a.txt,b.txt`). */
function powerShellPaths(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
}

/** 이름 있는 경로 칸 중 처음 것, 없으면 그 자리 인자. */
function powerShellPathArg(parsed: { named: Map<string, string>; positional: string[] }, names: readonly string[], position: number): string[] {
  for (const n of names) {
    const v = parsed.named.get(n);
    if (v) return powerShellPaths(v);
  }
  const p = parsed.positional[position];
  return p ? powerShellPaths(p) : [];
}

/** PowerShell 쓰기 cmdlet 의 값 칸(그 밖의 `-X` 는 스위치로 본다). */
const PS_PATH_PARAMS = ['path', 'literalpath', 'lp', 'pspath'] as const;
const PS_CONTENT_VALUE_PARAMS: ReadonlySet<string> = new Set([
  ...PS_PATH_PARAMS, 'value', 'encoding', 'filter', 'include', 'exclude', 'credential', 'stream', 'delimiter',
]);
const PS_OUT_FILE_VALUE_PARAMS: ReadonlySet<string> = new Set(['filepath', ...PS_PATH_PARAMS, 'encoding', 'width', 'inputobject']);
const PS_TEE_VALUE_PARAMS: ReadonlySet<string> = new Set(['filepath', ...PS_PATH_PARAMS, 'inputobject', 'variable', 'encoding']);
const PS_NEW_ITEM_VALUE_PARAMS: ReadonlySet<string> = new Set([...PS_PATH_PARAMS, 'name', 'itemtype', 'type', 'value', 'credential']);
const PS_COPY_MOVE_VALUE_PARAMS: ReadonlySet<string> = new Set([
  ...PS_PATH_PARAMS, 'destination', 'filter', 'include', 'exclude', 'credential', 'fromsession', 'tosession',
]);
const PS_WEB_VALUE_PARAMS: ReadonlySet<string> = new Set([
  'outfile', 'uri', 'method', 'body', 'headers', 'contenttype', 'useragent', 'infile', 'timeoutsec', 'proxy',
  'credential', 'sessionvariable', 'websession', 'token', 'authentication', 'form', 'maximumredirection', 'certificate',
]);

/** 경로 문자열 목록 → 쓰기 대상 칸. */
function plainTargets(paths: readonly string[]): ShellWriteTarget[] {
  return paths.map((path) => ({ path }));
}

/** PowerShell 쓰기 cmdlet(별칭 포함) — 이름 → 쓴 경로들. 공식 별칭: Set-Content `sc`(5.1), Add-Content `ac`, Copy-Item `cpi`·`copy`, Move-Item `mi`·`move`, New-Item `ni`, Invoke-WebRequest `iwr`. `sc` 는 PowerShell 7 에서 `sc.exe`(서비스 제어)라 넘겨짚지 않는다. */
function powerShellWriteTargets(name: string, args: readonly string[]): ShellWriteTarget[] | null {
  switch (name) {
    case 'set-content':
    case 'add-content':
    case 'ac':
      return plainTargets(powerShellPathArg(powerShellArgs(args, PS_CONTENT_VALUE_PARAMS), PS_PATH_PARAMS, 0));
    case 'out-file':
      return plainTargets(powerShellPathArg(powerShellArgs(args, PS_OUT_FILE_VALUE_PARAMS), ['filepath', ...PS_PATH_PARAMS], 0));
    case 'tee-object':
      return plainTargets(powerShellPathArg(powerShellArgs(args, PS_TEE_VALUE_PARAMS), ['filepath', ...PS_PATH_PARAMS], 0));
    case 'new-item':
    case 'ni': {
      const parsed = powerShellArgs(args, PS_NEW_ITEM_VALUE_PARAMS);
      const type = (parsed.named.get('itemtype') ?? parsed.named.get('type') ?? '').toLowerCase();
      // 폴더는 세지 않는다 — `mkdir` 과 같은 규칙(외부 폴더 ↔ 위성 ≥ 1 invariant).
      if (type.startsWith('dir')) return [];
      const fileName = parsed.named.get('name');
      const bases = powerShellPathArg(parsed, PS_PATH_PARAMS, 0);
      if (fileName) return plainTargets((bases.length > 0 ? bases : ['.']).map((b) => `${b.replace(/[\\/]+$/, '')}/${fileName}`));
      return plainTargets(bases);
    }
    case 'copy-item':
    case 'cpi':
    case 'copy':
    case 'move-item':
    case 'mi':
    case 'move': {
      const parsed = powerShellArgs(args, PS_COPY_MOVE_VALUE_PARAMS);
      const dest = parsed.named.get('destination') ?? parsed.positional[parsed.named.has('path') || parsed.named.has('literalpath') ? 0 : 1];
      if (!dest) return [];
      return destinationEntries(dest, powerShellPathArg(parsed, PS_PATH_PARAMS, 0), false);
    }
    case 'invoke-webrequest':
    case 'iwr':
    case 'invoke-restmethod':
    case 'irm': {
      const outFile = powerShellArgs(args, PS_WEB_VALUE_PARAMS).named.get('outfile');
      return outFile ? [{ path: outFile }] : [];
    }
    default:
      return null;
  }
}

/** `curl -o FILE`·`--output FILE`·`--output=FILE`·`-sSLo FILE` / `wget -O FILE`·`--output-document=FILE`. */
function downloadTargets(name: string, args: readonly string[]): string[] {
  const letter = name === 'curl' ? 'o' : 'O';
  const long = name === 'curl' ? '--output' : '--output-document';
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    if (t === long) { if (args[i + 1]) out.push(args[i + 1]!); i++; continue; }
    if (t.startsWith(`${long}=`)) { out.push(t.slice(long.length + 1)); continue; }
    if (t.startsWith('--') || !t.startsWith('-')) continue;
    // 짧은 묶음 — 끝 글자가 그 옵션이면 값은 다음 낱말, 머리면 붙은 값(`-oout.zip`).
    if (new RegExp(`^-[A-Za-z]*${letter}$`).test(t)) { if (args[i + 1]) out.push(args[i + 1]!); i++; continue; }
    const attached = t.match(new RegExp(`^-${letter}(.+)$`));
    if (attached?.[1]) out.push(attached[1]);
  }
  return out;
}

/**
 * `git checkout [..] -- 경로…` · `git restore [..] 경로…` — 작업 트리의 파일을 되돌린다(쓰기).
 * `git checkout <가지>` 처럼 `--` 없는 꼴은 바뀌는 파일을 알 수 없어 세지 않는다. `git restore --staged` 만이면 색인만
 * 바꾼다(작업 트리 ❌ — git 문서: 둘 다 없으면 작업 트리, `--staged` 는 색인만). `-C <폴더>` 는 그 폴더 기준이다.
 */
function gitWriteTargets(args: readonly string[]): string[] {
  let i = 0;
  let cdir: string | undefined;
  for (; i < args.length; i++) {
    const t = args[i]!;
    if (t === '-C') { cdir = args[i + 1]; i++; continue; }
    if (t === '-c') { i++; continue; }
    if (t.startsWith('-')) continue;
    break;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  let paths: string[] = [];
  if (sub === 'checkout') {
    const dd = rest.indexOf('--');
    if (dd < 0) return [];
    paths = rest.slice(dd + 1);
  } else if (sub === 'restore') {
    const staged = rest.includes('--staged') || rest.includes('-S');
    const worktree = rest.includes('--worktree') || rest.includes('-W');
    if (staged && !worktree) return [];
    const dd = rest.indexOf('--');
    if (dd >= 0) {
      paths = rest.slice(dd + 1);
    } else {
      for (let k = 0; k < rest.length; k++) {
        const t = rest[k]!;
        if (t === '-s' || t === '--source' || t === '--pathspec-from-file') { k++; continue; }
        if (t.startsWith('-')) continue;
        paths.push(t);
      }
    }
  } else {
    return [];
  }
  if (!cdir) return paths;
  return paths.map((p) => (isAbsoluteShellPath(p) ? p : `${cdir!.replace(/[\\/]+$/, '')}/${p}`));
}

/** 이 세그먼트가 명령으로 **고치는** 파일들(리다이렉트 제외 — 그쪽은 따로 본다). */
function commandWriteTargets(segment: readonly string[]): ShellWriteTarget[] {
  const at = shellCommandIndex(segment);
  if (at < 0) return [];
  const name = normalizeShellCommandName(segment[at]!);
  const args = segment.slice(at + 1);
  if (!name) return [];

  if (WRITE_FILE_ARG_COMMANDS.has(name)) return plainTargets(positionalArgs(segment));

  if (IN_PLACE_SCRIPT_COMMANDS.has(name)) {
    // 제자리 수정 플래그가 없으면 읽기다(읽기 추출기 몫).
    if (!shellInPlaceEdit(name, args)) return [];
    let scanned: readonly string[] = segment;
    if (name === 'sed') {
      // BSD sed(macOS 기본)는 `-i` 뒤 낱말을 백업 접미사로 받는다 — `-i ''`·`-i .bak`. 스크립트가 아니므로 뺀다.
      //   GNU 꼴(`-i 's/a/b/'`)은 접미사 모양이 아니라 그대로 둔다 — 어느 OS 에서든 같은 판정이다.
      const flag = segment.findIndex((t, k) => k > at && t === '-i');
      const suffix = flag >= 0 ? segment[flag + 1] : undefined;
      if (suffix !== undefined && (suffix === '' || /^\.[\w.~-]*$/.test(suffix))) {
        scanned = [...segment.slice(0, flag + 1), ...segment.slice(flag + 2)];
      }
    }
    const positional = positionalArgs(scanned);
    // `-e`/`-f` 로 스크립트가 공급됐으면 첫 인자부터 파일이다.
    const scriptByFlag = args.some((t) => VALUE_FLAGS.has(t));
    return plainTargets(scriptByFlag ? positional : positional.slice(1));
  }

  if (DESTINATION_LAST_COMMANDS.has(name)) return destinationTargets(segment, name);

  if (name === 'curl' || name === 'wget') return plainTargets(downloadTargets(name, args));

  if (name === 'git') return plainTargets(gitWriteTargets(args));

  return powerShellWriteTargets(name, args) ?? [];
}

/**
 * Bash 명령 문자열에서 **고친 파일 경로**를 뽑는다(§2.1 #3 쓰기 축 · §5.1 #1-1).
 *
 * - 세그먼트(`&&` `||` `;` `|` `&` 개행)로 잘라 각각 판정한다. 셸 껍데기는 벗겨서 안을 본다.
 * - **heredoc 본문은 건너뛴다** — 본문 줄이 그대로 명령처럼 파싱되면 남의 글이 우리 판정이 된다.
 * - 선행 `cd <dir>` 는 이후 세그먼트의 기준 경로로 반영된다(상대 경로 해석용 · 이어 붙인다).
 * - 반환 경로는 **원문 그대로**(정규화·소문자화 ❌) — 호출부가 기존 `normalize()` 한 곳에서 처리한다.
 *
 * @param command 셸 도구의 `tool_input.command`
 * @param limit 상한 (기본 `BASH_WRITE_PATH_LIMIT`)
 * @param opts `platform` 은 중복 제거 키의 대소문자 규칙 + `/c/...` 변환 여부를 정한다. `dialect` 는 명령 글의 말씨
 *   (PowerShell 도구면 `'powershell'`).
 * @returns 중복 제거된 경로 목록. `cd` 로 base 가 잡혔으면 상대 경로에 그 base 를 붙여 돌려준다.
 */
export function extractBashWritePaths(
  command: string,
  limit: number = BASH_WRITE_PATH_LIMIT,
  opts?: { platform?: PlatformName; dialect?: ShellDialect },
): string[] {
  return extractBashWriteTargets(command, limit, opts).map((t) => t.path);
}

/**
 * `extractBashWritePaths` 와 같은 답에 **"목적지가 폴더면 붙일 이름"**(`intoName`)을 더한 꼴 — 디스크를 볼 수 있는
 * 서버가 그 시점에 `path` 가 폴더인지 보고 실제로 쓰인 파일을 고른다(`cp a.ts out` → `out` 이 폴더면 `out/a.ts`).
 * 감사 원장·검증 정책처럼 디스크를 안 보는 자리는 `extractBashWritePaths` 를 쓴다.
 */
export function extractBashWriteTargets(
  command: string,
  limit: number = BASH_WRITE_PATH_LIMIT,
  opts?: { platform?: PlatformName; dialect?: ShellDialect },
): ShellWriteTarget[] {
  if (!command || typeof command !== 'string' || limit <= 0) return [];
  const platform = opts?.platform ?? FALLBACK_PLATFORM;
  const toNative = platform === 'win32' ? toNativeDriveShellPath : (p: string): string => p;

  const seen = new Set<string>();
  const out: ShellWriteTarget[] = [];

  forEachShellSegment(command, (segment, ctx) => {
    const candidates = [
      ...plainTargets(redirectTargets(segment)),
      ...(ctx.wrapper ? [] : commandWriteTargets(segment)),
    ];
    for (const target of candidates) {
      const raw = target.path;
      if (isUnusableShellArg(raw)) continue;
      if (raw.startsWith('-')) continue;
      const resolved = toNative(joinShellPath(ctx.base, raw));
      // 중복 제거 키 — linux 에서 접으면 `src/Foo.ts` 와 `src/foo.ts` 중 하나가 조용히 사라진다.
      const key = pathKey(resolved, platform);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(target.intoName ? { path: resolved, intoName: target.intoName } : { path: resolved });
      if (out.length >= limit) return true;
    }
    return false;
  }, { ...(opts?.dialect ? { dialect: opts.dialect } : {}) });

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// §5.1 #2-1 (F) ③ — 작업 폴더 훑기의 기준 자리 후보
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이 Bash 명령에 **적힌 경로처럼 생긴 낱말**(`cd` 대상 포함, 원문 그대로 · 앞의 `cd` 를 기준으로 상대 경로를 잇는다).
 *
 * 판정은 하지 않는다 — 스크립트가 만든 파일(렌더한 glb · 생성한 텍스처)은 명령 글에 이름이 없으므로, 서버가 이
 * 낱말들이 **실재하는지** 보고 파일이면 그 폴더, 폴더면 그 자리를 훑는다. heredoc 본문은 건너뛴다(셸이 실행하지 않는
 * 글이다). 셸 껍데기는 안의 스크립트에서 낱말을 줍는다(바깥 토큰에는 스크립트 글 전체가 한 낱말로 들어 있다).
 * 쓰기 축(`extractBashWritePaths`)과 달리 무엇도 쓰기로 세지 않는다 — 훑을 자리를 말할 뿐이다.
 */
export function extractBashScanAnchors(
  command: string,
  limit: number,
  opts?: { platform?: PlatformName; dialect?: ShellDialect },
): string[] {
  if (!command || typeof command !== 'string' || limit <= 0) return [];
  const platform = opts?.platform ?? FALLBACK_PLATFORM;
  const toNative = platform === 'win32' ? toNativeDriveShellPath : (p: string): string => p;
  const seen = new Set<string>();
  const out: string[] = [];
  const take = (resolvedRaw: string): boolean => {
    const resolved = toNative(resolvedRaw);
    const key = pathKey(resolved, platform);
    if (seen.has(key)) return false;
    seen.add(key);
    out.push(resolved);
    return out.length >= limit;
  };
  forEachShellSegment(command, (segment, ctx) => {
    if (ctx.wrapper) {
      // 껍데기의 실행 파일 경로(`…\pwsh.exe`)와 스크립트 글은 자리가 아니다 — 바깥 리다이렉트 대상만 줍는다.
      for (const tok of segment) {
        if (!/^(\d*|&|\*)>/.test(tok)) continue;
        const t = tok.replace(/^(\d*|&|\*)>>?/, '');
        if (t && !isUnusableShellArg(t) && looksLikeShellPath(t) && take(joinShellPath(ctx.base, t))) return true;
      }
      return false;
    }
    for (const tok of segment) {
      // 붙어 온 리다이렉트(`>out.txt` · `2>>log`)는 대상만 본다.
      const t = tok.replace(/^(\d*|&|\*)>>?/, '');
      if (!t || t.startsWith('-') || isUnusableShellArg(t) || SHELL_SEGMENT_SEPARATORS.has(t)) continue;
      if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(t)) continue; // URL
      if (!looksLikeShellPath(t)) continue;
      if (take(joinShellPath(ctx.base, t))) return true;
    }
    return false;
  }, {
    ...(opts?.dialect ? { dialect: opts.dialect } : {}),
    onCd: (base) => take(base),
  });
  return out;
}
