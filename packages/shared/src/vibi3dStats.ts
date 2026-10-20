export const VIBI3D_STATS_BUDGETS = { objects: 10_000, instances: 10_000, triangles: 2_000_000, drawCalls: 500, textureBytes: 256 * 1024 * 1024 } as const;
export type Vibi3DStatsMetric = keyof typeof VIBI3D_STATS_BUDGETS;
export interface Vibi3DStatsWarning { metric: Vibi3DStatsMetric; value: number; limit: number }
export interface Vibi3DStats {
  sceneRevision: number; objects: number; instances: number; triangles: number; drawCalls?: number;
  drawCallsSource: 'measured' | 'estimated' | 'unavailable'; textureBytes: number; textureBytesEstimated: true;
  warnings: Vibi3DStatsWarning[];
}
export function buildVibi3DStatsWarnings(value: Pick<Vibi3DStats, Vibi3DStatsMetric>): Vibi3DStatsWarning[] {
  return (Object.keys(VIBI3D_STATS_BUDGETS) as Vibi3DStatsMetric[]).flatMap(metric => {
    const current = value[metric], limit = VIBI3D_STATS_BUDGETS[metric];
    return current !== undefined && current > limit ? [{ metric, value: current, limit }] : [];
  });
}
export function validateVibi3DStats(value: unknown): Vibi3DStats | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['sceneRevision', 'objects', 'instances', 'triangles', 'drawCalls', 'drawCallsSource', 'textureBytes', 'textureBytesEstimated', 'warnings'].includes(key))
    || ['sceneRevision', 'objects', 'instances', 'triangles', 'textureBytes'].some(key => !Number.isSafeInteger(input[key]) || Number(input[key]) < 0)
    || (input.drawCalls !== undefined && (!Number.isSafeInteger(input.drawCalls) || Number(input.drawCalls) < 0))
    || !['measured', 'estimated', 'unavailable'].includes(String(input.drawCallsSource)) || input.textureBytesEstimated !== true
    || ((input.drawCallsSource === 'unavailable') !== (input.drawCalls === undefined))) return null;
  const result = { ...input } as unknown as Vibi3DStats;
  // Warnings are derived from measured counters, never accepted as arbitrary renderer messages.
  result.warnings = buildVibi3DStatsWarnings(result);
  return result;
}
