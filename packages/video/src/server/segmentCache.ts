/**
 * §5.13 (E-6) 렌더 구간 조각의 디스크 자리(`<project>/.vibisual/video/cache/segments/<docId>/<열쇠>.seg`) — 다시 구우면 같은 것이 나오는 파생물이라
 * 휴지통 없이 지운다. 파일 = 표식 + 본문 SHA-256 + 본문(읽을 때 맞춰 보고 틀리면 지운다). 전부 비동기(§3.7), 쓰기는 임시 파일 → 이름 바꾸기.
 * SHA-256 은 Node crypto(네이티브 — rust-compute.md 의 측정 예외와 같은 갈래).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { pathKey, type PlatformName } from '@vibisual/shared';

import {
  RENDER_SEGMENT_CACHE_MAX_AGE_DAYS,
  RENDER_SEGMENT_CACHE_MAX_BYTES,
  RENDER_SEGMENT_CACHE_PRUNE_RATIO,
  RENDER_SEGMENT_KEY_RE,
  RENDER_SEGMENT_MAX_BYTES,
  RENDER_SEGMENT_PRUNE_EVERY_BYTES,
  VIDEO_SEGMENT_CACHE_DIR,
} from '../constants.js';

const MARK = Buffer.from('VIBISEG1', 'ascii');
const SUM_BYTES = 32;
const HEAD_BYTES = MARK.length + SUM_BYTES;
const EXT = '.seg';
const DAY_MS = 24 * 60 * 60 * 1000;
/** 이보다 오래된 임시 파일만 걷는다 — 지금 쓰는 중인 것을 지우지 않게. */
const TMP_STALE_MS = 60 * 60 * 1000;

/** 프로젝트의 조각 자리(그 밑에 문서 id 폴더). */
export function segmentRootFor(projectPath: string): string {
  return path.join(projectPath, '.vibisual', ...VIDEO_SEGMENT_CACHE_DIR.split('/'));
}

export function segmentDirFor(projectPath: string, docId: string): string {
  return path.join(segmentRootFor(projectPath), docId);
}

function fileOf(dir: string, key: string): string {
  return path.join(dir, `${key}${EXT}`);
}

/** 열쇠들 중 조각 파일이 있는 것(내용은 읽을 때 검사한다). */
export async function listSegments(dir: string, keys: readonly string[]): Promise<string[]> {
  const wanted = keys.filter((key) => RENDER_SEGMENT_KEY_RE.test(key));
  if (wanted.length === 0) return [];
  let names: string[];
  try { names = await fs.promises.readdir(dir); } catch { return []; }
  const present = new Set(names);
  return wanted.filter((key) => present.has(`${key}${EXT}`));
}

/** 조각 본문. 표식·체크섬·상한이 어긋나면 지우고 null. 읽으면 수정 시각을 올린다(오래 안 쓴 것부터 지우는 기준). */
export async function readSegment(dir: string, key: string, now: number = Date.now()): Promise<Buffer | null> {
  if (!RENDER_SEGMENT_KEY_RE.test(key)) return null;
  const file = fileOf(dir, key);
  let bytes: Buffer;
  try { bytes = await fs.promises.readFile(file); } catch { return null; }
  const body = bytes.subarray(HEAD_BYTES);
  const sound = bytes.length > HEAD_BYTES && bytes.length - HEAD_BYTES <= RENDER_SEGMENT_MAX_BYTES
    && bytes.subarray(0, MARK.length).equals(MARK)
    && bytes.subarray(MARK.length, HEAD_BYTES).equals(createHash('sha256').update(body).digest());
  if (!sound) {
    await fs.promises.rm(file, { force: true }).catch(() => undefined);
    return null;
  }
  const stamp = new Date(now);
  await fs.promises.utimes(file, stamp, stamp).catch(() => undefined);
  return body;
}

/** 조각을 남긴다. 상한을 넘거나 빈 본문은 남기지 않는다. 실패는 false(다음 렌더가 다시 굽는다). */
export async function writeSegment(dir: string, key: string, body: Buffer): Promise<boolean> {
  if (!RENDER_SEGMENT_KEY_RE.test(key) || body.length === 0 || body.length > RENDER_SEGMENT_MAX_BYTES) return false;
  const file = fileOf(dir, key);
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(tmp, Buffer.concat([MARK, createHash('sha256').update(body).digest(), body]));
    await fs.promises.rename(tmp, file);
    return true;
  } catch {
    await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
    return false;
  }
}

export interface SegmentPruneLimits {
  readonly maxBytes?: number;
  /** 상한을 넘으면 `maxBytes × ratio` 까지 내린다. */
  readonly ratio?: number;
  readonly maxAgeMs?: number;
  readonly now?: number;
}

/**
 * §3.2.3 — 안 쓴 지 오래된 조각, 합계 상한을 넘는 만큼(마지막으로 쓴 지 오래된 것부터), 쓰다 멈춘 임시 파일, 빈 문서 폴더를 걷는다.
 * 지운 파일 수와 남은 바이트를 돌려준다.
 */
export async function pruneSegments(root: string, limits: SegmentPruneLimits = {}): Promise<{ removed: number; bytes: number }> {
  const maxBytes = limits.maxBytes ?? RENDER_SEGMENT_CACHE_MAX_BYTES;
  const ratio = limits.ratio ?? RENDER_SEGMENT_CACHE_PRUNE_RATIO;
  const maxAgeMs = limits.maxAgeMs ?? RENDER_SEGMENT_CACHE_MAX_AGE_DAYS * DAY_MS;
  const now = limits.now ?? Date.now();
  let docs: string[];
  try { docs = await fs.promises.readdir(root); } catch { return { removed: 0, bytes: 0 }; }

  let removed = 0;
  const drop = async (file: string): Promise<boolean> => {
    try { await fs.promises.rm(file, { force: true }); removed += 1; return true; } catch { return false; }
  };
  const kept: { file: string; size: number; mtime: number }[] = [];
  for (const doc of docs) {
    const dir = path.join(root, doc);
    let names: string[];
    try { names = await fs.promises.readdir(dir); } catch { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      let stat: fs.Stats;
      try { stat = await fs.promises.stat(file); } catch { continue; }
      if (!stat.isFile()) continue;
      if (name.endsWith('.tmp')) {
        if (now - stat.mtimeMs > TMP_STALE_MS) await drop(file);
        continue;
      }
      if (!name.endsWith(EXT) || !RENDER_SEGMENT_KEY_RE.test(name.slice(0, -EXT.length))) continue;
      if (now - stat.mtimeMs > maxAgeMs && await drop(file)) continue;
      kept.push({ file, size: stat.size, mtime: stat.mtimeMs });
    }
  }

  let bytes = kept.reduce((sum, entry) => sum + entry.size, 0);
  if (bytes > maxBytes) {
    const floor = Math.max(0, maxBytes * ratio);
    kept.sort((a, b) => a.mtime - b.mtime);
    for (const entry of kept) {
      if (bytes <= floor) break;
      if (await drop(entry.file)) bytes -= entry.size;
    }
  }
  // 빈 문서 폴더(비어 있지 않으면 rmdir 이 실패한다 — 그대로 둔다).
  for (const doc of docs) await fs.promises.rmdir(path.join(root, doc)).catch(() => undefined);
  return { removed, bytes };
}

/** 문서를 지울 때 — 그 문서의 조각 자리를 통째로 지운다. */
export async function removeSegmentDir(dir: string): Promise<void> {
  try { await fs.promises.rm(dir, { recursive: true, force: true }); } catch { /* 이미 없다 */ }
}

/** 정리를 언제 걸지 센다 — 조각을 `everyBytes` 쓸 때마다 한 번, 그리고 렌더가 끝났을 때 쓴 것이 있으면 한 번. 프로젝트마다 한 줄로 선다. */
export class SegmentPruneBook {
  private readonly written = new Map<string, number>();
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    private readonly everyBytes: number = RENDER_SEGMENT_PRUNE_EVERY_BYTES,
    private readonly limits: SegmentPruneLimits = {},
    private readonly platform: PlatformName = process.platform,
  ) {}

  noteWrite(projectPath: string, bytes: number): void {
    const root = segmentRootFor(projectPath);
    const slot = pathKey(root, this.platform);
    const total = (this.written.get(slot) ?? 0) + bytes;
    this.written.set(slot, total);
    if (total >= this.everyBytes) void this.run(root);
  }

  /** 렌더 하나가 끝났다 — 그 사이 쓴 조각이 있으면 정리한다. */
  flush(projectPath: string): Promise<void> {
    const root = segmentRootFor(projectPath);
    const slot = pathKey(root, this.platform);
    return (this.written.get(slot) ?? 0) > 0 ? this.run(root) : this.running.get(slot) ?? Promise.resolve();
  }

  private run(root: string): Promise<void> {
    const slot = pathKey(root, this.platform);
    this.written.set(slot, 0);
    const next = (this.running.get(slot) ?? Promise.resolve()).then(() => pruneSegments(root, this.limits)).then(() => undefined, () => undefined);
    this.running.set(slot, next);
    return next;
  }
}

export const segmentPruneBook = new SegmentPruneBook();
