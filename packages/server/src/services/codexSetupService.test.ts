import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CODEX_SETUP_INSTALL_TIMEOUT_MS, CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS, CODEX_SETUP_VERIFY_RETRY_MAX } from '@vibisual/shared';
import { CodexSetupService, buildCodexSetupInstallCommand, isCodexAutoInstallSupported } from './codexSetupService.js';
import { invalidateCodexBinCache } from './codexCli.js';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), resolveBinary: vi.fn(), resetBinLocatorCache: vi.fn(), killTree: vi.fn() }));
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
vi.mock('../broadcastBus.js', () => ({ broadcast: vi.fn() }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

function fakeChild() {
  return Object.assign(new EventEmitter(), { pid: 1234, stdout: new PassThrough(), stderr: new PassThrough() });
}

let installer: ReturnType<typeof fakeChild>;
let availableBin: string | null;
let versionExitCode: number;
let versionOutput: string;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  invalidateCodexBinCache();
  availableBin = null;
  versionExitCode = 0;
  versionOutput = 'codex-cli 1.2.3';
  installer = fakeChild();
  mocks.resolveBinary.mockImplementation(() => availableBin);
  mocks.spawn.mockImplementation((_file: string, args: unknown) => {
    if (!Array.isArray(args)) return installer;
    const probe = fakeChild();
    // Only fake --version probes run; no installer, login or model process is started.
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

describe('Codex first install on a PC without Node/npm', () => {
  it.each(['win32', 'darwin', 'linux'] as const)('%s uses the displayed official standalone command with the augmented PATH', async (platform) => {
    const service = new CodexSetupService(platform);
    const state = await service.refresh();
    expect(state).toMatchObject({ phase: 'missing', canAutoInstall: true });
    expect(isCodexAutoInstallSupported(platform)).toBe(true);
    const command = buildCodexSetupInstallCommand(platform);
    expect(command).toBe(platform === 'win32'
      ? 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"'
      : 'curl -fsSL https://chatgpt.com/codex/install.sh | sh');
    expect(state.installCommand).toBe(command);
    expect(service.startInstall().status).toBe('running');
    expect(mocks.spawn).toHaveBeenCalledWith(command, expect.objectContaining({
      shell: true, windowsHide: true,
      env: expect.objectContaining({ PATH: '/augmented/bin', CODEX_NON_INTERACTIVE: '1' }),
    }));
    expect(mocks.spawn.mock.calls[0]?.[1].detached).toBe(platform === 'win32' ? undefined : true);
    expect(mocks.resolveBinary.mock.calls.every(([name]) => name === 'codex')).toBe(true);
  });

  it('unsupported platforms return a manual-install error without spawning', () => {
    expect(new CodexSetupService('freebsd').startInstall()).toMatchObject({ status: 'error' });
    expect(isCodexAutoInstallSupported('freebsd')).toBe(false);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('two windows asking to install share one process and progress id', () => {
    const service = new CodexSetupService('win32');
    const first = service.startInstall();
    expect(service.startInstall().setupId).toBe(first.setupId);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('manual installation followed by Check again clears a previously cached missing binary', async () => {
    const service = new CodexSetupService('win32');
    expect((await service.refresh()).phase).toBe('missing');
    availableBin = 'C:\\Tools\\codex.exe';
    expect(await service.refresh()).toMatchObject({ phase: 'ready', binPath: availableBin, version: '1.2.3' });
    expect(mocks.resetBinLocatorCache).toHaveBeenCalledTimes(3); // test reset + both refreshes
  });

  it('simultaneous refresh requests share one version probe', async () => {
    availableBin = 'C:\\Tools\\codex.exe';
    const service = new CodexSetupService('win32');
    const [first, second] = await Promise.all([service.refresh(), service.refresh()]);
    expect(first).toEqual(second);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('successful install discovers the new binary without restarting the app', async () => {
    const service = new CodexSetupService('win32');
    await service.refresh();
    service.startInstall();
    availableBin = 'C:\\Tools\\codex.exe';
    installer.emit('close', 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getProgress()).toMatchObject({ status: 'done', binPath: availableBin, version: '1.2.3' });
    expect(service.get()?.phase).toBe('ready');
  });

  it('installer exit zero is not success when no runnable CLI appears', async () => {
    const service = new CodexSetupService('linux');
    service.startInstall();
    installer.emit('close', 0);
    await vi.advanceTimersByTimeAsync(CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS * CODEX_SETUP_VERIFY_RETRY_MAX);
    expect(service.getProgress()?.status).toBe('error');
    expect(service.get()?.phase).toBe('failed');
  });

  it('a version-shaped error from a failing CLI is not readiness', async () => {
    availableBin = 'C:\\Tools\\codex.exe';
    versionExitCode = 1;
    versionOutput = 'Cannot start codex-cli 1.2.3';
    expect((await new CodexSetupService('win32').refresh()).phase).toBe('missing');
  });

  it.each(['win32', 'darwin', 'linux'] as const)('%s timeout kills the process tree and ignores the late close', async (platform) => {
    const service = new CodexSetupService(platform);
    service.startInstall();
    await vi.advanceTimersByTimeAsync(CODEX_SETUP_INSTALL_TIMEOUT_MS);
    expect(mocks.killTree).toHaveBeenCalledWith(installer.pid, platform);
    expect(service.getProgress()?.status).toBe('error');
    const calls = mocks.spawn.mock.calls.length;
    availableBin = 'C:\\Tools\\codex.exe';
    installer.emit('close', 0);
    await vi.advanceTimersByTimeAsync(CODEX_SETUP_VERIFY_RETRY_INTERVAL_MS * CODEX_SETUP_VERIFY_RETRY_MAX);
    expect(service.getProgress()?.status).toBe('error');
    expect(mocks.spawn).toHaveBeenCalledTimes(calls);
  });
});
