import fs from 'node:fs';
import path from 'node:path';
import { isWithinRoot } from './pathKey.js';

/** Resolve links through the closest existing ancestor, including paths not yet created. */
export function resolvePathWithLinks(filePath: string): string | null {
  const abs = path.resolve(filePath);
  let probe = abs;
  for (;;) {
    try {
      return path.resolve(fs.realpathSync(probe), path.relative(probe, abs));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      // A dangling link is not an ordinary missing segment. Never fall back to its lexical path.
      try {
        if (fs.lstatSync(probe).isSymbolicLink()) return null;
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') return null;
      }
      const parent = path.dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }
  }
}

/** Resolves `filePath` (absolute or relative) against `allowedRoot` and returns it, or null if it escapes the root (e.g. via `..`). */
export function validatePathWithinRoot(filePath: string, allowedRoot: string): string | null {
  const resolved = path.resolve(allowedRoot, filePath);
  const normalizedRoot = path.resolve(allowedRoot);

  // 대소문자 접기는 `isWithinRoot`(pathKey 규칙)에 맡긴다 — win32 만 접으면 mac 의 정상 경로가 거부된다. 돌려주는 값은 원본 케이스.
  if (isWithinRoot(resolved, normalizedRoot)) {
    return resolved;
  }

  return null;
}
