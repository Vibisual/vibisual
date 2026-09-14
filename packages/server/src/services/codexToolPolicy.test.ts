import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { decideCodexTool, normalizeAgentProvider, normalizeCodexToolPolicy } from '@vibisual/shared';
import { buildCodexExecArgs, runCodexTurn } from './codexRunner.js';
import { codexTurnHooks } from './codexEdges.js';

const helperPath = fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url));
const hook = { helperPath, nodeBin: process.execPath, policy: { edit: 'ask', shell: 'deny', web: 'deny' } as const };

describe('Codex tool permissions', () => {
  it('preserves explicit settings and an empty reset through provider normalization', () => {
    for (const codexTools of [hook.policy, {}]) {
      const provider = normalizeAgentProvider({ kind: 'codex-cli', modelId: 'test', codexTools });
      expect(provider?.codexTools).toEqual(codexTools);
    }
    expect(normalizeCodexToolPolicy({ web: 'ask', shell: 'bogus' })).toEqual({ web: 'deny', shell: 'deny' });
  });
  it('gates native aliases, MCP delegation, and unknown wrappers', () => {
    expect(decideCodexTool(hook.policy, 'apply_patch')).toBe('ask');
    expect(decideCodexTool(hook.policy, 'functions.exec_command')).toBe('deny');
    expect(decideCodexTool(hook.policy, 'write_stdin')).toBe('deny');
    expect(decideCodexTool(hook.policy, 'view_image')).toBe('allow');
    expect(decideCodexTool(hook.policy, 'spawn_agent')).toBe('deny');
    expect(decideCodexTool(hook.policy, 'unknown_future_tool')).toBe('deny');
    expect(decideCodexTool(hook.policy, 'update_plan')).toBe('allow');
    expect(decideCodexTool(hook.policy, 'mcp__vibisual_edges__dispatch')).toBe('allow');
    expect(decideCodexTool({ mcp: 'ask' }, 'mcp__vibisual_edges__dispatch')).toBe('ask');
    expect(decideCodexTool({ mcp: 'deny' }, 'mcp__filesystem__read_file')).toBe('deny');
    expect(decideCodexTool({}, 'unknown_future_tool')).toBe('allow');
  });
  it('applies hooks and hosted blocks on new and resumed turns after web overrides', () => {
    for (const resumeThreadId of [undefined, 'old-thread']) {
      const args = buildCodexExecArgs({ cwd: '/project', model: 'test', toolHook: hook, resumeThreadId, webSearch: 'live' });
      expect(args).toContain('features.shell_tool=false');
      expect(args).toContain('features.multi_agent=false');
      expect(args).toContain('features.code_mode=false');
      expect(args.indexOf('web_search="disabled"')).toBeGreaterThan(args.indexOf('web_search=live'));
      expect(args.some((a) => a.startsWith('hooks.PreToolUse=') && a.includes('tool-permission'))).toBe(true);
    }
  });
  it('composes tool, delegation and sandbox hooks without overwriting them', () => {
    const result = codexTurnHooks({ ...hook, edgeIds: ['e'], restrictedTools: ['Read'] }, { ...hook, required: true }, 'linux', hook);
    expect(result.overrides.filter((a) => a.startsWith('hooks.PreToolUse='))).toHaveLength(1);
    expect(result.expected).toHaveLength(3);
    expect(result.expected.some((h) => h.command.endsWith('tool-permission delegation'))).toBe(true);
    expect(result.expected.some((h) => h.command.endsWith('gate'))).toBe(true);
    expect(result.expected.some((h) => h.eventName === 'permissionRequest')).toBe(true);
  });
  it('refuses to start when required enforcement is missing', async () => {
    const error = await new Promise<string | undefined>((resolve) => runCodexTurn({
      toolHook: { ...hook, helperPath: '/not/a/real/hook' }, subAgentId: 'missing-tool-gate', cwd: '.', model: 'test', prompt: '',
      onDone: resolve, onEvent: () => {}, onThread: () => {}, onUsage: () => {}, onFileWrites: () => {},
    }));
    expect(error).toContain('tool permissions unavailable');
  });
});

it('real hook waits for the approval response, forwards identity, and denies errors', async () => {
  const received: Record<string, unknown>[] = [];
  let answer: unknown = { decision: 'allow' };
  const server = createServer(async (req, res) => {
    expect(req.url).toBe('/api/codex-tool-check');
    expect(req.headers['x-vibisual-hook-token']).toBe('fixture-token');
    let raw = ''; for await (const chunk of req) raw += chunk;
    received.push(JSON.parse(raw));
    await new Promise((resolve) => setTimeout(resolve, 30));
    res.end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const invoke = (input: string) => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [helperPath, 'tool-permission'], { windowsHide: true,
      env: { ...process.env, VIBISUAL_BASE: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        VIBISUAL_TOKEN: 'fixture-token', VIBISUAL_OWNER_AGENT_ID: 'owner', VIBISUAL_SUBAGENT_ID: 'child' } });
    let out = ''; child.stdout.on('data', (chunk) => out += chunk);
    child.on('error', reject); child.on('close', () => resolve(out)); child.stdin.end(input);
  });
  try {
    const input = JSON.stringify({ tool_name: 'apply_patch', tool_input: { patch: 'fixture' }, session_id: 'session' });
    expect(JSON.parse(await invoke(input))).toEqual({});
    expect(received[0]).toMatchObject({ parentAgentId: 'owner', subAgentId: 'child', sessionId: 'session', toolName: 'apply_patch' });
    answer = { decision: 'deny', reason: 'user' };
    expect(JSON.parse(await invoke(input)).hookSpecificOutput.permissionDecision).toBe('deny');
    answer = { unexpected: true };
    expect(JSON.parse(await invoke(input)).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(JSON.parse(await invoke('bad json')).hookSpecificOutput.permissionDecision).toBe('deny');
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
