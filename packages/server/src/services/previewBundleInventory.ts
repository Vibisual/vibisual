import { withComputeMemory } from '@vibisual/compute';
import { bundleSatelliteKey, kindBundleCommonDir, previewBundleKindOf, type BubbleData, type KindBundleKind } from '@vibisual/shared';
import { HOST_PLATFORM } from './pathKey.js';

export interface PreviewInventoryGroup {
  kind: KindBundleKind;
  sessionId: string;
  keys: string[];
  dir: string;
}

export function orderPreviewKeys(keys: readonly string[], nodes: ReadonlyMap<string, BubbleData>): string[] {
  if (keys.length < 2) return [...keys];
  const count = keys.length;
  const offsetsBytes = (count + 1) * Uint32Array.BYTES_PER_ELEMENT;
  const timesBytes = count * Float64Array.BYTES_PER_ELEMENT;
  const nameLength = keys.reduce((sum, key) => sum + key.length, 0);
  return withComputeMemory(timesBytes + offsetsBytes + nameLength * Uint16Array.BYTES_PER_ELEMENT, count * Uint32Array.BYTES_PER_ELEMENT, (ctx, input, output) => {
    const times = new Float64Array(ctx.memory.buffer, input, count);
    const offsets = new Uint32Array(ctx.memory.buffer, input + timesBytes, count + 1);
    const names = new Uint16Array(ctx.memory.buffer, input + timesBytes + offsetsBytes, nameLength);
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      const key = keys[i]!;
      const at = nodes.get(key)?.lastActivity ?? 0;
      times[i] = Number.isFinite(at) ? at : 0;
      offsets[i] = cursor;
      for (let c = 0; c < key.length; c++) names[cursor++] = key.charCodeAt(c);
    }
    offsets[count] = cursor;
    const written = ctx.exports.preview_order(input, input + timesBytes, input + timesBytes + offsetsBytes, count, output);
    if (written !== count) throw new Error('Invalid preview ordering result');
    const indices = new Uint32Array(ctx.memory.buffer, output, count);
    return Array.from(indices, (index) => keys[index]!);
  });
}

export function buildPreviewInventory(
  keys: readonly string[],
  nodes: ReadonlyMap<string, BubbleData>,
  sessions: ReadonlyMap<string, readonly string[]>,
): Map<string, PreviewInventoryGroup> {
  const groups = new Map<string, PreviewInventoryGroup>();
  const add = (kind: KindBundleKind, sessionId: string, key: string): void => {
    const token = bundleSatelliteKey(kind, sessionId);
    const group = groups.get(token);
    if (group) group.keys.push(key);
    else groups.set(token, { kind, sessionId, keys: [key], dir: '' });
  };
  for (const key of orderPreviewKeys(keys, nodes)) {
    const node = nodes.get(key);
    const kind = node?.bubbleType === 'file' ? previewBundleKindOf(key) : null;
    if (!kind) continue;
    // §5.1 #2-1 (B) — the canvas bundles a kind regardless of session; per-session groups serve the IDE session map.
    add(kind, '', key);
    for (const sessionId of sessions.get(key) ?? []) if (sessionId) add(kind, sessionId, key);
  }
  for (const group of groups.values()) group.dir = kindBundleCommonDir(group.keys, HOST_PLATFORM);
  return groups;
}
