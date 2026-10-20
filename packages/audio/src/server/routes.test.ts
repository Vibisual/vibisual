import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountAudioRoutes } from './routes.js';

describe('audio HTTP contract', () => {
  let root: string;
  let server: Server;
  let base: string;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisound-http-test-'));
    const app = express();
    app.use(express.json());
    const router = express.Router();
    mountAudioRoutes(router as unknown as express.Express, {
      resolveProjectPath: (raw) => raw === 'project' ? root : null,
      resolveWorkspacePath: (dir, relative) => {
        const abs = path.resolve(dir, relative), rel = path.relative(dir, abs);
        return rel.startsWith('..') || path.isAbsolute(rel) ? null : { abs, rel: rel.replace(/\\/g, '/') };
      },
      atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); },
      info: vi.fn(), warn: vi.fn(),
    });
    app.use('/api/app/vibisound', router);
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port.');
    base = `http://127.0.0.1:${address.port}/api/app/vibisound`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vibisound-http-test-')) throw new Error('Unsafe test cleanup.');
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('returns an explicit conflict, persists state, and replays a successful request once', async () => {
    const created = await (await post(`${base}/docs`, { project: 'project', id: 'doc', title: 'Voice' })).json();
    const request = { project: 'project', baseVersion: created.doc.version, requestId: 'once', ops: [{ op: 'setDoc', patch: { title: 'Changed' } }] };
    expect((await post(`${base}/doc/doc/patch`, request)).status).toBe(200);
    const stale = await post(`${base}/doc/doc/patch`, { ...request, requestId: 'stale' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ ok: false, error: 'version-conflict', currentVersion: created.doc.version + 1 });
    expect(await (await post(`${base}/doc/doc/patch`, request)).json()).toMatchObject({ replayed: true, canUndo: true, doc: { title: 'Changed' } });
    expect(await (await fetch(`${base}/doc/doc?project=project`)).json()).toMatchObject({ ok: true, doc: { title: 'Changed' } });
    expect((await fetch(`${base}/doc/doc?project=other`)).status).toBe(404);
  });

  it('uploads real bytes and serves named-project assets with Range, but rejects unregistered paths', async () => {
    const bytes = Buffer.alloc(44 + 1600);
    bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(1600, 40);
    const upload = await fetch(`${base}/assets?project=project&name=voice.wav`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    expect(upload.status).toBe(200);
    const { asset } = await upload.json();
    expect(asset).toMatchObject({ duration: 0.1, sampleRate: 8000, channels: 1 });
    const partial = await fetch(`${base}/asset?project=project&path=${encodeURIComponent(asset.path)}`, { headers: { Range: 'bytes=0-11' } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 0-11/${bytes.length}`);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(0, 12));
    expect((await fetch(`${base}/asset?project=project&path=secret.wav`)).status).toBe(404);
    const badUpload = await fetch(`${base}/assets?project=project&name=voice.wav`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(badUpload.status).toBe(400);
  });

  it('copies a document through the authenticated app route and refuses missing sources', async () => {
    await post(`${base}/docs`, { project: 'project', id: 'source', title: 'Original' });
    const request = { project: 'project', title: 'Copy', requestId: 'copy-request' };
    const copied = await post(`${base}/doc/source/copy`, request);
    expect(copied.status).toBe(200);
    const first = await copied.json();
    expect(first).toMatchObject({ doc: { title: 'Copy', version: 1 }, canUndo: false, canRedo: false });
    expect(await (await post(`${base}/doc/source/copy`, request)).json()).toEqual(first);
    expect((await post(`${base}/doc/unknown/copy`, request)).status).toBe(404);
    expect((await post(`${base}/doc/source/copy`, { ...request, requestId: '../invalid' })).status).toBe(400);
  });

  it('exposes editing capabilities and explicitly inactive connection drafts', async () => {
    expect(await (await fetch(`${base}/capabilities`)).json()).toMatchObject({ providersActive: false, operations: expect.arrayContaining([{ op: 'removeClip', clipId: 'clip-1' }]) });
    expect(await (await fetch(`${base}/settings?project=project`)).json()).toEqual({ ok: true, settings: { providers: [] }, active: false });
    const response = await fetch(`${base}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'project', settings: { providers: [{ id: 'api', kind: 'api', name: 'API', endpoint: 'https://localhost/api', model: '', capabilities: ['generate'], token: 'must-not-save' }] } }) });
    expect(response.status).toBe(400);
    expect(fs.existsSync(path.join(root, '.vibisual', 'audio', 'settings.json'))).toBe(false);
  });
});
