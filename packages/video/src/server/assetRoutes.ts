/** §5.13 — 소재 올리기·재료·프로젝트 파일 가져오기·소재/미디어 내주기. */
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { importProjectAsset, resolveVideoAsset, saveVideoAsset, VIDEO_UPLOAD_LIMIT } from './assets.js';
import { VIDEO_DIR, safeCompositionName } from '../index.js';
import type { AppServerHost } from '../host.js';
import { rejectAgent } from './guards.js';
import { resolveVideoMedia } from './videoService.js';

export interface AssetRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly host: () => AppServerHost;
}

/** §5.13 (V) 37-2 — 시작 화면 재료(소재 아닌 파일)의 형식과 크기 상한. */
const MATERIAL_EXTENSIONS: readonly string[] = ['.csv', '.tsv', '.json', '.txt', '.md', '.svg'];
const MATERIAL_UPLOAD_LIMIT = 16 * 1024 * 1024;

export function mountAssetRoutes(app: Express, deps: AssetRoutesDeps): void {
  const { project, host } = deps;
  /** 소재 파일 — 경로는 프로젝트 루트 안으로만 허용한다(§3.5): `..` 를 섞어 프로젝트 밖 파일을 읽어 가는 길을 막는다. */
  app.put('/assets', express.raw({ type: 'application/octet-stream', limit: VIDEO_UPLOAD_LIMIT }), (req, res) => {
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    try {
      if (!Buffer.isBuffer(req.body)) throw new Error('Expected media bytes.');
      res.json({ ok: true, asset: saveVideoAsset(p, req.query['name'], req.body) });
    } catch (error) { res.status(400).json({ ok: false, error: String(error) }); }
  });

  /** §5.13 (V) 37-2 — 끌어 놓은 소재 아닌 재료(CSV·표·JSON·글·SVG 로고)를 프로젝트 안에 둔다(에이전트는 그 경로를 읽는다). 사람이 놓은 것만 받는다(루프백 거절). */
  app.put('/materials', express.raw({ type: 'application/octet-stream', limit: MATERIAL_UPLOAD_LIMIT }), (req, res) => {
    if (rejectAgent(req, res, 'Read project files directly; materials are dropped by the user.')) return;
    const p = project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const name = typeof req.query['name'] === 'string' ? req.query['name'] : '';
    const ext = path.extname(name).toLowerCase();
    if (!MATERIAL_EXTENSIONS.includes(ext) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ ok: false, error: 'unsupported material' });
      return;
    }
    try {
      const dir = path.join(p, '.vibisual', VIDEO_DIR, 'materials');
      fs.mkdirSync(dir, { recursive: true });
      const safe = safeCompositionName(path.basename(name, ext)) || 'material';
      const file = `${Date.now().toString(36)}-${safe}${ext}`;
      fs.writeFileSync(path.join(dir, file), req.body, { flag: 'wx' });
      res.json({ ok: true, path: `.vibisual/${VIDEO_DIR}/materials/${file}` });
    } catch (error) { res.status(500).json({ ok: false, error: String(error) }); }
  });

  /** §5.13 (G) — 프로젝트 안 파일을 소재 자리로 복사한다(에이전트는 바이트 대신 경로만 준다 · 첨부 원본은 보존 정책이 지울 수 있다). */
  app.post('/assets/import', (req, res) => {
    const body = req.body as { project?: unknown; path?: unknown };
    const p = project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    if (typeof body.path !== 'string' || body.path.trim() === '') {
      res.status(400).json({ ok: false, error: 'path required' });
      return;
    }
    try {
      res.json({ ok: true, asset: importProjectAsset(p, body.path) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/asset', (req, res) => {
    const p = project(req.query['project']);
    const rel = req.query['path'];
    if (!p || typeof rel !== 'string' || rel === '') {
      res.status(404).json({ ok: false, error: 'unknown project or path' });
      return;
    }
    let target: string;
    try { target = resolveVideoAsset(p, rel); } catch {
      res.status(404).json({ ok: false, error: 'not found' });
      return;
    }
    // §5.13 (R-10) — 소재는 그림·소리로만 읽힌다. SVG 를 문서로 직접 열어도 스크립트·바깥 요청이 돌지 않게 막는다.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(target, { dotfiles: 'allow' });
  });

  /** §5.13 (Y) 40-1 — 패키지 앱은 이 경로를 vibproxy 가 가로채 여기까지 안 온다. 웹·모바일만 여기서 `sendFile`(구간 요청 지원) — 해석은 `resolveVideoMedia` 한 곳. */
  app.get('/media', (req, res) => {
    const query = new URLSearchParams();
    for (const key of ['project', 'path'] as const) {
      const value = req.query[key];
      if (typeof value === 'string') query.set(key, value);
    }
    void resolveVideoMedia(host(), query).then((target) => {
      if (!target) { res.status(404).json({ ok: false, error: 'not found' }); return; }
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(target, { dotfiles: 'allow' });
    }, () => { if (!res.headersSent) res.status(404).json({ ok: false, error: 'not found' }); });
  });
}
