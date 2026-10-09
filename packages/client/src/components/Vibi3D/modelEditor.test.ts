import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { validateVibi3DSnapshot } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';

function fixture(historyLimit?: number) {
  const root = new THREE.Group();
  root.name = 'Model';
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff' });
  const left = new THREE.Mesh(new THREE.BoxGeometry(), material);
  const right = new THREE.Mesh(left.geometry, material);
  left.name = 'Left';
  right.name = 'Right';
  root.add(left, right);
  const editor = new ModelEditor(root, [], { projectId: 'C:/workspace', fileName: 'model.glb', historyLimit });
  return { root, left, right, editor, leftId: editor.getId(left)!, rightId: editor.getId(right)!, rootId: editor.getId(root)! };
}

describe('ModelEditor', () => {
  it('publishes stable unique IDs and parent links without including external viewer objects', () => {
    const { root, left, right, editor, leftId, rootId } = fixture();
    const viewer = new THREE.Scene();
    viewer.add(root, new THREE.GridHelper());
    editor.select(leftId);
    const snapshot = editor.snapshot();
    expect(validateVibi3DSnapshot(snapshot)).toEqual(snapshot);
    expect(snapshot.nodes).toHaveLength(3);
    expect(snapshot.nodes[0]?.parentId).toBeNull();
    expect(snapshot.nodes.find((node) => node.id === leftId)?.parentId).toBe(rootId);
    expect(editor.revision).toBe(0);
    right.userData['vibi3dId'] = left.userData['vibi3dId'];
    const reopened = new ModelEditor(root);
    expect(reopened.getId(left)).toBe(leftId);
    expect(reopened.getId(right)).not.toBe(leftId);
    expect(reopened.sessionId).not.toBe(editor.sessionId);
  });

  it('applies batches atomically, rejects stale revisions, and restores an entire edit in one undo', () => {
    const { editor, left, right, leftId, rightId } = fixture();
    expect(() => editor.apply([{ type: 'update', id: leftId, position: [2, 0, 0] }, { type: 'update', id: 'missing', scale: [2, 2, 2] }], 0)).toThrow();
    expect(left.position.x).toBe(0);
    expect(editor.revision).toBe(0);
    editor.apply([{ type: 'update', id: leftId, position: [2, 0, 0] }, { type: 'update', id: rightId, rotation: [0, 45, 0], scale: [-2, 2, 2] }, { type: 'lighting', intensity: 2 }], 0);
    expect(editor.revision).toBe(1);
    expect(right.rotation.y).toBeCloseTo(Math.PI / 4);
    expect(() => editor.apply({ type: 'update', id: leftId, color: '#000000' }, 0)).toThrow(/changed/);
    editor.undo(1);
    expect(editor.revision).toBe(2);
    expect(left.position.x).toBe(0);
    expect(right.scale.toArray()).toEqual([1, 1, 1]);
    expect(editor.lighting).toBe(1);
    editor.redo(2);
    expect(editor.revision).toBe(3);
    expect(left.position.x).toBe(2);
    expect(editor.object.userData['vibi3dLighting']).toBe(2);
  });

  it('isolates shared material colors and edits groups predictably, preserving mixed colors on undo', () => {
    const { editor, left, right, leftId, rootId } = fixture();
    editor.apply({ type: 'update', id: leftId, color: '#336699' }, 0);
    expect(left.material.color.getHexString()).toBe('336699');
    expect(right.material.color.getHexString()).toBe('ffffff');
    expect(editor.snapshot().nodes[0]?.color).toBeUndefined();
    editor.apply({ type: 'update', id: rootId, color: '#ff0000' }, 1);
    expect(editor.snapshot().nodes.every((node) => node.color === '#ff0000')).toBe(true);
    editor.undo();
    expect(left.material.color.getHexString()).toBe('336699');
    expect(right.material.color.getHexString()).toBe('ffffff');
    editor.redo();
    expect(left.material.color.getHexString()).toBe('ff0000');
    expect(right.material.color.getHexString()).toBe('ff0000');
  });

  it('does not mutate anything for malformed values or unsupported group color edits', () => {
    const { editor, leftId, left, root } = fixture();
    for (const scale of [[0, 1, 1], [Infinity, 1, 1], [1e7, 1, 1]]) {
      expect(() => editor.apply({ type: 'update', id: leftId, scale: scale as [number, number, number] }, 0)).toThrow();
    }
    expect(() => editor.apply([{ type: 'lighting', intensity: 3 }, { type: 'update', id: leftId, color: 'red' }], 0)).toThrow();
    expect(root.userData['vibi3dLighting']).toBe(1);
    expect(left.scale.toArray()).toEqual([1, 1, 1]);
    const empty = new ModelEditor(new THREE.Group());
    expect(() => empty.apply({ type: 'update', id: empty.getId(empty.object)!, position: [3, 0, 0], color: '#ff0000' }, 0)).toThrow(/material/);
    expect(empty.object.position.x).toBe(0);
  });

  it('bounds history and clears redo after a new edit, without treating selection as content', () => {
    const { editor, leftId } = fixture(2);
    for (let x = 1; x <= 3; x++) editor.apply({ type: 'update', id: leftId, position: [x, 0, 0] }, editor.revision);
    editor.undo(); editor.undo();
    expect(editor.canUndo).toBe(false);
    expect(() => editor.undo()).toThrow();
    editor.select(leftId);
    expect(editor.revision).toBe(5);
    expect(editor.canRedo).toBe(true);
    editor.apply({ type: 'update', id: leftId, position: [9, 0, 0] }, 5);
    expect(editor.canRedo).toBe(false);
  });

  it('reports Euler XYZ even for imported nodes with a different Euler order', () => {
    const { editor, left, leftId } = fixture();
    left.rotation.set(0.1, 0.2, 0.3, 'ZYX');
    const before = left.quaternion.clone();
    const rotation = editor.snapshot().nodes.find((node) => node.id === leftId)!.rotation;
    editor.apply({ type: 'update', id: leftId, rotation }, 0);
    expect(Math.abs(before.dot(left.quaternion))).toBeCloseTo(1);
  });

  it('retains base edits after an animation has played and stopped', () => {
    const { root, left, editor, leftId } = fixture();
    const clip = new THREE.AnimationClip('move', 1, [new THREE.VectorKeyframeTrack(`${left.uuid}.position`, [0, 1], [0, 0, 0, 10, 0, 0])]);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.play(); mixer.update(0.5);
    expect(left.position.x).toBe(5);
    mixer.stopAllAction();
    editor.apply({ type: 'update', id: leftId, position: [3, 0, 0] }, 0);
    action.play(); mixer.update(0.25); mixer.stopAllAction();
    expect(left.position.x).toBe(3);
    editor.undo();
    expect(left.position.x).toBe(0);
  });
});
