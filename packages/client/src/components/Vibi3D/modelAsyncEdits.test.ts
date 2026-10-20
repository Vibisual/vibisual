import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Vibi3DCommand } from '@vibisual/shared';
import { ModelEditor } from './modelEditor.js';

function fixture(): { editor: ModelEditor; mesh: THREE.Mesh } {
  const root = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  mesh.userData['vibi3dId'] = 'box'; root.add(mesh); return { editor: new ModelEditor(root), mesh };
}
describe('bounded yielding native transactions', () => {
  it('applies 500 commands as one revision and one undo operation while yielding progress', async () => {
    const { editor, mesh } = fixture(), progress: number[] = [];
    const commands: Vibi3DCommand[] = Array.from({ length: 500 }, (_, index) => ({ type: 'update', id: 'box', position: [index + 1, 0, 0] }));
    await editor.applyAsync(commands, 0, { onProgress: value => { progress.push(value); } });
    expect(mesh.position.x).toBe(500); expect(editor.revision).toBe(1); expect(progress.at(-1)).toBe(1);
    expect(progress.length).toBeGreaterThan(1); expect(progress).toEqual([...progress].sort((a, b) => a - b));
    editor.undo(); expect(mesh.position.x).toBe(0); expect(editor.canUndo).toBe(false);
    editor.redo(); expect(mesh.position.x).toBe(500);
  });
  it('rolls back a cancelled yielding batch and rejects concurrent edits', async () => {
    const { editor, mesh } = fixture(); let cancel = false;
    await expect(editor.applyAsync([{ type: 'update', id: 'box', position: [10, 0, 0] }], 0, {
      onProgress: () => {
        expect(() => editor.apply({ type: 'delete', id: 'box' }, 0)).toThrow('model-busy');
        cancel = true;
      },
      assertActive: () => { if (cancel) throw new Error('command-expired'); },
    })).rejects.toThrow('command-expired');
    expect(editor.findObject('box')).toBe(mesh); expect(mesh.position.x).toBe(0);
    expect(editor.revision).toBe(0); expect(editor.canUndo).toBe(false);
    editor.apply({ type: 'update', id: 'box', position: [2, 0, 0] }, 0); expect(mesh.position.x).toBe(2);
  });
  it('reads stats without changing document history and rolls back a mixed request', () => {
    const { editor, mesh } = fixture(); editor.apply({ type: 'stats' }, 0);
    expect(editor.revision).toBe(0); expect(editor.canUndo).toBe(false);
    expect(() => editor.apply([{ type: 'update', id: 'box', position: [8, 0, 0] }, { type: 'stats' }], 0)).toThrow('command-alone');
    expect(mesh.position.x).toBe(0); expect(editor.revision).toBe(0);
  });
});
