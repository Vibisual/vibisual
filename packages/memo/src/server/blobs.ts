import fs from 'node:fs';
import path from 'node:path';
import { MEMO } from '../config.js';
import { MemoError } from './errors.js';
import type { MemoStorage } from './storage.js';

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';
/** 첨부 원본 바이트. JSON 밖 파일로 두어야 큰 영상도 통째로 메모리에 오르지 않고 구간으로 읽힌다. */
export class MemoBlobs {
  constructor(readonly disk: MemoStorage) {}
  private pending(root: string, uploadId: string, kind: 'part' | 'thumb'): string { return this.disk.path(root, `uploads/${uploadId}.${kind}`); }
  original(root: string, assetId: string, file: string): string { return this.disk.path(root, `blobs/${assetId}/${file}`); }
  thumb(root: string, assetId: string): string { return this.disk.path(root, `blobs/${assetId}/thumb.webp`); }
  /** 조각을 자리(offset)가 맞을 때만 잇는다. 이미 받은 조각의 재전송은 그대로 받은 것으로 친다. */
  async append(root: string, uploadId: string, offset: number, bytes: Buffer): Promise<number> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new MemoError('invalid-request');
    if (bytes.length === 0) throw new MemoError('attachment-empty');
    const file = this.pending(root, uploadId, 'part');
    if (offset === 0) this.sweep(root);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const handle = await fs.promises.open(file, 'a');
    try {
      const { size } = await handle.stat();
      if (offset + bytes.length <= size) return size;
      if (offset !== size) throw new MemoError('upload-out-of-sync', 409, { received: size });
      if (size + bytes.length > MEMO.attachmentMax) throw new MemoError('attachment-too-large', 413);
      await handle.write(bytes);
      return size + bytes.length;
    } finally { await handle.close(); }
  }
  async putThumb(root: string, uploadId: string, bytes: Buffer): Promise<void> {
    if (bytes.length === 0 || bytes.length > MEMO.thumbMax) throw new MemoError('invalid-request');
    const file = this.pending(root, uploadId, 'thumb');
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, bytes);
  }
  async discard(root: string, uploadId: string): Promise<void> {
    for (const kind of ['part', 'thumb'] as const) await fs.promises.rm(this.pending(root, uploadId, kind), { force: true });
  }
  /** 다 올라온 조각을 첨부 자리로 옮긴다. 이미 옮겨진 같은 첨부면 그대로 둔다(확정 재시도). */
  claim(root: string, uploadId: string, assetId: string, file: string, size: number): { thumb: boolean } {
    const target = this.original(root, assetId, file); const part = this.pending(root, uploadId, 'part');
    const sized = (candidate: string): boolean => {
      try { return fs.statSync(candidate).size === size; } catch (error) { if (missing(error)) return false; throw error; }
    };
    if (!sized(target)) {
      if (!sized(part)) throw new MemoError('upload-incomplete', 409);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(part, target);
    }
    const preview = this.pending(root, uploadId, 'thumb'); const thumb = this.thumb(root, assetId);
    if (fs.existsSync(preview)) fs.renameSync(preview, thumb);
    return { thumb: fs.existsSync(thumb) };
  }
  /** base64 로 저장된 옛 첨부를 파일로 옮긴다. 임시 파일에 쓰고 바꿔 반쯤 쓰인 원본이 남지 않게 한다. */
  write(root: string, assetId: string, file: string, bytes: Buffer): void {
    const target = this.original(root, assetId, file); const temporary = this.disk.path(root, `blobs/${assetId}/${file}.tmp`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, target);
  }
  /** 확정되지 않고 버려진 조각 파일을 치운다. 실패해도 올리기를 막지 않는다. */
  private sweep(root: string): void {
    const dir = this.disk.path(root, 'uploads'); const before = Date.now() - MEMO.uploadStaleMs;
    void fs.promises.readdir(dir).then(async names => {
      for (const name of names) {
        const file = path.join(dir, name);
        if ((await fs.promises.stat(file)).mtimeMs < before) await fs.promises.rm(file, { force: true });
      }
    }).catch(() => undefined);
  }
}
