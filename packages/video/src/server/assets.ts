import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isPathWithin, type PlatformName } from '@vibisual/shared';
import type { VideoAsset } from '../types.js';
import { VIDEO_TRANSFER_MAX_BYTES } from '../constants.js';
import { embedModelResources, modelAnimationSeconds } from './modelAsset.js';

/** §5.13 (AA) 42-11 — 일꾼이 올리기 전에 같은 값으로 미리 알린다(정본은 순수 층 상수 하나). */
export const VIDEO_UPLOAD_LIMIT = VIDEO_TRANSFER_MAX_BYTES;
const EXTENSIONS: Readonly<Record<string, VideoAsset['kind']>> = {
  '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.m4v': 'video',
  '.mp3': 'audio', '.wav': 'audio', '.ogg': 'audio', '.m4a': 'audio', '.flac': 'audio', '.aac': 'audio',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.avif': 'image',
  '.svg': 'image', '.glb': 'model', '.gltf': 'model', '.vibi3d': 'model', '.vibimage': 'image',
};

/** Both lexical and real paths must stay in the project (including Windows junctions). */
export function resolveVideoAsset(root: string, relative: string, platform: PlatformName = process.platform): string {
  const base = fs.realpathSync(root);
  const file = path.resolve(base, relative);
  if (!isPathWithin(file, base, platform)) throw new Error('asset-outside-project');
  const real = fs.realpathSync(file);
  if (!isPathWithin(real, base, platform) || !fs.statSync(real).isFile()) throw new Error('asset-outside-project');
  return real;
}

/**
 * §5.13 (Y) 40-1 — `resolveVideoAsset` 과 같은 규칙(글자 경로도 실제 경로도 프로젝트 안 · 파일만)을 **비동기**로. 서버가 창의 메인
 * 스레드와 한 몸이라(§3.7) 미디어처럼 자주 묻는 길에서는 동기 파일 시스템을 돌지 않는다.
 */
export async function resolveVideoAssetAsync(root: string, relative: string, platform: PlatformName = process.platform): Promise<string> {
  const base = await fs.promises.realpath(root);
  const file = path.resolve(base, relative);
  if (!isPathWithin(file, base, platform)) throw new Error('asset-outside-project');
  const real = await fs.promises.realpath(file);
  if (!isPathWithin(real, base, platform) || !(await fs.promises.stat(real)).isFile()) throw new Error('asset-outside-project');
  return real;
}

/**
 * §5.13 (G) — 프로젝트 안 파일을 소재 자리로 복사한다 — 첨부(`.vibisual/attachments/<세션>/…`)는 보존 정책(§3.2.3)이 지울 수 있어 원본을 가리키지 않는다.
 * 프로젝트 밖은 받지 않는다(`realpath` 까지 — 정션·심볼릭 링크로 밖을 가리키는 것도 막는다).
 */
export function importProjectAsset(root: string, input: string, platform: PlatformName = process.platform): VideoAsset {
  const base = fs.realpathSync(root);
  const raw = input.trim();
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(base, raw);
  // Errors are codes the studio translates (§5.13 (R-10)); agents read the same codes.
  if (!isPathWithin(abs, base, platform)) throw new Error('asset-outside-project');
  let real: string;
  try { real = fs.realpathSync(abs); } catch { throw new Error('asset-not-found'); }
  if (!isPathWithin(real, base, platform)) throw new Error('asset-outside-project');
  const st = fs.statSync(real);
  if (!st.isFile()) throw new Error('asset-not-found');
  if (st.size === 0 || st.size > VIDEO_UPLOAD_LIMIT) throw new Error('media-size-invalid');
  const ext = path.extname(real).toLowerCase();
  let bytes: Buffer = fs.readFileSync(real);
  if (ext === '.gltf' || ext === '.glb') {
    let total = bytes.length;
    // Companions resolve inside the model's own folder (embedModelResources refuses '..'), and once only.
    bytes = embedModelResources(bytes, ext, (relative) => {
      const dependency = resolveVideoAsset(base, path.relative(base, path.resolve(path.dirname(real), relative)), platform);
      const size = fs.statSync(dependency).size;
      total += size;
      if (total > VIDEO_UPLOAD_LIMIT) throw new Error('media-size-invalid');
      return fs.readFileSync(dependency);
    });
  }
  return publishVideoAsset(root, path.basename(real), bytes, platform);
}

/** Uploaded bytes: a glTF must already carry its companions (an upload has no folder to resolve them in). */
export function saveVideoAsset(root: string, name: unknown, bytes: Buffer, platform: PlatformName = process.platform): VideoAsset {
  if (typeof name !== 'string') throw new Error('media-name-required');
  const ext = path.extname(name).toLowerCase();
  if (ext === '.gltf' || ext === '.glb') {
    bytes = embedModelResources(bytes, ext, () => { throw new Error('model-companion-missing'); });
  }
  return publishVideoAsset(root, name, bytes, platform);
}

/** A unique immutable file is published only after its bytes have been written. */
function publishVideoAsset(root: string, name: string, bytes: Buffer, platform: PlatformName): VideoAsset {
  const ext = path.extname(name).toLowerCase();
  const kind = EXTENSIONS[ext];
  if (!kind) throw new Error('unsupported-media-format');
  if (bytes.length === 0 || bytes.length > VIDEO_UPLOAD_LIMIT) throw new Error('media-size-invalid');
  const base = fs.realpathSync(root);
  let directory = base;
  for (const part of ['.vibisual', 'video', 'assets']) {
    const next = path.join(directory, part);
    if (!fs.existsSync(next)) fs.mkdirSync(next);
    directory = fs.realpathSync(next);
    if (!isPathWithin(directory, base, platform)) throw new Error('asset-outside-project');
  }
  const id = `asset-${randomUUID()}`;
  const relative = `.vibisual/video/assets/${id}${ext}`;
  fs.writeFileSync(path.join(directory, `${id}${ext}`), bytes, { flag: 'wx' });
  // A model with animation gets its real length, so a drawer import plays the whole clip instead of a default span.
  const duration = kind === 'model' ? modelAnimationSeconds(bytes, ext) : undefined;
  return { id, kind, source: { kind: 'file', path: relative }, ...(duration ? { duration } : {}) };
}
