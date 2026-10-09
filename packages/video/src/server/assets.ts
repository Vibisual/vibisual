import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isPathWithin, type PlatformName } from '@vibisual/shared';
import type { VideoAsset } from '../types.js';

export const VIDEO_UPLOAD_LIMIT = 128 * 1024 * 1024;
const EXTENSIONS: Readonly<Record<string, VideoAsset['kind']>> = {
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.m4v': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.flac': 'audio', '.aac': 'audio',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.avif': 'image',
};

/** Both lexical and real paths must stay in the project (including Windows junctions). */
export function resolveVideoAsset(root: string, relative: string, platform: PlatformName = process.platform): string {
  const base = fs.realpathSync(root);
  const file = path.resolve(base, relative);
  if (!isPathWithin(file, base, platform)) throw new Error('Asset is outside this project.');
  const real = fs.realpathSync(file);
  if (!isPathWithin(real, base, platform) || !fs.statSync(real).isFile()) throw new Error('Asset is outside this project.');
  return real;
}

/** A unique immutable file is published only after its bytes have been written. */
export function saveVideoAsset(root: string, name: unknown, bytes: Buffer, platform: PlatformName = process.platform): VideoAsset {
  if (typeof name !== 'string') throw new Error('A media filename is required.');
  const ext = path.extname(name).toLowerCase();
  const kind = EXTENSIONS[ext];
  if (!kind) throw new Error('Unsupported media format.');
  if (bytes.length === 0 || bytes.length > VIDEO_UPLOAD_LIMIT) throw new Error('Media files must be between 1 byte and 128 MiB.');
  const base = fs.realpathSync(root);
  let directory = base;
  for (const part of ['.vibisual', 'video', 'assets']) {
    const next = path.join(directory, part);
    if (!fs.existsSync(next)) fs.mkdirSync(next);
    directory = fs.realpathSync(next);
    if (!isPathWithin(directory, base, platform)) throw new Error('Asset directory is outside this project.');
  }
  const id = `asset-${randomUUID()}`;
  const relative = `.vibisual/video/assets/${id}${ext}`;
  fs.writeFileSync(path.join(directory, `${id}${ext}`), bytes, { flag: 'wx' });
  return { id, kind, source: { kind: 'file', path: relative } };
}
