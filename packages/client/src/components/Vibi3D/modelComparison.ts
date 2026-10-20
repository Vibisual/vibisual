import { creationStableJson } from '@vibisual/shared';
type Bag = Record<string, unknown>;
const bag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);
interface NodeState { id: string; name: string; locked: boolean; signature: string; }
function nodes(payload: unknown): Map<string, NodeState> {
  const result = new Map<string, NodeState>();
  if (!bag(payload) || !bag(payload.scene)) return result;
  const resources = new Map<string, unknown>();
  for (const key of ['geometries', 'materials', 'textures', 'images']) {
    const entries = payload.scene[key];
    if (Array.isArray(entries)) for (const item of entries) if (bag(item) && typeof item.uuid === 'string') resources.set(item.uuid, item);
  }
  const resolve = (value: unknown, seen = new Set<string>()): unknown => {
    if (typeof value === 'string' && resources.has(value) && !seen.has(value)) return resolve(resources.get(value), new Set([...seen, value]));
    if (Array.isArray(value)) return value.map((item) => resolve(item, seen));
    if (bag(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'uuid' ? item : resolve(item, seen)]));
    return value;
  };
  const visit = (value: unknown, ancestors: unknown[], inheritedLock: boolean): void => {
    if (!bag(value)) return;
    const data = bag(value.userData) ? value.userData : {};
    const id = typeof data.vibi3dId === 'string' ? data.vibi3dId : String(value.uuid);
    const locked = inheritedLock || data.vibi3dLocked === true;
    const { children, ...self } = value;
    const animations = Array.isArray(payload.clips) ? payload.clips.flatMap((clip) => bag(clip) && Array.isArray(clip.tracks)
      ? clip.tracks.filter((track) => {
        if (!bag(track) || typeof track.name !== 'string') return false;
        const name = track.name;
        return [value.uuid, value.name].some((target) => typeof target === 'string' && name.startsWith(`${target}.`));
      }) : []) : [];
    result.set(id, { id, name: typeof value.name === 'string' ? value.name : id, locked,
      signature: creationStableJson({ self: resolve(self), ancestors, animations,
        ...(locked ? { children: Array.isArray(children) ? children.map((child) => bag(child) ? child.uuid : child) : [] } : {}) }) });
    if (Array.isArray(children)) children.forEach((child) => visit(child, [...ancestors, value.matrix ?? value.position ?? null], locked));
  };
  visit(payload.scene.object, [], false);
  return result;
}
export interface ModelChange { id: string; name: string; kind: 'added' | 'changed' | 'removed'; protected: boolean; }
export function compareModelSources(before: unknown, after: unknown): ModelChange[] {
  const left = nodes(before); const right = nodes(after); const changes: ModelChange[] = [];
  for (const [id, old] of left) {
    const next = right.get(id);
    if (!next || next.signature !== old.signature) changes.push({ id, name: old.name, kind: next ? 'changed' : 'removed', protected: old.locked });
  }
  for (const [id, node] of right) if (!left.has(id)) changes.push({ id, name: node.name, kind: 'added', protected: false });
  return changes;
}
