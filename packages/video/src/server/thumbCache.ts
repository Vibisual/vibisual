/**
 * §5.13 (X) 39-4 — 장면 대표 프레임의 **디스크 기억**(`<project>/.vibisual/video/thumbs/<docId>/<열쇠>.<확장자>`).
 *
 * 열쇠는 순수 층 `chapterThumbWants` 가 정한다(보이는 것이 같으면 같은 열쇠). 프로젝트 폴더 안에 두므로 프로젝트를 옮기면 함께
 * 가고(§3.5), 문서를 지우면 함께 지운다. 서버가 창의 메인 스레드와 한 몸이라(§3.7) 읽기·쓰기는 전부 비동기다.
 *
 * - 쓰기는 임시 파일 → 이름 바꾸기 — 반쯤 쓴 그림을 읽는 일이 없다.
 * - 한 장 상한(`CHAPTER_THUMB_MAX_BYTES`)을 넘는 그림은 남기지 않는다.
 * - 문서마다 상한(`CHAPTER_THUMBS_MAX_PER_DOC`)을 넘으면 **지금 장면이 쓰지 않는 것** 중 오래된 것부터 지운다(§3.2.3 — 쓸수록 커지는
 *   것에 상한). 지금 쓰는 그림은 상한과 무관하게 남는다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { CHAPTER_THUMB_MAX_BYTES, CHAPTER_THUMBS_MAX_PER_DOC, VIDEO_THUMBS_DIR } from '../constants.js';

const KEY_RE = /^[0-9a-f]{16}$/;
/** 받는 그림 형식 → 확장자. 그 밖은 남기지 않는다. */
const MIME_EXT: Readonly<Record<string, string>> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };
const EXT_MIME: Readonly<Record<string, string>> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

export function thumbsDirFor(projectPath: string, docId: string): string {
  return path.join(projectPath, '.vibisual', VIDEO_THUMBS_DIR, docId);
}

/** 그 문서 자리의 그림들(열쇠 → 파일 이름). 자리가 없으면 빈 지도. */
async function listThumbFiles(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let names: string[];
  try { names = await fs.promises.readdir(dir); } catch { return out; }
  for (const name of names) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) continue;
    const key = name.slice(0, dot);
    const ext = name.slice(dot + 1);
    if (KEY_RE.test(key) && EXT_MIME[ext]) out.set(key, name);
  }
  return out;
}

/** 열쇠들 중 디스크에 있는 것을 데이터 주소로 읽는다(없거나 못 읽은 것은 빠진다). */
export async function readThumbs(dir: string, keys: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;
  const files = await listThumbFiles(dir);
  await Promise.all(keys.map(async (key) => {
    const name = files.get(key);
    if (!name) return;
    const mime = EXT_MIME[name.slice(name.lastIndexOf('.') + 1)];
    if (!mime) return;
    try {
      const bytes = await fs.promises.readFile(path.join(dir, name));
      if (bytes.length > 0 && bytes.length <= CHAPTER_THUMB_MAX_BYTES) out.set(key, `data:${mime};base64,${bytes.toString('base64')}`);
    } catch { /* 지워졌거나 못 읽는다 — 다시 굽는다 */ }
  }));
  return out;
}

/** 데이터 주소 → (형식, 바이트). 받는 형식이 아니거나 상한을 넘으면 null. */
export function decodeThumbDataUrl(dataUrl: string): { ext: string; bytes: Buffer } | null {
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const ext = MIME_EXT[m[1] ?? ''];
  if (!ext) return null;
  const bytes = Buffer.from(m[2] ?? '', 'base64');
  if (bytes.length === 0 || bytes.length > CHAPTER_THUMB_MAX_BYTES) return null;
  return { ext, bytes };
}

/** 한 장을 남긴다(임시 파일 → 이름 바꾸기). 같은 열쇠의 다른 형식은 걷는다. 실패는 조용히(다음에 다시 굽는다). */
export async function writeThumb(dir: string, key: string, dataUrl: string): Promise<boolean> {
  if (!KEY_RE.test(key)) return false;
  const decoded = decodeThumbDataUrl(dataUrl);
  if (!decoded) return false;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${key}.${decoded.ext}`);
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await fs.promises.writeFile(tmp, decoded.bytes);
    await fs.promises.rename(tmp, file);
    for (const other of Object.values(MIME_EXT)) {
      if (other !== decoded.ext) await fs.promises.rm(path.join(dir, `${key}.${other}`), { force: true });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 상한을 넘으면 `keep`(지금 장면이 쓰는 열쇠) 밖의 것을 오래된 것부터 지운다. 지운 수를 돌려준다. 남은 임시 파일(쓰다 멈춘 것)도
 * 함께 치운다.
 */
export async function pruneThumbs(dir: string, keep: ReadonlySet<string>, max: number = CHAPTER_THUMBS_MAX_PER_DOC): Promise<number> {
  let names: string[];
  try { names = await fs.promises.readdir(dir); } catch { return 0; }
  let removed = 0;
  const candidates: { name: string; mtime: number }[] = [];
  let total = 0;
  for (const name of names) {
    const full = path.join(dir, name);
    if (name.endsWith('.tmp')) {
      try { await fs.promises.rm(full, { force: true }); removed += 1; } catch { /* 다음에 */ }
      continue;
    }
    const dot = name.lastIndexOf('.');
    const key = dot > 0 ? name.slice(0, dot) : '';
    if (!KEY_RE.test(key)) continue;
    total += 1;
    if (keep.has(key)) continue;
    try { candidates.push({ name, mtime: (await fs.promises.stat(full)).mtimeMs }); } catch { /* 이미 없다 */ }
  }
  let excess = total - Math.max(0, max);
  candidates.sort((a, b) => a.mtime - b.mtime);
  for (const c of candidates) {
    if (excess <= 0) break;
    try { await fs.promises.rm(path.join(dir, c.name), { force: true }); removed += 1; excess -= 1; } catch { /* 다음에 */ }
  }
  return removed;
}

/** 문서를 지울 때 — 그 문서의 그림 자리를 통째로 지운다. */
export async function removeThumbsDir(dir: string): Promise<void> {
  try { await fs.promises.rm(dir, { recursive: true, force: true }); } catch { /* 이미 없다 */ }
}
