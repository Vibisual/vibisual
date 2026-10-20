import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ModelEditor } from './modelEditor.js';
import { kitPlacements } from './modelKitMetadata.js';
import { applyModelTextureSource } from './modelImageLink.js';
import { buildModelSign } from './modelSign.js';
import type { CreationDoc } from '@vibisual/shared';

function fixture(): ModelEditor {
  const root = new THREE.Group(); root.userData['vibi3dId'] = 'root';
  const source = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  source.userData['vibi3dId'] = 'source'; root.add(source); return new ModelEditor(root);
}

describe('stage 8 adversarial model engine operations', () => {
  it('preserves regrouped array cells and rejects regeneration through their locked new parent', () => {
    const editor = fixture();
    editor.apply([{ type: 'kitModule', id: 'kit', sourceId: 'source' }, { type: 'array', id: 'grid', moduleId: 'kit', counts: [2, 1, 1], step: [2, 0, 0] }], 0);
    const cell = kitPlacements(editor.object)[0]!, id = editor.getId(cell)!;
    editor.apply({ type: 'group', ids: [id], name: 'User regroup' }, editor.revision);
    const parent = cell.parent!, parentId = editor.getId(parent)!;
    editor.apply({ type: 'protect', id: parentId, locked: true }, editor.revision);
    expect(() => editor.apply({ type: 'array', id: 'grid', moduleId: 'kit', counts: [3, 1, 1], step: [3, 0, 0] }, editor.revision)).toThrow('object-protected');
    expect(editor.findObject(id)).toBe(cell); expect(cell.parent).toBe(parent);
    editor.apply({ type: 'protect', id: parentId, locked: false }, editor.revision);
    editor.apply({ type: 'array', id: 'grid', moduleId: 'kit', counts: [3, 1, 1], step: [3, 0, 0] }, editor.revision);
    expect(editor.findObject(id)).toBe(cell); expect(kitPlacements(editor.object)).toHaveLength(3);
    editor.undo(); expect(cell.parent).toBe(parent); expect(editor.findObject(id)).toBe(cell);
  });

  it('keeps duplicated mascot parts independent while either copy is regenerated', () => {
    const editor = fixture(); editor.apply({ type: 'mascot', id: 'mascot', style: 'round' }, 0);
    const original = editor.findObject('mascot')!;
    editor.apply({ type: 'duplicate', id: 'mascot', offset: [3, 0, 0] }, editor.revision);
    const copy = editor.object.children.find(node => node !== original && node.userData['vibi3dMascotRecipe'])!, copyId = editor.getId(copy)!;
    const head = copy.children.find(node => node.userData['vibi3dMascotPart'] === 'head')!, headId = editor.getId(head)!;
    editor.apply({ type: 'mascot', id: 'mascot', height: 2 }, editor.revision);
    expect(copy.children).toHaveLength(11); expect(head.parent).toBe(copy);
    editor.apply({ type: 'mascot', id: copyId, height: 2.5 }, editor.revision);
    expect(copy.children).toHaveLength(11); expect(original.children).toHaveLength(11);
    expect(editor.findObject(headId)).toBe(head); expect(head.parent).toBe(copy);
  });

  it('treats a separately duplicated generated part as a user attachment during original regeneration', () => {
    const editor = fixture(); editor.apply({ type: 'mascot', id: 'mascot', style: 'round' }, 0);
    const mascot = editor.findObject('mascot')!, head = mascot.children.find(node => node.userData['vibi3dMascotPart'] === 'head')!;
    editor.apply({ type: 'duplicate', id: editor.getId(head)!, offset: [3, 0, 0] }, editor.revision);
    const copy = mascot.children.find(node => node !== head && node.userData['vibi3dMascotPart'] === 'head')!, copyId = editor.getId(copy)!;
    editor.apply({ type: 'mascot', id: 'mascot', height: 2 }, editor.revision);
    expect(editor.findObject(copyId)).toBe(copy); expect(copy.parent).toBe(mascot);
    expect(copy.position.x).toBe(3); expect(mascot.children).toHaveLength(12);
  });

  it('replaces the illuminated image together with its local upload and restores both on undo', () => {
    const editor = fixture(), mesh = editor.findObject('source') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const old = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
    mesh.material.map = mesh.material.emissiveMap = old; mesh.material.userData['vibi3dLinkedEmission'] = true;
    const next = new THREE.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1);
    editor.applyTexture('source', next, 0, 'local.png');
    expect(mesh.material.emissiveMap).toBe(mesh.material.map); expect(mesh.material.map!.source).toBe(next.source);
    editor.undo(); expect(mesh.material.map).toBe(old); expect(mesh.material.emissiveMap).toBe(old);
  });

  it('keeps the copied decal bound to its copied wall during a later rotation edit', () => {
    const editor = fixture(), texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    editor.apply({ type: 'decal', id: 'sticker', target: 'source', projection: 'flat', position: [0, 0, 0.5], normal: [0, 0, 1], size: [0.4, 0.4], source: { kind: 'vibimage', docId: 'art' } }, 0, { decorationTextures: { 0: texture } });
    editor.apply({ type: 'duplicate', id: 'source' }, editor.revision);
    const copy = editor.object.children.find(node => node.userData['vibi3dId'] !== 'source')!, decal = copy.children[0]!, copyId = editor.getId(copy)!;
    editor.apply({ type: 'decal', id: editor.getId(decal)!, rotation: 45 }, editor.revision);
    expect(decal.parent).toBe(copy); expect(decal.userData['vibi3dDecalRecipe'].target).toBe(copyId);
  });

  it('keeps a wide artwork image in 0..1 UVs after it becomes a scaled kit module', () => {
    const editor = fixture(), source = editor.findObject('source') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    source.geometry = new THREE.PlaneGeometry(4, 2); source.userData['vibi3dUvMode'] = 'image';
    source.material.userData['vibi3dMaterial'] = { tileSize: [1, 1] };
    const uv = [...source.geometry.getAttribute('uv').array];
    editor.apply([{ type: 'kitModule', id: 'art-kit', sourceId: 'source' }, { type: 'place', id: 'art-copy', moduleId: 'art-kit', scale: [2, 3, 1] }], 0);
    let bucket: THREE.InstancedMesh | undefined; editor.object.traverse(node => { if (node instanceof THREE.InstancedMesh) bucket = node; });
    expect([...bucket!.geometry.getAttribute('uv').array]).toEqual(uv);
  });

  it('stores a new image document in each decoration recipe and restores it with the image on undo', () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), editor = fixture();
    const sign = buildModelSign({ kind: 'panel', source: { kind: 'vibimage', docId: 'old' } }, 'sign', { sourceTexture: texture });
    editor.apply({ type: 'sign', id: 'sign' }, 0, { preparedSigns: { 0: sign } });
    editor.apply({ type: 'mascot', id: 'standee', style: 'standee', source: { kind: 'vibimage', docId: 'old' } }, editor.revision, { decorationTextures: { 0: texture } });
    editor.apply({ type: 'decal', id: 'sticker', target: 'source', projection: 'flat', position: [0, 0, 0.5], normal: [0, 0, 1], size: [0.4, 0.4], source: { kind: 'vibimage', docId: 'old' } }, editor.revision, { decorationTextures: { 0: texture } });
    const cases = [
      ['sign', 'vibi3dSignRecipe', sign.children.find(node => node.userData['vibi3dDecorationKey'] === 'artwork-front')!],
      ['standee', 'vibi3dMascotRecipe', editor.findObject('standee')!.children.find(node => node.userData['vibi3dMascotPart'] === 'image')!],
      ['sticker', 'vibi3dDecalRecipe', editor.findObject('sticker')!],
    ] as const;
    for (const [id, key, target] of cases) {
      applyModelTextureSource(editor, { id: 'new', revision: 2 } as CreationDoc, [editor.getId(target)!], { texture, hasAlpha: false }, 'new-link');
      expect(editor.findObject(id)!.userData[key].source).toEqual({ kind: 'vibimage', docId: 'new' });
      editor.undo(); expect(editor.findObject(id)!.userData[key].source).toEqual({ kind: 'vibimage', docId: 'old' });
    }
  });

  it('updates a frozen sign prototype image without changing the source sign recipe', () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), editor = fixture();
    const sign = buildModelSign({ kind: 'panel', source: { kind: 'vibimage', docId: 'old' } }, 'sign', { sourceTexture: texture });
    editor.apply({ type: 'sign', id: 'sign' }, 0, { preparedSigns: { 0: sign } });
    editor.apply([{ type: 'kitModule', id: 'sign-kit', sourceId: 'sign' }, { type: 'place', id: 'placement', moduleId: 'sign-kit' }], editor.revision);
    const prototype = editor.findObject(editor.snapshot().kitModules![0]!.prototypeId)!;
    const image = prototype.children.find(node => node.userData['vibi3dDecorationKey'] === 'artwork-front')!;
    applyModelTextureSource(editor, { id: 'new', revision: 3 } as CreationDoc, [editor.getId(image)!], { texture, hasAlpha: false }, 'prototype-link');
    expect(prototype.userData['vibi3dSignRecipe'].source.docId).toBe('new');
    expect(sign.userData['vibi3dSignRecipe'].source.docId).toBe('old');
    expect(editor.snapshot().kitModules![0]!.revision).toBe(2);
    editor.undo(); expect(prototype.userData['vibi3dSignRecipe'].source.docId).toBe('old');
  });

  it('refuses a source edit that would rewrite a regrouped image owner under a lock', () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), editor = fixture();
    editor.apply({ type: 'mascot', id: 'standee', style: 'standee', source: { kind: 'vibimage', docId: 'old' } }, 0, { decorationTextures: { 0: texture } });
    const image = editor.findObject('standee')!.children.find(node => node.userData['vibi3dMascotPart'] === 'image')!;
    editor.apply({ type: 'group', ids: [editor.getId(image)!], name: 'Regrouped image' }, editor.revision);
    editor.apply({ type: 'protect', id: 'standee', locked: true }, editor.revision);
    const before = (image as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.map;
    expect(() => applyModelTextureSource(editor, { id: 'new', revision: 3 } as CreationDoc, [editor.getId(image)!], { texture, hasAlpha: false }, 'new-link')).toThrow('object-protected');
    expect((image as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.map).toBe(before);
    expect(editor.findObject('standee')!.userData['vibi3dMascotRecipe'].source.docId).toBe('old');
  });
});
