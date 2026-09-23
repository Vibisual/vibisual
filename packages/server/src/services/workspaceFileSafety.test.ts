import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkspaceFile, readWorkspaceImage, writeWorkspaceFile, writeWorkspaceImage } from './workspaceFile.js';

let root: string;
const fixedTime = new Date('2025-01-01T00:00:00.000Z');
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibisual-save-safety-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

function seed(rel: string, body: string | Buffer): string {
  const abs = path.join(root, rel);
  fs.writeFileSync(abs, body);
  fs.utimesSync(abs, fixedTime, fixedTime);
  return abs;
}

describe('workspace saves preserve external changes and original bytes on failure', () => {
  it('text rejects changed bytes even when the modification time and size are identical', () => {
    const abs = seed('a.txt', 'initial');
    const base = readWorkspaceFile(root, 'a.txt')!;
    seed('a.txt', 'changed');
    const result = writeWorkspaceFile(root, 'a.txt', 'my edit', 'lf', base.mtimeMs, undefined, false, base.revision);
    expect(result).toMatchObject({ ok: false, error: 'conflict' });
    expect(fs.readFileSync(abs, 'utf8')).toBe('changed');
  });

  it('image rejects changed bytes even when the modification time and size are identical', () => {
    const abs = seed('a.png', Buffer.from([1, 2, 3]));
    const base = readWorkspaceImage(root, 'a.png')!;
    seed('a.png', Buffer.from([4, 5, 6]));
    const result = writeWorkspaceImage(root, 'a.png', Buffer.from([7, 8, 9]), base.mtimeMs, undefined, base.revision);
    expect(result).toMatchObject({ ok: false, error: 'conflict' });
    expect(fs.readFileSync(abs)).toEqual(Buffer.from([4, 5, 6]));
  });

  it('a second editor cannot reuse the first editor base on a coarse timestamp filesystem', () => {
    seed('a.txt', 'initial');
    const base = readWorkspaceFile(root, 'a.txt')!;
    const first = writeWorkspaceFile(root, 'a.txt', 'first', 'lf', base.mtimeMs, undefined, false, base.revision);
    expect(first.ok).toBe(true);
    fs.utimesSync(path.join(root, 'a.txt'), fixedTime, fixedTime);
    const second = writeWorkspaceFile(root, 'a.txt', 'second', 'lf', base.mtimeMs, undefined, false, base.revision);
    expect(second).toMatchObject({ ok: false, error: 'conflict' });
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('first');
  });

  it.each(['text', 'image'] as const)('%s write failure after partial output preserves the original file', (kind) => {
    const rel = kind === 'text' ? 'a.txt' : 'a.png';
    const abs = seed(rel, 'original');
    const write = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementationOnce((target) => {
      write(target, 'partial');
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    });
    const result = kind === 'text'
      ? writeWorkspaceFile(root, rel, 'new content', 'lf', 0)
      : writeWorkspaceImage(root, rel, Buffer.from('new content'), 0);
    expect(result).toMatchObject({ ok: false, error: 'write-failed' });
    expect(fs.readFileSync(abs, 'utf8')).toBe('original');
    expect(fs.readdirSync(root)).toEqual([rel]);
  });

  it('rename failure keeps original contents and removes the private staging file', () => {
    const abs = seed('a.txt', 'original');
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
    expect(writeWorkspaceFile(root, 'a.txt', 'new content', 'lf', 0)).toMatchObject({ ok: false, error: 'write-failed' });
    expect(fs.readFileSync(abs, 'utf8')).toBe('original');
    expect(fs.readdirSync(root)).toEqual(['a.txt']);
  });

  it('rejects an external update while staging, even if the timestamp is unchanged', () => {
    const abs = seed('a.txt', 'original');
    const base = readWorkspaceFile(root, 'a.txt')!;
    const sync = fs.fsyncSync;
    vi.spyOn(fs, 'fsyncSync').mockImplementationOnce((fd) => {
      sync(fd);
      seed('a.txt', 'external');
    });
    const result = writeWorkspaceFile(root, 'a.txt', 'my edit', 'lf', base.mtimeMs, undefined, false, base.revision);
    expect(result).toMatchObject({ ok: false, error: 'conflict' });
    expect(fs.readFileSync(abs, 'utf8')).toBe('external');
    expect(fs.readdirSync(root)).toEqual(['a.txt']);
  });

  it('a successful save returns the new byte revision for the next save', () => {
    seed('a.txt', 'initial');
    const base = readWorkspaceFile(root, 'a.txt')!;
    const first = writeWorkspaceFile(root, 'a.txt', 'first', 'lf', base.mtimeMs, undefined, false, base.revision);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(first.result.revision).not.toBe(base.revision);
    expect(first.result.revision).toBe(readWorkspaceFile(root, 'a.txt')!.revision);
    expect(writeWorkspaceFile(root, 'a.txt', 'second', 'lf', first.result.mtimeMs, undefined, false, first.result.revision).ok).toBe(true);
  });

  it('force save still bypasses the stale revision and retains the existing permission mode', () => {
    const abs = seed('a.txt', 'initial');
    fs.chmodSync(abs, 0o755);
    const originalMode = fs.statSync(abs).mode;
    const result = writeWorkspaceFile(root, 'a.txt', 'forced', 'lf', 0, undefined, false, 'old revision');
    expect(result.ok).toBe(true);
    expect(fs.statSync(abs).mode).toBe(originalMode);
  });

  it('saving through a project-internal directory link retains the link and edits its target', () => {
    const targetDir = path.join(root, 'target');
    fs.mkdirSync(targetDir);
    seed('target/a.txt', 'initial');
    const link = path.join(root, 'linked');
    fs.symlinkSync(targetDir, link, process.platform === 'win32' ? 'junction' : 'dir');
    const base = readWorkspaceFile(root, 'linked/a.txt')!;
    const result = writeWorkspaceFile(root, 'linked/a.txt', 'saved', 'lf', base.mtimeMs, undefined, false, base.revision);
    expect(result.ok).toBe(true);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'a.txt'), 'utf8')).toBe('saved');
  });

  it('saving a project-internal file symlink preserves the link itself', ({ skip }) => {
    const target = seed('target.txt', 'initial');
    const link = path.join(root, 'linked.txt');
    try { fs.symlinkSync(target, link, 'file'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') { skip(); return; }
      throw error;
    }
    const base = readWorkspaceFile(root, 'linked.txt')!;
    expect(writeWorkspaceFile(root, 'linked.txt', 'saved', 'lf', base.mtimeMs, undefined, false, base.revision).ok).toBe(true);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe('saved');
  });
});
