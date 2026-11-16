import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMPOSITION_SCAN_MAX_BYTES } from '../constants.js';
import { createEmptyDoc } from '../ops.js';
import type { VideoDoc } from '../types.js';
import { mountVideoRoutes, videoService } from './routes.js';

/** §5.13 (V) 37-20 — 코드 보기의 원본 길은 그 문서의 컴포지션 폴더 안 글 파일만 읽고, 쓰는 길이 없다. */
let root: string;
let server: Server;
let base: string;
const COMP = '.vibisual/video/compositions/intro';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-source-'));
  fs.mkdirSync(path.join(root, COMP, 'js'), { recursive: true });
  fs.writeFileSync(path.join(root, COMP, 'index.html'), '<div id="a">\n  <b>hi</b>\n</div>\n');
  fs.writeFileSync(path.join(root, COMP, 'js', 'app.js'), 'var a = 1;\n');
  fs.writeFileSync(path.join(root, COMP, 'style.css'), '.a { color: red; }\n');
  fs.writeFileSync(path.join(root, COMP, 'logo.png'), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(root, 'secret.js'), 'var secret = 1;\n');
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

function saveDoc(): VideoDoc {
  const empty = createEmptyDoc('vid-src', 'Source');
  const doc: VideoDoc = {
    ...empty,
    assets: {
      comp: { id: 'comp', kind: 'composition', source: { kind: 'file', path: `${COMP}/index.html` }, contentHash: 'h1' },
      pic: { id: 'pic', kind: 'image', source: { kind: 'file', path: `${COMP}/logo.png` } },
    },
  };
  videoService.writeDoc(root, doc);
  return doc;
}

async function get(query: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/doc/vid-src/source?project=test&${query}`);
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

describe('GET /doc/:docId/source', () => {
  it('소재의 HTML 과 폴더 안 글 파일 목록(HTML 먼저, 프로젝트 기준 / 경로)을 낸다', async () => {
    saveDoc();
    const { status, body } = await get('assetId=comp');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, path: `${COMP}/index.html`, text: '<div id="a">\n  <b>hi</b>\n</div>\n', truncated: false, contentHash: 'h1' });
    expect(body['files']).toEqual([`${COMP}/index.html`, `${COMP}/js/app.js`, `${COMP}/style.css`]);
  });

  it('폴더 안의 다른 글 파일도 읽는다(역슬래시 경로도 같은 파일)', async () => {
    saveDoc();
    expect((await get(`assetId=comp&file=${encodeURIComponent(`${COMP}/js/app.js`)}`)).body).toMatchObject({ ok: true, path: `${COMP}/js/app.js`, text: 'var a = 1;\n' });
    expect((await get(`assetId=comp&file=${encodeURIComponent(`${COMP}\\style.css`)}`)).body).toMatchObject({ ok: true, path: `${COMP}/style.css` });
  });

  it('폴더 밖·그림·없는 파일·컴포지션이 아닌 소재는 404', async () => {
    saveDoc();
    for (const query of [
      'assetId=comp&file=secret.js',
      `assetId=comp&file=${encodeURIComponent(`${COMP}/../../../../secret.js`)}`,
      `assetId=comp&file=${encodeURIComponent(path.join(root, 'secret.js'))}`,
      `assetId=comp&file=${encodeURIComponent(`${COMP}/logo.png`)}`,
      `assetId=comp&file=${encodeURIComponent(`${COMP}/missing.js`)}`,
      'assetId=pic',
      'assetId=nope',
    ]) expect((await get(query)).status, query).toBe(404);
  });

  it('상한을 넘는 파일은 앞부분만 주고 잘렸다고 알린다', async () => {
    saveDoc();
    fs.writeFileSync(path.join(root, COMP, 'big.js'), 'x'.repeat(COMPOSITION_SCAN_MAX_BYTES + 10));
    const { body } = await get(`assetId=comp&file=${encodeURIComponent(`${COMP}/big.js`)}`);
    expect(body).toMatchObject({ ok: true, truncated: true, bytes: COMPOSITION_SCAN_MAX_BYTES + 10 });
    expect((body['text'] as string).length).toBe(COMPOSITION_SCAN_MAX_BYTES);
  });

  it('쓰는 길은 없다 — 같은 주소의 POST·PUT·DELETE 는 받지 않고 파일은 그대로다', async () => {
    saveDoc();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`${base}/doc/vid-src/source?project=test&assetId=comp`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: 'test', text: 'x' }) });
      expect(res.status, method).toBe(404);
    }
    expect(fs.readFileSync(path.join(root, COMP, 'index.html'), 'utf8')).toBe('<div id="a">\n  <b>hi</b>\n</div>\n');
  });
});
