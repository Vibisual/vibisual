import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import { MEMO } from '../config.js';
import { extensionMime } from '../media.js';
import type { MemoServerHost } from '../host.js';
import { MemoAI } from './ai.js';
import { MemoAssets } from './assets.js';
import { identifier, MemoError, object } from './errors.js';
import { exportMemos } from './export.js';
import { MemoStore } from './store.js';

// 원본을 문서로 직접 열어도 스크립트·바깥 요청이 돌지 않게 한다(호스트 미디어 통로와 같은 머리).
const MEDIA_CSP = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; sandbox";
const mounted = new WeakMap<MemoServerHost, MemoAssets>();
function mediaFile(assets: MemoAssets, query: Record<string, unknown>): string {
  const version = query['version'] ? Number(query['version']) : undefined;
  return assets.locate(assets.store.project(query['project']), query['note'], query['asset'], version, query['variant'] === 'thumb' ? 'thumb' : undefined).file;
}
/** 호스트 미디어 통로가 부르는 해석기. `/media` 라우트와 같은 판정이고, 못 찾으면 null. */
export function resolveMemoMedia(host: MemoServerHost, query: URLSearchParams): string | null {
  let assets = mounted.get(host);
  if (!assets) { assets = new MemoAssets(new MemoStore(host)); mounted.set(host, assets); }
  try { return mediaFile(assets, Object.fromEntries(query)); } catch { return null; }
}
/** The host mounts this module behind its authenticated app namespace. */
export function mountMemoRoutes(app: Express, host: MemoServerHost): MemoStore {
  const store = new MemoStore(host); const assets = new MemoAssets(store); const ai = new MemoAI(store);
  mounted.set(host, assets);
  const failure = (res: Response, error: unknown): void => {
    if (res.headersSent) return;
    if (error instanceof MemoError) res.status(error.status).json({ ok: false, error: error.code, ...error.detail });
    else { host.warn(`[memo] ${String(error)}`); res.status(500).json({ ok: false, error: 'storage-failed' }); }
  };
  const route = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response): void => {
    try { Promise.resolve(fn(req, res)).catch((error: unknown) => failure(res, error)); }
    catch (error) { failure(res, error); }
  };
  app.get('/capabilities', (_req, res) => res.json({ ok: true, ...MEMO, sync: false, aiAttachmentAnalysis: false }));
  app.get('/status', route(async (req, res) => { res.json(await host.textTaskStatus(req.query['provider'] === 'codex' ? 'codex' : 'claude')); }));
  app.get('/notes', route((req, res) => {
    const root = store.project(req.query['project']);
    res.json({ notes: store.list(root, req.query), settings: store.settings(root) });
  }));
  app.post('/notes', route((req, res) => { res.json(store.create(store.project(req.body?.project), req.body)); }));
  app.get('/notes/:id', route((req, res) => { res.json(store.get(store.project(req.query['project']), req.params['id'])); }));
  app.patch('/notes/:id', route((req, res) => { res.json(store.save(store.project(req.body?.project), req.params['id'], req.body)); }));
  app.get('/notes/:id/history', route((req, res) => {
    res.json(store.history(store.project(req.query['project']), req.params['id'], req.query['before'] ? Number(req.query['before']) : undefined));
  }));
  app.get('/notes/:id/version/:version', route((req, res) => {
    res.json(store.version(store.project(req.query['project']), req.params['id'], Number(req.params['version'])));
  }));
  app.post('/settings', route(async (req, res) => { res.json(await store.setSettings(store.project(req.body?.project), req.body)); }));
  // 형식 머리가 무엇이든 조각으로 읽는다(전송 계층이 파일 형식으로 바꿔 보내도 본문을 잃지 않는다).
  const parseChunk = express.raw({ type: () => true, limit: MEMO.uploadChunk });
  const chunk = (req: Request, res: Response, next: NextFunction): void => {
    try { store.project(req.query['project']); } catch (error) { failure(res, error); return; }
    parseChunk(req, res, (error?: unknown) => { if (error) failure(res, new MemoError('attachment-too-large', 413)); else next(); });
  };
  app.put('/uploads/:uploadId', chunk, route(async (req, res) => {
    const root = store.project(req.query['project']); const uploadId = identifier(req.params['uploadId'], 'up');
    if (!Buffer.isBuffer(req.body)) throw new MemoError('attachment-empty');
    if (req.query['part'] === 'thumb') { await assets.blobs.putThumb(root, uploadId, req.body); res.json({ ok: true }); return; }
    res.json({ ok: true, received: await assets.blobs.append(root, uploadId, Number(req.query['offset']), req.body) });
  }));
  app.delete('/uploads/:uploadId', route(async (req, res) => {
    await assets.blobs.discard(store.project(req.query['project']), identifier(req.params['uploadId'], 'up')); res.json({ ok: true });
  }));
  app.post('/notes/:id/assets', route((req, res) => { res.json(assets.add(store.project(req.body?.project), req.params['id'], req.body)); }));
  app.get('/notes/:id/assets/:assetId', route((req, res) => {
    const value = assets.locate(store.project(req.query['project']), req.params['id'], req.params['assetId'], req.query['version'] ? Number(req.query['version']) : undefined);
    // Download arbitrary originals; never execute uploaded HTML/SVG in the app origin.
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(value.name)}`);
    res.setHeader('Content-Length', String(value.size));
    fs.createReadStream(value.file).on('error', error => { failure(res, error); res.destroy(); }).pipe(res);
  }));
  // 패키지 앱은 호스트 미디어 통로가 이 경로를 가로채 파일을 직접 흘린다. 웹·모바일만 여기서 구간 요청을 받는다.
  app.get('/media', route((req, res) => {
    const file = mediaFile(assets, req.query);
    res.setHeader('Content-Type', extensionMime(file));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', MEDIA_CSP);
    res.sendFile(file, { dotfiles: 'allow' });
  }));
  app.get('/export', route(async (req, res) => {
    const bytes = await exportMemos(store, store.project(req.query['project']));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="memos.zip"');
    res.send(Buffer.from(bytes));
  }));
  app.get('/jobs', route((req, res) => { res.json(ai.list(store.project(req.query['project']))); }));
  app.get('/jobs/:id', route((req, res) => { res.json(ai.get(store.project(req.query['project']), req.params['id'])); }));
  app.post('/jobs', route((req, res) => { res.json(ai.start(store.project(req.body?.project), req.body)); }));
  app.post('/jobs/:id/apply', route((req, res) => { object(req.body); res.json(ai.apply(store.project(req.body?.project), req.params['id'], req.body)); }));
  return store;
}
