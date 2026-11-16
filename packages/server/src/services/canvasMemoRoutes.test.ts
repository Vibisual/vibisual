import express from 'express';
import type { Server } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionMemo } from '@vibisual/shared';
import { registerCanvasMemoRoutes } from './canvasMemoRoutes.js';

interface Owner { id: string; parentAgentId: string; memos?: SessionMemo[] }
const state = vi.hoisted(() => ({ canvas: [] as SessionMemo[], live: true, active: undefined as Owner | undefined, archived: [] as Owner[] }));
vi.mock('./projectGraphManager.js', () => ({ graphManager: {
  getAgentProjectName: () => 'Project', hasLiveAgentId: () => state.live, getProjectByName: () => ({ name: 'Project' }),
  getCanvasMemos: () => state.canvas, setCanvasMemos: (_project: string, memos: SessionMemo[]) => { state.canvas = memos; },
  getAgentMemos: () => [], setAgentMemos: vi.fn(), markCanvasMemoDeleted: vi.fn(),
} }));
vi.mock('./subAgentManager.js', () => ({ subAgentManager: {
  getSub: () => state.active, getArchived: () => state.archived,
  restoreFromArchive: (id: string) => {
    state.active ??= state.archived.find((s) => s.id === id);
    state.archived = state.archived.filter((s) => s.id !== id);
    return state.active;
  },
  setSessionMemos: (_id: string, memos: SessionMemo[]) => { if (state.active) state.active.memos = memos; },
} }));
beforeEach(() => {
  state.live = true; state.active = undefined; state.archived = [{ id: 'sub', parentAgentId: 'agent', memos: [] }];
  state.canvas = [{ id: 'memo', text: 'Note', x: -300, y: 200, w: 280, h: 180, color: '#1E293B', createdAt: 1, updatedAt: 1,
    canvas: { agentId: 'agent', subAgentId: 'sub', x: 40, y: 60, folderId: null } }];
});
async function request(action: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = express(); app.use(express.json()); registerCanvasMemoRoutes(app, () => {});
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test listener unavailable');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/canvas-memos/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'Project', memoId: 'memo' }),
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
describe('canvas memo home route', () => {
  it('offers return for an archived session and restores the same session with its note', async () => {
    expect((await request('home')).body.returnAvailable).toBe(true);
    expect((await request('return')).status).toBe(200);
    expect(state.active).toMatchObject({ id: 'sub', memos: [{ id: 'memo', x: 40, y: 60 }] });
    expect(state.active?.memos?.[0]).not.toHaveProperty('canvas');
    expect(state.canvas).toEqual([]); expect(state.archived).toEqual([]);
  });
  it('hides return for a trashed owner or permanently removed session', async () => {
    state.live = false;
    expect((await request('home')).body.returnAvailable).toBe(false);
    expect((await request('return')).status).toBe(409);
    state.live = true; state.archived = [];
    expect((await request('home')).body.returnAvailable).toBe(false);
    expect(state.canvas).toHaveLength(1);
  });
});
