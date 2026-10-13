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

/**
 * §5.13 (G) — 프로젝트 안의 파일(절대 경로 또는 루트 기준 상대 경로)을 영상 소재 자리로 **복사**한다.
 *
 * 에이전트에게 사용자가 첨부한 그림은 `.vibisual/attachments/<세션>/…` 에 있고, 그 폴더는 보존 정책(§3.2.3)이 정리할 수
 * 있다. 문서가 첨부 원본을 가리키면 언젠가 소재가 사라지므로 복사본을 소재로 삼는다. 프로젝트 밖 파일은 받지 않는다
 * (`realpath` 까지 확인 — 정션·심볼릭 링크로 밖을 가리키는 것도 막는다).
 */
export function importProjectAsset(root: string, input: string, platform: PlatformName = process.platform): VideoAsset {
  const base = fs.realpathSync(root);
  const raw = input.trim();
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(base, raw);
  if (!isPathWithin(abs, base, platform)) throw new Error('The file must be inside this project.');
  let real: string;
  try { real = fs.realpathSync(abs); } catch { throw new Error('The file does not exist.'); }
  if (!isPathWithin(real, base, platform)) throw new Error('The file must be inside this project.');
  const st = fs.statSync(real);
  if (!st.isFile()) throw new Error('The path is not a file.');
  if (st.size === 0 || st.size > VIDEO_UPLOAD_LIMIT) throw new Error('Media files must be between 1 byte and 128 MiB.');
  return saveVideoAsset(root, path.basename(real), fs.readFileSync(real), platform);
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
