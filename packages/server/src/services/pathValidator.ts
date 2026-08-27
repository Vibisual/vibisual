import path from 'node:path';
import { isWithinRoot } from './pathKey.js';

/**
 * Validate that a resolved absolute path is within an allowed root directory.
 * Returns the normalized absolute path if valid, or null if the path escapes
 * the allowed root (e.g., via `..` traversal).
 *
 * @param filePath - The file path to validate (absolute or relative)
 * @param allowedRoot - The root directory that filePath must reside within
 * @returns Normalized absolute path if valid, null otherwise
 */
export function validatePathWithinRoot(filePath: string, allowedRoot: string): string | null {
  const resolved = path.resolve(allowedRoot, filePath);
  const normalizedRoot = path.resolve(allowedRoot);

  // 대소문자를 접을지는 플랫폼이 정한다 — win/mac 은 파일시스템이 무시하고 linux 는 구분한다.
  //   예전에는 여기서 win32 만 접어, **mac 에서 케이스만 다른 정상 경로가 사유 없이 거부**됐다.
  //   판정은 pathKey 규칙 한 곳(isWithinRoot)에만 맡기고, 돌려주는 값은 원본 케이스 그대로 둔다.
  if (isWithinRoot(resolved, normalizedRoot)) {
    return resolved;
  }

  return null;
}
