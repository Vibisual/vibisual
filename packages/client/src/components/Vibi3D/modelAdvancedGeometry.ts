import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Vibi3DRecipe } from '@vibisual/shared';

/** Persist actual vertices, since Three's ObjectLoader does not register example geometry constructors. */
export function bakedGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry().copy(source); source.dispose();
  // JSON has no negative zero. Canonicalize it before storage so exact buffer comparisons remain stable.
  for (const attribute of Object.values(geometry.attributes)) if (attribute instanceof THREE.BufferAttribute) {
    for (let index = 0; index < attribute.array.length; index++) if (attribute.array[index] === 0) attribute.array[index] = 0;
  }
  return geometry;
}
export function roundedBoxGeometry(recipe: Vibi3DRecipe): THREE.BufferGeometry {
  const width = recipe.width ?? 1, height = recipe.height ?? 1, depth = recipe.depth ?? 1;
  // MIT Three examples provide rounding; no custom geometry kernel or runtime dependency is needed.
  return bakedGeometry(new RoundedBoxGeometry(width, height, depth, recipe.bevelSegments ?? 3,
    recipe.bevelRadius ?? Math.min(0.1, width / 2, height / 2, depth / 2)));
}
export function extrudedGeometry(recipe: Vibi3DRecipe): THREE.BufferGeometry {
  const shape = new THREE.Shape((recipe.points ?? []).map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes = (recipe.holes ?? []).map(points => new THREE.Path(points.map(([x, y]) => new THREE.Vector2(x, y))));
  const bevel = recipe.bevel;
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: recipe.depth ?? 1, steps: 1, bevelEnabled: bevel?.enabled ?? !!bevel,
    bevelThickness: bevel?.thickness ?? 0.02, bevelSize: bevel?.size ?? 0.02, bevelSegments: bevel?.segments ?? 3 });
  return recipe.holes || recipe.bevel ? bakedGeometry(geometry) : geometry;
}
export function sweptGeometry(recipe: Vibi3DRecipe): THREE.BufferGeometry {
  const shape = new THREE.Shape((recipe.profile ?? []).map(([x, y]) => new THREE.Vector2(x, y)));
  const curve = new THREE.CatmullRomCurve3((recipe.path ?? []).map(point => new THREE.Vector3(...point)));
  return bakedGeometry(new THREE.ExtrudeGeometry(shape, { steps: 64, bevelEnabled: false, extrudePath: curve }));
}
/** One closed stepped profile, rather than overlapping boxes with hidden internal faces. */
export function stairsGeometry(recipe: Vibi3DRecipe): THREE.BufferGeometry {
  const width = recipe.width ?? 1, height = recipe.height ?? 1, depth = recipe.depth ?? 1, steps = recipe.steps ?? 5;
  const rise = height / steps, run = depth / steps;
  const points = [new THREE.Vector2(0, 0), new THREE.Vector2(0, rise)];
  for (let step = 1; step <= steps; step++) {
    points.push(new THREE.Vector2(step * run, step * rise));
    if (step < steps) points.push(new THREE.Vector2(step * run, (step + 1) * rise));
  }
  points.push(new THREE.Vector2(depth, 0));
  const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(points), { depth: width, steps: 1, bevelEnabled: false });
  // Profile X becomes +Z, extrusion Z becomes -X: front is the low end, bottom stays at Y=0.
  geometry.rotateY(-Math.PI / 2); geometry.translate(width / 2, 0, -depth / 2);
  return bakedGeometry(geometry);
}
