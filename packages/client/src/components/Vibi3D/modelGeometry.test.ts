import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { VIBI3D_SHAPES, validateVibi3DRecipe, type Vibi3DRecipe } from '@vibisual/shared';
import { makeGeometry } from './modelGeometry.js';
import { defaultRecipe } from './modelRecipeDefaults.js';
import { loadModelSource, serializeModelSource } from './modelSource.js';

const square: [number, number, number][] = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]];
const opening: [number, number, number][] = [[-0.4, -0.4, 0], [0.4, -0.4, 0], [0.4, 0.4, 0], [-0.4, 0.4, 0]];
const bounds = (geometry: THREE.BufferGeometry): THREE.Vector3 => { geometry.computeBoundingBox(); return geometry.boundingBox!.getSize(new THREE.Vector3()); };
const array = (geometry: THREE.BufferGeometry, key: string): number[] => Array.from(geometry.getAttribute(key).array);
const meshFor = (recipe: Vibi3DRecipe): THREE.Mesh => new THREE.Mesh(makeGeometry(recipe), new THREE.MeshBasicMaterial());
const shoot = (mesh: THREE.Mesh, origin: [number, number, number], direction: [number, number, number] = [0, 0, -1]) =>
  new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(mesh);

describe('editable geometry recipes', () => {
  it.each(VIBI3D_SHAPES)('%s has valid defaults, deterministic buffers and an exact source round trip', async kind => {
    const recipe = defaultRecipe(kind); expect(validateVibi3DRecipe(recipe)).toEqual(recipe);
    const first = makeGeometry(recipe), second = makeGeometry(recipe);
    expect(first.getAttribute('position').count).toBeGreaterThan(0);
    for (const key of ['position', 'normal', 'uv']) {
      expect(array(first, key)).toEqual(array(second, key)); expect(array(first, key).every(Number.isFinite)).toBe(true);
    }
    const object = new THREE.Mesh(first, new THREE.MeshStandardMaterial()); object.userData['vibi3dRecipe'] = recipe;
    const loaded = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(object, []))));
    const restored = loaded.object as THREE.Mesh;
    expect(restored.userData['vibi3dRecipe']).toEqual(recipe);
    for (const key of ['position', 'normal', 'uv']) expect(array(restored.geometry, key)).toEqual(array(first, key));
    expect(restored.geometry.index?.array).toEqual(first.index?.array);
  });

  it('uses requested box dimensions with rounded corners, including a zero-radius box', () => {
    const recipe: Vibi3DRecipe = { kind: 'roundedBox', width: 2, height: 3, depth: 4, bevelRadius: 0.2 };
    const rounded = makeGeometry(recipe), size = bounds(rounded);
    expect(size.x).toBeCloseTo(2); expect(size.y).toBeCloseTo(3); expect(size.z).toBeCloseTo(4);
    expect(shoot(new THREE.Mesh(rounded, new THREE.MeshBasicMaterial()), [0.999, 1.499, 5])).toHaveLength(0);
    expect(array(makeGeometry({ ...recipe, bevelRadius: 0 }), 'position').every(Number.isFinite)).toBe(true);
  });
  it('defines capsule height as its total cap-to-cap height', () => {
    const size = bounds(makeGeometry({ kind: 'capsule', height: 2, radius: 0.4 }));
    expect(size.toArray()).toEqual([expect.closeTo(0.8), expect.closeTo(2), expect.closeTo(0.8)]);
    expect(bounds(makeGeometry({ kind: 'capsule' })).y).toBeCloseTo(2);
  });
  it('extrudes a real hole and retains bevel geometry and recipe through source serialization', async () => {
    const recipe: Vibi3DRecipe = { kind: 'extrude', points: square, holes: [opening], depth: 0.4,
      bevel: { enabled: true, size: 0.05, thickness: 0.03, segments: 3 } };
    const mesh = meshFor(recipe); mesh.userData['vibi3dRecipe'] = recipe;
    expect(shoot(mesh, [0, 0, 4])).toHaveLength(0); expect(shoot(mesh, [0.75, 0, 4]).length).toBeGreaterThan(0);
    const size = bounds(mesh.geometry); expect(size.x).toBeCloseTo(2.1); expect(size.z).toBeCloseTo(0.46);
    const loaded = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(mesh, []))));
    expect(array((loaded.object as THREE.Mesh).geometry, 'position')).toEqual(array(mesh.geometry, 'position'));
    expect(loaded.object.userData['vibi3dRecipe']).toEqual(recipe);
  });
  it('sweeps a closed profile along a three-dimensional path with caps', () => {
    const geometry = makeGeometry({ kind: 'sweep', profile: square.map(([x, y, z]) => [x * 0.1, y * 0.1, z]),
      path: [[0, 0, 0], [0, 0, 1], [1, 0, 2]] });
    const size = bounds(geometry); expect(size.z).toBeGreaterThan(1.9); expect(size.x).toBeGreaterThan(0.9); expect(size.y).toBeCloseTo(0.2);
    expect(array(geometry, 'normal').every(Number.isFinite)).toBe(true);
  });
  it('creates one closed staircase with exact tread heights and overall dimensions', () => {
    const mesh = meshFor({ kind: 'stairs', width: 1.2, height: 1.5, depth: 2, steps: 5 });
    expect(bounds(mesh.geometry).toArray()).toEqual([expect.closeTo(1.2), expect.closeTo(1.5), expect.closeTo(2)]);
    for (let step = 0; step < 5; step++) {
      const hit = shoot(mesh, [0, 5, -1 + (step + 0.5) * 0.4], [0, -1, 0])[0]!;
      expect(hit.point.y).toBeCloseTo((step + 1) * 0.3);
    }
  });
  it('leaves wall windows open, adds interior jamb depth and avoids a cap across the door floor', () => {
    const wall: Vibi3DRecipe = { kind: 'wall', width: 4, height: 3, thickness: 0.4,
      openings: [{ id: 'window', x: 1.2, y: 1, w: 1.4, h: 1.2, reveal: 0.15 }] };
    const mesh = meshFor(wall);
    expect(bounds(mesh.geometry).toArray()).toEqual([expect.closeTo(4), expect.closeTo(3), expect.closeTo(0.4)]);
    expect(shoot(mesh, [-0.1, 1.6, 4])).toHaveLength(0);
    expect(shoot(mesh, [-1.8, 1.6, 4]).length).toBeGreaterThan(0);
    expect(shoot(mesh, [-0.75, 1.6, 4])[0]!.point.z).toBeCloseTo(0.15);
    const door = meshFor({ kind: 'wall', width: 4, height: 3, thickness: 0.3, openings: [{ x: 1, y: 0, w: 1, h: 2 }] });
    expect(shoot(door, [-0.5, 1, 3])).toHaveLength(0);
    expect(shoot(door, [-0.5, -1, 0], [0, 1, 0])[0]!.point.y).toBeCloseTo(2);
  });
  it('preserves crease normals as actual buffers and treats zero degrees as flat faces', async () => {
    const flat = makeGeometry({ kind: 'box', creaseAngle: 0 }), smooth = makeGeometry({ kind: 'box', creaseAngle: 150 });
    expect(array(flat, 'normal').some(value => value === 1)).toBe(true);
    expect(array(smooth, 'normal')).not.toEqual(array(flat, 'normal'));
    const loaded = await loadModelSource(JSON.parse(JSON.stringify(serializeModelSource(new THREE.Mesh(smooth, new THREE.MeshStandardMaterial()), []))));
    expect(array((loaded.object as THREE.Mesh).geometry, 'normal')).toEqual(array(smooth, 'normal'));
  });
});
