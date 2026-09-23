import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listWorkspaceDir, resolveWorkspacePath, statWorkspacePath } from './workspaceExplorer.js';
import { readWorkspaceFile, readWorkspaceImage, writeWorkspaceFile, writeWorkspaceImage } from './workspaceFile.js';
import { resolveInRoot, runLocalTool } from './localTools.js';

let sandbox: string;
let root: string;
let other: string;
const links: string[] = [];

function link(target: string, name: string): string {
  const location = path.join(root, name);
  // Directory junctions work without Windows symlink privileges; POSIX treats this as a directory symlink.
  fs.symlinkSync(target, location, 'junction');
  links.push(location);
  return location;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi-workspace-boundary-'));
  root = path.join(sandbox, 'project-a');
  other = path.join(sandbox, 'project-b');
  fs.mkdirSync(root);
  fs.mkdirSync(other);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'inside.txt'), 'inside');
  fs.writeFileSync(path.join(other, 'outside.txt'), 'other project');
  fs.writeFileSync(path.join(other, 'outside.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
});

afterEach(() => {
  for (const location of links.splice(0)) fs.unlinkSync(location);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('workspace paths keep resolved links within their selected project', () => {
  it('rejects another project reached through a directory link for text, images and exploration', () => {
    link(other, 'linked');
    expect(resolveWorkspacePath(root, 'linked/outside.txt')).toBeNull();
    expect(readWorkspaceFile(root, 'linked/outside.txt')).toBeNull();
    expect(readWorkspaceImage(root, 'linked/outside.png')).toBeNull();
    expect(statWorkspacePath(root, 'linked/outside.txt')).toBeNull();
    expect(listWorkspaceDir(root, 'linked')).toBeNull();
  });

  it('does not overwrite another project through text or image save, including forced saves', () => {
    link(other, 'linked');
    expect(writeWorkspaceFile(root, 'linked/outside.txt', 'overwritten', 'lf', 0)).toEqual({ ok: false, error: 'outside' });
    expect(writeWorkspaceImage(root, 'linked/outside.png', Buffer.from('overwritten'), 0)).toEqual({ ok: false, error: 'outside' });
    expect(fs.readFileSync(path.join(other, 'outside.txt'), 'utf8')).toBe('other project');
    expect(fs.readFileSync(path.join(other, 'outside.png'))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
  });

  it('also rejects a missing descendant below an outside link', () => {
    link(other, 'linked');
    expect(resolveWorkspacePath(root, 'linked/missing/deep.txt')).toBeNull();
  });

  it('local Write cannot create missing directories beneath a link into another project', async () => {
    link(other, 'linked');
    const result = await runLocalTool('Write', { path: 'linked/missing/deep.txt', content: 'escaped' }, root);
    expect(result.isError).toBe(true);
    expect(fs.existsSync(path.join(other, 'missing', 'deep.txt'))).toBe(false);
    expect(resolveInRoot(root, 'linked/missing/deep.txt')).toBeNull();
  });

  it('preserves internal links and their displayed paths', () => {
    link(path.join(root, 'src'), 'linked');
    expect(resolveWorkspacePath(root, 'linked/inside.txt')).toEqual({ abs: path.join(root, 'linked', 'inside.txt'), rel: 'linked/inside.txt' });
    expect(readWorkspaceFile(root, 'linked/inside.txt')?.text).toBe('inside');
    expect(writeWorkspaceFile(root, 'linked/inside.txt', 'updated', 'lf', 0).ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src', 'inside.txt'), 'utf8')).toBe('updated');
    expect(resolveWorkspacePath(root, 'linked/missing/deep.txt')?.rel).toBe('linked/missing/deep.txt');
    expect(writeWorkspaceFile(root, 'linked/missing.txt', 'new', 'lf', 0)).toEqual({ ok: false, error: 'not-found' });
  });

  it('accepts a project root that is itself a directory link', () => {
    const aliasRoot = link(path.join(root, 'src'), 'alias-root');
    expect(readWorkspaceFile(aliasRoot, 'inside.txt')?.text).toBe('inside');
    expect(writeWorkspaceFile(aliasRoot, 'inside.txt', 'updated', 'lf', 0).ok).toBe(true);
  });

  it('does not treat a dangling link as an ordinary missing directory', () => {
    link(path.join(root, 'src'), 'linked');
    fs.renameSync(path.join(root, 'src'), path.join(root, 'moved'));
    expect(resolveWorkspacePath(root, 'linked/missing/deep.txt')).toBeNull();
    expect(resolveInRoot(root, 'linked/missing/deep.txt')).toBeNull();
  });
});
