import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentCardTaskBook } from '@vibisual/shared';
import { AgentCardTasksStore, mountAgentCardTaskRoutes, type AgentCardTasksHost } from './agentCardTasks.js';

let root: string, other: string, base: string, server: Server, host: AgentCardTasksHost;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-card-tasks-'));
  other = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-card-other-'));
  host = {
    rootForAgent: (id) => id === 'agent-a' || id === 'agent-b' ? root : id === 'foreign-agent' ? other : null,
    sessionOwner: (id) => id === 'foreign-session' ? 'foreign-agent' : id === 'session-a' ? 'agent-a' : undefined,
    warn: vi.fn(),
  };
  const app = express(); app.use(express.json()); mountAgentCardTaskRoutes(app, host);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing port');
  base = `http://127.0.0.1:${address.port}/api/agent-card-tasks`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});
function request(agent = 'agent-a', project = root, update?: unknown) {
  return fetch(`${base}/${agent}?projectId=${encodeURIComponent(project)}`, {
    method: update === undefined ? 'GET' : 'PUT', headers: { 'Content-Type': 'application/json' },
    ...(update === undefined ? {} : { body: JSON.stringify(update) }),
  });
}
const book = (): Omit<AgentCardTaskBook, 'revision'> => ({
  activeTaskId: 'task-a', tasks: [{ id: 'task-a', title: 'Apartment', sessionId: 'session-a', nodeIds: ['node-a'], createdAt: 1 }],
  pending: { id: 'pending-a', mode: 'copy', text: 'Make a hanok version', sourceTaskId: 'task-a', nodeIds: ['node-a'], createdAt: 2, status: 'waiting' },
});

describe('durable agent card task books', () => {
  it('returns an empty revision without creating any files', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, book: { revision: 0, activeTaskId: null, tasks: [] } });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('persists tasks and failed requests across a fresh store instance without sharing another agent book', async () => {
    const proposed = book(); proposed.pending!.status = 'failed'; proposed.pending!.error = 'Could not send'; proposed.pending!.taskId = 'task-a';
    const response = await request('agent-a', root, { expectedRevision: 0, book: proposed });
    expect(response.status).toBe(200);
    const saved = (await response.json()).book;
    expect(saved).toEqual({ ...proposed, revision: 1 });
    expect(new AgentCardTasksStore(host).get('agent-a', root)).toEqual(saved);
    expect((await (await request('agent-b')).json()).book).toEqual({ revision: 0, activeTaskId: null, tasks: [] });
    const file = path.join(root, '.vibisual', 'agent-card-tasks', fs.readdirSync(path.join(root, '.vibisual', 'agent-card-tasks'))[0]!);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).agentId).toBe('agent-a');
  });

  it('allows exactly one renderer to claim the same waiting request', async () => {
    await request('agent-a', root, { expectedRevision: 0, book: book() });
    const claim = book(); claim.pending!.status = 'preparing';
    const results = await Promise.all([
      request('agent-a', root, { expectedRevision: 1, book: claim }),
      request('agent-a', root, { expectedRevision: 1, book: claim }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = await results.find((r) => r.status === 409)!.json();
    expect(conflict).toMatchObject({ ok: false, error: 'revision-conflict', book: { revision: 2, pending: { status: 'preparing' } } });
    expect(new AgentCardTasksStore(host).get('agent-a', root).pending?.status).toBe('preparing');
  });

  it('preserves claim expiry across refresh and accepts old preparing records without a lease', async () => {
    const claim = book(); claim.pending!.status = 'preparing'; claim.pending!.leaseUntil = Date.now() + 120_000;
    expect((await request('agent-a', root, { expectedRevision: 0, book: claim })).status).toBe(200);
    expect(new AgentCardTasksStore(host).get('agent-a', root).pending?.leaseUntil).toBe(claim.pending!.leaseUntil);
    delete claim.pending!.leaseUntil;
    expect((await request('agent-a', root, { expectedRevision: 1, book: claim })).status).toBe(200);
    expect(new AgentCardTasksStore(host).get('agent-a', root).pending).toEqual(claim.pending);
  });

  it('rejects invalid leases without changing the persisted reservation', async () => {
    await request('agent-a', root, { expectedRevision: 0, book: book() });
    for (const leaseUntil of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'tomorrow', null]) {
      const proposed = { ...book(), pending: { ...book().pending, status: 'preparing', leaseUntil } };
      const response = await request('agent-a', root, { expectedRevision: 1, book: proposed });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: 'invalid-task-lease' });
    }
    expect(new AgentCardTasksStore(host).get('agent-a', root)).toEqual({ ...book(), revision: 1 });
  });

  it('rejects project, agent, and live session scope mismatches before writing', async () => {
    expect((await request('agent-a', other)).status).toBe(404);
    expect((await request('unknown-agent')).status).toBe(404);
    expect((await request('agent-a', '.')).status).toBe(404);
    const foreign = book(); foreign.tasks[0]!.sessionId = 'foreign-session';
    expect((await request('agent-a', root, { expectedRevision: 0, book: foreign })).status).toBe(404);
    expect(fs.readdirSync(root)).toEqual([]);
    expect(fs.readdirSync(other)).toEqual([]);
  });

  it('refuses malformed references and duplicate IDs without consuming the revision', async () => {
    for (const proposed of [
      { ...book(), activeTaskId: 'missing' },
      { ...book(), tasks: [...book().tasks, ...book().tasks] },
      { ...book(), pending: { ...book().pending, taskId: 'missing' } },
      { ...book(), pending: { ...book().pending, status: 'made-up' } },
      { ...book(), pending: { ...book().pending, text: '' } },
    ]) expect((await request('agent-a', root, { expectedRevision: 0, book: proposed })).status).toBe(400);
    expect((await (await request()).json()).book.revision).toBe(0);
  });

  it('a disk failure leaves the accepted revision and original request intact', async () => {
    await request('agent-a', root, { expectedRevision: 0, book: book() });
    const original = new AgentCardTasksStore(host).get('agent-a', root);
    host.writeFile = () => { throw new Error('disk full'); };
    const proposed = book(); delete proposed.pending;
    const response = await request('agent-a', root, { expectedRevision: 1, book: proposed });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: 'task-book-save-failed' });
    expect(new AgentCardTasksStore(host).get('agent-a', root)).toEqual(original);
  });

  it('does not reset or overwrite an unreadable saved book', async () => {
    await request('agent-a', root, { expectedRevision: 0, book: book() });
    const dir = path.join(root, '.vibisual', 'agent-card-tasks');
    const file = path.join(dir, fs.readdirSync(dir)[0]!);
    fs.writeFileSync(file, '{broken');
    expect((await request()).status).toBe(500);
    expect((await request('agent-a', root, { expectedRevision: 0, book: book() })).status).toBe(500);
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });

  it('rejects a storage directory redirected outside the project', async () => {
    fs.symlinkSync(other, path.join(root, '.vibisual'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await request('agent-a', root, { expectedRevision: 0, book: book() })).status).toBe(403);
    expect(fs.readdirSync(other)).toEqual([]);
  });
});
