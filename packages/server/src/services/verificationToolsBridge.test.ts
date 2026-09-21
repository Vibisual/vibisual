import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { VerificationAction, VerificationCheck } from '@vibisual/shared';

const helperPath = fileURLToPath(new URL('../../../../hooks/verification-tools.mjs', import.meta.url));
type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
type Reply = { id: number; result?: { content?: Content[]; isError?: boolean; tools?: { name: string; inputSchema: { required: string[] } }[]; serverInfo?: { name: string } }; error?: { code: number } };
type Received = { url: string; headers: IncomingMessage['headers']; body: Record<string, unknown> };
const children: ChildProcessWithoutNullStreams[] = [];
const servers: Server[] = [];
const cleanups: (() => void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    await new Promise<void>((resolve) => { child.once('close', () => resolve()); child.kill(); });
  }
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fixture(responder?: (request: Received, response: ServerResponse) => void): Promise<{ base: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = { url: req.url ?? '', headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> };
    received.push(request);
    if (responder) { responder(request, res); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'actual observation' }, { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }] }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  return { base: `http://127.0.0.1:${address.port}`, received };
}

function bridge(base: string, extraEnv: Record<string, string> = {}): {
  child: ChildProcessWithoutNullStreams; replies: Reply[];
  send: (message: unknown) => void;
  call: (method: string, params?: unknown) => Promise<Reply>;
} {
  const child = spawn(process.execPath, [helperPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
    ...process.env, VIBISUAL_BASE: base, VIBISUAL_TOKEN: 'fixture-token', VIBISUAL_HOOK_AUTH: '',
    VIBISUAL_OWNER_AGENT_ID: 'agent-fixture', VIBISUAL_SUBAGENT_ID: 'sub-fixture', ...extraEnv,
  } });
  children.push(child);
  const replies: Reply[] = [];
  const pending = new Map<number, (reply: Reply) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  cleanups.push(() => { for (const timer of timers) clearTimeout(timer); });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const reply = JSON.parse(line) as Reply;
    replies.push(reply);
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  let sequence = 0;
  const send = (message: unknown): void => { child.stdin.write(JSON.stringify(message) + '\n'); };
  return { child, replies, send, call: (method, params) => {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} timed out`)); }, 5000);
      timers.add(timer);
      pending.set(id, (reply) => { clearTimeout(timer); timers.delete(timer); resolve(reply); });
      send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
    });
  } };
}

describe('spawned verification MCP bridge', () => {
  it('initializes and lists all five tools with explicit run identities', async () => {
    const { base, received } = await fixture();
    const client = bridge(base);
    const initialized = await client.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } });
    expect(initialized.result?.serverInfo?.name).toBe('vibisual_verify');
    client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const listed = await client.call('tools/list');
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual(['observe', 'act', 'check', 'replay', 'finalize']);
    expect(listed.result?.tools?.every((tool) => tool.inputSchema.required.includes('runId'))).toBe(true);
    expect(received).toHaveLength(0);
  });

  it('authenticates all operations, preserves Unicode typed actions and forwards actual MCP images', async () => {
    const { base, received } = await fixture();
    const client = bridge(base);
    const action: VerificationAction = { kind: 'fill', selector: '#name', text: '검수 입력' };
    const check: VerificationCheck = { kind: 'value', selector: '#name', expected: '검수 입력' };
    for (const [name, args] of [
      ['observe', {}], ['act', { action, stepIndex: 0 }], ['check', { check, stepIndex: 0 }],
      ['replay', {}], ['finalize', { verdict: 'pass', reason: '실제 화면 확인' }],
    ] as const) {
      const reply = await client.call('tools/call', { name, arguments: { runId: 'run-fixture', ...args } });
      expect(reply.result?.isError).toBeUndefined();
      expect(reply.result?.content?.[1]).toEqual({ type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' });
    }
    expect(received.map((r) => r.url)).toEqual(['observe', 'act', 'check', 'replay', 'finalize'].map((op) => `/api/verification-tools/${op}`));
    for (const request of received) {
      expect(request.headers['x-vibisual-hook-token']).toBe('fixture-token');
      expect(request.headers['x-vibisual-source-agent']).toBe('agent-fixture');
      expect(request.headers['x-vibisual-source-subagent']).toBe('sub-fixture');
      expect(request.body.runId).toBe('run-fixture');
    }
    expect(received[1]?.body.action).toEqual(action);
  });

  it('supports the auth alias without persisting it in tool arguments', async () => {
    const { base, received } = await fixture();
    const client = bridge(base, { VIBISUAL_TOKEN: '', VIBISUAL_HOOK_AUTH: 'alias-token' });
    await client.call('tools/call', { name: 'observe', arguments: { runId: 'run-fixture' } });
    expect(received[0]?.headers['x-vibisual-hook-token']).toBe('alias-token');
    expect(received[0]?.body).toEqual({ runId: 'run-fixture' });
  });

  it('refuses malformed, unknown, unowned and non-loopback calls before HTTP', async () => {
    const { base, received } = await fixture();
    const client = bridge(base);
    for (const params of [
      { name: 'start', arguments: { runId: 'r' } }, { name: 'observe', arguments: {} },
      { name: 'observe', arguments: { runId: 'r', ownerAgentId: 'forged' } },
      { name: 'act', arguments: { runId: 'r', stepIndex: -1 } },
    ]) expect((await client.call('tools/call', params)).result?.isError).toBe(true);
    const missing = bridge(base, { VIBISUAL_TOKEN: '', VIBISUAL_HOOK_AUTH: '' });
    expect((await missing.call('tools/call', { name: 'observe', arguments: { runId: 'r' } })).result?.isError).toBe(true);
    const external = bridge('http://example.invalid');
    expect((await external.call('tools/call', { name: 'observe', arguments: { runId: 'r' } })).result?.isError).toBe(true);
    expect(received).toHaveLength(0);
  });

  it('returns server failures and malformed evidence as errors without automatic retries', async () => {
    const { base, received } = await fixture((req, res) => {
      if (req.body.runId === 'denied') { res.writeHead(403); res.end('wrong owner'); }
      else if (req.body.runId === 'bad-evidence') res.end(JSON.stringify({ ok: true }));
      else res.end(JSON.stringify({ isError: true, content: [{ type: 'text', text: 'target closed' }] }));
    });
    const client = bridge(base);
    for (const runId of ['denied', 'bad-evidence', 'target-closed']) {
      expect((await client.call('tools/call', { name: 'observe', arguments: { runId } })).result?.isError).toBe(true);
    }
    expect(received).toHaveLength(3);
  });

  it('cancels the in-flight HTTP request and remains responsive to other MCP requests', async () => {
    let entered!: () => void;
    let closed!: () => void;
    const requestEntered = new Promise<void>((resolve) => { entered = resolve; });
    const requestClosed = new Promise<void>((resolve) => { closed = resolve; });
    const { base } = await fixture((_req, res) => { res.on('close', closed); entered(); });
    const client = bridge(base);
    client.send({ jsonrpc: '2.0', id: 90, method: 'tools/call', params: { name: 'observe', arguments: { runId: 'r' } } });
    await requestEntered;
    client.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 90 } });
    await requestClosed;
    expect((await client.call('ping')).result).toEqual({});
    expect(client.replies.some((reply) => reply.id === 90)).toBe(false);
  });

  it('does not whitelist verification around mandatory delegation', () => {
    const gate = fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [gate, 'gate'], { windowsHide: true, input: JSON.stringify({ tool_name: 'mcp__vibisual_verify__act' }), encoding: 'utf8', timeout: 5000 });
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('aborts an outstanding observation when the engine closes its stdin pipe', async () => {
    let entered!: () => void;
    let closed!: () => void;
    const requestEntered = new Promise<void>((resolve) => { entered = resolve; });
    const requestClosed = new Promise<void>((resolve) => { closed = resolve; });
    const { base } = await fixture((_req, res) => { res.on('close', closed); entered(); });
    const client = bridge(base);
    client.send({ jsonrpc: '2.0', id: 90, method: 'tools/call', params: { name: 'observe', arguments: { runId: 'r' } } });
    await requestEntered;
    client.child.stdin.end();
    await requestClosed;
    expect(client.replies).toHaveLength(0);
  });

  it('does not follow HTTP redirects with the app token', async () => {
    const destination = await fixture();
    const { base } = await fixture((_req, res) => { res.writeHead(307, { Location: `${destination.base}/leak` }); res.end(); });
    const client = bridge(base);
    const reply = await client.call('tools/call', { name: 'observe', arguments: { runId: 'r' } });
    expect(reply.result?.isError).toBe(true);
    expect(destination.received).toHaveLength(0);
  });
});
