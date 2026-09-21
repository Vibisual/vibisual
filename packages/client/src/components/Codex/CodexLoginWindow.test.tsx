import type { ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexAuthStatus } from '@vibisual/shared';
import type { PackagedTerminalApi } from '../../transport/install-packaged-transport.js';
import { CodexLoginWindow } from './CodexLoginWindow.js';

type Data = Parameters<Parameters<PackagedTerminalApi['onData']>[0]>[0];
type Exit = Parameters<Parameters<PackagedTerminalApi['onExit']>[0]>[0];
const fixture = vi.hoisted(() => ({
  data: new Set<(value: Data) => void>(), exit: new Set<(value: Exit) => void>(),
  create: vi.fn<PackagedTerminalApi['create']>(), kill: vi.fn<PackagedTerminalApi['kill']>(),
  write: vi.fn<PackagedTerminalApi['write']>(),
  refreshAuth: vi.fn<() => Promise<CodexAuthStatus | null>>(),
  refreshModels: vi.fn(), setLoginGate: vi.fn(), setProjectGate: vi.fn(), copy: vi.fn(),
}));
const state = {
  codexAuth: { loggedIn: false, checkedAt: 1 }, codexLoginGateDismissed: false,
  codexLoginGateForced: true, userDefaults: { engineChoice: { kind: 'codex' } },
  codexSetup: { binPath: 'C:\\Tools\\codex.cmd' }, projects: {}, stubProjects: {},
  setCodexLoginGate: fixture.setLoginGate, refreshCodexAuth: fixture.refreshAuth,
  refreshCodexModels: fixture.refreshModels, setProjectGate: fixture.setProjectGate,
};
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: Object.assign(
  (select: (value: typeof state) => unknown) => select(state), { getState: () => state },
) }));
vi.mock('react-dom', () => ({ createPortal: (node: ReactNode) => node }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../Layout/LanguageSwitcher.js', () => ({ LanguageSwitcher: () => null }));
vi.mock('../Engine/engineIcons.js', () => ({ EngineIcon: () => null }));
vi.mock('../../stores/onboardingGates.js', () => ({ useOnboardingGate: () => {} }));
vi.mock('../Auth/LoginTerminal.js', () => ({ LoginTerminal: () => <div data-terminal="visible" /> }));
vi.mock('../../transport/terminalTransport.js', () => ({ getTerminalTransport: () => ({
  create: fixture.create, kill: fixture.kill, write: fixture.write, resize: vi.fn(),
  onData: (cb: (data: Data) => void) => { fixture.data.add(cb); return () => { fixture.data.delete(cb); }; },
  onExit: (cb: (exit: Exit) => void) => { fixture.exit.add(cb); return () => { fixture.exit.delete(cb); }; },
}) }));

let renderer: ReactTestRenderer | undefined;
function text(): string { return JSON.stringify(renderer?.toJSON()); }
function button(key: string): ReactTestInstance {
  const found = renderer?.root.findAllByType('button').find((node) => node.children.includes(key)
    || node.findAll((child) => child.children.includes(key)).length > 0);
  if (!found) throw new Error(`Missing button ${key}`);
  return found;
}
async function click(key: string): Promise<void> {
  await act(async () => { button(key).props.onClick(); });
}
function termId(index = fixture.create.mock.calls.length - 1): string {
  return fixture.create.mock.calls[index]![0].termId;
}
async function emit(data: string, id = termId()): Promise<void> {
  await act(async () => { for (const cb of fixture.data) cb({ termId: id, data }); });
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks(); fixture.data.clear(); fixture.exit.clear();
  fixture.create.mockResolvedValue({ ok: true }); fixture.kill.mockResolvedValue();
  fixture.write.mockResolvedValue(); fixture.copy.mockResolvedValue(undefined);
  fixture.refreshModels.mockResolvedValue(null);
  fixture.refreshAuth.mockResolvedValue({ loggedIn: false, checkedAt: 1 });
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('navigator', { clipboard: { writeText: fixture.copy } });
  act(() => { renderer = create(<CodexLoginWindow />); });
});
afterEach(() => {
  act(() => { renderer?.unmount(); }); renderer = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('Codex sign-in recovery', () => {
  it('can start from a LAN browser without the secure-context UUID API', async () => {
    vi.stubGlobal('crypto', {});
    await click('panel.codexLogin.start');
    expect(termId()).toMatch(/^term:codex:login:.+/);
  });
  it('shows and copies the device code printed before create resolves without offering stdin input', async () => {
    fixture.create.mockImplementationOnce(async ({ termId: id }) => {
      for (const cb of fixture.data) cb({ termId: id, data: 'https://auth.openai.com/codex/device\nEnter this one-time code:\nABCD-EFGH\n' });
      return { ok: true };
    });
    await click('panel.codexLogin.modeDevice'); await click('panel.codexLogin.start');
    expect(text()).toContain('ABCD-EFGH'); expect(text()).toContain('panel.codexLogin.deviceCodePrompt');
    expect(renderer!.root.findAllByType('input')).toHaveLength(0);
    await click('panel.codexLogin.copyDeviceCode');
    expect(fixture.copy).toHaveBeenCalledWith('ABCD-EFGH'); expect(fixture.write).not.toHaveBeenCalled();
  });

  it('shows the terminal when a device URL is found but its code is not recognized', async () => {
    await click('panel.codexLogin.modeDevice'); await click('panel.codexLogin.start');
    await emit('https://auth.openai.com/codex/device\nEnter this one-time code:\n');
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(renderer!.root.findAllByProps({ 'data-terminal': 'visible' })).toHaveLength(1);
  });

  it('clears expired instructions and offers retry with a fresh terminal', async () => {
    await click('panel.codexLogin.start'); const old = termId();
    await emit('https://auth.openai.com/codex/device\nError logging in: device authorization expired\n');
    expect(text()).toContain('panel.codexLogin.ended'); expect(text()).not.toContain('https://auth.openai.com');
    await click('panel.codexLogin.retry');
    expect(termId()).not.toBe(old);
    await act(async () => { for (const cb of fixture.exit) cb({ termId: old, exitCode: 1 }); });
    expect(text()).toContain('panel.codexLogin.stop');
  });

  it('unknown CLI exit is retryable, while confirmed login refreshes models and hands off', async () => {
    await click('panel.codexLogin.start');
    await act(async () => { for (const cb of fixture.exit) cb({ termId: termId(), exitCode: 1 }); });
    expect(text()).toContain('panel.codexLogin.retry');
    await click('panel.codexLogin.retry');
    fixture.refreshAuth.mockResolvedValue({ loggedIn: true, checkedAt: 2 });
    await act(async () => { for (const cb of fixture.exit) cb({ termId: termId(), exitCode: 0 }); });
    expect(text()).toContain('panel.codexLogin.success'); expect(fixture.refreshModels).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
    expect(fixture.setProjectGate).toHaveBeenCalledWith({ forced: true, dismissed: false, reason: 'onboarding' });
  });

  it('stop during create reaps the late PTY without reviving it or killing the next attempt', async () => {
    const pending = deferred<{ ok: boolean }>(); fixture.create.mockReturnValueOnce(pending.promise);
    await click('panel.codexLogin.start'); const old = termId();
    await click('panel.codexLogin.stop'); await click('panel.codexLogin.start'); const next = termId();
    await act(async () => { pending.resolve({ ok: true }); });
    expect(fixture.kill).toHaveBeenCalledWith(old); expect(fixture.kill).not.toHaveBeenCalledWith(next);
    expect(text()).toContain('panel.codexLogin.stop');
  });

  it('late authentication results after stop or unmount cannot show success or refresh models', async () => {
    const pending = deferred<CodexAuthStatus | null>(); fixture.refreshAuth.mockReturnValueOnce(pending.promise);
    await click('panel.codexLogin.start');
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    await click('panel.codexLogin.stop');
    await act(async () => { pending.resolve({ loggedIn: true, checkedAt: 2 }); });
    expect(text()).not.toContain('panel.codexLogin.success'); expect(fixture.refreshModels).not.toHaveBeenCalled();
    await click('panel.codexLogin.start'); act(() => { renderer!.unmount(); }); renderer = undefined;
    expect(fixture.data.size).toBe(0); expect(fixture.exit.size).toBe(0);
  });

  it('a cancelled final status check cannot finish the next sign-in attempt', async () => {
    const pending = deferred<CodexAuthStatus | null>();
    await click('panel.codexLogin.start');
    fixture.refreshAuth.mockReturnValueOnce(pending.promise);
    await act(async () => { for (const cb of fixture.exit) cb({ termId: termId(), exitCode: 0 }); });
    expect(text()).toContain('panel.codexLogin.checking');
    expect(text()).not.toContain('panel.codexLogin.ended');
    await click('panel.codexLogin.stop'); await click('panel.codexLogin.start');
    await act(async () => { pending.resolve({ loggedIn: true, checkedAt: 2 }); });
    expect(text()).toContain('panel.codexLogin.stop'); expect(fixture.refreshModels).not.toHaveBeenCalled();
  });

  it('recheck accepts an externally completed login but ignores a response after dismissal', async () => {
    const pending = deferred<CodexAuthStatus | null>(); fixture.refreshAuth.mockReturnValueOnce(pending.promise);
    await click('panel.codexLogin.recheck'); await click('panel.codexLogin.later');
    await act(async () => { pending.resolve({ loggedIn: true, checkedAt: 2 }); });
    expect(text()).not.toContain('panel.codexLogin.success');
    fixture.refreshAuth.mockResolvedValue({ loggedIn: true, checkedAt: 3 });
    await click('panel.codexLogin.recheck');
    expect(text()).toContain('panel.codexLogin.success');
  });

  it('a browser without clipboard access still displays a selectable device code', async () => {
    vi.stubGlobal('navigator', {});
    await click('panel.codexLogin.modeDevice'); await click('panel.codexLogin.start');
    await emit('https://auth.openai.com/codex/device\nDevice code: ABCD-EFGH\n');
    await click('panel.codexLogin.copyDeviceCode');
    expect(text()).toContain('ABCD-EFGH'); expect(fixture.write).not.toHaveBeenCalled();
  });

  it('browser code prompts still send the entered code to their own PTY', async () => {
    await click('panel.codexLogin.start'); await emit('Paste the authorization code:');
    act(() => { renderer!.root.findByType('input').props.onChange({ target: { value: 'browser-code' } }); });
    await click('panel.codexLogin.sendCode');
    expect(fixture.write).toHaveBeenCalledWith(termId(), 'browser-code\r');
  });
});
