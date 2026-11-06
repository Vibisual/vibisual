import { pathKey, previewBundleKindOf, type BubbleData, type PlatformName } from '@vibisual/shared';
import { canvasTwinIdOf, type SessionCanvasEntry, type SessionCanvasGraph } from './sessionCanvasGraph.js';
import { sessionPreviewFileOf } from './sessionBubbles.js';

export function sessionBundleQueryFolderId(
  graph: SessionCanvasGraph,
  folderId: string | null,
  nodeMap: Record<string, BubbleData>,
  nodeProjects: Record<string, string>,
  project: string | null,
  platform: PlatformName,
): string | null {
  if (folderId === null || folderId === '' || folderId === graph.bundleRoot?.id) return '';
  const entry = graph.entries.get(folderId);
  return entry?.kind === 'folder' ? canvasTwinIdOf(entry, { nodeMap, nodeProjects, project, platform }) : null;
}

/** A missing snapshot twin may still identify one exact folder; never widen it to the project root. */
export function sessionBundleQueryLocation(
  graph: SessionCanvasGraph, localFolderId: string | null, queryFolderId: string | null,
): { folderId: string; folderAbsolutePath?: string } | null {
  if (queryFolderId !== null) return { folderId: queryFolderId };
  const entry = localFolderId === null ? undefined : graph.entries.get(localFolderId);
  return entry?.kind === 'folder' ? { folderId: '', folderAbsolutePath: entry.folder.path } : null;
}

export function sessionBundlePageEntry(graph: SessionCanvasGraph, node: BubbleData | undefined, platform: PlatformName): SessionCanvasEntry | null {
  if (node?.bubbleType !== 'file' || !node.absolutePath || previewBundleKindOf(node.absolutePath) === null) return null;
  const id = `sb:file:${pathKey(node.absolutePath, platform)}`;
  return graph.entries.get(id) ?? { kind: 'file', file: sessionPreviewFileOf(node.absolutePath, platform) };
}

/** The page API owns membership; only this session's loaded events own activity facts. */
export function sessionBundlePageNodes(
  nodes: readonly BubbleData[], graph: SessionCanvasGraph, sessionId: string | null, platform: PlatformName,
): BubbleData[] {
  return nodes.flatMap((node) => {
    const entry = sessionBundlePageEntry(graph, node, platform);
    if (entry?.kind !== 'file') return [];
    const id = `sb:file:${entry.file.key}`;
    const known = graph.nodeMap[id];
    return [{ ...node, ...(known ?? {}), id, status: known?.status ?? 'idle',
      activity: known?.activity ?? 0, readCount: known?.readCount, writeCount: known?.writeCount,
      lastActivity: known?.lastActivity, lastTool: known?.lastTool,
      ...(sessionId ? { previewSessionIds: [sessionId] } : {}),
    }];
  });
}
