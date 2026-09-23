import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ claude: vi.fn(), codex: vi.fn() }));
vi.mock('./claudeCliRun.js', () => ({ runClaudeCli: fixture.claude }));
vi.mock('./codexCli.js', () => ({ runCodexCli: fixture.codex }));
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn() } }));
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });

async function load(provider: 'claude' | 'codex') {
  return provider === 'claude'
    ? (await import('./claudeAuthService.js')).claudeAuthService
    : (await import('./codexAuthService.js')).codexAuthService;
}

describe.each(['claude', 'codex'] as const)('%s logout confirmation', (provider) => {
  it('does not claim success when both logout and status inspection fail', async () => {
    fixture[provider].mockResolvedValue({ code: null, out: '', failure: 'timeout' });
    const service = await load(provider);
    expect(await service.logout()).toMatchObject({ ok: false, status: { error: 'timeout' } });
  });

  it('still accepts an unsuccessful logout command when fresh inspection confirms already signed out', async () => {
    fixture[provider].mockResolvedValueOnce({ code: 1, out: '' })
      .mockResolvedValueOnce({ code: 0, out: provider === 'claude' ? '{"loggedIn":false}' : 'Not logged in' });
    const service = await load(provider);
    expect(await service.logout()).toMatchObject({ ok: true, status: { loggedIn: false } });
  });

  it('confirms with a new probe after logout instead of reusing a prior in-flight status', async () => {
    let resolveOld!: (value: { code: number; out: string }) => void;
    const old = new Promise((resolve) => { resolveOld = resolve; });
    fixture[provider].mockReturnValueOnce(old)
      .mockResolvedValueOnce({ code: 0, out: '' })
      .mockResolvedValueOnce({ code: 0, out: provider === 'claude' ? '{"loggedIn":false}' : 'Not logged in' });
    const service = await load(provider);
    const refresh = service.refresh();
    const logout = service.logout();
    resolveOld({ code: 0, out: provider === 'claude' ? '{"loggedIn":true}' : 'Logged in using ChatGPT' });
    await refresh;
    expect(await logout).toMatchObject({ ok: true, status: { loggedIn: false } });
    expect(fixture[provider]).toHaveBeenCalledTimes(3);
    expect(service.get()?.loggedIn).toBe(false);
  });
});
