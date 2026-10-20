import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VIBI3D_ARCHITECTURE_KINDS, VIBI3D_PROP_KINDS, validateVibi3DArchitectureRecipe, validateVibi3DRecipe, type Vibi3DArchitectureRecipe, type Vibi3DRecipe } from '@vibisual/shared';
import { buildArchitectureObject, defaultArchitectureRecipe } from './modelArchitecture.js';
import { ModelEditor } from './modelEditor.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';
import { makeGeometry } from './modelGeometry.js';
import { metricUvGeometry } from './modelMetricUvs.js';
import { architectureFoliageGeometry, type ArchitectureFoliageRecipe } from './architectureFoliageGeometry.js';

// Exercise the real material/source path at a bounded fixture resolution; pixel quality has dedicated 512/1024 tests.
vi.mock('./modelMaterials.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./modelMaterials.js')>();
  return { ...actual, createModelMaterial: (...args: Parameters<typeof actual.createModelMaterial>) => actual.createModelMaterial({ resolution: 128, ...args[0] }, args[1]) };
});

const byKey = (root: THREE.Object3D, key: string): THREE.Object3D | undefined => {
  let result: THREE.Object3D | undefined; root.traverse(node => { if (node.userData['vibi3dArchitectureKey'] === key) result = node; }); return result;
};
const meshes = (root: THREE.Object3D): THREE.Mesh[] => { const result: THREE.Mesh[] = []; root.traverse(node => { if (node instanceof THREE.Mesh) result.push(node); }); return result; };

describe('native architecture recipes', () => {
  it.each(VIBI3D_ARCHITECTURE_KINDS)('%s has deterministic identities, exact recipes, materials and a source round trip', async kind => {
    const recipe = defaultArchitectureRecipe(kind), first = buildArchitectureObject(recipe, 'same-owner'), second = buildArchitectureObject(recipe, 'same-owner');
    // Keep a mismatch report compact instead of dumping embedded pixel arrays into the test log.
    const firstJson = JSON.stringify(serializeModelSource(first, [])), secondJson = JSON.stringify(serializeModelSource(second, []));
    expect(firstJson === secondJson).toBe(true);
    const ids = new Set<string>(); first.traverse(node => {
      expect(node.userData['vibi3dArchitectureOwner']).toBe('same-owner'); expect(node.userData['vibi3dArchitectureKey']).toBeTruthy();
      expect(ids.has(node.userData['vibi3dId'])).toBe(false); ids.add(node.userData['vibi3dId']);
    });
    for (const mesh of meshes(first)) {
      const geometryRecipe = mesh.userData['vibi3dRecipe'] as Vibi3DRecipe;
      const foliageRecipe = mesh.userData['vibi3dFoliageRecipe'] as ArchitectureFoliageRecipe | undefined;
      if (!foliageRecipe) expect(validateVibi3DRecipe(geometryRecipe)).not.toBeNull();
      const original = foliageRecipe ? architectureFoliageGeometry(foliageRecipe) : makeGeometry(geometryRecipe);
      if (mesh.geometry.userData['vibi3dMetricUvProjection']) original.userData['vibi3dMetricUvProjection'] = structuredClone(mesh.geometry.userData['vibi3dMetricUvProjection']);
      const regenerated = metricUvGeometry(original, mesh.getWorldScale(new THREE.Vector3()));
      expect(mesh.geometry.getAttribute('position').array).toEqual(regenerated.getAttribute('position').array);
      expect(mesh.geometry.getAttribute('uv').array).toEqual(regenerated.getAttribute('uv').array);
      const material = mesh.material as THREE.MeshStandardMaterial; expect(material.map).toBeTruthy(); expect(material.normalMap).toBeTruthy(); expect(material.roughnessMap).toBeTruthy();
      original.dispose(); regenerated.dispose();
    }
    const loaded = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(first, []))));
    expect(loaded.object.userData['vibi3dArchitectureRecipe']).toEqual(first.userData['vibi3dArchitectureRecipe']);
    expect(meshes(loaded.object).map(node => node.userData['vibi3dId'])).toEqual(meshes(first).map(node => node.userData['vibi3dId']));
  });

  it.each(VIBI3D_PROP_KINDS)('%s produces editable prop parts with the requested proportions', style => {
    const recipe: Vibi3DArchitectureRecipe = { kind: 'prop', style, ...(style === 'wire' ? { path: [[-3, 5, 0], [3, 5, 0]], sag: 1 } : {}) };
    const object = buildArchitectureObject(recipe, `prop-${style}`); expect(meshes(object).length).toBeGreaterThan(0);
    expect(validateVibi3DArchitectureRecipe(object.userData['vibi3dArchitectureRecipe'])).not.toBeNull();
    if (style === 'wire') {
      const points = meshes(object)[0]!.userData['vibi3dRecipe'].points as number[][];
      expect(points[0]).toEqual([-3, 5, 0]); expect(points.at(-1)).toEqual([3, 5, 0]); expect(Math.min(...points.map(point => point[1]!))).toBeCloseTo(4);
    }
  });

  it('keeps polygon corner identities when another edge gains a vertex and leaves all elevations open', () => {
    const points: [number, number][] = [[-4, -3], [4, -3], [4, 3], [-4, 3]];
    const first = buildArchitectureObject({ kind: 'building', footprint: { kind: 'polygon', points }, floors: 2 }, 'building');
    const second = buildArchitectureObject({ kind: 'building', footprint: { kind: 'polygon', points: [points[0]!, [0, -3.2], ...points.slice(1)] }, floors: 2 }, 'building');
    expect(byKey(first, 'root/ground-floor/column-at-4-3')!.uuid).toBe(byKey(second, 'root/ground-floor/column-at-4-3')!.uuid);
    expect(meshes(first).filter(node => /wall/.test(node.name) && !node.userData['vibi3dArchitectureKey'].includes('/stair-core/'))).toHaveLength(0);
  });

  it('honours facade bayWidth/floorHeights and explicit open bays without hidden glazing or air conditioners', () => {
    const facade = buildArchitectureObject({ kind: 'facade', bayWidth: 2, floorHeights: [4.2, 3.3], floorModules: [['open', 'open', 'open'], ['window', 'solid', 'open']], acDensity: 1 }, 'facade');
    expect(byKey(facade, 'root/face/upper-floor-1')!.position.y).toBe(4.2);
    expect(byKey(facade, 'root/face/upper-floor-2')).toBeUndefined();
    expect(byKey(facade, 'root/face/upper-floor-1/bay-2')).toBeUndefined();
    const pane = byKey(facade, 'root/face/upper-floor-1/bay-0/glass') as THREE.Mesh;
    expect(pane.position.z).toBe(-0.18);
    const wall = byKey(facade, 'root/face/upper-floor-1/bay-0/wall')!;
    expect(wall.userData['vibi3dRecipe'].width).toBe(2); expect(wall.userData['vibi3dRecipe'].openings).toHaveLength(1);
  });

  it('supports zero optional band, sign, rail and kerb dimensions without zero-sized geometry', () => {
    const recipes: Vibi3DArchitectureRecipe[] = [{ kind: 'facade', bandHeight: 0 }, { kind: 'storefront', signBandHeight: 0 }, { kind: 'rooftop', railingHeight: 0 }, { kind: 'street', kerbHeight: 0 }];
    for (const recipe of recipes) for (const mesh of meshes(buildArchitectureObject(recipe, recipe.kind))) expect(validateVibi3DRecipe(mesh.userData['vibi3dRecipe'])).not.toBeNull();
  });

  it('builds a coherent editable structure with four commands and preserves the architecture recipes on save', async () => {
    const editor = new ModelEditor(new THREE.Group(), [], { projectId: 'project' });
    editor.apply([
      { type: 'building', id: 'building', footprint: { kind: 'rect', width: 12, depth: 9 }, floors: 4 },
      { type: 'facade', id: 'facade', position: [0, 0, 4.5], floorHeights: [4.2, 3.1, 3.1, 3.1], bays: 3 },
      { type: 'storefront', id: 'shop', position: [-4, 0, 4.6], style: 'wood', width: 4 },
      { type: 'street', id: 'street', position: [0, 0, 10.5], sidewalks: 'left', crosswalk: true },
    ], 0);
    expect(editor.snapshot().nodes.filter(node => node.architecture)).toHaveLength(4);
    expect(editor.snapshot().nodes.length).toBeGreaterThan(100); expect(editor.snapshot().nodes.length).toBeLessThan(350);
    expect(meshes(editor.object).length).toBeLessThan(280);
    const source = serializeModelSource(editor.object, []), loaded = await loadModelSource(source);
    expect(new ModelEditor(loaded.object).snapshot().nodes.filter(node => node.architecture).map(node => node.id).sort()).toEqual(['building', 'facade', 'shop', 'street']);
    editor.undo(); expect(editor.object.children).toHaveLength(0); editor.redo(); expect(editor.findObject('shop')).toBeTruthy();
  });
});
