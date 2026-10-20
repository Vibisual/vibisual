import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE, VIBI3D_RENDERER_TOKEN_HEADER,
  type CreationDoc, type Vibi3DSnapshot, type AppEventPayload } from '@vibisual/shared';
import { CreationStore, type CreationHost } from './creationStore.js';
import { Vibi3DBroker } from './vibi3dBroker.js';
import { mountVibi3DRoutes } from './vibi3dRoutes.js';

let root: string; let base: string; let server: Server; let store: CreationStore; let doc: CreationDoc; let view: Vibi3DSnapshot;
let events: Omit<AppEventPayload, 'appId'>[];
let now: number;
const token = 'renderer-token-123456789012345';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY2sAAAAASUVORK5CYII=';
async function request(route: string, method = 'GET', body?: unknown, agent = false) {
  return fetch(base + route, { method, headers: { 'Content-Type': 'application/json', [VIBI3D_RENDERER_TOKEN_HEADER]: token,
    ...(agent ? { [LOOPBACK_INGRESS_HEADER]: LOOPBACK_INGRESS_VALUE } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi3d-route-')); events = []; now = 1000;
  const host: CreationHost = { resolveProjectPath: value => value === root || value === 'fixture' ? root : null,
    atomicWriteFile: (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, content); fs.renameSync(`${file}.tmp`, file); } };
  store = new CreationStore(host);
  doc = store.create(root, { appId: 'vibi3d', payload: { format: 'vibi3d', version: 1, clips: [], scene: { object: { type: 'Group', uuid: 'root', children: [] } } } }, 'user');
  view = { sessionId: 'scene', projectId: root, fileName: 'model', revision: 0, selectedId: null, nodes: [], ownerId: 'screen', document: { id: doc.id, revision: 1, dirty: false } };
  const app = express(); app.use(express.json({ limit: '8mb' }));
  mountVibi3DRoutes(app, { ...host, getCreationStore: async () => store, notify: event => events.push(event) }, new Vibi3DBroker(() => now));
  await new Promise<void>(done => { server = app.listen(0, '127.0.0.1', () => done()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('no-test-address');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('vibi3d-route-')) throw new Error('unsafe-fixture-path');
  fs.rmSync(root, { recursive: true, force: true });
});
const documentRoute = (suffix: string): string => `/documents/${doc.id}/${suffix}`;
async function start() {
  expect((await request('/sessions', 'POST', { snapshot: view, rendererToken: token })).status).toBe(200);
  const response = await request(documentRoute('runs'), 'POST', { projectId: root, runId: 'run' }, true);
  expect(response.status).toBe(200);
  return response.json();
}
describe('document-native HTTP workflow', () => {
  it('retains one renderer owner, uses canonical projects, and emits same-document reopen', async () => {
    const ensure = await request(documentRoute('ensure'), 'POST', { projectId: 'fixture', ownerId: 'screen' });
    expect((await ensure.json()).ownerId).toBe('screen');
    await start();
    const other = await request(documentRoute('ensure'), 'POST', { projectId: root, ownerId: 'mobile' });
    expect(await other.json()).toMatchObject({ ownerId: 'screen', sessionId: 'scene' });
    const duplicate = await request('/sessions', 'POST', { snapshot: { ...view, sessionId: 'second', ownerId: 'mobile' }, rendererToken: token });
    expect(duplicate.status).toBe(409);
    const aliasDuplicate = await request('/sessions', 'POST', { snapshot: { ...view, sessionId: 'alias-second', projectId: 'fixture' }, rendererToken: token });
    expect(aliasDuplicate.status).toBe(409);
    const read = await request(documentRoute('session') + '?projectId=' + encodeURIComponent('fixture'));
    expect(await read.json()).toMatchObject({ session: { snapshot: { sessionId: 'scene', runId: 'run' } }, run: null });
    await request('/sessions/scene', 'DELETE');
    expect((await request(documentRoute('reopen'), 'POST', { projectId: root, runId: 'run' }, true)).status).toBe(200);
    expect(events.at(-1)).toMatchObject({ project: root, kind: 'reopen', key: doc.id });
    const reopened = { ...view, sessionId: 'reopened' };
    expect((await request('/sessions', 'POST', { snapshot: reopened, rendererToken: token })).status).toBe(200);
    expect((await (await request('/sessions/reopened')).json()).snapshot.runId).toBe('run');
    expect((await request(documentRoute('ensure'), 'POST', { projectId: root, ownerId: 'agent' }, true)).status).toBe(403);
  });
  it('persists only real queued renderer results and exposes saved capture paths to the agent', async () => {
    await start();
    const commands = [{ type: 'checkpoint', stage: 'blockout', label: 'Blockout' }];
    await request('/sessions/scene/commands', 'POST', { commandId: 'save', expectedRevision: 0, commands }, true);
    expect(events.at(-1)?.kind).toBe('command');
    expect((await request('/sessions/scene/checkpoint', 'POST', { commandId: 'save', snapshot: view, payload: doc.payload }, true)).status).toBe(403);
    const save = await request('/sessions/scene/checkpoint', 'POST', { commandId: 'save', snapshot: view,
      payload: { ...doc.payload as object, scene: { object: { type: 'Group', uuid: 'root', children: [{ type: 'Mesh', uuid: 'wall' }] } } } });
    const saved = await save.json(); expect(save.status).toBe(200); expect(saved.doc).toBeUndefined();
    expect(saved.stage.mode).toBe('intermediate'); expect(store.get(root, doc.id).revision).toBe(1);
    view = { ...view, document: { id: doc.id, revision: 1, dirty: true, humanDirty: false } };
    await request('/sessions/scene/ack', 'POST', { commandId: 'save', ok: true, snapshot: view });
    const status = await request('/sessions/scene/commands/save');
    expect(await status.json()).toMatchObject({ status: 'applied', result: { checkpoint: { id: 'blockout', revision: 1 } } });
    await request('/sessions/scene/commands', 'POST', { commandId: 'capture', expectedRevision: 0, commands: [{ type: 'capture' }] }, true);
    const progress = await request('/sessions/scene/progress', 'POST', { commandId: 'capture', progress: 0.25 });
    expect(await progress.json()).toMatchObject({ status: 'running', progress: 0.25 });
    const capture = await request('/sessions/scene/captures', 'POST', { commandId: 'capture', snapshot: view,
      captures: [{ view: 'current', mode: 'lit', quality: 'draft', width: 1, height: 1, dataUrl: png, raster: { width: 1, height: 1, samples: 0 } }] });
    const captured = await capture.json(); expect(capture.status).toBe(200); expect(captured.captures).toHaveLength(1);
    const invalid = await request('/sessions/scene/captures', 'POST', { commandId: 'capture', snapshot: view,
      captures: [{ view: 'current', mode: 'lit', quality: 'draft', width: 1, height: 1, dataUrl: png, raster: { width: 2, height: 1, samples: 0 } }] });
    expect(invalid.status).toBe(400);
    await request('/sessions/scene/ack', 'POST', { commandId: 'capture', ok: true, snapshot: view, result: { captures: [{ path: 'forged.png' }] } });
    const result = await (await request('/sessions/scene/commands/capture')).json();
    expect(result.result.captures[0].path).toBe(captured.captures[0].path);
    expect(result.result.captures[0].raster).toEqual({ width: 1, height: 1, samples: 0 });
    expect(fs.existsSync(path.join(root, result.result.captures[0].path))).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: 'workflow-updated', key: doc.id });
  });
  it('publishes a Node-only helper without requiring Blender and rejects an unbound workflow', async () => {
    const kit = await (await request('/authoring/native-kit?projectId=' + encodeURIComponent(root))).json();
    expect(kit.files['vibi3d_native.mjs']).toContain('waitForCommand');
    await request('/sessions', 'POST', { snapshot: view, rendererToken: token });
    await request('/sessions/scene/commands', 'POST', { commandId: 'save', expectedRevision: 0, commands: [{ type: 'checkpoint', stage: 'x', label: 'X' }] }, true);
    expect((await (await request('/sessions/scene/checkpoint', 'POST', { commandId: 'save', snapshot: view, payload: doc.payload })).json()).error).toBe('run-required');
  });
  it('rejects a previous alias renderer after another screen takes over the same document', async () => {
    view = { ...view, projectId: 'fixture' }; await start();
    await request('/sessions/scene/commands', 'POST', { commandId: 'save', expectedRevision: 0,
      commands: [{ type: 'checkpoint', stage: 'late', label: 'Late' }] }, true);
    now += 30_001;
    await request(documentRoute('reopen'), 'POST', { projectId: root, runId: 'run' }, true);
    const next = { ...view, projectId: root, sessionId: 'new-scene', ownerId: 'new-screen' };
    expect((await request('/sessions', 'POST', { snapshot: next, rendererToken: token })).status).toBe(200);
    expect((await request('/sessions/scene/publish', 'POST', { snapshot: view })).status).toBe(409);
    expect((await request('/sessions/scene/pending')).status).toBe(409);
    expect((await request('/sessions/scene/progress', 'POST', { commandId: 'save', progress: 0.5 })).status).toBe(409);
    expect((await request('/sessions/scene/checkpoint', 'POST', { commandId: 'save', snapshot: view, payload: doc.payload })).status).toBe(409);
    expect((await request('/sessions/scene/ack', 'POST', { commandId: 'save', ok: true, snapshot: view })).status).toBe(409);
    expect(store.get(root, doc.id).revision).toBe(1);
  });
  it('rechecks renderer ownership after asynchronous blob persistence before committing', async () => {
    await start();
    await request('/sessions/scene/commands', 'POST', { commandId: 'save', expectedRevision: 0,
      commands: [{ type: 'checkpoint', stage: 'late', label: 'Late' }] }, true);
    let release!: () => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const externalize = store.externalize.bind(store);
    vi.spyOn(store, 'externalize').mockImplementationOnce(async (...args) => { entered(); await blocked; return externalize(...args); });
    const pending = request('/sessions/scene/checkpoint', 'POST', { commandId: 'save', snapshot: view, payload: doc.payload });
    await started; now += 30_001;
    await request(documentRoute('reopen'), 'POST', { projectId: root, runId: 'run' }, true);
    const next = { ...view, sessionId: 'new-scene', ownerId: 'new-screen' };
    expect((await request('/sessions', 'POST', { snapshot: next, rendererToken: token })).status).toBe(200);
    release(); expect((await pending).status).toBe(409);
    expect(store.get(root, doc.id).revision).toBe(1);
  });
  it('replays a saved checkpoint after a lost response and timeout, but never executes an unsaved expired command', async () => {
    await start();
    await request('/sessions/scene/commands', 'POST', { commandId: 'saved', expectedRevision: 0,
      commands: [{ type: 'checkpoint', stage: 'blockout', label: 'Blockout' }] }, true);
    const input = { commandId: 'saved', snapshot: view, payload: { ...doc.payload as object, note: 'saved' } };
    expect((await request('/sessions/scene/checkpoint', 'POST', input)).status).toBe(200);
    now += 120_001;
    expect((await (await request('/sessions/scene/commands/saved')).json()).status).toBe('rejected');
    const replay = await request('/sessions/scene/checkpoint', 'POST', input);
    expect(replay.status).toBe(200); expect((await replay.json()).stage).toMatchObject({ revision: 1, mode: 'intermediate' });
    view = { ...view, document: { id: doc.id, revision: 1, dirty: true, humanDirty: false } };
    expect((await (await request('/sessions/scene/ack', 'POST', { commandId: 'saved', ok: true, snapshot: view })).json()).status).toBe('applied');
    await request('/sessions/scene/commands', 'POST', { commandId: 'unsaved', expectedRevision: 0,
      commands: [{ type: 'checkpoint', stage: 'late', label: 'Late' }] }, true);
    now += 120_001;
    const expired = await request('/sessions/scene/checkpoint', 'POST', { commandId: 'unsaved', snapshot: view, payload: { ...doc.payload as object, note: 'never-saved' } });
    expect(expired.status).toBe(409); expect(store.get(root, doc.id).revision).toBe(1);
  });
});
