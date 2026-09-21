import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_CONFIG, type QueuedCommand } from '@vibisual/shared';
import type { CodexTurnArgs } from './codexRunner.js';

let lastCodexTurn: CodexTurnArgs | undefined;
vi.mock('./codexRunner.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./codexRunner.js')>();
  return { ...original, runCodexTurn: (args: CodexTurnArgs): void => { lastCodexTurn = args; } };
});
const { SubAgentManager } = await import('./subAgentManager.js');
const bridgeConfig = { nodeBin: process.execPath, helperPath: fileURLToPath(new URL('../../../../hooks/verification-tools.mjs', import.meta.url)) };
const env = { VIBISUAL_BASE: 'http://127.0.0.1:44444', VIBISUAL_TOKEN: 'fixture-token' };

function command(subAgentId: string): QueuedCommand {
  return { id: 'cmd-verify-wiring', text: 'Verify runId=run-fixture using the connected tools', timestamp: Date.now(), status: 'queued', subAgentId };
}

describe('verification CLI wiring', () => {
  it('connects Claude without the user enabling an MCP preset and passes credentials only through env', () => {
    const manager = new SubAgentManager();
    const sub = manager.create('agent-verification', 'sub-verification-claude');
    type Internals = { _executeViaLegacy: (...args: unknown[]) => void; pendingConfigEnv: Map<string, Record<string, string>> };
    const internal = manager as unknown as Internals;
    const dispatch = vi.fn();
    internal._executeViaLegacy = dispatch;
    const cmd = command(sub.id);
    manager.execute(cmd, process.cwd(), '', { ...DEFAULT_AGENT_CONFIG, mcpServers: [] }, undefined, { verificationConfig: bridgeConfig, extraEnv: env });
    expect(dispatch).toHaveBeenCalledOnce();
    const args = dispatch.mock.calls[0]![4] as string[];
    expect(args).toContain('--mcp-config');
    expect(args).toContain('mcp__vibisual_verify');
    const configPath = args[args.indexOf('--mcp-config') + 1]!;
    const definition = fs.readFileSync(configPath, 'utf8');
    expect(definition).toContain('verification-tools.mjs');
    expect(definition).not.toContain('fixture-token');
    expect(definition).not.toContain('run-fixture');
    expect(internal.pendingConfigEnv.get(sub.id)).toMatchObject(env);
    manager.remove(sub.id);
  });

  it('passes the same bridge through Codex, including resumed threads', () => {
    const manager = new SubAgentManager();
    const sub = manager.create('agent-verification', 'sub-verification-codex');
    sub.sessionId = 'existing-thread';
    const cmd = command(sub.id);
    manager.execute(cmd, process.cwd(), '', { ...DEFAULT_AGENT_CONFIG, provider: { kind: 'codex-cli', modelId: 'test' } }, undefined, { verificationConfig: bridgeConfig, extraEnv: env });
    expect(lastCodexTurn?.verificationConfig).toEqual(bridgeConfig);
    expect(lastCodexTurn?.resumeThreadId).toBe('existing-thread');
    expect(lastCodexTurn?.ownerAgentId).toBe('agent-verification');
    expect(lastCodexTurn?.subAgentId).toBe(sub.id);
    expect(lastCodexTurn?.env).toMatchObject(env);
    expect(lastCodexTurn?.prompt).toContain('run-fixture');
    lastCodexTurn?.onDone(undefined, 'done');
    manager.remove(sub.id);
  });

  it('fails a missing connection before sending the command to either engine', () => {
    for (const provider of [undefined, { kind: 'codex-cli' as const, modelId: 'test' }]) {
      const manager = new SubAgentManager();
      const sub = manager.create('agent-verification', `sub-missing-${provider?.kind ?? 'claude'}`);
      const cmd = command(sub.id);
      lastCodexTurn = undefined;
      manager.execute(cmd, process.cwd(), '', { ...DEFAULT_AGENT_CONFIG, ...(provider ? { provider } : {}) }, undefined,
        { verificationConfig: { ...bridgeConfig, helperPath: '/missing/verification-tools.mjs' }, extraEnv: env });
      expect(cmd.status).toBe('error');
      expect(cmd.result).toContain('Verification tools unavailable');
      expect(lastCodexTurn).toBeUndefined();
      manager.remove(sub.id);
    }
  });
});
