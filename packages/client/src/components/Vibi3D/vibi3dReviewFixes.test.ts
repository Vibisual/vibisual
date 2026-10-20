import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { creationValueAt, validateVibi3DSnapshot, type CreationValue } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, modelLockedPaths, serializeModelSource } from './modelSource.js';

/** §5.13 (R-10) 2026-10-15 — regressions for the 10-14 review of the 3D editor. */
function editor(): ModelEditor { return new ModelEditor(new THREE.Group(), [], { projectId: 'project', fileName: 'bottle' }); }
const material = (object: THREE.Object3D | undefined): THREE.MeshStandardMaterial => (object as THREE.Mesh).material as THREE.MeshStandardMaterial;

describe('(1) adding objects is checked against its own branch only', () => {
  it('create → protect → create works, under the root and next to the locked object', () => {
    const e = editor();
    e.apply({ type: 'create', id: 'body', name: 'Body', recipe: { kind: 'cylinder', height: 2 } }, e.revision);
    e.apply({ type: 'protect', id: 'body', locked: true }, e.revision);
    expect(() => e.apply({ type: 'create', id: 'cap', name: 'Cap', recipe: { kind: 'cylinder', radius: 0.3, height: 0.4 }, position: [0, 1.2, 0] }, e.revision)).not.toThrow();
    expect(e.findObject('cap')?.parent).toBe(e.object);
    // A locked parent (or ancestor) still refuses a new child.
    expect(() => e.apply({ type: 'create', id: 'inside', name: 'Inside', parentId: 'body', recipe: { kind: 'box' } }, e.revision)).toThrow('object-protected');
    e.apply({ type: 'group', ids: ['cap'], name: 'Lid' }, e.revision);
    const lid = e.getId(e.findObject('cap')!.parent!)!;
    expect(() => e.apply({ type: 'create', id: 'seal', name: 'Seal', parentId: lid, recipe: { kind: 'torus' } }, e.revision)).not.toThrow();
  });
});

describe('(9) one colour drag is one undo step', () => {
  it('previews with the same merge key fold into a single entry', () => {
    const e = editor();
    e.apply({ type: 'create', id: 'cap', name: 'Cap', recipe: { kind: 'box' }, material: { color: '#ffffff' } }, e.revision);
    for (const color of ['#111111', '#222222', '#d4af37']) e.apply({ type: 'update', id: 'cap', color }, e.revision, { merge: 'color:cap:1' });
    expect(material(e.findObject('cap')).color.getHexString()).toBe('d4af37');
    e.undo();
    expect(material(e.findObject('cap')).color.getHexString()).toBe('ffffff');
    expect(e.canUndo).toBe(true); // the create is still there: the drag was exactly one step
    // A new drag (another key) is a new step.
    e.redo();
    e.apply({ type: 'update', id: 'cap', color: '#000000' }, e.revision, { merge: 'color:cap:2' });
    e.undo();
    expect(material(e.findObject('cap')).color.getHexString()).toBe('d4af37');
  });
});

describe('3D authoring additions', () => {
  it('creates and edits lights (kind, position, intensity, colour) and keeps them through save and reopen', async () => {
    const e = editor();
    e.apply({ type: 'light', id: 'rim', kind: 'point', name: 'Rim', position: [2, 3, 2], intensity: 12, color: '#ffeedd' }, e.revision);
    expect(e.snapshot().nodes.find((node) => node.id === 'rim')?.light).toEqual({ kind: 'point', intensity: 12, color: '#ffeedd' });
    e.apply({ type: 'light', id: 'rim', kind: 'spot', intensity: 20 }, e.revision);
    e.apply({ type: 'update', id: 'rim', position: [0, 4, 0] }, e.revision);
    const light = e.findObject('rim')!;
    expect(light).toBeInstanceOf(THREE.SpotLight);
    expect(light.position.toArray()).toEqual([0, 4, 0]);
    const reopened = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(e.object, e.clips))));
    const again = new ModelEditor(reopened.object, reopened.clips, { projectId: 'project' });
    expect(again.snapshot().nodes.find((node) => node.id === 'rim')?.light).toEqual({ kind: 'spot', intensity: 20, color: '#ffeedd' });
    expect(validateVibi3DSnapshot(again.snapshot())).not.toBeNull();
  });

  it('keeps several named motions per object with rotation and scale keys, renames and removes them, and reopens them for editing', async () => {
    const e = editor();
    e.apply({ type: 'create', id: 'cap', name: 'Cap', recipe: { kind: 'box' } }, e.revision);
    e.apply({ type: 'motion', id: 'cap', name: 'Spin', keys: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 90, 0] }, { time: 2, rotation: [0, 180, 0], scale: [1, 1, 1] }] }, e.revision);
    e.apply({ type: 'motion', id: 'cap', name: 'Pop', keys: [{ time: 0, scale: [1, 1, 1] }, { time: 0.5, scale: [1.2, 1.2, 1.2] }] }, e.revision);
    expect(e.snapshot().nodes.find((node) => node.id === 'cap')?.motions?.map((motion) => motion.name)).toEqual(['Spin', 'Pop']);
    expect(e.clips.map((clip) => clip.name)).toEqual(['Vibi3D:cap:Spin', 'Vibi3D:cap:Pop']);
    const spin = e.clips[0]!;
    expect(spin.tracks.some((track) => track instanceof THREE.QuaternionKeyframeTrack)).toBe(true);
    e.apply({ type: 'motion', id: 'cap', name: 'Turn', previousName: 'Spin', keys: [{ time: 0, rotation: [0, 0, 0] }, { time: 3, rotation: [0, 360, 0] }] }, e.revision);
    expect(e.clips.map((clip) => clip.name).sort()).toEqual(['Vibi3D:cap:Pop', 'Vibi3D:cap:Turn']);
    const reopened = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(e.object, e.clips))));
    const again = new ModelEditor(reopened.object, reopened.clips);
    expect(again.snapshot().nodes.find((node) => node.id === 'cap')?.motions?.find((motion) => motion.name === 'Turn')?.keys[1]?.rotation).toEqual([0, 360, 0]);
    again.apply({ type: 'motionRemove', id: 'cap', name: 'Pop' }, again.revision);
    expect(again.clips.map((clip) => clip.name)).toEqual(['Vibi3D:cap:Turn']);
    expect(again.snapshot().nodes.find((node) => node.id === 'cap')?.motions?.map((motion) => motion.name)).toEqual(['Turn']);
  });

  it('reads the single motion older sources stored (vibi3dMotion) so it can be edited', () => {
    const root = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    box.userData['vibi3dMotion'] = { name: 'Move', keys: [{ time: 0, position: [0, 0, 0] }, { time: 1, position: [1, 0, 0] }] };
    root.add(box);
    const e = new ModelEditor(root);
    expect(e.snapshot().nodes.find((node) => node.name === box.type)?.motions?.[0]?.name).toBe('Move');
  });

  it('keys the view camera along a path and replaces the previous path', () => {
    const e = editor();
    e.apply({ type: 'cameraMotion', name: 'Push', keys: [{ time: 0, position: [4, 2, 4], target: [0, 1, 0] }, { time: 3, position: [2, 1.5, 2], target: [0, 1, 0] }] }, e.revision);
    e.apply({ type: 'cameraMotion', name: 'Orbit', keys: [{ time: 0, position: [4, 2, 0], target: [0, 1, 0] }, { time: 2, position: [0, 2, 4], target: [0, 1, 0] }] }, e.revision);
    expect(e.clips.filter((clip) => clip.name.startsWith('Vibi3D:camera:')).map((clip) => clip.name)).toEqual(['Vibi3D:camera:Orbit']);
    expect(e.snapshot().cameraMotion?.name).toBe('Orbit');
    expect(e.snapshot().camera?.position).toEqual([4, 2, 0]);
  });

  it('duplicates an imported, name-keyed animation onto the copy (the copy is animated, the original keeps its own)', () => {
    const root = new THREE.Group();
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); wheel.name = 'Wheel';
    root.add(wheel);
    const clips = [new THREE.AnimationClip('Roll', 1, [new THREE.VectorKeyframeTrack('Wheel.position', [0, 1], [0, 0, 0, 2, 0, 0])])];
    const e = new ModelEditor(root, clips);
    e.apply({ type: 'duplicate', id: e.getId(wheel)!, count: 1, offset: [0, 0, 3] }, e.revision);
    const copy = root.children.find((child) => child !== wheel)!;
    const copied = e.clips.find((clip) => clip.name === 'Roll 2')!;
    expect(copied.tracks[0]!.name).toBe(`${copy.uuid}.position`);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clips[0]!).play(); mixer.clipAction(copied).play(); mixer.setTime(0.5);
    expect(wheel.position.x).toBeCloseTo(1);
    expect(copy.position.x).toBeCloseTo(1);
  });

  it('refuses to delete or group a bone or a skinned mesh on its own, but moves a whole character', () => {
    const root = new THREE.Group();
    const character = new THREE.Group(); character.name = 'Character';
    const bone = new THREE.Bone(); bone.name = 'Hip';
    const skin = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    skin.add(bone); skin.bind(new THREE.Skeleton([bone]));
    character.add(skin); root.add(character);
    const e = new ModelEditor(root);
    expect(() => e.apply({ type: 'delete', id: e.getId(bone)! }, e.revision)).toThrow('rig-structure-protected');
    expect(() => e.apply({ type: 'group', ids: [e.getId(bone)!], name: 'Bones' }, e.revision)).toThrow('rig-structure-protected');
    expect(() => e.apply({ type: 'group', ids: [e.getId(character)!], name: 'Scene' }, e.revision)).not.toThrow();
    expect(() => e.apply({ type: 'delete', id: e.getId(character)! }, e.revision)).not.toThrow();
  });

  it('leaves out an invalid recipe or material stored in a file instead of breaking the whole AI bridge', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.5 }));
    mesh.userData['vibi3dRecipe'] = { kind: 'box', width: -1 };
    (mesh.material as THREE.MeshStandardMaterial).metalness = 7;
    root.add(mesh);
    const snapshot = new ModelEditor(root, [], { projectId: 'project' }).snapshot();
    const node = snapshot.nodes.find((item) => item.type === 'Mesh')!;
    expect(node.recipe).toBeUndefined();
    expect(node.material).toBeUndefined();
    expect(validateVibi3DSnapshot(snapshot)).not.toBeNull();
  });

  it('releases replaced and deleted geometry, and a create with opacity below 1 is see-through', () => {
    const e = editor();
    e.apply({ type: 'create', id: 'glass', name: 'Glass', recipe: { kind: 'sphere' }, material: { opacity: 0.4 } }, e.revision);
    expect(material(e.findObject('glass')).transparent).toBe(true);
    const old = (e.findObject('glass') as THREE.Mesh).geometry;
    let released = 0; old.addEventListener('dispose', () => { released += 1; });
    e.apply({ type: 'geometry', id: 'glass', recipe: { kind: 'sphere', radius: 0.8 } }, e.revision);
    expect(released).toBe(1);
    e.undo();
    expect((e.findObject('glass') as THREE.Mesh).geometry).toBe(old);
    const current = (e.findObject('glass') as THREE.Mesh).geometry;
    let deleted = 0; current.addEventListener('dispose', () => { deleted += 1; });
    e.apply({ type: 'delete', id: 'glass' }, e.revision);
    expect(deleted).toBe(1);
  });

  it('an opaque texture does not turn every material transparent; one with transparent pixels does', () => {
    const e = editor();
    e.apply({ type: 'create', id: 'label', name: 'Label', recipe: { kind: 'plane' } }, e.revision);
    e.applyTexture('label', new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1), e.revision, 'opaque.png', false);
    expect(material(e.findObject('label')).transparent).toBe(false);
    e.applyTexture('label', new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1), e.revision, 'cutout.png', true);
    expect(material(e.findObject('label')).transparent).toBe(true);
  });
});

describe('3D locks reach the server', () => {
  it('names the locked object and its resources as lockedPaths that resolve in the saved payload', () => {
    const e = editor();
    e.apply([{ type: 'create', id: 'body', name: 'Body', recipe: { kind: 'cylinder' } }, { type: 'create', id: 'cap', name: 'Cap', recipe: { kind: 'box' } }], e.revision);
    e.apply({ type: 'protect', id: 'body', locked: true }, e.revision);
    const payload = serializeModelSource(e.object, e.clips) as unknown as CreationValue;
    const paths = modelLockedPaths(payload);
    const body = e.findObject('body') as THREE.Mesh;
    expect(paths).toContain(`/scene/object/children/@${body.uuid}`);
    expect(paths).toContain(`/scene/geometries/@${body.geometry.uuid}`);
    expect(paths).toContain(`/scene/materials/@${(body.material as THREE.Material).uuid}`);
    expect(paths.some((path) => path.includes(e.findObject('cap')!.uuid))).toBe(false);
    for (const path of paths) expect(creationValueAt(payload, path)).toBeDefined();
  });

  it('writes an untouched (locked) object back with the same numbers after a reopen, so the server lock check holds', async () => {
    const e = editor();
    e.apply({ type: 'create', id: 'body', name: 'Body', recipe: { kind: 'cylinder' }, position: [0.1, 0.2, 0.3] }, e.revision);
    e.apply({ type: 'update', id: 'body', rotation: [12.3456789, 45.6, 78.9], scale: [1.1, 0.7, 1.3] }, e.revision);
    e.apply({ type: 'protect', id: 'body', locked: true }, e.revision);
    const first = serializeModelSource(e.object, e.clips) as unknown as CreationValue;
    const pointer = modelLockedPaths(first).find((path) => path.startsWith('/scene/object/children/'))!;
    let payload = first;
    for (let round = 0; round < 3; round += 1) {
      const loaded = await loadModelSource(JSON.parse(JSON.stringify(payload)));
      const reopened = new ModelEditor(loaded.object, loaded.clips);
      reopened.apply({ type: 'create', id: `extra-${round}`, name: 'Extra', recipe: { kind: 'box' } }, reopened.revision);
      payload = serializeModelSource(reopened.object, reopened.clips) as unknown as CreationValue;
      expect(JSON.stringify(creationValueAt(payload, pointer))).toBe(JSON.stringify(creationValueAt(first, pointer)));
    }
  });
});
