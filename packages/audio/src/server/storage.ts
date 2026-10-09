import fs from 'node:fs';
import path from 'node:path';
import type { AudioServerHost } from '../host.js';
import { AudioServiceError } from './errors.js';

/** All audio-owned writes stay in this directory; existing project assets are read-only. */
export class AudioStorage {
  constructor(readonly host: AudioServerHost) {}

  path(root: string, relative: string): string {
    const rel = `.vibisual/audio/${relative}`;
    const resolved = this.host.resolveWorkspacePath(root, rel);
    if (!resolved) throw new AudioServiceError(403, 'invalid-path', 'Audio storage is outside this project.');
    // A storage link into another project file is also not an app-owned destination.
    let ancestor = root;
    for (const part of resolved.rel.replace(/\\/g, '/').split('/')) {
      ancestor = path.join(ancestor, part);
      try {
        const stat = fs.lstatSync(ancestor);
        if (stat.isSymbolicLink()) {
          throw new AudioServiceError(403, 'invalid-path', 'Audio storage cannot contain symbolic links.');
        }
        if (stat.isFile() && stat.nlink > 1) {
          throw new AudioServiceError(403, 'invalid-path', 'Audio storage cannot contain hard-linked files.');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return resolved.abs;
  }

  read<T>(root: string, relative: string, validate: (raw: unknown) => T): T | null {
    const file = this.path(root, relative);
    let found = false;
    for (const suffix of ['', '.bak']) {
      const candidate = suffix === '' ? file : this.path(root, `${relative}${suffix}`);
      if (!fs.existsSync(candidate)) continue;
      found = true;
      try {
        const value = validate(JSON.parse(fs.readFileSync(candidate, 'utf8')));
        if (suffix !== '') this.host.warn(`[audio] Read backup for ${relative}.`);
        return value;
      } catch (error) {
        this.host.warn(`[audio] Cannot read ${relative}${suffix}: ${error instanceof Error ? error.message : 'invalid data'}`);
      }
    }
    if (found) throw new AudioServiceError(500, 'storage-corrupt', 'The saved audio document and its backup could not be read.');
    return null;
  }

  write(root: string, relative: string, value: unknown, validate: (raw: unknown) => unknown): void {
    const file = this.path(root, relative);
    const backup = this.path(root, `${relative}.bak`);
    // The injected atomic writer uses these siblings before rename. Guard them too.
    this.path(root, `${relative}.tmp`);
    this.path(root, `${relative}.bak.tmp`);
    if (fs.existsSync(file)) {
      // A corrupt current file must not replace the only readable backup.
      const previous = fs.readFileSync(file, 'utf8');
      let valid = true;
      try { validate(JSON.parse(previous)); } catch { valid = false; }
      if (valid) this.host.atomicWriteFile(backup, previous);
    }
    this.host.atomicWriteFile(file, JSON.stringify(value, null, 2));
  }
}
