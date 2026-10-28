/**
 * §3.6 「수명」 · §5.7 #24-3 — 앱이 켜진 동안만 훅을 둔다. 상태 줄: 끌 때 복원 · 켤 때 켬 값(AppState)대로(값이 없으면 settings.json 으로 옮겨 적는다).
 * 코덱스 전역 훅: 끌 때 이 앱 것만 걷고 켤 때 켬 값대로(신뢰 재질문 감수 · 홈이 없거나 끄는 중이면 안 깐다). 켜진 동안 호스트가 바뀌면 상태 줄 재감싸기. 실제 홈·상태 파일은 mock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let fakeHome: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => process.env.__VIBI_FAKE_HOME__ ?? actual.homedir() } };
});

// AppState 는 모듈을 읽을 때 진짜 홈의 `~/.vibisual/app-state.json` 경로를 잡는다 — 메모리로 바꾼다.
const appState = vi.hoisted(() => ({
  usageCollector: undefined as boolean | undefined,
  codexHooks: undefined as boolean | undefined,
}));
vi.mock('./appState.js', () => ({
  appStateGetUsageCollector: () => appState.usageCollector,
  appStateSetUsageCollector: (v: boolean) => { appState.usageCollector = v; },
  appStateGetCodexHooks: () => appState.codexHooks,
  appStateSetCodexHooks: (v: boolean) => { appState.codexHooks = v; },
}));

// Cowork 홈 열거는 실제 `%APPDATA%` 를 본다 — 이 시험에서는 호스트만.
vi.mock('./claudeConfigHomes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./claudeConfigHomes.js')>();
  return { ...actual, listCoworkConfigHomes: () => [] };
});

// 코덱스 홈은 `CODEX_HOME` 이 있으면 그쪽을 본다 — 진짜 파일을 건드리지 않게 상태만 흉내 낸다
//   (hooks.json 을 실제로 쓰고 읽는 쪽은 `codexHookInstaller.test.ts` 가 고정한다).
const codex = vi.hoisted(() => ({
  installed: false,
  homeExists: true,
  readError: undefined as string | undefined,
  failInstall: false,
  installedWith: [] as Array<{ handlerPath: string; port: number; token: string }>,
  uninstalledWith: [] as string[],
}));
vi.mock('./codexHookInstaller.js', () => {
  const stateOf = (installed: boolean, error?: string) => ({
    installed,
    hooksPath: 'codex/hooks.json',
    events: installed ? ['SessionStart', 'PreToolUse'] : [],
    checkedAt: 0,
    ...(error ? { error } : {}),
  });
  return {
    codexHomeExists: () => codex.homeExists,
    getCodexHookState: (handlerPath: string | null) =>
      (codex.readError ? stateOf(false, codex.readError) : stateOf(handlerPath ? codex.installed : false)),
    installCodexHooks: (handlerPath: string, port: number, token: string) => {
      codex.installedWith.push({ handlerPath, port, token });
      if (codex.failInstall) return stateOf(false, 'write failed: EACCES');
      codex.installed = true;
      return stateOf(true);
    },
    uninstallCodexHooks: (handlerPath: string) => {
      codex.uninstalledWith.push(handlerPath);
      codex.installed = false;
      return stateOf(false);
    },
  };
});

const { __resetHookLifetimeForTest, __resetCoworkInstallLedgerForTest, ensureClaudeHooksInstalled } = await import('./hookInstaller.js');
const { installStatusLine, readUsageCollectorStatus } = await import('./statusLineInstaller.js');
const {
  keepVibisualHooksInPlace,
  removeVibisualHooksForUninstall,
  retireVibisualHooks,
  setCodexHooksEnabled,
  setUsageCollectorEnabled,
  syncCodexHooksAtBoot,
  syncUsageCollectorAtBoot,
} = await import('./hookLifetime.js');

const PORT = 51360;
const TOKEN = 'test-token';
const HANDLER = 'C:/Programs/Vibisual/out/hooks/handler.mjs';
const TARGET = { port: PORT, handlerPath: HANDLER, token: TOKEN };
const USER_STATUS_LINE = { type: 'command', command: 'bash ~/.claude/my-statusline.sh' };

const settingsFile = (): string => path.join(fakeHome, '.claude', 'settings.json');
function writeSettings(obj: unknown): void {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(obj, null, 2), 'utf-8');
}
const settingsOf = (): Record<string, unknown> => JSON.parse(fs.readFileSync(settingsFile(), 'utf-8')) as Record<string, unknown>;

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-hooklifetime-'));
  process.env.__VIBI_FAKE_HOME__ = fakeHome;
  __resetHookLifetimeForTest();
  __resetCoworkInstallLedgerForTest();
  appState.usageCollector = undefined;
  appState.codexHooks = undefined;
  codex.installed = false;
  codex.homeExists = true;
  codex.readError = undefined;
  codex.failInstall = false;
  codex.installedWith = [];
  codex.uninstalledWith = [];
});

afterEach(() => {
  delete process.env.__VIBI_FAKE_HOME__;
  try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('사용량 수집기 상태 줄 — 끌 때 되돌리고 켤 때 다시 감싼다', () => {
  it('첫 부팅 — 켬 값이 없으면 지금 깔려 있는지로 옮겨 적는다(종전 사용자의 켬이 이어진다)', () => {
    writeSettings({ statusLine: USER_STATUS_LINE });
    installStatusLine(PORT, HANDLER, TOKEN); // 종전 판에서 켜 둔 사용자
    appState.usageCollector = undefined;

    const status = syncUsageCollectorAtBoot(PORT, HANDLER, TOKEN);

    expect(appState.usageCollector).toBe(true);
    expect(status.installed).toBe(true);
    expect(status.passthroughCommand).toBe(USER_STATUS_LINE.command);
  });

  it('첫 부팅 — 깔려 있지 않았으면 끔으로 적고 아무것도 쓰지 않는다', () => {
    writeSettings({ statusLine: USER_STATUS_LINE });
    const before = fs.readFileSync(settingsFile(), 'utf-8');

    const status = syncUsageCollectorAtBoot(PORT, HANDLER, TOKEN);

    expect(appState.usageCollector).toBe(false);
    expect(status.installed).toBe(false);
    expect(fs.readFileSync(settingsFile(), 'utf-8')).toBe(before);
  });

  it('끌 때 원래 상태 줄로 되돌리고 켬 값은 그대로 — 다음 부팅이 다시 감싼다', () => {
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    writeSettings({ ...settingsOf(), statusLine: USER_STATUS_LINE });
    setUsageCollectorEnabled(true, TARGET);
    expect(readUsageCollectorStatus().installed).toBe(true);

    const s = retireVibisualHooks(PORT, HANDLER);

    expect(s.statusLineRestored).toBe(true);
    expect(s.removed).toBeGreaterThan(0);
    expect(settingsOf().statusLine).toEqual(USER_STATUS_LINE);
    expect(settingsOf().hooks).toBeUndefined();
    expect(appState.usageCollector).toBe(true);

    // 다음 실행 — 켬이므로 다시 감싼다(사용자 원본은 그대로 보관된다).
    __resetHookLifetimeForTest();
    const again = syncUsageCollectorAtBoot(PORT, HANDLER, TOKEN);
    expect(again.installed).toBe(true);
    expect(again.passthroughCommand).toBe(USER_STATUS_LINE.command);
  });

  it('사용자 상태 줄이 없었으면 끌 때 키째 지운다', () => {
    writeSettings({ theme: 'dark' });
    setUsageCollectorEnabled(true, TARGET);

    retireVibisualHooks(PORT, HANDLER);

    expect(settingsOf().statusLine).toBeUndefined();
    expect(settingsOf().theme).toBe('dark');
  });

  it('팝업에서 끄면 끔으로 적고 걷는다 — 켬이 아닌데 남아 있으면 부팅이 걷는다', () => {
    writeSettings({ statusLine: USER_STATUS_LINE });
    setUsageCollectorEnabled(true, TARGET);
    expect(appState.usageCollector).toBe(true);

    const off = setUsageCollectorEnabled(false, null);
    expect(appState.usageCollector).toBe(false);
    expect(off.installed).toBe(false);
    expect(settingsOf().statusLine).toEqual(USER_STATUS_LINE);

    // 팅긴 사이 누가 다시 깔아 둔 경우 — 켬이 아니면 부팅이 걷는다.
    installStatusLine(PORT, HANDLER, TOKEN);
    expect(syncUsageCollectorAtBoot(PORT, HANDLER, TOKEN).installed).toBe(false);
    expect(settingsOf().statusLine).toEqual(USER_STATUS_LINE);
  });

  it('리스너가 아직 없으면 켜지 않는다(켬으로 적지도 않는다)', () => {
    const status = setUsageCollectorEnabled(true, null);
    expect(status.error).toBeTruthy();
    expect(appState.usageCollector).toBeUndefined();
  });

  it('끄는 중(걷은 뒤)에는 팝업의 켜기가 깔지 않는다 — 걷은 상태 줄이 종료 뒤에 남지 않게', () => {
    writeSettings({ statusLine: USER_STATUS_LINE });
    retireVibisualHooks(PORT, HANDLER);

    const status = setUsageCollectorEnabled(true, TARGET);

    expect(status.error).toBeTruthy();
    expect(status.installed).toBe(false);
    expect(appState.usageCollector).toBeUndefined();
    expect(settingsOf().statusLine).toEqual(USER_STATUS_LINE);
  });
});

describe('코덱스 전역 훅 — 끌 때 걷고 켤 때 다시 깐다', () => {
  it('끌 때 이 앱의 handler 경로로 걷고, 켬 값은 그대로 둔다', () => {
    appState.codexHooks = true;
    codex.installed = true;

    const s = retireVibisualHooks(PORT, HANDLER);

    expect(s.codexRemoved).toBe(true);
    expect(codex.uninstalledWith).toEqual([HANDLER]);
    expect(appState.codexHooks).toBe(true);
    expect(s.errors).toEqual([]);
  });

  it('깔려 있지 않으면 쓰지 않는다 · handler 경로를 모르면 코덱스는 건드리지 않는다', () => {
    expect(retireVibisualHooks(PORT, HANDLER).codexRemoved).toBe(false);
    __resetHookLifetimeForTest();
    codex.installed = true;
    expect(retireVibisualHooks(PORT, null).codexRemoved).toBe(false);
    expect(codex.uninstalledWith).toEqual([]);
  });

  it('hooks.json 을 못 읽으면 손대지 않고 진단에 남긴다', () => {
    codex.installed = true;
    codex.readError = 'hooks file unreadable: Unexpected token';

    const s = retireVibisualHooks(PORT, HANDLER);

    expect(s.codexRemoved).toBe(false);
    expect(codex.uninstalledWith).toEqual([]);
    expect(s.errors.some((e) => e.startsWith('codex hooks:'))).toBe(true);
  });

  it('끈 뒤 다음 부팅 — 켬이면 이번 실행의 포트·토큰으로 다시 깐다', () => {
    appState.codexHooks = true;
    codex.installed = true;
    retireVibisualHooks(PORT, HANDLER);
    expect(codex.installed).toBe(false);

    __resetHookLifetimeForTest();
    const state = syncCodexHooksAtBoot(PORT + 1, HANDLER, 'next-token');

    expect(state.installed).toBe(true);
    expect(codex.installedWith).toEqual([{ handlerPath: HANDLER, port: PORT + 1, token: 'next-token' }]);
  });

  it('첫 부팅 — 켬 값이 없으면 깔려 있는지로 옮겨 적는다(종전 판에서 켠 사람은 켬이 이어진다)', () => {
    codex.installed = true; // 종전 판은 끌 때 걷지 않았다 — 깔려 있는 것이 곧 켬

    syncCodexHooksAtBoot(PORT, HANDLER, TOKEN);

    expect(appState.codexHooks).toBe(true);
    expect(codex.installedWith).toHaveLength(1);
  });

  it('첫 부팅 — 깔려 있지 않았으면 끔으로 적고 아무것도 쓰지 않는다(기본 꺼짐)', () => {
    const state = syncCodexHooksAtBoot(PORT, HANDLER, TOKEN);

    expect(appState.codexHooks).toBe(false);
    expect(state.installed).toBe(false);
    expect(codex.installedWith).toEqual([]);
    expect(codex.uninstalledWith).toEqual([]);
  });

  it('켬이 아닌데 남아 있으면 부팅이 걷는다', () => {
    appState.codexHooks = false;
    codex.installed = true;

    const state = syncCodexHooksAtBoot(PORT, HANDLER, TOKEN);

    expect(state.installed).toBe(false);
    expect(codex.uninstalledWith).toEqual([HANDLER]);
  });

  it('코덱스 홈이 없으면 켬이어도 깔지 않는다 — 지운 코덱스의 홈을 되살리지 않고 켬 값은 남긴다', () => {
    appState.codexHooks = true;
    codex.homeExists = false;

    const state = syncCodexHooksAtBoot(PORT, HANDLER, TOKEN);

    expect(state.installed).toBe(false);
    expect(codex.installedWith).toEqual([]);
    expect(appState.codexHooks).toBe(true);
  });

  it('hooks.json 을 못 읽으면 부팅이 아무것도 바꾸지 않는다(켬 값도 옮겨 적지 않는다)', () => {
    codex.readError = 'hooks file unreadable: Unexpected token';

    const state = syncCodexHooksAtBoot(PORT, HANDLER, TOKEN);

    expect(state.error).toBeTruthy();
    expect(appState.codexHooks).toBeUndefined();
    expect(codex.installedWith).toEqual([]);
    expect(codex.uninstalledWith).toEqual([]);
  });

  it('옵션의 켜기·끄기가 켬 값을 함께 적는다 — 켜기는 실제로 깔렸을 때만', () => {
    expect(setCodexHooksEnabled(true, TARGET).installed).toBe(true);
    expect(appState.codexHooks).toBe(true);

    expect(setCodexHooksEnabled(false, TARGET).installed).toBe(false);
    expect(appState.codexHooks).toBe(false);
    expect(codex.uninstalledWith).toEqual([HANDLER]);

    codex.failInstall = true;
    const failed = setCodexHooksEnabled(true, TARGET);
    expect(failed.error).toBeTruthy();
    expect(appState.codexHooks).toBe(false);
  });

  it('끄는 중(걷은 뒤)에는 켜기가 깔지 않는다 — 걷은 훅이 종료 뒤에 남지 않게', () => {
    retireVibisualHooks(PORT, HANDLER);

    const state = setCodexHooksEnabled(true, TARGET);

    expect(state.error).toBeTruthy();
    expect(codex.installedWith).toEqual([]);
    expect(appState.codexHooks).toBeUndefined();
  });

  it('제거기는 클로드 훅·상태 줄·코덱스 전역 훅을 끌 때와 같은 규칙으로 걷는다', () => {
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    codex.installed = true;

    const s = removeVibisualHooksForUninstall(PORT, HANDLER);

    expect(s.codexRemoved).toBe(true);
    expect(codex.uninstalledWith).toEqual([HANDLER]);
    expect(settingsOf().hooks).toBeUndefined();
  });
});

describe('켜져 있는 동안 지킨다 — 상태 줄까지', () => {
  it('호스트 설정이 바뀌었고 켬이면 상태 줄도 다시 감싼다(덮어쓴 상태 줄은 원본으로 보관)', () => {
    writeSettings({ theme: 'dark' });
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    setUsageCollectorEnabled(true, TARGET);
    keepVibisualHooksInPlace(PORT, HANDLER, TOKEN); // 상태 줄 쓰기로 바뀐 지문을 한 번 맞춘다

    // 사용자가 Claude Code 의 /statusline 으로 자기 상태 줄을 새로 걸었다 — 우리 것이 덮였다.
    writeSettings({ ...settingsOf(), statusLine: USER_STATUS_LINE });
    expect(readUsageCollectorStatus().installed).toBe(false);

    const r = keepVibisualHooksInPlace(PORT, HANDLER, TOKEN);

    expect(r.hostChecked).toBe(true);
    const status = readUsageCollectorStatus();
    expect(status.installed).toBe(true);
    expect(status.passthroughCommand).toBe(USER_STATUS_LINE.command);
  });

  it('끔이면 상태 줄은 건드리지 않는다 · 걷은 뒤에는 아무것도 안 한다', () => {
    writeSettings({ statusLine: USER_STATUS_LINE });
    appState.usageCollector = false;
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    writeSettings({ ...settingsOf(), theme: 'light' });
    keepVibisualHooksInPlace(PORT, HANDLER, TOKEN);
    expect(settingsOf().statusLine).toEqual(USER_STATUS_LINE);

    appState.usageCollector = true;
    retireVibisualHooks(PORT, HANDLER);
    writeSettings({ ...settingsOf(), theme: 'dark' });
    const r = keepVibisualHooksInPlace(PORT, HANDLER, TOKEN);
    expect(r).toEqual({ checked: [], rewritten: [], hostChecked: false });
    expect(settingsOf().statusLine).toEqual(USER_STATUS_LINE);
    expect(settingsOf().hooks).toBeUndefined();
  });

  it('코덱스 전역 훅은 지키지 않는다 — 켬의 주인은 옵션이다', () => {
    appState.codexHooks = true;
    ensureClaudeHooksInstalled(PORT, HANDLER, TOKEN);
    writeSettings({ ...settingsOf(), theme: 'dark' });

    keepVibisualHooksInPlace(PORT, HANDLER, TOKEN);

    expect(codex.installedWith).toEqual([]);
  });
});
