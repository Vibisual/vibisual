import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CreationLink } from '@vibisual/shared';
import { creationIntentId } from '../Creation/creationApi.js';
import { ModelEditor } from './modelEditor.js';
import { modelTextureReferences, modelTextureRole, modelTextureSlot, pinModelTexture } from './modelTextureReferences.js';

describe('model material connection references', () => {
  it('keeps old map roles and distinguishes independent material slots', () => {
    expect(modelTextureRole('map')).toBe('model-texture');
    expect(modelTextureSlot('model-texture:normalMap')).toBe('normalMap');
    expect(modelTextureSlot('model-texture:unknown')).toBeNull();
  });
  it('derives the pin from actual maps through undo/redo rather than an independent draft list', () => {
    const editor = new ModelEditor(new THREE.Group());
    editor.apply({ type: 'create', id: 'wall', name: 'Wall', recipe: { kind: 'box' } }, 0);
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    pinModelTexture(texture, { id: 'label', revision: 3 }, 'wall', 'map', 'label-link');
    editor.applyTexture('wall', texture, editor.revision, 'creation:label@3');
    const links = modelTextureReferences(editor.object, []);
    expect(links).toEqual([{ id: 'label-link', sourceId: 'label', sourceRevision: 3, role: 'model-texture', targets: ['wall'] }]);
    editor.apply({ type: 'undo' }, editor.revision);
    expect(modelTextureReferences(editor.object, links)).toEqual([]);
    editor.apply({ type: 'redo' }, editor.revision);
    expect(modelTextureReferences(editor.object, [])).toEqual(links);
  });
  it('recognizes legacy embedded textures without modifying locked material JSON', () => {
    const group = new THREE.Group(); group.userData['vibi3dId'] = 'root';
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial()); mesh.userData['vibi3dId'] = 'wall'; group.add(mesh);
    const map = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); map.source.uuid = creationIntentId('texture-image', 'label', 2); mesh.material.map = map;
    const link: CreationLink = { id: 'old-link', sourceId: 'label', sourceRevision: 2, role: 'model-texture', targets: ['wall'] };
    const before = mesh.toJSON();
    expect(modelTextureReferences(group, [link])).toEqual([link]); expect(mesh.toJSON()).toEqual(before);
    mesh.material.map = new THREE.Texture(); expect(modelTextureReferences(group, [link])).toEqual([]);
  });
  it('adds duplicate targets while preserving unrelated app links', () => {
    const editor = new ModelEditor(new THREE.Group()); editor.apply({ type: 'create', id: 'wall', name: 'Wall', recipe: { kind: 'box' } }, 0);
    const map = new THREE.DataTexture(); pinModelTexture(map, { id: 'label', revision: 2 }, 'wall', 'map', 'label-link');
    editor.applyTexture('wall', map, editor.revision, 'label'); editor.apply({ type: 'duplicate', id: 'wall', count: 1 }, editor.revision);
    const unrelated: CreationLink = { id: 'audio', sourceId: 'sound', sourceRevision: 1, role: 'audio', targets: [] };
    const found = modelTextureReferences(editor.object, [unrelated]);
    expect(found[0]).toEqual(unrelated); expect(found[1]!.targets).toHaveLength(2); expect(found[1]!.targets).toContain('wall');
  });
});
