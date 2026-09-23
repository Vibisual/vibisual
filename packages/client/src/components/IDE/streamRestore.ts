/** Restore a server window only after its leading edge reaches the last connected window. */
import type { SubAgentStreamEvent } from '@vibisual/shared';
import { STREAM_HISTORY_PAGE_EVENTS } from '@vibisual/shared';
import { useGraphStore } from '../../stores/graphStore.js';
import { mergeDeepWindow } from './streamGapFill.js';

export function olderHistoryUrl(agentId: string, sessionId: string, first: SubAgentStreamEvent, limit: number): string {
  const q = new URLSearchParams({ beforeId: first.id, beforeTs: String(first.timestamp), limit: String(limit) });
  return `/api/subagent-streams/${encodeURIComponent(agentId)}/${encodeURIComponent(sessionId)}/older?${q.toString()}`;
}

/** An older local window can also survive a tab switch without a transport reconnect. */
function previousWindowAnchor(server: readonly SubAgentStreamEvent[], prev: readonly SubAgentStreamEvent[]): SubAgentStreamEvent | undefined {
  const first = server[0];
  if (!first || prev.some((e) => e.id === first.id)) return undefined;
  const serverIds = new Set(server.map((e) => e.id));
  const shared = prev.findIndex((e) => serverIds.has(e.id));
  if (shared > 0) return prev[shared - 1];
  if (shared === 0) return undefined;
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i]!.timestamp <= first.timestamp) return prev[i];
  }
  return undefined;
}

export interface StreamRestoreRequest {
  epoch: number;
  cancelled?: () => boolean;
  depth?: 'deep' | 'shallow';
}

function takeNewEvents(events: readonly SubAgentStreamEvent[], ids: Set<string>): SubAgentStreamEvent[] {
  return events.filter((event) => {
    if (ids.has(event.id)) return false;
    ids.add(event.id);
    return true;
  });
}

/**
 * /older also bridges a reconnect gap larger than the server's tail window. Nothing is committed until
 * the seam is joined: otherwise a failed intermediate request would leave a permanent hole behind the
 * buffer's first event, outside the normal upward-pagination path. New live events are merged at commit.
 */
export async function restoreStreamWindow(
  agentId: string,
  sessionId: string,
  server: readonly SubAgentStreamEvent[],
  request: StreamRestoreRequest,
): Promise<boolean> {
  const current = (): boolean => !request.cancelled?.() && useGraphStore.getState().streamRestoreEpoch === request.epoch;
  if (!current() || server.length === 0) return false;
  const start = useGraphStore.getState();
  const anchor = start.streamReconnectAnchors[sessionId]
    ?? previousWindowAnchor(server, start.subAgentStreams[sessionId] ?? []);
  const ids = new Set<string>();
  let restoredWindow = takeNewEvents(server, ids);
  let paged = false;
  try {
    while (anchor && !ids.has(anchor.id)) {
      if (!current()) return false;
      const first = restoredWindow[0]!;
      const response = await fetch(olderHistoryUrl(agentId, sessionId, first, STREAM_HISTORY_PAGE_EVENTS));
      if (!response.ok || !current()) return false;
      const page = await response.json() as { events?: SubAgentStreamEvent[]; hasMore?: boolean; unresolved?: boolean };
      if (!current() || page.unresolved) return false;
      const older = takeNewEvents(page.events ?? [], ids);
      if (older.length === 0 && page.hasMore === true) return false; // Broken cursor; retry, never declare a hole restored.
      restoredWindow = [...older, ...restoredWindow];
      paged = true;
      if (page.hasMore !== true) break; // The server has no earlier history (including removed legacy anchors).
    }
    if (!current()) return false;
    const st = useGraphStore.getState();
    st.loadStreamBuffers({ [sessionId]: mergeDeepWindow(restoredWindow, st.subAgentStreams[sessionId] ?? []) }, request.depth ?? 'deep', {
      epoch: request.epoch,
      preserveHistory: paged,
    });
    return true;
  } catch {
    return false;
  }
}
