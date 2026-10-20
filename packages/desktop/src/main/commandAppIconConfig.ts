/** Icons are disposable derivatives, never checkpoint/history payloads. */
export const COMMAND_APP_ICON_LIMITS = {
  maxEntries: 64,
  maxCacheBytes: 2 * 1024 * 1024,
  maxPngBytes: 32 * 1024,
  maxConcurrent: 2,
  maxQueued: 32,
  positiveTtlMs: 5 * 60_000,
  negativeTtlMs: 30_000,
  requestTimeoutMs: 5_000,
  maxPathChars: 4096,
  maxPathEnvChars: 32_768,
  maxPathDirs: 32,
} as const;

export const COMMAND_APP_ICON_CHANNEL = 'vibisual:command-app-icon';
