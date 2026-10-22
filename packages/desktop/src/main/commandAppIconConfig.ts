/** Icons are disposable derivatives, never checkpoint/history payloads. */
export const COMMAND_APP_ICON_LIMITS = {
  maxEntries: 64,
  maxCacheBytes: 2 * 1024 * 1024,
  /** One encoded icon (PNG or SVG) handed to the renderer. */
  maxImageBytes: 32 * 1024,
  maxConcurrent: 2,
  maxQueued: 32,
  positiveTtlMs: 5 * 60_000,
  negativeTtlMs: 30_000,
  requestTimeoutMs: 5_000,
  maxPathChars: 4096,
  maxPathEnvChars: 32_768,
  maxPathDirs: 32,
  /** Preferred square frame: bubbles draw 24–40 CSS px, at up to 2x device density. */
  targetIconPx: 64,
  /** Windows PE icon resources come from an untrusted file — every walk and read is bounded. */
  maxPeResourceEntries: 4096,
  maxPeFrameBytes: 1024 * 1024,
  maxPeFrameAttempts: 6,
  /** Linux freedesktop lookup probes fixed candidate paths only, never a directory listing. */
  maxDesktopEntryBytes: 64 * 1024,
  maxXdgDataDirs: 12,
  maxLinuxIconProbes: 256,
} as const;

export const COMMAND_APP_ICON_CHANNEL = 'vibisual:command-app-icon';
