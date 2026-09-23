import type { ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackagedTerminalApi } from '../../transport/install-packaged-transport.js';
import { LoginWindow } from './LoginWindow.js';

type Data = Parameters<Parameters<PackagedTerminalApi['onData']>[0]>[0];
type Exit = Parameters<Parameters<PackagedTerminalApi['onExit']>[0]>[0];
const fixture = vi.hoisted(() => ({
  data: new Set<(value: Data) => void>(), exit: new Set<(value: Exit) => void>(),
  create: vi.fn<PackagedTerminalApi['create']>(), kill: vi.fn<PackagedTerminalApi['kill']>(),
  refreshAuth: vi.fn(), setLoginGate: vi.fn(), setProjectGate: vi.fn(),
}));
const state = {
  claudeAuth: { loggedIn: false, checkedAt: 1 }, loginGateDismissed: false, loginGateForced: true,
  userDefaults: { engineChoice: { kind: 'claude' } }, claudeSetup: { binPath: '/tools/claude' },
  projects: {}, stubProjects: {}, setLoginGate: fixture.setLoginGate,
  refreshClaudeAuth: fixture.refreshAuth, setProjectGate: fixture.setProjectGate,
};
vi.mock('../../stores/graphStore.js', () => ({ useGraphStore: Object.assign(
  (select: (value: typeof state) => unknown) => select(state), { getState: () => state },
) }));
vi.mock('react-dom', () => ({ createPortal: (node: ReactNode) => node }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../Layout/LanguageSwitcher.js', () => ({ LanguageSwitcher: () => null }));
vi.mock('../../stores/onboardingGates.js', () => ({ useOnboardingGate: () => {} }));
vi.mock('./LoginTerminal.js', () => ({ LoginTerminal: () => null }));
vi.mock('../../transport/terminalTransport.js', () => ({ getTerminalTransport: () => ({
  create: fixture.create, kill: fixture.kill, write: vi.fn().mockResolvedValue(undefined), resize: vi.fn(),
  onData: (cb: (value: Data) => void) => { fixture.data.add(cb); return () => { fixture.data.delete(cb); }; },
  onExit: (cb: (value: Exit) => void) => { fixture.exit.add(cb); return () => { fixture.exit.delete(cb); }; },
}) }));

let renderer: ReactTestRenderer | undefined;
const text = () => JSON.stringify(renderer?.toJSON());
const termId = () => fixture.create.mock.calls.at(-1)![0].termId;
async function click(key: string): Promise<void> {
  await act(async () => {
    const button = renderer!.root.findAllByType('button').find((node) => node.children.includes(key));
    if (!button) throw new Error(`Missing button ${key}`);
    button.props.onClick();
  });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fixture.data.clear(); fixture.exit.clear();
  fixture.create.mockResolvedValue({ ok: true }); fixture.kill.mockResolvedValue();
  fixture.refreshAuth.mockResolvedValue({ loggedIn: false, checkedAt: 1 });
  vi.stubGlobal('document', { body: {} });
  act(() => { renderer = create(<LoginWindow />); });
});
afterEach(() => {
  act(() => { renderer?.unmount(); }); renderer = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('Claude first sign-in owns its process until completion or dismissal', () => {
  it('captures an approval URL printed before terminal creation replies', async () => {
    fixture.create.mockImplementationOnce(async ({ termId: id }) => {
      for (const cb of fixture.data) cb({ termId: id, data: 'https://claude.ai/oauth/authorize?code=test-fixture\n' });
      return { ok: true };
    });
    await click('panel.login.start');
    expect(text()).toContain('https://claude.ai/oauth/authorize');
  });

  it('a failed exit permits retry and a confirmed successful exit hands off to the project picker', async () => {
    await click('panel.login.start');
    await act(async () => { for (const cb of fixture.exit) cb({ termId: termId(), exitCode: 1 }); });
    expect(text()).toContain('panel.login.start');
    expect(text()).not.toContain('panel.login.stop');
    await click('panel.login.start');
    fixture.refreshAuth.mockResolvedValue({ loggedIn: true, checkedAt: 2 });
    await act(async () => { for (const cb of fixture.exit) cb({ termId: termId(), exitCode: 0 }); });
    expect(text()).toContain('panel.login.success');
    await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
    expect(fixture.setProjectGate).toHaveBeenCalledWith({ forced: true, dismissed: false, reason: 'onboarding' });
  });

  it('dismissal during creation reaps the late process without touching a new attempt', async () => {
    let resolve!: (value: { ok: boolean }) => void;
    fixture.create.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await click('panel.login.start'); const old = termId();
    await click('panel.login.later'); await click('panel.login.start'); const next = termId();
    await act(async () => { resolve({ ok: true }); });
    expect(next).not.toBe(old);
    expect(fixture.kill).toHaveBeenCalledWith(old);
    expect(fixture.kill).not.toHaveBeenCalledWith(next);
    expect(text()).toContain('panel.login.stop');
  });

  it('unmount releases the pending login process and its event subscriptions', async () => {
    await click('panel.login.start'); const id = termId();
    act(() => { renderer!.unmount(); }); renderer = undefined;
    expect(fixture.kill).toHaveBeenCalledWith(id);
    expect(fixture.data.size).toBe(0); expect(fixture.exit.size).toBe(0);
  });
});
