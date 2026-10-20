import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CREATION_LIMITS, LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE, LOOPBACK_REQUEST_MAX_BYTES, parseCreationBlobRef } from '@vibisual/shared';
import { mountCreationRoutes } from './creationRoutes.js';
import { CreationStore, type CreationHost } from './creationStore.js';
import { mountAppBodyParsers } from './appHost.js';

vi.mock('./projectGraphManager.js', () => ({ graphManager: {} }));

let root: string, base: string, server: Server, host: CreationHost, store: CreationStore;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'creation-api-'));
  const app = express(); mountAppBodyParsers(app); app.use(express.json());
  const router = express.Router();
  host = {
    resolveProjectPath: value => {
      if (value === 'explode') throw new Error('resolver exploded');
      return value === 'project' ? root : value === 'gone' ? path.join(root, 'missing') : null;
    },
    atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, data); fs.renameSync(`${file}.tmp`, file); },
    warn: vi.fn(),
  };
  store = new CreationStore(host);
  mountCreationRoutes(router as unknown as express.Express, host, store);
  app.use('/api/app/creation', router);
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
  base = `http://127.0.0.1:${address.port}/api/app/creation`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});
const request = (url: string, data?: object, agent = false) => fetch(base + url, {
  method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(agent ? { [LOOPBACK_INGRESS_HEADER]: LOOPBACK_INGRESS_VALUE } : {}) },
  ...(data ? { body: JSON.stringify({ projectId: 'project', ...data }) } : {}),
});
async function create(payload: object = { layers: [{ id: 'price', text: '$10' }] }) {
  const response = await request('/docs', { appId: 'vibimage', title: 'Poster', payload });
  return (await response.json()).doc;
}

describe('creation app API', () => {
  it('moves inline binaries out of the payload and serves them by content hash', async () => {
    const png = `data:image/png;base64,${Buffer.alloc(200_000, 9).toString('base64')}`;
    const doc = await create({ texture: png, plain: 'a'.repeat(180_000) });
    const read = (await (await request(`/docs/${doc.id}?projectId=project`)).json()).doc;
    expect(read.payload.plain).toHaveLength(180_000);
    const ref = parseCreationBlobRef(read.payload.texture)!;
    expect(ref.ext).toBe('png');
    const blob = await fetch(`${base}/blobs/${ref.name}?projectId=project`);
    expect(blob.headers.get('Content-Type')).toBe('image/png');
    expect(blob.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(Buffer.from(await blob.arrayBuffer()).equals(Buffer.alloc(200_000, 9))).toBe(true);
  });
  it('uploads raw blobs once and reports which ones are missing', async () => {
    const values = new Float32Array([0.5, 1.25, -2]);
    const put = await fetch(`${base}/blobs?projectId=project&ext=f32`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from(values.buffer) });
    const { ref } = await put.json();
    const name = parseCreationBlobRef(ref)!.name;
    const missing = await (await request('/blobs/missing', { names: [name, `${'b'.repeat(64)}.png`] })).json();
    expect(missing.missing).toEqual([`${'b'.repeat(64)}.png`]);
    expect((await (await fetch(`${base}/blobs/${name}?projectId=project&format=json`)).json()).values).toEqual([0.5, 1.25, -2]);
    expect((await fetch(`${base}/blobs?projectId=project&ext=f64`, { method: 'PUT', body: Buffer.alloc(3) })).status).toBe(400);
  });
  it('returns a usable current source with a 409 and blocks user decisions from the agent ingress', async () => {
    const doc = await create();
    const edit = { baseRevision: 1, requestId: 'human', payload: { layers: [{ id: 'price', text: '$20' }] } };
    expect((await request(`/docs/${doc.id}/commit`, edit)).status).toBe(200);
    const conflict = await request(`/docs/${doc.id}/commit`, { ...edit, requestId: 'agent', payload: { layers: [] } }, true);
    expect(conflict.status).toBe(409); expect((await conflict.json()).doc.revision).toBe(2);
    for (const operation of ['undo', 'redo', 'restore']) {
      expect((await request(`/docs/${doc.id}/${operation}`, { baseRevision: 2, requestId: operation, revision: 1 }, true)).status).toBe(403);
    }
    for (const url of [`/docs/${doc.id}/candidates-cleanup`, `/docs/${doc.id}/candidates/x/discard`, `/docs/${doc.id}/candidates/x/rebase`, `/docs/${doc.id}/links/x/keep`]) {
      expect((await request(url, { scope: 'all', requestId: 'r', revision: 2 }, true)).status).toBe(403);
    }
  });
  it('keeps agent proposals distinct, lists them without payload, and lets only the user accept', async () => {
    const doc = await create();
    const proposed = await request(`/docs/${doc.id}/candidates`, { baseRevision: 1, requestId: 'candidate', payload: { layers: [{ id: 'price', text: '$30' }] }, input: 'Change only price' }, true);
    expect(proposed.status).toBe(200);
    const listed = (await (await request(`/docs/${doc.id}/candidates?projectId=project`)).json()).candidates;
    expect(listed[0]).not.toHaveProperty('payload');
    expect((await (await request(`/docs/${doc.id}/candidates/candidate?projectId=project`)).json()).candidate.payload.layers[0].text).toBe('$30');
    expect((await (await request(`/docs/${doc.id}/head?projectId=project`)).json()).head).toMatchObject({ revision: 1, pendingCandidates: 1 });
    const url = `/docs/${doc.id}/candidates/candidate/accept`;
    expect((await request(url, { baseRevision: 1, requestId: 'accept' }, true)).status).toBe(403);
    expect((await request(`/docs/${doc.id}?projectId=project`)).headers.get('Cache-Control')).toBe('no-store');
    expect((await request(url, { baseRevision: 1, requestId: 'accept' })).status).toBe(200);
    const current = await (await request(`/docs/${doc.id}?projectId=project`)).json();
    expect(current.doc.payload.layers[0].text).toBe('$30');
    expect(current.doc.canUndo).toBe(true);
  });
  it('tells the agent why a stale proposal is refused', async () => {
    const doc = await create();
    await request(`/docs/${doc.id}/commit`, { baseRevision: 1, requestId: 'human', payload: { layers: [] } });
    const stale = await request(`/docs/${doc.id}/candidates`, { baseRevision: 1, requestId: 'late', payload: {} }, true);
    expect(stale.status).toBe(409);
    expect((await stale.json()).detail).toMatchObject({ currentRevision: 2, reason: expect.stringContaining('Read the latest revision') });
  });
  it('validates project, references, requirements, and immutable source versions', async () => {
    const doc = await create();
    expect((await request(`/docs/${doc.id}?projectId=other`)).status).toBe(404);
    expect((await request(`/docs/${doc.id}?projectId=gone`)).status).toBe(404);
    expect((await request(`/docs/${doc.id}/revisions/2?projectId=project`)).status).toBe(404);
    expect((await request(`/docs/${doc.id}/commit`, { baseRevision: 1, requestId: 'link', links: [{ id: 'x', sourceId: doc.id, sourceRevision: 1, targets: [], role: 'x' }] })).status).toBe(400);
    expect((await request(`/docs/${doc.id}/check`, { baseRevision: 1, requirements: [{}] })).status).toBe(400);
    const checked = await (await request(`/docs/${doc.id}/check`, { baseRevision: 1, requirements: [
      { id: 'price', kind: 'equals', pointer: '/layers/@price/text', expected: '$10', description: 'Requested price' },
      { id: 'appearance', kind: 'visual', description: 'Brand appearance' },
    ] })).json();
    expect(checked.checks.map((c: { status: string }) => c.status)).toEqual(['passed', 'needs-review']);
  });
  it('keeps mirrors read-only over HTTP while recording keep decisions', async () => {
    const model = await create();
    const mirror = store.sync('project', { key: 'video-1', appId: 'vibistudio', title: 'Movie', links: [{ id: 'asset', sourceId: model.id, sourceRevision: 1, role: 'model', targets: ['clip'] }] })!;
    expect((await request(`/docs/${mirror.id}/commit`, { baseRevision: 1, requestId: 'x', payload: {} })).status).toBe(403);
    await request(`/docs/${model.id}/commit`, { baseRevision: 1, requestId: 'v2', payload: { layers: [] } });
    expect((await request(`/docs/${mirror.id}/links/asset/keep`, { revision: 2 })).status).toBe(200);
    const found = await (await request('/mirror?projectId=project&appId=vibistudio&key=video-1')).json();
    expect(found.doc.links[0].keptRevision).toBe(2);
  });
  it('lists summaries with failures instead of hiding unreadable documents', async () => {
    const good = await create();
    const bad = await create({ broken: true });
    fs.writeFileSync(path.join(root, '.vibisual/creation', bad.id, 'state.json'), '{');
    fs.writeFileSync(path.join(root, '.vibisual/creation', bad.id, 'previous.json'), '{');
    const listed = await (await request('/docs?projectId=project')).json();
    expect(listed.docs.map((d: { id: string }) => d.id)).toEqual([good.id]);
    expect(listed.docs[0]).not.toHaveProperty('payload');
    expect(listed.failed).toEqual([{ id: bad.id, error: 'source-unreadable' }]);
  });
  it('logs unexpected failures and answers with a stable code', async () => {
    const response = await request('/docs?projectId=explode');
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('source-request-failed');
    expect(host.warn).toHaveBeenCalledWith(expect.stringContaining('resolver exploded'));
  });
  it('shares one request limit with the loopback ingress', async () => {
    expect(CREATION_LIMITS.requestBytes).toBe(LOOPBACK_REQUEST_MAX_BYTES);
    const tooLarge = await request('/docs', { appId: 'vibimage', title: 'Big', payload: { text: 'x'.repeat(LOOPBACK_REQUEST_MAX_BYTES) } });
    expect(tooLarge.status).toBe(413);
  });
});
