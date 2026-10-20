import { create } from 'zustand';
import type { AgentCardTaskBook, AppBubble } from '@vibisual/shared';

export const CARD_TASK_DRAFT = '__card_task_draft__';
export const cardTaskKey = (projectId: string, agentId: string): string => JSON.stringify([projectId, agentId]);
export interface CardTaskEntry {
  book?: AgentCardTaskBook;
  loading?: boolean;
  error?: string;
  mode?: 'new' | 'copy';
}
export const useCardTaskStore = create<{
  entries: Record<string, CardTaskEntry>;
  patch: (key: string, patch: Partial<CardTaskEntry>) => void;
}>((set) => ({
  entries: {},
  patch: (key, patch) => set((state) => ({ entries: { ...state.entries, [key]: { ...state.entries[key], ...patch } } })),
}));

const endpoint = (projectId: string, agentId: string): string =>
  `/api/agent-card-tasks/${encodeURIComponent(agentId)}?projectId=${encodeURIComponent(projectId)}`;

export async function loadCardTasks(projectId: string, agentId: string): Promise<AgentCardTaskBook> {
  const response = await fetch(endpoint(projectId, agentId));
  const data = await response.json() as { book?: AgentCardTaskBook };
  if (!response.ok || !data.book) throw new Error('history-unavailable');
  const key = cardTaskKey(projectId, agentId);
  const current = useCardTaskStore.getState().entries[key]?.book;
  if (!current || current.revision <= data.book.revision) {
    const error = useCardTaskStore.getState().entries[key]?.error;
    useCardTaskStore.getState().patch(key, { book: data.book, loading: false,
      ...(error === 'history-unavailable' ? { error: undefined } : {}) });
  }
  return data.book;
}

/** The server owns the revision: a second window cannot claim the same reservation. */
export async function saveCardTasks(projectId: string, agentId: string, book: AgentCardTaskBook): Promise<AgentCardTaskBook> {
  const response = await fetch(endpoint(projectId, agentId), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: book.revision, book }),
  });
  const data = await response.json() as { book?: AgentCardTaskBook; error?: string };
  const key = cardTaskKey(projectId, agentId);
  const current = useCardTaskStore.getState().entries[key]?.book;
  if (data.book && (!current || current.revision <= data.book.revision))
    useCardTaskStore.getState().patch(key, { book: data.book });
  if (!response.ok || !data.book) throw new Error(data.error ?? 'history-save-failed');
  return data.book;
}

/** Only the active task (plus newly linked, unassigned nodes) can receive the next request. */
export function cardTaskNodes<T extends { id: string }>(nodes: readonly T[], book?: AgentCardTaskBook): T[] {
  const active = book?.tasks.find((task) => task.id === book.activeTaskId);
  if (!book || !active) return [...nodes];
  const owned = new Set(book.tasks.flatMap((task) => task.nodeIds));
  const selected = new Set(active.nodeIds);
  return nodes.filter((node) => selected.has(node.id) || !owned.has(node.id));
}

/** Archived nodes remain stored and addressable; shared/pinned nodes stay visible. */
export function archivedCardTaskNodes(entries: Record<string, CardTaskEntry>, bubbles: readonly AppBubble[], cardAgentIds?: ReadonlySet<string>): Set<string> {
  const archived = new Map<string, Set<string>>();
  const active = new Set<string>();
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry.book) continue;
    let agentId: string;
    try { agentId = (JSON.parse(key) as string[])[1]!; } catch { continue; }
    if (cardAgentIds && !cardAgentIds.has(agentId)) continue;
    for (const task of entry.book.tasks) {
      for (const id of task.nodeIds) {
        if (task.id === entry.book.activeTaskId) active.add(id);
        else { const owners = archived.get(id) ?? new Set<string>(); owners.add(agentId); archived.set(id, owners); }
      }
    }
  }
  return new Set(bubbles.filter((bubble) => !bubble.preservePinned && !active.has(bubble.id)
    && archived.has(bubble.id)
    && (bubble.linkedAgentIds?.length ?? 0) > 0
    && (bubble.linkedAgentIds ?? []).every((agentId) => archived.get(bubble.id)!.has(agentId))).map((bubble) => bubble.id));
}

/** Ask only for an unqualified creation request; 'new windows' is still an edit. */
export function needsCardTaskDestination(text: string, hasCurrent: boolean): boolean {
  if (!hasCurrent || text.trim().length > 500) return false;
  if (/(현재|기존|여기|이것|이거|이\s*(건물|모델|장면|영상|그림)|추가|옆|안에|수정|바꿔|변경|색|창문|크기|다시|\b(this|current|existing|add|change|edit|replace|color|resize)\b)/i.test(text)) return false;
  return /(만들어\s*줘|만들어\s*주세요|제작해\s*줘|생성해\s*줘|\b(create|build|generate|make)\b)/i.test(text);
}
