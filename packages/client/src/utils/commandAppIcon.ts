const ICON_CACHE_LIMIT = 64;
const ICON_REQUEST_LIMIT = 32;
const ICON_DATA_LIMIT = 44 * 1024;
const ICON_CACHE_BYTE_LIMIT = 2 * 1024 * 1024;
/** PNG/ICO from executables, SVG from Linux icon themes — only inline data, never a fetchable URL. */
const ICON_DATA_URL = /^data:image\/(?:png|x-icon|vnd\.microsoft\.icon|svg\+xml);base64,/;

export interface CommandAppIconCache {
  (executable: string): Promise<string | null>;
  /** Synchronous look at a live cached answer (null = known to have no icon), so a remount does not flash the glyph. */
  peek(executable: string): string | null | undefined;
}

/** Renderer-local cache only; icons never enter graph state or persisted snapshots. */
export function createCommandAppIconCache(
  fetchIcon: (executable: string) => Promise<string | null>,
): CommandAppIconCache {
  const cache = new Map<string, { icon: string | null; expiresAt: number; bytes: number }>();
  const pending = new Map<string, Promise<string | null>>();
  let cacheBytes = 0;
  const remove = (executable: string): void => {
    const cached = cache.get(executable);
    if (cached) cacheBytes -= cached.bytes;
    cache.delete(executable);
  };
  const remember = (executable: string, icon: string | null): void => {
    remove(executable);
    const bytes = (executable.length + (icon?.length ?? 0)) * 2;
    cache.set(executable, { icon, expiresAt: Date.now() + (icon ? 300_000 : 30_000), bytes });
    cacheBytes += bytes;
    while (cache.size > ICON_CACHE_LIMIT || cacheBytes > ICON_CACHE_BYTE_LIMIT) remove(cache.keys().next().value!);
  };
  const get = (executable: string): Promise<string | null> => {
    if (!executable || executable.length > 4096) return Promise.resolve(null);
    if (cache.has(executable)) {
      const cached = cache.get(executable)!;
      cache.delete(executable);
      if (cached.expiresAt > Date.now()) {
        cache.set(executable, cached);
        return Promise.resolve(cached.icon);
      }
      cacheBytes -= cached.bytes;
    }
    const existing = pending.get(executable);
    if (existing) return existing;
    // No unbounded request queue when a graph with many app nodes becomes visible.
    if (pending.size >= ICON_REQUEST_LIMIT) return Promise.resolve(null);
    const request = Promise.resolve().then(() => fetchIcon(executable)).then((value) => {
      const icon = value && value.length <= ICON_DATA_LIMIT && ICON_DATA_URL.test(value) ? value : null;
      remember(executable, icon);
      return icon;
    }).catch(() => {
      remember(executable, null);
      return null;
    }).finally(() => { pending.delete(executable); });
    pending.set(executable, request);
    return request;
  };
  const peek = (executable: string): string | null | undefined => {
    const cached = cache.get(executable);
    return cached && cached.expiresAt > Date.now() ? cached.icon : undefined;
  };
  return Object.assign(get, { peek });
}

export const getCommandAppIcon = createCommandAppIconCache(async (executable) => {
  if (typeof window === 'undefined') return null;
  return window.api?.getCommandAppIcon?.(executable) ?? null;
});

export function peekCommandAppIcon(executable: string): string | null | undefined {
  return getCommandAppIcon.peek(executable);
}
