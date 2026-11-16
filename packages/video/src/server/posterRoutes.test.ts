import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE } from '@vibisual/shared';
import { createEmptyDoc, docPosterWant, resolveTimeline, type VideoDoc } from '../index.js';
import { applyPatch } from '../ops.js';
import { mountVideoRoutes, videoService } from './routes.js';
import { readThumbs, thumbsDirFor } from './thumbCache.js';

const WEBP = `data:image/webp;base64,${Buffer.from('webp-bytes').toString('base64')}`;

let root: string;
let server: Server;
let base: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-poster-'));
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

function docWithText(id: string): VideoDoc {
  const seed = createEmptyDoc(id, `Title ${id}`);
  return { ...seed, tracks: [{ id: 'v', kind: 'visual', items: [{ id: 'a', kind: 'text', at: 0, duration: 4, props: { text: 'hi' } }] }] };
}

function posterTimeOf(doc: VideoDoc): number {
  const want = docPosterWant(doc, resolveTimeline(doc));
  return want && want.source.kind === 'still' ? want.source.t : -1;
}

async function get(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}${url}`);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

async function waitForJobs(kind: 'stills'): Promise<void> {
  for (let i = 0; i < 200 && videoService.listJobs(root, kind).length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
}

describe('GET /docs — 갤러리 목록', () => {
  it('기존 필드는 그대로 두고 길이(duration)를 더한다 · 파일이 그대로면 다시 읽지 않는다', async () => {
    videoService.writeDoc(root, docWithText('long'));
    videoService.writeDoc(root, createEmptyDoc('empty', 'Empty'));
    const { body } = await get('/docs?project=test');
    const docs = body['docs'] as Array<Record<string, unknown>>;
    const long = docs.find((d) => d['id'] === 'long');
    expect(long).toMatchObject({ title: 'Title long', version: 1, width: 1920, height: 1080, duration: 4 });
    expect(typeof long?.['updatedAt']).toBe('number');
    expect(docs.find((d) => d['id'] === 'empty')?.['duration']).toBe(0);

    const original = videoService.readDoc.bind(videoService);
    let reads = 0;
    videoService.readDoc = (p, id) => { reads += 1; return original(p, id); };
    try {
      await get('/docs?project=test');
      expect(reads).toBe(0);
      videoService.writeDoc(root, { ...docWithText('long'), title: 'Renamed', version: 2 });
      const again = (await get('/docs?project=test')).body['docs'] as Array<Record<string, unknown>>;
      expect(again.find((d) => d['id'] === 'long')?.['title']).toBe('Renamed');
      expect(reads).toBe(1);
    } finally { videoService.readDoc = original; }
  });

  it('지운 문서는 목록 기억에서도 빠진다', async () => {
    videoService.writeDoc(root, docWithText('gone'));
    await get('/docs?project=test');
    expect(videoService.deleteDoc(root, 'gone')).toBe(true);
    const docs = (await get('/docs?project=test')).body['docs'] as Array<Record<string, unknown>>;
    expect(docs.find((d) => d['id'] === 'gone')).toBeUndefined();
  });
});

describe('GET /doc/:id/poster', () => {
  it('없는 프로젝트·문서는 404, 길이 0 인 문서는 포스터 없음', async () => {
    expect((await get('/doc/x/poster?project=missing')).status).toBe(404);
    expect((await get('/doc/nope/poster?project=test')).status).toBe(404);
    videoService.writeDoc(root, createEmptyDoc('empty', 'Empty'));
    expect((await get('/doc/empty/poster?project=test&render=1')).body).toMatchObject({ ok: true, state: 'empty', image: null });
  });

  it('render=0 은 디스크에 있는 것만 읽고 일감을 걸지 않는다', async () => {
    const doc = docWithText('p1');
    videoService.writeDoc(root, doc);
    const miss = await get('/doc/p1/poster?project=test');
    expect(miss.body).toMatchObject({ state: 'missing', image: null });
    expect(videoService.listJobs(root)).toHaveLength(0);

    const want = docPosterWant(doc, resolveTimeline(doc));
    const dir = thumbsDirFor(root, 'p1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${want?.key}.webp`), 'webp-bytes');
    const hit = await get('/doc/p1/poster?project=test');
    expect(hit.body).toMatchObject({ state: 'hit', image: WEBP });
    expect(videoService.listJobs(root)).toHaveLength(0);
  });

  it('render=1 은 없을 때 한 장만 배경 일감으로 굽고 디스크에 남긴다 · 같은 요청은 한 번만 굽는다', async () => {
    const doc = docWithText('p2');
    videoService.writeDoc(root, doc);
    const first = fetch(`${base}/doc/p2/poster?project=test&render=1`);
    const second = fetch(`${base}/doc/p2/poster?project=test&render=1`);
    await waitForJobs('stills');
    await new Promise((r) => setTimeout(r, 40));
    const jobs = videoService.listJobs(root, 'stills');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ background: true, times: [posterTimeOf(doc)], maxEdge: 320, imageType: 'webp' });
    const claimed = videoService.claimNext(root, 'still');
    expect(claimed?.id).toBe(jobs[0]?.id);
    videoService.updateJob(claimed?.id ?? '', { status: 'done', result: JSON.stringify([WEBP]) });
    const [a, b] = await Promise.all([first, second]);
    expect((await a.json() as Record<string, unknown>)['state']).toBe('baked');
    expect((await b.json() as Record<string, unknown>)['image']).toBe(WEBP);
    const want = docPosterWant(doc, resolveTimeline(doc));
    expect((await readThumbs(thumbsDirFor(root, 'p2'), [want?.key ?? ''])).get(want?.key ?? '')).toBe(WEBP);
    expect((await get('/doc/p2/poster?project=test&render=1')).body['state']).toBe('hit');
    expect(videoService.listJobs(root, 'stills')).toHaveLength(1);
  });

  it('일꾼이 못 그리면 failed 로 답하고 디스크에는 아무것도 남기지 않는다', async () => {
    videoService.writeDoc(root, docWithText('p3'));
    const pending = fetch(`${base}/doc/p3/poster?project=test&render=1`);
    await waitForJobs('stills');
    const claimed = videoService.claimNext(root, 'still');
    videoService.updateJob(claimed?.id ?? '', { status: 'error', error: 'no worker' });
    expect((await (await pending).json() as Record<string, unknown>)['state']).toBe('failed');
    expect(fs.existsSync(thumbsDirFor(root, 'p3'))).toBe(false);
  });
});

describe('포스터 경로는 문서를 쓰지 않는다', () => {
  /** 컴포지션 코드가 디스크 지문과 달라진 문서 — 일반 읽기 길은 탐침을 다시 적고 표지 모으기를 건다. */
  function staleCompositionDoc(id: string): VideoDoc {
    fs.mkdirSync(path.join(root, 'comp'), { recursive: true });
    fs.writeFileSync(path.join(root, 'comp', 'index.html'), '<!doctype html><meta name="vibi:duration" content="3"><script>window.__vibi.cue("hit")</script>');
    const r = applyPatch(createEmptyDoc(id, `Title ${id}`), { baseVersion: 1, ops: [
      { op: 'setAsset', asset: { id: 'comp', kind: 'composition', source: { kind: 'file', path: 'comp/index.html' }, contentHash: 'stale', duration: 3 } },
      { op: 'addItem', trackId: 'visual', item: { id: 'c1', kind: 'composition', assetId: 'comp', at: 0, duration: 3 } },
    ] });
    if (!r.ok) throw new Error('fixture');
    videoService.writeDoc(root, r.doc);
    return r.doc;
  }
  const fileOf = (id: string): string => path.join(root, '.vibisual', 'video', `${id}.json`);

  it('포스터를 청해도 문서 바이트·version·updatedAt 이 그대로고 cues 일감이 생기지 않는다 · 일꾼의 peek 읽기도 같다', async () => {
    const doc = staleCompositionDoc('s1');
    const bytes = fs.readFileSync(fileOf('s1'));
    const pending = fetch(`${base}/doc/s1/poster?project=test&render=1`);
    await waitForJobs('stills');
    const claimed = videoService.claimNext(root, 'still');
    expect(claimed).toMatchObject({ kind: 'stills', background: true });
    const peek = await get('/doc/s1?project=test&peek=1');
    expect((peek.body['doc'] as VideoDoc).version).toBe(doc.version);
    videoService.updateJob(claimed?.id ?? '', { status: 'done', result: JSON.stringify([WEBP]) });
    expect(((await (await pending).json()) as Record<string, unknown>)['state']).toBe('baked');
    expect(fs.readFileSync(fileOf('s1')).equals(bytes)).toBe(true);
    const after = videoService.readDoc(root, 's1');
    expect(after).toMatchObject({ version: doc.version, updatedAt: doc.updatedAt });
    expect(videoService.listJobs(root, 'cues')).toHaveLength(0);
    expect(videoService.listJobs(root).every((j) => j.kind === 'stills')).toBe(true);
    // 대조: 일반 읽기는 같은 문서를 새로 적는다.
    await get('/doc/s1?project=test');
    expect(videoService.readDoc(root, 's1')?.version).toBeGreaterThan(doc.version);
  });

  it('굽는 사이 문서가 지워지면 thumbs 디렉터리를 되살리지 않는다', async () => {
    videoService.writeDoc(root, docWithText('o1'));
    const pending = fetch(`${base}/doc/o1/poster?project=test&render=1`);
    await waitForJobs('stills');
    const claimed = videoService.claimNext(root, 'still');
    expect(videoService.deleteDoc(root, 'o1')).toBe(true);
    videoService.updateJob(claimed?.id ?? '', { status: 'done', result: JSON.stringify([WEBP]) });
    await pending;
    await new Promise((r) => setTimeout(r, 40));
    expect(fs.existsSync(thumbsDirFor(root, 'o1'))).toBe(false);
  });
});

describe('일감 줄 우선순위', () => {
  it('배경 일감은 먼저 들어왔어도 같은 줄의 일반 일감 뒤에 집힌다', async () => {
    videoService.writeDoc(root, docWithText('q1'));
    const bg = videoService.requestStills(root, 'q1', [1], 320, 'webp', { background: true });
    const fg = videoService.requestStill(root, 'q1', 1);
    const first = videoService.claimNext(root, 'still');
    const second = videoService.claimNext(root, 'still');
    expect(first?.background).toBeUndefined();
    expect(second?.background).toBe(true);
    videoService.updateJob(first?.id ?? '', { status: 'done', result: 'x' });
    videoService.updateJob(second?.id ?? '', { status: 'done', result: '[]' });
    await Promise.all([bg, fg]);
  });
});

describe('DELETE /doc/:id — 갤러리 삭제', () => {
  it('대기열에 그 문서의 렌더가 있으면 409(doc-in-use) 로 거절하고 문서는 그대로다', async () => {
    videoService.writeDoc(root, docWithText('r1'));
    const job = videoService.enqueueRender(root, 'r1');
    const res = await fetch(`${base}/doc/r1?project=test`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: 'doc-in-use' });
    expect(videoService.readDoc(root, 'r1')).not.toBeNull();
    videoService.controlJob(job.id, 'cancel');
    const done = await fetch(`${base}/doc/r1?project=test`, { method: 'DELETE' });
    expect(await done.json()).toEqual({ ok: true });
    expect(videoService.readDoc(root, 'r1')).toBeNull();
  });

  it('다른 문서의 렌더는 막지 않고, 루프백 에이전트의 삭제는 여전히 403', async () => {
    videoService.writeDoc(root, docWithText('r2'));
    videoService.writeDoc(root, docWithText('r3'));
    videoService.enqueueRender(root, 'r3');
    const agent = await fetch(`${base}/doc/r2?project=test`, { method: 'DELETE', headers: { [LOOPBACK_INGRESS_HEADER]: LOOPBACK_INGRESS_VALUE } });
    expect(agent.status).toBe(403);
    expect((await fetch(`${base}/doc/r2?project=test`, { method: 'DELETE' })).status).toBe(200);
  });
});
