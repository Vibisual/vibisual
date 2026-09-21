import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { DEFAULT_AGENT_CONFIG, type SkillSharingEntry, type SkillSharingResult } from '@vibisual/shared';
import { SkillSharingError, type SkillSharingContext } from './skillSharingService.js';
import { mountSkillSharingRoutes } from './skillSharingRoutes.js';

let server: Server;
let base: string;
const list = vi.fn<(context: SkillSharingContext) => SkillSharingEntry[]>();
const share = vi.fn<(context: SkillSharingContext, sourceId: string) => SkillSharingResult>();
const changed = vi.fn();

beforeEach(async () => {
  vi.resetAllMocks();
  list.mockReturnValue([]);
  share.mockReturnValue({ status: 'shared', name: 'sample', path: '/workspace/.agents/skills/sample' });
  const app = express();
  app.use(express.json());
  mountSkillSharingRoutes(app, {
    service: { list, share },
    rootForAgent: (id) => ['claude', 'codex', 'local'].includes(id) ? `/workspace/${id}` : null,
    configForAgent: (id) => ({ ...DEFAULT_AGENT_CONFIG,
      ...(id === 'codex' ? { provider: { kind: 'codex-cli' as const, modelId: 'test' } } : {}),
      ...(id === 'local' ? { provider: { kind: 'local-llama' as const, modelId: 'test' } } : {}),
    }),
    changed,
  });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test listener unavailable');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function post(body: unknown): Promise<Response> {
  return fetch(`${base}/api/skill-sharing`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('skill sharing HTTP boundary', () => {
  it.each(['claude', 'codex'])('derives the receiving engine and project for %s from the agent', async (agentId) => {
    const response = await fetch(`${base}/api/skill-sharing?agentId=${agentId}&provider=spoof&projectPath=/other`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, provider: agentId, skills: [] });
    expect(list).toHaveBeenCalledWith({ projectCwd: `/workspace/${agentId}`, targetProvider: agentId });
  });

  it('rejects unresolved agents instead of reading another project', async () => {
    expect((await fetch(`${base}/api/skill-sharing`)).status).toBe(400);
    expect((await fetch(`${base}/api/skill-sharing?agentId=missing`)).status).toBe(404);
    expect((await post({ agentId: 'missing', sourceId: 'id' })).status).toBe(404);
    expect(list).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('does not offer skill installation to unsupported engines', async () => {
    expect((await fetch(`${base}/api/skill-sharing?agentId=local`)).status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it('accepts only a server-resolved source id and invalidates inventory after successful import', async () => {
    const response = await post({ agentId: 'codex', sourceId: 'source-id', sourcePath: '/secret', targetPath: '/outside', targetProvider: 'claude' });
    expect(response.status).toBe(200);
    expect(share).toHaveBeenCalledWith({ projectCwd: '/workspace/codex', targetProvider: 'codex' }, 'source-id');
    expect(changed).toHaveBeenCalledOnce();
  });

  it.each(['exists', 'conflict', 'unsupported'] as const)('returns actionable %s without claiming a new write', async (status) => {
    share.mockReturnValue({ status, name: 'sample', path: '/workspace/skill', issues: ['name-conflict'] });
    const response = await post({ agentId: 'codex', sourceId: 'id' });
    expect(await response.json()).toMatchObject({ ok: true, result: { status } });
    expect(changed).not.toHaveBeenCalled();
  });

  it('rechecks stale source ids and exposes a safe failure code', async () => {
    share.mockImplementation(() => { throw new SkillSharingError('source-not-found'); });
    const response = await post({ agentId: 'codex', sourceId: 'old-id' });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: 'source-not-found' });
    expect(changed).not.toHaveBeenCalled();
  });

  it('rejects incomplete requests before any file operation', async () => {
    expect((await post([])).status).toBe(400);
    expect((await post({ agentId: 'claude', sourceId: '' })).status).toBe(400);
    expect(share).not.toHaveBeenCalled();
  });
});
