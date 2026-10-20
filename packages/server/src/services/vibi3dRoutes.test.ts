import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE, VIBI3D_API_PREFIX, VIBI3D_RENDERER_TOKEN_HEADER,
  validateVibi3DCommand, validateVibi3DCommandRequest, validateVibi3DSnapshot, type Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DBroker } from './vibi3dBroker.js';
import { mountVibi3DRoutes } from './vibi3dRoutes.js';
vi.mock('./projectGraphManager.js', () => ({ graphManager: {
  getProjectByName: (name: string) => name === 'fixture' ? { path: '/fixture' } : undefined,
  getProjects: () => ({ fixture: { path: '/fixture' } }),
} }));

function scene(revision = 0): Vibi3DSnapshot {
  return { sessionId: 'scene-1', projectId: 'fixture', fileName: 'chair.glb', revision, selectedId: 'mesh', canUndo: revision > 0,
    nodes: [{ id: 'mesh', name: 'Chair', type: 'Mesh', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }] };
}
const command = (commandId = 'change-1', expectedRevision = 0) => ({ commandId, expectedRevision, commands: [{ type: 'update' as const, id: 'mesh', position: [1, 2, 3] as [number, number, number] }] });
const jpeg = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 1, 2, 3, 255, 217]).toString('base64')}`;
const rendererToken = 'renderer-secret-123456789';
let server: Server;
let base: string;
let broker: Vibi3DBroker;
let now: number;
const headers = { 'Content-Type': 'application/json', [VIBI3D_RENDERER_TOKEN_HEADER]: rendererToken };
const ingress = { [LOOPBACK_INGRESS_HEADER]: LOOPBACK_INGRESS_VALUE };
async function request(path: string, method = 'GET', data?: unknown, extraHeaders: Record<string, string> = {}) {
  return fetch(base + path, { method, headers: { ...headers, ...extraHeaders }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
async function create() { return request('/sessions', 'POST', { snapshot: scene(), rendererToken, screenshot: jpeg }); }

beforeEach(async () => {
  now = 1000;
  broker = new Vibi3DBroker(() => now);
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  const router = express.Router();
  mountVibi3DRoutes(router as unknown as express.Express, { resolveProjectPath: (id) => id === 'fixture' ? '/fixture' : null }, broker);
  app.use(VIBI3D_API_PREFIX, router);
  await new Promise<void>((done) => { server = app.listen(0, '127.0.0.1', () => done()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing fixture port');
  base = `http://127.0.0.1:${address.port}${VIBI3D_API_PREFIX}`;
});
afterEach(async () => { await new Promise<void>((done, reject) => server.close((err) => err ? reject(err) : done())); });

describe('Vibi3D scene contracts', () => {
  it('copies valid snapshots and rejects duplicate nodes, absent selections and malformed values', () => {
    const source = scene();
    const parsed = validateVibi3DSnapshot(source)!;
    parsed.nodes[0]!.position[0] = 100;
    expect(source.nodes[0]!.position[0]).toBe(0);
    expect(validateVibi3DSnapshot({ ...scene(), nodes: [...scene().nodes, ...scene().nodes] })).toBeNull();
    expect(validateVibi3DSnapshot({ ...scene(), selectedId: 'missing' })).toBeNull();
    expect(validateVibi3DSnapshot({ ...scene(), revision: -1 })).toBeNull();
    expect(validateVibi3DSnapshot({ ...scene(), camera: { position: [Infinity, 0, 0], target: [0, 0, 0] } })).toBeNull();
    expect(validateVibi3DSnapshot({ ...scene(), playback: { clip: 'Idle', time: 0, playing: false } })).not.toBeNull();
  });
  it('rejects executable, unknown, infinite, singular-scale and mixed-history commands', () => {
    for (const value of [{ type: 'eval', code: 'process.exit()' }, { type: 'undo', script: 'x' },
      { type: 'update', id: 'mesh' }, { type: 'update', id: 'mesh', position: [NaN, 0, 0] },
      { type: 'update', id: 'mesh', scale: [0, 1, 1] }, { type: 'lighting', intensity: 11 }]) {
      expect(validateVibi3DCommand(value)).toBeNull();
    }
    expect(validateVibi3DCommandRequest({ ...command(), commands: [{ type: 'undo' }, ...command().commands] })).toBeNull();
    expect(validateVibi3DCommandRequest({ ...command(), expectedRevision: undefined })).toBeNull();
    expect(validateVibi3DCommand({ type: 'update', id: 'mesh', color: '#AA33FF' })).toEqual({ type: 'update', id: 'mesh', color: '#aa33ff' });
  });
});

describe('Vibi3D route and broker integration', () => {
  it('lets renderer register retry safely, but cannot reclaim another token or reveal it to the AI', async () => {
    expect((await create()).status).toBe(200);
    expect((await create()).status).toBe(200);
    expect((await request('/sessions', 'POST', { snapshot: scene() })).status).toBe(409);
    const read = await (await request('/sessions/scene-1', 'GET', undefined, ingress)).json();
    expect(read.snapshot).toEqual(scene());
    expect(JSON.stringify(read)).not.toContain(rendererToken);
    expect(read.imageUrl).toBe(`${VIBI3D_API_PREFIX}/sessions/scene-1/image`);
    expect((await (await request('/sessions?projectId=fixture')).json()).sessions).toHaveLength(1);
    expect((await request('/sessions?projectId=unknown')).status).toBe(404);
  });
  it('blocks every renderer-only endpoint from loopback and guards private tokens', async () => {
    expect((await request('/sessions', 'POST', { snapshot: scene() }, ingress)).status).toBe(403);
    await create();
    for (const [path, method, data] of [
      ['/sessions/scene-1/publish', 'POST', { snapshot: scene() }],
      ['/sessions/scene-1/pending', 'GET', undefined],
      ['/sessions/scene-1/ack', 'POST', {}],
      ['/sessions/scene-1', 'DELETE', undefined],
    ] as const) expect((await request(path, method, data, ingress)).status).toBe(403);
    expect((await request('/sessions/scene-1/pending', 'GET', undefined, { [VIBI3D_RENDERER_TOKEN_HEADER]: 'wrong' })).status).toBe(403);
  });
  it('queues validated edits, waits for the real renderer ACK, and deduplicates retries', async () => {
    await create();
    const send = await request('/sessions/scene-1/commands', 'POST', command(), ingress);
    expect(send.status).toBe(202);
    expect((await send.json()).status).toBe('pending');
    expect((await request('/sessions/scene-1/commands', 'POST', command(), ingress)).status).toBe(202);
    const pending = await (await request('/sessions/scene-1/pending')).json();
    expect(pending.request).toMatchObject(command());
    expect(pending.request.expiresAt).toBe(now + 30_000);
    const applied = scene(1); applied.nodes[0]!.position = [1, 2, 3];
    const ack = await request('/sessions/scene-1/ack', 'POST', { commandId: 'change-1', ok: true, snapshot: applied, screenshot: jpeg });
    expect((await ack.json()).status).toBe('applied');
    expect((await (await request('/sessions/scene-1/commands/change-1')).json()).revision).toBe(1);
    expect((await (await request('/sessions/scene-1/commands', 'POST', command())).json()).status).toBe('applied');
    expect((await (await request('/sessions/scene-1/pending')).json()).request).toBeNull();
    expect((await (await request('/sessions/scene-1')).json()).snapshot.nodes[0].position).toEqual([1, 2, 3]);
  });
  it('rejects stale edits and changing the meaning of an existing command ID', async () => {
    await create();
    expect((await request('/sessions/scene-1/commands', 'POST', command('stale', 1))).status).toBe(409);
    await request('/sessions/scene-1/commands', 'POST', command());
    expect((await request('/sessions/scene-1/commands', 'POST', command('change-2'))).status).toBe(409);
    expect((await request('/sessions/scene-1/commands', 'POST', { ...command(), commands: [{ type: 'undo' }] })).status).toBe(409);
    await request('/sessions/scene-1/publish', 'POST', { snapshot: scene(1) });
    expect((await (await request('/sessions/scene-1/pending')).json()).request).toBeNull();
    expect((await (await request('/sessions/scene-1/commands/change-1')).json()).error).toBe('revision-conflict');
    expect((await request('/sessions/scene-1/publish', 'POST', { snapshot: scene(0) })).status).toBe(409);
  });
  it('serves captured bytes separately and invalidates stale camera/revision images', async () => {
    await create();
    const image = await request('/sessions/scene-1/image', 'GET', undefined, ingress);
    expect(image.headers.get('content-type')).toContain('image/jpeg');
    expect(image.headers.get('x-vibi3d-revision')).toBe('0');
    expect(Buffer.from(await image.arrayBuffer())[0]).toBe(255);
    const next = { ...scene(), camera: { position: [0, 2, 5] as [number, number, number], target: [0, 0, 0] as [number, number, number] } };
    await request('/sessions/scene-1/publish', 'POST', { snapshot: next });
    expect((await request('/sessions/scene-1/image')).status).toBe(404);
    expect((await request('/sessions/scene-1/publish', 'POST', { snapshot: next, screenshot: 'data:image/jpeg;base64,ZmFrZQ==' })).status).toBe(400);
    await request('/sessions/scene-1/publish', 'POST', { snapshot: next, screenshot: jpeg });
    await request('/sessions/scene-1/publish', 'POST', { snapshot: { ...next, selectedId: null } });
    expect((await request('/sessions/scene-1/image')).status).toBe(404);
  });
  it('reports renderer rejection, times out unattended edits, and expires closed sessions', async () => {
    await create();
    await request('/sessions/scene-1/commands', 'POST', command());
    await request('/sessions/scene-1/ack', 'POST', { commandId: 'change-1', ok: false, error: 'revision-conflict', snapshot: scene() });
    expect((await (await request('/sessions/scene-1/commands/change-1')).json()).status).toBe('rejected');
    await request('/sessions/scene-1/commands', 'POST', command('change-2'));
    now += 30_001;
    expect((await (await request('/sessions/scene-1/commands/change-2')).json()).error).toBe('command-timeout-refresh-state');
    now += 10_000;
    expect((await request('/sessions/scene-1/commands', 'POST', command('change-3'))).status).toBe(409);
    now += 300_000;
    expect((await request('/sessions/scene-1')).status).toBe(404);
  });
  it('rejects malformed references and cannot move a session into a different source', async () => {
    await create();
    expect((await request('/sessions/scene-1/commands', 'POST', { ...command(), commands: [{ type: 'update', id: 'missing', color: '#ffffff' }] })).status).toBe(400);
    expect((await request('/sessions/scene-1/publish', 'POST', { snapshot: { ...scene(), fileName: 'other.glb' } })).status).toBe(409);
    expect((await request('/sessions/scene-1/publish', 'POST', { snapshot: { ...scene(), projectId: 'unknown' } })).status).toBe(404);
    expect((await request('/sessions/scene-1', 'DELETE')).status).toBe(200);
    expect((await request('/sessions/scene-1')).status).toBe(404);
  });
  it('accepts a late actual outcome after timeout without losing a newer pending command', async () => {
    await create();
    await request('/sessions/scene-1/commands', 'POST', command('late'));
    now += 30_001;
    expect((await (await request('/sessions/scene-1/commands/late')).json()).error).toBe('command-timeout-refresh-state');
    await request('/sessions/scene-1/publish', 'POST', { snapshot: scene() });
    // A second request may have reached the server while the first ACK was in transit.
    await request('/sessions/scene-1/commands', 'POST', command('newer'));
    const applied = scene(1); applied.nodes[0]!.position = [1, 2, 3];
    const ack = await request('/sessions/scene-1/ack', 'POST', { commandId: 'late', ok: true, snapshot: applied });
    expect((await ack.json()).status).toBe('applied');
    expect((await (await request('/sessions/scene-1')).json()).snapshot.revision).toBe(1);
    // The later request still gets its own explicit conflict outcome; it is not orphaned.
    expect((await (await request('/sessions/scene-1/pending')).json()).request).toBeNull();
    expect((await (await request('/sessions/scene-1/commands/newer')).json()).error).toBe('revision-conflict');
  });
  it('keeps the application mounted lazily under the existing authenticated app loopback boundary', () => {
    const appHost = readFileSync(new URL('./appHost.ts', import.meta.url), 'utf8');
    const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const desktop = readFileSync(new URL('../../../desktop/src/main/index.ts', import.meta.url), 'utf8');
    expect(appHost).toContain("import('./vibi3dRoutes.js')");
    expect(desktop).toContain("path.startsWith('/api/app/')");
    expect(desktop).toContain("!isValidHookToken(req.headers['x-vibisual-hook-token'])");
    expect(index.indexOf("app.use('/api/app/vibi3d', express.json({ limit: '8mb' }))")).toBeLessThan(index.indexOf('app.use(express.json())'));
  });
  it('reaches the real lazy appHost route with the same public prefix the renderer uses', async () => {
    const { mountAppRoutes } = await import('./appHost.js');
    const app = express();
    app.use(express.json());
    mountAppRoutes(app);
    let hosted!: Server;
    await new Promise<void>((done) => { hosted = app.listen(0, '127.0.0.1', () => done()); });
    try {
      const address = hosted.address();
      if (!address || typeof address === 'string') throw new Error('missing fixture port');
      const prefix = `http://127.0.0.1:${address.port}${VIBI3D_API_PREFIX}`;
      const response = await fetch(`${prefix}/sessions`, { method: 'POST', headers,
        body: JSON.stringify({ snapshot: scene(), rendererToken }) });
      expect(response.status).toBe(200);
      const read = await fetch(`${prefix}/sessions/scene-1`);
      expect((await read.json()).snapshot.fileName).toBe('chair.glb');
    } finally {
      await new Promise<void>((done, reject) => hosted.close((error) => error ? reject(error) : done()));
    }
  });
});
