import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { embedModelResources, modelAnimationSeconds } from './modelAsset.js';
import { importProjectAsset, resolveVideoAsset, saveVideoAsset } from './assets.js';

const roots: string[] = [];
function root(): string { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'video-model-')); roots.push(value); return value; }
afterEach(() => roots.splice(0).forEach(value => fs.rmSync(value, { recursive: true, force: true })));
describe('immutable model assets', () => {
  it('embeds a buffer and texture before publishing, even after source files change', () => {
    const project = root();
    fs.writeFileSync(path.join(project, 'mesh.bin'), Buffer.from([1, 2, 3, 4]));
    fs.writeFileSync(path.join(project, 'label.png'), Buffer.from('texture'));
    fs.writeFileSync(path.join(project, 'product.gltf'), JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin', byteLength: 4 }], images: [{ uri: 'label.png' }] }));
    const saved = importProjectAsset(project, 'product.gltf');
    if (saved.source.kind !== 'file') throw new Error('Expected file');
    fs.writeFileSync(path.join(project, 'label.png'), 'changed');
    const payload = JSON.parse(fs.readFileSync(resolveVideoAsset(project, saved.source.path), 'utf8'));
    expect(saved.kind).toBe('model');
    expect(payload.buffers[0].uri).toBe('data:application/octet-stream;base64,AQIDBA==');
    expect(payload.images[0].uri).toBe('data:image/png;base64,dGV4dHVyZQ==');
  });
  it('rejects external, missing, and project-escaping companions without publishing an asset', () => {
    const project = root(); const outside = root();
    fs.writeFileSync(path.join(outside, 'secret.bin'), 'private');
    for (const uri of ['https://example.test/texture.png', 'missing.bin', path.relative(project, path.join(outside, 'secret.bin'))]) {
      fs.writeFileSync(path.join(project, 'product.gltf'), JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri }] }));
      expect(() => importProjectAsset(project, 'product.gltf')).toThrow();
    }
    expect(fs.existsSync(path.join(project, '.vibisual/video/assets'))).toBe(false);
    expect(() => saveVideoAsset(project, 'product.gltf', Buffer.from('{"asset":{"version":"2.0"},"buffers":[{"uri":"mesh.bin"}]}'))).toThrow();
  });
  it('rewrites aligned GLB JSON without modifying the binary chunk', () => {
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'label.png' }] }));
    const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const header = Buffer.alloc(20); const tail = Buffer.from([4, 0, 0, 0, 66, 73, 78, 0, 1, 2, 3, 4]);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + tail.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    const result = embedModelResources(Buffer.concat([header, padded, tail]), '.glb', () => Buffer.from('texture'));
    expect(result.readUInt32LE(8)).toBe(result.length);
    expect(result.readUInt32LE(12) % 4).toBe(0);
    expect(result.subarray(20 + result.readUInt32LE(12))).toEqual(tail);
    expect(() => embedModelResources(result.subarray(0, result.length - 1), '.glb', () => Buffer.alloc(0))).toThrow();
  });
});

describe('model length for the timeline', () => {
  const gltf = (animations: unknown, accessors: unknown) => Buffer.from(JSON.stringify({ asset: { version: '2.0' }, animations, accessors }));
  it('reads the longest animation from glTF input accessors without decoding buffers', () => {
    const bytes = gltf([{ samplers: [{ input: 0 }, { input: 1 }] }, { samplers: [{ input: 2 }] }], [{ max: [1.5] }, { max: [4.25] }, { max: [2] }]);
    expect(modelAnimationSeconds(bytes, '.gltf')).toBe(4.25);
    expect(modelAnimationSeconds(gltf([], []), '.gltf')).toBeUndefined();
    expect(modelAnimationSeconds(Buffer.from('not json'), '.gltf')).toBeUndefined();
  });
  it('reads a .vibi3d source from its clip durations (or key times when a duration is missing)', () => {
    const source = (clips: unknown) => Buffer.from(JSON.stringify({ format: 'vibi3d', version: 1, scene: {}, clips }));
    expect(modelAnimationSeconds(source([{ duration: 2 }, { duration: 6 }]), '.vibi3d')).toBe(6);
    expect(modelAnimationSeconds(source([{ duration: -1, tracks: [{ times: [0, 1, 3.5] }] }]), '.vibi3d')).toBe(3.5);
    expect(modelAnimationSeconds(source([]), '.vibi3d')).toBeUndefined();
  });
  it('an imported model with animation carries its real length (a drawer import used to get the default span)', () => {
    const project = root();
    const asset = saveVideoAsset(project, 'spin.vibi3d', Buffer.from(JSON.stringify({ format: 'vibi3d', version: 1, scene: {}, clips: [{ duration: 7 }] })));
    expect(asset).toMatchObject({ kind: 'model', duration: 7 });
    const still = saveVideoAsset(project, 'still.vibi3d', Buffer.from(JSON.stringify({ format: 'vibi3d', version: 1, scene: {}, clips: [] })));
    expect(still.duration).toBeUndefined();
  });
  it('refuses with codes the studio translates', () => {
    const project = root();
    expect(() => saveVideoAsset(project, 'product.gltf', Buffer.from('{"asset":{"version":"2.0"},"buffers":[{"uri":"mesh.bin"}]}'))).toThrow('model-companion-missing');
    expect(() => saveVideoAsset(project, 'x.js', Buffer.from('code'))).toThrow('unsupported-media-format');
    expect(() => saveVideoAsset(project, 'x.mp4', Buffer.alloc(0))).toThrow('media-size-invalid');
    expect(() => embedModelResources(Buffer.from(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: '../secret.bin' }] })), '.gltf', () => Buffer.alloc(0))).toThrow('model-dependency-path');
    expect(() => embedModelResources(Buffer.from(JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: '.env' }] })), '.gltf', () => Buffer.alloc(0))).toThrow('model-dependency-type');
  });
});
