import { FOLDER_BUBBLE_TYPES, SATELLITE_MAX_BOUNDS, pathKey, type BubbleData, type PlatformName } from '@vibisual/shared';

function folderValues<T>(
  nodeMap: Readonly<Record<string, BubbleData>>,
  nodeProjects: Readonly<Record<string, string>>,
  project: string | null,
  platform: PlatformName,
  valueOf: (node: BubbleData) => T | undefined,
): Record<string, T> {
  const folders = new Map<string, BubbleData>();
  for (const node of Object.values(nodeMap)) {
    if (!FOLDER_BUBBLE_TYPES.has(node.bubbleType) || !node.absolutePath) continue;
    const key = pathKey(node.absolutePath, platform);
    if (folders.has(key) && (project === null || nodeProjects[node.id] !== project)) continue;
    folders.set(key, node);
  }
  const out: Record<string, T> = {};
  for (const [key, node] of folders) {
    const value = valueOf(node);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** 세션 지도와 캔버스가 같은 폴더의 문서 위성 상한을 공유한다. */
export function canvasFolderSatelliteMaxes(
  nodeMap: Readonly<Record<string, BubbleData>>,
  nodeProjects: Readonly<Record<string, string>>,
  project: string | null,
  platform: PlatformName,
): Record<string, number> {
  return folderValues(nodeMap, nodeProjects, project, platform, (node) => {
    const value = node.maxSatellites;
    return value === undefined || !Number.isFinite(value) ? undefined
      : Math.min(SATELLITE_MAX_BOUNDS.MAX, Math.max(SATELLITE_MAX_BOUNDS.MIN, Math.floor(value)));
  });
}

export function canvasFolderBundleSatelliteMaxes(
  nodeMap: Readonly<Record<string, BubbleData>>,
  nodeProjects: Readonly<Record<string, string>>,
  project: string | null,
  platform: PlatformName,
): Record<string, Record<string, number>> {
  return folderValues(nodeMap, nodeProjects, project, platform, (node) => node.bundleMaxSatellites);
}

export function canvasRootBundleSatelliteMaxes(
  nodeMap: Readonly<Record<string, BubbleData>>,
  nodeProjects: Readonly<Record<string, string>>,
  project: string | null,
): Record<string, number> | undefined {
  if (project === null) return undefined;
  const root = Object.values(nodeMap).find((node) => node.bubbleType === 'root'
    && (nodeProjects[node.id] === project || (nodeProjects[node.id] === undefined && node.label === project)));
  return root?.bundleMaxSatellites;
}
