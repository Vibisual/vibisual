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
  it.each(['mcp__vibisual_edges__dispatch', 'mcp__vibisual_edges__status', 'update_plan', 'request_user_input'])('allows %s', (tool_name) => {
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
  let polls = 0;
  let lostKey: string | undefined;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({ url: req.url!, body, token: req.headers['x-vibisual-hook-token'] as string, source: req.headers['x-vibisual-source-agent'] as string });
    if (req.method === 'GET') {
      polls++;
      if (polls === 1) { res.destroy(); return; }
      const cmdId = new URL(req.url!, 'http://127.0.0.1').pathname.split('/').pop()!;
      if (cmdId === 'missing') { res.writeHead(404); res.end('not found'); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, job: { cmdId, status: cmdId === 'pending' ? 'executing' : cmdId === 'cancelled' ? 'cancelled' : cmdId === 'failed' ? 'error' : 'completed', result: 'recovered result', ...(cmdId === 'limited' ? { usageLimit: { at: 1 } } : {}) } }));
      return;
    }
    expect(req.headers['x-vibisual-request-key']).toBeTruthy();
    if (body === 'pending') {
      res.end(JSON.stringify({ ok: true, cmdId: 'pending', status: 'executing', waitForResult: true, timeoutMs: 20 })); return;
    }
    if (body === 'lost acknowledgement' && !lostKey) {
      lostKey = req.headers['x-vibisual-request-key'] as string;
      res.destroy(); return;
    }
    if (body === 'lost acknowledgement') expect(req.headers['x-vibisual-request-key']).toBe(lostKey);
    if (body === 'poll' || body === 'lost acknowledgement' || body === 'one way') {
      res.end(JSON.stringify({ ok: true, cmdId: 'existing', status: 'executing', waitForResult: body !== 'one way' }));
      return;
    }
    res.writeHead(body === 'fail' ? 403 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body === 'fail' ? { error: 'source mismatch' } : { ok: true, result: 'target finished', waited: true }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const child = spawn(process.execPath, [helperPath, 'mcp'], { env: { ...process.env,
    VIBISUAL_EDGE_WAIT_TUNING: JSON.stringify({ callWaitMs: 300, lookupWaitMs: 10, retryMinMs: 5, retryMaxMs: 20 }),
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
  expect(received[0]).toEqual({ url: '/api/task-edges/dispatch?edgeId=edge-a&wait=false', body: instruction, token: 'test-token', source: 'source-a' });
  expect((await call('edge-a', 'fail')).isError).toBe(true);
  const pollingStart = received.length;
  expect(JSON.parse((await call('edge-a', 'poll')).content[0].text).result).toBe('recovered result');
  expect(received.slice(pollingStart).filter((r) => r.body === 'poll')).toHaveLength(1);
  expect(polls).toBe(2);
  const beforeOneWay = polls;
  expect(JSON.parse((await call('edge-a', 'one way')).content[0].text).status).toBe('executing');
  expect(polls).toBe(beforeOneWay);
  for (const cmdId of ['cancelled', 'limited', 'failed', 'missing']) {
    expect((await rpc('tools/call', { name: 'status', arguments: { cmdId } })).isError).toBe(true);
  }
  const pending = JSON.parse((await call('edge-a', 'pending')).content[0].text);
  expect(pending).toMatchObject({ ok: false, cmdId: 'pending', status: 'executing', pending: true });
  expect(pending.next).toContain('Do not dispatch it again');
  const lost = await call('edge-a', 'lost acknowledgement');
  expect(lost.isError).toBe(true);
  expect(JSON.parse(lost.content[0].text).requestKey).toBe(lostKey);
  const recovered = await rpc('tools/call', { name: 'dispatch', arguments: { edgeId: 'edge-a', instruction: 'lost acknowledgement', requestKey: lostKey } });
  expect(JSON.parse(recovered.content[0].text).result).toBe('recovered result');
  expect(received.filter((r) => r.url.includes('/dispatch/existing')).every((r) => r.token === 'test-token' && r.source === 'source-a')).toBe(true);
});

describe('§5.3 #10-2 delegated status on Codex turns', () => {
  const checker: CodexEdgeConfig = { ...config, edgeIds: [], restrictedTools: [], statusCmdIds: ['job-x'] };

  it('approves only the read-only status tool per tool, without widening approval policy, sandbox or restrictions', () => {
    const overrides = codexEdgeOverrides(checker);
    expect(overrides).toContain('mcp_servers.vibisual_edges.tools.status.approval_mode="approve"');
    expect(overrides.some((arg) => /approval_policy|sandbox_mode|sandbox_workspace_write|dangerously/.test(arg))).toBe(false);
    const args = buildCodexExecArgs({ cwd: '/project', model: 'test', edgeConfig: checker });
    expect(args).toContain('mcp_servers.vibisual_edges.tools.status.approval_mode="approve"');
    expect(args.some((arg) => arg.startsWith('hooks.PreToolUse=') || arg === 'features.shell_tool=false')).toBe(false);
  });

  it('describes only the status tool to a checker without connected edges, and the grant option to a turn with edges', () => {
    const text = codexEdgeInstructions(checker);
    expect(text).toContain('mcp__vibisual_edges__status');
    expect(text).toContain('job-x');
    expect(text).not.toContain('mcp__vibisual_edges__dispatch');
    expect(codexEdgeInstructions({ ...checker, statusCmdIds: [] })).toBe('');
    expect(codexEdgeInstructions(config)).toContain('statusCmdIds');
  });

  async function startBridge(port: number, ownerAgentId: string, edgeIds: string[]) {
    const child = spawn(process.execPath, [helperPath, 'mcp'], { env: { ...process.env,
      VIBISUAL_EDGE_WAIT_TUNING: JSON.stringify({ callWaitMs: 300, lookupWaitMs: 10, retryMinMs: 5, retryMaxMs: 20 }),
      VIBISUAL_BASE: `http://127.0.0.1:${port}`, VIBISUAL_TOKEN: 'test-token', VIBISUAL_OWNER_AGENT_ID: ownerAgentId, VIBISUAL_CODEX_EDGE_IDS: JSON.stringify(edgeIds),
    }, stdio: 'pipe', windowsHide: true });
    children.push(child);
    const waiting = new Map<number, (value: any) => void>();
    createInterface({ input: child.stdout }).on('line', (line) => {
      const response = JSON.parse(line);
      waiting.get(response.id)?.(response.result);
      waiting.delete(response.id);
    });
    let id = 0;
    return (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
      const current = ++id;
      const timeout = setTimeout(() => reject(new Error('MCP timeout')), 5000);
      waiting.set(current, (value) => { clearTimeout(timeout); resolve(value); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: current, method, params }) + '\n');
    });
  }

  it('MCP bridge lists status as read-only, hides dispatch without edges, sends its own id and forwards grants', async () => {
    const received: { method: string; url: string; source?: string; grants?: string }[] = [];
    const server = createServer(async (req, res) => {
      for await (const chunk of req) void chunk;
      const grants = req.headers['x-vibisual-status-cmd-ids'] as string | undefined;
      received.push({ method: req.method!, url: req.url!, source: req.headers['x-vibisual-source-agent'] as string, grants });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST') {
        if (grants === 'job-z') { res.writeHead(403); res.end(JSON.stringify({ ok: false, error: 'status-grant-forbidden', cmdId: 'job-z' })); return; }
        res.end(JSON.stringify({ ok: true, cmdId: 'job-y', status: 'executing', waitForResult: false }));
        return;
      }
      const cmdId = new URL(req.url!, 'http://127.0.0.1').pathname.split('/').pop()!;
      if (cmdId === 'job-z') { res.writeHead(403); res.end(JSON.stringify({ ok: false, error: 'forbidden' })); return; }
      res.end(JSON.stringify({ ok: true, job: { cmdId, status: 'completed', result: 'granted result' } }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    // 위임받아 확인만 하는 턴 — 연결된 엣지가 없어도 status 는 있다.
    const checkerRpc = await startBridge(port, 'agent-checker', []);
    await checkerRpc('initialize', { protocolVersion: '2024-11-05' });
    const checkerTools = (await checkerRpc('tools/list')).tools;
    expect(checkerTools.map((tool: { name: string }) => tool.name)).toEqual(['status']);
    expect(checkerTools[0].annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const granted = await checkerRpc('tools/call', { name: 'status', arguments: { cmdId: 'job-x' } });
    expect(granted.isError).toBeUndefined();
    expect(JSON.parse(granted.content[0].text)).toMatchObject({ ok: true, result: 'granted result' });
    expect(received.at(-1)).toMatchObject({ method: 'GET', source: 'agent-checker' });
    expect(received.at(-1)?.url.startsWith('/api/task-edges/dispatch/job-x')).toBe(true);
    const refused = await checkerRpc('tools/call', { name: 'status', arguments: { cmdId: 'job-z' } });
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.content[0].text).next).toContain('rejected');
    // 거절은 되묻지 않는다 — 같은 403 을 되풀이해 도는 폴링이 없다.
    expect(received.filter((r) => r.url.includes('/dispatch/job-z'))).toHaveLength(1);
    const beforeDispatch = received.length;
    expect((await checkerRpc('tools/call', { name: 'dispatch', arguments: { edgeId: 'edge-a', instruction: 'work' } })).isError).toBe(true);
    expect(received).toHaveLength(beforeDispatch);

    // 확인을 맡기는 부모 턴 — 목록은 헤더 하나로 가고, 모양이 틀리면 보내지 않는다.
    const parentRpc = await startBridge(port, 'agent-parent', ['edge-a']);
    await parentRpc('initialize', { protocolVersion: '2024-11-05' });
    const parentTools = (await parentRpc('tools/list')).tools;
    expect(parentTools.map((tool: { name: string }) => tool.name)).toEqual(['dispatch', 'status']);
    expect(parentTools[0].inputSchema.properties.statusCmdIds).toMatchObject({ type: 'array', maxItems: 20 });
    const dispatch = (statusCmdIds: unknown) => parentRpc('tools/call', { name: 'dispatch', arguments: { edgeId: 'edge-a', instruction: 'check job-x', statusCmdIds } });
    const beforeInvalid = received.length;
    for (const invalid of [['job-x,job-z'], 'job-x', [1], Array.from({ length: 21 }, (_, i) => `job-${i}`)]) {
      expect((await dispatch(invalid)).isError).toBe(true);
    }
    expect(received).toHaveLength(beforeInvalid);
    expect((await dispatch(['job-x', 'job-w'])).isError).toBeUndefined();
    expect(received.at(-1)).toMatchObject({ method: 'POST', source: 'agent-parent', grants: 'job-x,job-w' });
    expect((await parentRpc('tools/call', { name: 'dispatch', arguments: { edgeId: 'edge-a', instruction: 'plain' } })).isError).toBeUndefined();
    expect(received.at(-1)?.grants).toBeUndefined();
    const forbiddenGrant = await dispatch(['job-z']);
    expect(forbiddenGrant.isError).toBe(true);
    expect(JSON.parse(forbiddenGrant.content[0].text).next).toContain('no task was created');
  });
});

describe('§5.3 #10-2 unreceived dispatch results on Codex turns', () => {
  const resuming: CodexEdgeConfig = { ...config, edgeIds: [], restrictedTools: [], pendingResults: [{ cmdId: 'cmd-a', status: 'executing' }, { cmdId: 'cmd-b', status: 'error' }] };

  it('lets the MCP process see the session id that ties a result to this turn', () => {
    const envVars = codexEdgeOverrides(resuming).find((arg) => arg.startsWith('mcp_servers.vibisual_edges.env_vars='));
    expect(JSON.parse(envVars!.slice('mcp_servers.vibisual_edges.env_vars='.length))).toContain('VIBISUAL_SUBAGENT_ID');
  });

  it('tells the next turn to resume by cmdId with status, with or without connected edges, and says nothing when none are waiting', () => {
    const alone = codexEdgeInstructions(resuming);
    expect(alone).toContain('# Codex edge tools');
    expect(alone).toContain('cmd-a (executing), cmd-b (error)');
    expect(alone).toContain('Call mcp__vibisual_edges__status with each cmdId');
    expect(alone).toContain('do not dispatch the same work again');
    expect(alone).not.toContain('mcp__vibisual_edges__dispatch to call');
    const withEdges = codexEdgeInstructions({ ...config, pendingResults: resuming.pendingResults });
    expect(withEdges).toContain('mcp__vibisual_edges__dispatch to call');
    expect(withEdges).toContain('cmd-a (executing), cmd-b (error)');
    expect(codexEdgeInstructions({ ...resuming, pendingResults: [] })).toBe('');
    expect(codexEdgeInstructions(config)).not.toContain('have not handed their finished result');
  });

  it('MCP bridge resumes by the same cmdId after a lookup outage, delivers failed results as failures and never dispatches twice', async () => {
    const posts: { body: string; subagent?: string }[] = [];
    const lookups = new Map<string, number>();
    let outage = true;
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST') {
        posts.push({ body, subagent: req.headers['x-vibisual-source-subagent'] as string | undefined });
        const cmdId = `cmd-${body}`;
        // The server's acknowledgement for a job that must return a result: not ok, pending, with its own next.
        res.end(JSON.stringify({ ok: false, dispatched: true, cmdId, status: 'executing', waitForResult: true, pending: true, next: 'stale acknowledgement' }));
        return;
      }
      const cmdId = new URL(req.url!, 'http://127.0.0.1').pathname.split('/').pop()!;
      const seen = (lookups.get(cmdId) ?? 0) + 1;
      lookups.set(cmdId, seen);
      const job = (value: object) => res.end(JSON.stringify({ ok: true, job: { cmdId, ...value } }));
      if (cmdId === 'cmd-flaky') {
        if (seen === 1) { res.writeHead(503); res.end('{"ok":false}'); return; }
        if (seen === 2) { job({ status: 'executing' }); return; }
        job({ status: 'completed', result: 'late result' });
        return;
      }
      if (cmdId === 'cmd-outage') {
        if (outage) { res.writeHead(503); res.end('{"ok":false}'); return; }
        job({ status: 'completed', result: 'result after outage' });
        return;
      }
      if (cmdId === 'cmd-broken') { job({ status: 'error', errorMessage: 'build failed' }); return; }
      res.writeHead(403); res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const child = spawn(process.execPath, [helperPath, 'mcp'], { env: { ...process.env,
      VIBISUAL_EDGE_WAIT_TUNING: JSON.stringify({ callWaitMs: 300, lookupWaitMs: 10, retryMinMs: 5, retryMaxMs: 20 }),
      VIBISUAL_BASE: `http://127.0.0.1:${port}`, VIBISUAL_TOKEN: 'test-token', VIBISUAL_OWNER_AGENT_ID: 'source-a', VIBISUAL_CODEX_EDGE_IDS: '["edge-a"]',
      VIBISUAL_SUBAGENT_ID: 'sub-parent-1',
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
    await rpc('initialize', { protocolVersion: '2024-11-05' });
    const dispatch = (instruction: string) => rpc('tools/call', { name: 'dispatch', arguments: { edgeId: 'edge-a', instruction } });
    const status = (cmdId: string) => rpc('tools/call', { name: 'status', arguments: { cmdId } });

    // Delayed completion behind one failed lookup: the call keeps waiting and returns the real result, without the stale pending marks.
    const flaky = await dispatch('flaky');
    expect(flaky.isError).toBeUndefined();
    const flakyValue = JSON.parse(flaky.content[0].text);
    expect(flakyValue).toMatchObject({ ok: true, cmdId: 'cmd-flaky', status: 'completed', result: 'late result' });
    expect(flakyValue).not.toHaveProperty('pending');
    expect(flakyValue).not.toHaveProperty('next');
    expect(flakyValue).not.toHaveProperty('connectionError');
    expect(lookups.get('cmd-flaky')).toBe(3);

    // A lookup outage longer than the call: a failure that keeps the cmdId, then the same cmdId resumes once lookups work again.
    const lost = await dispatch('outage');
    expect(lost.isError).toBe(true);
    expect(JSON.parse(lost.content[0].text)).toMatchObject({ ok: false, pending: true, cmdId: 'cmd-outage', status: 'executing' });
    outage = false;
    const resumed = await status('cmd-outage');
    expect(resumed.isError).toBeUndefined();
    expect(JSON.parse(resumed.content[0].text)).toMatchObject({ ok: true, cmdId: 'cmd-outage', status: 'completed', result: 'result after outage' });

    // A failed result is delivered as a failure, not as pending or success.
    const broken = await dispatch('broken');
    expect(broken.isError).toBe(true);
    const brokenValue = JSON.parse(broken.content[0].text);
    expect(brokenValue).toMatchObject({ ok: false, cmdId: 'cmd-broken', status: 'error', errorMessage: 'build failed' });
    expect(brokenValue).not.toHaveProperty('pending');

    // A refused lookup is a failure that names the cmdId and is not retried in a loop.
    const refused = await status('cmd-refused');
    expect(refused.isError).toBe(true);
    expect(JSON.parse(refused.content[0].text)).toMatchObject({ ok: false, cmdId: 'cmd-refused' });
    expect(lookups.get('cmd-refused')).toBe(1);

    expect(posts.map((post) => post.body)).toEqual(['flaky', 'outage', 'broken']);
    expect(posts.every((post) => post.subagent === 'sub-parent-1')).toBe(true);
  });
});
