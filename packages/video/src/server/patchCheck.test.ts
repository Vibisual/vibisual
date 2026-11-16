import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOOPBACK_INGRESS_HEADER, LOOPBACK_INGRESS_VALUE } from '@vibisual/shared';
import { mountVideoRoutes, videoActivity, videoService } from './routes.js';
import { applyPatch } from '../ops.js';
import type { PatchFix, VideoDoc, VideoDocOp } from '../types.js';

/**
 * §5.13 (G) — patch 미리 검사·고칠 방법·묶음 op 를 실제 HTTP 로. 미리 검사가 정말 아무것도 쓰지 않는지는 프로젝트 폴더 전체의
 * 경로·크기·수정 시각·내용 해시와 서버 메모리(활동·일감)를 앞뒤로 떠서 비교한다.
 */
let root: string;
let server: Server;
let base: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-check-'));
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

interface Answer { status: number; body: Record<string, unknown> & { fix?: PatchFix[] } }
async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Answer> {
  const res = await fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Answer['body'] };
}

/** 프로젝트 폴더 전체 — 경로·크기·수정 시각·내용. */
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const abs = path.join(d, name);
      const st = fs.statSync(abs);
      const rel = path.relative(root, abs);
      if (st.isDirectory()) { out.push(`${rel}/`); walk(abs); continue; }
      out.push(`${rel}:${st.size}:${st.mtimeMs}:${createHash('sha256').update(fs.readFileSync(abs)).digest('hex')}`);
    }
  };
  walk(dir);
  return out;
}

/** 문서 하나 + 장면 하나 + 표지를 쓰는 컴포지션 소재(파일이 바뀐 상태라 patch 는 탐침을 다시 적고 표지 모으기를 건다). */
function setup(): VideoDoc {
  const doc = videoService.createDoc(root, 'Check');
  fs.mkdirSync(path.join(root, 'comp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'comp', 'index.html'), '<!doctype html><meta name="vibi:duration" content="3"><script>window.__vibi.cue("hit")</script>');
  const r = applyPatch(doc, { baseVersion: doc.version, ops: [
    { op: 'addChapter', chapter: { id: 'intro', title: 'Intro', duration: 3, status: 'approved' } },
    { op: 'setAsset', asset: { id: 'comp', kind: 'composition', source: { kind: 'file', path: 'comp/index.html' }, contentHash: 'stale' } },
  ] });
  if (!r.ok) throw new Error('setup');
  videoService.writeDoc(root, r.doc);
  return r.doc;
}

const goodOps: VideoDocOp[] = [{ op: 'addItem', trackId: 'visual', item: { id: 'c1', kind: 'composition', assetId: 'comp', at: { chapter: 'intro' }, duration: 2, chapterId: 'intro' } }];

describe('§5.13 (G) POST /doc/:docId/patch/check — a dry run that writes nothing', () => {
  it('answers like /patch would (status, version, duration, diagnostics) while the project folder and server memory stay the same', async () => {
    const doc = setup();
    const url = `/doc/${doc.id}`;
    const filesBefore = tree(root);
    const jobsBefore = videoService.listJobs(root).length;
    const activityBefore = videoActivity.get(root, doc.id);
    const body = { project: 'test', baseVersion: doc.version, ops: goodOps, passId: 'pass-check', focus: 'intro' };

    const check = await post(`${url}/patch/check`, body);
    const stale = await post(`${url}/patch/check`, { ...body, baseVersion: doc.version - 1 });
    const broken = await post(`${url}/patch/check`, { ...body, ops: [{ op: 'removeItem', itemId: 'nope' }] });
    const bundle = await post(`${url}/patch/check`, { ...body, ops: [{ op: 'fillChapter', chapterId: 'intro', status: 'building', items: [{ trackId: 'visual', item: { id: 'c2', kind: 'shape', duration: 1 } }] }] });
    const noBody = await post(`${url}/patch/check`, { project: 'test' });

    expect([check.status, stale.status, broken.status, bundle.status, noBody.status]).toEqual([200, 409, 400, 200, 400]);
    expect(tree(root)).toEqual(filesBefore);
    expect(videoService.readDoc(root, doc.id)).toEqual(doc);
    expect(videoService.listJobs(root)).toHaveLength(jobsBefore);
    expect(videoActivity.get(root, doc.id)).toEqual(activityBefore);
    expect(fs.existsSync(path.join(root, '.vibisual', 'video', 'history'))).toBe(false);

    // 같은 본문을 실제로 보내면 쓴다 — 미리 검사가 말한 판본·길이·진단과 같다(탐침 다시 적기까지 메모리에서 따라 했다).
    const real = await post(`${url}/patch`, body);
    expect(real.status).toBe(200);
    expect(tree(root)).not.toEqual(filesBefore);
    expect(videoService.listJobs(root).length).toBeGreaterThan(jobsBefore);
    expect(check.body).toMatchObject({ ok: true, check: true, version: (real.body['doc'] as VideoDoc).version, duration: real.body['duration'], diagnostics: real.body['diagnostics'], safe: true, expanded: goodOps });
  });

  it('a stale check is a 409 with the current version and the same ops checked against it', async () => {
    const doc = setup();
    const stale = await post(`/doc/${doc.id}/patch/check`, { project: 'test', baseVersion: 1, ops: [...goodOps, { op: 'updateChapter', chapterId: 'outro', patch: {} }] });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ ok: false, reason: 'version-conflict', currentVersion: doc.version, check: true });
    expect(stale.body.fix![0]).toMatchObject({ code: 'version-conflict', field: 'baseVersion', got: 1, currentVersion: doc.version });
    expect(stale.body.fix![1]).toMatchObject({ opIndex: 1, field: 'chapterId', allowed: ['intro'] });
  });

  it('flags a patch that would leave an unreadable document (patch itself still accepts it, as before)', async () => {
    const doc = setup();
    const ops = [{ op: 'addChapter', chapter: { id: 'loose', title: 'Loose', duration: 2 } }];
    const check = await post(`/doc/${doc.id}/patch/check`, { project: 'test', baseVersion: doc.version, ops });
    expect(check.status).toBe(200);
    expect(check.body['safe']).toBe(false);
    expect(check.body.fix).toEqual(expect.arrayContaining([
      expect.objectContaining({ opIndex: 0, field: 'chapter.status', code: 'missing-field' }),
      expect.objectContaining({ code: 'doc-unreadable' }),
    ]));
  });
});

describe('§5.13 (G) check and bundles are never stricter than the plain ops', () => {
  const svg = { id: 'logo', kind: 'svg', source: { kind: 'file', path: 'logo.svg' } };

  it('an unknown asset kind: setAsset and placeAsset get the same status from /patch and /patch/check, safe, with a warning', async () => {
    for (const ops of [
      [{ op: 'setAsset', asset: svg }],
      [{ op: 'placeAsset', asset: svg, trackId: 'visual', chapterId: 'intro', item: { id: 'p', kind: 'image', duration: 1 } }],
    ]) {
      const doc = setup();
      const body = { project: 'test', baseVersion: doc.version, ops };
      const check = await post(`/doc/${doc.id}/patch/check`, body);
      const real = await post(`/doc/${doc.id}/patch`, body);
      expect([check.status, real.status]).toEqual([200, 200]);
      expect(check.body['safe']).toBe(true);
      expect(check.body.fix).toEqual(expect.arrayContaining([
        expect.objectContaining({ level: 'warn', code: 'unknown-value', field: 'asset.kind', got: 'svg', allowed: ['audio', 'video', 'image', 'font', 'composition', 'model'] }),
      ]));
    }
  });

  it('a bundle overwriting an existing asset id with other content warns in the check; resending the same content does not', async () => {
    const doc = setup();
    const img = { id: 'img', kind: 'image', source: { kind: 'file', path: 'a.png' } };
    const added = await post(`/doc/${doc.id}/patch`, { project: 'test', baseVersion: doc.version, ops: [{ op: 'setAsset', asset: img }] });
    const version = (added.body['doc'] as VideoDoc).version;
    const place = (asset: unknown) => ({ project: 'test', baseVersion: version, ops: [{ op: 'placeAsset', asset, trackId: 'visual', item: { id: 'p', kind: 'image', duration: 1, at: 0 } }] });
    const changed = await post(`/doc/${doc.id}/patch/check`, place({ ...img, source: { kind: 'file', path: 'OTHER.png' } }));
    expect(changed.status).toBe(200);
    expect(changed.body['safe']).toBe(true);
    expect(changed.body.fix).toEqual([expect.objectContaining({ code: 'asset-overwrite', level: 'warn', opIndex: 0, field: 'asset.id', got: 'img' })]);
    expect(changed.body.fix![0]!.hint).toContain('OTHER.png');
    const same = await post(`/doc/${doc.id}/patch/check`, place(img));
    expect(same.body.fix).toEqual([]);
  });
});

describe('§5.13 (G) POST /doc/:docId/patch — old fields unchanged, fix added', () => {
  it('409 keeps ok/reason/currentVersion and adds fix', async () => {
    const doc = setup();
    const res = await post(`/doc/${doc.id}/patch`, { project: 'test', baseVersion: 1, ops: goodOps });
    expect(res.status).toBe(409);
    const { fix, ...old } = res.body;
    expect(old).toEqual({ ok: false, reason: 'version-conflict', currentVersion: doc.version });
    expect(fix![0]).toMatchObject({ code: 'version-conflict', currentVersion: doc.version });
  });

  it('invalid-op keeps ok/reason/opIndex/message exactly as applyPatch says, then lists every failing op', async () => {
    const doc = setup();
    const ops: VideoDocOp[] = [{ op: 'removeItem', itemId: 'ghost' }, ...goodOps, { op: 'moveChapter', chapterId: 'nope' }];
    const res = await post(`/doc/${doc.id}/patch`, { project: 'test', baseVersion: doc.version, ops });
    expect(res.status).toBe(400);
    const { fix, ...old } = res.body;
    expect(old).toEqual({ ...applyPatch(doc, { baseVersion: doc.version, ops }), ok: false });
    expect(fix!.map((f) => [f.opIndex, f.code, f.field])).toEqual([[0, 'unknown-id', 'itemId'], [2, 'unknown-id', 'chapterId']]);
    expect(videoService.readDoc(root, doc.id)!.version).toBe(doc.version);
  });

  it('a missing body keeps its error text and adds the fields to send with the current version', async () => {
    const doc = setup();
    const res = await post(`/doc/${doc.id}/patch`, { project: 'test', ops: [] });
    expect(res.status).toBe(400);
    expect(res.body['error']).toBe('baseVersion 과 ops 가 필요합니다.');
    expect(res.body.fix).toEqual([expect.objectContaining({ field: 'baseVersion', code: 'missing-field', currentVersion: doc.version })]);
  });

  it('success keeps ok/doc/duration/diagnostics/by, adds fix per diagnostic, and adds expanded only for bundles', async () => {
    const doc = setup();
    const res = await post(`/doc/${doc.id}/patch`, { project: 'test', baseVersion: doc.version, ops: [{ op: 'addItem', trackId: 'visual', item: { id: 'lost', kind: 'shape', at: { chapter: 'outro' }, duration: 1 } }] });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['by', 'diagnostics', 'doc', 'duration', 'fix', 'ok']);
    expect(res.body.fix).toEqual([expect.objectContaining({ code: 'unknown-chapter', diagnostic: 0, field: 'item.at.chapter', allowed: ['intro'], introduced: true })]);
  });
});

describe('§5.13 (G) bundle ops through /patch', () => {
  it('addScene builds a chapter with its items in one version and returns the expanded ops', async () => {
    const doc = setup();
    const res = await post(`/doc/${doc.id}/patch`, { project: 'test', baseVersion: doc.version, ops: [{
      op: 'addScene', chapter: { id: 'outro', title: 'Outro', duration: 2, status: 'plan' },
      items: [{ trackId: 'visual', item: { id: 'end-card', kind: 'text', duration: 2, props: { text: 'Bye' } }, offset: 0 }],
    }] });
    expect(res.status).toBe(200);
    const written = res.body['doc'] as VideoDoc;
    expect(written.chapters!.map((c) => c.id)).toEqual(['intro', 'outro']);
    expect(written.tracks.find((t) => t.id === 'visual')!.items[0]).toMatchObject({ id: 'end-card', chapterId: 'outro', at: { chapter: 'outro', offset: 0 } });
    expect((res.body['expanded'] as VideoDocOp[]).map((o) => o.op)).toEqual(['addChapter', 'addItem']);
  });

  it('a bundle that fails inside reports the request index, part and field — nothing is written', async () => {
    const doc = setup();
    const res = await post(`/doc/${doc.id}/patch`, { project: 'test', baseVersion: doc.version, ops: [
      ...goodOps,
      { op: 'fillChapter', chapterId: 'missing', status: 'building' },
    ] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false, reason: 'invalid-op', opIndex: 1 });
    expect(res.body.fix).toEqual([expect.objectContaining({ opIndex: 1, op: 'fillChapter', part: 0, field: 'chapterId', got: 'missing', allowed: ['intro'] })]);
    expect(videoService.readDoc(root, doc.id)!.version).toBe(doc.version);
  });
});

describe('§5.13 (G) loopback agents', () => {
  it('an agent may dry-run and patch; deleting a document stays user-only (403)', async () => {
    const doc = setup();
    const agent = { [LOOPBACK_INGRESS_HEADER]: LOOPBACK_INGRESS_VALUE };
    expect((await post(`/doc/${doc.id}/patch/check`, { project: 'test', baseVersion: doc.version, ops: goodOps }, agent)).status).toBe(200);
    const patched = await post(`/doc/${doc.id}/patch`, { project: 'test', baseVersion: doc.version, ops: goodOps }, agent);
    expect(patched.body['by']).toBe('ai');
    const del = await fetch(`${base}/doc/${doc.id}?project=test`, { method: 'DELETE', headers: agent });
    expect(del.status).toBe(403);
  });
});
