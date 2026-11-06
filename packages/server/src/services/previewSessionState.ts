import type { BubbleData } from '@vibisual/shared';
import { isPreviewBundleFile } from '@vibisual/shared';

export interface PreviewSessionState {
  sessions: Map<string, string[]>;
  folderFiles: Map<string, Set<string>>;
}

/**
 * Who used which preview, indexed by every ancestor folder. Ownership only — it keeps nothing alive;
 * previews follow the ordinary bubble lifecycle (§2.4 confirm dismiss · idle TTL).
 */
export function buildPreviewSessionState(
  nodes: ReadonlyMap<string, BubbleData>,
  children: ReadonlyMap<string, ReadonlySet<string>>,
  liveOwners: ReadonlySet<string>,
  legacyRefs: ReadonlyMap<string, ReadonlySet<string>>,
): PreviewSessionState {
  const state: PreviewSessionState = { sessions: new Map(), folderFiles: new Map() };
  const parents = new Map<string, string[]>();
  for (const [parent, keys] of children) for (const key of keys) {
    const list = parents.get(key);
    if (list) list.push(parent);
    else parents.set(key, [parent]);
  }
  const ancestors = new Map<string, string[]>();
  const ancestorsOf = (key: string): string[] => {
    const cached = ancestors.get(key);
    if (cached) return cached;
    const seen = new Set<string>();
    const queue = [key];
    while (queue.length) {
      const current = queue.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...(parents.get(current) ?? []));
    }
    const result = [...seen];
    ancestors.set(key, result);
    return result;
  };
  for (const [key, node] of nodes) {
    if (node.bubbleType !== 'file' || (!node.previewSessions && !isPreviewBundleFile(node.absolutePath ?? node.path))) continue;
    const sessions = Object.entries(node.previewSessions ?? {})
      .filter(([, owner]) => liveOwners.has(owner)).map(([session]) => session);
    const hasOwner = sessions.length > 0 || [...(legacyRefs.get(key) ?? [])].some((owner) => liveOwners.has(owner));
    if (!hasOwner) continue;
    state.sessions.set(key, sessions);
    for (const immediate of parents.get(key) ?? []) for (const parent of ancestorsOf(immediate)) {
      if (!nodes.has(parent)) continue;
      const files = state.folderFiles.get(parent);
      if (files) files.add(key);
      else state.folderFiles.set(parent, new Set([key]));
    }
  }
  return state;
}
