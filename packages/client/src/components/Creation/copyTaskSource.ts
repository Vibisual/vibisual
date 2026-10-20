import type { CreationDoc } from '@vibisual/shared';
import { createCreationDoc } from './creationApi.js';

/** Copy accepted source data only. The old document retains its entire review queue and history. */
export function copyTaskSource(projectId: string, source: CreationDoc, title: string, requestId: string): Promise<CreationDoc> {
  return createCreationDoc(projectId, {
    appId: source.appId, title, requestId,
    payload: structuredClone(source.payload), parameters: structuredClone(source.parameters),
    lockedPaths: [...source.lockedPaths], links: structuredClone(source.links.map(({ keptRevision: _kept, ...link }) => link)),
  });
}
