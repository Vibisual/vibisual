import { getVibi3DCommandDefinition } from './vibi3dCommandCatalog.js';

/** App-local bounds match the existing authenticated JSON parser; they do not widen core ingress. */
export const VIBI3D_LIMITS = {
  commandCount: 500, requestBytes: 8 * 1024 * 1024, commandTimeoutMs: 300_000,
  placements: 10_000, moduleParts: 128, modules: 256, snapshotNodes: 20_000,
} as const;
export function getVibi3DRequestTimeoutMs(commands: readonly { type: string }[]): number {
  const longest = Math.max(30_000, ...commands.map(command => getVibi3DCommandDefinition(command.type)?.timeoutMs ?? 30_000));
  return Math.min(VIBI3D_LIMITS.commandTimeoutMs, longest + Math.max(0, commands.length - 1) * 1000);
}
export function vibi3DJsonBytes(value: unknown): number {
  try { const json = JSON.stringify(value); return typeof json === 'string' ? new TextEncoder().encode(json).byteLength : Infinity; }
  catch { return Infinity; }
}
