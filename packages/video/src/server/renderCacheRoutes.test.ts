import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE } from '@vibisual/shared';

import { createEmptyDoc, type VideoDoc } from '../index.js';
import { assetFileStamps, sharedFilesStamp } from './renderCacheRoutes.js';
import { mountVideoRoutes, videoService } from './routes.js';
import { segmentDirFor } from './segmentCache.js';

const key = (n: number): string => n.toString(16).padStart(64, '0');
const AGENT = { [LOOPBACK_INGRESS_HEADER]: LOOPBACK_INGRESS_VALUE };
const OCTET = { 'Content-Type': 'application/octet-stream' };
const JSON_HEAD = { 'Content-Type': 'application/json' };

let root: string;
let server: Server;
let base: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-rcache-'));
  const app = express(); app.use(express.json());
  mountVideoRoutes(app, {
    resolveProjectPath: (name) => (name === 'test' ? root : null),
    atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }, info: () => undefined, warn: () => undefined,
  });
  server = await new Promise<Server>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, text: string): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

function docWithAssets(id: string): VideoDoc {
  return {
    ...createEmptyDoc(id, id),
    assets: {
      pic: { id: 'pic', kind: 'image', source: { kind: 'file', path: 'media/pic.png' } },
      gone: { id: 'gone', kind: 'image', source: { kind: 'file', path: 'media/none.png' } },
      made: { id: 'made', kind: 'audio', source: { kind: 'external', command: 'tts', output: 'media/voice.wav' } },
    },
  };
}

const post = (url: string, body: object, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base}${url}`, { method: 'POST', headers: { ...JSON_HEAD, ...headers }, body: JSON.stringify(body) });
const put = (docId: string, k: string, bytes: Uint8Array, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base}/doc/${docId}/render-cache/${k}?project=test`, { method: 'PUT', headers: { ...OCTET, ...headers }, body: bytes });
const get = (docId: string, k: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${base}/doc/${docId}/render-cache/${k}?project=test`, { headers });

describe('렌더 구간 캐시의 길 — (E-7)(E-9)', () => {
  it('조각을 쓰고·묻고·그대로 읽는다', async () => {
    videoService.writeDoc(root, createEmptyDoc('d1', 'Doc'));
    const bytes = new Uint8Array([9, 8, 7, 6, 5, 0, 255]);
    const stored = await put('d1', key(1), bytes);
    expect(stored.status).toBe(200);
    expect(await stored.json()).toMatchObject({ ok: true, stored: true });

    const asked = await post('/doc/d1/render-cache/query', { project: 'test', keys: [key(1), key(2), 'junk', 5] });
    expect(await asked.json()).toEqual({ ok: true, have: [key(1)] });

    const read = await get('d1', key(1));
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toContain('application/octet-stream');
    expect([...new Uint8Array(await read.arrayBuffer())]).toEqual([...bytes]);
    expect((await get('d1', key(2))).status).toBe(404);
    expect(fs.readdirSync(segmentDirFor(root, 'd1'))).toEqual([`${key(1)}.seg`]);
  });

  it('깨진 조각은 내주지 않는다(없는 것으로 답하고 지운다)', async () => {
    videoService.writeDoc(root, createEmptyDoc('d1', 'Doc'));
    await put('d1', key(1), new Uint8Array(64).fill(3));
    const file = path.join(segmentDirFor(root, 'd1'), `${key(1)}.seg`);
    const raw = fs.readFileSync(file);
    raw[raw.length - 2] = raw[raw.length - 2]! ^ 1;
    fs.writeFileSync(file, raw);
    expect((await get('d1', key(1))).status).toBe(404);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('루프백으로 온 요청(에이전트)은 전부 거절한다 — 조각을 바꿔 넣지 못한다', async () => {
    videoService.writeDoc(root, createEmptyDoc('d1', 'Doc'));
    await put('d1', key(1), new Uint8Array([1, 2, 3]));
    for (const res of [
      await post('/doc/d1/render-cache/env', { project: 'test' }, AGENT),
      await post('/doc/d1/render-cache/query', { project: 'test', keys: [key(1)] }, AGENT),
      await get('d1', key(1), AGENT),
      await put('d1', key(1), new Uint8Array([6, 6, 6]), AGENT),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ ok: false, error: 'renderer-only' });
    }
    expect([...new Uint8Array(await (await get('d1', key(1))).arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('모르는 프로젝트·문서, 열쇠 모양이 아닌 이름, 빈 본문은 받지 않는다', async () => {
    videoService.writeDoc(root, createEmptyDoc('d1', 'Doc'));
    expect((await fetch(`${base}/doc/d1/render-cache/${key(1)}?project=nope`)).status).toBe(404);
    expect((await put('ghost', key(1), new Uint8Array([1]))).status).toBe(404);
    expect(fs.existsSync(segmentDirFor(root, 'ghost'))).toBe(false);
    expect((await put('d1', 'short', new Uint8Array([1]))).status).toBe(400);
    expect((await get('d1', 'short')).status).toBe(400);
    expect((await put('d1', key(1), new Uint8Array(0))).status).toBe(400);
    expect((await post('/doc/bad%20id/render-cache/query', { project: 'test', keys: [] })).status).toBe(400);
    expect((await post('/doc/ghost/render-cache/env', { project: 'test' })).status).toBe(404);
  });

  it('문서를 지우면 그 문서의 조각 자리도 걷는다', async () => {
    videoService.writeDoc(root, createEmptyDoc('d1', 'Doc'));
    await put('d1', key(1), new Uint8Array([1, 2, 3]));
    const dir = segmentDirFor(root, 'd1');
    expect(fs.existsSync(dir)).toBe(true);
    expect((await fetch(`${base}/doc/d1?project=test`, { method: 'DELETE' })).status).toBe(200);
    for (let i = 0; i < 100 && fs.existsSync(dir); i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe('문서 밖 지문 — (E-8) ②', () => {
  it('소재 파일의 크기·수정 시각을 내고, 못 읽은 소재는 missing 이다', async () => {
    write('media/pic.png', 'png-bytes');
    write('media/voice.wav', 'wav');
    const doc = docWithAssets('d1');
    videoService.writeDoc(root, doc);
    const res = await post('/doc/d1/render-cache/env', { project: 'test' });
    expect(res.status).toBe(200);
    const body = await res.json() as { files: Record<string, string>; shared: string };
    expect(body.files['pic']).toMatch(/^9:\d+$/);
    expect(body.files['made']).toMatch(/^3:\d+$/);
    expect(body.files['gone']).toBe('missing');
    expect(body.shared).toBe('');
    expect(await assetFileStamps(root, doc)).toEqual(body.files);
  });

  it('파일이 제자리에서 바뀌면 지문이 바뀐다', async () => {
    const file = write('media/pic.png', 'png-bytes');
    const doc = docWithAssets('d1');
    const before = await assetFileStamps(root, doc);
    fs.writeFileSync(file, 'png-bytes-longer');
    expect((await assetFileStamps(root, doc))['pic']).not.toBe(before['pic']);
    fs.writeFileSync(file, 'png-bytes');
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(file, later, later);
    // 크기가 같아도 수정 시각이 다르면 다른 지문이다.
    expect((await assetFileStamps(root, doc))['pic']).not.toBe(before['pic']);
  });

  it('프로젝트 밖을 가리키는 소재는 읽지 않는다', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.png'), 'x');
      const doc: VideoDoc = { ...createEmptyDoc('d1', 'd'), assets: { out: { id: 'out', kind: 'image', source: { kind: 'file', path: path.join(outside, 'secret.png') } } } };
      expect(await assetFileStamps(root, doc)).toEqual({ out: 'missing' });
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });

  it('공유 파일(글꼴·로고·가져온 라이브러리) 지문은 파일이 더해지거나 바뀌면 달라진다', async () => {
    expect(await sharedFilesStamp(root)).toBe('');
    write('.vibisual/video/libs/style/brand.woff2', 'font');
    const one = await sharedFilesStamp(root);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(await sharedFilesStamp(root)).toBe(one);
    write('.vibisual/video/libs/gsap/gsap.min.js', 'lib');
    const two = await sharedFilesStamp(root);
    expect(two).not.toBe(one);
    write('.vibisual/video/libs/gsap/gsap.min.js', 'lib-v2');
    expect(await sharedFilesStamp(root)).not.toBe(two);
  });
});

describe('DELETE /job/:jobId/output — (E-5) ③ 올리던 결과 버리기', () => {
  const stream = (jobId: string, bytes: Uint8Array, start: number): Promise<Response> => fetch(`${base}/job/${jobId}/output`, {
    method: 'PUT', headers: { ...OCTET, 'Content-Range': `bytes ${start}-${start + bytes.length - 1}/*` }, body: bytes,
  });
  const commit = (jobId: string, total: number): Promise<Response> => post(`/job/${jobId}/output/commit`, { total });
  const parts = (): string[] => {
    const dir = path.join(root, '.vibisual', 'video', 'out');
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.part')) : [];
  };

  it('버린 뒤 처음부터 다시 올린 것만 결과가 된다', async () => {
    const job = videoService.enqueueRender(root, 'retry-render');
    videoService.updateJob(job.id, { status: 'running' });
    expect((await stream(job.id, new Uint8Array([1, 1, 1, 1, 1, 1]), 0)).status).toBe(200);
    expect(parts()).toHaveLength(1);

    const dropped = await fetch(`${base}/job/${job.id}/output`, { method: 'DELETE' });
    expect(dropped.status).toBe(200);
    expect(parts()).toEqual([]);
    expect(videoService.getJob(job.id)?.status).toBe('running');

    expect((await stream(job.id, new Uint8Array([2, 2, 2]), 0)).status).toBe(200);
    expect((await commit(job.id, 3)).status).toBe(200);
    const saved = videoService.getJob(job.id);
    expect(saved?.status).toBe('done');
    expect([...fs.readFileSync(saved!.result!)]).toEqual([2, 2, 2]);
  });

  it('올린 것이 없어도 조용히 끝나고, 에이전트·끝난 일감·모르는 일감은 거절한다', async () => {
    const job = videoService.enqueueRender(root, 'retry-render');
    videoService.updateJob(job.id, { status: 'running' });
    expect((await fetch(`${base}/job/${job.id}/output`, { method: 'DELETE' })).status).toBe(200);
    expect((await fetch(`${base}/job/${job.id}/output`, { method: 'DELETE', headers: AGENT })).status).toBe(403);
    expect((await fetch(`${base}/job/nope/output`, { method: 'DELETE' })).status).toBe(404);
    videoService.updateJob(job.id, { status: 'canceled' });
    expect((await fetch(`${base}/job/${job.id}/output`, { method: 'DELETE' })).status).toBe(409);
  });
});
