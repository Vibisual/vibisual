import { describe, expect, it } from 'vitest';
import { buildCodexExecArgs } from './codexRunner.js';
import { codexLocalTransportNetwork, LOCAL_TRANSPORT_NETWORK_REQUIRED } from './codexLocalTransport.js';
import { normalizeExecutionRequirements } from './commandExecutionRequirements.js';

describe.each(['win32', 'darwin', 'linux'] as const)('app local transport (%s)', (platform) => {
  it('keeps ordinary commands unchanged and scopes automatic network access to a required command', () => {
    const base = { cwd: '/work', model: 'test', platform };
    const ordinary = buildCodexExecArgs(base);
    expect(ordinary.some((a) => a.startsWith('sandbox_workspace_write.network_access='))).toBe(false);
    const local = buildCodexExecArgs({ ...base, executionRequirements: { localTransport: true } });
    expect(local.includes('sandbox_workspace_write.network_access=true')).toBe(platform !== 'win32');
    expect(buildCodexExecArgs(base)).toEqual(ordinary);
  });
  it('preserves explicit false in the agent, config, or selected profile even if another layer enables it', () => {
    for (const setting of [{ networkAccess: false }, { configuredNetworkAccess: [false] }, { networkAccess: true, configuredNetworkAccess: [true, false] }]) {
      expect(() => codexLocalTransportNetwork({ platform, required: true, ...setting })).toThrow(LOCAL_TRANSPORT_NETWORK_REQUIRED);
    }
  });
  it('does not override an enabled inherited profile or a nonrequested explicit setting', () => {
    expect(codexLocalTransportNetwork({ platform, required: true, configuredNetworkAccess: [true] })).toBeUndefined();
    expect(codexLocalTransportNetwork({ platform, required: false, networkAccess: false })).toBe(false);
    expect(codexLocalTransportNetwork({ platform, required: true, networkAccess: true })).toBe(true);
  });
  it('refuses read-only or unreadable configuration instead of broadening it', () => {
    expect(() => codexLocalTransportNetwork({ platform, required: true, permissionMode: 'plan' })).toThrow(LOCAL_TRANSPORT_NETWORK_REQUIRED);
    expect(() => codexLocalTransportNetwork({ platform, required: true, configUnreadable: true })).toThrow(LOCAL_TRANSPORT_NETWORK_REQUIRED);
  });
});

it('normalizes capability declarations without interpreting strings or carrying unknown fields', () => {
  for (const value of [null, [], 'true', { localTransport: 'true' }, { localTransport: false }]) expect(normalizeExecutionRequirements(value)).toBeUndefined();
  expect(normalizeExecutionRequirements({ localTransport: true, code: 'ignored' })).toEqual({ localTransport: true });
});
