/**
 * §5.3 #10-2 ⑨ — the MCP bridge waits inside one tool call instead of handing an unchanged
 * `executing` back to the model. Timings are scaled down through VIBISUAL_EDGE_WAIT_TUNING.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { codexEdgeInstructions } from './codexEdges.js';

const helperPath = fileURLToPath(new URL('../../../../hooks/codex-edges.mjs', import.meta.url));
const children: ChildProcessWithoutNullStreams[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

interface Tuning { callWaitMs?: number; lookupWaitMs?: number; retryMinMs?: number; retryMaxMs?: number }
interface FixtureOptions {
  tuning: Tuning;
  /** Job length after dispatch; omitted = finishes only through `finish(cmdId)`. */
  jobMs?: number;
  /** false = every lookup answers at once, the protocol before ⑨. */
  holds: boolean;
  /** Answers a lookup itself when it returns true. */
  intercept?: (cmdId: string, res: ServerResponse) => boolean;
}

/** A loopback dispatch ledger plus a real bridge process speaking MCP over stdio. */
async function startBridge(options: FixtureOptions) {
  const stats = { posts: 0, lookups: 0, instantLookups: 0, heldLookups: 0, closedHolds: 0, cancels: 0 };
  const jobs = new Map<string, { finished: boolean; listeners: Set<() => void> }>();
  const finish = (cmdId: string) => {
    const job = jobs.get(cmdId);
    if (!job || job.finished) return;
    job.finished = true;
    for (const listener of [...job.listeners]) listener();
  };
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk;
    const url = new URL(req.url!, 'http://127.0.0.1');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && url.pathname === '/api/task-edges/dispatch') {
      const cmdId = `job-${++stats.posts}`;
      jobs.set(cmdId, { finished: false, listeners: new Set() });
      if (options.jobMs !== undefined) setTimeout(() => finish(cmdId), options.jobMs).unref();
      res.end(JSON.stringify({ ok: true, cmdId, status: 'executing', waitForResult: true }));
      return;
    }
    if (req.method === 'POST') { stats.cancels++; res.end('{}'); return; }
    const cmdId = decodeURIComponent(url.pathname.split('/').pop()!);
    stats.lookups++;
    const waitMs = Number(url.searchParams.get('waitMs') ?? 0);
    if (!(waitMs > 0)) stats.instantLookups++;
    if (options.intercept?.(cmdId, res)) return;
    const job = jobs.get(cmdId);
    if (!job) { res.writeHead(404); res.end(JSON.stringify({ ok: false, error: 'not found' })); return; }
    const view = () => (job.finished ? { cmdId, status: 'completed', result: `result of ${cmdId}` } : { cmdId, status: 'executing' });
    if (options.holds && waitMs > 0 && !job.finished) {
      stats.heldLookups++;
      const closed = await new Promise<boolean>((resolve) => {
        const done = (value: boolean) => { clearTimeout(timer); job.listeners.delete(onFinish); res.off('close', onClose); resolve(value); };
        const onFinish = () => done(false);
        const onClose = () => done(true);
        const timer = setTimeout(() => done(false), waitMs);
        job.listeners.add(onFinish);
        res.on('close', onClose);
      });
      if (closed) { stats.closedHolds++; return; }
      const held = view();
      res.end(JSON.stringify({ ok: true, job: held, waited: true, ...(held.status === 'completed' ? {} : { timedOut: true }) }));
      return;
    }
    res.end(JSON.stringify({ ok: true, job: view() }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const child = spawn(process.execPath, [helperPath, 'mcp'], { env: { ...process.env,
    VIBISUAL_EDGE_WAIT_TUNING: JSON.stringify(options.tuning),
    VIBISUAL_BASE: `http://127.0.0.1:${port}`, VIBISUAL_TOKEN: 'test-token', VIBISUAL_OWNER_AGENT_ID: 'source-a', VIBISUAL_CODEX_EDGE_IDS: '["edge-a"]',
  }, stdio: 'pipe', windowsHide: true });
  children.push(child);
  const responses = new Map<number, any>();
  const waiting = new Map<number, (value: any) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line);
    responses.set(message.id, message.result);
    waiting.get(message.id)?.(message.result);
    waiting.delete(message.id);
  });
  let id = 0;
  const start = (method: string, params: object = {}) => {
    const current = ++id;
    const done = new Promise<any>((resolve) => waiting.set(current, resolve));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: current, method, params }) + '\n');
    return { id: current, done };
  };
  const rpc = (method: string, params: object = {}) => start(method, params).done;
  const notify = (method: string, params: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  await rpc('initialize', { protocolVersion: '2024-11-05' });
  return { stats, start, rpc, notify, responses, child, finish };
}

type Bridge = Awaited<ReturnType<typeof startBridge>>;
const dispatchCall = { name: 'dispatch', arguments: { edgeId: 'edge-a', instruction: 'long task' } };

/** What the model does with the tools: dispatch once, then call status only while the reply is pending. */
async function delegateLikeAModel(bridge: Bridge) {
  const replies: { value: any; isError?: boolean }[] = [];
  let reply = await bridge.rpc('tools/call', dispatchCall);
  for (let turn = 0; turn < 200; turn++) {
    const value = JSON.parse(reply.content[0].text);
    replies.push({ value, isError: reply.isError });
    if (!value.pending) {
      return { replies, final: value, pendingReturns: replies.filter((r) => r.value.pending).length, statusCalls: replies.length - 1 };
    }
    reply = await bridge.rpc('tools/call', { name: 'status', arguments: { cmdId: value.cmdId } });
  }
  throw new Error('status kept returning pending');
}

it('the same delayed job hands the model no pending replies once lookups wait (scaled 1:100)', async () => {
  const jobMs = 2000; // a child task of about 200 seconds
  // Before ⑨: 45s per call made of instant lookups 1s apart.
  const legacy = await startBridge({ jobMs, holds: false, tuning: { callWaitMs: 450, lookupWaitMs: 0, retryMinMs: 10, retryMaxMs: 10 } });
  const before = await delegateLikeAModel(legacy);
  // Now: 30 minutes per call made of 60s holds, backoff 1s→10s.
  const current = await startBridge({ jobMs, holds: true, tuning: { callWaitMs: 18_000, lookupWaitMs: 600, retryMinMs: 10, retryMaxMs: 100 } });
  const after = await delegateLikeAModel(current);
  console.info('EDGE_WAIT_COMPARISON', JSON.stringify({
    jobMs,
    before: { pendingReturns: before.pendingReturns, statusCalls: before.statusCalls, lookups: legacy.stats.lookups },
    after: { pendingReturns: after.pendingReturns, statusCalls: after.statusCalls, lookups: current.stats.lookups },
  }));
  for (const run of [before, after]) expect(run.final).toMatchObject({ ok: true, cmdId: 'job-1', status: 'completed', result: 'result of job-1' });
  expect(before.pendingReturns).toBeGreaterThanOrEqual(3);
  expect(before.statusCalls).toBe(before.pendingReturns);
  expect(after.pendingReturns).toBe(0);
  expect(after.statusCalls).toBe(0);
  expect(current.stats.lookups).toBeLessThanOrEqual(6);
  expect(current.stats.lookups).toBeLessThan(legacy.stats.lookups);
  expect(current.stats.instantLookups).toBe(0);
  expect([legacy.stats.posts, current.stats.posts]).toEqual([1, 1]);
}, 30_000);

it('a job that outlasts one call stays retrievable by the same cmdId, without re-dispatch or an error flag', async () => {
  const bridge = await startBridge({ jobMs: 1500, holds: true, tuning: { callWaitMs: 400, lookupWaitMs: 150, retryMinMs: 10, retryMaxMs: 100 } });
  const run = await delegateLikeAModel(bridge);
  expect(run.pendingReturns).toBeGreaterThanOrEqual(1);
  for (const { value, isError } of run.replies.slice(0, -1)) {
    // Pending is neither success nor a tool error.
    expect(isError).toBeUndefined();
    expect(value).toMatchObject({ ok: false, pending: true, cmdId: 'job-1', status: 'executing' });
    expect(value.waitedMs).toBeGreaterThanOrEqual(400);
    expect(value.next).toContain('Call status with this cmdId');
    expect(value.next).toContain('do not repeat an unchanged progress update');
  }
  expect(run.replies[run.replies.length - 1]?.isError).toBeUndefined();
  expect(run.final).toMatchObject({ ok: true, cmdId: 'job-1', status: 'completed', result: 'result of job-1' });
  expect(bridge.stats.posts).toBe(1);
  expect(bridge.stats.instantLookups).toBe(0);
}, 30_000);

it('notifications/cancelled stops only that wait: no reply, the held lookup closes, the job keeps its result', async () => {
  const bridge = await startBridge({ holds: true, tuning: { callWaitMs: 30_000, lookupWaitMs: 20_000 } });
  const call = bridge.start('tools/call', dispatchCall);
  await vi.waitFor(() => expect(bridge.stats.heldLookups).toBe(1));
  bridge.notify('notifications/cancelled', { requestId: call.id, reason: 'user interrupted' });
  await vi.waitFor(() => expect(bridge.stats.closedHolds).toBe(1));
  // The bridge stays responsive and never answers the cancelled call.
  expect(await bridge.rpc('ping')).toEqual({});
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(bridge.responses.has(call.id)).toBe(false);
  expect(bridge.stats.cancels).toBe(0);

  // waitSeconds 0 is a single immediate look.
  const lookupsBefore = bridge.stats.lookups;
  const quick = await bridge.rpc('tools/call', { name: 'status', arguments: { cmdId: 'job-1', waitSeconds: 0 } });
  expect(quick.isError).toBeUndefined();
  expect(JSON.parse(quick.content[0].text)).toMatchObject({ ok: false, pending: true, status: 'executing' });
  expect(bridge.stats.lookups - lookupsBefore).toBe(1);
  expect(bridge.stats.instantLookups).toBe(1);

  // Waiting again on the same cmdId receives the result that finishes meanwhile.
  const resumed = bridge.start('tools/call', { name: 'status', arguments: { cmdId: 'job-1' } });
  await vi.waitFor(() => expect(bridge.stats.heldLookups).toBe(2));
  bridge.finish('job-1');
  const done = await resumed.done;
  expect(done.isError).toBeUndefined();
  expect(JSON.parse(done.content[0].text)).toMatchObject({ ok: true, status: 'completed', result: 'result of job-1' });
  expect(bridge.stats.posts).toBe(1);
}, 30_000);

it('closing stdin ends every wait without a reply or a cancel request', async () => {
  const bridge = await startBridge({ holds: true, tuning: { callWaitMs: 30_000, lookupWaitMs: 20_000 } });
  const call = bridge.start('tools/call', dispatchCall);
  await vi.waitFor(() => expect(bridge.stats.heldLookups).toBe(1));
  bridge.child.stdin.end();
  await vi.waitFor(() => expect(bridge.stats.closedHolds).toBe(1));
  await vi.waitFor(() => expect(bridge.child.exitCode).not.toBeNull(), { timeout: 10_000 });
  expect(bridge.responses.has(call.id)).toBe(false);
  expect(bridge.stats.cancels).toBe(0);
}, 30_000);

it('a rejected lookup ends at once instead of inviting another status call; 5xx retries inside the call', async () => {
  let unavailable = 2;
  const bridge = await startBridge({ holds: true, tuning: { callWaitMs: 5000, lookupWaitMs: 1000, retryMinMs: 10, retryMaxMs: 40 },
    intercept: (cmdId, res) => {
      if (cmdId === 'forbidden') { res.writeHead(403); res.end(JSON.stringify({ ok: false, error: 'forbidden' })); return true; }
      if (cmdId !== 'flaky') return false;
      if (unavailable-- > 0) { res.writeHead(503); res.end('busy'); return true; }
      res.end(JSON.stringify({ ok: true, job: { cmdId, status: 'completed', result: 'answered after retries' } }));
      return true;
    } });
  for (const cmdId of ['missing', 'forbidden']) {
    const before = bridge.stats.lookups;
    const reply = await bridge.rpc('tools/call', { name: 'status', arguments: { cmdId } });
    const value = JSON.parse(reply.content[0].text);
    expect(reply.isError).toBe(true);
    expect(value.ok).toBe(false);
    expect(value.pending).toBeUndefined();
    expect(value.next).toContain('will not change the answer');
    expect(bridge.stats.lookups - before).toBe(1);
  }
  const before = bridge.stats.lookups;
  const flaky = await bridge.rpc('tools/call', { name: 'status', arguments: { cmdId: 'flaky' } });
  const value = JSON.parse(flaky.content[0].text);
  expect(flaky.isError).toBeUndefined();
  expect(value).toMatchObject({ ok: true, status: 'completed', result: 'answered after retries' });
  expect(value.connectionError).toBeUndefined();
  expect(bridge.stats.lookups - before).toBe(3);
}, 30_000);

it('validates waitSeconds locally and tells the model each call already waits', async () => {
  const bridge = await startBridge({ holds: true, tuning: {} });
  for (const waitSeconds of [-1, 1.5, 1801, '10']) {
    const reply = await bridge.rpc('tools/call', { name: 'status', arguments: { cmdId: 'job-1', waitSeconds } });
    expect(reply.isError).toBe(true);
    expect(reply.content[0].text).toContain('waitSeconds must be an integer from 0 to 1800');
  }
  expect(bridge.stats.lookups).toBe(0);
  const status = (await bridge.rpc('tools/list')).tools.find((tool: { name: string }) => tool.name === 'status');
  expect(status.inputSchema.properties.waitSeconds).toMatchObject({ type: 'integer', minimum: 0, maximum: 1800 });
  expect(status.description).toContain('returns as soon as the task finishes');
  const instructions = codexEdgeInstructions({ helperPath, nodeBin: process.execPath, edgeIds: ['edge-a'], restrictedTools: [] });
  expect(instructions).toContain('wait inside the call until the delegated task finishes');
  expect(instructions).toContain('do not send the user another progress update unless something changed');
}, 30_000);
