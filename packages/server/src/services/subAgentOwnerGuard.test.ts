import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { hasForeignSubAgent, subAgentOwnerGuard, subAgentBodyOwnerGuard } from './subAgentOwnerGuard.js';

let server: Server;
let base: string;
let stopped: string[];

beforeEach(async (): Promise<void> => {
  stopped = [];
  const app = express();
  app.use(express.json());
  app.post(['/api/agent-questions', '/api/agent-review', '/api/agent-report'],
    subAgentBodyOwnerGuard((id) => id === 'sub-b' ? { parentAgentId: 'agent-b' } : undefined),
    (_req, res): void => { res.json({ ok: true }); });
  app.post('/api/subagents/:agentId/:subId/stop-session',
    subAgentOwnerGuard((id) => id === 'sub-b' ? { parentAgentId: 'agent-b' } : undefined),
    (req, res): void => { stopped.push(req.params.subId); res.json({ ok: true }); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server unavailable');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async (): Promise<void> => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe('session mutation ownership', (): void => {
  it.each(['questions', 'review', 'report'])('a %s card cannot name another live parent session; historical cards still work', async (kind) => {
    const send = (agentId: string, subAgentId: string) => fetch(`${base}/api/agent-${kind}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, subAgentId }),
    });
    expect((await send('agent-a', 'sub-b')).status).toBe(404);
    expect((await send('agent-b', 'sub-b')).status).toBe(200);
    expect((await send('agent-a', 'historical')).status).toBe(200);
  });
  it('a mixed close batch is rejected before either parent can be mutated', (): void => {
    const getSub = (id: string) => ({ parentAgentId: id === 'sub-a' ? 'agent-a' : 'agent-b' });
    expect(hasForeignSubAgent(getSub, 'agent-a', ['sub-a', 'sub-b'])).toBe(true);
    expect(hasForeignSubAgent(getSub, 'agent-a', ['sub-a'])).toBe(false);
    expect(hasForeignSubAgent(getSub, undefined, ['sub-b'])).toBe(true);
  });
  it('a stale owner/session pair cannot stop a different agent', async (): Promise<void> => {
    const response = await fetch(`${base}/api/subagents/agent-a/sub-b/stop-session`, { method: 'POST' });
    expect(response.status).toBe(404);
    expect(stopped).toEqual([]);
  });

  it('the correct owner can stop its session', async (): Promise<void> => {
    const response = await fetch(`${base}/api/subagents/agent-b/sub-b/stop-session`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(stopped).toEqual(['sub-b']);
  });

  it('a session that already disappeared keeps idempotent stop behavior', async (): Promise<void> => {
    const response = await fetch(`${base}/api/subagents/agent-b/already-gone/stop-session`, { method: 'POST' });
    expect(response.status).toBe(200);
  });
});
