import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VIBI3D_BUILTIN_KITS, VIBI3D_LIMITS, validateVibi3DRecipe, type Vibi3DArchitectureRecipe } from '@vibisual/shared';
import { buildArchitectureObject, defaultArchitectureRecipe } from './modelArchitecture.js';
import { buildModelKitBuiltin } from './modelKitBuiltins.js';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';

vi.mock('./modelMaterials.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./modelMaterials.js')>();
  return { ...actual, createModelMaterial: (...args: Parameters<typeof actual.createModelMaterial>) => actual.createModelMaterial({ resolution: 128, ...args[0] }, args[1]) };
});

const meshes = (root: THREE.Object3D): THREE.Mesh[] => { const result: THREE.Mesh[] = []; root.traverse(node => { if (node instanceof THREE.Mesh) result.push(node); }); return result; };
const key = (root: THREE.Object3D, suffix: string): THREE.Object3D | undefined => {
  let found: THREE.Object3D | undefined; root.traverse(node => { if (String(node.userData['vibi3dArchitectureKey']).endsWith(suffix)) found = node; }); return found;
};
const windowRecipe: Vibi3DArchitectureRecipe = { kind: 'facade', width: 2, bays: 1, floors: 1, height: 2.3, floorModules: [['window']], acDensity: 0, bandHeight: 0 };

describe('architectural detail without implicit document upgrades', () => {
  it('preserves omitted legacy detail on reopen and ordinary regeneration, while new commands use the detailed default', async () => {
    const old = buildArchitectureObject(windowRecipe, 'old-window'), oldMeshCount = meshes(old).length;
    expect(key(old, '/inner-frame')).toBeUndefined(); expect(defaultArchitectureRecipe('facade').detail).toBe('architectural');
    const source = new THREE.Group(); source.add(old);
    const reopened = await loadModelSource(serializeModelSource(source, [])), editor = new ModelEditor(reopened.object);
    editor.apply({ type: 'facade', id: 'old-window', windowDepth: 0.25 }, 0);
    expect(meshes(editor.findObject('old-window')!)).toHaveLength(oldMeshCount);
    expect(key(editor.findObject('old-window')!, '/inner-frame')).toBeUndefined();
    editor.apply({ type: 'facade', id: 'new-window', width: 2, floors: 1, bays: 1, height: 2.3, floorModules: [['window']], acDensity: 0 }, editor.revision);
    expect(key(editor.findObject('new-window')!, '/inner-frame')).toBeTruthy();
  });
  it('keeps stable framing identities, manual attachments, locks and undo across an explicit detail upgrade', () => {
    const scene = new THREE.Group(), old = buildArchitectureObject(windowRecipe, 'window'); scene.add(old);
    const editor = new ModelEditor(scene), frame = key(old, '/frame')!, id = String(frame.userData['vibi3dId']);
    editor.apply({ type: 'create', id: 'sticker', name: 'Manual sticker', parentId: id, recipe: { kind: 'box' } }, editor.revision);
    const attached = editor.findObject('sticker')!;
    editor.apply({ type: 'protect', id, locked: true }, editor.revision);
    expect(() => editor.apply({ type: 'facade', id: 'window', detail: 'architectural' }, editor.revision)).toThrow('object-protected');
    editor.apply({ type: 'protect', id, locked: false }, editor.revision);
    editor.apply({ type: 'facade', id: 'window', detail: 'architectural' }, editor.revision);
    expect(editor.findObject(id)).toBe(frame); expect(attached.parent).toBe(frame); expect(key(old, '/gasket')).toBeTruthy();
    editor.undo(); expect(key(old, '/gasket')).toBeUndefined(); editor.redo(); expect(key(old, '/gasket')).toBeTruthy();
    editor.apply({ type: 'facade', id: 'window', detail: 'draft' }, editor.revision);
    expect(key(old, '/gasket')).toBeUndefined(); expect(frame.userData['vibi3dArchitectureDetail']).toBeUndefined();
  });
  it('creates actual window apertures, fan grille holes, curved cloth and kerbstone gaps', () => {
    const facade = buildArchitectureObject({ ...windowRecipe, detail: 'architectural', acDensity: 1 }, 'facade');
    expect((key(facade, '/frame')!.userData['vibi3dRecipe']).holes).toHaveLength(1);
    expect((key(facade, '/grille')!.userData['vibi3dRecipe']).holes.length).toBeGreaterThan(6);
    expect(key(facade, '/left-drain')).toBeTruthy(); expect(key(facade, '/drip-edge')).toBeTruthy();
    const shop = buildArchitectureObject({ kind: 'storefront', detail: 'architectural', style: 'wood' }, 'shop');
    expect(key(shop, '/canopy')!.userData['vibi3dRecipe'].kind).toBe('extrude');
    expect(key(shop, '/valance')!.userData['vibi3dRecipe'].points.length).toBeGreaterThan(4);
    expect(meshes(shop).filter(node => node.name.startsWith('board-at-')).length).toBeGreaterThan(3);
    const street = buildArchitectureObject({ kind: 'street', detail: 'architectural', length: 3, sidewalks: 'left' }, 'street');
    const stones = meshes(street).filter(node => node.name.startsWith('stone-at-'));
    expect(stones.length).toBeGreaterThan(1); expect(stones.every(node => node.userData['vibi3dRecipe'].kind === 'roundedBox')).toBe(true);
    expect(stones.reduce((sum, node) => sum + node.userData['vibi3dRecipe'].width, 0)).toBeLessThan(3);
  });
  it('generates finite valid recipes at the supported narrow bounds', () => {
    const recipes: Vibi3DArchitectureRecipe[] = [
      { kind: 'facade', detail: 'architectural', width: 0.25, bays: 1, floors: 1, height: 1, bandHeight: 0, floorModules: [['window']], acDensity: 0 },
      { kind: 'storefront', detail: 'architectural', width: 0.75, height: 1, signBandHeight: 0, depth: 0.05, style: 'wood', awning: { depth: 0.1, drop: 0 } },
      { kind: 'street', detail: 'architectural', length: 1, kerbHeight: 0.001 },
    ];
    for (const recipe of recipes) for (const mesh of meshes(buildArchitectureObject(recipe, recipe.kind))) {
      expect(validateVibi3DRecipe(mesh.userData['vibi3dRecipe']), mesh.name).not.toBeNull();
      expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite), mesh.name).toBe(true);
    }
  });
  it.each(VIBI3D_BUILTIN_KITS)('keeps %s within the existing editable module part budget', builtin => {
    const object = buildModelKitBuiltin(builtin, 'kit');
    expect(object.userData['vibi3dArchitectureRecipe'].detail).toBe('architectural');
    expect(meshes(object).length).toBeLessThanOrEqual(VIBI3D_LIMITS.moduleParts);
  });
});
