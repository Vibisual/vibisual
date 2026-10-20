import * as THREE from 'three';

/** App-owned, baked compound geometry: exact inputs are retained beside its buffer, not as an unrelated primitive. */
export interface ArchitectureFoliageRecipe { version: 1; seed: number; leaves: number; spread: number; length: number; width: number }
const SHAPE = { rows: 6, columns: 2, cup: 0.16, arch: 0.18, droop: 0.18, lengthVariation: 0.35,
  tilt: 0.75, heightSpread: 0.65, colorVariation: 0.23, maxLeaves: 48 } as const;

export function foliageSeed(key: string): number {
  let value = 0x811c9dc5;
  for (const character of key) value = Math.imul(value ^ character.charCodeAt(0), 0x01000193) >>> 0;
  return value;
}
function randomFor(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
export function architectureFoliageGeometry(recipe: ArchitectureFoliageRecipe): THREE.BufferGeometry {
  if (recipe.version !== 1 || !Number.isInteger(recipe.seed) || recipe.seed < 0 || recipe.seed > 4294967295
    || !Number.isInteger(recipe.leaves) || recipe.leaves < 1 || recipe.leaves > SHAPE.maxLeaves
    || ![recipe.spread, recipe.length, recipe.width].every(value => Number.isFinite(value) && value > 0 && value <= 200)) throw new RangeError('architecture-foliage-invalid');
  const positions: number[] = [], colors: number[] = [], indices: number[] = [], random = randomFor(recipe.seed);
  const vertex = new THREE.Vector3(), offset = new THREE.Vector3(), rotation = new THREE.Quaternion();
  for (let leaf = 0; leaf < recipe.leaves; leaf++) {
    const base = positions.length / 3, angle = random() * Math.PI * 2, distance = recipe.spread * Math.sqrt(random());
    offset.set(Math.sin(angle) * distance, (random() - 0.5) * recipe.spread * SHAPE.heightSpread, Math.cos(angle) * distance);
    rotation.setFromEuler(new THREE.Euler((random() - 0.5) * SHAPE.tilt, angle, (random() - 0.5) * SHAPE.tilt));
    const length = recipe.length * (1 - SHAPE.lengthVariation * random()), width = recipe.width * (1 - SHAPE.lengthVariation * random());
    const shade = 1 - random() * SHAPE.colorVariation;
    for (let row = 0; row <= SHAPE.rows; row++) for (let column = 0; column <= SHAPE.columns; column++) {
      const t = row / SHAPE.rows, u = column / SHAPE.columns * 2 - 1, contour = Math.sin(Math.PI * t);
      vertex.set(u * width * Math.pow(contour, 0.7) / 2,
        length * (SHAPE.arch * contour - SHAPE.droop * t * t) + width * SHAPE.cup * (1 - Math.abs(u)) * contour, length * t);
      vertex.applyQuaternion(rotation).add(offset); positions.push(vertex.x, vertex.y, vertex.z);
      // A lighter folded midrib is geometry/vertex colour, so the silhouette and shading survive every renderer and OS.
      const vein = Math.abs(u) < 0.5 ? 1 : 0.88;
      colors.push(shade * vein, shade, shade * vein);
    }
    for (let row = 0; row < SHAPE.rows; row++) for (let column = 0; column < SHAPE.columns; column++) {
      const a = base + row * (SHAPE.columns + 1) + column, b = a + SHAPE.columns + 1;
      if (row > 0) indices.push(a, b, a + 1);
      if (row < SHAPE.rows - 1) indices.push(a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.userData['vibi3dFoliageRecipe'] = structuredClone(recipe); geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}
