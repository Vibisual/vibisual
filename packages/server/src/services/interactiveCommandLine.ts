/**
 * §4 (CMD) — CMD 터미널 셸에 **미리 쳐 넣을 한 줄**을 그 셸의 인용 규칙으로 짓는다.
 *
 * 헤드리스 스폰은 인자를 배열로 넘기므로(셸 없음) 무엇이든 그대로 닿는다. CMD 터미널은 다르다 —
 * 사람이 Enter 를 치도록(§4 v2.63 ToS 합법선) 명령을 **셸 입력줄에 글자로** 넣고, 그 줄은 셸이 다시
 * 쪼갠다. 종전 규칙("공백이 있으면 큰따옴표로 감싼다")은 셸 문법을 몰라서 두 곳에서 깨졌다.
 *   ① `--agents` JSON 의 안쪽 따옴표를 그대로 둬 cmd.exe·bash 둘 다 JSON 을 쪼갰다 — 2.1.288 실측:
 *      `Invalid --agents configuration: invalid JSON`. 서브에이전트를 정의한 CMD 버블은 Enter 를 치는
 *      순간 claude 가 바로 끝났다.
 *   ② 공백 없는 `opus[1m]` 을 맨몸으로 내보냈다 — mac 기본 셸 zsh 는 `[1m]` 을 글롭으로 읽고, 맞는 파일이
 *      없으면 `no matches found` 로 **명령을 실행하지 않는다**(Opus 1M 이 기본 조합이다). bash 도 cwd 에
 *      `opus1` 같은 파일이 있으면 그 이름으로 바꿔 넘긴다.
 *
 * 셸은 데스크톱 터미널 매니저의 `pickShell` 이 정한다 — win32 는 `COMSPEC`(cmd.exe), 그 밖은 `$SHELL`.
 * 플랫폼·셸은 **인자로** 받는다(멀티플랫폼 규칙 — 그래야 Windows 개발기에서 세 OS 를 다 시험한다).
 */

/** 인용 규칙 갈래. fish 는 작은따옴표 안의 `\` 를 이스케이프로 읽어 POSIX 셸과 갈린다. */
export type InteractiveShellFamily = 'cmd' | 'posix' | 'fish';

/** 터미널이 띄운 셸 → 인용 규칙 갈래. win32 는 `COMSPEC`(cmd.exe) 하나뿐이다. */
export function interactiveShellFamily(
  shellPath: string | undefined,
  platform: NodeJS.Platform,
): InteractiveShellFamily {
  if (platform === 'win32') return 'cmd';
  // 이름만 뗀다 — `path.basename` 은 POSIX 에서 `\` 를 구분자로 보지 않는다(멀티플랫폼 §1).
  const name = (shellPath ?? '').replace(/\\/g, '/').split('/').pop() ?? '';
  return /^fish(\.exe)?$/i.test(name) ? 'fish' : 'posix';
}

/** POSIX 셸에서 맨몸으로 둬도 뜻이 바뀌지 않는 글자. 나머지(공백·따옴표·`[]*?$~{}` 등)는 전부 감싼다. */
const POSIX_SAFE = /^[A-Za-z0-9_\-.,:/@+]+$/;

/** cmd.exe 가 따옴표 밖에서 특별히 읽는 글자 — 명령 구분·리디렉션·괄호 묶음·변수 확장·이스케이프. */
const CMD_META = /[()%!^"<>&|]/g;
/** cmd.exe 에서 맨몸으로 둘 수 없는 인자 — 공백이 있거나, 따옴표·cmd 특수 글자가 있거나, 비었다. */
const CMD_NEEDS_QUOTING = /[\s()%!^"<>&|]/;

/** 작은따옴표 한 쌍으로 감싼다 — 안의 `'` 는 닫고·이스케이프하고·다시 연다(`'\''`). */
function quotePosix(arg: string): string {
  if (arg !== '' && POSIX_SAFE.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** fish — 작은따옴표 안에서는 `\\` 와 `\'` 만 이스케이프다. */
function quoteFish(arg: string): string {
  if (arg !== '' && POSIX_SAFE.test(arg)) return arg;
  return `'${arg.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Windows 프로그램이 명령줄을 인자로 나누는 규칙(CommandLineToArgvW)대로 한 인자를 감싼다 —
 * `"` 는 `\"`, 그 앞의 역슬래시와 닫는 따옴표 앞의 역슬래시는 두 배.
 */
function quoteForWindowsArgv(arg: string): string {
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes += 1;
      continue;
    }
    if (ch === '"') {
      out += `${'\\'.repeat(backslashes * 2 + 1)}"`;
    } else {
      out += `${'\\'.repeat(backslashes)}${ch}`;
    }
    backslashes = 0;
  }
  return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

/**
 * cmd.exe 입력줄에 넣을 인자 하나. 프로그램 규칙으로 감싼 뒤 **cmd 특수 글자를 전부 `^` 로 이스케이프**한다
 * — 감싼 따옴표까지. 그러면 cmd 가 따옴표 상태로 한 번도 들어가지 않아(`\"` 가 cmd 의 따옴표 상태를
 * 뒤집는 문제가 사라진다) JSON 안의 `&`·`|`·`%` 가 명령 구분·변수 확장으로 읽히지 않고, `^` 를 걷어 낸
 * 줄이 그대로 프로그램에 닿는다.
 */
function quoteCmdArg(arg: string): string {
  if (!CMD_NEEDS_QUOTING.test(arg) && arg !== '') return arg;
  return quoteForWindowsArgv(arg).replace(CMD_META, '^$&');
}

/**
 * cmd.exe 입력줄의 **첫 토큰(실행 파일 경로)**. cmd 는 첫 토큰으로 실행할 파일을 찾으므로 `^"` 로
 * 이스케이프하면 공백 든 경로가 두 동강 난다 — 맨 따옴표로만 감싼다(Windows 경로에는 `"` 가 올 수 없다).
 */
function quoteCmdProgram(binPath: string): string {
  return CMD_NEEDS_QUOTING.test(binPath) ? `"${binPath}"` : binPath;
}

/** 인자 하나를 그 셸의 규칙으로 감싼다. `isProgram` 은 줄의 첫 토큰(실행 파일)일 때만. */
export function quoteShellArg(arg: string, family: InteractiveShellFamily, isProgram = false): string {
  if (family === 'cmd') return isProgram ? quoteCmdProgram(arg) : quoteCmdArg(arg);
  return family === 'fish' ? quoteFish(arg) : quotePosix(arg);
}

/** argv 배열 → 그 셸에 그대로 쳐 넣을 한 줄. 첫 원소는 실행 파일이다. 개행은 붙이지 않는다. */
export function buildShellCommandLine(argv: readonly string[], family: InteractiveShellFamily): string {
  return argv.map((arg, i) => quoteShellArg(arg, family, i === 0)).join(' ');
}
