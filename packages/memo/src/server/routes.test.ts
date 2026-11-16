import express from 'express';
import { inject } from 'light-my-request';
import { randomUUID } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { MEMO } from '../config.js';
import { mountMemoRoutes, resolveMemoMedia } from './routes.js';
import { testHost } from './testHost.js';
import type { MemoNote } from '../types.js';
const clean: (() => void)[] = []; afterEach(() => clean.splice(0).forEach(fn => fn()));
const req = (): string => `req-${randomUUID()}`;
function setup() {
  const env = testHost(); clean.push(env.dispose);
  const app = express(); app.use(express.json({ limit: '512kb' })); mountMemoRoutes(app, env.host);
  return { ...env, app };
}
const chunk = (app: Express, root: string, uploadId: string, offset: number, payload: Buffer, type = 'application/octet-stream') => inject(app, { method: 'PUT',
  url: `/uploads/${uploadId}?${new URLSearchParams({ project: root, offset: String(offset) })}`, headers: { 'content-type': type }, payload });
async function attach(app: Express, root: string, note: MemoNote, name: string, mime: string, bytes: Buffer, extra: Record<string, unknown> = {}) {
  const uploadId = `up-${randomUUID()}`;
  expect((await chunk(app, root, uploadId, 0, bytes)).statusCode).toBe(200);
  return inject(app, { method: 'POST', url: `/notes/${note.id}/assets`, payload: { project: root, requestId: req(), baseVersion: note.version, uploadId, name, mime, size: bytes.length, ...extra } });
}

describe('memo request and archive boundaries', () => {
  it('stores original bytes and exports note, attachment, context, checklist and versions together', async () => {
    const { app, root } = setup();
    const creation = await inject(app, { method: 'POST', url: '/notes', payload: { project: root, requestId: req(), body: '한글 메모',
      tasks: [{ id: `task-${randomUUID()}`, text: '시안 만들기', checked: true }], context: { id: root, excerpt: '당시 작업' } } });
    expect(creation.statusCode).toBe(200); const note = creation.json<MemoNote>();
    const original = Buffer.from([0, 1, 255, 17, 48, 0, 245]);
    const upload = await attach(app, root, note, '자료 원본.bin', 'application/octet-stream', original);
    expect(upload.statusCode).toBe(200); const saved = upload.json<MemoNote>(); const asset = saved.attachments[0]!;
    const download = await inject(app, { method: 'GET', url: `/notes/${note.id}/assets/${asset.id}?${new URLSearchParams({ project: root })}` });
    expect(download.rawPayload).toEqual(original); expect(download.headers['x-content-type-options']).toBe('nosniff');
    const result = await inject(app, { method: 'GET', url: `/export?${new URLSearchParams({ project: root })}` });
    expect(result.statusCode).toBe(200);
    const files = unzipSync(result.rawPayload);
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    expect(manifest.notes[0].body).toBe(note.body); expect(manifest.notes[0].context.excerpt).toBe('당시 작업');
    expect(manifest.notes[0].tasks[0].checked).toBe(true);
    expect(Buffer.from(files[`attachments/${asset.id}-자료 원본.bin`]!)).toEqual(original);
    expect(strFromU8(files[`notes/${note.id}.md`]!)).toContain('- [x] 시안 만들기');
    expect(files[`versions/${note.id}/1.json`]).toBeDefined(); expect(files[`versions/${note.id}/2.json`]).toBeDefined();
  });
  it('rejects unregistered projects and traversal without writing outside storage', async () => {
    const { app, root } = setup();
    expect((await inject(app, { method: 'GET', url: '/notes?project=outside' })).statusCode).toBe(404);
    expect((await inject(app, { method: 'GET', url: `/notes/memo-invalid../../anything?${new URLSearchParams({ project: root })}` })).statusCode).not.toBe(200);
  });
  it('downloads HTML attachments as inert original files', async () => {
    const { app, root } = setup();
    const created = await inject(app, { method: 'POST', url: '/notes', payload: { project: root, requestId: req(), body: 'attachment' } });
    const note = created.json<MemoNote>();
    const upload = await attach(app, root, note, 'page.html', 'text/html', Buffer.from('<script>throw Error()</script>'));
    const asset = upload.json<MemoNote>().attachments[0]!;
    const media = await inject(app, { method: 'GET', url: `/media?${new URLSearchParams({ project: root, note: note.id, asset: asset.id })}` });
    expect(media.headers['content-type']).toContain('application/octet-stream'); expect(media.headers['content-security-policy']).toContain('sandbox');
    const download = await inject(app, { method: 'GET', url: `/notes/${note.id}/assets/${asset.id}?${new URLSearchParams({ project: root })}` });
    expect(download.headers['content-type']).toContain('application/octet-stream'); expect(download.headers['content-disposition']).toContain('attachment;');
  });
  it('returns version conflicts through the HTTP contract and keeps the later original', async () => {
    const { app, root } = setup(); const result = await inject(app, { method: 'POST', url: '/notes', payload: { project: root, requestId: req(), body: 'first' } });
    const note = result.json<MemoNote>();
    await inject(app, { method: 'PATCH', url: `/notes/${note.id}`, payload: { project: root, requestId: req(), baseVersion: 1, body: 'newer' } });
    const stale = await inject(app, { method: 'PATCH', url: `/notes/${note.id}`, payload: { project: root, requestId: req(), baseVersion: 1, body: 'stale' } });
    expect(stale.statusCode).toBe(409); expect(stale.json().error).toBe('version-conflict');
    const current = await inject(app, { method: 'GET', url: `/notes/${note.id}?${new URLSearchParams({ project: root })}` });
    expect(current.json<MemoNote>().body).toBe('newer');
  });
  it('keeps original bytes as a plain file, outside JSON, and serves byte ranges of it', async () => {
    const { app, root, host } = setup();
    const note = (await inject(app, { method: 'POST', url: '/notes', payload: { project: root, requestId: req(), body: '캡처' } })).json<MemoNote>();
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);
    // 전송 계층이 형식 머리를 파일 형식으로 바꿔 보내도 조각 본문을 읽는다.
    const uploadId = `up-${randomUUID()}`;
    expect((await chunk(app, root, uploadId, 0, png, 'image/png')).json().received).toBe(png.length);
    const saved = (await inject(app, { method: 'POST', url: `/notes/${note.id}/assets`, payload: { project: root, requestId: req(), baseVersion: 1, uploadId, name: 'image.png', mime: 'image/png', size: png.length, width: 1920, height: 1080 } })).json<MemoNote>();
    const asset = saved.attachments[0]!;
    expect(asset).toMatchObject({ mime: 'image/png', size: png.length, width: 1920, height: 1080 });
    const file = path.join(root, '.vibisual/memo/blobs', asset.id, 'original.png');
    expect(fs.readFileSync(file)).toEqual(png);
    expect(fs.readFileSync(path.join(root, '.vibisual/memo/assets', `${asset.id}.json`), 'utf8')).not.toContain('base64');
    const query = new URLSearchParams({ project: root, note: note.id, asset: asset.id });
    expect(resolveMemoMedia(host, query)).toBe(file);
    const ranged = await inject(app, { method: 'GET', url: `/media?${query}`, headers: { range: 'bytes=1-3' } });
    expect(ranged.statusCode).toBe(206); expect(ranged.rawPayload).toEqual(png.subarray(1, 4)); expect(ranged.headers['content-type']).toBe('image/png');
  });
  it('appends chunks only in order, treats a resent chunk as received, and reports where to resume', async () => {
    const { app, root } = setup(); const uploadId = `up-${randomUUID()}`;
    const note = (await inject(app, { method: 'POST', url: '/notes', payload: { project: root, requestId: req(), body: '영상' } })).json<MemoNote>();
    expect((await chunk(app, root, uploadId, 0, Buffer.from('abcd'))).json().received).toBe(4);
    expect((await chunk(app, root, uploadId, 0, Buffer.from('abcd'))).json().received).toBe(4);
    const gap = await chunk(app, root, uploadId, 9, Buffer.from('zz'));
    expect(gap.statusCode).toBe(409); expect(gap.json()).toMatchObject({ error: 'upload-out-of-sync', received: 4 });
    const finalize = (size: number) => inject(app, { method: 'POST', url: `/notes/${note.id}/assets`, payload: { project: root, requestId: req(), baseVersion: 1, uploadId, name: 'clip.mkv', mime: '', size } });
    expect((await finalize(6)).json().error).toBe('upload-incomplete');
    expect((await chunk(app, root, uploadId, 4, Buffer.from('ef'))).json().received).toBe(6);
    const saved = (await finalize(6)).json<MemoNote>();
    expect(saved.attachments[0]).toMatchObject({ name: 'clip.mkv', mime: 'video/x-matroska', size: 6 });
    expect(fs.readdirSync(path.join(root, '.vibisual/memo/uploads'))).toEqual([]);
    expect((await chunk(app, root, `up-${randomUUID()}`, 0, Buffer.alloc(MEMO.uploadChunk + 1))).json().error).toBe('attachment-too-large');
    expect((await chunk(app, root, `up-${randomUUID()}`, 0, Buffer.alloc(0))).json().error).toBe('attachment-empty');
  });
  it('stores the small preview beside the original and only serves media the note references', async () => {
    const { app, root, host } = setup(); const uploadId = `up-${randomUUID()}`;
    const note = (await inject(app, { method: 'POST', url: '/notes', payload: { project: root, requestId: req(), body: '그림' } })).json<MemoNote>();
    const other = (await inject(app, { method: 'POST', url: '/notes', payload: { project: root, requestId: req(), body: '다른 메모' } })).json<MemoNote>();
    await chunk(app, root, uploadId, 0, Buffer.from('original-bytes'));
    await inject(app, { method: 'PUT', url: `/uploads/${uploadId}?${new URLSearchParams({ project: root, part: 'thumb' })}`, headers: { 'content-type': 'image/webp' }, payload: Buffer.from('thumb') });
    const saved = (await inject(app, { method: 'POST', url: `/notes/${note.id}/assets`, payload: { project: root, requestId: req(), baseVersion: 1, uploadId, name: 'photo.jpg', mime: 'image/jpeg', size: 14 } })).json<MemoNote>();
    const asset = saved.attachments[0]!; expect(asset.thumb).toBe(true);
    const thumb = await inject(app, { method: 'GET', url: `/media?${new URLSearchParams({ project: root, note: note.id, asset: asset.id, variant: 'thumb' })}` });
    expect(thumb.rawPayload.toString()).toBe('thumb'); expect(thumb.headers['content-type']).toBe('image/webp');
    expect(resolveMemoMedia(host, new URLSearchParams({ project: root, note: other.id, asset: asset.id }))).toBeNull();
    expect(resolveMemoMedia(host, new URLSearchParams({ project: 'outside', note: note.id, asset: asset.id }))).toBeNull();
    const detached = (await inject(app, { method: 'PATCH', url: `/notes/${note.id}`, payload: { project: root, requestId: req(), baseVersion: saved.version, detach: asset.id } })).json<MemoNote>();
    expect(detached.attachments).toEqual([]);
    expect(resolveMemoMedia(host, new URLSearchParams({ project: root, note: note.id, asset: asset.id }))).toBeNull();
    expect(resolveMemoMedia(host, new URLSearchParams({ project: root, note: note.id, asset: asset.id, version: String(saved.version) }))).not.toBeNull();
  });
  it('moves an attachment saved as base64 JSON to a file on first read without changing its bytes', async () => {
    const { app, root, host } = setup();
    const note = (await inject(app, { method: 'POST', url: '/notes', payload: { project: root, requestId: req(), body: '옛 첨부' } })).json<MemoNote>();
    const bytes = Buffer.from([9, 8, 7, 0, 255]); const meta = { id: `asset-${randomUUID()}`, name: '옛 그림.png', mime: 'image/png', size: bytes.length, createdAt: 1 };
    const dir = path.join(root, '.vibisual/memo'); fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', `${meta.id}.json`), JSON.stringify({ ...meta, base64: bytes.toString('base64') }));
    for (const file of [`notes/${note.id}.json`, `versions/${note.id}/1.json`]) fs.writeFileSync(path.join(dir, file), JSON.stringify({ ...note, attachments: [meta] }));
    const file = resolveMemoMedia(host, new URLSearchParams({ project: root, note: note.id, asset: meta.id }));
    expect(file).toBe(path.join(dir, 'blobs', meta.id, 'original.png')); expect(fs.readFileSync(file!)).toEqual(bytes);
    expect(fs.readFileSync(path.join(dir, 'assets', `${meta.id}.json`), 'utf8')).not.toContain('base64');
    const download = await inject(app, { method: 'GET', url: `/notes/${note.id}/assets/${meta.id}?${new URLSearchParams({ project: root })}` });
    expect(download.rawPayload).toEqual(bytes);
  });
  it('leaves originals that exceed the archive budget out of the ZIP and lists where they are', async () => {
    const { app, root } = setup();
    const note = (await inject(app, { method: 'POST', url: '/notes', payload: { project: root, requestId: req(), body: '큰 영상' } })).json<MemoNote>();
    const saved = (await attach(app, root, note, 'big.mp4', 'video/mp4', Buffer.from('video'))).json<MemoNote>(); const asset = saved.attachments[0]!;
    // 실제로 상한만큼 쓰지 않고, 표지의 크기만 키워 상한 판정을 확인한다.
    const metaFile = path.join(root, '.vibisual/memo/assets', `${asset.id}.json`);
    fs.writeFileSync(metaFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(metaFile, 'utf8')), size: MEMO.exportMax }));
    const files = unzipSync((await inject(app, { method: 'GET', url: `/export?${new URLSearchParams({ project: root })}` })).rawPayload);
    const manifest = JSON.parse(strFromU8(files['manifest.json']!));
    expect(manifest.omittedAttachments).toEqual([{ id: asset.id, noteId: note.id, name: 'big.mp4', size: MEMO.exportMax, path: `.vibisual/memo/blobs/${asset.id}/original.mp4` }]);
    expect(Object.keys(files).some(name => name.startsWith('attachments/'))).toBe(false); expect(files[`notes/${note.id}.md`]).toBeDefined();
  });
});
