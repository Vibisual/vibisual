/**
 * §5.13 (V) 37-10 — 스타일 카드 REST. `POST /style/scan` 은 색·글꼴·로고 후보를 상한 안에서 훑어 제안과 함께 돌려준다(읽기만 · `node_modules`·숨김·빌드
 * 폴더는 건너뜀 · 경로 비교는 `isPathWithin` — pathKey, 멀티플랫폼 1축). `PUT /style` 은 사람만 — 글꼴·로고를 `libs/style/`(컴포지션이 읽는 뿌리, (T-3) ①)로
 * 복사하고 `style.json` 에 원자적으로 적는다. 새 문서는 확정된 스타일을 받아 태어난다(`POST /docs`).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { isPathWithin } from '@vibisual/shared';

import { VIDEO_STYLE_ASSET_DIR, VIDEO_STYLE_FILE } from '../constants.js';
import {
  isCssColor,
  normalizeHex,
  suggestStyle,
  type ColorCandidate,
  type FontCandidate,
  type LogoCandidate,
  type StyleCandidates,
  type StyleFile,
} from '../style.js';
import { safeCompositionName, toPosixPath } from '../composition/paths.js';
import type { DocStyle } from '../types.js';
import { rejectAgent } from './guards.js';

export interface StyleHost {
  atomicWriteFile(filePath: string, data: string): void;
  warn(message: string): void;
}

/** 훑는 상한 — 큰 저장소에서 스튜디오가 멈추지 않게. */
const SCAN_MAX_FILES = 4000;
const SCAN_FILE_MAX_BYTES = 512 * 1024;
const SCAN_TOTAL_MAX_BYTES = 24 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'target', 'vendor', 'bower_components']);
const TEXT_EXT = new Set(['.css', '.scss', '.sass', '.less', '.styl', '.html', '.htm', '.vue', '.svelte', '.astro', '.tsx', '.jsx', '.ts', '.js', '.mjs', '.cjs']);
const FONT_EXT = new Set(['.woff2', '.woff', '.ttf', '.otf']);
const LOGO_EXT = new Set(['.svg', '.png']);
/** 후보 목록 상한(화면이 다 볼 수 있는 만큼). */
const COLORS_MAX = 24;
const FONTS_MAX = 12;
const LOGOS_MAX = 12;
/** 복사해 들일 글꼴·로고 파일 상한. */
const STYLE_COPY_MAX_BYTES = 8 * 1024 * 1024;

function walk(root: string, visit: (abs: string, rel: string, size: number) => boolean): { files: number; partial: boolean } {
  let files = 0;
  let partial = false;
  const stack: string[] = [''];
  while (stack.length > 0) {
    const relDir = stack.pop() ?? '';
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(root, relDir), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
        stack.push(rel);
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      if (files > SCAN_MAX_FILES) return { files, partial: true };
      let size = 0;
      try { size = fs.statSync(path.join(root, rel)).size; } catch { continue; }
      if (!visit(path.join(root, rel), rel, size)) { partial = true; return { files, partial }; }
    }
  }
  return { files, partial };
}

/** 프로젝트를 훑어 후보를 모은다(읽기만). */
export function scanStyleCandidates(root: string): StyleCandidates {
  const colors = new Map<string, { value: string; name?: string; count: number; source: string }>();
  const fonts = new Map<string, { family: string; file?: string; count: number; source: string }>();
  const logos: LogoCandidate[] = [];
  let total = 0;
  const addColor = (raw: string, name: string | undefined, source: string, weight = 1): void => {
    const value = normalizeHex(raw);
    if (!value) return;
    const prev = colors.get(value);
    if (prev) { prev.count += weight; if (!prev.name && name) prev.name = name; }
    else colors.set(value, { value, ...(name ? { name } : {}), count: weight, source });
  };
  const addFont = (family: string, source: string, file?: string): void => {
    const clean = family.trim().replace(/^['"]|['"]$/g, '').trim();
    if (clean === '' || clean.length > 60 || /[{}<>;]/.test(clean)) return;
    const key = clean.toLowerCase();
    const prev = fonts.get(key);
    if (prev) { prev.count += 1; if (!prev.file && file) prev.file = file; }
    else fonts.set(key, { family: clean, ...(file ? { file } : {}), count: 1, source });
  };
  const result = walk(root, (abs, rel, size) => {
    const ext = path.extname(rel).toLowerCase();
    const base = path.basename(rel).toLowerCase();
    if (LOGO_EXT.has(ext) && base.includes('logo') && logos.length < LOGOS_MAX * 4) logos.push({ path: toPosixPath(rel), bytes: size });
    if (FONT_EXT.has(ext)) addFont(path.basename(rel, ext).replace(/[-_](regular|bold|medium|light|semibold|italic|variable|vf|\d+)$/i, ''), rel, toPosixPath(rel));
    const tailwind = /^tailwind\.config\.(?:js|cjs|mjs|ts)$/.test(base);
    if (!TEXT_EXT.has(ext) && !tailwind) return true;
    if (size > SCAN_FILE_MAX_BYTES) return true;
    if (total + size > SCAN_TOTAL_MAX_BYTES) return false;
    total += size;
    let text: string;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { return true; }
    // CSS 변수(가장 강한 신호 — 이름이 있다).
    for (const m of text.matchAll(/--([\w-]{1,40})\s*:\s*(#[0-9a-fA-F]{3,8})\b/g)) addColor(m[2] ?? '', `--${m[1] ?? ''}`, rel, 3);
    // tailwind 설정의 colors.
    if (tailwind) for (const m of text.matchAll(/['"]?([\w-]{1,40})['"]?\s*:\s*['"](#[0-9a-fA-F]{3,8})['"]/g)) addColor(m[2] ?? '', m[1], rel, 3);
    // 스타일 선언 안의 16진 색.
    if (ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less' || ext === '.styl' || ext === '.html' || ext === '.htm' || ext === '.vue' || ext === '.svelte') {
      for (const m of text.matchAll(/(?:color|background(?:-color)?|fill|stroke|border(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8})\b/gi)) addColor(m[1] ?? '', undefined, rel, 1);
    }
    // 글꼴 — @font-face 먼저(파일이 따라온다), 그다음 font-family 선언.
    for (const m of text.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
      const body = m[1] ?? '';
      const family = /font-family\s*:\s*([^;]+);?/i.exec(body)?.[1];
      const url = /url\(\s*['"]?([^'")]+\.(?:woff2|woff|ttf|otf))['"]?\s*\)/i.exec(body)?.[1];
      if (!family) continue;
      let file: string | undefined;
      if (url && !/^(?:[a-z]+:)?\/\//i.test(url)) {
        const resolved = path.resolve(path.dirname(abs), url.split(/[?#]/)[0] ?? url);
        if (isPathWithin(resolved, root, process.platform) && fs.existsSync(resolved)) file = toPosixPath(path.relative(root, resolved));
      }
      addFont(family, rel, file);
    }
    for (const m of text.matchAll(/font-family\s*:\s*([^;}\n]+)/gi)) {
      const first = (m[1] ?? '').split(',')[0] ?? '';
      if (/var\(/.test(first)) continue;
      addFont(first, rel);
    }
    return true;
  });
  const colorList: ColorCandidate[] = [...colors.values()].sort((a, b) => b.count - a.count).slice(0, COLORS_MAX);
  const fontList: FontCandidate[] = [...fonts.values()].sort((a, b) => (b.file ? 1 : 0) - (a.file ? 1 : 0) || b.count - a.count).slice(0, FONTS_MAX);
  const logoList = logos.sort((a, b) => (a.path.endsWith('.svg') ? 0 : 1) - (b.path.endsWith('.svg') ? 0 : 1) || a.path.length - b.path.length).slice(0, LOGOS_MAX);
  return { colors: colorList, fonts: fontList, logos: logoList, scannedFiles: result.files, partial: result.partial };
}

export function styleFilePath(root: string): string {
  return path.join(root, '.vibisual', ...VIDEO_STYLE_FILE.split('/'));
}

export function readStyleFile(root: string): StyleFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(styleFilePath(root), 'utf8')) as Partial<StyleFile>;
    const s = parsed.style;
    if (!s || !isCssColor(s.accent) || !isCssColor(s.bg) || !isCssColor(s.fg) || !isCssColor(s.muted)) return null;
    return { schemaVersion: 1, style: s, confirmedAt: typeof parsed.confirmedAt === 'number' ? parsed.confirmedAt : 0 };
  } catch {
    return null;
  }
}

/** 프로젝트 안 파일을 스타일 자리로 복사한다(같은 이름이면 덮어쓴다). 돌려준 것은 프로젝트 기준 경로. */
function copyIntoStyleDir(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  if (!isPathWithin(abs, root, process.platform)) return null;
  let st: fs.Stats;
  try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isFile() || st.size === 0 || st.size > STYLE_COPY_MAX_BYTES) return null;
  const ext = path.extname(rel).toLowerCase();
  if (!FONT_EXT.has(ext) && !LOGO_EXT.has(ext)) return null;
  const name = `${safeCompositionName(path.basename(rel, ext)) || 'style'}${ext}`;
  const dir = path.join(root, '.vibisual', ...VIDEO_STYLE_ASSET_DIR.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(abs, path.join(dir, name));
  return `.vibisual/${VIDEO_STYLE_ASSET_DIR}/${name}`;
}

export function mountStyleRoutes(app: Express, deps: { project(raw: unknown): string | null; host: () => StyleHost }): void {
  app.post('/style/scan', (req, res) => {
    const body = req.body as { project?: unknown };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    try {
      const candidates = scanStyleCandidates(p);
      res.json({ ok: true, candidates, suggestion: suggestStyle(candidates), current: readStyleFile(p)?.style ?? null });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.get('/style', (req, res) => {
    const p = deps.project(req.query['project']);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    res.json({ ok: true, style: readStyleFile(p)?.style ?? null });
  });

  app.put('/style', (req, res) => {
    if (rejectAgent(req, res, 'Only the user confirms the project style card. Use the --vibi-* variables in your compositions.')) return;
    const body = req.body as { project?: unknown; style?: Partial<Record<keyof DocStyle, unknown>> };
    const p = deps.project(body.project);
    if (!p) { res.status(404).json({ ok: false, error: 'unknown project' }); return; }
    const s = body.style ?? {};
    if (!isCssColor(s.accent) || !isCssColor(s.bg) || !isCssColor(s.fg) || !isCssColor(s.muted)) {
      res.status(400).json({ ok: false, error: 'accent, bg, fg, muted must be CSS colors' });
      return;
    }
    const family = typeof s.fontFamily === 'string' ? s.fontFamily.trim().replace(/["<>;{}]/g, '').slice(0, 60) : '';
    let fontFile: string | null = null;
    let logo: string | null = null;
    try {
      if (typeof s.fontFile === 'string' && s.fontFile !== '') fontFile = s.fontFile.startsWith(`.vibisual/${VIDEO_STYLE_ASSET_DIR}/`) ? s.fontFile : copyIntoStyleDir(p, s.fontFile);
      if (typeof s.logo === 'string' && s.logo !== '') logo = s.logo.startsWith(`.vibisual/${VIDEO_STYLE_ASSET_DIR}/`) ? s.logo : copyIntoStyleDir(p, s.logo);
    } catch (err) {
      deps.host().warn(`[video] 스타일 파일을 복사하지 못했습니다: ${String(err)}`);
    }
    const style: DocStyle = {
      accent: s.accent.trim(), bg: s.bg.trim(), fg: s.fg.trim(), muted: s.muted.trim(),
      ...(family !== '' ? { fontFamily: family } : {}),
      ...(fontFile ? { fontFile } : {}),
      ...(logo ? { logo } : {}),
    };
    const file: StyleFile = { schemaVersion: 1, style, confirmedAt: Date.now() };
    const target = styleFilePath(p);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    deps.host().atomicWriteFile(target, JSON.stringify(file, null, 2));
    res.json({ ok: true, style });
  });
}
