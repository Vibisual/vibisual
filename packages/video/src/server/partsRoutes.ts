/**
 * §5.13 (V) 37-11 — 부품 서랍 REST(앱 라우트 — `/api/app/vibistudio/…`).
 *
 * - `GET  /parts?project=` — 우리가 쓴 부품 아홉 + 이 프로젝트의 내 부품(`[부품으로 저장]`)
 * - `GET  /parts/:partId/thumb?project=` — 그 부품의 **실제 정지 화면**(일꾼 스틸로 한 번 굽고 `.vibisual/video/parts/<id>/thumb-<지문>.png`
 *   로 기억 — 같은 이름은 덮어쓴다, 자동 삭제 ❌). 무지개 타일은 없다.
 * - `POST /parts/use { project, docId, partId }` — 부품을 그 문서의 **사본**으로 들인다(`compositions/<부품>-n/` — 사람·AI 가 고쳐도
 *   서랍 원본은 그대로) → 탐침 → 소재. 아이템을 얹는 것은 화면의 평소 편집 경로다(되돌릴 수 있다). 돌려준 `items` 는 얹을 틀.
 * - `POST /parts/save { project, docId, chapterId, name }` — 사람만. 그 장면의 컴포지션 폴더와 아이템 틀(장면 기준 시각·props)을
 *   `.vibisual/video/parts/<id>/` 로 저장 → 같은 서랍의 '내 부품'.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { isPathWithin } from '@vibisual/shared';

import { STILL_MAX_EDGE, VIDEO_COMPOSITIONS_DIR, VIDEO_PARTS_DIR } from '../constants.js';
import { chapterIdOf } from '../chapters.js';
import { createEmptyDoc } from '../ops.js';
import { stableHash } from '../hashItem.js';
import { resolveTimeline } from '../resolveTimeline.js';
import { VIDEO_PARTS, findPart, type SavedPart, type SavedPartItem } from '../parts/index.js';
import { compositionFolderOf, safeCompositionName } from '../composition/paths.js';
import type { VideoAsset, VideoDoc, VideoDocOp, VideoItem } from '../types.js';
import { rejectAgent } from './guards.js';
import { readStyleFile } from './styleRoutes.js';
import { assetWithProbe, compositionAssetId, compositionFolderAbs, probeComposition, vibisualRel } from './composition.js';

export interface PartsDeps {
  project(raw: unknown): string | null;
  readDoc(projectPath: string, docId: string): VideoDoc | null;
  writeDoc(projectPath: string, doc: VideoDoc): void;
  patchFresh(projectPath: string, docId: string, build: (doc: VideoDoc) => readonly VideoDocOp[]): VideoDoc | null;
  requestStill(projectPath: string, docId: string, t: number, opts: { maxEdge?: number }): Promise<{ status: string; result?: string; error?: string }>;
  atomicWriteFile(filePath: string, data: string): void;
  warn(message: string): void;
}

/** 썸네일 판형(가로) — 부품은 반응형이라 어느 판형에서도 같은 모습으로 선다. */
const THUMB_SIZE = { width: 1280, height: 720 } as const;
/** 썸네일 시각 — 부품 길이의 이 비율(등장이 끝난 모습). */
const THUMB_AT = 0.6;
/** 내 부품에 저장할 컴포지션 폴더의 바이트 상한. */
const SAVE_FOLDER_MAX_BYTES = 64 * 1024 * 1024;

function partsRoot(root: string): string {
  return path.join(root, '.vibisual', ...VIDEO_PARTS_DIR.split('/'));
}

function isSafePartId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function readSavedPart(root: string, id: string): SavedPart | null {
  if (!isSafePartId(id)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(partsRoot(root), id, 'part.json'), 'utf8')) as SavedPart;
    return parsed && parsed.id === id && Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

function listSavedParts(root: string): SavedPart[] {
  const dir = partsRoot(root);
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.map((n) => readSavedPart(root, n)).filter((p): p is SavedPart => p !== null).sort((a, b) => b.createdAt - a.createdAt);
}

/** 폴더를 통째로 복사한다(바이트 상한 — 넘으면 거기서 멈추고 false). */
function copyFolder(from: string, to: string, budget: { left: number }): boolean {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) { if (!copyFolder(src, dst, budget)) return false; continue; }
    if (!entry.isFile()) continue;
    const size = fs.statSync(src).size;
    if (size > budget.left) return false;
    budget.left -= size;
    fs.copyFileSync(src, dst);
  }
  return true;
}

/** `compositions/<base>` 아래 비어 있는 폴더 이름(겹치면 번호). */
function freeCompositionFolder(root: string, base: string): { abs: string; rel: string } {
  const parent = path.join(root, '.vibisual', ...VIDEO_COMPOSITIONS_DIR.split('/'));
  const safe = safeCompositionName(base) || 'part';
  let folder = safe;
  for (let i = 2; fs.existsSync(path.join(parent, folder)) && i < 1000; i += 1) folder = `${safe}-${i}`;
  return { abs: path.join(parent, folder), rel: `${vibisualRel(VIDEO_COMPOSITIONS_DIR)}/${folder}` };
}

export function mountPartsRoutes(app: Express, deps: PartsDeps): void {
  app.get('/parts', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    res.json({
      ok: true,
      parts: VIDEO_PARTS.map((part) => ({ id: part.id, category: part.category, name: part.name, defaultDuration: part.defaultDuration })),
      mine: listSavedParts(p).map((part) => ({ id: part.id, name: part.name, createdAt: part.createdAt, duration: part.duration, items: part.items.length })),
    });
  });

  app.get('/parts/:partId/thumb', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const partId = req.params.partId;
    if (!isSafePartId(partId)) { res.status(404).json({ ok: false, error: 'unknown part' }); return; }
    const dir = path.join(partsRoot(p), partId);
    const toDataUrl = (file: string): string => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
    // 내 부품 — 저장할 때 구운 한 장.
    const saved = readSavedPart(p, partId);
    if (saved) {
      const file = path.join(dir, 'thumb.png');
      if (fs.existsSync(file)) { res.json({ ok: true, image: toDataUrl(file) }); return; }
      res.status(404).json({ ok: false, error: 'no thumbnail' });
      return;
    }
    const part = findPart(partId);
    if (!part) { res.status(404).json({ ok: false, error: 'unknown part' }); return; }
    const style = readStyleFile(p)?.style;
    const html = part.html(THUMB_SIZE);
    const fingerprint = stableHash(`${html}\n${JSON.stringify(style ?? null)}`);
    const thumbFile = path.join(dir, `thumb-${fingerprint}.png`);
    if (fs.existsSync(thumbFile)) { res.json({ ok: true, image: toDataUrl(thumbFile) }); return; }
    // 숨은 미리보기 문서(`_` 로 시작 — 목록에 안 보인다)에 그 부품 하나를 얹고 일꾼 스틸로 한 장 굽는다.
    try {
      const previewDir = path.join(dir, 'preview');
      fs.mkdirSync(previewDir, { recursive: true });
      deps.atomicWriteFile(path.join(previewDir, 'index.html'), html);
      const rel = `${vibisualRel(VIDEO_PARTS_DIR)}/${partId}/preview/index.html`;
      const probed = probeComposition(p, rel);
      if (!probed.ok) { res.status(500).json({ ok: false, error: probed.error }); return; }
      const docId = `_part-${partId}`.slice(0, 64);
      const base = createEmptyDoc(docId, `${part.name} preview`);
      const asset: VideoAsset = assetWithProbe({ id: 'part', kind: 'composition', source: { kind: 'file', path: rel } }, probed.probe);
      const item: VideoItem = { id: 'part', kind: 'composition', at: 0, duration: part.defaultDuration, assetId: 'part' };
      const doc: VideoDoc = {
        ...base,
        size: { ...THUMB_SIZE },
        assets: { part: asset },
        tracks: base.tracks.map((tr) => (tr.id === 'visual' ? { ...tr, items: [item] } : tr)),
        ...(style ? { style } : {}),
      };
      deps.writeDoc(p, doc);
      deps.requestStill(p, docId, part.defaultDuration * THUMB_AT, { maxEdge: STILL_MAX_EDGE })
        .then((job) => {
          if (job.status !== 'done' || typeof job.result !== 'string') { res.status(504).json({ ok: false, error: job.error ?? 'no still' }); return; }
          const comma = job.result.indexOf(',');
          try { fs.writeFileSync(thumbFile, Buffer.from(job.result.slice(comma + 1), 'base64')); } catch (err) { deps.warn(`[video] 부품 썸네일을 쓰지 못했습니다: ${String(err)}`); }
          res.json({ ok: true, image: job.result });
        })
        .catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post('/parts/use', (req, res) => {
    const body = req.body as { project?: unknown; docId?: unknown; partId?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = typeof body.docId === 'string' ? body.docId : '';
    const doc = deps.readDoc(p, docId);
    if (!doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const partId = body.partId;
    if (!isSafePartId(partId)) { res.status(400).json({ ok: false, error: 'partId required' }); return; }

    // 들인 컴포지션 폴더 하나를 탐침해 **소재 모양**을 만든다 — 문서에 적는 것은 화면이 평소 편집 경로로 한 번에 한다
    // (소재 + 아이템이 한 패치 — 되돌리기 한 번에 함께 걷힌다). 이번 응답 안에서 id 가 겹치지 않게 고른다.
    const assets: VideoAsset[] = [];
    const taken = new Set(Object.keys(doc.assets));
    const register = (relHtml: string): { assetId: string; duration?: number } | null => {
      const probed = probeComposition(p, relHtml);
      if (!probed.ok) return null;
      const base = compositionAssetId(doc, relHtml);
      let assetId = base;
      for (let i = 2; taken.has(assetId) && i < 1000; i += 1) assetId = `${base}-${i}`;
      taken.add(assetId);
      assets.push(assetWithProbe({ id: assetId, kind: 'composition', source: { kind: 'file', path: relHtml } }, probed.probe));
      return { assetId, ...(probed.probe.duration !== undefined ? { duration: probed.probe.duration } : {}) };
    };

    const builtIn = findPart(partId);
    if (builtIn) {
      const target = freeCompositionFolder(p, builtIn.id);
      fs.mkdirSync(target.abs, { recursive: true });
      deps.atomicWriteFile(path.join(target.abs, 'index.html'), builtIn.html(doc.size));
      const reg = register(`${target.rel}/index.html`);
      if (!reg) { res.status(500).json({ ok: false, error: 'the part could not be added' }); return; }
      res.json({
        ok: true,
        assets,
        items: [{ kind: 'composition', trackKind: 'visual', relStart: 0, duration: reg.duration ?? builtIn.defaultDuration, assetId: reg.assetId, label: builtIn.name }],
      });
      return;
    }

    const saved = readSavedPart(p, partId);
    if (!saved) { res.status(404).json({ ok: false, error: 'unknown part' }); return; }
    const compAsset = new Map<string, string>();
    const items: Array<Record<string, unknown>> = [];
    for (const it of saved.items) {
      if (it.comp) {
        let assetId = compAsset.get(it.comp);
        if (!assetId) {
          const src = path.join(partsRoot(p), saved.id, 'comps', safeCompositionName(it.comp));
          if (!fs.existsSync(src)) continue;
          const target = freeCompositionFolder(p, it.comp);
          if (!copyFolder(src, target.abs, { left: SAVE_FOLDER_MAX_BYTES })) continue;
          const htmlName = fs.existsSync(path.join(target.abs, 'index.html')) ? 'index.html' : (fs.readdirSync(target.abs).find((n) => /\.html?$/i.test(n)) ?? 'index.html');
          const reg = register(`${target.rel}/${htmlName}`);
          if (!reg) continue;
          assetId = reg.assetId;
          compAsset.set(it.comp, assetId);
        }
        items.push({ ...it, assetId });
        continue;
      }
      items.push({ ...it });
    }
    res.json({ ok: true, assets, items });
  });

  app.post('/parts/save', (req, res) => {
    if (rejectAgent(req, res, 'Parts are saved by the user from the chapter menu.')) return;
    const body = req.body as { project?: unknown; docId?: unknown; chapterId?: unknown; name?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const docId = typeof body.docId === 'string' ? body.docId : '';
    const doc = deps.readDoc(p, docId);
    if (!doc) { res.status(404).json({ ok: false, error: 'unknown doc' }); return; }
    const timeline = resolveTimeline(doc);
    const chapter = timeline.chapters.find((c) => c.id === body.chapterId);
    if (!chapter) { res.status(404).json({ ok: false, error: 'unknown chapter' }); return; }
    const id = `mine-${Date.now().toString(36)}`;
    const dir = path.join(partsRoot(p), id);
    const items: SavedPartItem[] = [];
    const comps = new Map<string, string>();
    try {
      fs.mkdirSync(path.join(dir, 'comps'), { recursive: true });
      for (const r of timeline.items) {
        if (chapterIdOf(r.item) !== chapter.id) continue;
        const asset = r.item.assetId ? doc.assets[r.item.assetId] : undefined;
        let comp: string | undefined;
        if (r.kind === 'composition' && asset?.source.kind === 'file') {
          const folderAbs = compositionFolderAbs(p, asset.source.path);
          if (!folderAbs || !isPathWithin(folderAbs, p, process.platform)) continue;
          comp = comps.get(folderAbs);
          if (!comp) {
            comp = safeCompositionName(path.basename(compositionFolderOf(asset.source.path))) || `comp-${comps.size + 1}`;
            while ([...comps.values()].includes(comp)) comp = `${comp}-x`;
            if (!copyFolder(folderAbs, path.join(dir, 'comps', comp), { left: SAVE_FOLDER_MAX_BYTES })) {
              res.status(413).json({ ok: false, error: 'the composition folder is too large to save as a part' });
              return;
            }
            comps.set(folderAbs, comp);
          }
        }
        items.push({
          kind: r.kind,
          trackKind: r.trackKind,
          relStart: Math.round((r.start - chapter.start) * 1000) / 1000,
          duration: Math.round(r.duration * 1000) / 1000,
          ...(r.item.label ? { label: r.item.label } : {}),
          ...(r.item.sceneId ? { sceneId: r.item.sceneId } : {}),
          ...(r.item.props ? { props: r.item.props } : {}),
          ...(r.item.transform ? { transform: r.item.transform as Record<string, unknown> } : {}),
          ...(comp ? { comp } : asset ? { asset: asset as unknown as Record<string, unknown> } : {}),
          ...(r.item.cues ? { cues: r.item.cues.map((c) => ({ start: c.start - chapter.start, end: c.end - chapter.start, text: c.text })) } : {}),
        });
      }
      const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim().slice(0, 80) : chapter.chapter.title || id;
      const part: SavedPart = { schemaVersion: 1, id, name, createdAt: Date.now(), duration: chapter.duration, items };
      deps.atomicWriteFile(path.join(dir, 'part.json'), JSON.stringify(part, null, 2));
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
      return;
    }
    // 그 장면 가운데 한 장을 썸네일로(늦게 와도 저장은 이미 끝났다).
    deps.requestStill(p, docId, chapter.start + chapter.duration * 0.5, { maxEdge: STILL_MAX_EDGE })
      .then((job) => {
        if (job.status === 'done' && typeof job.result === 'string') {
          const comma = job.result.indexOf(',');
          try { fs.writeFileSync(path.join(dir, 'thumb.png'), Buffer.from(job.result.slice(comma + 1), 'base64')); } catch { /* 썸네일 없이도 부품은 선다 */ }
        }
      })
      .catch(() => undefined)
      .finally(() => res.json({ ok: true, id }));
  });
}
