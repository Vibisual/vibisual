import { useCallback, useEffect, useState } from 'react';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_REFRESH_MS = 15_000;
const SEARCH_TIMEOUT_MS = 30_000;
const SEARCH_CONCURRENCY = 3;
type HistoryMatches = Record<string, string[]>;
interface HistorySearchState {
  key: string;
  matches: HistoryMatches;
  pending: boolean;
  failed: boolean;
}

function readMatches(value: unknown): HistoryMatches {
  if (!value || typeof value !== 'object' || !('matches' in value) ||
    !value.matches || typeof value.matches !== 'object' || Array.isArray(value.matches)) {
    throw new Error('Invalid conversation search response');
  }
  const matches: HistoryMatches = {};
  for (const [sessionId, terms] of Object.entries(value.matches)) {
    if (!Array.isArray(terms) || !terms.every((term): term is string => typeof term === 'string')) {
      throw new Error('Invalid conversation search matches');
    }
    matches[sessionId] = terms;
  }
  return matches;
}

/** Fetch matches, never hydrate entire conversations into the board's stream store. */
export function useCommandCenterHistorySearch(
  projectId: string,
  agentIds: readonly string[],
  terms: readonly string[],
): { matches: HistoryMatches; pending: boolean; failed: boolean; retry: () => void } {
  // Content keys keep snapshot rerenders from restarting an in-flight search.
  const key = JSON.stringify([projectId, [...new Set(agentIds)].sort(), [...new Set(terms)].sort()]);
  const enabled = agentIds.length > 0 && terms.length > 0;
  const [state, setState] = useState<HistorySearchState>({ key: '', matches: {}, pending: false, failed: false });
  const [retryId, setRetryId] = useState(0);
  const retry = useCallback(() => setRetryId((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    const [, ids, words] = JSON.parse(key) as [string, string[], string[]];
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;

    const search = async (): Promise<void> => {
      controller = new AbortController();
      const signal = controller.signal;
      const timeout = setTimeout(() => controller?.abort(), SEARCH_TIMEOUT_MS);
      setState((previous) => ({ key, matches: previous.key === key ? previous.matches : {}, pending: true, failed: false }));
      const matches: HistoryMatches = {};
      let failed = false;
      let next = 0;
      const worker = async (): Promise<void> => {
        while (!disposed && !signal.aborted && next < ids.length) {
          const agentId = ids[next++];
          if (!agentId) continue;
          try {
            const response = await fetch(
              `/api/subagent-streams/${encodeURIComponent(agentId)}?searchTerms=${encodeURIComponent(JSON.stringify(words))}`,
              { signal },
            );
            if (!response.ok) throw new Error(`Conversation search HTTP ${response.status}`);
            const found = readMatches(await response.json());
            const main = new Set<string>();
            for (const [subId, hits] of Object.entries(found)) {
              const validHits = hits.filter((term) => words.includes(term));
              if (subId) matches[`${agentId}::${subId}`] = validHits;
              for (const term of validHits) main.add(term);
            }
            matches[`${agentId}::main`] = [...main];
          } catch {
            failed = true;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, ids.length) }, worker));
      clearTimeout(timeout);
      if (disposed) return;
      setState({ key, matches, pending: false, failed: failed || signal.aborted });
      timer = setTimeout(refresh, SEARCH_REFRESH_MS);
    };
    const refresh = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer = setTimeout(refresh, SEARCH_REFRESH_MS);
      } else {
        void search();
      }
    };
    timer = setTimeout(() => { void search(); }, SEARCH_DEBOUNCE_MS);
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [enabled, key, retryId]);

  const current = enabled && state.key === key;
  return {
    matches: current ? state.matches : {},
    pending: enabled && (!current || state.pending),
    failed: current && state.failed,
    retry,
  };
}
