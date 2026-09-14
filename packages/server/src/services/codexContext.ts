import * as fs from 'node:fs';
import * as path from 'node:path';
import { codexHome } from './codexCli.js';
import { scanFileLines } from './jsonlChunkReader.js';

export interface CodexContext {
  contextUsed: number;
  contextMax: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  modelName?: string;
  reasoningEffort?: string;
}

/** Keep usage and the latest turn's actual settings together, including inherited CLI effort. */
function applyContextLine(value: CodexContext | null, line: string): CodexContext | null {
  try {
    const event = JSON.parse(line);
    if (event?.type === 'turn_context' && event.payload && typeof event.payload === 'object') {
      const model = event.payload.model;
      const effort = event.payload.effort;
      return {
        contextUsed: 0, contextMax: 0, cumulativeInputTokens: 0, cumulativeOutputTokens: 0,
        ...value,
        // Missing settings in a newer turn must not borrow an older turn's values.
        modelName: typeof model === 'string' && model.trim() ? model.trim() : undefined,
        reasoningEffort: typeof effort === 'string' && effort.trim() ? effort.trim() : undefined,
      };
    }
    if (event?.type === 'event_msg' && event.payload?.type === 'token_count') {
      const info = event.payload.info;
      const last = info?.last_token_usage;
      const total = info?.total_token_usage;
      if (!Number.isFinite(last?.total_tokens) || last.total_tokens < 0
        || !Number.isFinite(info?.model_context_window) || info.model_context_window <= 0) return value;
      return {
        ...value,
        contextUsed: last.total_tokens,
        contextMax: info.model_context_window,
        cumulativeInputTokens: Number.isFinite(total?.input_tokens) ? total.input_tokens : 0,
        cumulativeOutputTokens: Number.isFinite(total?.output_tokens) ? total.output_tokens : 0,
      };
    }
  } catch { /* Partial JSONL writes are normal. */ }
  return value;
}

/** Rollout usage is per request; cached/reasoning tokens are subsets, not additions. */
export function parseCodexContext(raw: string): CodexContext | null {
  return raw.split('\n').reduce<CodexContext | null>(applyContextLine, null);
}

const cache = new Map<string, {
  checked: number;
  file?: string;
  offset: number;
  size: number;
  committed: CodexContext | null;
  value: CodexContext | null;
}>();

/** Chunked, incremental reads retain turn_context even after a long turn exceeds the old 512 KiB tail. */
export function readCodexContext(threadId: string): CodexContext | null {
  if (!/^[a-zA-Z0-9-]+$/.test(threadId)) return null;
  const root = path.join(codexHome(), 'sessions');
  const key = `${root}:${threadId}`;
  const previous = cache.get(key);
  if (previous && Date.now() - previous.checked < 2000) return previous.value;
  let file = previous?.file;
  let value = previous?.value ?? null;
  let committed = previous?.committed ?? null;
  let offset = previous?.offset ?? 0;
  let size = previous?.size ?? 0;
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
      const nextSize = fs.statSync(file).size;
      if (nextSize < size) { offset = 0; committed = null; }
      size = nextSize;
      const scan = scanFileLines(file, offset, size, (line) => {
        committed = applyContextLine(committed, line);
      });
      offset = scan.nextOffset;
      value = scan.pendingTail ? applyContextLine(committed, scan.pendingTail) : committed;
    }
  } catch { /* Missing/in-progress rollout: keep the last known reading. */ }
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  cache.set(key, { checked: Date.now(), file, offset, size, committed, value });
  return value;
}
