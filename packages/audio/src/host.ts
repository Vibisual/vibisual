/** The audio app receives host services; it never imports a core package. */
export interface AudioServerHost {
  resolveProjectPath(raw: unknown): string | null;
  resolveWorkspacePath(root: string, relativePath: string): { abs: string; rel: string } | null;
  atomicWriteFile(filePath: string, data: string): void;
  info(message: string): void;
  warn(message: string): void;
}
