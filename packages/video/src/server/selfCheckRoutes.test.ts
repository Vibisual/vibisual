import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../ops.js';
import { resolveTimeline } from '../resolveTimeline.js';
import type { HistoryEntry } from '../history.js';
import type { VideoDoc, VideoItem } from '../types.js';
import { mountVideoRoutes, videoHistory, videoService, type VideoJob } from './routes.js';
import { earlierRevision, positionKnown } from './selfCheckRoutes.js';

/**
 * §5.13 (G) 스스로 판정할 재료 셋 — 그림은 스틸과 같은 일감 줄을 지나야 한다. 이 시험의 호스트에는 main 다리가 없어 일감이 줄에서 기다리고,
 * 시험이 일꾼 노릇을 한다(집기 → 결과 올리기).
 */
let root: string;
let server: Server;
let base: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-selfcheck-'));
  fs.mkdirSync(path.join(root, '.vibisual', 'video'), { recursive: true });
  const app = express(); app.use(express.json());
  mountVideoRoutes(app, {
    resolveProjectPath: (name) => (name === 'test' ? root : null),
    atomicWriteFile: (file, data) => fs.writeFileSync(file, data), info: () => undefined, warn: () => undefined,
  });
  server = await new Promise<Server>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  fs.rmSync(root, { recursive: true, force: true });
});

const PNG_A = `data:image/png;base64,${Buffer.from('before').toString('base64')}`;
const PNG_B = `data:image/png;base64,${Buffer.from('after').toString('base64')}`;
const PNG_JOINED = `data:image/png;base64,${Buffer.from('joined').toString('base64')}`;

function textItem(id: string, words: string, duration: number, transform?: VideoItem['transform']): VideoItem {
  return { id, kind: 'text', at: 0, duration, props: { text: words, fontSize: 64 }, ...(transform ? { transform } : {}) };
}

function save(doc: VideoDoc): VideoDoc {
  videoService.writeDoc(root, doc);
  return doc;
}

function withVisual(doc: VideoDoc, items: VideoItem[], version: number, extra: Partial<VideoDoc> = {}): VideoDoc {
  return { ...doc, ...extra, version, tracks: doc.tracks.map((t) => (t.id === 'visual' ? { ...t, items } : t)) };
}

/** 줄에 선 다음 일감을 일꾼처럼 집는다(이 프로젝트의 스틸 줄만). */
async function claim(kind: VideoJob['kind']): Promise<VideoJob> {
  for (let i = 0; i < 400; i += 1) {
    const job = videoService.claimNext(root, 'still');
    if (job) { expect(job.kind).toBe(kind); return job; }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`no ${kind} job`);
}

/** 다섯 낱말 — 읽는 데 2.7초쯤(1초면 모자란다), 한 줄로 화면 안전 영역 안에 든다. */
const LONG = 'Read this slowly please now';

/** v1 = 읽을 시간이 모자란 글(판 A 로 저장) → v2 = 그 글은 고쳤지만 다른 글이 안전 영역 밖. */
function twoRevisions(): { rev: HistoryEntry; v2: VideoDoc } {
  const empty = createEmptyDoc('doc1', 'Doc', 1);
  const v1 = save(withVisual(empty, [textItem('t1', LONG, 1)], 1));
  const rev = videoHistory.record(root, v1, { kind: 'checkpoint', by: 'user' });
  const v2 = save(withVisual(empty, [textItem('t1', LONG, 6), textItem('t2', 'Edge', 6, { x: -200, y: 800, width: 400, height: 100 })], 2));
  return { rev, v2 };
}

describe('§5.13 (G) earlier revision', () => {
  const e = (id: string, docVersion: number): HistoryEntry => ({ id, kind: 'checkpoint', by: 'user', docVersion, createdAt: 0 });
  it('is the latest recorded revision with another version, before the target', () => {
    const list = [e('r1', 1), e('r2', 3), e('r3', 5), e('r4', 5)];
    expect(earlierRevision(list, { rev: null, version: 5 })?.id).toBe('r2');
    expect(earlierRevision(list, { rev: null, version: 7 })?.id).toBe('r4');
    expect(earlierRevision(list, { rev: 'r2', version: 3 })?.id).toBe('r1');
    expect(earlierRevision(list, { rev: 'r1', version: 1 })).toBeNull();
    expect(earlierRevision([], { rev: null, version: 1 })).toBeNull();
    // 목록에 없는 판은 위치를 모르니 목록 끝에서부터 찾지 않는다.
    expect(earlierRevision(list, { rev: 'r9', version: 7 })).toBeNull();
    expect(positionKnown(list, 'r9')).toBe(false);
    expect(positionKnown(list, 'r3')).toBe(true);
    expect(positionKnown(list, null)).toBe(true);
  });
});

describe('§5.13 (G) review score route', () => {
  it('scores the current version against the previous revision with weights, introduced and resolved findings', async () => {
    const { rev } = twoRevisions();
    const res = await fetch(`${base}/doc/doc1/review/score?project=test&trend=5`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      frames: boolean; formula: string; weights: Record<string, number>;
      target: { rev: string | null; version: number; score: number; penalty: number; byCode: { code: string; count: number }[] };
      base: { rev: string; version: number; score: number };
      delta: { score: number; introduced: number; resolved: number; byCode: { code: string; change: number }[] };
      findings: { code: string; introduced: boolean }[]; resolved: { code: string }[];
      trend: { rev: string | null; score: number }[];
    };
    expect(body.frames).toBe(false);
    expect(body.formula).toBe('score = max(0, 100 - sum(weight x count))');
    expect(body.target).toMatchObject({ rev: null, version: 2, score: 100 - body.weights['safe-area']!, penalty: body.weights['safe-area'] });
    expect(body.base).toMatchObject({ rev: rev.id, version: 1, score: 100 - body.weights['read-time']! });
    expect(body.findings).toEqual([expect.objectContaining({ code: 'safe-area', introduced: true })]);
    expect(body.resolved).toEqual([expect.objectContaining({ code: 'read-time' })]);
    expect(body.delta).toMatchObject({ introduced: 1, resolved: 1, score: body.target.score - body.base.score });
    expect(body.delta.byCode.find((c) => c.code === 'read-time')?.change).toBe(-1);
    expect(body.trend.map((x) => [x.rev, x.score])).toEqual([[rev.id, body.base.score], [null, body.target.score]]);
    // 같은 판이면 같은 숫자 — 다시 물어도, 판 id 로 물어도.
    const again = await (await fetch(`${base}/doc/doc1/review/score?project=test&trend=5`)).json();
    expect(again).toEqual(body);
    const byRev = await (await fetch(`${base}/doc/doc1/review/score?project=test&rev=${rev.id}&base=none`)).json() as { target: { score: number }; base: null; delta: null };
    expect(byRev.target.score).toBe(body.base.score);
    expect(byRev.base).toBeNull();
    expect(byRev.delta).toBeNull();
  });

  it('does not guess the default base for a revision that has a snapshot but is not in the revision list', async () => {
    const { rev } = twoRevisions();
    const hist = videoHistory.dir(root, 'doc1');
    fs.copyFileSync(path.join(hist, `${rev.id}.json`), path.join(hist, 'rev-orphan.json'));
    const res = await fetch(`${base}/doc/doc1/review/score?project=test&rev=rev-orphan`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: 'revision-not-in-history' });
    expect((await fetch(`${base}/doc/doc1/review/score?project=test&rev=rev-orphan&base=none`)).status).toBe(200);
    expect((await fetch(`${base}/doc/doc1/review/score?project=test&rev=rev-orphan&base=${rev.id}`)).status).toBe(200);
  });

  it('rejects unknown revisions and bad ids', async () => {
    twoRevisions();
    expect((await fetch(`${base}/doc/doc1/review/score?project=test&rev=rev-nope`)).status).toBe(404);
    expect((await fetch(`${base}/doc/doc1/review/score?project=test&base=..%2Fx`)).status).toBe(400);
    expect((await fetch(`${base}/doc/missing/review/score?project=test`)).status).toBe(404);
  });

  it('falls back to document checks on both sides when the worker does not return frames', async () => {
    twoRevisions();
    const pending = fetch(`${base}/doc/doc1/review/score?project=test&frames=1`);
    const job = await claim('review');
    videoService.updateJob(job.id, { status: 'error', error: 'worker window could not open' });
    const body = await (await pending).json() as { frames: boolean; framesError: string; target: { score: number } };
    expect(body.frames).toBe(false);
    expect(body.framesError).toBe('worker window could not open');
    expect(body.target.score).toBeGreaterThan(0);
  });
});

describe('§5.13 (G) layout route', () => {
  it('describes a document without compositions without calling the worker', async () => {
    twoRevisions();
    const res = await fetch(`${base}/doc/doc1/layout?project=test&t=1`);
    const body = await res.json() as { ok: boolean; inner: boolean; total: number; flags: { unsafe: number; clipped: number }; text: string };
    expect(body).toMatchObject({ ok: true, inner: false, total: 2 });
    expect(body.flags.unsafe).toBe(1);
    expect(body.text).toContain('#2 text "t2"');
    expect(body.text).toContain('outside safe area');
    expect(videoService.claimNext(root, 'still')).toBeNull();
    const json = await (await fetch(`${base}/doc/doc1/layout?project=test&t=1&format=json`)).json() as { elements: { itemId: string }[]; text?: string };
    expect(json.elements.map((e) => e.itemId)).toEqual(['t1', 't2']);
    expect(json.text).toBeUndefined();
  });

  it('asks the worker for the elements inside a composition through the review job, and still answers when it fails', async () => {
    const empty = createEmptyDoc('doc2', 'Doc', 1);
    save(withVisual(empty, [{ id: 'comp', kind: 'composition', at: 0, duration: 4, assetId: 'c1' }], 1, {
      assets: { c1: { id: 'c1', kind: 'composition', source: { kind: 'file', path: 'comp/index.html' }, duration: 4 } },
    }));
    const pending = fetch(`${base}/doc/doc2/layout?project=test&t=1`);
    const job = await claim('review');
    expect(job.times).toEqual([1]);
    videoService.updateJob(job.id, { status: 'done', result: JSON.stringify([{ t: 1, flat: false, texts: [
      { itemId: 'comp', text: 'Inner title', path: 'h1.title', rect: { x: 1800, y: 40, width: 300, height: 60 }, color: '#fff', fontSize: 40 },
    ] }]) });
    const body = await (await pending).json() as { inner: boolean; text: string };
    expect(body.inner).toBe(true);
    expect(body.text).toContain('  #1.1 h1.title box 1800,40 300x60 · "Inner title" · 40px');
    expect(body.text).toContain('clipped right 180px');

    const failing = fetch(`${base}/doc/doc2/layout?project=test&t=1`);
    const lost = await claim('review');
    videoService.updateJob(lost.id, { status: 'error', error: 'the worker went away' });
    const partial = await (await failing).json() as { ok: boolean; inner: boolean; innerError: string; total: number };
    expect(partial).toMatchObject({ ok: true, inner: false, innerError: 'the worker went away', total: 1 });

    const skip = await (await fetch(`${base}/doc/doc2/layout?project=test&t=1&inner=0`)).json() as { inner: boolean };
    expect(skip.inner).toBe(false);
  });
});

describe('§5.13 (G) before/after compare route', () => {
  it('takes two stills on the still lane (the revision, then current), joins them in the worker and answers with a file', async () => {
    const { rev } = twoRevisions();
    const pending = fetch(`${base}/doc/doc1/compare?project=test&t=0.5`);
    const before = await claim('still');
    expect(before).toMatchObject({ revId: rev.id, t: 0.5 });
    videoService.updateJob(before.id, { status: 'done', result: PNG_A });
    const after = await claim('still');
    expect(after.revId).toBeUndefined();
    videoService.updateJob(after.id, { status: 'done', result: PNG_B });
    const joined = await claim('compare');
    expect(joined.images).toEqual([PNG_A, PNG_B]);
    expect(joined.labels?.[0]).toBe(`BEFORE · ${rev.id} v1 (checkpoint) · t=0.50s`);
    expect(joined.labels?.[1]).toBe('AFTER · current v2 · t=0.50s');
    videoService.updateJob(joined.id, { status: 'done', result: PNG_JOINED });
    const body = await (await pending).json() as { ok: boolean; layout: string; file: string; image?: string; before: unknown; after: unknown; changes: unknown[]; changesTotal: number };
    expect(body).toMatchObject({ ok: true, layout: 'left=before right=after', before: { rev: rev.id, version: 1, kind: 'checkpoint' }, after: { rev: null, version: 2 } });
    expect(body.image).toBeUndefined();
    expect(body.file).toBe(path.join(root, '.vibisual', 'video', 'review', 'doc1', `compare-${rev.id}-current-0.50s.png`));
    expect(fs.readFileSync(body.file).toString()).toBe('joined');
    expect(body.changesTotal).toBeGreaterThan(0);
    // 끝난 일감은 그림을 들고 있지 않는다.
    expect(videoService.getJob(joined.id)?.images).toBeUndefined();
  });

  it('says which side failed when the worker cannot draw (same 504 rule as /still)', async () => {
    twoRevisions();
    const pending = fetch(`${base}/doc/doc1/compare?project=test&t=0.5`);
    const before = await claim('still');
    videoService.updateJob(before.id, { status: 'error', error: 'worker window could not open' });
    const res = await pending;
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ ok: false, side: 'before', error: 'worker window could not open' });
    expect(videoService.claimNext(root, 'still')).toBeNull();
  });

  it('clamps t to the end of the shorter of the two revisions and answers with the time it used', async () => {
    const { rev } = twoRevisions();
    const shorter = resolveTimeline(videoHistory.readSnapshot(root, 'doc1', rev.id)!).duration;
    const expected = Math.max(0, shorter - 1 / 30);
    const pending = fetch(`${base}/doc/doc1/compare?project=test&t=99`);
    const before = await claim('still');
    expect(before.t).toBeCloseTo(expected, 6);
    videoService.updateJob(before.id, { status: 'done', result: PNG_A });
    const after = await claim('still');
    expect(after.t).toBeCloseTo(expected, 6);
    videoService.updateJob(after.id, { status: 'done', result: PNG_B });
    const joined = await claim('compare');
    videoService.updateJob(joined.id, { status: 'done', result: PNG_JOINED });
    const body = await (await pending).json() as { t: number };
    expect(body.t).toBeCloseTo(expected, 6);
    expect(body.t).toBeLessThan(shorter);
  });

  it('refuses to guess from when the target revision is not in the revision list', async () => {
    const { rev } = twoRevisions();
    const hist = videoHistory.dir(root, 'doc1');
    fs.copyFileSync(path.join(hist, `${rev.id}.json`), path.join(hist, 'rev-orphan.json'));
    const res = await fetch(`${base}/doc/doc1/compare?project=test&to=rev-orphan`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: 'revision-not-in-history' });
  });

  it('needs an earlier revision unless from is given, and refuses the same revision twice', async () => {
    const empty = createEmptyDoc('doc3', 'Doc', 1);
    save(withVisual(empty, [textItem('t1', 'Hi', 3)], 1));
    const none = await fetch(`${base}/doc/doc3/compare?project=test`);
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ error: 'no-earlier-revision' });
    expect((await fetch(`${base}/doc/doc3/compare?project=test&from=current&to=current`)).status).toBe(400);
    expect((await fetch(`${base}/doc/doc3/compare?project=test&from=rev-missing`)).status).toBe(404);
  });
});
