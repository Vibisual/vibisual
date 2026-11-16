import fs from 'node:fs';
import { MEMO } from '../config.js';
import { mediaExtension, mediaMime } from '../media.js';
import type { MemoAttachment, MemoNote } from '../types.js';
import { MemoBlobs } from './blobs.js';
import { identifier, MemoError, object, text } from './errors.js';
import type { MemoStore } from './store.js';
import { attachmentData } from './validation.js';

interface AssetRecord extends MemoAttachment { file?: string; base64?: string }
export interface AssetFile { file: string; name: string; mime: string; size: number }
export function safeName(value: string): string {
  return value.replace(/[\\/\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '_').slice(0, 160) || 'attachment';
}
function record(raw: unknown): AssetRecord {
  const value: AssetRecord = attachmentData(raw);
  // 표지가 가리키는 파일 이름은 우리가 지은 모양만 받는다(표지를 고쳐 저장 영역 밖을 읽게 하지 못한다).
  if (value.file !== undefined && (typeof value.file !== 'string' || !/^original\.[a-z0-9]{1,8}$/.test(value.file))) throw new MemoError('storage-corrupt', 500);
  if (value.base64 !== undefined && typeof value.base64 !== 'string') throw new MemoError('storage-corrupt', 500);
  return value;
}
function measure(input: Record<string, unknown>): Pick<MemoAttachment, 'width' | 'height' | 'duration'> {
  const whole = (raw: unknown): number | undefined => Number.isSafeInteger(raw) && Number(raw) > 0 && Number(raw) <= 100_000 ? Number(raw) : undefined;
  const width = whole(input['width']); const height = whole(input['height']); const duration = input['duration'];
  return { ...(width && height ? { width, height } : {}), ...(typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? { duration } : {}) };
}
export class MemoAssets {
  readonly blobs: MemoBlobs;
  constructor(readonly store: MemoStore) { this.blobs = new MemoBlobs(store.disk); }
  /** 다 올라온 조각을 첨부로 확정한다. 판본 검사를 파일 옮기기보다 먼저 해, 충돌한 확정을 같은 요청으로 다시 보낼 수 있다. */
  add(root: string, id: unknown, raw: unknown): MemoNote {
    const input = object(raw);
    const note = this.store.get(root, id);
    const requestId = identifier(input['requestId'], 'req');
    if (note.requestId === requestId) return note;
    if (input['baseVersion'] !== note.version) throw new MemoError('version-conflict', 409);
    if (note.deletedAt !== null) throw new MemoError('note-in-trash', 409);
    const size = Number(input['size']); const name = text(input['name'], 512); const mime = text(input['mime'] ?? '', 160);
    if (!Number.isSafeInteger(size) || size <= 0) throw new MemoError('attachment-empty');
    if (size > MEMO.attachmentMax) throw new MemoError('attachment-too-large', 413);
    const file = `original.${mediaExtension(name, mime)}`;
    const asset: MemoAttachment = { id: `asset-${requestId.slice(4)}`, name, mime: mediaMime(name, mime), size, createdAt: Date.now(), ...measure(input) };
    if (this.blobs.claim(root, identifier(input['uploadId'], 'up'), asset.id, file, size).thumb) asset.thumb = true;
    this.store.disk.write(root, `assets/${asset.id}.json`, { ...asset, file });
    return this.store.commit(root, { ...note, attachments: [...note.attachments, asset], version: note.version + 1, updatedAt: Date.now() }, requestId);
  }
  /** 그 메모(또는 그 판본)가 가리키는 첨부만 파일 경로로 답한다. */
  locate(root: string, noteId: unknown, assetId: unknown, version?: unknown, variant?: 'thumb'): AssetFile {
    const id = identifier(assetId, 'asset');
    const note = version === undefined ? this.store.get(root, noteId) : this.store.version(root, noteId, version);
    if (!note.attachments.some(asset => asset.id === id)) throw new MemoError('attachment-unavailable', 404);
    const stored = this.store.disk.read(root, `assets/${id}.json`, record);
    if (!stored) throw new MemoError('attachment-unavailable', 404);
    const found = variant === 'thumb'
      ? (stored.thumb ? this.blobs.thumb(root, id) : null)
      : this.blobs.original(root, id, stored.file ?? this.migrate(root, stored));
    if (!found || !fs.existsSync(found)) throw new MemoError('attachment-unavailable', 404);
    return { file: found, name: stored.name, mime: stored.mime, size: variant === 'thumb' ? fs.statSync(found).size : stored.size };
  }
  read(root: string, noteId: unknown, assetId: unknown, version?: unknown): { bytes: Buffer; name: string; mime: string } {
    const found = this.locate(root, noteId, assetId, version);
    return { bytes: fs.readFileSync(found.file), name: found.name, mime: found.mime };
  }
  private migrate(root: string, stored: AssetRecord): string {
    const { base64, ...meta } = stored;
    const bytes = Buffer.from(base64 ?? '', 'base64');
    if (base64 === undefined || bytes.length !== stored.size) throw new MemoError('storage-corrupt', 500);
    const file = `original.${mediaExtension(stored.name, stored.mime)}`;
    this.blobs.write(root, stored.id, file, bytes);
    this.store.disk.write(root, `assets/${stored.id}.json`, { ...meta, file });
    return file;
  }
}
