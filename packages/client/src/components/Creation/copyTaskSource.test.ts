import { expect, it, vi } from 'vitest';
import type { CreationDoc } from '@vibisual/shared';
const create = vi.hoisted(() => vi.fn());
vi.mock('./creationApi.js', () => ({ createCreationDoc: create }));
import { copyTaskSource } from './copyTaskSource.js';

it('copies accepted data and pinned references without touching the old document or its pending proposals', async () => {
  const source: CreationDoc = { schemaVersion: 1, appId: 'vibi3d', id: 'old', title: 'Original', revision: 7,
    payload: { generatorCode: 'code', authoring: { scale: 2 }, scene: { object: { uuid: 'stable' } } }, parameters: { size: 4 },
    links: [{ id: 'texture', sourceId: 'image', sourceRevision: 2, role: 'map', targets: ['stable'] }], lockedPaths: ['/scene/object'],
    createdAt: 1, updatedAt: 2, label: '', author: 'user' };
  create.mockResolvedValue({ ...source, id: 'copy' });
  expect((await copyTaskSource('project', source, 'Other version', 'retry-id')).id).toBe('copy');
  expect(create).toHaveBeenCalledWith('project', { appId: 'vibi3d', title: 'Other version', requestId: 'retry-id',
    payload: source.payload, parameters: source.parameters, links: source.links, lockedPaths: source.lockedPaths });
  const body = create.mock.calls[0]![1];
  body.links[0].targets.push('other'); body.parameters.size = 5;
  expect(source.links[0]!.targets).toEqual(['stable']); expect(source.parameters.size).toBe(4);
});
