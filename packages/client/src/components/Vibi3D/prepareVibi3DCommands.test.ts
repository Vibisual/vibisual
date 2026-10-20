import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CreationDoc, Vibi3DCommand } from '@vibisual/shared';
import { prepareVibi3DCommands } from './prepareVibi3DCommands.js';
import { ModelEditor } from './modelEditor.js';
import { readTextureSource, renderTextureSource } from './modelImageLink.js';
import { modelTextureReferences } from './modelTextureReferences.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';

vi.mock('./modelImageLink.js', () => ({ readTextureSource: vi.fn(), renderTextureSource: vi.fn() }));
// Source pin/history tests retain real maps at 128px; dedicated quality tests exercise 512/1024px baking.
vi.mock('./modelMaterials.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./modelMaterials.js')>();
  return { ...actual, createModelMaterial: (...args: Parameters<typeof actual.createModelMaterial>) => actual.createModelMaterial({ resolution: 128, ...args[0] }, args[1]) };
});
const imageSource = { kind: 'vibimage' as const, docId: 'artwork' };
const doc = { id: 'model-doc', revision: 4, links: [{ id: 'known', sourceId: 'artwork', sourceRevision: 2, role: 'model-texture', targets: ['wall'] }] } as unknown as CreationDoc;
function editor(): ModelEditor {
  const root = new THREE.Group(); root.userData['vibi3dId'] = 'root';
  const wall = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 0.2), new THREE.MeshStandardMaterial()); wall.userData['vibi3dId'] = 'wall'; root.add(wall);
  return new ModelEditor(root, []);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readTextureSource).mockImplementation(async (_project, id, revision) => ({ id, revision: revision ?? 99 }) as CreationDoc);
  vi.mocked(renderTextureSource).mockImplementation(async () => ({ texture: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), hasAlpha: true }));
});
describe('prepared decoration batches', () => {
  it('uses pinned image sources through real commands, snapshots, source roundtrip and undo', async () => {
    const model = editor();
    const commands: Vibi3DCommand[] = [
      { type: 'sign', id: 'sign', source: imageSource, kind: 'projecting', lit: true },
      { type: 'mascot', id: 'standee', style: 'standee', source: imageSource },
      { type: 'decal', id: 'decal', target: 'wall', source: imageSource, position: [0, 0, 0.1], normal: [0, 0, 1], size: [1, 1], projection: 'flat' },
    ];
    const prepared = await prepareVibi3DCommands('project', doc, commands, 'batch', model.object);
    expect(model.revision).toBe(0); expect(vi.mocked(readTextureSource).mock.calls).toEqual([['project', 'artwork', 2]]);
    const result = model.apply(prepared.commands, 0, prepared); prepared.dispose();
    expect(result.nodes.find(node => node.id === 'sign')?.sign?.text).toBe('');
    expect(result.nodes.find(node => node.id === 'decal')?.decal?.target).toBe('wall');
    expect(result.nodes.find(node => node.id === 'standee')?.mascot?.style).toBe('standee');
    const links = modelTextureReferences(model.object, doc.links);
    expect(links.every(link => link.sourceRevision === 2 && link.role === 'model-texture')).toBe(true);
    expect(links.flatMap(link => link.targets)).not.toContain('standee');
    const payload = serializeModelSource(model.object, []), opened = await loadModelSource(payload);
    expect(modelTextureReferences(opened.object, links)).toEqual(links);
    model.undo(); expect(model.findObject('sign')).toBeUndefined(); model.redo(); expect(model.findObject('sign')).toBeDefined();
  });
  it('merges successive partial sign edits in command order without changing the input or advancing source revisions', async () => {
    const model = editor(), input: Vibi3DCommand[] = [{ type: 'sign', id: 'sign', source: imageSource }, { type: 'sign', id: 'sign', size: [5, 1] }];
    const prepared = await prepareVibi3DCommands('project', doc, input, 'batch', model.object);
    model.apply(prepared.commands, 0, prepared); prepared.dispose();
    const sign = model.snapshot().nodes.find(node => node.id === 'sign')!.sign!;
    expect(sign.source).toEqual(imageSource); expect(sign.text).toBe(''); expect(sign.size).toEqual([5, 1]);
    expect(input[1]).not.toHaveProperty('source');
    const again = await prepareVibi3DCommands('project', doc, [{ type: 'sign', id: 'sign', size: [4, 1] }], 'next', model.object, modelTextureReferences(model.object, doc.links));
    model.apply(again.commands, 1, again); again.dispose();
    expect(vi.mocked(readTextureSource).mock.calls.every(call => call[2] === 2)).toBe(true);
  });
  it('rolls back a prepared sign when a later command fails and releases unattached resources', async () => {
    const model = editor(), input: Vibi3DCommand[] = [{ type: 'sign', id: 'sign', source: imageSource }, { type: 'delete', id: 'missing' }];
    const prepared = await prepareVibi3DCommands('project', doc, input, 'batch', model.object);
    const geometry = (prepared.preparedSigns[0]!.children[0] as THREE.Mesh).geometry, released = vi.fn(); geometry.addEventListener('dispose', released);
    expect(() => model.apply(prepared.commands, 0, prepared)).toThrow('object-missing'); prepared.dispose();
    expect(model.findObject('sign')).toBeUndefined(); expect(model.revision).toBe(0); expect(released).toHaveBeenCalled();
  });
});
