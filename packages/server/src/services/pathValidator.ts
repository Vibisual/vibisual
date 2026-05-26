import path from 'node:path';

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

  // Windows 파일 경로는 대소문자 무시 (root가 normalize()로 소문자화되어 있으므로)
  const isWin = process.platform === 'win32';
  const r = isWin ? resolved.toLowerCase() : resolved;
  const nr = isWin ? normalizedRoot.toLowerCase() : normalizedRoot;

  // Ensure the resolved path starts with the root directory
  // Add path.sep to prevent prefix matching (e.g., /root-other matching /root)
  if (r === nr || r.startsWith(nr + path.sep)) {
    return resolved;
  }

  return null;
}
