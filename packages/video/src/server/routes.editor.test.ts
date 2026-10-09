import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountVideoRoutes, videoService } from './routes.js';

let root: string;
let other: string;
let server: Server;
let base: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-routes-'));
  other = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-other-'));
  const app = express(); app.use(express.json());
  mountVideoRoutes(app, {
    resolveProjectPath: name => name === 'test' ? root : name === 'other' ? other : null,
    atomicWriteFile: (file, data) => fs.writeFileSync(file, data), info: () => undefined, warn: () => undefined,
  });
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true });
});
describe('Studio media and render routes', () => {
  it('uploads media then serves its hidden project path byte-for-byte', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const uploaded = await fetch(`${base}/assets?project=test&name=picture.png`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    expect(uploaded.status).toBe(200);
    const body = await uploaded.json() as { asset: { source: { path: string } } };
    const served = await fetch(`${base}/asset?project=test&path=${encodeURIComponent(body.asset.source.path)}`);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
  });
  it('rejects unknown projects and invalid binary bodies', async () => {
    expect((await fetch(`${base}/assets?project=missing&name=x.mp4`, { method: 'PUT' })).status).toBe(404);
    expect((await fetch(`${base}/assets?project=test&name=x.mp4`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(400);
  });
  it('claims only work belonging to the requested project', async () => {
    const otherJob = videoService.enqueueRender(other, 'foreign');
    const ownJob = videoService.enqueueRender(root, 'own');
    const res = await fetch(`${base}/jobs/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'test' }) });
    const body = await res.json() as { job: { id: string } };
    expect(body.job.id).toBe(ownJob.id);
    expect(videoService.getJob(otherJob.id)?.status).toBe('queued');
  });
  it('does not let late progress revive a terminal render', () => {
    const job = videoService.enqueueRender(root, 'finished');
    videoService.updateJob(job.id, { status: 'done', progress: 1 });
    videoService.updateJob(job.id, { status: 'running', progress: 0.5 });
    expect(videoService.getJob(job.id)).toMatchObject({ status: 'done', progress: 1 });
  });
  it('accepts render outputs larger than the global JSON body limit as binary', async () => {
    const job = videoService.enqueueRender(root, 'binary-render');
    videoService.updateJob(job.id, { status: 'running' });
    const bytes = new Uint8Array(256 * 1024).fill(7);
    const res = await fetch(`${base}/job/${job.id}/output`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    expect(res.status).toBe(200);
    const saved = videoService.getJob(job.id);
    expect(saved?.status).toBe('done');
    expect(fs.readFileSync(saved!.result!)).toEqual(Buffer.from(bytes));
    expect((await fetch(`${base}/job/${job.id}/output`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })).status).toBe(409);
  });
  it('resolves a pending still with large PNG bytes without JSON upload', async () => {
    const pending = videoService.requestStill(root, 'still', 1);
    const claimed = videoService.claimNext(root)!;
    const bytes = new Uint8Array(256 * 1024).fill(9);
    const res = await fetch(`${base}/job/${claimed.id}/output`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    expect(res.status).toBe(200);
    expect((await pending).result).toBe(`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`);
  });
});
