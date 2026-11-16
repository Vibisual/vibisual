import fs from 'node:fs';
import path from 'node:path';
import type { MemoServerHost } from '../host.js';
import { MemoError } from './errors.js';

export class MemoStorage {
  constructor(readonly host: MemoServerHost) {}
  path(root: string, relative: string): string {
    const resolved = this.host.resolveWorkspacePath(root, `.vibisual/memo/${relative}`);
    if (!resolved) throw new MemoError('invalid-path', 403);
    let parent = root;
    for (const part of resolved.rel.replace(/\\/g, '/').split('/')) {
      parent = path.join(parent, part);
      try {
        const stat = fs.lstatSync(parent);
        if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new MemoError('invalid-path', 403);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return resolved.abs;
  }
  read<T>(root: string, relative: string, validate: (raw: unknown) => T): T | null {
    let exists = false;
    for (const suffix of ['', '.bak']) {
      const file = this.path(root, relative + suffix);
      if (!fs.existsSync(file)) continue;
      exists = true;
      try { return validate(JSON.parse(fs.readFileSync(file, 'utf8'))); }
      catch { this.host.warn(`[memo] Cannot read ${relative + suffix}`); }
    }
    if (exists) throw new MemoError('storage-corrupt', 500);
    return null;
  }
  write(root: string, relative: string, value: unknown): void {
    const file = this.path(root, relative);
    const backup = this.path(root, relative + '.bak');
    this.path(root, relative + '.tmp'); this.path(root, relative + '.bak.tmp');
    if (fs.existsSync(file)) {
      const previous = fs.readFileSync(file, 'utf8');
      // Never rotate corrupt bytes over the last good copy.
      try { JSON.parse(previous); this.host.atomicWriteFile(backup, previous); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    }
    this.host.atomicWriteFile(file, JSON.stringify(value));
  }
  names(root: string, relative: string): string[] {
    const dir = this.path(root, relative);
    try { return fs.readdirSync(dir); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
}
