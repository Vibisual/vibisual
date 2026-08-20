/**
 * §5.5 #17-32 — 훅 인벤토리 층 테스트.
 *
 * 이 층이 지켜야 하는 것: ① 네 범위를 빠짐없이 세운다, ② 명령 하나가 한 줄이다(블록에 명령이
 * 여럿이면 줄도 여럿), ③ Vibisual 자신의 블록과 관리자 정책은 **끌 수 없다**, ④ 끄기는
 * 지우기가 아니라 **같은 블록 안 이동**이라 되돌리면 원문이 그대로 돌아온다, ⑤ 남의 훅은
 * 한 바이트도 건드리지 않는다.
 *
 * ⚠ `os.homedir()` 를 반드시 가짜 홈으로 갈아 끼운다 — 안 그러면 테스트가 **사용자의 진짜
 *   `~/.claude/settings.json`** 을 고쳐 쓴다(#17-31 테스트가 같은 자리에 남긴 경고).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let fakeHome = '';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  // 서비스는 `import os from 'node:os'` 라 **default 쪽**을 갈아 끼워야 한다.
  return { ...actual, homedir: (): string => fakeHome, default: { ...actual, homedir: (): string => fakeHome } };
});

const { scanHookInventory, setHookEnabled } = await import('./hookInventoryService.js');

let projectPath = '';

function userSettingsPath(): string {
  return path.join(fakeHome, '.claude', 'settings.json');
}

function projectSettingsPath(): string {
  return path.join(projectPath, '.claude', 'settings.json');
}

function writeSettings(file: string, body: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(body, null, 2), 'utf8');
}

function readSettings(file: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, any>;
}

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-hooks-'));
  fakeHome = path.join(base, 'home');
  projectPath = path.join(base, 'project');
  fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scanHookInventory', () => {
  it('글로벌·프로젝트·로컬을 한 목록에 범위를 붙여 세운다', () => {
    writeSettings(userSettingsPath(), {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo global' }] }] },
    });
    writeSettings(projectSettingsPath(), {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo project' }] }] },
    });
    writeSettings(path.join(projectPath, '.claude', 'settings.local.json'), {
      hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'echo local' }] }] },
    });

    const inv = scanHookInventory(projectPath);

    expect(inv.hooks).toHaveLength(3);
    expect(inv.hooks.find((h) => h.command === 'echo global')?.scope).toBe('user');
    expect(inv.hooks.find((h) => h.command === 'echo project')?.scope).toBe('project');
    expect(inv.hooks.find((h) => h.command === 'echo local')?.scope).toBe('local');
    // 어디를 봤는지 — 없는 파일은 담지 않는다.
    expect(inv.scanned).toContain(userSettingsPath());
  });

  it('블록에 명령이 여럿이면 줄도 여럿이다(② 명령 하나가 한 줄)', () => {
    writeSettings(userSettingsPath(), {
      hooks: {
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'echo one' },
            { type: 'command', command: 'echo two' },
          ],
        }],
      },
    });

    const inv = scanHookInventory(projectPath);
    expect(inv.hooks.map((h) => h.command)).toEqual(['echo one', 'echo two']);
    // 같은 블록에서 왔으니 이벤트·matcher 는 같고, id 는 명령 지문으로 갈린다.
    expect(new Set(inv.hooks.map((h) => h.id)).size).toBe(2);
    expect(inv.hooks.every((h) => h.matcher === 'Bash')).toBe(true);
  });

  it('matcher·timeout 을 원문 그대로 싣고, 없으면 빈 문자열로 둔다', () => {
    writeSettings(userSettingsPath(), {
      hooks: {
        PreToolUse: [
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'echo m', timeout: 30 }] },
          { hooks: [{ type: 'command', command: 'echo nomatcher' }] },
        ],
      },
    });

    const inv = scanHookInventory(projectPath);
    const withMatcher = inv.hooks.find((h) => h.command === 'echo m');
    expect(withMatcher?.matcher).toBe('Edit|Write');
    expect(withMatcher?.timeout).toBe(30);
    expect(inv.hooks.find((h) => h.command === 'echo nomatcher')?.matcher).toBe('');
  });

  it('Vibisual 자신의 블록은 보이되 끌 수 없다(③)', () => {
    writeSettings(userSettingsPath(), {
      hooks: {
        Stop: [{ _vibisualManaged: true, hooks: [{ type: 'command', command: 'node handler.mjs' }] }],
      },
    });

    const entry = scanHookInventory(projectPath).hooks[0];
    expect(entry?.enabled).toBe(true);
    expect(entry?.toggleable).toBe(false);
    expect(entry?.lockReason).toBe('vibisual');
  });

  it('명령이 비어 있는 칸은 줄을 세우지 않는다', () => {
    writeSettings(userSettingsPath(), {
      hooks: { Stop: [{ hooks: [{ type: 'command' }, { type: 'command', command: '   ' }] }] },
    });
    expect(scanHookInventory(projectPath).hooks).toHaveLength(0);
  });

  it('꺼 둔 명령도 목록에 남는다 — 사라지면 지워진 줄 안다(④)', () => {
    writeSettings(userSettingsPath(), {
      hooks: {
        Stop: [{
          hooks: [],
          _vibisualDisabled: [{ type: 'command', command: 'echo off' }],
        }],
      },
    });

    const entry = scanHookInventory(projectPath).hooks[0];
    expect(entry?.command).toBe('echo off');
    expect(entry?.enabled).toBe(false);
    expect(entry?.toggleable).toBe(true);
  });

  it('설정 파일이 깨져 있어도 던지지 않고 그 파일만 건너뛴다', () => {
    fs.writeFileSync(userSettingsPath(), '{ this is not json', 'utf8');
    writeSettings(projectSettingsPath(), {
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo ok' }] }] },
    });

    const inv = scanHookInventory(projectPath);
    expect(inv.hooks.map((h) => h.command)).toEqual(['echo ok']);
  });
});

describe('setHookEnabled', () => {
  beforeEach(() => {
    writeSettings(userSettingsPath(), {
      // 우리 것이 아닌 남의 설정 — 한 바이트도 안 바뀌어야 한다(⑤).
      model: 'opusplan',
      hooks: {
        PreToolUse: [{
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'echo target', timeout: 5 },
            { type: 'command', command: 'echo bystander' },
          ],
        }],
      },
    });
  });

  it('끄면 지우지 않고 같은 블록 안으로 옮긴다(④)', () => {
    const res = setHookEnabled(projectPath, 'user', 'PreToolUse', 'Bash', 'echo target', false);
    expect(res.ok).toBe(true);

    const block = readSettings(userSettingsPath()).hooks.PreToolUse[0];
    expect(block.hooks.map((h: any) => h.command)).toEqual(['echo bystander']);
    // 원문이 옆자리에 그대로 — 필드까지 보존된다.
    expect(block._vibisualDisabled).toEqual([{ type: 'command', command: 'echo target', timeout: 5 }]);
  });

  it('되돌리면 원문이 그대로 돌아오고 우리 흔적은 사라진다', () => {
    setHookEnabled(projectPath, 'user', 'PreToolUse', 'Bash', 'echo target', false);
    const res = setHookEnabled(projectPath, 'user', 'PreToolUse', 'Bash', 'echo target', true);
    expect(res.ok).toBe(true);

    const block = readSettings(userSettingsPath()).hooks.PreToolUse[0];
    expect(block.hooks).toContainEqual({ type: 'command', command: 'echo target', timeout: 5 });
    // 되살릴 것이 없으면 우리 키는 남기지 않는다.
    expect(block._vibisualDisabled).toBeUndefined();
  });

  it('남의 설정과 옆 훅은 건드리지 않는다(⑤)', () => {
    setHookEnabled(projectPath, 'user', 'PreToolUse', 'Bash', 'echo target', false);
    const root = readSettings(userSettingsPath());
    expect(root.model).toBe('opusplan');
    expect(root.hooks.PreToolUse[0].matcher).toBe('Bash');
    expect(root.hooks.PreToolUse[0].hooks).toContainEqual({ type: 'command', command: 'echo bystander' });
  });

  it('Vibisual 자신의 블록은 끄지 않는다(③)', () => {
    writeSettings(userSettingsPath(), {
      hooks: { Stop: [{ _vibisualManaged: true, hooks: [{ type: 'command', command: 'node handler.mjs' }] }] },
    });
    const res = setHookEnabled(projectPath, 'user', 'Stop', '', 'node handler.mjs', false);
    expect(res.ok).toBe(false);
    // 파일은 그대로다.
    expect(readSettings(userSettingsPath()).hooks.Stop[0].hooks).toHaveLength(1);
  });

  it('관리자 정책은 읽기 전용이다(③)', () => {
    const res = setHookEnabled(projectPath, 'managed', 'Stop', '', 'anything', false);
    expect(res.ok).toBe(false);
  });

  it('없는 훅·없는 이벤트는 쓰지 않고 이유를 돌려준다', () => {
    const before = fs.readFileSync(userSettingsPath(), 'utf8');
    expect(setHookEnabled(projectPath, 'user', 'PreToolUse', 'Bash', 'echo nope', false).ok).toBe(false);
    expect(setHookEnabled(projectPath, 'user', 'NoSuchEvent', '', 'echo target', false).ok).toBe(false);
    // matcher 가 다르면 다른 줄이다 — 엉뚱한 블록을 건드리지 않는다.
    expect(setHookEnabled(projectPath, 'user', 'PreToolUse', 'Write', 'echo target', false).ok).toBe(false);
    expect(fs.readFileSync(userSettingsPath(), 'utf8')).toBe(before);
  });

  it('파일이 깨져 있으면 쓰지 않는다 — 남의 설정을 망가뜨리지 않는다', () => {
    fs.writeFileSync(userSettingsPath(), '{ broken', 'utf8');
    const res = setHookEnabled(projectPath, 'user', 'PreToolUse', 'Bash', 'echo target', false);
    expect(res.ok).toBe(false);
    expect(fs.readFileSync(userSettingsPath(), 'utf8')).toBe('{ broken');
  });

  it('끄고 켠 뒤 인벤토리가 상태를 그대로 비춘다(왕복)', () => {
    setHookEnabled(projectPath, 'user', 'PreToolUse', 'Bash', 'echo target', false);
    let inv = scanHookInventory(projectPath);
    expect(inv.hooks.find((h) => h.command === 'echo target')?.enabled).toBe(false);
    expect(inv.hooks.find((h) => h.command === 'echo bystander')?.enabled).toBe(true);

    setHookEnabled(projectPath, 'user', 'PreToolUse', 'Bash', 'echo target', true);
    inv = scanHookInventory(projectPath);
    expect(inv.hooks.find((h) => h.command === 'echo target')?.enabled).toBe(true);
    // id 는 명령 지문이라 왕복해도 같은 줄로 남는다(화면의 선택·불이 튀지 않는다).
    expect(inv.hooks.filter((h) => h.command === 'echo target')).toHaveLength(1);
  });
});
