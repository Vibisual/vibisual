import fs from 'node:fs';
import { createInterface } from 'node:readline';
import type { ProjectInfo, QueuedCommand, SubAgentStreamEvent } from '@vibisual/shared';
import { prepareStreamSearch, subStreamsDir } from './streamBufferStore.js';

const SEARCH_TERMS_MAX = 32;
const SEARCH_TERM_LENGTH_MAX = 512;
const SEARCH_CACHE_MAX = 256;
const cache = new Map<string, { stamp: string; terms: string[] }>();

function fold(text: string): string { return text.normalize('NFC').toLowerCase(); }

/** Invalid input is rejected instead of silently weakening an AND query. */
export function parseConversationSearchTerms(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || raw.length > 32_768) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(value) || value.length > SEARCH_TERMS_MAX
    || value.some((term) => typeof term !== 'string' || term.length > SEARCH_TERM_LENGTH_MAX)) return null;
  return [...new Set((value as string[]).map((term) => fold(term.trim())).filter(Boolean))];
}

function matchText(text: string, terms: readonly string[], found: Set<string>): void {
  const haystack = fold(text);
  for (const term of terms) if (!found.has(term) && haystack.includes(term)) found.add(term);
}

/** One line at a time; only a query-sized suffix of a streamed text run is retained. */
async function searchStreamFiles(
  dir: string, agentId: string, subId: string, terms: readonly string[], boundaries: readonly number[], signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  const source = prepareStreamSearch(dir, subId);
  const key = JSON.stringify([dir, agentId, subId, terms, boundaries]);
  const previous = cache.get(key);
  if (previous?.stamp === source.stamp) return previous.terms;
  const found = new Set<string>();
  const tailLength = Math.max(...terms.map((term) => term.length), 1) + 8;
  let suffix = '';
  let lastText: SubAgentStreamEvent | undefined;
  for (const file of source.files) {
    if (found.size === terms.length) break;
    const input = fs.createReadStream(file, { encoding: 'utf8', signal });
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        signal?.throwIfAborted();
        let event: SubAgentStreamEvent;
        try { event = JSON.parse(line) as SubAgentStreamEvent; } catch { suffix = ''; lastText = undefined; continue; }
        if (!event || event.parentAgentId !== agentId || event.subAgentId !== subId || typeof event.content !== 'string') {
          suffix = ''; lastText = undefined; continue;
        }
        if (event.eventType === 'text' && !event.imagePath) {
          if (!lastText || lastText.turnId !== event.turnId
            || lastText.nestedUnderToolUseId !== event.nestedUnderToolUseId
            || (!lastText.turnId && boundaries.some((ts) => ts > lastText!.timestamp && ts <= event.timestamp))) suffix = '';
          const text = suffix + event.content;
          matchText(text, terms, found);
          suffix = fold(text).slice(-tailLength);
          lastText = event;
        } else {
          suffix = '';
          lastText = undefined;
          if (event.eventType === 'result') matchText(event.content, terms, found);
        }
        if (found.size === terms.length) break;
      }
    } catch (error) {
      // A session need not have either file yet. Other failures must not look like an empty search.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    } finally {
      lines.close();
      input.destroy();
    }
  }
  const matched = terms.filter((term) => found.has(term));
  // Do not cache a partial view if a running session changed/compacted while it was read.
  if (prepareStreamSearch(dir, subId).stamp === source.stamp) {
    cache.delete(key);
    cache.set(key, { stamp: source.stamp, terms: matched });
    while (cache.size > SEARCH_CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return matched;
}

export interface ConversationSearchInput {
  agentId: string;
  projects: readonly ProjectInfo[];
  subIds: readonly string[];
  commands: readonly QueuedCommand[];
  terms: readonly string[];
  signal?: AbortSignal;
}

/** Matching terms, not whole transcripts, cross the HTTP boundary. Empty subId belongs to the main tab. */
export async function searchSessionConversations(input: ConversationSearchInput): Promise<Record<string, string[]>> {
  const { agentId, projects, commands, terms, signal } = input;
  signal?.throwIfAborted();
  const matches: Record<string, string[]> = Object.create(null);
  if (terms.length === 0) return matches;
  const bySub = new Map<string, QueuedCommand[]>();
  for (const command of commands) {
    if (command.silent) continue;
    const id = command.subAgentId ?? '';
    const list = bySub.get(id) ?? [];
    list.push(command);
    bySub.set(id, list);
  }
  const dirs = [...new Set(projects.filter((project) => project.path).map((project) => subStreamsDir(project, agentId)))];
  for (const subId of new Set([...input.subIds, ...bySub.keys()])) {
    signal?.throwIfAborted();
    const found = new Set<string>();
    const subCommands = bySub.get(subId) ?? [];
    for (const command of subCommands) {
      matchText(command.text, terms, found);
      if (command.result) matchText(command.result, terms, found);
    }
    const boundaries = subCommands.filter((command) => command.status !== 'queued' || command.startedAt !== undefined)
      .map((command) => command.startedAt ?? command.timestamp).sort((a, b) => a - b);
    if (subId) for (const dir of dirs) {
      const missing = terms.filter((term) => !found.has(term));
      if (missing.length === 0) break;
      for (const term of await searchStreamFiles(dir, agentId, subId, missing, boundaries, signal)) found.add(term);
    }
    if (found.size > 0) matches[subId] = terms.filter((term) => found.has(term));
  }
  return matches;
}
