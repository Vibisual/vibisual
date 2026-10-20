import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { validateVibi3DRecipe, type Vibi3DRecipe } from '@vibisual/shared';
import { bakedGeometry, extrudedGeometry, roundedBoxGeometry, stairsGeometry, sweptGeometry } from './modelAdvancedGeometry.js';
import { wallGeometry } from './modelWallGeometry.js';

function geometryFor(recipe: Vibi3DRecipe): THREE.BufferGeometry {
  const { width = 1, height = 1, depth = 1, radius = 0.5, radiusTop = radius, tube = 0.15 } = recipe;
  const points = recipe.points ?? [];
  switch (recipe.kind) {
    case 'box': return new THREE.BoxGeometry(width, height, depth);
    case 'sphere': return new THREE.SphereGeometry(radius, 32, 24);
    case 'cylinder': return new THREE.CylinderGeometry(radiusTop, radius, height, 48);
    case 'cone': return new THREE.ConeGeometry(radius, height, 48);
    case 'torus': return new THREE.TorusGeometry(radius, tube, 16, 48);
    case 'plane': return new THREE.PlaneGeometry(width, height);
    case 'lathe': return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), 48);
    case 'extrude': return extrudedGeometry(recipe);
    case 'path': return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 64, tube, 12, false);
    case 'roundedBox': return roundedBoxGeometry(recipe);
    case 'capsule': return bakedGeometry(new THREE.CapsuleGeometry(radius, Math.max(0, (recipe.height ?? 2) - 2 * radius), 8, 32));
    case 'sweep': return sweptGeometry(recipe);
    case 'stairs': return stairsGeometry(recipe);
    case 'wall': return wallGeometry(recipe);
  }
}
/** Three's MIT geometry/normal helpers stay in the lazy Vibi3D app chunk. Existing recipes retain their defaults. */
export function makeGeometry(recipe: Vibi3DRecipe): THREE.BufferGeometry {
  if (!validateVibi3DRecipe(recipe)) throw new RangeError('model-recipe-invalid');
  const geometry = geometryFor(recipe);
  if (recipe.creaseAngle === undefined) return geometry;
  if (recipe.creaseAngle === 0) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    flat.computeVertexNormals(); return bakedGeometry(flat);
  }
  const creased = toCreasedNormals(geometry, THREE.MathUtils.degToRad(recipe.creaseAngle));
  if (creased !== geometry) geometry.dispose();
  return bakedGeometry(creased);
}
