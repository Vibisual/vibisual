import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TurnTokenUsage } from '@vibisual/shared';
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
function applyContextEvent(value: CodexContext | null, event: any): CodexContext | null {
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
  return value;
}

interface TokenTotals {
  input: number;
  cached: number;
  output: number;
}

interface CodexScanState {
  context: CodexContext | null;
  totals: TokenTotals;
  turns: TurnTokenUsage[];
}

function emptyState(): CodexScanState {
  return { context: null, totals: { input: 0, cached: 0, output: 0 }, turns: [] };
}

/** Cumulative token_count records can repeat (including quota-only updates). */
function applySessionLine(state: CodexScanState, line: string): void {
  let event: any;
  try { event = JSON.parse(line); } catch { return; }
  state.context = applyContextEvent(state.context, event);
  if (event?.type !== 'event_msg' || event.payload?.type !== 'token_count') return;
  const total = event.payload.info?.total_token_usage;
  if (!total || !Number.isFinite(total.input_tokens) || total.input_tokens < 0
    || !Number.isFinite(total.output_tokens) || total.output_tokens < 0) return;
  const cached = total.cached_input_tokens ?? 0;
  if (!Number.isFinite(cached) || cached < 0 || cached > total.input_tokens) return;
  const next = { input: total.input_tokens as number, cached: cached as number, output: total.output_tokens as number };
  // Older/repeated cumulative readings must not charge a request again. A rewritten
  // rollout is handled by resetting the entire scanner when its file shrinks.
  if (next.input < state.totals.input || next.cached < state.totals.cached || next.output < state.totals.output) return;
  const input = next.input - state.totals.input;
  const cacheRead = next.cached - state.totals.cached;
  const output = next.output - state.totals.output;
  if (cacheRead > input) return;
  state.totals = next;
  if (input + output === 0) return;
  const timestamp = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : NaN;
  state.turns.push({
    turnIndex: state.turns.length,
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    // Codex includes cached input/reasoning output in its input/output totals.
    inputTokens: input - cacheRead,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreateTokens: 0,
    totalContext: input,
    model: state.context?.modelName,
    tools: [],
  });
}

function parseSession(raw: string): CodexScanState {
  const state = emptyState();
  for (const line of raw.split('\n')) applySessionLine(state, line);
  return state;
}

/** Rollout usage is per request; cached/reasoning tokens are subsets, not additions. */
export function parseCodexContext(raw: string): CodexContext | null {
  return parseSession(raw).context;
}

/** Provider-neutral, dated request deltas consumed by the existing cost ledger. */
export function parseCodexTokenUsage(raw: string): TurnTokenUsage[] {
  return parseSession(raw).turns;
}

const cache = new Map<string, {
  checked: number;
  file?: string;
  offset: number;
  size: number;
  committed: CodexScanState;
  value: CodexScanState;
}>();

/** Chunked, incremental reads retain turn_context even after a long turn exceeds the old 512 KiB tail. */
function readCodexSession(threadId: string): CodexScanState | null {
  if (!/^[a-zA-Z0-9-]+$/.test(threadId)) return null;
  const root = path.join(codexHome(), 'sessions');
  const key = `${root}:${threadId}`;
  const previous = cache.get(key);
  if (previous && Date.now() - previous.checked < 2000) return previous.value;
  let file = previous?.file;
  let committed = previous?.committed ?? emptyState();
  let value = previous?.value ?? committed;
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
      if (nextSize < size) { offset = 0; committed = emptyState(); }
      size = nextSize;
      const scan = scanFileLines(file, offset, size, (line) => {
        applySessionLine(committed, line);
      });
      offset = scan.nextOffset;
      value = committed;
      if (scan.pendingTail) {
        // A complete JSON value without its newline is visible but must not mutate
        // committed totals/turns: the next read will see that same line again.
        value = { ...committed, turns: [...committed.turns] };
        applySessionLine(value, scan.pendingTail);
      }
    }
  } catch { /* Missing/in-progress rollout: keep the last known reading. */ }
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  cache.set(key, { checked: Date.now(), file, offset, size, committed, value });
  return value;
}

export function readCodexContext(threadId: string): CodexContext | null {
  return readCodexSession(threadId)?.context ?? null;
}

export function readCodexTokenUsage(threadId: string): TurnTokenUsage[] | null {
  const turns = readCodexSession(threadId)?.turns;
  return turns?.length ? turns.map(turn => ({ ...turn, tools: [...turn.tools] })) : null;
}
