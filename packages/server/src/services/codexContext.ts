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

/**
 * §9 「일하는 동안의 메인 스레드」 — 롤아웃 이름 색인 하나를 모든 스레드가 함께 쓴다. 지워졌거나 보관된 스레드가 저마다
 * 2초마다 `sessions` 트리 전체를 동기로 훑으면 메인 스레드가 수백 ms 씩 멈춰 창 끌기가 끊긴다(2026-10-29 실측 1.1초).
 * 새 롤아웃은 가장 최근 날짜 폴더에만 생기므로 그 길만 2초마다 다시 읽고, 트리 전체는 1분에 한 번 훑는다.
 */
const ROLLOUT_RECENT_RESCAN_MS = 2000;
const ROLLOUT_FULL_WALK_MS = 60_000;
/** `sessions/YYYY/MM/DD/<file>` — 옛 탐색과 같은 깊이까지만 내려간다. */
const ROLLOUT_MAX_DEPTH = 3;

interface RolloutIndex {
  root: string;
  fullAt: number;
  recentAt: number;
  /** 파일 이름 → 그 파일이 있는 폴더. */
  dirs: Map<string, string>;
}

let rolloutIndex: RolloutIndex | null = null;

function indexRolloutsIn(index: RolloutIndex, dir: string, depth: number, recurse: boolean): string | undefined {
  let newest: string | undefined;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile()) {
      index.dirs.set(entry.name, dir);
    } else if (entry.isDirectory() && depth < ROLLOUT_MAX_DEPTH) {
      if (recurse) indexRolloutsIn(index, path.join(dir, entry.name), depth + 1, true);
      // 날짜 폴더(숫자 이름)만 견준다 — 다른 이름의 폴더가 "가장 최근"으로 잡히면 새 롤아웃을 못 본다.
      else if (/^\d+$/.test(entry.name) && (newest === undefined || entry.name > newest)) newest = entry.name;
    }
  }
  return newest;
}

function walkRecentRollouts(index: RolloutIndex): void {
  let dir: string | undefined = index.root;
  for (let depth = 0; dir !== undefined; depth++) {
    const newest = indexRolloutsIn(index, dir, depth, false);
    dir = newest === undefined ? undefined : path.join(dir, newest);
  }
}

function findInIndex(index: RolloutIndex, threadId: string): string | undefined {
  const suffix = `-${threadId}.jsonl`;
  for (const [name, dir] of index.dirs) {
    if (name.endsWith(suffix)) return path.join(dir, name);
  }
  return undefined;
}

function findRollout(root: string, threadId: string, now: number): string | undefined {
  let index = rolloutIndex?.root === root ? rolloutIndex : null;
  if (!index || now - index.fullAt >= ROLLOUT_FULL_WALK_MS) {
    index = { root, fullAt: now, recentAt: now, dirs: new Map() };
    rolloutIndex = index;
    indexRolloutsIn(index, root, 0, true);
    return findInIndex(index, threadId);
  }
  const hit = findInIndex(index, threadId);
  if (hit || now - index.recentAt < ROLLOUT_RECENT_RESCAN_MS) return hit;
  index.recentAt = now;
  walkRecentRollouts(index);
  return findInIndex(index, threadId);
}

/** Chunked, incremental reads retain turn_context even after a long turn exceeds the old 512 KiB tail. */
function readCodexSession(threadId: string): CodexScanState | null {
  if (!/^[a-zA-Z0-9-]+$/.test(threadId)) return null;
  const root = path.join(codexHome(), 'sessions');
  const key = `${root}:${threadId}`;
  const previous = cache.get(key);
  const now = Date.now();
  if (previous && now - previous.checked < 2000) return previous.value;
  let file = previous?.file;
  let committed = previous?.committed ?? emptyState();
  let value = previous?.value ?? committed;
  let offset = previous?.offset ?? 0;
  let size = previous?.size ?? 0;
  try {
    if (!file) file = findRollout(root, threadId, now);
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
  cache.set(key, { checked: now, file, offset, size, committed, value });
  return value;
}

export function readCodexContext(threadId: string): CodexContext | null {
  return readCodexSession(threadId)?.context ?? null;
}

export function readCodexTokenUsage(threadId: string): TurnTokenUsage[] | null {
  const turns = readCodexSession(threadId)?.turns;
  return turns?.length ? turns.map(turn => ({ ...turn, tools: [...turn.tools] })) : null;
}
