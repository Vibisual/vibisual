import path from 'node:path';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
/**
 * §5.13 (R-10) — what a glTF may pull in: its buffers and its texture images. Anything else (a `.env`, a script, a
 * document) is never embedded, whatever the uri says.
 */
const COMPANION_MIME: Readonly<Record<string, string>> = {
  '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2',
};
const DATA_MIME = new Set(['application/octet-stream', 'application/gltf-buffer', 'image/png', 'image/jpeg', 'image/webp', 'image/ktx2']);

/** Thrown with a code the studio translates (§5.13 (R-10)): model-invalid, model-format-unsupported, model-dependency-path, model-dependency-type. */
export class ModelDependencyError extends Error {}

/**
 * Longest clip in seconds, or undefined. glTF requires min/max on animation input accessors, so it is read from the JSON without decoding
 * buffers; a .vibi3d source stores each clip's duration.
 */
export function modelAnimationSeconds(bytes: Buffer, extension: string): number | undefined {
  try {
    let longest = 0;
    if (extension === '.vibi3d') {
      const source = JSON.parse(bytes.toString('utf8')) as { clips?: { duration?: unknown; tracks?: { times?: unknown }[] }[] };
      for (const clip of source.clips ?? []) {
        let seconds = typeof clip.duration === 'number' && Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 0;
        if (!seconds) for (const track of clip.tracks ?? []) if (Array.isArray(track.times)) seconds = Math.max(seconds, ...track.times.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)));
        longest = Math.max(longest, seconds);
      }
    } else if (extension === '.glb' || extension === '.gltf') {
      let json = bytes;
      if (extension === '.glb') {
        if (bytes.length < 20 || bytes.readUInt32LE(0) !== GLB_MAGIC || bytes.readUInt32LE(16) !== JSON_CHUNK) return undefined;
        json = bytes.subarray(20, 20 + bytes.readUInt32LE(12));
      }
      const data = JSON.parse(json.toString('utf8').trim()) as { animations?: { samplers?: { input?: unknown }[] }[]; accessors?: { max?: unknown[] }[] };
      for (const animation of data.animations ?? []) {
        for (const sampler of animation.samplers ?? []) {
          const max = typeof sampler.input === 'number' ? data.accessors?.[sampler.input]?.max?.[0] : undefined;
          if (typeof max === 'number' && Number.isFinite(max)) longest = Math.max(longest, max);
        }
      }
    }
    return longest > 0 ? Math.min(longest, 24 * 3600) : undefined;
  } catch { return undefined; }
}

/**
 * Companions must sit in the model's folder (or below) and be a buffer or an image; network, escaping paths, other file types and
 * foreign data URIs never become dependencies. `read` receives a path relative to the model's folder.
 */
export function embedModelResources(bytes: Buffer, extension: string, read: (relative: string) => Buffer): Buffer {
  const binary = extension === '.glb';
  let jsonBytes = bytes;
  let tail: Buffer = Buffer.alloc(0);
  if (binary) {
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== GLB_MAGIC || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length
      || bytes.readUInt32LE(16) !== JSON_CHUNK) throw new ModelDependencyError('model-invalid');
    const length = bytes.readUInt32LE(12);
    if (20 + length > bytes.length) throw new ModelDependencyError('model-invalid');
    jsonBytes = bytes.subarray(20, 20 + length);
    tail = bytes.subarray(20 + length);
  }
  const data = JSON.parse(jsonBytes.toString('utf8').trim()) as { asset?: { version?: string }; buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  if (data.asset?.version !== '2.0') throw new ModelDependencyError('model-format-unsupported');
  let changed = false;
  for (const entry of [...(data.buffers ?? []), ...(data.images ?? [])]) {
    if (entry.uri === undefined) continue;
    if (entry.uri.startsWith('data:')) {
      const mime = /^data:([^;,]+)/i.exec(entry.uri)?.[1]?.toLowerCase() ?? '';
      if (!DATA_MIME.has(mime)) throw new ModelDependencyError('model-dependency-type');
      continue;
    }
    let uri: string;
    try { uri = decodeURIComponent(entry.uri).replace(/\\/g, '/'); } catch { throw new ModelDependencyError('model-dependency-path'); }
    const parts = uri.split('/');
    if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('/') || uri.includes('\0') || /[?#]/.test(uri) || parts.includes('..') || parts.includes('')) {
      throw new ModelDependencyError('model-dependency-path');
    }
    const mime = COMPANION_MIME[path.extname(uri).toLowerCase()];
    if (!mime) throw new ModelDependencyError('model-dependency-type');
    entry.uri = `data:${mime};base64,${read(uri).toString('base64')}`;
    changed = true;
  }
  if (!changed) return bytes;
  const encoded = Buffer.from(JSON.stringify(data));
  if (!binary) return encoded;
  const padded = Buffer.concat([encoded, Buffer.alloc((4 - encoded.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(GLB_MAGIC, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + tail.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(JSON_CHUNK, 16);
  return Buffer.concat([header, padded, tail]);
}
