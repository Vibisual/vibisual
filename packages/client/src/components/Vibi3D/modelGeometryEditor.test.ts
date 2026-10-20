import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ModelEditor } from './modelEditor.js';
import { defaultRecipe } from './modelRecipeDefaults.js';

describe('new geometry in the editor', () => {
  it('keeps stable object ids and meter UVs when editing, with reversible recipes', () => {
    const editor = new ModelEditor(new THREE.Group());
    editor.apply({ type: 'create', id: 'steps', name: 'Steps', recipe: defaultRecipe('stairs'), material: { preset: 'painted-concrete' } }, 0);
    const before = editor.findObject('steps') as THREE.Mesh; const original = before.geometry;
    editor.apply({ type: 'geometry', id: 'steps', recipe: { ...defaultRecipe('stairs'), height: 2 } }, editor.revision);
    expect(editor.findObject('steps')).toBe(before); before.geometry.computeBoundingBox();
    expect(before.geometry.boundingBox!.getSize(new THREE.Vector3()).y).toBeCloseTo(2);
    expect(before.geometry.getAttribute('uv1')).toBeDefined();
    editor.undo(); expect(before.geometry).toBe(original); expect(before.userData['vibi3dRecipe']).toEqual(defaultRecipe('stairs'));
    editor.redo(); expect(before.userData['vibi3dRecipe'].height).toBe(2);
  });
});
