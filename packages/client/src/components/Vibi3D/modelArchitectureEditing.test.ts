import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Vibi3DArchitectureRecipe } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';

vi.mock('./modelArchitecture.js', () => ({
  buildArchitectureObject: (recipe: Vibi3DArchitectureRecipe & { floors?: number }, id: string) => {
    const group = new THREE.Group(); group.name = 'Building';
    const mark = (object: THREE.Object3D, key: string) => {
      object.uuid = key ? `${id}-${key}-uuid` : `${id}-uuid`;
      object.userData = { vibi3dId: key ? `${id}-${key}` : id, vibi3dArchitectureOwner: id, vibi3dArchitectureKey: key || 'root' };
    };
    mark(group, ''); group.userData['vibi3dArchitectureRecipe'] = structuredClone(recipe);
    for (const key of (recipe.floors ?? 2) > 1 ? ['lower', 'upper'] : ['lower']) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, recipe.floors ?? 2, 2), new THREE.MeshStandardMaterial());
      mark(mesh, key); mesh.position.y = key === 'lower' ? 2 : 7; group.add(mesh);
    }
    return group;
  },
}));
function fixture() {
  const editor = new ModelEditor(new THREE.Group(), [], { projectId: 'project' });
  editor.apply({ type: 'building', id: 'building', floors: 2, position: [3, 0, 1] }, 0);
  return { editor, building: editor.findObject('building')!, lower: editor.findObject('building-lower')! };
}
describe('architecture regeneration in the shared editor', () => {
  it('retains stable objects, animation bindings and unrelated root metadata', () => {
    const { editor, building, lower } = fixture(); const before = (lower as THREE.Mesh).geometry;
    building.userData['note'] = 'keep';
    editor.clips.push(new THREE.AnimationClip('height', 1, [new THREE.NumberKeyframeTrack(`${lower.uuid}.position[y]`, [0, 1], [2, 3])]));
    editor.apply({ type: 'building', id: 'building', floors: 3 }, editor.revision);
    expect(editor.findObject('building')).toBe(building); expect(editor.findObject('building-lower')).toBe(lower);
    expect((lower as THREE.Mesh).geometry).not.toBe(before); expect(building.position.toArray()).toEqual([3, 0, 1]);
    expect(building.userData['note']).toBe('keep'); expect(editor.clips[0]!.tracks[0]!.name).toBe(`${lower.uuid}.position[y]`);
    editor.undo(); expect((lower as THREE.Mesh).geometry).toBe(before); expect(building.userData['vibi3dArchitectureRecipe'].floors).toBe(2);
    editor.redo(); expect(editor.findObject('building-lower')).toBe(lower); expect(building.userData['vibi3dArchitectureRecipe'].floors).toBe(3);
  });
  it('preserves manual attachments and moves attachments of a removed part to the root at their old world position', () => {
    const { editor, building } = fixture();
    editor.apply([{ type: 'create', id: 'lower-sign', name: 'Sign', parentId: 'building-lower', recipe: { kind: 'box' }, position: [0.2, 0.3, 0.4] },
      { type: 'create', id: 'upper-sign', name: 'Upper sign', parentId: 'building-upper', recipe: { kind: 'box' }, position: [0.2, 0.3, 0.4] }], editor.revision);
    const upper = editor.findObject('upper-sign')!; const world = upper.getWorldPosition(new THREE.Vector3());
    editor.apply({ type: 'building', id: 'building', floors: 1 }, editor.revision);
    expect(editor.findObject('lower-sign')!.parent).toBe(editor.findObject('building-lower'));
    expect(editor.findObject('lower-sign')!.position.toArray()).toEqual([0.2, 0.3, 0.4]);
    expect(upper.parent).toBe(building); expect(upper.getWorldPosition(new THREE.Vector3()).distanceTo(world)).toBeLessThan(1e-9);
  });
  it('refuses locked descendants, foreign ids and parenting cycles without partial edits', () => {
    const { editor, building, lower } = fixture();
    editor.apply({ type: 'protect', id: 'building-lower', locked: true }, editor.revision);
    const before = serializeModelSource(editor.object, []);
    expect(() => editor.apply({ type: 'building', id: 'building', floors: 3 }, editor.revision)).toThrow('object-protected');
    expect(serializeModelSource(editor.object, [])).toEqual(before);
    editor.apply({ type: 'protect', id: 'building-lower', locked: false }, editor.revision);
    expect(() => editor.apply({ type: 'building', id: 'building-lower', floors: 3 }, editor.revision)).toThrow('object-id-exists');
    expect(() => editor.apply({ type: 'building', id: 'building', parentId: 'building-lower', floors: 3 }, editor.revision)).toThrow('root-not-groupable');
    expect(lower.parent).toBe(building);
  });
  it('regenerates a duplicated recipe by semantic identity without reverting its assigned object ids', () => {
    const { editor, building } = fixture();
    editor.apply({ type: 'duplicate', id: 'building', count: 1 }, editor.revision);
    const copy = editor.object.children.find(node => node !== building)!;
    const child = copy.children[0]!; const copyId = editor.getId(copy)!, childId = editor.getId(child)!;
    editor.apply({ type: 'building', id: copyId, floors: 3 }, editor.revision);
    expect(editor.findObject(copyId)).toBe(copy); expect(editor.findObject(childId)).toBe(child);
    expect(copy.children).toHaveLength(2); expect(child.userData['vibi3dArchitectureOwner']).toBe(copyId);
    expect(building.userData['vibi3dArchitectureRecipe'].floors).toBe(2);
  });
  it('exposes the saved recipe after reopening and can regenerate it in another session', async () => {
    const { editor } = fixture();
    const loaded = await loadModelSource(serializeModelSource(editor.object, [])); const reopened = new ModelEditor(loaded.object, loaded.clips);
    expect(reopened.snapshot().nodes.find(node => node.id === 'building')!.architecture).toMatchObject({ kind: 'building', floors: 2 });
    reopened.apply({ type: 'building', id: 'building', floors: 4 }, 0);
    expect(reopened.findObject('building')!.children).toHaveLength(2);
  });
});
