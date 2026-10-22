/**
 * §3.6 훅 인스톨러 — 중복 누적 차단 + 백업 회전 테스트.
 *
 * 회귀 방지 대상: 인스톨러가 표식(`_vibisualManaged`) 붙은 1장만 찾아 갱신하던 탓에,
 * 표식이 없던 판본이 깔아 둔 블록이 이벤트마다 그대로 남아 설치·판올림마다 한 장씩
 * 쌓였다(실측 ~/.claude/settings.json 이벤트당 8장 = 툴 1회 호출에 handler.mjs
 * 프로세스 8개, 백업 파일 88개). 남의 훅은 절대 건드리지 않는 것이 같은 무게의 조건이라
 * "줄었다" 뿐 아니라 "남길 것은 그대로 남았다"까지 검증한다.
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

// Cowork 세션 홈 열거는 실제 `%APPDATA%`(mac `~/Library/…`·linux `~/.config`)를 본다 — 걷기 시험이 이 PC 의 진짜
//   Cowork 설정을 건드리지 않게 임시 홈 목록으로 바꾼다(기본은 빈 목록 — 종전 시험은 호스트만 본다).
const fakeCowork = vi.hoisted(() => ({ homes: [] as Array<{ dir: string; source: 'cowork'; sessionDir: string; mtimeMs: number }> }));
vi.mock('./claudeConfigHomes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./claudeConfigHomes.js')>();
  return { ...actual, listCoworkConfigHomes: () => fakeCowork.homes };
});

const {
  buildVibisualBlocks,
  ensureClaudeHooksInstalled,
  ensureHooksInstalledEverywhere,
  removeClaudeHooks,
  removeHooksEverywhere,
  retireClaudeHooks,
  reensureHooksWhereChanged,
  areClaudeHooksRetired,
  __resetHookLifetimeForTest,
  __resetCoworkInstallLedgerForTest,
} = await import('./hookInstaller.js');

const PORT = 51360;
const TOKEN = 'test-token';
const HANDLER = 'C:/Programs/Vibisual/out/hooks/handler.mjs';

/** 표식 없던 판본이 깔던 블록 모양. */
function legacyBlock(port = PORT) {
  return {
    hooks: [
      { type: 'command', command: `node "${HANDLER}" --server "http://127.0.0.1:${port}" --token "old"` },
    ],
  };
}

/** 남의 훅 — 절대 지우면 안 되는 블록. */
function foreignBlock() {
  return { hooks: [{ type: 'command', command: 'python C:/tools/my_own_hook.py' }] };
}

function settingsPath() {
  return path.join(fakeHome, '.claude', 'settings.json');
}

function writeSettings(obj: unknown) {
  fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(obj, null, 2), 'utf-8');
}

/** 해당 이벤트의 블록 배열 — 없으면 빈 배열(테스트에서 optional 체이닝을 없애기 위함). */
function blocksOf(event: string): Record<string, unknown>[] {
  const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')) as {
    hooks?: Record<string, Record<string, unknown>[] | undefined>;
  };
  return parsed.hooks?.[event] ?? [];
}

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-hookinstall-'));
  process.env.__VIBI_FAKE_HOME__ = fakeHome;
  // 모듈 상태(걷음 표시·지문 장부·Cowork 장부)는 시험마다 비운다.
  __resetHookLifetimeForTest();
  __resetCoworkInstallLedgerForTest();
  fakeCowork.homes = [];
});

afterEach(() => {
  delete process.env.__VIBI_FAKE_HOME__;
  try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ─────────────────────────────────────────────────────────────
describe('표식 없는 옛 블록 청소', () => {
  it('이벤트당 옛 블록 7장이 쌓여 있어도 정상 블록 1장만 남긴다', () => {
    writeSettings({
      hooks: {
        PreToolUse: Array.from({ length: 7 }, () => legacyBlock()),
        PostToolUse: Array.from({ length: 7 }, () => legacyBlock()),
      },
    });

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.error).toBeUndefined();
    expect(r.installed).toBe(true);
    expect(r.prunedLegacy).toBe(14);

    expect(blocksOf('PreToolUse')).toHaveLength(1);
    expect(blocksOf('PostToolUse')).toHaveLength(1);
    expect(blocksOf('PreToolUse')[0]?.['_vibisualManaged']).toBe(true);
  });

  it('남의 훅은 그대로 남긴다', () => {
    writeSettings({ hooks: { PreToolUse: [foreignBlock(), legacyBlock(), foreignBlock()] } });

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.prunedLegacy).toBe(1);
    const arr = blocksOf('PreToolUse');
    // 남의 훅 2장 + 우리 정상 블록 1장
    expect(arr).toHaveLength(3);
    expect(JSON.stringify(arr)).toContain('my_own_hook.py');
  });

  it('두 번 연속 실행해도 블록이 늘지 않는다(누적 차단)', () => {
    writeSettings({ hooks: {} });

    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    const first = blocksOf('PreToolUse').length;
    const second = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(second.alreadyPresent).toBe(true);
    expect(second.prunedLegacy).toBe(0);
    expect(blocksOf('PreToolUse')).toHaveLength(first);
  });

  it('표식 붙은 블록은 포트가 달라져도 지우지 않고 갱신한다', () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          { _vibisualManaged: true, hooks: [{ type: 'command', command: `node "${HANDLER}" --server "http://127.0.0.1:1111" --token "old"` }] },
        ],
      },
    });

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.prunedLegacy).toBe(0);
    const arr = blocksOf('PreToolUse');
    expect(arr).toHaveLength(1);
    expect(JSON.stringify(arr[0])).toContain(`127.0.0.1:${PORT}`);
  });
});

// ─────────────────────────────────────────────────────────────
// 표식이 **지워진** 우리 블록 — settings.json 을 다른 쪽이 다시 쓰며 블록의 모르는 키(`_vibisualManaged`)를
// 떨어뜨리면 생긴다. command 블록은 위 서명으로 걷혔지만 HTTP 블록은 서명 검사가 command 전용이라
// 사용자 훅으로 남고, 부팅마다 표식 붙은 새 블록이 한 장씩 붙었다(실측 2026-10-15: HTTP 이벤트마다 7벌).
describe('표식이 지워진 블록 청소 — HTTP 훅 · Windows 인코딩 런처', () => {
  /** 표식만 떨어진 우리 HTTP 블록. */
  function strippedHttpBlock(port = PORT) {
    return {
      hooks: [{
        type: 'http',
        url: `http://127.0.0.1:${port}/api/hook-event`,
        timeout: 10,
        headers: { 'x-vibisual-hook-token': TOKEN, 'x-vibisual-owner-agent-id': '$VIBISUAL_OWNER_AGENT_ID' },
        allowedEnvVars: ['VIBISUAL_OWNER_AGENT_ID'],
      }],
    };
  }

  it('표식 없는 우리 HTTP 블록 6장 + 표식 블록 1장이 쌓여 있어도 1장만 남긴다', () => {
    writeSettings({
      hooks: {
        Notification: [
          ...Array.from({ length: 6 }, () => strippedHttpBlock()),
          { _vibisualManaged: true, ...strippedHttpBlock() },
        ],
      },
    });

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.prunedLegacy).toBe(6);
    const arr = blocksOf('Notification');
    expect(arr).toHaveLength(1);
    expect(arr[0]?.['_vibisualManaged']).toBe(true);
  });

  it('남의 HTTP 훅은 남긴다 — 주소가 다르거나 우리 토큰 헤더가 없으면 우리 것이 아니다', () => {
    const foreignUrl = { hooks: [{ type: 'http', url: 'http://127.0.0.1:9000/hooks', headers: { 'x-vibisual-hook-token': 'x' } }] };
    const foreignHeader = { hooks: [{ type: 'http', url: `http://127.0.0.1:${PORT}/api/hook-event`, headers: { authorization: 'Bearer y' } }] };
    writeSettings({ hooks: { Notification: [foreignUrl, strippedHttpBlock(), foreignHeader] } });

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.prunedLegacy).toBe(1);
    const json = JSON.stringify(blocksOf('Notification'));
    expect(json).toContain('http://127.0.0.1:9000/hooks');
    expect(json).toContain('Bearer y');
  });

  it('Node 없는 Windows 런처(-EncodedCommand)도 풀어서 서명을 본다', () => {
    const script = `$env:ELECTRON_RUN_AS_NODE='1'; & 'C:\\Vibisual\\Vibisual.exe' '${HANDLER}' '--server' 'http://127.0.0.1:${PORT}' '--token' 'old'; exit $LASTEXITCODE`;
    const encoded = {
      hooks: [{
        type: 'command',
        command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64')],
      }],
    };
    writeSettings({ hooks: { PreToolUse: [encoded, encoded, foreignBlock()] } });

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.prunedLegacy).toBe(2);
    const arr = blocksOf('PreToolUse');
    expect(arr).toHaveLength(2); // 남의 훅 1장 + 우리 정상 블록 1장
    expect(JSON.stringify(arr)).toContain('my_own_hook.py');
  });
});

// ─────────────────────────────────────────────────────────────
describe('백업 회전', () => {
  it('오래된 백업은 최신 5개만 남기고 지운다', () => {
    writeSettings({ hooks: {} });
    const dir = path.join(fakeHome, '.claude');
    for (let i = 0; i < 12; i += 1) {
      const f = path.join(dir, `settings.json.bak-vibisual-2026-01-01T00-00-${String(i).padStart(2, '0')}-000Z`);
      fs.writeFileSync(f, '{}', 'utf-8');
      fs.utimesSync(f, new Date(1000 + i * 1000), new Date(1000 + i * 1000));
    }

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    const left = fs.readdirSync(dir).filter((f) => f.includes('.bak-vibisual-'));
    expect(left).toHaveLength(5);
    // 이번 실행이 남긴 백업 1개 + 기존 중 최신 4개
    expect(r.prunedBackups).toBe(8);
  });

  it('바뀔 게 없는 실행에서도 쌓인 백업은 정리한다', () => {
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    const dir = path.join(fakeHome, '.claude');
    for (let i = 0; i < 9; i += 1) {
      fs.writeFileSync(path.join(dir, `settings.json.bak-vibisual-x${i}`), '{}', 'utf-8');
    }

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);

    expect(r.alreadyPresent).toBe(true);
    expect(r.prunedBackups).toBeGreaterThan(0);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.bak-vibisual-'))).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────
// SCENARIO §3.6 「수명」 · §5.7 #24-3 — 훅은 앱이 켜져 있는 동안만 둔다.
//   앱이 꺼진 뒤에도 남은 우리 훅이 이 PC 의 모든 Claude Code 세션에 오류 알림을 남겼다(실측 3주 668건 — 전부 HTTP 훅).
describe('앱이 켜져 있는 동안만 — 끌 때 걷고, 걷은 뒤 다시 안 깔고, 바뀐 홈만 다시 맞춘다', () => {
  function settingsOf(file = settingsPath()): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>;
  }

  /** Claude Code 가 settings.json 을 다시 쓰며 모르는 키(`_vibisualManaged`)를 떨어뜨린 우리 HTTP 블록. */
  function strippedHttp(port = PORT) {
    return { hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/api/hook-event`, headers: { 'x-vibisual-hook-token': TOKEN } }] };
  }

  it('이 포트의 우리 블록(표식·옛 서명·표식 잃은 HTTP)만 걷고, 남의 훅·다른 포트의 우리 블록·다른 설정은 남긴다', () => {
    const ours = buildVibisualBlocks('PostToolUse', PORT, HANDLER, TOKEN, 'http');
    const oursCommand = buildVibisualBlocks('Stop', PORT, HANDLER, TOKEN, 'command');
    const otherPort = buildVibisualBlocks('PostToolUse', PORT + 1, HANDLER, TOKEN, 'http');
    writeSettings({
      model: 'opus',
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: {
        PostToolUse: [foreignBlock(), ...ours, ...otherPort],
        Stop: [...oursCommand, legacyBlock(PORT)],
        Notification: [strippedHttp(PORT)],
      },
    });

    const r = removeClaudeHooks({ port: PORT });

    expect(r).toMatchObject({ removed: 4, written: true });
    const s = settingsOf();
    expect(s.model).toBe('opus');
    expect(s.permissions).toEqual({ allow: ['Bash(ls:*)'] });
    expect(blocksOf('PostToolUse')).toEqual([foreignBlock(), ...otherPort]);
    // 우리 것만 있던 이벤트는 키째 사라진다(깔기 전 모양으로).
    expect(Object.keys(s.hooks as object).sort()).toEqual(['PostToolUse']);
    // 직전 원본은 백업으로 남는다(§3.6 백업 규칙 그대로).
    expect(fs.readdirSync(path.join(fakeHome, '.claude')).some((f) => f.includes('.bak-vibisual-'))).toBe(true);
    // 두 번째는 걷을 것이 없어 파일을 쓰지 않는다.
    expect(removeClaudeHooks({ port: PORT })).toMatchObject({ removed: 0, written: false });
  });

  it('포트를 모르면 우리 블록 전부를 걷는다(제거기 — 앱이 사라지는 자리)', () => {
    const ours = buildVibisualBlocks('PostToolUse', PORT, HANDLER, TOKEN, 'http');
    const otherPort = buildVibisualBlocks('PostToolUse', PORT + 1, HANDLER, TOKEN, 'http');
    writeSettings({ hooks: { PostToolUse: [foreignBlock(), ...ours, ...otherPort] } });

    expect(removeClaudeHooks({ port: null }).removed).toBe(2);
    expect(blocksOf('PostToolUse')).toEqual([foreignBlock()]);
  });

  it('우리 블록만 있던 파일은 깔기 전 모양으로 돌아간다(`hooks` 키째)', () => {
    writeSettings({ theme: 'dark' });
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN, { transport: 'http', cliVersion: '2.1.300' });
    expect(Object.keys(settingsOf().hooks as object).length).toBeGreaterThan(20);

    removeClaudeHooks({ port: PORT });

    expect(settingsOf()).toEqual({ theme: 'dark' });
  });

  it('깨진 JSON 은 걷지 않고 그대로 둔다 · 파일이 없으면 폴더도 만들지 않는다', () => {
    fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
    fs.writeFileSync(settingsPath(), '{ broken', 'utf-8');
    const broken = removeClaudeHooks({ port: PORT });
    expect(broken.error).toBeInstanceOf(Error);
    expect(broken.written).toBe(false);
    expect(fs.readFileSync(settingsPath(), 'utf-8')).toBe('{ broken');

    const nowhere = path.join(fakeHome, 'nowhere', '.claude');
    expect(removeClaudeHooks({ port: PORT, settingsDir: nowhere })).toMatchObject({ removed: 0, written: false });
    expect(fs.existsSync(nowhere)).toBe(false);
  });

  it('걷은 뒤에는 같은 프로세스가 다시 깔지 않는다 — 종료 중 스윕·전송 승격이 되살리지 못하게', () => {
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    const all = retireClaudeHooks(PORT);
    expect(all.host.removed).toBeGreaterThan(0);
    expect(areClaudeHooksRetired()).toBe(true);

    const r = ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN, { transport: 'http', cliVersion: '2.1.300' });
    expect(r).toMatchObject({ skippedRetired: true, installed: false });

    // 그사이 다른 쪽이 파일을 다시 써도 지키기 스윕은 아무것도 하지 않는다.
    fs.writeFileSync(settingsPath(), JSON.stringify({ theme: 'light' }), 'utf-8');
    expect(reensureHooksWhereChanged(PORT, HANDLER, TOKEN)).toEqual({ checked: [], rewritten: [], hostChecked: false });
    expect(settingsOf()).toEqual({ theme: 'light' });
  });

  it('켜져 있는 동안 — 그대로면 아무것도 안 하고, 누가 우리 블록을 지우면 다음 스윕이 되살린다', () => {
    writeSettings({ theme: 'dark' });
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    expect(reensureHooksWhereChanged(PORT, HANDLER, TOKEN)).toEqual({ checked: [], rewritten: [], hostChecked: false });

    // Claude Code 가 설정을 다시 쓰며 우리 블록을 잃었다(사용자가 /hooks 에서 지운 것과 같다).
    const s = settingsOf();
    delete s.hooks;
    s.theme = 'light';
    fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf-8');

    const r = reensureHooksWhereChanged(PORT, HANDLER, TOKEN);
    expect(r.hostChecked).toBe(true);
    expect(r.rewritten).toEqual([path.join(fakeHome, '.claude')]);
    expect(blocksOf('Stop').some((b) => b._vibisualManaged === true)).toBe(true);
    expect(settingsOf().theme).toBe('light');
    // 맞춘 뒤에는 다시 조용하다.
    expect(reensureHooksWhereChanged(PORT, HANDLER, TOKEN).checked).toEqual([]);
  });

  it('Cowork 홈도 같은 수명 — 같이 걷고, 지워진 세션은 지키기가 되살리지 않는다', () => {
    const sessionDir = path.join(fakeHome, 'cowork', '0f8fad5b-d9cb-469f-a165-70867728950e');
    fs.mkdirSync(sessionDir, { recursive: true });
    const coworkDir = path.join(sessionDir, '.claude');
    fakeCowork.homes = [{ dir: coworkDir, source: 'cowork', sessionDir, mtimeMs: 0 }];

    ensureHooksInstalledEverywhere(PORT, HANDLER, TOKEN);
    expect(fs.existsSync(path.join(coworkDir, 'settings.json'))).toBe(true);

    const all = removeHooksEverywhere(PORT);
    expect(all.host.removed).toBeGreaterThan(0);
    expect(all.cowork).toHaveLength(1);
    expect(all.cowork[0]!.removed).toBeGreaterThan(0);

    // 다시 깐 뒤 그 세션이 지워지면(Claude Desktop 이 대화를 치웠다) 스윕이 빈 껍데기를 만들지 않는다.
    ensureHooksInstalledEverywhere(PORT, HANDLER, TOKEN);
    fs.rmSync(sessionDir, { recursive: true, force: true });
    const r = reensureHooksWhereChanged(PORT, HANDLER, TOKEN);
    expect(r.checked).not.toContain(coworkDir);
    expect(fs.existsSync(coworkDir)).toBe(false);
  });
});
