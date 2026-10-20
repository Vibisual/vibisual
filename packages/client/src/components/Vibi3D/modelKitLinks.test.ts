import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CreationDoc } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';
import { modelTextureReferences, pinModelTexture } from './modelTextureReferences.js';
import { applyModelTextureSource } from './modelImageLink.js';

function fixture(): ModelEditor {
  const root = new THREE.Group(), source = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  root.userData['vibi3dId'] = 'root'; source.userData['vibi3dId'] = 'source'; root.add(source);
  const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  pinModelTexture(texture, { id: 'image', revision: 1 }, 'source', 'map', 'link'); source.material.map = texture;
  const editor = new ModelEditor(root);
  editor.apply([{ type: 'kitModule', id: 'module', sourceId: 'source' }, { type: 'place', id: 'placement', moduleId: 'module' }], 0);
  return editor;
}
const bucket = (root: THREE.Object3D): THREE.InstancedMesh => {
  let result: THREE.InstancedMesh | undefined; root.traverse(node => { if (node instanceof THREE.InstancedMesh) result = node; }); return result!;
};
describe('kit source links and private data', () => {
  it('pins prototypes without transient bucket targets and lets the user advance every rendered copy', () => {
    const editor = fixture(), before = modelTextureReferences(editor.object, []), prototypeId = editor.snapshot().kitModules![0]!.prototypeId;
    expect(before).toHaveLength(1); expect(before[0]!.targets.sort()).toEqual(['source', prototypeId].sort());
    const texture = new THREE.DataTexture(new Uint8Array(16).fill(255), 2, 2);
    applyModelTextureSource(editor, { id: 'image', revision: 2 } as CreationDoc, before[0]!.targets, { texture, hasAlpha: false }, 'link');
    expect(editor.snapshot().kitModules![0]!.revision).toBe(2);
    expect((bucket(editor.object).material as THREE.MeshStandardMaterial).map!.userData['vibi3dSource'].revision).toBe(2);
    expect(modelTextureReferences(editor.object, before)[0]!.sourceRevision).toBe(2);
  });
  it('rejects indirect agent prototype edits and respects a locked instance during a user source update', () => {
    const editor = fixture(), revision = editor.revision, module = editor.snapshot().kitModules![0]!;
    expect(() => editor.apply({ type: 'update', id: 'root', color: '#ff0000' }, revision)).toThrow('kit-nested-module');
    expect(() => editor.apply({ type: 'material', id: module.prototypeId, material: { roughness: 0.1 } }, revision)).toThrow('kit-nested-module');
    expect(editor.revision).toBe(revision);
    editor.apply({ type: 'protect', id: 'placement', locked: true }, editor.revision);
    const texture = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    expect(() => editor.applyMaterialMaps(module.prototypeId, { roughness: 0.2 }, { map: texture }, editor.revision)).toThrow('object-protected');
    expect(editor.snapshot().kitModules![0]!.revision).toBe(1);
  });
  it('releases replaced GPU instance buffers while retaining CPU data for undo', () => {
    const editor = fixture(), old = bucket(editor.object), dispose = vi.spyOn(old, 'dispose');
    editor.apply({ type: 'update', id: 'placement', position: [3, 0, 0] }, editor.revision);
    expect(dispose).toHaveBeenCalledOnce(); editor.undo(); expect(bucket(editor.object)).toBe(old);
    const matrix = new THREE.Matrix4(); old.getMatrixAt(0, matrix); expect(matrix.elements[12]).toBe(0);
  });
});
