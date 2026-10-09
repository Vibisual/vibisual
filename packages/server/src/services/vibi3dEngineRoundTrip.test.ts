import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { VIBI3D_RENDERER_TOKEN_HEADER, type Vibi3DCommand, type Vibi3DCommandRequest, type Vibi3DSnapshot } from '@vibisual/shared';
import { mountVibi3DRoutes } from './vibi3dRoutes.js';

// This integration fixture loads the actual renderer engine without making the server
// production package import the client or adding Three.js to server dependencies.
const editorModulePath = new URL('../../../client/src/components/Vibi3D/modelEditor.ts', import.meta.url).href;
const threeModulePath = new URL('../../../client/node_modules/three/build/three.module.js', import.meta.url).href;
const { ModelEditor } = await import(editorModulePath);
const THREE = await import(threeModulePath);
interface Editor {
  readonly sessionId: string;
  readonly revision: number;
  snapshot(): Vibi3DSnapshot;
  apply(commands: Vibi3DCommand[], expectedRevision: number): Vibi3DSnapshot;
}
let server: Server;
let base: string;
let editor: Editor;
let cubeId: string;
let secondId: string;
const token = 'renderer-round-trip-123456';
const headers = { 'Content-Type': 'application/json', [VIBI3D_RENDERER_TOKEN_HEADER]: token };
async function call(path: string, method = 'GET', body?: unknown) {
  return fetch(`${base}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const route = () => `/sessions/${editor.sessionId}`;
async function rendererApply(): Promise<void> {
  const { request } = await (await call(`${route()}/pending`)).json() as { request: Vibi3DCommandRequest | null };
  if (!request) return;
  try {
    const snapshot = editor.apply(request.commands, request.expectedRevision);
    expect((await call(`${route()}/ack`, 'POST', { commandId: request.commandId, ok: true, snapshot })).status).toBe(200);
  } catch (error) {
    expect((await call(`${route()}/ack`, 'POST', { commandId: request.commandId, ok: false,
      error: error instanceof Error ? error.message : String(error), snapshot: editor.snapshot() })).status).toBe(200);
  }
}
beforeEach(async () => {
  const group = new THREE.Group(); group.name = 'Test scene';
  const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#ffffff' })); cube.name = 'Cube';
  const second = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#ffffff' })); second.name = 'Other';
  group.add(cube, second);
  editor = new ModelEditor(group, [], { projectId: 'fixture', fileName: 'scene.glb' }) as Editor;
  cubeId = editor.snapshot().nodes.find((n) => n.name === 'Cube')!.id;
  secondId = editor.snapshot().nodes.find((n) => n.name === 'Other')!.id;
  const app = express(); app.use(express.json());
  mountVibi3DRoutes(app, { resolveProjectPath: (id) => id === 'fixture' ? '/fixture' : null });
  await new Promise<void>((done) => { server = app.listen(0, '127.0.0.1', () => done()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing test port');
  base = `http://127.0.0.1:${address.port}`;
  expect((await call('/sessions', 'POST', { snapshot: editor.snapshot(), rendererToken: token })).status).toBe(200);
});
afterEach(async () => { await new Promise<void>((done, reject) => server.close((error) => error ? reject(error) : done())); });

describe('real HTTP bridge to the actual Three.js editing engine', () => {
  it('applies a transform/color batch, reports it only after ACK, and undoes it as one action', async () => {
    const commands: Vibi3DCommand[] = [{ type: 'update', id: cubeId, position: [2, 3, 4], color: '#2255ff' }, { type: 'lighting', intensity: 2 }];
    expect((await call(`${route()}/commands`, 'POST', { commandId: 'batch', expectedRevision: 0, commands })).status).toBe(202);
    expect((await (await call(`${route()}/commands/batch`)).json()).status).toBe('pending');
    await rendererApply();
    expect((await (await call(`${route()}/commands/batch`)).json()).status).toBe('applied');
    const { snapshot } = await (await call(route())).json() as { snapshot: Vibi3DSnapshot };
    expect(snapshot.nodes.find((n) => n.id === cubeId)).toMatchObject({ position: [2, 3, 4], color: '#2255ff' });
    expect(snapshot.lighting).toBe(2);
    expect(snapshot.revision).toBe(1);
    await call(`${route()}/commands`, 'POST', { commandId: 'undo', expectedRevision: snapshot.revision, commands: [{ type: 'undo' }] });
    await rendererApply();
    expect(editor.snapshot().nodes.find((n) => n.id === cubeId)).toMatchObject({ position: [0, 0, 0], color: '#ffffff' });
    expect(editor.snapshot().lighting).toBe(1);
  });
  it('preserves a human edit made after AI read; recalculated AI edits keep unrelated human changes', async () => {
    const request = { commandId: 'stale-ai', expectedRevision: 0, commands: [{ type: 'update', id: cubeId, position: [10, 0, 0] }] };
    expect((await call(`${route()}/commands`, 'POST', request)).status).toBe(202);
    // The person commits before the next renderer poll; the server has not seen it yet.
    editor.apply([{ type: 'update', id: cubeId, position: [1, 0, 0] }, { type: 'update', id: secondId, color: '#00aa00' }], 0);
    await rendererApply();
    expect((await (await call(`${route()}/commands/stale-ai`)).json()).status).toBe('rejected');
    expect(editor.snapshot().nodes.find((n) => n.id === cubeId)!.position).toEqual([1, 0, 0]);
    const { snapshot } = await (await call(route())).json() as { snapshot: Vibi3DSnapshot };
    const current = snapshot.nodes.find((n) => n.id === cubeId)!;
    await call(`${route()}/commands`, 'POST', { commandId: 'fresh-ai', expectedRevision: snapshot.revision,
      commands: [{ type: 'update', id: cubeId, position: [current.position[0] + 1, current.position[1], current.position[2]] }] });
    await rendererApply();
    expect(editor.snapshot().nodes.find((n) => n.id === cubeId)!.position).toEqual([2, 0, 0]);
    expect(editor.snapshot().nodes.find((n) => n.id === secondId)!.color).toBe('#00aa00');
  });
});
