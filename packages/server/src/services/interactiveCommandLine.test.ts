import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildShellCommandLine,
  interactiveShellFamily,
  quoteShellArg,
  type InteractiveShellFamily,
} from './interactiveCommandLine.js';

/**
 * §4 (CMD) — CMD 터미널에 미리 쳐 넣는 한 줄의 인용.
 *
 * 사용자를 때린 것: 서브에이전트를 정의한 CMD 버블은 Enter 를 치는 순간 claude 가
 * `Invalid --agents configuration: invalid JSON` 으로 끝났고(cmd.exe·bash 둘 다 안쪽 따옴표를 먹었다),
 * mac 기본 셸 zsh 에서는 맨몸 `opus[1m]` 이 글롭으로 읽혀 `no matches found` 로 명령이 아예 돌지 않았다.
 *
 * 기대 문자열만으로는 셸이 실제로 그렇게 읽는지 모른다 — 그래서 **진짜 셸에 그 줄을 넣고 argv 가 그대로
 * 돌아오는지** 왕복으로 잰다(Windows 는 cmd.exe, POSIX 는 sh · 있으면 zsh · fish). CI 의 세 OS 매트릭스가
 * 셋을 다 돈다.
 */

/**
 * 받은 argv 를 JSON 으로 찍는 프로그램 — `node -e <코드> -- <인자들>` 의 argv 는 실행 파일 다음부터가 넘긴 인자다.
 * `--` 가 없으면 node 가 `--agents` 를 자기 옵션으로 읽고 `bad option` 으로 끝난다.
 */
const PRINT_ARGV = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';

/** 셸이 뜻을 바꾸기 쉬운 것들을 한데 모은 인자들. */
const TRICKY_ARGS = [
  '--agents',
  JSON.stringify({
    reviewer: {
      description: 'Tom & Jerry | 100% "done" <ok>',
      prompt: 'C:\\path\\to\\dir\\ (a) ^b !c $HOME `whoami` *.ts',
    },
  }),
  '--model',
  'opus[1m]',
  '--tools',
  '',
  'it\'s a path with spaces',
  'ends with backslash \\',
  '%PATH%',
  '한글 인자',
  '--flag=value',
  'Read,Write,Bash(git status:*)',
];

function roundTrip(shell: string, shellArgs: string[], family: InteractiveShellFamily): unknown {
  const line = buildShellCommandLine([process.execPath, '-e', PRINT_ARGV, '--', ...TRICKY_ARGS], family);
  const res = family === 'cmd'
    // `/s /c "<줄>"` — 바깥 따옴표 한 쌍만 걷고 나머지를 입력줄 그대로 처리한다.
    ? spawnSync(shell, ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true, encoding: 'utf8', timeout: 20_000 })
    : spawnSync(shell, [...shellArgs, line], { encoding: 'utf8', timeout: 20_000 });
  expect(res.error, `셸 실행 실패: ${String(res.error)}`).toBeUndefined();
  expect(res.status, `stderr: ${res.stderr}`).toBe(0);
  return JSON.parse(res.stdout);
}

/** PATH 에서 실행 파일을 찾는다 — 없으면 null(그 셸의 왕복은 건너뛴다). */
function findOnPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    const p = `${dir}/${name}`;
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* 다음 */
    }
  }
  return null;
}

describe('interactiveShellFamily — 셸 → 인용 규칙', () => {
  it('Windows 는 셸 경로와 무관하게 cmd.exe 규칙이다(COMSPEC)', () => {
    expect(interactiveShellFamily('C:\\WINDOWS\\system32\\cmd.exe', 'win32')).toBe('cmd');
    expect(interactiveShellFamily(undefined, 'win32')).toBe('cmd');
  });

  it('mac zsh · linux bash 는 POSIX 규칙, fish 는 따로', () => {
    expect(interactiveShellFamily('/bin/zsh', 'darwin')).toBe('posix');
    expect(interactiveShellFamily('/usr/bin/bash', 'linux')).toBe('posix');
    expect(interactiveShellFamily('/opt/homebrew/bin/fish', 'darwin')).toBe('fish');
    expect(interactiveShellFamily('/usr/bin/fish', 'linux')).toBe('fish');
    expect(interactiveShellFamily(undefined, 'linux')).toBe('posix');
  });
});

describe('quoteShellArg — 기대 문자열', () => {
  it('zsh 가 글롭으로 읽는 opus[1m] 은 POSIX 에서 작은따옴표로 감싼다', () => {
    expect(quoteShellArg('opus[1m]', 'posix')).toBe("'opus[1m]'");
    expect(quoteShellArg('opus[1m]', 'fish')).toBe("'opus[1m]'");
    // cmd.exe 에서 [] 는 특별하지 않다 — 맨몸 그대로.
    expect(quoteShellArg('opus[1m]', 'cmd')).toBe('opus[1m]');
  });

  it('평범한 플래그·값은 어느 셸에서도 맨몸이다(줄이 읽기 쉽게)', () => {
    for (const family of ['cmd', 'posix', 'fish'] as const) {
      expect(quoteShellArg('--permission-mode', family)).toBe('--permission-mode');
      expect(quoteShellArg('Read,Write,Edit', family)).toBe('Read,Write,Edit');
    }
  });

  it('빈 값(`--tools ""` — 도구 전부 끔)은 빈 인자로 남는다', () => {
    expect(quoteShellArg('', 'posix')).toBe("''");
    expect(quoteShellArg('', 'cmd')).toBe('^"^"');
  });

  it('cmd.exe — JSON 의 따옴표는 프로그램 규칙(\\")으로, cmd 특수 글자는 전부 ^ 로 이스케이프한다', () => {
    expect(quoteShellArg('{"a":"x & y"}', 'cmd')).toBe('^"{\\^"a\\^":\\^"x ^& y\\^"}^"');
  });

  it('cmd.exe — 실행 파일 경로는 맨 따옴표로만 감싼다(^" 면 공백 든 경로가 두 동강 난다)', () => {
    expect(quoteShellArg('C:\\Program Files (x86)\\claude.exe', 'cmd', true)).toBe('"C:\\Program Files (x86)\\claude.exe"');
    expect(quoteShellArg('C:\\tools\\claude.exe', 'cmd', true)).toBe('C:\\tools\\claude.exe');
  });

  it('POSIX — 작은따옴표 안의 작은따옴표는 닫고 이스케이프하고 다시 연다', () => {
    expect(quoteShellArg("it's", 'posix')).toBe("'it'\\''s'");
  });

  it('fish — 작은따옴표 안의 역슬래시도 이스케이프한다(fish 는 그 안의 \\\\ 를 하나로 읽는다)', () => {
    expect(quoteShellArg('a\\b\'c', 'fish')).toBe("'a\\\\b\\'c'");
  });
});

describe('진짜 셸 왕복 — 쳐 넣은 줄이 그 argv 그대로 프로그램에 닿는다', () => {
  it.runIf(process.platform === 'win32')('cmd.exe — --agents JSON · % · & · 따옴표 · 끝 역슬래시 · 한글', () => {
    expect(roundTrip(process.env['COMSPEC'] ?? 'cmd.exe', [], 'cmd')).toEqual(TRICKY_ARGS);
  });

  it.runIf(process.platform !== 'win32')('/bin/sh', () => {
    expect(roundTrip('/bin/sh', ['-c'], 'posix')).toEqual(TRICKY_ARGS);
  });

  const zsh = process.platform === 'win32' ? null : findOnPath('zsh');
  it.runIf(zsh !== null)('zsh — opus[1m] 이 글롭으로 읽히지 않는다(mac 기본 셸)', () => {
    expect(roundTrip(zsh as string, ['-f', '-c'], 'posix')).toEqual(TRICKY_ARGS);
  });

  const fish = process.platform === 'win32' ? null : findOnPath('fish');
  it.runIf(fish !== null)('fish', () => {
    expect(roundTrip(fish as string, ['--no-config', '-c'], 'fish')).toEqual(TRICKY_ARGS);
  });
});

describe('배선 — CMD prefill 이 이 인용을 쓰고, 터미널이 자기 셸을 넘긴다', () => {
  // Windows 러너는 CRLF 로 체크아웃한다 — 줄끝을 LF 로 맞춰야 `\n` 패턴이 세 OS 에서 같게 읽힌다.
  const read = (rel: string): string =>
    fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

  it('buildInteractiveCliPrefill 이 셸 규칙으로 줄을 짓는다 — 옛 "공백이면 큰따옴표" 규칙이 돌아오지 않는다', () => {
    const src = read('./subAgentManager.ts');
    expect(src).toContain('buildShellCommandLine([opts.claudeBinPath, ...fullArgs], family)');
    expect(src).not.toContain('function quoteInteractiveArg(');
  });

  it('터미널 매니저가 pickShell 의 셸을 prefill 에 넘긴다', () => {
    const src = read('../../../desktop/src/main/terminalManager.ts');
    const call = src.slice(src.indexOf('const { prefill } = buildInteractiveCliPrefill({'));
    expect(call.slice(0, call.indexOf('});'))).toMatch(/\n\s+shell,\n/);
  });
});
