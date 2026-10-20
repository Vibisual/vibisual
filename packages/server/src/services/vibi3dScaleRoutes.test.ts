import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VIBI3D_RENDERER_TOKEN_HEADER, LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE, type Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DBroker } from './vibi3dBroker.js';
import { mountVibi3DRoutes } from './vibi3dRoutes.js';

const view: Vibi3DSnapshot = { sessionId: 'large-scene', projectId: 'fixture', fileName: 'model', revision: 0, selectedId: null, nodes: [] };
const token = 'renderer-token-for-scale-tests';
const stats = { sceneRevision: 0, objects: 5, instances: 1000, triangles: 5000, drawCalls: 3,
  drawCallsSource: 'measured', textureBytes: 1024, textureBytesEstimated: true, warnings: [] };
let server: Server, base: string, now: number, broker: Vibi3DBroker;
const send = (route: string, body?: unknown, agent = false) => fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', [VIBI3D_RENDERER_TOKEN_HEADER]: token, ...(agent ? { [LOOPBACK_INGRESS_HEADER]: LOOPBACK_INGRESS_VALUE } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(async () => {
  now = 1000; broker = new Vibi3DBroker(() => now);
  // Intentionally larger test parser proves the app route retains its own 8MiB boundary.
  const app = express(); app.use(express.json({ limit: '12mb' }));
  mountVibi3DRoutes(app, { resolveProjectPath: raw => raw === 'fixture' ? '/fixture' : null }, broker);
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('no-port'); base = `http://127.0.0.1:${address.port}`;
  expect((await send('/sessions', { snapshot: view, rendererToken: token })).status).toBe(200);
});
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe('scale-aware native bridge', () => {
  it('reports statistics only from a renderer ACK for the queued read-only command', async () => {
    const command = { commandId: 'measure', expectedRevision: 0, commands: [{ type: 'stats' }] };
    expect((await send('/sessions/large-scene/commands', command, true)).status).toBe(202);
    const ack = { commandId: 'measure', ok: true, snapshot: view, result: { stats } };
    expect((await send('/sessions/large-scene/ack', ack, true)).status).toBe(403);
    expect((await send('/sessions/large-scene/ack', { ...ack, result: { stats: { ...stats, sceneRevision: 1 } } })).status).toBe(400);
    expect((await send('/sessions/large-scene/ack', { ...ack, result: undefined })).status).toBe(400);
    const result = await (await send('/sessions/large-scene/ack', ack)).json();
    expect(result).toMatchObject({ status: 'applied', revision: 0, result: { stats } });
    expect((await (await send('/sessions/large-scene/commands/measure')).json()).result.stats).toEqual(stats);
    expect((await (await send('/sessions/large-scene/commands', command, true)).json()).result.stats).toEqual(stats);
  });

  it('does not let an edit ACK forge unrelated statistics or durable checkpoints', async () => {
    await send('/sessions/large-scene/commands', { commandId: 'edit', expectedRevision: 0, commands: [{ type: 'lighting', intensity: 1 }] }, true);
    expect((await send('/sessions/large-scene/ack', { commandId: 'edit', ok: true, snapshot: view, result: { stats } })).status).toBe(400);
    const ack = await (await send('/sessions/large-scene/ack', { commandId: 'edit', ok: true, snapshot: { ...view, revision: 1 }, result: { checkpoint: { id: 'fake' } } })).json();
    expect(ack.status).toBe('applied'); expect(ack.result).toBeUndefined();
  });

  it('keeps progress monotonic and heartbeat live without extending the absolute deadline', async () => {
    const commands = Array.from({ length: 500 }, () => ({ type: 'lighting', intensity: 1 }));
    const queued = await (await send('/sessions/large-scene/commands', { commandId: 'batch', expectedRevision: 0, commands }, true)).json();
    expect(queued.expiresAt).toBe(301000);
    now += 40000;
    expect((await send('/sessions/large-scene/progress', { commandId: 'batch', progress: 0.5 }, true)).status).toBe(403);
    expect(await (await send('/sessions/large-scene/progress', { commandId: 'batch', progress: 0.5 })).json()).toMatchObject({ status: 'running', progress: 0.5, expiresAt: queued.expiresAt });
    expect((await (await send('/sessions/large-scene')).json()).online).toBe(true);
    expect((await (await send('/sessions/large-scene/progress', { commandId: 'batch', progress: 0.2 })).json()).progress).toBe(0.5);
    expect((await send('/sessions/large-scene/progress', { commandId: 'batch', progress: 2 })).status).toBe(400);
    now = queued.expiresAt;
    expect((await (await send('/sessions/large-scene/commands/batch')).json()).error).toBe('command-timeout-refresh-state');
    expect((await send('/sessions/large-scene/progress', { commandId: 'batch', progress: 1 })).status).toBe(409);
  });

  it('refuses oversized UTF8 bodies at the app route even with a more permissive host parser', async () => {
    const input = { commandId: 'large', expectedRevision: 0, commands: [{ type: 'stats' }], padding: '한'.repeat(3_000_000) };
    const response = await send('/sessions/large-scene/commands', input, true);
    expect(response.status).toBe(413); expect((await response.json()).error).toBe('command-body-too-large');
  });
  it('keeps an unattended maximum-length batch outcome queryable without marking the viewer online', async () => {
    const commands = Array.from({ length: 500 }, () => ({ type: 'lighting', intensity: 1 }));
    await send('/sessions/large-scene/commands', { commandId: 'unattended', expectedRevision: 0, commands }, true);
    now += 300_001;
    const outcome = await send('/sessions/large-scene/commands/unattended');
    expect(outcome.status).toBe(200); expect((await outcome.json()).error).toBe('command-timeout-refresh-state');
    expect((await (await send('/sessions/large-scene')).json()).online).toBe(false);
    now += 300_000; expect((await send('/sessions/large-scene')).status).toBe(404);
  });
});
