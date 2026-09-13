import * as fs from 'node:fs';
import * as path from 'node:path';
import { codexHome } from './codexCli.js';

export interface CodexContext {
  contextUsed: number;
  contextMax: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  modelName?: string;
}

/** Rollout usage is per request; cached/reasoning tokens are subsets, not additions. */
export function parseCodexContext(raw: string): CodexContext | null {
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]!);
      if (event.type !== 'event_msg' || event.payload?.type !== 'token_count') continue;
      const info = event.payload.info;
      const last = info?.last_token_usage;
      const total = info?.total_token_usage;
      if (!Number.isFinite(last?.total_tokens) || last.total_tokens < 0
        || !Number.isFinite(info?.model_context_window) || info.model_context_window <= 0) continue;
      return {
        contextUsed: last.total_tokens,
        contextMax: info.model_context_window,
        cumulativeInputTokens: Number.isFinite(total?.input_tokens) ? total.input_tokens : 0,
        cumulativeOutputTokens: Number.isFinite(total?.output_tokens) ? total.output_tokens : 0,
      };
    } catch { /* Partial JSONL writes and a truncated first line are normal. */ }
  }
  return null;
}

const cache = new Map<string, { checked: number; file?: string; value: CodexContext | null }>();

/** Same snapshot enrichment as Claude, with a bounded tail and throttled disk reads. */
export function readCodexContext(threadId: string): CodexContext | null {
  if (!/^[a-zA-Z0-9-]+$/.test(threadId)) return null;
  const root = path.join(codexHome(), 'sessions');
  const key = `${root}:${threadId}`;
  const previous = cache.get(key);
  if (previous && Date.now() - previous.checked < 2000) return previous.value;
  let file = previous?.file;
  let value = previous?.value ?? null;
  try {
    if (!file) {
      const walk = (dir: string, depth: number): string | undefined => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const candidate = path.join(dir, entry.name);
          if (entry.isFile() && entry.name.endsWith(`-${threadId}.jsonl`)) return candidate;
          if (entry.isDirectory() && depth < 3) {
            const found = walk(candidate, depth + 1);
            if (found) return found;
          }
        }
        return undefined;
      };
      file = walk(root, 0);
    }
    if (file) {
      const fd = fs.openSync(file, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        const buffer = Buffer.alloc(Math.min(size, 512 * 1024));
        const read = fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
        value = parseCodexContext(buffer.subarray(0, read).toString('utf8')) ?? value;
      } finally { fs.closeSync(fd); }
    }
  } catch { /* Missing/in-progress rollout: keep the last known reading. */ }
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  cache.set(key, { checked: Date.now(), file, value });
  return value;
}
