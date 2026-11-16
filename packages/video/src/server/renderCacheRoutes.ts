/**
 * §5.13 (E-7)(E-8)(E-9) 렌더 구간 캐시의 길 — 전부 일꾼 전용(루프백 유입 403: 에이전트가 조각을 바꿔 넣어 다음 렌더에 섞지 못하게).
 * 문서 밖 지문(env) · 있는 열쇠 묻기(query) · 조각 읽기·쓰기. 자리·검사·정리는 `segmentCache.ts`.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';

import { RENDER_SEGMENT_KEY_RE, RENDER_SEGMENT_MAX_BYTES, VIDEO_LIBS_DIR } from '../constants.js';
import type { VideoDoc } from '../types.js';
import { resolveVideoAssetAsync } from './assets.js';
import { compositionFingerprintAsync } from './composition.js';
import { rejectAgent } from './guards.js';
import { isSafeId } from './routeSupport.js';
import { listSegments, readSegment, segmentDirFor, segmentPruneBook, writeSegment } from './segmentCache.js';
import type { VideoService } from './videoService.js';

export interface RenderCacheRoutesDeps {
  readonly project: (raw: unknown) => string | null;
  readonly service: VideoService;
}

const WORKER_ONLY = 'Render segments are read and written by the Vibistudio worker window.';
/** 한 번에 묻는 열쇠 상한(2초 구간 — 약 11시간 치). */
const QUERY_KEYS_MAX = 20_000;
/** 공유 파일 지문이 훑는 파일 상한 — 넘으면 넘었다는 사실까지 지문에 든다. */
const SHARED_FILES_MAX = 5_000;
/** 못 읽은 소재의 지문 — 파일이 생기면 열쇠가 바뀐다. */
const MISSING = 'missing';

function stamp(stat: fs.Stats): string {
  return `${stat.size}:${Math.round(stat.mtimeMs)}`;
}

/** 소재 id → 파일 지문. 컴포지션은 폴더 지문(웹 형식 파일 전부), 그 밖은 파일의 크기·수정 시각. */
export async function assetFileStamps(root: string, doc: VideoDoc): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(Object.values(doc.assets).map(async (asset) => {
    const rel = asset.source.kind === 'file' ? asset.source.path : asset.source.output;
    try {
      if (asset.kind === 'composition') {
        out[asset.id] = (await compositionFingerprintAsync(root, rel)) ?? MISSING;
        return;
      }
      out[asset.id] = stamp(await fs.promises.stat(await resolveVideoAssetAsync(root, rel)));
    } catch {
      out[asset.id] = MISSING;
    }
  }));
  return out;
}

/** 문서 전체에 걸리는 파일(`video/libs/` — 스타일 글꼴·로고·가져온 라이브러리)의 경로·크기·수정 시각을 접은 값. 없으면 빈 글. */
export async function sharedFilesStamp(root: string): Promise<string> {
  const base = path.join(root, '.vibisual', ...VIDEO_LIBS_DIR.split('/'));
  const lines: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (lines.length >= SHARED_FILES_MAX) return;
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) { await walk(path.join(dir, entry.name), next); continue; }
      if (!entry.isFile()) continue;
      try { lines.push(`${next}:${stamp(await fs.promises.stat(path.join(dir, entry.name)))}`); } catch { /* 훑는 사이 지워졌다 — 그것도 변화다 */ }
    }
  };
  await walk(base, '');
  if (lines.length === 0) return '';
  lines.sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

export function mountRenderCacheRoutes(app: Express, deps: RenderCacheRoutesDeps): void {
  const { project, service } = deps;
  /** 프로젝트·문서 id 를 풀어 조각 자리를 낸다. 못 풀면 응답하고 null. */
  const place = (req: express.Request, res: express.Response, rawProject: unknown): { root: string; dir: string } | null => {
    const root = project(rawProject);
    if (!root) { res.status(404).json({ ok: false, error: 'unknown project' }); return null; }
    const raw: unknown = req.params['docId'];
    const docId = typeof raw === 'string' ? raw : '';
    if (!isSafeId(docId)) { res.status(400).json({ ok: false, error: 'invalid doc id' }); return null; }
    return { root, dir: segmentDirFor(root, docId) };
  };

  app.post('/doc/:docId/render-cache/env', (req, res) => {
    if (rejectAgent(req, res, WORKER_ONLY)) return;
    const at = place(req, res, (req.body as { project?: unknown } | undefined)?.project);
    if (!at) return;
    const doc = service.readDoc(at.root, req.params.docId);
    if (!doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    void Promise.all([assetFileStamps(at.root, doc), sharedFilesStamp(at.root)])
      .then(([files, shared]) => { res.json({ ok: true, files, shared }); })
      .catch((error: unknown) => { res.status(500).json({ ok: false, error: String(error) }); });
  });

  app.post('/doc/:docId/render-cache/query', (req, res) => {
    if (rejectAgent(req, res, WORKER_ONLY)) return;
    const body = req.body as { project?: unknown; keys?: unknown } | undefined;
    const at = place(req, res, body?.project);
    if (!at) return;
    const keys = Array.isArray(body?.keys) ? body.keys.filter((k): k is string => typeof k === 'string').slice(0, QUERY_KEYS_MAX) : [];
    void listSegments(at.dir, keys)
      .then((have) => { res.json({ ok: true, have }); })
      .catch((error: unknown) => { res.status(500).json({ ok: false, error: String(error) }); });
  });

  app.get('/doc/:docId/render-cache/:key', (req, res) => {
    if (rejectAgent(req, res, WORKER_ONLY)) return;
    const at = place(req, res, req.query['project']);
    if (!at) return;
    if (!RENDER_SEGMENT_KEY_RE.test(req.params.key)) { res.status(400).json({ ok: false, error: 'invalid segment key' }); return; }
    void readSegment(at.dir, req.params.key)
      .then((body) => {
        if (!body) { res.status(404).json({ ok: false, error: 'no segment' }); return; }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      })
      .catch((error: unknown) => { res.status(500).json({ ok: false, error: String(error) }); });
  });

  app.put('/doc/:docId/render-cache/:key', express.raw({ type: 'application/octet-stream', limit: RENDER_SEGMENT_MAX_BYTES }), (req, res) => {
    if (rejectAgent(req, res, WORKER_ONLY)) return;
    const at = place(req, res, req.query['project']);
    if (!at) return;
    if (!RENDER_SEGMENT_KEY_RE.test(req.params.key)) { res.status(400).json({ ok: false, error: 'invalid segment key' }); return; }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) { res.status(400).json({ ok: false, error: 'Expected segment bytes.' }); return; }
    // 지워진 문서의 자리를 되살리지 않는다.
    if (!service.readDoc(at.root, req.params.docId)) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const body = req.body;
    void writeSegment(at.dir, req.params.key, body)
      .then((stored) => {
        if (stored) segmentPruneBook.noteWrite(at.root, body.length);
        res.json({ ok: true, stored });
      })
      .catch((error: unknown) => { res.status(500).json({ ok: false, error: String(error) }); });
  });
}
