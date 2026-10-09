import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveVideoAsset, saveVideoAsset, VIDEO_UPLOAD_LIMIT } from './assets.js';

const directories: string[] = [];
function temporary(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibistudio-assets-')); directories.push(dir); return dir; }
afterEach(() => { for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe('project media import', () => {
  it('stores immutable bytes under the project and ignores filename directories', () => {
    const root = temporary();
    const asset = saveVideoAsset(root, '../../outside.PNG', Buffer.from('test-image'));
    expect(asset.kind).toBe('image');
    expect(asset.source.kind).toBe('file');
    if (asset.source.kind !== 'file') throw new Error('Expected file');
    expect(asset.source.path).toMatch(/^\.vibisual\/video\/assets\/asset-[\w-]+\.png$/);
    expect(fs.readFileSync(resolveVideoAsset(root, asset.source.path), 'utf8')).toBe('test-image');
  });
  it('rejects empty, oversized, and executable imports before writing', () => {
    const root = temporary();
    expect(() => saveVideoAsset(root, 'x.mp4', Buffer.alloc(0))).toThrow();
    expect(() => saveVideoAsset(root, 'x.js', Buffer.from('code'))).toThrow();
    expect(() => saveVideoAsset(root, 'x.mp4', { length: VIDEO_UPLOAD_LIMIT + 1 } as Buffer)).toThrow();
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it('rejects traversal and directory reads', () => {
    const root = temporary(); const outside = temporary();
    const file = path.join(outside, 'private.mp4'); fs.writeFileSync(file, 'private');
    expect(() => resolveVideoAsset(root, file)).toThrow();
    expect(() => resolveVideoAsset(root, '../' + path.basename(outside) + '/private.mp4')).toThrow();
    expect(() => resolveVideoAsset(root, '.')).toThrow();
  });
  it('rejects a junction or symlink escaping the project on both read and write', () => {
    const root = temporary(); const outside = temporary();
    fs.writeFileSync(path.join(outside, 'private.mp4'), 'private');
    fs.symlinkSync(outside, path.join(root, '.vibisual'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => resolveVideoAsset(root, '.vibisual/private.mp4')).toThrow();
    expect(() => saveVideoAsset(root, 'file.mp4', Buffer.from('video'))).toThrow();
    expect(fs.readdirSync(outside)).toEqual(['private.mp4']);
  });
});
