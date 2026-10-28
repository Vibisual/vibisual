/**
 * §5.13 (V) 37-3 — 판 기록: 바퀴·저장점마다 문서와 컴포지션 코드를 `<project>/.vibisual/video/history/<docId>/` 에 남긴다
 * (판마다 `<revId>.json` 문서 + `<revId>.files.json` 경로 → 해시, 내용은 `blobs/<sha256>` 내용 주소 — 판끼리 같은 파일은 한 벌).
 * 코드도 남긴다 — 움직임이 코드에 있어(§5.13 (T)) 문서만 되돌리면 그림은 지금 코드로 남는다(판 비교도 그 판의 코드로 찍는다).
 * 자동 삭제는 없다((K)) — 사람이 판 하나씩 지우고, 다른 판이 쓰는 덩어리는 남는다.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isPathWithin } from '@vibisual/shared';

import {
  HISTORY_REQUEST_MAX_CHARS,
  VIDEO_HISTORY_DIR,
} from '../constants.js';
import { isSafeHistoryId } from '../history.js';
import type { HistoryEntry, HistoryIndex, PassRecord, PassReport, PassesFile } from '../history.js';
import type { VideoDoc } from '../types.js';
import { compositionFolderAbs, listCompositionWebFiles } from './composition.js';

/** 한 판에서 남길 컴포지션 파일 한 개의 상한 — 큰 그림·글꼴이 판마다 쌓이지 않게(넘으면 목록에서 빠지고 그 사실이 남는다). */
const SNAPSHOT_FILE_MAX_BYTES = 8 * 1024 * 1024;
/** 한 판에서 남길 컴포지션 파일 바이트 합 상한. */
const SNAPSHOT_TOTAL_MAX_BYTES = 64 * 1024 * 1024;

export interface HistoryHost {
  atomicWriteFile(filePath: string, data: string): void;
  warn(message: string): void;
}

export interface FilesManifest {
  readonly files: Readonly<Record<string, string>>;
  /** 상한 때문에 빠진 파일이 있었나. */
  readonly partial?: boolean;
}

let revSeq = 0;
function newRevId(): string {
  revSeq = (revSeq + 1) % 1_000_000;
  return `rev-${Date.now().toString(36)}-${revSeq.toString(36)}`;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** 바이너리를 원자적으로 쓴다(임시 → 이름 바꾸기). 이미 있으면(같은 내용 주소) 쓰지 않는다. */
function writeBlobOnce(file: string, bytes: Buffer): void {
  if (fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export class VideoHistoryStore {
  constructor(private readonly host: () => HistoryHost) {}

  dir(projectPath: string, docId: string): string {
    return path.join(projectPath, '.vibisual', ...VIDEO_HISTORY_DIR.split('/'), docId);
  }

  // ─── 판 ───

  list(projectPath: string, docId: string): HistoryEntry[] {
    const index = readJson<HistoryIndex>(path.join(this.dir(projectPath, docId), 'index.json'));
    return Array.isArray(index?.entries) ? [...index.entries] : [];
  }

  private writeIndex(projectPath: string, docId: string, entries: readonly HistoryEntry[]): void {
    const dir = this.dir(projectPath, docId);
    fs.mkdirSync(dir, { recursive: true });
    const index: HistoryIndex = { schemaVersion: 1, entries };
    this.host().atomicWriteFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
  }

  readSnapshot(projectPath: string, docId: string, revId: string): VideoDoc | null {
    if (!isSafeHistoryId(revId)) return null;
    return readJson<VideoDoc>(path.join(this.dir(projectPath, docId), `${revId}.json`));
  }

  readManifest(projectPath: string, docId: string, revId: string): FilesManifest | null {
    if (!isSafeHistoryId(revId)) return null;
    return readJson<FilesManifest>(path.join(this.dir(projectPath, docId), `${revId}.files.json`));
  }

  /** 내용 해시로 덩어리 경로. */
  blobPath(projectPath: string, docId: string, sha: string): string | null {
    if (!/^[a-f0-9]{64}$/.test(sha)) return null;
    return path.join(this.dir(projectPath, docId), 'blobs', sha);
  }

  /** 그 문서가 가리키는 컴포지션 폴더의 웹 파일을 내용 주소로 남기고 목록을 돌려준다. */
  private snapshotFiles(projectPath: string, doc: VideoDoc): FilesManifest {
    const files: Record<string, string> = {};
    let total = 0;
    let partial = false;
    const seenFolders = new Set<string>();
    for (const asset of Object.values(doc.assets)) {
      if (asset.kind !== 'composition' || asset.source.kind !== 'file') continue;
      const folder = compositionFolderAbs(projectPath, asset.source.path);
      if (!folder || seenFolders.has(folder)) continue;
      seenFolders.add(folder);
      const folderRel = path.posix.dirname(asset.source.path.replace(/\\/g, '/'));
      for (const rel of listCompositionWebFiles(folder)) {
        const abs = path.join(folder, rel);
        let bytes: Buffer;
        try {
          const st = fs.statSync(abs);
          if (st.size > SNAPSHOT_FILE_MAX_BYTES || total + st.size > SNAPSHOT_TOTAL_MAX_BYTES) { partial = true; continue; }
          bytes = fs.readFileSync(abs);
          total += st.size;
        } catch {
          continue;
        }
        const sha = crypto.createHash('sha256').update(bytes).digest('hex');
        const blob = this.blobPath(projectPath, doc.id, sha);
        if (!blob) continue;
        try {
          writeBlobOnce(blob, bytes);
          files[`${folderRel}/${rel}`] = sha;
        } catch (err) {
          partial = true;
          this.host().warn(`[video] 판 기록 파일을 남기지 못했습니다(${rel}): ${String(err)}`);
        }
      }
    }
    return partial ? { files, partial } : { files };
  }

  /** 판 하나를 남긴다 — 문서·컴포지션 파일·목록 줄. */
  record(projectPath: string, doc: VideoDoc, entry: Omit<HistoryEntry, 'id' | 'createdAt' | 'docVersion'>): HistoryEntry {
    const dir = this.dir(projectPath, doc.id);
    fs.mkdirSync(dir, { recursive: true });
    const id = newRevId();
    const full: HistoryEntry = {
      ...entry,
      ...(entry.request !== undefined ? { request: entry.request.slice(0, HISTORY_REQUEST_MAX_CHARS) } : {}),
      id,
      createdAt: Date.now(),
      docVersion: doc.version,
    };
    this.host().atomicWriteFile(path.join(dir, `${id}.json`), JSON.stringify(doc, null, 2));
    const manifest = this.snapshotFiles(projectPath, doc);
    this.host().atomicWriteFile(path.join(dir, `${id}.files.json`), JSON.stringify(manifest));
    this.writeIndex(projectPath, doc.id, [...this.list(projectPath, doc.id), full]);
    return full;
  }

  /** 판 한 줄을 고친다(정지 화면이 구워졌다·렌더 표시). */
  update(projectPath: string, docId: string, revId: string, patch: Partial<Pick<HistoryEntry, 'hasStill' | 'render' | 'summary' | 'label'>>): HistoryEntry | null {
    const entries = this.list(projectPath, docId);
    const at = entries.findIndex((e) => e.id === revId);
    const prev = entries[at];
    if (at < 0 || !prev) return null;
    const next = { ...prev, ...patch };
    entries[at] = next;
    this.writeIndex(projectPath, docId, entries);
    return next;
  }

  /** 사용자가 목록에서 판 하나를 지운다(그 판의 문서·목록·정지 화면). */
  remove(projectPath: string, docId: string, revId: string): boolean {
    if (!isSafeHistoryId(revId)) return false;
    const entries = this.list(projectPath, docId);
    if (!entries.some((e) => e.id === revId)) return false;
    this.writeIndex(projectPath, docId, entries.filter((e) => e.id !== revId));
    const dir = this.dir(projectPath, docId);
    for (const name of [`${revId}.json`, `${revId}.files.json`, `${revId}.png`]) {
      try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* 남아도 목록에는 없다 */ }
    }
    return true;
  }

  /** 정지 화면(PNG data URL)을 판 옆에 쓴다. */
  saveStill(projectPath: string, docId: string, revId: string, dataUrl: string, name = `${revId}.png`): string | null {
    const comma = dataUrl.indexOf(',');
    if (!isSafeHistoryId(revId) || !dataUrl.startsWith('data:image/png;base64,') || comma < 0) return null;
    const file = path.join(this.dir(projectPath, docId), name);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(dataUrl.slice(comma + 1), 'base64'));
      return file;
    } catch (err) {
      this.host().warn(`[video] 판 정지 화면을 쓰지 못했습니다: ${String(err)}`);
      return null;
    }
  }

  stillPath(projectPath: string, docId: string, name: string): string | null {
    if (!/^[A-Za-z0-9_.-]{1,120}\.png$/.test(name)) return null;
    const file = path.join(this.dir(projectPath, docId), name);
    return fs.existsSync(file) ? file : null;
  }

  /**
   * 그 판의 컴포지션 파일을 작업 폴더에 되돌려 쓴다 — 내용이 다른 것만. 지금 있는데 그 판에 없던 파일은 지우지 않는다
   * (사람이 따로 둔 파일을 지우는 되돌리기는 없다). 돌려준 수는 다시 쓴 파일 수.
   */
  restoreFiles(projectPath: string, docId: string, revId: string): number {
    const manifest = this.readManifest(projectPath, docId, revId);
    if (!manifest) return 0;
    const root = path.resolve(projectPath);
    let written = 0;
    for (const [rel, sha] of Object.entries(manifest.files)) {
      const target = path.resolve(root, rel);
      if (!isPathWithin(target, root, process.platform)) continue;
      const blob = this.blobPath(projectPath, docId, sha);
      if (!blob || !fs.existsSync(blob)) continue;
      try {
        if (fs.existsSync(target)) {
          const now = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
          if (now === sha) continue;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const bytes = fs.readFileSync(blob);
        const tmp = `${target}.${process.pid}.restore.tmp`;
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, target);
        written += 1;
      } catch (err) {
        this.host().warn(`[video] 판의 파일을 되돌리지 못했습니다(${rel}): ${String(err)}`);
      }
    }
    return written;
  }

  // ─── 바퀴 ───

  listPasses(projectPath: string, docId: string): PassRecord[] {
    const file = readJson<PassesFile>(path.join(this.dir(projectPath, docId), 'passes.json'));
    return Array.isArray(file?.passes) ? [...file.passes] : [];
  }

  private writePasses(projectPath: string, docId: string, passes: readonly PassRecord[]): void {
    const dir = this.dir(projectPath, docId);
    fs.mkdirSync(dir, { recursive: true });
    const file: PassesFile = { schemaVersion: 1, passes };
    this.host().atomicWriteFile(path.join(dir, 'passes.json'), JSON.stringify(file, null, 2));
  }

  findPass(projectPath: string, docId: string, passId: string): PassRecord | undefined {
    return this.listPasses(projectPath, docId).find((p) => p.id === passId);
  }

  /** 바퀴를 열거나(없으면) 고친다. */
  upsertPass(projectPath: string, docId: string, passId: string, build: (prev: PassRecord | undefined) => PassRecord): PassRecord {
    const passes = this.listPasses(projectPath, docId);
    const at = passes.findIndex((p) => p.id === passId);
    const next = build(at >= 0 ? passes[at] : undefined);
    if (at >= 0) passes[at] = next;
    else passes.push(next);
    this.writePasses(projectPath, docId, passes);
    return next;
  }

  /** 바퀴의 이름으로 들어온 판본을 적는다(패치 본문 `passId`). */
  notePatch(projectPath: string, docId: string, passId: string, version: number, focus: string | undefined, startVersion: number, startRev: string | undefined): PassRecord {
    return this.upsertPass(projectPath, docId, passId, (prev) => ({
      ...(prev ?? { id: passId, startedAt: Date.now(), startVersion, ...(startRev ? { startRev } : {}), status: 'open' as const, versions: [] }),
      versions: [...(prev?.versions ?? []), version].slice(-500),
      ...(focus ? { focus } : prev?.focus ? { focus: prev.focus } : {}),
      lastPatchAt: Date.now(),
    }));
  }

  /** 바퀴를 닫는다(끝 보고). */
  closePass(projectPath: string, docId: string, passId: string, report: PassReport, endRev: string | undefined, startVersion: number): PassRecord {
    return this.upsertPass(projectPath, docId, passId, (prev) => ({
      ...(prev ?? { id: passId, startedAt: Date.now(), startVersion, status: 'open' as const, versions: [] }),
      status: 'done',
      endedAt: Date.now(),
      ...(endRev ? { endRev } : {}),
      report,
    }));
  }
}
