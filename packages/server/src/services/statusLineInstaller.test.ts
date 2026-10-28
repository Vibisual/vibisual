/**
 * §4 statusLine 인스톨러 시험 — CLI 가 settings.json 을 다시 쓰면 마커(`_vibisualManaged`·`_vibisualPrevStatusLine`)가 사라진다(실측).
 * 마커 없이도 우리 것을 알아보는가 · 우리 명령을 사용자 원본으로 보관하지 않는가(자기 passthrough 무한 사슬) · 남의 statusLine 보존·복원.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fakeHome: string;

// os.homedir() 만 임시 폴더로 돌린다 — 실제 ~/.claude 를 건드리지 않기 위함.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => process.env.__VIBI_FAKE_HOME__ ?? actual.homedir() } };
});

const { readUsageCollectorStatus, installStatusLine, uninstallStatusLine, refreshStatusLineIfInstalled } =
  await import('./statusLineInstaller.js');

const PORT = 51360;
const TOKEN = 'test-token';
const HANDLER = 'C:/Programs/Vibisual/out/hooks/handler.mjs';

/** 인스톨러가 조립하는 것과 같은 모양의 우리 명령. */
function ourCommand(port = PORT, token = TOKEN): string {
  return `node "${HANDLER}" --statusline --server "http://127.0.0.1:${port}" --token "${token}"`;
}

function ourSubagentCommand(port = PORT, token = TOKEN): string {
  return `node "${HANDLER}" --subagent-statusline --server "http://127.0.0.1:${port}" --token "${token}"`;
}

function settingsPath(): string {
  return path.join(fakeHome, '.claude', 'settings.json');
}

function writeSettings(obj: unknown): void {
  fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(obj, null, 2), 'utf-8');
}

function readSettings(): Record<string, Record<string, unknown> | undefined> {
  return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')) as Record<string, Record<string, unknown> | undefined>;
}

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-statusline-'));
  process.env.__VIBI_FAKE_HOME__ = fakeHome;
});

afterEach(() => {
  delete process.env.__VIBI_FAKE_HOME__;
  try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ─────────────────────────────────────────────────────────────
describe('마커가 지워진 뒤에도 우리 수집기를 알아본다', () => {
  it('`type`·`command` 만 남아도 installed=true 로 읽는다', () => {
    writeSettings({ statusLine: { type: 'command', command: ourCommand() } });

    const status = readUsageCollectorStatus();

    expect(status.installed).toBe(true);
    // 우리 명령을 남의 것으로 세지 않는다 — 이게 true 면 화면에 "다른 statusLine 이 있다" 경고가 뜬다.
    expect(status.foreign).toBe(false);
    expect(status.passthroughCommand).toBeUndefined();
  });

  it('부팅 갱신이 마커 유실을 자가 치유한다(포트·토큰이 이번 런으로 갱신)', () => {
    writeSettings({ statusLine: { type: 'command', command: ourCommand(40000, 'stale') } });

    const status = refreshStatusLineIfInstalled(PORT, HANDLER, TOKEN);

    expect(status.installed).toBe(true);
    const sl = readSettings()['statusLine'];
    expect(sl?.['_vibisualManaged']).toBe(true);
    expect(String(sl?.['command'])).toContain(`http://127.0.0.1:${PORT}`);
    expect(String(sl?.['command'])).toContain(TOKEN);
    // 옛 명령을 "사용자 원본" 으로 끌어안지 않는다.
    expect(sl?.['_vibisualPrevStatusLine']).toBeUndefined();
  });
});

describe('우리 명령을 passthrough 로 보관하지 않는다(무한 재귀 차단)', () => {
  it('마커 없는 우리 명령 위에 다시 설치해도 prev 가 생기지 않는다', () => {
    writeSettings({ statusLine: { type: 'command', command: ourCommand(40000, 'stale') } });

    installStatusLine(PORT, HANDLER, TOKEN);

    const sl = readSettings()['statusLine'];
    expect(sl?.['_vibisualPrevStatusLine']).toBeUndefined();
    expect(sl?.['_vibisualManaged']).toBe(true);
  });

  it('이미 자기 자신을 감싸고 있는 파일을 만나면 그 자리에서 풀어낸다', () => {
    writeSettings({
      statusLine: {
        type: 'command',
        command: ourCommand(),
        _vibisualManaged: true,
        _vibisualPrevStatusLine: { type: 'command', command: ourCommand() },
      },
    });

    // 조회만 해도 자기 감쌈은 passthrough 로 세지 않는다.
    expect(readUsageCollectorStatus().passthroughCommand).toBeUndefined();

    installStatusLine(PORT, HANDLER, TOKEN);

    expect(readSettings()['statusLine']?.['_vibisualPrevStatusLine']).toBeUndefined();
  });

  it('자기 감쌈이 여러 겹이어도 안쪽의 진짜 사용자 명령을 살려낸다', () => {
    writeSettings({
      statusLine: {
        type: 'command',
        command: ourCommand(),
        _vibisualPrevStatusLine: {
          type: 'command',
          command: ourCommand(40000, 'stale'),
          _vibisualPrevStatusLine: { type: 'command', command: 'starship prompt' },
        },
      },
    });

    installStatusLine(PORT, HANDLER, TOKEN);

    const sl = readSettings()['statusLine'];
    expect(sl?.['_vibisualPrevStatusLine']).toEqual({ type: 'command', command: 'starship prompt' });
    expect(readUsageCollectorStatus().passthroughCommand).toBe('starship prompt');
  });
});

describe('남의 statusLine 은 그대로 보존·복원한다(기존 계약)', () => {
  it('설치하면 사용자 명령이 prev 로 보관되고, 해제하면 그 자리에 되돌아온다', () => {
    const foreign = { type: 'command', command: 'starship prompt', padding: 0 };
    writeSettings({ statusLine: foreign });

    const installed = installStatusLine(PORT, HANDLER, TOKEN);
    expect(installed.installed).toBe(true);
    expect(installed.foreign).toBe(true);
    expect(installed.passthroughCommand).toBe('starship prompt');
    expect(readSettings()['statusLine']?.['_vibisualPrevStatusLine']).toEqual(foreign);

    const removed = uninstallStatusLine();
    expect(removed.installed).toBe(false);
    expect(readSettings()['statusLine']).toEqual(foreign);
  });

  it('보관할 사용자 명령이 없으면 해제 시 키 자체가 사라진다', () => {
    writeSettings({ statusLine: { type: 'command', command: ourCommand() } });

    uninstallStatusLine();

    expect(readSettings()['statusLine']).toBeUndefined();
    expect(readSettings()['subagentStatusLine']).toBeUndefined();
  });
});

describe('수집기 핸들러가 실제로 서버에 닿는 URL 을 만든다', () => {
  // SERVER_URL 은 이미 `…/api/hook-event` 라 그 위에 경로를 붙이면 전량 404 다(실측) — 다른 라우트는 BASE 에서 조립한다.
  const handlerSource = fs.readFileSync(new URL('../../../../hooks/handler.mjs', import.meta.url), 'utf-8');

  it('훅 이벤트 URL 위에 다른 경로를 덧붙여 호출하지 않는다', () => {
    expect(handlerSource).not.toContain('fetch(`${SERVER_URL}/api/');
  });

  it('서브에이전트 수집기 URL 이 BASE 에서 조립된다', () => {
    expect(handlerSource).toContain('const SUBAGENT_STATUSLINE_URL = `${BASE}/api/subagent-statusline`;');
  });

  it('보관된 명령이 우리 자신이면 passthrough 로 실행하지 않는다(재귀 차단)', () => {
    expect(handlerSource).toContain('isOwnStatusLineCommand(prev.command)');
  });
});

describe('subagentStatusLine 도 같은 규칙을 따른다', () => {
  it('마커 없는 우리 서브에이전트 명령을 사용자 원본으로 오인하지 않는다', () => {
    writeSettings({
      statusLine: { type: 'command', command: ourCommand(40000, 'stale') },
      subagentStatusLine: { type: 'command', command: ourSubagentCommand(40000, 'stale') },
    });

    installStatusLine(PORT, HANDLER, TOKEN);

    const sub = readSettings()['subagentStatusLine'];
    expect(sub?.['_vibisualManaged']).toBe(true);
    expect(sub?.['_vibisualPrevStatusLine']).toBeUndefined();
    expect(String(sub?.['command'])).toContain(`http://127.0.0.1:${PORT}`);
  });

  it('마커가 지워진 서브에이전트 명령도 해제 때 함께 걷어낸다', () => {
    writeSettings({
      statusLine: { type: 'command', command: ourCommand() },
      subagentStatusLine: { type: 'command', command: ourSubagentCommand() },
    });

    uninstallStatusLine();

    expect(readSettings()['subagentStatusLine']).toBeUndefined();
  });
});
