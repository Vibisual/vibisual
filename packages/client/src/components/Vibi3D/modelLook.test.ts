import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { resolveVibi3DLook, validateVibi3DSnapshot } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';

const fixture = () => {
  const object = new THREE.Group(); const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  object.add(mesh); object.userData['vibi3dLighting'] = 1.7;
  const editor = new ModelEditor(object, [], { projectId: '/project' });
  return { object, mesh, editor, id: editor.getId(mesh)! };
};

describe('editable scene look', () => {
  it('keeps legacy documents on their original studio settings without adding look metadata', () => {
    const { object, editor } = fixture();
    expect(editor.snapshot().look).toBeUndefined();
    expect(object.userData['vibi3dLook']).toBeUndefined();
    expect(editor.lighting).toBe(1.7);
    editor.apply({ type: 'lighting', intensity: 2 }, 0);
    expect(editor.snapshot().look).toBeUndefined();
    editor.undo(); expect(editor.lighting).toBe(1.7);
  });
  it('merges a drag into one undo step, preserves nested values and keeps the legacy alias synchronized', () => {
    const { object, editor } = fixture();
    editor.apply({ type: 'look', preset: 'daylight', sun: { azimuth: 40 }, exposure: 1.2 }, 0, { merge: 'look-drag' });
    editor.apply({ type: 'look', sun: { elevation: 70 }, exposure: 1.8 }, 1, { merge: 'look-drag' });
    expect(editor.snapshot().look).toMatchObject({ sun: { azimuth: 40, elevation: 70 }, exposure: 1.8 });
    editor.undo(); expect(editor.snapshot().look).toBeUndefined(); expect(editor.canUndo).toBe(false);
    editor.redo();
    editor.apply({ type: 'lighting', intensity: 2.4 }, editor.revision);
    expect(editor.snapshot().look?.intensity).toBe(2.4); expect(object.userData['vibi3dLighting']).toBe(2.4);
    expect(validateVibi3DSnapshot(editor.snapshot())).toEqual(editor.snapshot());
  });
  it('starts another preset from its defaults while retaining the single scene intensity', () => {
    const { editor } = fixture();
    editor.apply({ type: 'look', preset: 'daylight', exposure: 5, sun: { intensity: 80 }, ao: false }, 0);
    editor.apply({ type: 'look', ao: { radius: 2 } }, 1);
    expect(resolveVibi3DLook(editor.snapshot().look).ao.enabled).toBe(false);
    editor.apply({ type: 'look', preset: 'sunset' }, 2);
    expect(resolveVibi3DLook(editor.snapshot().look)).toEqual(resolveVibi3DLook({ preset: 'sunset', intensity: 1.7 }));
  });
  it('round trips look and independent mesh shadow overrides without changing the imported GPU flags', async () => {
    const { object, mesh, editor, id } = fixture();
    editor.apply([{ type: 'look', preset: 'daylight', bloom: { strength: 0.4 } }, { type: 'update', id, shadows: { cast: false } }], 0);
    expect(editor.snapshot().nodes.find((node) => node.id === id)?.shadows).toEqual({ cast: false, receive: true });
    expect(mesh.castShadow).toBe(false); expect(mesh.receiveShadow).toBe(false);
    const reopened = await loadModelSource(serializeModelSource(object, []), 'Scene');
    const restored = new ModelEditor(reopened.object);
    expect(restored.snapshot().look).toEqual(editor.snapshot().look);
    expect(restored.snapshot().nodes.find((node) => node.id === id)?.shadows).toEqual({ cast: false, receive: true });
    editor.undo(); expect(mesh.userData['vibi3dShadows']).toBeUndefined(); expect(editor.snapshot().look).toBeUndefined();
    editor.redo(); expect(mesh.userData['vibi3dShadows']).toEqual({ cast: false });
  });
  it('rolls back a whole look batch on failure and respects protected meshes', () => {
    const { editor, mesh, id } = fixture();
    expect(() => editor.apply([{ type: 'look', preset: 'daylight' }, { type: 'update', id: 'missing', shadows: { cast: false } }], 0)).toThrow();
    expect(editor.snapshot().look).toBeUndefined(); expect(editor.lighting).toBe(1.7);
    mesh.userData['vibi3dLocked'] = true;
    expect(() => editor.apply({ type: 'update', id, shadows: { receive: false } }, 0)).toThrow('object-protected');
    expect(mesh.userData['vibi3dShadows']).toBeUndefined();
  });
});
