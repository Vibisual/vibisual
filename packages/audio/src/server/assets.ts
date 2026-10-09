import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ADTS, FLAC, MP3, MP4, OGG, WAVE, WEBM, BufferSource, FilePathSource, Input } from 'mediabunny';
import type { AudioAsset } from '../types.js';
import { AUDIO_LIMITS } from '../constants.js';
import { AudioServiceError, badRequest, object, safeId } from './errors.js';
import { AudioStorage } from './storage.js';

export const AUDIO_UPLOAD_MAX_BYTES = 128 * 1024 * 1024;
const EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.weba', '.webm']);
const ASSET_KEYS: readonly (keyof AudioAsset)[] = ['id', 'path', 'name', 'duration', 'sampleRate', 'channels'];
type AssetManifest = Record<string, AudioAsset>;

function assetName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) badRequest('An audio file name is required.');
  const name = raw.replace(/\\/g, '/').split('/').pop()?.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  if (!name || name === '.' || name === '..' || name.length > 240) badRequest('Invalid audio file name.');
  if (!EXTENSIONS.has(path.extname(name).toLowerCase())) {
    throw new AudioServiceError(422, 'unsupported-audio', 'This audio file extension is not supported.');
  }
  return name;
}

function manifest(raw: unknown): AssetManifest {
  if (!object(raw)) throw new Error('Invalid audio asset manifest.');
  const out: AssetManifest = Object.create(null) as AssetManifest;
  for (const [id, value] of Object.entries(raw)) {
    if (!safeId(id) || !object(value) || value.id !== id || typeof value.path !== 'string'
      || !value.path.startsWith('.vibisual/audio/assets/') || typeof value.name !== 'string'
      || Object.keys(value).some((key) => !ASSET_KEYS.includes(key as keyof AudioAsset))
      || typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration <= 0
      || typeof value.sampleRate !== 'number' || !Number.isInteger(value.sampleRate)
      || value.sampleRate < AUDIO_LIMITS.minSampleRate || value.sampleRate > AUDIO_LIMITS.maxSampleRate
      || (value.channels !== 1 && value.channels !== 2)) throw new Error('Invalid audio asset metadata.');
    out[id] = value as unknown as AudioAsset;
  }
  return out;
}

async function probe(source: BufferSource | FilePathSource): Promise<Pick<AudioAsset, 'duration' | 'sampleRate' | 'channels'>> {
  // No playlists: HLS can follow other files/URLs beyond the one vetted source.
  const input = new Input({ formats: [WAVE, MP3, FLAC, MP4, OGG, ADTS, WEBM], source });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('No audio track.');
    const [duration, sampleRate, channels] = await Promise.all([
      track.computeDuration(), track.getSampleRate(), track.getNumberOfChannels(),
    ]);
    if (!Number.isFinite(duration) || duration <= 0 || duration > AUDIO_LIMITS.maxTimelineSeconds
      || !Number.isInteger(sampleRate) || sampleRate < AUDIO_LIMITS.minSampleRate || sampleRate > AUDIO_LIMITS.maxSampleRate
      || (channels !== 1 && channels !== 2)) throw new Error('Only finite mono/stereo audio is supported.');
    return { duration, sampleRate, channels };
  } catch {
    throw new AudioServiceError(422, 'unsupported-audio', 'The file could not be measured as supported mono/stereo audio.');
  } finally {
    input.dispose();
  }
}

async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export class AudioAssets {
  constructor(private readonly storage: AudioStorage) {}

  private read(root: string): AssetManifest {
    return this.storage.read(root, 'assets.json', manifest) ?? Object.create(null) as AssetManifest;
  }

  private register(root: string, digest: string, name: string, measured: Pick<AudioAsset, 'duration' | 'sampleRate' | 'channels'>,
    write: (file: string) => void): AudioAsset {
    const assets = this.read(root);
    const id = `asset-${digest.slice(0, 40)}`;
    const existing = assets[id];
    if (existing) {
      if (existing.duration !== measured.duration || existing.sampleRate !== measured.sampleRate || existing.channels !== measured.channels) {
        throw new AudioServiceError(500, 'storage-corrupt', 'Saved metadata differs from the imported source bytes.');
      }
      const file = this.storage.path(root, existing.path.slice('.vibisual/audio/'.length));
      if (!fs.existsSync(file)) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // Restore a missing source only when the newly imported bytes have its content id.
        write(file);
      }
      this.resolve(root, existing.path);
      return existing;
    }
    const extension = path.extname(name).toLowerCase();
    const relative = `assets/${id}${extension}`;
    const file = this.storage.path(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) write(file);
    else if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== digest) {
      throw new AudioServiceError(500, 'storage-corrupt', 'An interrupted asset import left different bytes at this asset path.');
    }
    // An interrupted prior import can leave the immutable content file before its manifest.
    const asset: AudioAsset = { id, path: `.vibisual/audio/${relative}`, name, ...measured };
    assets[id] = asset;
    this.storage.write(root, 'assets.json', assets, manifest);
    return asset;
  }

  async upload(root: string, nameRaw: unknown, bytes: Buffer): Promise<AudioAsset> {
    const name = assetName(nameRaw);
    if (bytes.length === 0) badRequest('An audio file body is required.');
    if (bytes.length > AUDIO_UPLOAD_MAX_BYTES) throw new AudioServiceError(413, 'asset-too-large', 'Audio imports are limited to 128 MiB.');
    const measured = await probe(new BufferSource(bytes));
    const digest = createHash('sha256').update(bytes).digest('hex');
    return this.register(root, digest, name, measured, (file) => fs.writeFileSync(file, bytes, { flag: 'wx' }));
  }

  async import(root: string, rawPath: unknown): Promise<AudioAsset> {
    if (typeof rawPath !== 'string' || rawPath.length > 4096 || /^[\\/]|^[A-Za-z]:/.test(rawPath)) {
      badRequest('Import requires a project-relative file path.');
    }
    const source = this.storage.host.resolveWorkspacePath(root, rawPath);
    if (!source) throw new AudioServiceError(403, 'invalid-path', 'The audio source is outside this project.');
    const name = assetName(source.rel);
    let size: number;
    try {
      const stat = fs.statSync(source.abs);
      if (!stat.isFile()) throw new Error('not a file');
      size = stat.size;
    } catch { throw new AudioServiceError(404, 'unknown-asset', 'The audio source file does not exist.'); }
    if (size > AUDIO_UPLOAD_MAX_BYTES) throw new AudioServiceError(413, 'asset-too-large', 'Audio imports are limited to 128 MiB.');
    const temporary = this.storage.path(root, `assets/import-${randomUUID()}.tmp`);
    fs.mkdirSync(path.dirname(temporary), { recursive: true });
    try {
      await fs.promises.copyFile(source.abs, temporary, fs.constants.COPYFILE_EXCL);
      if (fs.statSync(temporary).size > AUDIO_UPLOAD_MAX_BYTES) throw new AudioServiceError(413, 'asset-too-large', 'Audio imports are limited to 128 MiB.');
      const measured = await probe(new FilePathSource(temporary));
      const digest = await fileHash(temporary);
      return this.register(root, digest, name, measured, (file) => fs.copyFileSync(temporary, file, fs.constants.COPYFILE_EXCL));
    } finally {
      // Only remove the uniquely generated staging file, never the original source.
      try { fs.unlinkSync(temporary); } catch { /* Nothing was staged, or cleanup already completed. */ }
    }
  }

  validate(root: string, docAssets: Readonly<Record<string, AudioAsset>>): void {
    const registered = this.read(root);
    for (const [id, value] of Object.entries(docAssets)) {
      const known = registered[id];
      if (!known || Object.keys(value).some((key) => !ASSET_KEYS.includes(key as keyof AudioAsset))
        || ASSET_KEYS.some((key) => known[key] !== value[key])) {
        throw new AudioServiceError(400, 'invalid-asset', 'Import/register source assets before referencing them in a document.');
      }
      this.resolve(root, known.path);
    }
  }

  resolve(root: string, rawPath: unknown): string {
    if (typeof rawPath !== 'string') badRequest('An asset path is required.');
    const asset = Object.values(this.read(root)).find((entry) => entry.path === rawPath);
    if (!asset) throw new AudioServiceError(404, 'unknown-asset', 'The audio asset is not registered in this project.');
    const file = this.storage.path(root, asset.path.slice('.vibisual/audio/'.length));
    try { if (fs.statSync(file).isFile()) return file; } catch { /* Report a missing asset below. */ }
    throw new AudioServiceError(404, 'unknown-asset', 'The imported audio asset file is missing.');
  }
}
