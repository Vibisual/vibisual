import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { codexEdgeOverrides, codexEdgeInstructions, type CodexEdgeConfig } from './codexEdges.js';
import { buildCodexExecArgs } from './codexRunner.js';

const helperPath = fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url));
const config: CodexEdgeConfig = { helperPath, nodeBin: process.execPath, edgeIds: ['edge-a'], restrictedTools: ['Read', 'Grep'] };
const children: ChildProcessWithoutNullStreams[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('Codex mandatory edge delegation', () => {
  it.each(['Bash', 'exec_command', 'apply_patch', 'Read', 'spawn_agent', 'mcp__filesystem__read_file', 'unknown_future_tool'])(
    'blocks %s before execution', (tool_name) => {
      const result = spawnSync(process.execPath, [helperPath, 'gate'], { input: JSON.stringify({ tool_name }), encoding: 'utf8', timeout: 5000 });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
      expect(result.stdout).toContain('mcp__vibisual_edges__dispatch');
    },
  );
  it.each(['mcp__vibisual_edges__dispatch', 'update_plan', 'request_user_input'])('allows %s', (tool_name) => {
    const result = spawnSync(process.execPath, [helperPath, 'gate'], { input: JSON.stringify({ tool_name }), encoding: 'utf8', timeout: 5000 });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
  });
  it('rejects malformed hook input', () => {
    const result = spawnSync(process.execPath, [helperPath, 'gate'], { input: 'not JSON', timeout: 5000, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });
  it('installs the gate for new and resumed turns, overriding web search without opening networking', () => {
    for (const resumeThreadId of [undefined, 'old-thread']) {
      const args = buildCodexExecArgs({ cwd: '/project', model: 'test', edgeConfig: config, resumeThreadId, webSearch: 'live', networkAccess: false });
      expect(args).toContain('web_search="disabled"');
      expect(args.indexOf('web_search="disabled"')).toBeGreaterThan(args.indexOf('web_search=live'));
      expect(args).toContain('features.shell_tool=false');
      expect(args).toContain('sandbox_workspace_write.network_access=false');
      expect(args.some((arg) => arg.startsWith('hooks.PreToolUse='))).toBe(true);
    }
  });
  it('removes restrictions for shared/AUTO or deleted edges on the next turn', () => {
    const shared = codexEdgeOverrides({ ...config, restrictedTools: [] });
    expect(shared.some((arg) => arg.startsWith('hooks.') || arg.startsWith('features.') || arg.startsWith('web_search='))).toBe(false);
    expect(buildCodexExecArgs({ cwd: '/project', model: 'test' }).some((arg) => arg.includes('vibisual_edges'))).toBe(false);
    expect(codexEdgeInstructions(config)).toContain('All direct executable tools are blocked');
  });
});

it('MCP bridge sends authenticated raw instructions and returns results/errors, rejecting unconnected edges locally', async () => {
  const received: { url: string; body: string; token?: string; source?: string }[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({ url: req.url!, body, token: req.headers['x-vibisual-hook-token'] as string, source: req.headers['x-vibisual-source-agent'] as string });
    res.writeHead(body === 'fail' ? 403 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body === 'fail' ? { error: 'source mismatch' } : { ok: true, result: 'target finished', waited: true }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const child = spawn(process.execPath, [helperPath, 'mcp'], { env: { ...process.env,
    VIBISUAL_BASE: `http://127.0.0.1:${port}`, VIBISUAL_TOKEN: 'test-token', VIBISUAL_OWNER_AGENT_ID: 'source-a', VIBISUAL_CODEX_EDGE_IDS: '["edge-a"]',
  }, stdio: 'pipe', windowsHide: true });
  children.push(child);
  const waiting = new Map<number, (value: any) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const response = JSON.parse(line);
    waiting.get(response.id)?.(response.result);
    waiting.delete(response.id);
  });
  let id = 0;
  const rpc = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
    const current = ++id;
    const timeout = setTimeout(() => reject(new Error('MCP timeout')), 5000);
    waiting.set(current, (value) => { clearTimeout(timeout); resolve(value); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: current, method, params }) + '\n');
  });
  expect((await rpc('initialize', { protocolVersion: '2024-11-05' })).capabilities).toEqual({ tools: {} });
  expect((await rpc('tools/list')).tools[0].inputSchema.properties.edgeId.enum).toEqual(['edge-a']);
  const call = (edgeId: string, instruction: string) => rpc('tools/call', { name: 'dispatch', arguments: { edgeId, instruction } });
  expect((await call('not-connected', 'do work')).isError).toBe(true);
  expect((await call('edge-a', '  ')).isError).toBe(true);
  expect(received).toHaveLength(0);
  const instruction = '한글 "따옴표"\n$HOME `literal` \\ path';
  expect(JSON.parse((await call('edge-a', instruction)).content[0].text).result).toBe('target finished');
  expect(received[0]).toEqual({ url: '/api/task-edges/dispatch?edgeId=edge-a', body: instruction, token: 'test-token', source: 'source-a' });
  expect((await call('edge-a', 'fail')).isError).toBe(true);
});
