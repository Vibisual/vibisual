/** Bounded discovery only: these probes never start an inference thread or turn. */
export const CODEX_MODEL_DISCOVERY = {
  retryMs: 30_000,
  timeoutMs: 20_000,
  shutdownMs: 3_000,
  pageSize: 100,
  maxPages: 20,
  maxOutputBytes: 4 * 1024 * 1024,
  clientInfo: { name: 'vibisual', title: 'Vibisual', version: '0.1.0' },
} as const;
