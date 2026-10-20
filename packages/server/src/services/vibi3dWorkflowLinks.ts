import type { CreationLink, CreationValue } from '@vibisual/shared';
import { CreationError } from './creationStore.js';

type Node = Record<string, CreationValue>;
type Parents = Map<string, Set<string>>;
const node = (value: CreationValue | undefined): Node | null => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
/** Stable authoring IDs, never array positions. Keep each scene revision's hierarchy separate. */
function hierarchy(payload: CreationValue): Parents {
  const root = node(node(node(payload)?.scene)?.object);
  const parents: Parents = new Map();
  const pending: Array<{ value: Node; parent: string | null }> = root ? [{ value: root, parent: null }] : [];
  while (pending.length) {
    const { value, parent } = pending.pop()!;
    const stored = node(value.userData)?.vibi3dId;
    const id = typeof stored === 'string' && stored ? stored : typeof value.uuid === 'string' ? value.uuid : parent;
    if (id && parent && id !== parent) {
      const ancestors = parents.get(id) ?? new Set<string>(); ancestors.add(parent); parents.set(id, ancestors);
    }
    for (const child of Array.isArray(value.children) ? value.children : []) {
      const entry = node(child); if (entry) pending.push({ value: entry, parent: id });
    }
  }
  return parents;
}
function ancestorMatch(ids: readonly string[], targets: Set<string>, parents: Parents): boolean {
  const visited = new Set<string>(); const pending = [...ids];
  while (pending.length) {
    const id = pending.pop()!;
    if (targets.has(id)) return true;
    if (visited.has(id)) continue;
    visited.add(id); pending.push(...parents.get(id) ?? []);
  }
  return false;
}
/** An agent cannot evade a pin by using a new link id or targeting a parent/child of the pinned surface. */
export function guardWorkflowLinks(previous: CreationLink[], links: CreationLink[], ...payloads: CreationValue[]): void {
  const hierarchies = payloads.map(hierarchy);
  for (const link of links) {
    const prior = previous.filter(old => old.sourceId === link.sourceId && old.role === link.role && old.sourceRevision !== link.sourceRevision);
    const targets = new Set(prior.flatMap(old => old.targets));
    if (!targets.size) continue;
    const incoming = new Set(link.targets);
    if (hierarchies.some(parents => ancestorMatch(link.targets, targets, parents) || ancestorMatch([...targets], incoming, parents))) {
      throw new CreationError(409, 'user-decision-required', undefined, { linkId: link.id });
    }
  }
}
