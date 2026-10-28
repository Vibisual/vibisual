/**
 * §4 (CMD) — 셸 입력줄에 미리 쳐 넣을 한 줄을 그 셸의 인용 규칙으로 짓는다(사람이 Enter — §4 ToS 합법선). 셸이 다시 쪼개므로 "공백이면 큰따옴표"로는 깨진다:
 * `--agents` JSON 안쪽 따옴표를 cmd.exe·bash 가 쪼개고(2.1.288 실측 `invalid JSON`), zsh 는 맨몸 `opus[1m]` 을 글롭으로 읽어 실행하지 않는다.
 * 셸은 데스크톱 `pickShell`(win32 `COMSPEC`, 그 밖 `$SHELL`). 플랫폼·셸은 **인자로** 받는다(세 OS 시험).
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

/** cmd.exe 인자: 프로그램 규칙으로 감싼 뒤 **감싼 따옴표까지 cmd 특수 글자를 전부 `^` 이스케이프** — cmd 가 따옴표 상태로 안 들어가 `&`·`|`·`%` 가 해석되지 않고 `^` 를 걷은 줄이 그대로 닿는다. */
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
