import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ModelEditor } from './modelEditor.js';

const image = () => new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
describe('decoration commands in the transactional editor', () => {
  it('exposes editable decal recipes and undoes/redoes regeneration with prepared sources', () => {
    const editor = new ModelEditor(new THREE.Group());
    editor.apply({ type: 'create', id: 'wall', name: 'Wall', recipe: { kind: 'box', width: 4, height: 3, depth: 0.2 } }, editor.revision);
    editor.apply({ type: 'decal', id: 'label', target: 'wall', position: [0, 0, 0.1], normal: [0, 0, 1], size: [1, 1], projection: 'flat', source: { kind: 'vibimage', docId: 'drawing' } }, editor.revision, { decorationTextures: { 0: image() } });
    const object = editor.findObject('label') as THREE.Mesh, geometry = object.geometry;
    expect(editor.snapshot().nodes.find(node => node.id === 'label')?.decal?.target).toBe('wall');
    editor.apply({ type: 'decal', id: 'label', rotation: 35 }, editor.revision); expect(editor.findObject('label')).toBe(object);
    editor.undo(); expect(object.geometry).toBe(geometry); editor.redo(); expect(object.userData['vibi3dDecalRecipe'].rotation).toBe(35);
  });

  it('rolls back a failed decal batch and preserves protected mascot parts', () => {
    const editor = new ModelEditor(new THREE.Group());
    expect(() => editor.apply([{ type: 'mascot', id: 'friend', style: 'round' }, {
      type: 'decal', id: 'label', target: 'missing', position: [0, 0, 0], normal: [0, 0, 1], size: [1, 1], source: { kind: 'vibimage', docId: 'drawing' },
    }], editor.revision, { decorationTextures: { 1: image() } })).toThrow();
    expect(editor.findObject('friend')).toBeUndefined();
    editor.apply({ type: 'mascot', id: 'friend', style: 'round' }, editor.revision);
    const head = editor.findObject('friend')!.children.find(node => node.userData['vibi3dMascotPart'] === 'head')!;
    editor.apply({ type: 'protect', id: head.userData['vibi3dId'], locked: true }, editor.revision);
    expect(() => editor.apply({ type: 'mascot', id: 'friend', height: 2 }, editor.revision)).toThrow('object-protected');
  });
});
