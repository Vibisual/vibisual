import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE } from '@vibisual/shared';

import { mountVideoRoutes, videoService } from './routes.js';
import { applyPatch } from '../ops.js';
import { sceneSignature } from '../sceneChange.js';
import type { PassRecord } from '../history.js';
import type { VideoDoc } from '../types.js';

/** §5.13 (V) 37-23 (M) — 장면 단위 받기·되돌리기 REST 를 실제 HTTP 로. */
let root: string;
let server: Server;
let base: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-scene-'));
  const app = express(); app.use(express.json());
  mountVideoRoutes(app, {
    resolveProjectPath: (name) => (name === 'test' ? root : null),
    atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); },
    info: () => undefined, warn: () => undefined,
  });
  server = await new Promise<Server>((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test port');
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  fs.rmSync(root, { recursive: true, force: true });
});

type Body = Record<string, unknown>;
async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Body }> {
  const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Body };
}

const AGENT = { [LOOPBACK_INGRESS_HEADER]: LOOPBACK_INGRESS_VALUE };

/** 장면 둘 — 한 바퀴가 두 장면을 다 고친다. */
async function setup(): Promise<{ doc: VideoDoc; start: VideoDoc; revId: string; passId: string }> {
  const created = videoService.createDoc(root, 'Scenes');
  const r = applyPatch(created, { baseVersion: created.version, ops: [
    { op: 'addChapter', chapter: { id: 'a', title: 'Alpha', duration: 3, status: 'done' } },
    { op: 'addChapter', chapter: { id: 'b', title: 'Beta', duration: 3, status: 'done' } },
    { op: 'addItem', trackId: 'visual', item: { id: 'ta', kind: 'text', at: { chapter: 'a' }, duration: 2, chapterId: 'a', props: { text: 'one' } } },
    { op: 'addItem', trackId: 'visual', item: { id: 'tb', kind: 'text', at: { chapter: 'b' }, duration: 2, chapterId: 'b', props: { text: 'two' } } },
  ] });
  if (!r.ok) throw new Error('setup');
  videoService.writeDoc(root, r.doc);
  const passId = 'pass-scene';
  const opened = await post(`/doc/${r.doc.id}/history`, { project: 'test', kind: 'pass-start', passId });
  const revId = (opened.body['entry'] as { id: string }).id;
  let doc = r.doc;
  for (const [itemId, focus] of [['ta', 'a'], ['tb', 'b']] as const) {
    const res = await post(`/doc/${doc.id}/patch`, { project: 'test', baseVersion: doc.version, passId, focus, ops: [{ op: 'updateItem', itemId, patch: { props: { text: `${itemId}!` } } }] }, AGENT);
    expect(res.status).toBe(200);
    doc = res.body['doc'] as VideoDoc;
  }
  return { doc, start: r.doc, revId, passId };
}

describe('§5.13 (V) 37-23 scene routes', () => {
  it('records every focused scene of the pass', async () => {
    const { doc } = await setup();
    const res = await fetch(`${base}/doc/${doc.id}/passes?project=test`);
    const pass = ((await res.json()) as { passes: PassRecord[] }).passes.find((p) => p.id === 'pass-scene');
    expect(pass?.focuses).toEqual(['a', 'b']);
  });

  it('restores one scene only, records a restore revision and the decision', async () => {
    const { doc, start, revId } = await setup();
    const plan = await (await fetch(`${base}/doc/${doc.id}/history/${revId}/scene/a/files?project=test`)).json() as Body;
    expect(plan).toMatchObject({ ok: true, plan: { changed: 0, noSnapshot: false } });

    const res = await post(`/doc/${doc.id}/history/${revId}/scene-restore`, { project: 'test', chapterId: 'a', baseVersion: doc.version });
    expect(res.status).toBe(200);
    const next = res.body['doc'] as VideoDoc;
    expect(sceneSignature(next, 'a')).toBe(sceneSignature(start, 'a'));
    expect(sceneSignature(next, 'b')).toBe(sceneSignature(doc, 'b'));
    expect(res.body['entry']).toMatchObject({ kind: 'restore', restoredFrom: revId, chapterId: 'a' });
    expect((res.body['pass'] as PassRecord).decided?.['a']).toMatchObject({ how: 'restored', signature: sceneSignature(next, 'a') });
    expect(videoService.readDoc(root, doc.id)?.version).toBe(next.version);
  });

  it('a stale baseVersion is a 409 with fix[] and writes nothing', async () => {
    const { doc, revId } = await setup();
    const res = await post(`/doc/${doc.id}/history/${revId}/scene-restore`, { project: 'test', chapterId: 'a', baseVersion: doc.version - 1 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, reason: 'version-conflict', currentVersion: doc.version });
    expect(Array.isArray(res.body['fix'])).toBe(true);
    expect(videoService.readDoc(root, doc.id)).toEqual(doc);
  });

  it('keep needs the signature the user saw; reopen clears it', async () => {
    const { doc, passId } = await setup();
    const url = `/doc/${doc.id}/pass/${passId}/scene`;
    expect((await post(url, { project: 'test', chapterId: 'b', decision: 'keep', signature: 'old' })).status).toBe(409);
    const kept = await post(url, { project: 'test', chapterId: 'b', decision: 'keep', signature: sceneSignature(doc, 'b') });
    expect((kept.body['pass'] as PassRecord).decided?.['b']?.how).toBe('kept');
    const reopened = await post(url, { project: 'test', chapterId: 'b', decision: 'reopen' });
    expect((reopened.body['pass'] as PassRecord).decided).toBeUndefined();
  });

  it('only the user decides — loopback agents get 403', async () => {
    const { doc, revId, passId } = await setup();
    expect((await post(`/doc/${doc.id}/history/${revId}/scene-restore`, { project: 'test', chapterId: 'a', baseVersion: doc.version }, AGENT)).status).toBe(403);
    expect((await post(`/doc/${doc.id}/pass/${passId}/scene`, { project: 'test', chapterId: 'a', decision: 'keep', signature: sceneSignature(doc, 'a') }, AGENT)).status).toBe(403);
  });

  it('an unknown chapter is a 404', async () => {
    const { doc, revId } = await setup();
    expect((await post(`/doc/${doc.id}/history/${revId}/scene-restore`, { project: 'test', chapterId: 'zz', baseVersion: doc.version })).status).toBe(404);
  });
});
