/**
 * §5.25 (I) — 코덱스 훅 인스톨러 고정 시험.
 *
 * 이 인스톨러는 **남의 전역 설정 파일**을 고친다. 그래서 시험의 대부분이 "우리 것만 건드렸는지"에
 * 쓰인다 — 남의 훅이 한 줄이라도 사라지면 그 사용자에게는 우리가 설정을 망가뜨린 앱이 된다.
 *
 * `CODEX_HOME` 오버라이드를 임시 폴더로 돌려 **진짜 사용자 홈은 건드리지 않는다**
 * (테스트가 실제 상태 파일을 오염시킨 사고가 이미 한 번 있었다).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CODEX_HOOK_EVENTS } from '@vibisual/shared';
import {
  buildCodexHookCommand,
  isOurCodexHookCommand,
  buildCodexHookBlocks,
  codexHooksPath,
  getCodexHookState,
  installCodexHooks,
  uninstallCodexHooks,
} from './codexHookInstaller.js';

const HANDLER = '/opt/vibisual/hooks/handler.mjs';
const PORT = 51360;
const TOKEN = 'tok-abc';

let tmpHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env['CODEX_HOME'];
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vib-codex-hooks-'));
  process.env['CODEX_HOME'] = tmpHome;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['CODEX_HOME'];
  else process.env['CODEX_HOME'] = prevHome;
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* 임시 폴더 정리 실패는 시험 결과를 바꾸지 않는다 */
  }
});

function readHooks(): Record<string, unknown> {
  const parsed = JSON.parse(fs.readFileSync(codexHooksPath(), 'utf8')) as Record<string, unknown>;
  return (parsed['hooks'] ?? {}) as Record<string, unknown>;
}

describe('buildCodexHookCommand — 한 문자열이라 따옴표가 필수다', () => {
  it('공백 없는 경로는 그대로 둔다', () => {
    expect(buildCodexHookCommand('/usr/bin/node', HANDLER, PORT, TOKEN)).toBe(
      `/usr/bin/node ${HANDLER} --server http://127.0.0.1:${PORT} --token ${TOKEN}`,
    );
  });

  it('공백이 든 경로는 감싼다 — Program Files 에서 명령이 두 동강 나지 않게', () => {
    const cmd = buildCodexHookCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\My Apps\\handler.mjs', PORT, TOKEN);
    expect(cmd).toContain('"C:\\Program Files\\nodejs\\node.exe"');
    expect(cmd).toContain('"C:\\My Apps\\handler.mjs"');
  });
});

describe('isOurCodexHookCommand — 우리 것 판정', () => {
  it('handler 경로와 토큰 플래그가 둘 다 보일 때만 우리 것이다', () => {
    const ours = buildCodexHookCommand('node', HANDLER, PORT, TOKEN);
    expect(isOurCodexHookCommand(ours, HANDLER)).toBe(true);
  });

  it('경로 구분자가 달라도 같은 것으로 읽는다(Windows 에 적힌 우리 훅)', () => {
    const win = 'node C:\\vib\\hooks\\handler.mjs --server http://127.0.0.1:1 --token t';
    expect(isOurCodexHookCommand(win, 'C:/vib/hooks/handler.mjs')).toBe(true);
  });

  it('남의 훅은 우리 것이 아니다', () => {
    expect(isOurCodexHookCommand('npx prettier --write .', HANDLER)).toBe(false);
    expect(isOurCodexHookCommand('', HANDLER)).toBe(false);
    // handler 는 같아도 토큰 플래그가 없으면 우리 서명이 아니다.
    expect(isOurCodexHookCommand(`node ${HANDLER} --server http://x`, HANDLER)).toBe(false);
  });
});

describe('buildCodexHookBlocks — 이벤트 목록은 상수 한 곳이 소유한다', () => {
  it('상수에 적힌 이벤트를 빠짐없이 만든다', () => {
    const blocks = buildCodexHookBlocks('node', HANDLER, PORT, TOKEN);
    expect(Object.keys(blocks).sort()).toEqual([...CODEX_HOOK_EVENTS].sort());
  });

  it('각 이벤트에 제한 시간이 붙은 우리 명령이 하나씩 들어간다', () => {
    const blocks = buildCodexHookBlocks('node', HANDLER, PORT, TOKEN);
    for (const event of CODEX_HOOK_EVENTS) {
      const entry = blocks[event]?.[0]?.hooks[0];
      expect(entry?.type).toBe('command');
      expect(isOurCodexHookCommand(entry?.command ?? '', HANDLER)).toBe(true);
      // 제한 시간이 없으면 우리 훅이 사용자의 코덱스 턴을 무한정 붙잡을 수 있다.
      expect(typeof entry?.timeout).toBe('number');
    }
  });
});

describe('설치 — 없던 파일에', () => {
  it('코덱스 홈이 없어도 만들어서 적는다', () => {
    const state = installCodexHooks(HANDLER, PORT, TOKEN);
    expect(state.installed).toBe(true);
    expect([...state.events].sort()).toEqual([...CODEX_HOOK_EVENTS].sort());
    expect(fs.existsSync(codexHooksPath())).toBe(true);
  });

  it('설치 전 상태는 "설치 안 됨"이다', () => {
    const before = getCodexHookState(HANDLER);
    expect(before.installed).toBe(false);
    expect(before.events).toEqual([]);
  });

  it('handler 경로를 모르면 설치 여부를 판정할 근거가 없다 → 설치 안 됨', () => {
    installCodexHooks(HANDLER, PORT, TOKEN);
    expect(getCodexHookState(null).installed).toBe(false);
  });
});

describe('설치 — 남의 훅이 이미 있는 파일에', () => {
  const foreign = {
    description: '사용자가 직접 쓴 설명',
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'npx my-linter' }] }],
      PostCompact: [{ hooks: [{ type: 'command', command: 'echo compacted' }] }],
    },
    somethingElse: { keepMe: true },
  };

  beforeEach(() => {
    fs.mkdirSync(path.dirname(codexHooksPath()), { recursive: true });
    fs.writeFileSync(codexHooksPath(), JSON.stringify(foreign, null, 2), 'utf8');
  });

  it('남의 훅을 남긴 채 우리 것을 덧붙인다', () => {
    installCodexHooks(HANDLER, PORT, TOKEN);
    const hooks = readHooks();
    const pre = hooks['PreToolUse'] as Array<{ matcher?: string; hooks: Array<{ command: string }> }>;
    expect(pre.some((b) => b.hooks.some((h) => h.command === 'npx my-linter'))).toBe(true);
    expect(pre.some((b) => b.hooks.some((h) => isOurCodexHookCommand(h.command, HANDLER)))).toBe(true);
    // 우리가 안 건드리는 이벤트도 그대로 있다.
    expect(hooks['PostCompact']).toBeTruthy();
  });

  it('훅 밖의 다른 설정 키를 지우지 않는다', () => {
    installCodexHooks(HANDLER, PORT, TOKEN);
    const parsed = JSON.parse(fs.readFileSync(codexHooksPath(), 'utf8')) as Record<string, unknown>;
    expect(parsed['description']).toBe('사용자가 직접 쓴 설명');
    expect(parsed['somethingElse']).toEqual({ keepMe: true });
  });

  it('덮어쓰기 전에 백업을 남긴다', () => {
    installCodexHooks(HANDLER, PORT, TOKEN);
    const backups = fs.readdirSync(path.dirname(codexHooksPath())).filter((n) => n.includes('.bak-vibisual-'));
    expect(backups.length).toBeGreaterThan(0);
  });
});

describe('재설치 — 포트가 바뀌면 옛 항목은 죽은 주소다', () => {
  it('우리 항목은 늘어나지 않고 최신 명령으로 갈린다', () => {
    installCodexHooks(HANDLER, PORT, TOKEN);
    installCodexHooks(HANDLER, 9999, 'tok-new');

    const hooks = readHooks();
    const first = CODEX_HOOK_EVENTS[0] as string;
    const blocks = hooks[first] as Array<{ hooks: Array<{ command: string }> }>;
    const mine = blocks.flatMap((b) => b.hooks).filter((h) => isOurCodexHookCommand(h.command, HANDLER));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.command).toContain('9999');
    expect(mine[0]?.command).toContain('tok-new');
    expect(mine[0]?.command).not.toContain(String(PORT));
  });
});

describe('제거 — 우리 것만 걷어낸다', () => {
  it('설치했다가 제거하면 설치 안 됨으로 돌아온다', () => {
    installCodexHooks(HANDLER, PORT, TOKEN);
    const state = uninstallCodexHooks(HANDLER);
    expect(state.installed).toBe(false);
    expect(state.events).toEqual([]);
  });

  it('남의 훅은 그대로 남는다', () => {
    fs.mkdirSync(path.dirname(codexHooksPath()), { recursive: true });
    fs.writeFileSync(
      codexHooksPath(),
      JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'npx my-linter' }] }] } }),
      'utf8',
    );
    installCodexHooks(HANDLER, PORT, TOKEN);
    uninstallCodexHooks(HANDLER);

    const hooks = readHooks();
    const pre = hooks['PreToolUse'] as Array<{ hooks: Array<{ command: string }> }>;
    expect(pre.flatMap((b) => b.hooks).map((h) => h.command)).toEqual(['npx my-linter']);
  });

  it('우리 것만 있던 이벤트는 빈 껍데기를 남기지 않는다', () => {
    installCodexHooks(HANDLER, PORT, TOKEN);
    uninstallCodexHooks(HANDLER);
    // 빈 블록이 남으면 코덱스가 훅 없는 훅을 읽는다.
    expect(Object.keys(readHooks())).toEqual([]);
  });

  it('파일이 없으면 아무 일도 하지 않는다', () => {
    const state = uninstallCodexHooks(HANDLER);
    expect(state.installed).toBe(false);
    expect(fs.existsSync(codexHooksPath())).toBe(false);
  });
});

describe('깨진 파일 — 손대지 않는다', () => {
  it('파싱할 수 없으면 사유만 돌려주고 원문을 그대로 둔다', () => {
    fs.mkdirSync(path.dirname(codexHooksPath()), { recursive: true });
    const broken = '{ this is not json';
    fs.writeFileSync(codexHooksPath(), broken, 'utf8');

    const installed = installCodexHooks(HANDLER, PORT, TOKEN);
    expect(installed.installed).toBe(false);
    expect(installed.error).toBeTruthy();
    // 남의 파일을 우리가 덮어써 날리는 것이 가장 나쁜 결과다.
    expect(fs.readFileSync(codexHooksPath(), 'utf8')).toBe(broken);

    const removed = uninstallCodexHooks(HANDLER);
    expect(removed.error).toBeTruthy();
    expect(fs.readFileSync(codexHooksPath(), 'utf8')).toBe(broken);

    expect(getCodexHookState(HANDLER).error).toBeTruthy();
  });
});
