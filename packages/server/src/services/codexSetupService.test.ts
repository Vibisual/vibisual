import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODEX_SETUP_INSTALL_TIMEOUT_MS, CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS, CODEX_SETUP_VERIFY_RETRY_MAX } from '@vibisual/shared';
import { CodexSetupService, buildCodexSetupInstallCommand, getCodexInstallsInfo, isCodexAutoInstallSupported, type CodexEngineInstaller } from './codexSetupService.js';
import { invalidateCodexBinCache } from './codexCli.js';
import type { ManagedEnsureResult } from './managedEngineService.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), resolveBinary: vi.fn(), resetBinLocatorCache: vi.fn(), killTree: vi.fn(), override: null as string | null }));
// 이 개발기의 실제 `~/.vibisual/user-defaults.json` 에 고른 코덱스가 있어도 시험이 같은 답을 내게 한다.
vi.mock('./codexCli.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./codexCli.js')>()),
  codexBinOverride: () => mocks.override,
  readCodexBinOverride: () => mocks.override,
}));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./binLocator.js', () => ({
  resolveBinary: mocks.resolveBinary,
  resetBinLocatorCache: mocks.resetBinLocatorCache,
  augmentedEnv: (env: NodeJS.ProcessEnv = process.env) => ({ ...env, PATH: '/augmented/bin' }),
}));
vi.mock('./processTree.js', () => ({
  processGroupSpawnOptions: (platform: NodeJS.Platform) => platform === 'win32' ? {} : { detached: true },
  killTree: mocks.killTree,
}));
// 이 개발기의 실제 `~/.vibisual/cli-engines` 를 보지 않는다 — 앱을 한 번 켠 PC 에서도 시험이 같은 답을 내게.
vi.mock('./managedEngineLayout.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./managedEngineLayout.js')>()),
  findManagedBin: () => null,
  isManagedEngineBin: () => false,
}));
vi.mock('../broadcastBus.js', () => ({ broadcast: vi.fn() }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

function fakeChild() {
  return Object.assign(new EventEmitter(), { pid: 1234, stdout: new PassThrough(), stderr: new PassThrough() });
}

let availableBin: string | null;
let versionExitCode: number;
let versionOutput: string;
let settle: ((r: ManagedEnsureResult) => void) | null;
let installer: CodexEngineInstaller & { ensureLatest: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  invalidateCodexBinCache();
  mocks.override = null;
  availableBin = null;
  versionExitCode = 0;
  versionOutput = 'codex-cli 1.2.3';
  settle = null;
  installer = {
    ensureLatest: vi.fn((opts: { report?: (line: string) => void }) => {
      opts.report?.('Downloading Codex 1.2.3…');
      return new Promise<ManagedEnsureResult>((resolve) => { settle = resolve; });
    }),
    status: () => undefined,
    autoGate: () => 'ok',
    peekLatest: async () => ({ latest: '1.2.3', installed: false, rolledBack: false }),
  };
  mocks.resolveBinary.mockImplementation(() => availableBin);
  mocks.spawn.mockImplementation(() => {
    const probe = fakeChild();
    // `--version` 확인만 가짜로 돈다 — 설치 스크립트 · 로그인 · 모델 프로세스는 띄우지 않는다.
    queueMicrotask(() => {
      probe.stdout.emit('data', versionOutput);
      probe.emit('close', versionExitCode);
    });
    return probe;
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('Codex install = app-managed download (§4 앱 전용 엔진)', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('%s [설치] runs the app-managed download and keeps the official command only as the manual path', async (platform) => {
    const service = new CodexSetupService(platform, installer);
    const state = await service.refresh();
    expect(state).toMatchObject({ phase: 'missing', canAutoInstall: true });
    expect(isCodexAutoInstallSupported(platform)).toBe(true);
    const command = buildCodexSetupInstallCommand(platform);
    expect(command).toBe(platform === 'win32'
      ? 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
      : 'curl -fsSL https://chatgpt.com/codex/install.sh | sh');
    expect(state.installCommand).toBe(command);
    const progress = service.startInstall();
    expect(progress.status).toBe('running');
    expect(installer.ensureLatest).toHaveBeenCalledWith(expect.objectContaining({ manual: true }));
    // 공식 설치 스크립트는 더 이상 띄우지 않는다(셸 문자열 spawn 0회).
    expect(mocks.spawn.mock.calls.some(([file]) => file === command)).toBe(false);
    expect(service.get()?.phase).toBe('installing');
    expect(service.getProgress()?.output).toContain('Downloading Codex 1.2.3');
  });

  it('unsupported platforms return a manual-install error without downloading', () => {
    expect(new CodexSetupService('freebsd', installer).startInstall()).toMatchObject({ status: 'error' });
    expect(isCodexAutoInstallSupported('freebsd')).toBe(false);
    expect(installer.ensureLatest).not.toHaveBeenCalled();
  });

  it('two windows asking to install share one download and progress id', () => {
    const service = new CodexSetupService('win32', installer);
    const first = service.startInstall();
    expect(service.startInstall().setupId).toBe(first.setupId);
    expect(installer.ensureLatest).toHaveBeenCalledTimes(1);
  });

  it('manual installation followed by Check again clears a previously cached missing binary', async () => {
    const service = new CodexSetupService('win32', installer);
    expect((await service.refresh()).phase).toBe('missing');
    availableBin = 'C:\\Tools\\codex.exe';
    expect(await service.refresh()).toMatchObject({ phase: 'ready', binPath: availableBin, version: '1.2.3' });
    expect(mocks.resetBinLocatorCache).toHaveBeenCalledTimes(3); // test reset + both refreshes
  });

  it('simultaneous refresh requests share one version probe', async () => {
    availableBin = 'C:\\Tools\\codex.exe';
    const service = new CodexSetupService('win32', installer);
    const [first, second] = await Promise.all([service.refresh(), service.refresh()]);
    expect(first).toEqual(second);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('successful download discovers the new binary without restarting the app', async () => {
    const service = new CodexSetupService('win32', installer);
    await service.refresh();
    service.startInstall();
    availableBin = 'C:\\Users\\me\\.vibisual\\cli-engines\\codex\\versions\\1.2.3\\bin\\codex.exe'; // privacy-ok — 가상 경로
    settle?.({ outcome: 'installed', version: '1.2.3' });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getProgress()).toMatchObject({ status: 'done', binPath: availableBin, version: '1.2.3' });
    expect(service.get()?.phase).toBe('ready');
  });

  it('a finished download is not success when no runnable CLI appears', async () => {
    const service = new CodexSetupService('linux', installer);
    service.startInstall();
    settle?.({ outcome: 'installed', version: '1.2.3' });
    await vi.advanceTimersByTimeAsync(CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS * CODEX_SETUP_VERIFY_RETRY_MAX);
    expect(service.getProgress()?.status).toBe('error');
    expect(service.get()?.phase).toBe('failed');
  });

  it('a failed check (rejected option) reaches the screen as the install error', async () => {
    const service = new CodexSetupService('darwin', installer);
    service.startInstall();
    settle?.({ outcome: 'probe-failed', version: '9.9.9', error: 'Codex 9.9.9 rejected 1 option(s): exec (unexpected argument)' });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getProgress()).toMatchObject({ status: 'error', error: expect.stringContaining('rejected 1 option') });
  });

  it('a version-shaped error from a failing CLI is not readiness', async () => {
    availableBin = 'C:\\Tools\\codex.exe';
    versionExitCode = 1;
    versionOutput = 'Cannot start codex-cli 1.2.3';
    expect((await new CodexSetupService('win32', installer).refresh()).phase).toBe('missing');
  });

  it('updating a working Codex does not flip the phase to installing (the setup window must not pop up)', async () => {
    availableBin = 'C:\\Tools\\codex.exe';
    const service = new CodexSetupService('win32', installer);
    expect((await service.refresh()).phase).toBe('ready');
    service.startInstall();
    expect(service.get()?.phase).toBe('ready');
    settle?.({ outcome: 'up-to-date', version: '1.2.3' });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getProgress()?.status).toBe('done');
  });

  it('automatic updates do not clear a rollback and skip PCs that never used Codex', async () => {
    const service = new CodexSetupService('win32', installer);
    service.startInstall({ manual: false });
    expect(installer.ensureLatest).toHaveBeenLastCalledWith(expect.objectContaining({ manual: false }));
    settle?.({ outcome: 'up-to-date' });
    await vi.advanceTimersByTimeAsync(CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS * CODEX_SETUP_VERIFY_RETRY_MAX);
    const idle = new CodexSetupService('win32', { ...installer, autoGate: () => 'not-in-use' });
    expect(await idle.autoUpdateIfEnabled()).toEqual({ started: false, reason: 'not-in-use' });
    const current = new CodexSetupService('win32', { ...installer, peekLatest: async () => ({ latest: '1.2.3', installed: true, rolledBack: false }) });
    expect(await current.autoUpdateIfEnabled()).toEqual({ started: false, reason: 'up-to-date' });
  });

  it('부팅 판정 전에 자동 업데이트가 돌아도 깔린 코덱스를 "없음"으로 보지 않는다(설치 창 단계가 뜨지 않는다)', async () => {
    availableBin = 'C:\\Tools\\codex.exe';
    const service = new CodexSetupService('win32', installer);
    expect(service.get()).toBeNull();
    expect(await service.autoUpdateIfEnabled()).toEqual({ started: true });
    expect(service.get()?.phase).toBe('ready');
    expect(installer.ensureLatest).toHaveBeenLastCalledWith(expect.objectContaining({ manual: false }));
  });

  it('사용자가 다른 설치본을 보조로 골라 두었으면 자동 업데이트는 받지 않는다 — 그 설치본의 갱신은 그 주인의 것이다', async () => {
    const service = new CodexSetupService('win32', installer, () => 'C:\\Tools\\codex.exe');
    expect(await service.autoUpdateIfEnabled()).toEqual({ started: false, reason: 'user-selected' });
    expect(installer.ensureLatest).not.toHaveBeenCalled();
    // 기본으로 돌아오면 다음 확인부터 다시 받는다.
    expect(await new CodexSetupService('win32', installer, () => null).autoUpdateIfEnabled()).toEqual({ started: true });
  });

  it('Version 탭 고르기 목록 — 쓰는 것 · 고른 것 · 판을 설치본마다 싣는다', async () => {
    const managedBin = 'C:\\Users\\me\\.vibisual\\cli-engines\\codex\\versions\\0.164.0\\bin\\codex.exe'; // privacy-ok — 가상 경로
    const npmBin = 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd'; // privacy-ok — 가상 경로
    const info = await getCodexInstallsInfo({
      discover: () => [{ binPath: managedBin, source: 'managed' }, { binPath: npmBin, source: 'path' }],
      activeBin: () => npmBin,
      overridePath: () => npmBin,
      managed: () => undefined,
      probe: async (p) => (p === managedBin ? { version: '0.164.0' } : { version: null, error: 'could not run' }),
    });
    expect(info.overridePath).toBe(npmBin);
    expect(info.installs).toEqual([
      { binPath: managedBin, source: 'managed', version: '0.164.0', active: false, selected: false },
      { binPath: npmBin, source: 'path', version: null, detectError: 'could not run', active: true, selected: true },
    ]);
  });

  it.each(['win32', 'darwin', 'linux'] as const)('%s timeout reports an error and ignores the late result', async (platform) => {
    const service = new CodexSetupService(platform, installer);
    service.startInstall();
    await vi.advanceTimersByTimeAsync(CODEX_SETUP_INSTALL_TIMEOUT_MS);
    expect(service.getProgress()?.status).toBe('error');
    const calls = mocks.spawn.mock.calls.length;
    availableBin = 'C:\\Tools\\codex.exe';
    settle?.({ outcome: 'installed', version: '1.2.3' });
    await vi.advanceTimersByTimeAsync(CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS * CODEX_SETUP_VERIFY_RETRY_MAX);
    expect(service.getProgress()?.status).toBe('error');
    // 늦게 온 결과로 `--version` 확인을 다시 돌리지 않는다(포기한 작업은 포기한 것이다).
    expect(mocks.spawn.mock.calls.length).toBeLessThanOrEqual(calls + 1);
  });
});
