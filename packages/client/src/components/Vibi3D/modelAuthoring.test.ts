import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { validateVibi3DCommandRequest, validateVibi3DSnapshot } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { defaultRecipe } from './Vibi3DAuthoring.js';

function fixture(): ModelEditor { return new ModelEditor(new THREE.Group(), [], { projectId: 'project', fileName: 'product' }); }
describe('editable 3D authoring', () => {
  it('builds all supported recipes and keeps source parameters after a JSON round trip', async () => {
    const editor = fixture();
    for (const kind of ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane', 'lathe', 'extrude', 'path'] as const) {
      editor.apply({ type: 'create', id: kind, name: kind, recipe: defaultRecipe(kind) }, editor.revision);
      const mesh = editor.findObject(kind) as THREE.Mesh;
      expect(mesh.geometry.attributes['position']!.count).toBeGreaterThan(0);
    }
    const source = serializeModelSource(editor.object, editor.clips);
    const loaded = await loadModelSource(JSON.parse(JSON.stringify(source)));
    const reopened = new ModelEditor(loaded.object, loaded.clips, { projectId: 'project' });
    expect(reopened.snapshot().nodes.map((node) => node.recipe)).toEqual(editor.snapshot().nodes.map((node) => node.recipe));
    expect(validateVibi3DSnapshot(editor.snapshot())).toEqual(editor.snapshot());
  });

  it('constructs an editable bottle and applies only the lid material/height in one reversible batch', async () => {
    const editor = fixture();
    editor.apply([
      { type: 'create', id: 'bottle', name: 'Bottle', recipe: { kind: 'cylinder', radius: 0.5, height: 2 } },
      { type: 'create', id: 'lid', name: 'Lid', recipe: { kind: 'cylinder', radius: 0.3, height: 0.4 }, position: [0, 1.2, 0] },
    ], 0);
    const bottle = editor.findObject('bottle') as THREE.Mesh; const lid = editor.findObject('lid') as THREE.Mesh;
    const bottleJson = bottle.toJSON(); const geometry = lid.geometry;
    editor.apply([{ type: 'geometry', id: 'lid', recipe: { kind: 'cylinder', radius: 0.3, height: 0.2 } },
      { type: 'material', id: 'lid', material: { color: '#d4af37', metalness: 0.9 } }], 1);
    expect(bottle.toJSON()).toEqual(bottleJson);
    expect(lid.geometry).not.toBe(geometry);
    editor.undo(); expect(lid.geometry).toBe(geometry);
    editor.redo(); expect((lid.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('d4af37');
    const loaded = await loadModelSource(serializeModelSource(editor.object, editor.clips));
    const restored = new ModelEditor(loaded.object, loaded.clips);
    expect(restored.snapshot().nodes.find((node) => node.id === 'lid')?.recipe?.height).toBe(0.2);
  });

  it('rolls topology, materials and animation back when a later operation fails', () => {
    const editor = fixture(); editor.apply({ type: 'create', id: 'box', name: 'Box', recipe: { kind: 'box' } }, 0);
    const before = serializeModelSource(editor.object, editor.clips);
    expect(() => editor.apply([{ type: 'duplicate', id: 'box', count: 4 }, { type: 'material', id: 'missing', material: { roughness: 1 } }], 1)).toThrow();
    expect(serializeModelSource(editor.object, editor.clips)).toEqual(before);
    expect(editor.revision).toBe(1);
  });

  it('groups with world positions preserved and undoes deletion, protecting descendants and ancestors', () => {
    const editor = fixture(); editor.apply([{ type: 'create', id: 'a', name: 'A', recipe: { kind: 'box' }, position: [3, 0, 0] }, { type: 'create', id: 'b', name: 'B', recipe: { kind: 'sphere' } }], 0);
    const a = editor.findObject('a')!;
    editor.apply({ type: 'group', ids: ['a', 'b'], name: 'Product' }, 1);
    expect(a.getWorldPosition(new THREE.Vector3()).x).toBe(3);
    const groupId = editor.getId(a.parent!)!;
    editor.apply({ type: 'delete', id: groupId }, 2); expect(editor.findObject('a')).toBeUndefined();
    editor.undo(); expect(editor.findObject('a')).toBe(a);
    editor.apply({ type: 'protect', id: 'a', locked: true }, editor.revision);
    expect(() => editor.apply({ type: 'update', id: groupId, position: [1, 0, 0] }, editor.revision)).toThrow(/protected/);
    expect(() => editor.apply({ type: 'delete', id: groupId }, editor.revision)).toThrow(/protected/);
    expect(a.getWorldPosition(new THREE.Vector3()).x).toBe(3);
  });

  it('preserves imported animations and textures, authors motion and restores it after saving', async () => {
    const editor = fixture(); editor.apply({ type: 'create', id: 'box', name: 'Box', recipe: { kind: 'box' } }, 0);
    const object = editor.findObject('box') as THREE.Mesh;
    const texture = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1); texture.needsUpdate = true;
    editor.applyTexture('box', texture, 1, 'label.png');
    const original = new THREE.AnimationClip('Imported', 1, [new THREE.VectorKeyframeTrack(`${object.uuid}.scale`, [0, 1], [1, 1, 1, 2, 2, 2])]);
    editor.clips.push(original);
    editor.apply({ type: 'motion', id: 'box', name: 'Move', keys: [{ time: 0, position: [0, 0, 0] }, { time: 2, position: [4, 0, 0] }] }, editor.revision);
    expect(editor.clips[0]).toBe(original);
    expect((object.material as THREE.MeshStandardMaterial).map).toBe(texture);
    const loaded = await loadModelSource(serializeModelSource(editor.object, editor.clips));
    expect(loaded.clips).toHaveLength(2);
    const mesh = loaded.object.children[0] as THREE.Mesh;
    expect(((mesh.material as THREE.MeshStandardMaterial).map as THREE.DataTexture).image.data).toEqual(new Uint8Array([255, 0, 0, 255]));
    const mixer = new THREE.AnimationMixer(loaded.object); mixer.clipAction(loaded.clips[1]!).play(); mixer.setTime(1);
    expect(mesh.position.x).toBeCloseTo(2);
  });

  it('rejects stale edits, invalid/expensive geometry requests and external source texture URLs', async () => {
    const editor = fixture(); editor.apply({ type: 'create', id: 'box', name: 'Box', recipe: { kind: 'box' } }, 0);
    expect(() => editor.apply({ type: 'delete', id: 'box' }, 0)).toThrow(/changed/);
    expect(validateVibi3DCommandRequest({ commandId: 'x', expectedRevision: 0, commands: [{ type: 'duplicate', id: 'box', count: 100000 }] })).toBeNull();
    expect(validateVibi3DCommandRequest({ commandId: 'x', expectedRevision: 0, commands: [{ type: 'create', name: 'bad', recipe: { kind: 'lathe', points: [[-1, 0, 0], [1, 1, 0]] } }] })).toBeNull();
    const source = serializeModelSource(editor.object, editor.clips);
    await expect(loadModelSource({ ...source, scene: { ...source.scene, images: [{ uuid: 'image', url: 'https://example.com/image.png' }] } })).rejects.toThrow('textures-must-embed');
  });
  it('keeps imported UV orientation and placement when replacing a texture and restores it on undo', () => {
    const root = new THREE.Group(); const prior = new THREE.DataTexture(new Uint8Array([1, 2, 3, 255]), 1, 1);
    prior.flipY = false; prior.offset.set(0.2, 0.3); prior.repeat.set(2, 3); prior.wrapS = THREE.RepeatWrapping;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshPhongMaterial({ map: prior })); root.add(mesh);
    const editor = new ModelEditor(root); const replacement = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1);
    // The replacement has a transparent pixel, so (only then) the material becomes see-through.
    editor.applyTexture(editor.getId(mesh)!, replacement, 0, 'label', true);
    expect(mesh.material.map!.flipY).toBe(false); expect(mesh.material.map!.offset.toArray()).toEqual([0.2, 0.3]);
    expect(mesh.material.map!.repeat.toArray()).toEqual([2, 3]); expect(mesh.material.transparent).toBe(true);
    editor.undo(); expect(mesh.material.map).toBe(prior); expect(mesh.material.transparent).toBe(false);
  });
});
