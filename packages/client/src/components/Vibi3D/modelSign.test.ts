import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VIBI3D_SIGN_KINDS, type Vibi3DSignRecipe } from '@vibisual/shared';
import fontData from './fonts/nanumgothic/NanumGothic-Regular.ttf?inline';
import { buildModelSign, defaultSignRecipe } from './modelSign.js';
import { parseSignFont } from './signFonts.js';
import { layoutSignGlyphs } from './signGlyphs.js';
import { applyModelSign } from './applyModelSign.js';
import { serializeModelSource, loadModelSource } from './modelSource.js';
import { pinModelTexture, modelTextureReferences } from './modelTextureReferences.js';
import { applyModelMaterial } from './modelMaterials.js';

const font = parseSignFont(Uint8Array.from(atob(fontData.slice(fontData.indexOf(',') + 1)), char => char.charCodeAt(0)).buffer);
const meshes = (root: THREE.Object3D): THREE.Mesh[] => { const result: THREE.Mesh[] = []; root.traverse(node => { if (node instanceof THREE.Mesh) result.push(node); }); return result; };
const bake = (): THREE.CanvasTexture => {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); texture.uuid = 'test-artwork'; texture.source.uuid = 'test-artwork-pixels'; return texture as unknown as THREE.CanvasTexture;
};
const build = (recipe: Vibi3DSignRecipe, id = 'sign', sourceTexture?: THREE.Texture): THREE.Group => buildModelSign(recipe, id, { font, bake, sourceTexture });

describe('editable signs and channel glyphs', () => {
  it.each(VIBI3D_SIGN_KINDS)('%s is deterministic and round trips its recipe, geometry and embedded map', async kind => {
    const recipe = { ...defaultSignRecipe(kind), text: '모퉁이', lit: true }, first = build(recipe), second = build(recipe);
    expect(JSON.stringify(serializeModelSource(first, [])) === JSON.stringify(serializeModelSource(second, []))).toBe(true);
    const loaded = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(first, [])))); expect(loaded.object.userData['vibi3dSignRecipe']).toEqual(first.userData['vibi3dSignRecipe']);
    expect(meshes(loaded.object).map(node => node.userData['vibi3dId'])).toEqual(meshes(first).map(node => node.userData['vibi3dId']));
    if (kind === 'projecting') { const back = meshes(first).find(node => node.name === 'lettering-back')!; expect(back.rotation.y).toBe(Math.PI); }
  });
  it('extrudes real Korean contours with open glyph counters and stable semantic glyph IDs', () => {
    const recipe: Vibi3DSignRecipe = { kind: 'channel', text: '모', size: [1, 1, 0.12], background: false }, object = build(recipe);
    const glyph = meshes(object)[0]!; glyph.geometry.computeBoundingBox(); expect(glyph.geometry.boundingBox!.getSize(new THREE.Vector3()).z).toBeCloseTo(0.12);
    expect(glyph.geometry.getAttribute('position').count).toBeGreaterThan(100);
    const hole = layoutSignGlyphs(font, { text: '모', layout: 'horizontal', size: [1, 1], weight: 400 }).flatMap(value => value.shapes).flatMap(shape => shape.holes)[0]!;
    const center = new THREE.Box2().setFromPoints(hole.getPoints()).getCenter(new THREE.Vector2()); object.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(center.x, center.y, 1), new THREE.Vector3(0, 0, -1)); expect(ray.intersectObject(object, true)).toHaveLength(0);
    expect(glyph.userData['vibi3dDecorationKey']).toMatch(/^glyph-/);
  });
  it('keeps pinned source artwork separate from letters and supports image-only signs', () => {
    const texture = bake(); pinModelTexture(texture, { id: 'design', revision: 2 }, 'sign', 'map', 'link');
    const object = build({ kind: 'projecting', text: '상점', source: { kind: 'vibimage', docId: 'design' } }, 'sign', texture);
    const art = meshes(object).filter(node => node.name.startsWith('artwork')), text = meshes(object).filter(node => node.name.startsWith('lettering'));
    expect(art).toHaveLength(2); expect(text).toHaveLength(2);
    expect((art[0]!.material as THREE.MeshStandardMaterial).map!.userData['vibi3dSource'].target).toBe(art[0]!.userData['vibi3dId']);
    expect((text[0]!.material as THREE.MeshStandardMaterial).map!.userData['vibi3dSource']).toBeUndefined();
    expect(modelTextureReferences(object, [])[0]!.targets).toEqual(art.map(node => node.userData['vibi3dId']));
    const only = buildModelSign({ kind: 'panel', source: { kind: 'vibimage', docId: 'design' } }, 'image', { sourceTexture: texture });
    expect(only.userData['vibi3dSignRecipe'].text).toBe(''); expect(meshes(only).some(node => node.name.startsWith('lettering'))).toBe(false);
  });
  it('advances illuminated artwork through the shared map handler without losing lettering or keeping stale emission', () => {
    const original = bake(); pinModelTexture(original, { id: 'design', revision: 1 }, 'sign', 'map', 'link');
    const object = build({ kind: 'panel', text: '상점', lit: true, source: { kind: 'vibimage', docId: 'design' } }, 'sign', original);
    const art = meshes(object).find(node => node.name === 'artwork-front')!, lettering = meshes(object).find(node => node.name === 'lettering-front')!;
    const before = (lettering.material as THREE.MeshStandardMaterial).map;
    const next = bake(); pinModelTexture(next, { id: 'design', revision: 2 }, art.userData['vibi3dId'], 'map', 'link');
    applyModelMaterial(art, { maps: { map: { source: { kind: 'vibimage', docId: 'design' } } } }, { map: next });
    const material = art.material as THREE.MeshStandardMaterial; expect(material.emissiveMap).toBe(material.map); expect(material.map!.userData['vibi3dSource'].revision).toBe(2);
    expect((lettering.material as THREE.MeshStandardMaterial).map).toBe(before);
    expect(modelTextureReferences(object, []).map(link => [link.role, link.sourceRevision])).toEqual([['model-texture', 2]]);
  });
  it('regenerates the same root and same glyph while retaining transforms, manual children and locks', () => {
    const root = new THREE.Group(), first = build({ kind: 'channel', text: '상점' }); first.position.set(2, 3, 4); root.add(first);
    const letter = meshes(first)[0]!, id = letter.userData['vibi3dId'], manual = new THREE.Group(); manual.name = 'manual'; letter.add(manual);
    applyModelSign(root, { type: 'sign', id: 'sign', color: '#ee3333' }, build({ kind: 'channel', text: '상점', color: '#ee3333' }));
    expect(root.children[0]).toBe(first); expect(first.position.toArray()).toEqual([2, 3, 4]); expect(meshes(first).find(node => node.userData['vibi3dId'] === id)).toBe(letter); expect(manual.parent).toBe(letter);
    letter.userData['vibi3dLocked'] = true; expect(() => applyModelSign(root, { type: 'sign', id: 'sign' }, build({ kind: 'channel', text: '새 상점' }))).toThrow('object-protected');
    delete letter.userData['vibi3dLocked']; applyModelSign(root, { type: 'sign', id: 'sign' }, build({ kind: 'channel', text: '다른 글자' })); expect(manual.parent).toBe(first);
  });
});
