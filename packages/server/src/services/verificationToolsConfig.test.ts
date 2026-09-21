import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MCP_SERVER_PRESETS, decideCodexTool } from '@vibisual/shared';
import { prepareMcpConfig } from './mcpConfigService.js';
import { buildCodexExecArgs } from './codexRunner.js';
import { codexVerificationOverrides, decideVerificationReuse, verificationMcpKeyOf, verificationMcpServer, verificationToolsAvailable } from './verificationToolsConfig.js';

const config = { nodeBin: process.execPath, helperPath: fileURLToPath(new URL('../../../../hooks/verification-tools.mjs', import.meta.url)) };

describe('verification tool configuration', () => {
  it('merges into Claude presets with a stable, credential-free definition', () => {
    const presets = MCP_SERVER_PRESETS.slice(0, 1).map((p) => p.id);
    const first = prepareMcpConfig(presets, verificationMcpServer(config))!;
    const second = prepareMcpConfig(presets, verificationMcpServer(config))!;
    expect(first.configPath).toBe(second.configPath);
    expect(first.allowedTools).toContain('mcp__vibisual_verify');
    const body = JSON.parse(fs.readFileSync(first.configPath, 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(body.mcpServers.vibisual_verify).toEqual({ command: config.nodeBin, args: [config.helperPath] });
    for (const preset of presets) expect(body.mcpServers).toHaveProperty(preset);
    expect(verificationToolsAvailable(config)).toBe(true);
    expect(verificationToolsAvailable({ ...config, helperPath: '/missing/verification-tools.mjs' })).toBe(false);
  });

  it('injects into new and resumed Codex turns while retaining sandbox and named-tool restrictions', () => {
    for (const resumeThreadId of [undefined, 'thread-existing']) {
      const args = buildCodexExecArgs({ verificationConfig: config, cwd: '/project', model: 'test', permissionMode: 'acceptEdits', networkAccess: false, resumeThreadId,
        toolHook: { ...config, policy: { mcp: 'deny', shell: 'deny' } },
      });
      expect(args).toContain('mcp_servers.vibisual_verify.required=true');
      expect(args).toContain('sandbox_workspace_write.network_access=false');
      expect(args).toContain('features.shell_tool=false');
      expect(args.some((arg) => arg.startsWith('hooks.PreToolUse='))).toBe(true);
      expect(args.some((arg) => arg.includes('runId'))).toBe(false);
      expect(args).toContain(`mcp_servers.vibisual_verify.args=${JSON.stringify([config.helperPath])}`);
    }
    expect(decideCodexTool({ mcp: 'deny' }, 'mcp__vibisual_verify__act')).toBe('deny');
    expect(decideCodexTool({ mcp: 'ask' }, 'mcp__vibisual_verify__observe')).toBe('ask');
    expect(codexVerificationOverrides(config).find((arg) => arg.includes('.env_vars='))).toContain('VIBISUAL_HOOK_AUTH');
  });

  it('uses the stable MCP definition to reconnect old Claude sessions only when required', () => {
    const args = ['--mcp-config', '/app/mcp/one.json', '--allowedTools', 'mcp__other,mcp__vibisual_verify'];
    const key = verificationMcpKeyOf(args);
    expect(key).toBe('/app/mcp/one.json');
    expect(verificationMcpKeyOf(['--mcp-config', '/app/other.json'])).toBeUndefined();
    expect(decideVerificationReuse(undefined, key, false)).toBe('respawn');
    expect(decideVerificationReuse('old', key, false)).toBe('respawn');
    expect(decideVerificationReuse(key, key, true)).toBe('reuse');
    expect(decideVerificationReuse('old', key, true)).toBe('blocked');
    expect(decideVerificationReuse(key, undefined, false)).toBe('reuse');
  });
});
