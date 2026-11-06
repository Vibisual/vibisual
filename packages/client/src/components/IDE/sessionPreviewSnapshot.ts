import { isPreviewBundleFile, pathKey, previewBundleKindOf, type BubbleData, type PlatformName } from '@vibisual/shared';

/** 호출 이력이 아닌 정확한 세션 소유권으로 경로만 보충한다. */
export function sessionPreviewPaths(
  nodeMap: Readonly<Record<string, BubbleData>>,
  satellites: Readonly<Record<string, readonly BubbleData[]>>,
  children: Readonly<Record<string, readonly BubbleData[]>>,
  sessionId: string | null,
  platform: PlatformName,
): string[] {
  if (sessionId === null) return [];
  const paths = new Map<string, string>();
  const take = (node: BubbleData): void => {
    if (node.bubbleType !== 'file' || !node.absolutePath || !node.previewSessionIds?.includes(sessionId)) return;
    if (!isPreviewBundleFile(node.absolutePath)) return;
    const key = pathKey(node.absolutePath, platform);
    if (!paths.has(key)) paths.set(key, node.absolutePath);
  };
  for (const node of Object.values(nodeMap)) take(node);
  for (const nodes of Object.values(satellites)) for (const node of nodes) take(node);
  for (const nodes of Object.values(children)) for (const node of nodes) take(node);
  return [...paths.values()];
}

/** 범위가 좁아진 스냅샷이 이미 확인한 세션 파일을 지우지 않는다. */
export function retainSessionPreviewPaths(previous: readonly string[], incoming: readonly string[], platform: PlatformName): readonly string[] {
  const seen = new Set(previous.map((path) => pathKey(path, platform)));
  const added: string[] = [];
  for (const path of incoming) {
    const key = pathKey(path, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(path);
  }
  return added.length === 0 ? previous : [...previous, ...added];
}

/** Snapshot representatives retain each folder/session's full count without loading its files. */
export function sessionPreviewBundleSummaries(
  nodeMap: Readonly<Record<string, BubbleData>>, satellites: Readonly<Record<string, readonly BubbleData[]>>,
  children: Readonly<Record<string, readonly BubbleData[]>>, sessionId: string | null, rootPath: string | null, platform: PlatformName,
): Record<string, string> {
  const summaries: Record<string, string> = {};
  if (sessionId === null) return summaries;
  const take = (node: BubbleData): void => {
    if (node.bubbleType !== 'file' || !node.previewSessionIds?.includes(sessionId) || !node.folderNodeId) return;
    const folder = nodeMap[node.folderNodeId];
    const folderPath = folder?.absolutePath ?? (folder?.bubbleType === 'root' ? rootPath : null);
    const count = node.previewSessionCounts?.[sessionId];
    const kind = previewBundleKindOf(node.absolutePath || node.path);
    if (!folderPath || !kind || count === undefined || !Number.isSafeInteger(count) || count < 1) return;
    summaries[`${pathKey(folderPath, platform)}\u0000${kind}`] = JSON.stringify([count, node.previewSessionDirs?.[sessionId] ?? '']);
  };
  for (const node of Object.values(nodeMap)) take(node);
  for (const nodes of Object.values(satellites)) for (const node of nodes) take(node);
  for (const nodes of Object.values(children)) for (const node of nodes) take(node);
  return summaries;
}
