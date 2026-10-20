import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE } from '@vibisual/shared';
import { mountVibi3DDraftRoutes } from './vibi3dDraftRoutes.js';

let root: string; let server: Server; let base: string;
const key = 'file:models/building.glb';
const scope = `projectId=project&key=${encodeURIComponent(key)}&actor=agent`;
const body = { projectId: 'project', key, actor: 'agent', expectedVersion: 0, requestId: 'save-1', fileName: 'building.glb', payload: { model: true } };
async function request(route: string, input?: unknown, ingress = false) {
  return fetch(base + route, { method: input === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
    ...(ingress ? { [LOOPBACK_INGRESS_HEADER]: LOOPBACK_INGRESS_VALUE } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi3d-draft-routes-'));
  const app = express(); app.use(express.json());
  mountVibi3DDraftRoutes(app, { resolveProjectPath: value => value === 'project' ? root : null,
    atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, data); fs.renameSync(`${file}.tmp`, file); } });
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

describe('Vibi3D draft routes', () => {
  it('provides save/restart discovery/history/read and explicit actor-only discard', async () => {
    expect(await (await request(`/drafts/current?${scope}`)).json()).toEqual({ ok: true, draft: null, version: 0 });
    expect((await request('/drafts/save', body)).status).toBe(200);
    expect(await (await request('/drafts?projectId=project')).json()).toMatchObject({ ok: true, drafts: [{ key, actor: 'agent', version: 1 }], failed: [] });
    expect(await (await request(`/drafts/history?${scope}`)).json()).toMatchObject({ revisions: [{ version: 1 }] });
    expect(await (await request(`/drafts/revisions/1?${scope}`)).json()).toMatchObject({ draft: { payload: body.payload } });
    const conflict = await request('/drafts/save', { ...body, requestId: 'other' });
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ error: 'draft-version-conflict', detail: { version: 1 } });
    expect(await (await request('/drafts/discard', { ...body, expectedVersion: 1, requestId: 'discard-1' })).json()).toMatchObject({ draft: null, version: 2 });
    expect(await (await request(`/drafts/current?${scope}`)).json()).toEqual({ ok: true, draft: null, version: 2 });
  });
  it('rejects all hook mutation paths before writing, and scopes every read to an authorized project', async () => {
    for (const route of ['/drafts/save', '/drafts/discard']) {
      const response = await request(route, body, true);
      expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: 'renderer-only' });
    }
    expect((await request('/drafts?projectId=missing')).status).toBe(404);
    expect((await request('/drafts/current?projectId=project&key=x&actor=agent')).status).toBe(400);
    expect((await request('/drafts/save', null)).status).toBe(400);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
