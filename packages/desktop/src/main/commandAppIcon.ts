import { fileURLToPath } from 'node:url';
import { isPathWithin, pathKey } from '@vibisual/shared';
import { findCommandExecutable, normalizeCommandExecutable, type CommandExecutableContext } from './commandAppExecutable';
import { COMMAND_APP_ICON_LIMITS as LIMITS } from './commandAppIconConfig';
import { commandAppIconCandidates } from './commandAppIconCandidates';

interface IconDependencies extends CommandExecutableContext {
  /** Electron is injected so filesystem work, queues and cache policy can be tested without native startup. */
  getIconPng(file: string): Promise<Buffer | null>;
  now?: () => number;
}

interface CacheEntry { value: string | null; expires: number; bytes: number }
interface PendingIcon {
  key: string;
  executable: string;
  promise: Promise<string | null>;
  resolve(value: string | null): void;
  timer?: ReturnType<typeof setTimeout>;
  settled: boolean;
  active: boolean;
}

interface IconSender {
  sender: { isDestroyed(): boolean; mainFrame: { url: string } };
  senderFrame: { url: string } | null;
}

/** Only our top-level packaged renderer document may use this local-filesystem IPC. */
export function isCommandAppIconRenderer(event: IconSender, rendererFile: string, platform: NodeJS.Platform): boolean {
  try {
    if (event.sender.isDestroyed() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
    return pathKey(fileURLToPath(event.senderFrame.url, { windows: platform === 'win32' }), platform) === pathKey(rendererFile, platform);
  } catch { return false; }
}

/** Process-local, bounded, on-demand cache. No timers scan the filesystem and nothing is persisted. */
export function createCommandAppIconResolver(deps: IconDependencies): {
  get(executable: unknown): Promise<string | null>;
  dispose(): void;
} {
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, PendingIcon>();
  const queue: PendingIcon[] = [];
  const now = deps.now ?? Date.now;
  let cacheBytes = 0;
  let active = 0;
  let disposed = false;

  const removeCached = (key: string): void => {
    const entry = cache.get(key);
    if (entry) { cacheBytes -= entry.bytes; cache.delete(key); }
  };
  const remember = (key: string, value: string | null): void => {
    removeCached(key);
    // Conservative UTF-16 accounting also charges keys and fixed entry bookkeeping.
    const bytes = (key.length + (value?.length ?? 0)) * 2 + 64;
    cache.set(key, { value, bytes, expires: now() + (value ? LIMITS.positiveTtlMs : LIMITS.negativeTtlMs) });
    cacheBytes += bytes;
    while (cache.size > LIMITS.maxEntries || cacheBytes > LIMITS.maxCacheBytes) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      removeCached(oldest);
    }
  };
  const finish = (job: PendingIcon, value: string | null): void => {
    if (job.settled) return;
    job.settled = true;
    clearTimeout(job.timer);
    if (!disposed) remember(job.key, value);
    job.resolve(value);
  };
  const readIcon = async (job: PendingIcon): Promise<string | null> => {
    const canceled = (): boolean => disposed || job.settled;
    for (const candidate of commandAppIconCandidates(job.executable, deps.platform)) {
      try {
        const file = await findCommandExecutable(candidate.executable, deps, canceled);
        if (canceled()) return null;
        if (!file || (candidate.bundle && !isPathWithin(file, candidate.bundle, deps.platform))) continue;
        const png = await deps.getIconPng(candidate.bundle ?? file);
        if (canceled()) return null;
        if (!png || png.length > LIMITS.maxPngBytes || png.length < 8) continue;
        if (png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) continue;
        return `data:image/png;base64,${png.toString('base64')}`;
      } catch { /* Optional decoration: try the next grounded candidate, without logging local paths. */ }
    }
    return null;
  };
  const drain = (): void => {
    while (!disposed && active < LIMITS.maxConcurrent && queue.length > 0) {
      const job = queue.shift()!;
      active += 1;
      job.active = true;
      void readIcon(job).then((value) => finish(job, value)).finally(() => {
        pending.delete(job.key);
        active -= 1;
        drain();
      });
    }
  };

  return {
    get(executable: unknown): Promise<string | null> {
      const input = normalizeCommandExecutable(executable, deps.platform);
      if (disposed || !input) return Promise.resolve(null);
      const key = pathKey(input, deps.platform);
      const hit = cache.get(key);
      if (hit && hit.expires > now()) {
        cache.delete(key); cache.set(key, hit);
        return Promise.resolve(hit.value);
      }
      if (hit) removeCached(key);
      const current = pending.get(key);
      if (current) return current.promise;
      if (active >= LIMITS.maxConcurrent && queue.length >= LIMITS.maxQueued) return Promise.resolve(null);
      let resolve!: (value: string | null) => void;
      const promise = new Promise<string | null>((done) => { resolve = done; });
      const job: PendingIcon = { key, executable: input, promise, resolve, settled: false, active: false };
      pending.set(key, job);
      queue.push(job);
      job.timer = setTimeout(() => {
        finish(job, null);
        // Native extraction cannot be canceled. Keep its slot until it actually finishes;
        // otherwise repeated timeouts would bypass the concurrency limit.
        if (!job.active) { queue.splice(queue.indexOf(job), 1); pending.delete(key); }
      }, LIMITS.requestTimeoutMs);
      job.timer.unref?.();
      drain();
      return promise;
    },
    dispose(): void {
      disposed = true;
      for (const job of pending.values()) finish(job, null);
      pending.clear(); queue.length = 0; cache.clear(); cacheBytes = 0;
    },
  };
}
