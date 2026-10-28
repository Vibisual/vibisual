/**
 * §5.13 (T-6)(T-10)(V) 37-11 — 가져오기 REST. 에이전트는 읽기(`GET /libs`·`/libs/project-files`)와 요청(`POST /libs/requests`)만 — 받기·들이기·지우기는 사람만.
 * `DELETE` 는 묶음을 목록에서만 뺀다(쓰던 문서가 깨지지 않게). `vendor` 는 바깥 참조를 `vendor/` 에 받아 사본 주소를 상대 경로로 바꾼다(원본 `index.source.html`).
 * 라이선스는 찾은 그대로 보여 주고 판단하지 않는다. 받기는 `invokeMain('libs:download')`(시스템 프록시를 따르는 main 네트워크) · 목록은 원자적 쓰기.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { isPathWithin } from '@vibisual/shared';

import { VIDEO_COMPOSITIONS_DIR, VIDEO_DIR, VIDEO_LIBS_DIR } from '../constants.js';
import {
  LIB_DOWNLOAD_MAX_BYTES,
  PACK_VENDOR_MAX_FILES,
  detectLicense,
  libFormatOf,
  safeLibName,
  type LibItem,
  type LibRequest,
  type LibsFile,
  type LibVendored,
} from '../libs.js';
import { cssExternalRefs, ensureDurationMeta, findExternalRefs, rewriteUrls, vendorFileName, type ExternalRef } from '../composition/externalRefs.js';
import { isAgentRequest, rejectAgent } from './guards.js';
import { readZip, isSafeZipName } from './zipReader.js';

export interface LibsHost {
  atomicWriteFile(filePath: string, data: string): void;
  warn(message: string): void;
  invokeMain?(action: string, payload?: unknown): Promise<unknown>;
}

const FONT_EXT = new Set(['.woff2', '.woff', '.ttf', '.otf']);
const LIB_EXT = new Set(['.js', '.mjs', '.css']);
/** `node_modules` 찾기 상한(파일 수·깊이·결과 수). */
const PROJECT_SEARCH_MAX_FILES = 20000;
const PROJECT_SEARCH_MAX_DEPTH = 6;
const PROJECT_SEARCH_MAX_RESULTS = 60;

function libsFilePath(root: string): string {
  return path.join(root, '.vibisual', VIDEO_DIR, 'libs.json');
}

export function readLibsFile(root: string): LibsFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(libsFilePath(root), 'utf8')) as Partial<LibsFile>;
    return { schemaVersion: 1, items: Array.isArray(parsed.items) ? parsed.items : [], requests: Array.isArray(parsed.requests) ? parsed.requests : [] };
  } catch {
    return { schemaVersion: 1, items: [], requests: [] };
  }
}

function sha256(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

let seq = 0;
function newId(prefix: string): string {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

function isText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 4096).includes(0);
}

export function mountLibsRoutes(app: Express, deps: { project(raw: unknown): string | null; host: () => LibsHost }): void {
  const write = (root: string, file: LibsFile): void => {
    const target = libsFilePath(root);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    deps.host().atomicWriteFile(target, JSON.stringify(file, null, 2));
  };
  const update = (root: string, fn: (f: LibsFile) => LibsFile): LibsFile => {
    const next = fn(readLibsFile(root));
    write(root, next);
    return next;
  };
  /** 라이브러리 이름 → 비어 있는 폴더(`libs/<이름>` — 겹치면 번호). */
  const freeFolder = (root: string, sub: string, name: string): { abs: string; rel: string; name: string } => {
    const parent = path.join(root, '.vibisual', ...sub.split('/'));
    let n = name;
    for (let i = 2; fs.existsSync(path.join(parent, n)) && i < 1000; i += 1) n = `${name}-${i}`;
    return { abs: path.join(parent, n), rel: `.vibisual/${sub}/${n}`, name: n };
  };
  const download = async (url: string): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }> => {
    const invoke = deps.host().invokeMain;
    if (!invoke) throw new Error('Downloading is only available in the desktop app.');
    const r = (await invoke('libs:download', { url })) as { bytes: ArrayBuffer | Uint8Array; contentType: string; finalUrl: string };
    const bytes = Buffer.from(r.bytes instanceof Uint8Array ? r.bytes : new Uint8Array(r.bytes));
    if (bytes.length > LIB_DOWNLOAD_MAX_BYTES) throw new Error('The file is larger than the download limit.');
    return { bytes, contentType: r.contentType, finalUrl: r.finalUrl };
  };

  /** 파일 하나(이름·바이트)를 들인다 — 확장자로 갈래를 고른다. HTML 은 묶음(+ 바깥 참조 목록)으로. */
  const ingestFile = (root: string, fileName: string, bytes: Buffer, source: LibItem['source']): { item: LibItem; refs?: ExternalRef[]; hasDuration?: boolean } => {
    const ext = path.extname(fileName).toLowerCase();
    const base = safeLibName(path.basename(fileName, ext));
    if (ext === '.zip') {
      const entries = readZip(bytes);
      const html = entries.find((e) => /\.html?$/i.test(e.name) && !e.name.includes('/'))
        ?? entries.find((e) => /(?:^|\/)index\.html?$/i.test(e.name));
      const sub = html ? VIDEO_COMPOSITIONS_DIR : VIDEO_LIBS_DIR;
      const target = freeFolder(root, sub, base);
      let total = 0;
      const files: string[] = [];
      for (const e of entries) {
        if (!isSafeZipName(e.name)) continue;
        const dest = path.resolve(target.abs, e.name);
        if (!isPathWithin(dest, target.abs, process.platform)) continue; // zip slip — 두 번째 그물
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, e.data);
        files.push(e.name);
        total += e.data.length;
      }
      const pkg = entries.find((e) => /(?:^|\/)package\.json$/.test(e.name));
      const lic = entries.find((e) => /(?:^|\/)(?:LICENSE|LICENCE|COPYING)(?:\.[a-z]+)?$/i.test(e.name));
      const license = (pkg && detectLicense(pkg.data.toString('utf8'))) || (lic && detectLicense(lic.data.toString('utf8'))) || undefined;
      let version: string | undefined;
      let entry = html?.name;
      if (pkg) {
        try {
          const meta = JSON.parse(pkg.data.toString('utf8')) as { version?: unknown; main?: unknown; style?: unknown; module?: unknown };
          if (typeof meta.version === 'string') version = meta.version;
          if (!entry) {
            const prefix = pkg.name.includes('/') ? pkg.name.slice(0, pkg.name.lastIndexOf('/') + 1) : '';
            const main = [meta.main, meta.module, meta.style].find((m): m is string => typeof m === 'string');
            if (main) entry = `${prefix}${main.replace(/^\.\//, '')}`;
          }
        } catch { /* 깨진 package.json */ }
      }
      if (!entry) entry = files.find((f) => LIB_EXT.has(path.extname(f).toLowerCase())) ?? files.find((f) => FONT_EXT.has(path.extname(f).toLowerCase()));
      const item: LibItem = {
        id: newId(html ? 'pack' : 'lib'), kind: html ? 'pack' : entry && FONT_EXT.has(path.extname(entry).toLowerCase()) ? 'font' : 'library',
        name: target.name, folder: target.rel, files,
        ...(entry ? { entry } : {}),
        format: html ? 'pack' : libFormatOf(entry ?? ''),
        source, ...(license ? { license } : {}), ...(version ? { version } : {}),
        sha256: sha256(bytes), bytes: total, addedAt: Date.now(),
        ...(html ? { vendored: [] } : {}),
      };
      if (html) {
        const text = html.data.toString('utf8');
        return { item, refs: findExternalRefs(text), hasDuration: /name\s*=\s*["']vibi:duration["']/i.test(text) };
      }
      return { item };
    }
    if (ext === '.html' || ext === '.htm') {
      const target = freeFolder(root, VIDEO_COMPOSITIONS_DIR, base);
      fs.mkdirSync(target.abs, { recursive: true });
      fs.writeFileSync(path.join(target.abs, 'index.source.html'), bytes);
      fs.writeFileSync(path.join(target.abs, 'index.html'), bytes);
      const text = bytes.toString('utf8');
      const item: LibItem = {
        id: newId('pack'), kind: 'pack', name: target.name, folder: target.rel, files: ['index.html', 'index.source.html'], entry: 'index.html',
        format: 'pack', source, sha256: sha256(bytes), bytes: bytes.length, addedAt: Date.now(), vendored: [],
        ...(detectLicense(text) ? { license: detectLicense(text) } : {}),
      };
      return { item, refs: findExternalRefs(text), hasDuration: /name\s*=\s*["']vibi:duration["']/i.test(text) };
    }
    if (!LIB_EXT.has(ext) && !FONT_EXT.has(ext)) throw new Error('Unsupported file (use .js, .mjs, .css, a font, .zip or .html).');
    const target = freeFolder(root, VIDEO_LIBS_DIR, base);
    fs.mkdirSync(target.abs, { recursive: true });
    const fileOut = `${safeLibName(path.basename(fileName, ext))}${ext}`;
    fs.writeFileSync(path.join(target.abs, fileOut), bytes);
    const license = isText(bytes) ? detectLicense(bytes.toString('utf8')) : undefined;
    const item: LibItem = {
      id: newId(FONT_EXT.has(ext) ? 'font' : 'lib'), kind: FONT_EXT.has(ext) ? 'font' : 'library', name: target.name,
      folder: target.rel, files: [fileOut], entry: fileOut, format: libFormatOf(fileOut, isText(bytes) && /\bexport\s+(?:default|const|function|class|\{)/.test(bytes.toString('utf8').slice(0, 200_000))),
      source, ...(license ? { license } : {}), sha256: sha256(bytes), bytes: bytes.length, addedAt: Date.now(),
    };
    return { item };
  };

  const addItem = (root: string, item: LibItem, requestId?: string): LibsFile => update(root, (f) => ({
    ...f,
    items: [...f.items, item],
    requests: requestId ? f.requests.map((r) => (r.id === requestId ? { ...r, status: 'imported' as const } : r)) : f.requests,
  }));

  app.get('/libs', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const f = readLibsFile(p);
    res.json({ ok: true, items: f.items, requests: f.requests });
  });

  app.post('/libs/requests', (req, res) => {
    const body = req.body as { project?: unknown; url?: unknown; reason?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    let url: URL;
    try { url = new URL(String(body.url ?? '')); } catch { res.status(400).json({ ok: false, error: 'url must be an https:// address' }); return; }
    if (url.protocol !== 'https:') { res.status(400).json({ ok: false, error: 'url must be an https:// address' }); return; }
    const request: LibRequest = {
      id: newId('req'), url: url.toString(), reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '',
      from: isAgentRequest(req) ? 'agent' : 'user', createdAt: Date.now(), status: 'pending',
    };
    update(p, (f) => ({ ...f, requests: [...f.requests.filter((r) => !(r.url === request.url && r.status === 'pending')), request].slice(-100) }));
    res.json({ ok: true, request, note: 'The user decides whether to import it. Until then, write the motion with CSS animations, element.animate() or window.__vibi.seek.' });
  });

  app.patch('/libs/requests/:id', (req, res) => {
    if (rejectAgent(req, res, 'Only the user answers library requests.')) return;
    const body = req.body as { project?: unknown; status?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    if (body.status !== 'rejected') { res.status(400).json({ ok: false, error: "status must be 'rejected' (import with POST /libs/url)" }); return; }
    const f = update(p, (cur) => ({ ...cur, requests: cur.requests.map((r) => (r.id === req.params.id ? { ...r, status: 'rejected' as const } : r)) }));
    res.json({ ok: true, requests: f.requests });
  });

  app.put('/libs/file', express.raw({ type: 'application/octet-stream', limit: LIB_DOWNLOAD_MAX_BYTES * 4 }), (req, res) => {
    if (rejectAgent(req, res, 'Ask the user to import it: POST /libs/requests { project, url, reason }.')) return;
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const name = typeof req.query['name'] === 'string' ? req.query['name'] : '';
    if (!Buffer.isBuffer(req.body) || req.body.length === 0 || name === '') { res.status(400).json({ ok: false, error: 'file bytes and name are required' }); return; }
    try {
      const r = ingestFile(p, name, req.body, { kind: 'file', name: path.basename(name) });
      addItem(p, r.item);
      res.json({ ok: true, item: r.item, ...(r.refs ? { refs: r.refs, hasDuration: r.hasDuration } : {}) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/libs/url', (req, res) => {
    if (rejectAgent(req, res, 'Ask the user to import it: POST /libs/requests { project, url, reason }.')) return;
    const body = req.body as { project?: unknown; url?: unknown; name?: unknown; requestId?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    download(url)
      .then(({ bytes, finalUrl, contentType }) => {
        const fromUrl = (finalUrl.split(/[?#]/)[0] ?? '').split('/').pop() ?? 'lib';
        let name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : fromUrl;
        if (path.extname(name) === '') name += /css/.test(contentType) ? '.css' : /font|woff/.test(contentType) ? '.woff2' : /zip/.test(contentType) ? '.zip' : '.js';
        const r = ingestFile(p, name, bytes, { kind: 'url', url });
        addItem(p, r.item, typeof body.requestId === 'string' ? body.requestId : undefined);
        res.json({ ok: true, item: r.item, ...(r.refs ? { refs: r.refs, hasDuration: r.hasDuration } : {}) });
      })
      .catch((err: unknown) => res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  });

  app.get('/libs/project-files', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const q = typeof req.query['q'] === 'string' ? req.query['q'].trim().toLowerCase() : '';
    const root = path.join(p, 'node_modules');
    const out: { path: string; bytes: number }[] = [];
    if (q.length < 2 || !fs.existsSync(root)) { res.json({ ok: true, files: out }); return; }
    let seen = 0;
    const walk = (dir: string, depth: number): void => {
      if (depth > PROJECT_SEARCH_MAX_DEPTH || out.length >= PROJECT_SEARCH_MAX_RESULTS || seen > PROJECT_SEARCH_MAX_FILES) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (out.length >= PROJECT_SEARCH_MAX_RESULTS) return;
        seen += 1;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '.bin' && e.name !== 'test' && e.name !== '__tests__') walk(abs, depth + 1); continue; }
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!LIB_EXT.has(ext) && !FONT_EXT.has(ext)) continue;
        const rel = path.relative(p, abs).split(path.sep).join('/');
        if (!rel.toLowerCase().includes(q)) continue;
        try { out.push({ path: rel, bytes: fs.statSync(abs).size }); } catch { /* 사라졌다 */ }
      }
    };
    walk(root, 0);
    res.json({ ok: true, files: out.sort((a, b) => a.path.length - b.path.length) });
  });

  app.post('/libs/project', (req, res) => {
    if (rejectAgent(req, res, 'Ask the user to import it: POST /libs/requests { project, url, reason }.')) return;
    const body = req.body as { project?: unknown; path?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const rel = typeof body.path === 'string' ? body.path : '';
    const abs = path.resolve(p, rel);
    if (!isPathWithin(abs, path.join(p, 'node_modules'), process.platform)) { res.status(400).json({ ok: false, error: 'pick a file inside this project\'s node_modules' }); return; }
    try {
      const bytes = fs.readFileSync(abs);
      if (bytes.length > LIB_DOWNLOAD_MAX_BYTES) throw new Error('The file is larger than the import limit.');
      // 가장 가까운 package.json 의 라이선스·버전(사용자가 이미 설치한 것 — 그 사실을 그대로 적는다).
      let license: string | undefined;
      let version: string | undefined;
      for (let dir = path.dirname(abs); isPathWithin(dir, path.join(p, 'node_modules'), process.platform); dir = path.dirname(dir)) {
        const pkg = path.join(dir, 'package.json');
        if (fs.existsSync(pkg)) {
          try {
            const meta = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { license?: unknown; version?: unknown };
            if (typeof meta.license === 'string') license = meta.license;
            if (typeof meta.version === 'string') version = meta.version;
          } catch { /* 깨진 package.json */ }
          break;
        }
        if (dir === path.dirname(dir)) break;
      }
      const r = ingestFile(p, path.basename(abs), bytes, { kind: 'project', path: rel });
      const item: LibItem = { ...r.item, ...(license ? { license } : {}), ...(version ? { version } : {}) };
      addItem(p, item);
      res.json({ ok: true, item });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/libs/:id', (req, res) => {
    if (rejectAgent(req, res, 'Only the user removes imported libraries.')) return;
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const f = readLibsFile(p);
    const item = f.items.find((i) => i.id === req.params.id);
    if (!item) { res.status(404).json({ ok: false, error: 'unknown library' }); return; }
    if (item.kind !== 'pack') {
      const abs = path.resolve(p, item.folder);
      if (isPathWithin(abs, path.join(p, '.vibisual', ...VIDEO_LIBS_DIR.split('/')), process.platform)) {
        try { fs.rmSync(abs, { recursive: true, force: true }); } catch (err) { deps.host().warn(`[video] 라이브러리 폴더를 지우지 못했습니다: ${String(err)}`); }
      }
    }
    write(p, { ...f, items: f.items.filter((i) => i.id !== item.id) });
    res.json({ ok: true });
  });

  app.post('/libs/:id/vendor', (req, res) => {
    if (rejectAgent(req, res, 'Only the user downloads external references.')) return;
    const body = req.body as { project?: unknown; urls?: unknown; duration?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const f = readLibsFile(p);
    const item = f.items.find((i) => i.id === req.params.id && i.kind === 'pack');
    if (!item) { res.status(404).json({ ok: false, error: 'unknown pack' }); return; }
    const folder = path.resolve(p, item.folder);
    const htmlFile = path.join(folder, item.entry ?? 'index.html');
    const urls = (Array.isArray(body.urls) ? body.urls : []).filter((u): u is string => typeof u === 'string' && /^https:\/\//i.test(u)).slice(0, PACK_VENDOR_MAX_FILES);
    const duration = typeof body.duration === 'number' && Number.isFinite(body.duration) && body.duration > 0 ? body.duration : null;
    void (async () => {
      const vendored: LibVendored[] = [...(item.vendored ?? [])];
      const failed: { url: string; error: string }[] = [];
      const mapping = new Map<string, string>();
      const vendorDir = path.join(folder, 'vendor');
      fs.mkdirSync(vendorDir, { recursive: true });
      const fetchOne = async (url: string): Promise<{ rel: string; bytes: Buffer } | null> => {
        if (vendored.length >= PACK_VENDOR_MAX_FILES) { failed.push({ url, error: 'too many files for one pack' }); return null; }
        try {
          const got = await download(url);
          const digest = sha256(got.bytes);
          const name = vendorFileName(url, digest);
          fs.writeFileSync(path.join(vendorDir, name), got.bytes);
          const license = isText(got.bytes) ? detectLicense(got.bytes.toString('utf8')) : undefined;
          vendored.push({ url, path: `vendor/${name}`, sha256: digest, bytes: got.bytes.length, ...(license ? { license } : {}) });
          return { rel: `vendor/${name}`, bytes: got.bytes };
        } catch (err) {
          failed.push({ url, error: err instanceof Error ? err.message : String(err) });
          return null;
        }
      };
      for (const url of urls) {
        const got = await fetchOne(url);
        if (!got) continue;
        mapping.set(url, got.rel);
        // 받은 스타일시트 안까지 따라가 글꼴·그림을 받고 그 안의 주소도 바꾼다(스타일시트 기준 상대 경로 — 같은 vendor/ 안).
        if (/\.css(?:$|\?)/i.test(url) || got.rel.endsWith('.css')) {
          const css = got.bytes.toString('utf8');
          const inner = new Map<string, string>();
          for (const ref of cssExternalRefs(css)) {
            const sub = await fetchOne(ref.url);
            if (sub) inner.set(ref.url, sub.rel.replace(/^vendor\//, ''));
          }
          if (inner.size > 0) fs.writeFileSync(path.join(folder, got.rel), rewriteUrls(css, inner));
        }
      }
      let html = fs.readFileSync(htmlFile, 'utf8');
      html = rewriteUrls(html, mapping);
      if (duration !== null) html = ensureDurationMeta(html, duration);
      fs.writeFileSync(htmlFile, html);
      const next = update(p, (cur) => ({ ...cur, items: cur.items.map((i) => (i.id === item.id ? { ...i, vendored, files: [...new Set([...i.files, ...vendored.map((v) => v.path)])] } : i)) }));
      res.json({ ok: true, item: next.items.find((i) => i.id === item.id), failed, path: `${item.folder}/${item.entry ?? 'index.html'}` });
    })().catch((err: unknown) => res.status(500).json({ ok: false, error: String(err) }));
  });
}
