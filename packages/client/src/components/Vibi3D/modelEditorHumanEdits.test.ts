import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ModelEditor } from './modelEditor.js';

function fixture(historyLimit = 2) {
  const root = new THREE.Group();
  const texture = new THREE.Texture();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }));
  mesh.userData['vibi3dId'] = 'box';
  root.add(mesh);
  const editor = new ModelEditor(root, [], { historyLimit });
  const move = (x: number, merge?: string) => editor.apply({ type: 'update', id: 'box', position: [x, 0, 0] }, editor.revision, { merge });
  return { root, mesh, texture, editor, move };
}

describe('human edit boundaries', () => {
  it('discards edits beyond the undo limit without losing earlier agent work or agent history', () => {
    const { editor, move, mesh } = fixture();
    move(10);
    editor.apply({ type: 'create', id: 'agent-object', name: 'Agent object', recipe: { kind: 'box' } }, editor.revision);
    editor.select('agent-object');
    const agentState = editor.snapshot();
    expect(editor.beginHumanEdits()).toBe(true);
    editor.apply({ type: 'delete', id: 'agent-object' }, editor.revision);
    for (let x = 20; x <= 25; x++) move(x);
    editor.apply({ type: 'lighting', intensity: 3 }, editor.revision);
    const revision = editor.revision;

    const restored = editor.discardHumanEdits();
    expect(restored).toEqual({ ...agentState, revision: revision + 1 });
    expect(editor.hasHumanEdits).toBe(false);
    expect(mesh.position.x).toBe(10);
    editor.undo();
    expect(editor.findObject('agent-object')).toBeUndefined();
    expect(mesh.position.x).toBe(10);
    editor.undo();
    expect(mesh.position.x).toBe(0);
  });

  it('isolates human undo/redo and merge keys from the parked agent history', () => {
    const { editor, move, mesh } = fixture();
    move(10, 'position');
    editor.beginHumanEdits();
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(() => editor.undo()).toThrow('nothing-to-undo');
    move(20, 'position');
    expect(editor.beginHumanEdits()).toBe(false);
    move(30, 'position');
    editor.undo();
    expect(mesh.position.x).toBe(10);
    expect(() => editor.undo()).toThrow('nothing-to-undo');
    editor.redo();
    expect(mesh.position.x).toBe(30);
    editor.discardHumanEdits();
    editor.undo();
    expect(mesh.position.x).toBe(0);
  });

  it.each(['failure', 'read-only', 'empty'] as const)('restores parked agent redo after a %s first edit without advancing revision', (kind) => {
    const { editor, move, mesh } = fixture();
    move(10); move(20); editor.undo();
    const before = editor.snapshot();
    editor.beginHumanEdits();
    if (kind === 'failure') {
      expect(() => editor.apply([
        { type: 'update', id: 'box', position: [30, 0, 0] },
        { type: 'delete', id: 'missing' },
      ], editor.revision)).toThrow('object-missing');
    } else if (kind === 'read-only') editor.apply({ type: 'stats' }, editor.revision);
    expect(editor.hasHumanEdits).toBe(false);
    expect(kind === 'empty' ? editor.commitHumanEdits() : editor.discardHumanEdits()).toEqual(before);
    editor.redo();
    expect(mesh.position.x).toBe(20);
  });

  it('keeps a successful earlier human edit when a subsequent edit fails', () => {
    const { editor, move, mesh } = fixture();
    move(10);
    editor.beginHumanEdits();
    move(20);
    const opened = editor.beginHumanEdits();
    expect(opened).toBe(false);
    expect(() => editor.apply({ type: 'delete', id: 'missing' }, editor.revision)).toThrow('object-missing');
    expect(editor.hasHumanEdits).toBe(true);
    expect(mesh.position.x).toBe(20);
    editor.discardHumanEdits();
    expect(mesh.position.x).toBe(10);
  });

  it('seals saved human work against agent undo and invalidates manual history after agent edits', () => {
    const { editor, move, mesh } = fixture();
    move(10);
    editor.beginHumanEdits(); move(20);
    const revision = editor.revision;
    const committed = editor.commitHumanEdits();
    expect(committed.revision).toBe(revision);
    expect(committed.canUndo).toBe(false);
    expect(committed.canRedo).toBe(false);
    expect(editor.canUndoHuman).toBe(true);
    expect(editor.hasHumanEdits).toBe(false);
    expect(mesh.position.x).toBe(20);
    expect(() => editor.undo()).toThrow('nothing-to-undo');
    move(30);
    expect(editor.canUndoHuman).toBe(false);
    editor.undo();
    expect(mesh.position.x).toBe(20);
    expect(() => editor.undo()).toThrow('nothing-to-undo');
    editor.redo();
    editor.beginHumanEdits(); move(40); editor.undo();
    expect(mesh.position.x).toBe(30);
    expect(() => editor.undo()).toThrow('nothing-to-undo');
    editor.discardHumanEdits();
    expect(mesh.position.x).toBe(30);
  });

  it('preserves the user\'s saved undo/redo through read-only and failed agent requests', () => {
    const { editor, move, mesh } = fixture();
    move(10);
    editor.beginHumanEdits(); move(20); editor.commitHumanEdits();
    editor.apply({ type: 'select', id: 'box' }, editor.revision);
    editor.apply({ type: 'stats' }, editor.revision);
    expect(() => editor.apply({ type: 'delete', id: 'missing' }, editor.revision)).toThrow('object-missing');
    expect(editor.canUndoHuman).toBe(true);
    expect(editor.canRedoHuman).toBe(false);
    expect(editor.canUndo).toBe(false);

    editor.beginHumanEdits(); editor.undo();
    expect(mesh.position.x).toBe(10);
    expect(editor.hasHumanEdits).toBe(true);
    expect(editor.canRedoHuman).toBe(true);
    expect(() => editor.undo()).toThrow('nothing-to-undo');
    editor.discardHumanEdits();
    expect(mesh.position.x).toBe(20);
    expect(editor.canUndoHuman).toBe(true);
    expect(editor.canRedoHuman).toBe(false);

    editor.beginHumanEdits(); editor.undo(); editor.commitHumanEdits();
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
    expect(editor.canUndoHuman).toBe(false);
    expect(editor.canRedoHuman).toBe(true);
    editor.beginHumanEdits(); editor.redo();
    expect(mesh.position.x).toBe(20);
    editor.commitHumanEdits();
    expect(editor.canUndoHuman).toBe(true);
  });

  it('restores existing light names and color/intensity through undo, failed batches and discard', () => {
    const { editor } = fixture(1);
    editor.apply({ type: 'light', id: 'lamp', name: 'Agent lamp', color: '#336699', intensity: 2 }, editor.revision);
    const light = editor.findObject('lamp') as THREE.Light;
    editor.beginHumanEdits();
    const updateLight = () => editor.apply({ type: 'light', id: 'lamp', name: 'Human lamp', color: '#ffcc99', intensity: 4 }, editor.revision);
    updateLight(); editor.undo();
    expect([light.name, light.color.getHexString(), light.intensity]).toEqual(['Agent lamp', '336699', 2]);
    expect(() => editor.apply([
      { type: 'light', id: 'lamp', name: 'Failed lamp', color: '#ffffff', intensity: 8 },
      { type: 'delete', id: 'missing' },
    ], editor.revision)).toThrow('object-missing');
    expect([light.name, light.color.getHexString(), light.intensity]).toEqual(['Agent lamp', '336699', 2]);
    updateLight();
    editor.apply({ type: 'lighting', intensity: 3 }, editor.revision);
    editor.discardHumanEdits();
    expect([light.name, light.color.getHexString(), light.intensity]).toEqual(['Agent lamp', '336699', 2]);
  });

  it('keeps baseline textures alive through replacements and releases discarded human textures', () => {
    const { editor, mesh, texture } = fixture(1);
    const originalDisposed = vi.spyOn(texture, 'dispose');
    editor.beginHumanEdits();
    editor.applyTexture('box', new THREE.Texture(), editor.revision, 'manual');
    const humanTexture = mesh.material.map!;
    const humanDisposed = vi.spyOn(humanTexture, 'dispose');
    editor.apply({ type: 'lighting', intensity: 3 }, editor.revision);
    expect(originalDisposed).not.toHaveBeenCalled();
    editor.discardHumanEdits();
    expect(mesh.material.map).toBe(texture);
    expect(originalDisposed).not.toHaveBeenCalled();
    expect(humanDisposed).toHaveBeenCalledOnce();

    editor.beginHumanEdits();
    editor.applyTexture('box', new THREE.Texture(), editor.revision, 'saved manual');
    const savedTexture = mesh.material.map!;
    editor.commitHumanEdits();
    expect(originalDisposed).toHaveBeenCalledOnce();
    expect(mesh.material.map).toBe(savedTexture);
  });

  it.each(['discard', 'commit'] as const)('retains removed baseline geometry, material, texture, skeleton and instances until %s', (action) => {
    const { root, editor, mesh, texture } = fixture(1);
    const skin = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    skin.bind(new THREE.Skeleton([]));
    const instances = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 1);
    root.add(skin, instances);
    // Register imported rig and instance nodes before opening the transaction.
    const model = new ModelEditor(root, editor.clips, { historyLimit: 1 });
    const disposed = [mesh.geometry, mesh.material, texture, skin.geometry, skin.material, skin.skeleton, instances, instances.geometry, instances.material]
      .map(resource => vi.spyOn(resource, 'dispose'));
    model.beginHumanEdits();
    model.apply([mesh, skin, instances].map(node => ({ type: 'delete', id: model.getId(node)! })), model.revision);
    model.apply({ type: 'lighting', intensity: 3 }, model.revision);
    disposed.forEach(spy => expect(spy).not.toHaveBeenCalled());
    if (action === 'discard') {
      model.discardHumanEdits();
      expect(root.children).toEqual([mesh, skin, instances]);
      disposed.forEach(spy => expect(spy).not.toHaveBeenCalled());
    } else {
      model.commitHumanEdits();
      expect(root.children).toEqual([]);
      disposed.forEach(spy => expect(spy).toHaveBeenCalledOnce());
    }
  });

  it('does not open, commit or discard a human boundary while an async transaction is suspended', async () => {
    const { editor, move, mesh } = fixture();
    move(10); editor.beginHumanEdits();
    let cancel = false;
    await expect(editor.applyAsync({ type: 'update', id: 'box', position: [20, 0, 0] }, editor.revision, {
      onProgress: () => {
        expect(() => editor.beginHumanEdits()).toThrow('model-busy');
        expect(() => editor.commitHumanEdits()).toThrow('model-busy');
        expect(() => editor.discardHumanEdits()).toThrow('model-busy');
        cancel = true;
      },
      assertActive: () => { if (cancel) throw new Error('command-expired'); },
    })).rejects.toThrow('command-expired');
    expect(editor.hasHumanEdits).toBe(false);
    expect(mesh.position.x).toBe(10);
    editor.discardHumanEdits(); editor.undo();
    expect(mesh.position.x).toBe(0);
  });

  it('releases retained baseline resources during teardown even while a cancelled async edit is suspended', async () => {
    const { editor, mesh, texture } = fixture();
    const disposed = [mesh.geometry, mesh.material, texture].map(resource => vi.spyOn(resource, 'dispose'));
    editor.beginHumanEdits();
    editor.apply({ type: 'delete', id: 'box' }, editor.revision);
    let cancelled = false;
    await expect(editor.applyAsync({ type: 'lighting', intensity: 3 }, editor.revision, {
      onProgress: () => {
        editor.disposeHistory();
        disposed.forEach(spy => expect(spy).toHaveBeenCalledOnce());
        cancelled = true;
      },
      assertActive: () => { if (cancelled) throw new Error('scene-closed'); },
    })).rejects.toThrow('scene-closed');
    editor.disposeHistory();
    disposed.forEach(spy => expect(spy).toHaveBeenCalledOnce());
    expect(editor.hasHumanEdits).toBe(false);
    expect(editor.canUndoHuman).toBe(false);
    expect(editor.canUndo).toBe(false);
    expect(editor.canRedo).toBe(false);
  });

  it('leaves live model resources for the model disposer and clears saved manual history', () => {
    const { editor, mesh, texture, move } = fixture();
    editor.beginHumanEdits(); move(10); editor.commitHumanEdits();
    const disposed = [mesh.geometry, mesh.material, texture].map(resource => vi.spyOn(resource, 'dispose'));
    expect(editor.canUndoHuman).toBe(true);
    editor.disposeHistory();
    disposed.forEach(spy => expect(spy).not.toHaveBeenCalled());
    expect(editor.canUndoHuman).toBe(false);
  });
});
