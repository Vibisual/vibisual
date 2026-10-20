import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { resolveCreationValue, type CreationDoc, type CreationLink, type CreationValue } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, saveModelDocument, serializeModelSource } from './modelSource.js';

const api = vi.hoisted(() => ({ commitCreationDoc: vi.fn(async () => ({})), createCreationDoc: vi.fn(async () => ({})), readCreationDoc: vi.fn() }));
vi.mock('../Creation/creationApi.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...api }));
vi.mock('../Creation/creationBlobs.js', () => ({ resolveCreationBlobs: (_project: string, payload: CreationValue) => resolveCreationValue(payload, async () => new Uint8Array([137, 80, 78, 71])) }));

describe('material source persistence', () => {
  it('restores raw blob recipe references after generic blob expansion without mutating the input', async () => {
    const ref = `vibi-blob:${'a'.repeat(64)}.png`; const editor = new ModelEditor(new THREE.Group());
    editor.apply({ type: 'create', id: 'surface', name: 'Surface', recipe: { kind: 'box' } }, 0);
    editor.applyMaterialMaps('surface', { maps: { normalMap: { source: { kind: 'blob', ref } } } }, { normalMap: new THREE.DataTexture(new Uint8Array([127, 127, 255, 255]), 1, 1) }, 1);
    const source = serializeModelSource(editor.object, []); const before = structuredClone(source);
    const loaded = await loadModelSource(source, 'Surface', 'project'); const restored = new ModelEditor(loaded.object);
    expect(restored.snapshot().nodes.find(node => node.id === 'surface')?.material?.maps?.normalMap?.source).toEqual({ kind: 'blob', ref });
    expect(source).toEqual(before);
    const mesh = restored.findObject('surface') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect((mesh.material.normalMap as THREE.DataTexture).image.data).toEqual(new Uint8Array([127, 127, 255, 255]));
  });

  it('writes current texture pins atomically for commit, new document and copy', async () => {
    const source = serializeModelSource(new THREE.Group(), []);
    const doc = { id: 'model', revision: 2, links: [{ id: 'old', role: 'model-texture', sourceId: 'old', sourceRevision: 1 }], parameters: {} } as CreationDoc;
    const links: CreationLink[] = [{ id: 'new', role: 'model-normalMap', sourceId: 'image', sourceRevision: 3, targets: ['surface'], keptRevision: 2 }];
    await saveModelDocument('project', doc, 'Model', source, false, links);
    expect(api.commitCreationDoc).toHaveBeenLastCalledWith('project', doc, expect.objectContaining({ links }));
    for (const document of [null, doc]) {
      await saveModelDocument('project', document, 'Model', source, true, links);
      expect(api.createCreationDoc).toHaveBeenLastCalledWith('project', expect.objectContaining({ links: [{ id: 'new', role: 'model-normalMap', sourceId: 'image', sourceRevision: 3, targets: ['surface'] }] }));
    }
  });
});
