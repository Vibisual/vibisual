import { describe, it, expect } from 'vitest';
import { buildCliInvocation, resolveCmdShimTarget, type CmdShimReader } from './claudeCliRun.js';

// 멀티플랫폼 규칙 — 분기 함수가 `platform` 을 인자로 받으므로 개발기 한 대에서 세 OS 를 다 잰다.

describe('buildCliInvocation', () => {
  it('mac/linux 는 셸을 끼우지 않는다', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const inv = buildCliInvocation('/usr/local/bin/claude', ['-p', '/usage'], platform);
      expect(inv).toEqual({ file: '/usr/local/bin/claude', args: ['-p', '/usage'], shell: false });
    }
  });

  it('Windows 네이티브 실행본(.exe)도 셸 없이 그대로 — 인용 규칙이 끼어들 자리가 없다', () => {
    const inv = buildCliInvocation('C:\\Program Files\\Claude\\claude.exe', ['-p', '/usage'], 'win32');
    expect(inv.shell).toBe(false);
    expect(inv.file).toBe('C:\\Program Files\\Claude\\claude.exe');
    expect(inv.args).toEqual(['-p', '/usage']);
  });

  it('.cmd shim 의 실행본 경로는 따옴표가 아니라 `^` 로 덮는다 — 감싸면 cmd 가 경로를 못 찾는다', () => {
    const inv = buildCliInvocation('C:\\Program Files\\nodejs\\claude.cmd', ['-p', '/usage'], 'win32');
    expect(inv.shell).toBe(true);
    expect(inv.file).toBe('C:\\Program^ Files\\nodejs\\claude.cmd');
    // 공백이 없으면 덮을 것도 없다.
    expect(buildCliInvocation('C:\\bin\\claude.cmd', [], 'win32').file).toBe('C:\\bin\\claude.cmd');
  });

  it('인자는 argv 인용 + `^` 이중 escape — shim 이 `%*` 로 한 번 더 펼치므로 cmd 가 줄을 두 번 읽는다', () => {
    const inv = buildCliInvocation('C:\\bin\\claude.bat', ['--settings', 'C:\\a b\\s.json'], 'win32');
    expect(inv.args).toEqual(['^^^"--settings^^^"', '^^^"C:\\a^^^ b\\s.json^^^"']);
  });

  it('역슬래시로 끝나는 인자는 뭉치를 배로 늘린다 — 안 늘리면 닫는 따옴표를 잡아먹어 인자 경계가 무너진다', () => {
    const inv = buildCliInvocation('C:\\bin\\claude.cmd', ['C:\\dir\\'], 'win32');
    expect(inv.args).toEqual(['^^^"C:\\dir\\\\^^^"']);
  });
});

/**
 * §보안 감사 2026-09-09 — cmd 명령 주입 회귀.
 * `[\s&|<>^]` 이 없는 값(예: `"` 하나뿐인 모델명)을 그대로 흘리면 그 `"` 가 cmd 인용 상태를 뒤집어, 뒤 인자의 따옴표 속 `&` 가 인용 밖에서 실행된다(`.cmd` shim 으로 실행까지 확인).
 * 공격 인자는 `PUT /api/agent-config/:agentId` 의 `modelId`·`reasoningEffort` 로 들어와 `codexRunner.buildCodexExecArgs` 를 그대로 통과한다.
 */
describe('buildCliInvocation — cmd 명령 주입 회귀', () => {
  /** cmd 가 `^` 를 한 겹 벗기는 것을 흉내 낸다. `.cmd` shim 은 `%*` 재전개로 이 일을 두 번 한다. */
  const stripOneCaretLayer = (s: string): string => {
    let out = '';
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] === '^' && i + 1 < s.length) {
        out += s[i + 1];
        i += 1;
        continue;
      }
      out += s[i];
    }
    return out;
  };

  const HOSTILE = [
    '"',
    '""',
    'x"',
    '"&whoami',
    'model_reasoning_effort=& echo OWNED > C:\\pwn.txt &',
    'a" & calc & rem ',
    'x|y',
    'x>out.txt',
    '%USERPROFILE%',
    '!DELAYED!',
    'a\\"b',
    'C:\\dir\\',
    '`backtick`',
  ];

  /**
   * `CommandLineToArgvW` 규칙으로 인용 상태를 따라간다 — `"` 는 **앞선 역슬래시가 짝수일 때만**
   * 진짜 구분자다(`\\"` 는 역슬래시 하나 + 구분자, `\"` 는 리터럴 따옴표). 이 규칙을 안 쓰면
   * `C:\dir\\"` 같은 정상 인자를 오탐한다.
   */
  const scanQuoteState = (line: string): { leaked: string[]; balanced: boolean } => {
    const leaked: string[] = [];
    let inQuote = false;
    let backslashes = 0;
    for (const ch of line) {
      if (ch === '\\') {
        backslashes += 1;
        continue;
      }
      if (ch === '"') {
        if (backslashes % 2 === 0) inQuote = !inQuote;
        backslashes = 0;
        continue;
      }
      backslashes = 0;
      if (!inQuote && '&|<>^'.includes(ch)) leaked.push(ch);
    }
    return { leaked, balanced: !inQuote };
  };

  it('두 겹을 다 벗겨도 메타문자는 전부 따옴표 **안**에 남는다 — 인용 상태가 뒤집히지 않는다', () => {
    for (const value of HOSTILE) {
      const [arg] = buildCliInvocation('C:\\bin\\claude.cmd', [value!], 'win32').args;
      const onceRead = stripOneCaretLayer(arg!); // shim 이 %* 로 다시 펼치기 전
      const twiceRead = stripOneCaretLayer(onceRead); // 자식에게 실제로 닿는 명령줄
      const { leaked, balanced } = scanQuoteState(twiceRead);

      expect(balanced, `인용이 열린 채로 끝난다: ${value} → ${twiceRead}`).toBe(true);
      expect(leaked, `인용 밖으로 샌 메타문자: ${value} → ${twiceRead}`).toEqual([]);
    }
  });

  it('실제 공격 인자 조합(모델명 `"` + effort `&`)에서 `&` 가 한 번도 맨몸으로 나오지 않는다', () => {
    const inv = buildCliInvocation(
      'C:\\tools\\npm\\codex.cmd',
      ['exec', '--json', '-m', '"', '-s', 'workspace-write', '-c', 'model_reasoning_effort=&whoami'],
      'win32',
    );
    for (const arg of inv.args) {
      // `&` 는 앞의 두 글자가 `^^` 여야 한다(이중 escape).
      const idx = arg.indexOf('&');
      if (idx >= 0) expect(arg.slice(idx - 2, idx)).toBe('^^');
    }
    expect(inv.args[3]).toBe('^^^"\\^^^"^^^"');
  });
});

// npm cmd-shim 이 실제로 쓰는 본문(줄 끝 CRLF). 마지막 줄의 `%*` 앞 따옴표 토큰이 실행 대상이다.
const NPM_NODE_SHIM = [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '',
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
  '',
].join('\r\n');

function reader(files: Record<string, string | true>, node: string | null = 'C:\\Program Files\\nodejs\\node.exe'): CmdShimReader {
  const key = (p: string) => p.toLowerCase();
  const table = new Map(Object.entries(files).map(([k, v]) => [key(k), v]));
  return {
    read: (p) => {
      const v = table.get(key(p));
      return typeof v === 'string' ? v : null;
    },
    isFile: (p) => table.has(key(p)),
    node: () => node,
  };
}

describe('resolveCmdShimTarget — npm 전역 설치 .cmd 심을 셸 없이 푼다', () => {
  const shim = 'D:\\npm-global\\claude.cmd';
  const cli = 'D:\\npm-global\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
  const systemNode = 'C:\\Program Files\\nodejs\\node.exe';

  it('%_prog% 는 PATH 의 node 로, %dp0% 는 심 폴더로 — node + 스크립트를 직접 띄운다', () => {
    const r = reader({ [shim]: NPM_NODE_SHIM, [cli]: true, [systemNode]: true });
    expect(resolveCmdShimTarget(shim, r)).toEqual({ file: systemNode, prefixArgs: [cli] });
  });

  it('심 옆에 node.exe 가 있으면 그것을 쓴다(npm 심이 고르는 순서와 같다)', () => {
    const local = 'D:\\npm-global\\node.exe';
    const r = reader({ [shim]: NPM_NODE_SHIM, [cli]: true, [local]: true });
    expect(resolveCmdShimTarget(shim, r)?.file).toBe(local);
  });

  it('네이티브 대상(.exe)은 그 실행본을 바로 띄운다', () => {
    const exe = 'D:\\npm-global\\node_modules\\@openai\\codex\\bin\\codex.exe';
    const body = '@ECHO off\r\nSETLOCAL\r\n"%~dp0\\node_modules\\@openai\\codex\\bin\\codex.exe"   %*\r\n';
    const r = reader({ [shim]: body, [exe]: true });
    expect(resolveCmdShimTarget(shim, r)).toEqual({ file: exe, prefixArgs: [] });
  });

  it('절대경로 한 줄 런처도 푼다', () => {
    const body = '@echo off\r\nsetlocal\r\n"C:\\n\\node.exe" "C:\\s\\fake-claude.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n';
    const r = reader({ [shim]: body, 'C:\\n\\node.exe': true, 'C:\\s\\fake-claude.mjs': true });
    expect(resolveCmdShimTarget(shim, r)).toEqual({ file: 'C:\\n\\node.exe', prefixArgs: ['C:\\s\\fake-claude.mjs'] });
  });

  it.each([
    ['모르는 변수', '"%SOMEWHERE%\\x.exe" %*\r\n', [] as string[], true],
    ['대상 파일 없음', NPM_NODE_SHIM, [] as string[], true],
    ['node 를 못 찾음', NPM_NODE_SHIM, ['cli'], false],
    ['다른 배치 파일로 위임', '"C:\\a\\inner.cmd" %*\r\n', ['C:\\a\\inner.cmd'], true],
    ['%* 줄 없음', '@echo off\r\nnode x.js\r\n', [] as string[], true],
  ] as const)('%s 이면 풀지 않는다 — 종전 셸 경유로 남는다', (_name, body, present, hasNode) => {
    const files: Record<string, string | true> = { [shim]: body };
    for (const p of present) files[p === 'cli' ? cli : p] = true;
    const r = reader(files, hasNode ? systemNode : null);
    expect(resolveCmdShimTarget(shim, r)).toBeNull();
    expect(buildCliInvocation(shim, ['-p', 'x'], 'win32', r).shell).toBe(true);
  });

  it('풀린 형태는 셸을 타지 않아 개행 든 인자(에이전트 규칙)가 한 글자도 바뀌지 않는다', () => {
    const r = reader({ [shim]: NPM_NODE_SHIM, [cli]: true, [systemNode]: true });
    const rules = 'line one\nline "two" & three';
    const inv = buildCliInvocation(shim, ['--append-system-prompt', rules], 'win32', r);
    expect(inv).toEqual({ file: systemNode, args: [cli, '--append-system-prompt', rules], shell: false });
  });

  it.each(['darwin', 'linux'] as const)('%s 에서는 심을 읽지도 않는다', (platform) => {
    const r = reader({});
    r.read = () => {
      throw new Error('must not read on POSIX');
    };
    expect(buildCliInvocation('/usr/local/bin/claude', ['-p'], platform, r)).toEqual({ file: '/usr/local/bin/claude', args: ['-p'], shell: false });
  });
});
