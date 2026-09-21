import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { PlatformName } from '@vibisual/shared';
import { assertUnlinkedPath, assertWithinSkillRoot, SkillSharingError } from './skillSharingPaths.js';

const MAX_SKILL_BYTES = 64 * 1024 * 1024;
const MAX_SKILL_ENTRIES = 4096;
export interface SkillFile { content: Buffer; mode: number }
export interface SkillFiles { files: Map<string, SkillFile>; dirs: string[] }

/** Snapshot bytes once, rather than copying paths which could become links after validation. */
export function readSkillFiles(root: string): SkillFiles {
  assertUnlinkedPath(root);
  const result: SkillFiles = { files: new Map(), dirs: [] };
  let bytes = 0;
  let count = 0;
  function visit(dir: string, rel: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      const source = path.join(dir, entry.name);
      assertUnlinkedPath(source);
      const stat = fs.lstatSync(source);
      if (++count > MAX_SKILL_ENTRIES) throw new SkillSharingError('skill-too-large');
      if (stat.isDirectory()) { result.dirs.push(name); visit(source, name); continue; }
      if (!stat.isFile()) throw new SkillSharingError('unsafe-path');
      if ((bytes += stat.size) > MAX_SKILL_BYTES) throw new SkillSharingError('skill-too-large');
      const fd = fs.openSync(source, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const opened = fs.fstatSync(fd);
        // Windows lstat can return dev=0 while fstat reports the volume; compare only reported IDs.
        if (!opened.isFile() || opened.ino !== stat.ino
          || (opened.dev !== 0 && stat.dev !== 0 && opened.dev !== stat.dev)) throw new SkillSharingError('unsafe-path');
        const content = fs.readFileSync(fd);
        if (content.length !== stat.size) throw new SkillSharingError('unreadable-source');
        result.files.set(name, { content, mode: stat.mode });
      } finally { fs.closeSync(fd); }
    }
  }
  visit(root, '');
  return result;
}

export function skillFingerprint(tree: SkillFiles): string {
  const hash = createHash('sha256');
  for (const dir of [...tree.dirs].sort()) hash.update(`d:${dir}\0`);
  for (const [name, file] of [...tree.files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(`f:${name}\0${file.content.length}\0`).update(file.content);
  }
  return hash.digest('hex');
}

/** Reserve exclusively; SKILL.md is published last so an incomplete copy cannot be discovered. */
export function writeSkillFiles(root: string, destination: string, tree: SkillFiles, platform: PlatformName): void {
  assertWithinSkillRoot(root, destination, platform);
  fs.mkdirSync(root, { recursive: true });
  assertUnlinkedPath(root);
  fs.mkdirSync(destination); // EEXIST is intentionally not swallowed or overwritten.
  const reserved = fs.lstatSync(destination);
  try {
    for (const dir of tree.dirs) {
      const target = path.join(destination, dir);
      assertWithinSkillRoot(destination, target, platform);
      fs.mkdirSync(target, { recursive: true });
    }
    const files = [...tree.files].sort(([a], [b]) => Number(a === 'SKILL.md') - Number(b === 'SKILL.md'));
    for (const [name, file] of files) {
      const target = path.join(destination, name);
      assertWithinSkillRoot(destination, target, platform);
      fs.writeFileSync(target, file.content, { flag: 'wx', mode: file.mode });
    }
  } catch (err) {
    // Only remove our newly reserved directory, never a replacement or a linked target.
    assertWithinSkillRoot(root, destination, platform);
    const current = fs.lstatSync(destination);
    if (current.ino === reserved.ino && current.dev === reserved.dev) fs.rmSync(destination, { recursive: true });
    throw err;
  }
}
