import { describe, expect, it, vi } from 'vitest';
import { appNodeRuntimeIn, buildAppNodeCommand, getAppNodeRuntime } from './appNodeRuntime.js';
import { codexEdgeOverrides, codexTurnHooks } from './codexEdges.js';
import { codexVerificationOverrides, verificationMcpServer } from './verificationToolsConfig.js';

const { resolveBinary } = vi.hoisted(() => ({ resolveBinary: vi.fn(() => null as string | null) }));
vi.mock('./binLocator.js', () => ({ resolveBinary }));

describe('Node-free app helper runtime', () => {
  it('keeps a resolved external Node when one is already installed', () => {
    expect(appNodeRuntimeIn('/usr/bin/node', '/opt/Vibisual', true)).toEqual({ nodeBin: '/usr/bin/node' });
  });

  it('a standalone server reuses its own Node even when PATH is empty', () => {
    expect(appNodeRuntimeIn(null, '/opt/node', false)).toEqual({ nodeBin: '/opt/node' });
    expect(getAppNodeRuntime()).toEqual({ nodeBin: process.execPath });
    expect(resolveBinary).toHaveBeenCalledWith('node');
  });

  it.each([
    ['win32', 'C:\\Program Files\\Vibisual\\Vibisual.exe'],
    ['darwin', '/Applications/Vibisual.app/Contents/MacOS/Vibisual'],
    ['linux', '/opt/Vibisual/vibisual'],
  ] as const)('%s uses packaged Electron only for app-owned helper invocations', (platform, execPath) => {
    const before = process.env['ELECTRON_RUN_AS_NODE'];
    const runtime = appNodeRuntimeIn(null, execPath, true);
    expect(runtime).toEqual({ nodeBin: execPath, nodeEnv: { ELECTRON_RUN_AS_NODE: '1' } });
    const helperPath = platform === 'win32' ? 'C:\\App Resources\\helper.mjs' : '/app resources/helper.mjs';
    const command = buildAppNodeCommand(runtime, helperPath, ['permission', 'PreToolUse'], platform);
    expect(command.startsWith(platform === 'win32' ? "$env:ELECTRON_RUN_AS_NODE='1'; & " : 'ELECTRON_RUN_AS_NODE=1 ')).toBe(true);
    expect(command).toContain(`"${execPath}" "${helperPath}" permission PreToolUse`);

    const base = { ...runtime, helperPath };
    const edge = { ...base, edgeIds: ['edge-a'], restrictedTools: ['Bash'] };
    const hooks = codexTurnHooks(edge, { ...base, required: true }, platform, { ...base, policy: { shell: 'deny' } });
    expect(hooks.expected).toHaveLength(3);
    expect(hooks.expected.every(hook => hook.command.includes('ELECTRON_RUN_AS_NODE'))).toBe(true);
    expect(codexEdgeOverrides(edge)).toContain('mcp_servers.vibisual_edges.env.ELECTRON_RUN_AS_NODE="1"');
    expect(codexVerificationOverrides(base)).toContain('mcp_servers.vibisual_verify.env.ELECTRON_RUN_AS_NODE="1"');
    expect(verificationMcpServer(base)['vibisual_verify']?.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(process.env['ELECTRON_RUN_AS_NODE']).toBe(before);
  });

  it.each(['win32', 'darwin', 'linux'] as const)('%s keeps shell expansion characters literal in executable and script paths', (platform) => {
    const command = buildAppNodeCommand({ nodeBin: '/app $data`/runtime' }, '/app $data`/helper.mjs', ['mcp'], platform);
    if (platform === 'win32') {
      expect(command).toContain('`$data``');
    } else {
      expect(command).toContain('\\$data\\`');
    }
    expect(command).not.toContain('ELECTRON_RUN_AS_NODE');
  });

  it('external Node MCPs retain the old config without Electron environment', () => {
    const config = { nodeBin: '/usr/bin/node', helperPath: '/app/helper.mjs', edgeIds: [], restrictedTools: [] };
    expect(codexEdgeOverrides(config).some(arg => arg.includes('ELECTRON_RUN_AS_NODE'))).toBe(false);
    expect(codexVerificationOverrides(config).some(arg => arg.includes('ELECTRON_RUN_AS_NODE'))).toBe(false);
    expect(verificationMcpServer(config)['vibisual_verify']?.env).toBeUndefined();
  });
});
