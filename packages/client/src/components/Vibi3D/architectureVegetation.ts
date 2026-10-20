import * as THREE from 'three';
import type { Vibi3DVec3 } from '@vibisual/shared';
import { ArchitectureParts, ARCHITECTURE_DETAILS as D } from './architectureParts.js';
import { architectureFoliageGeometry, foliageSeed, type ArchitectureFoliageRecipe } from './architectureFoliageGeometry.js';

const VEGETATION = {
  leaf: { color: '#637e3e', secondary: '#3f5c29', contrast: 0.2, roughness: 0.88, normalStrength: 0.18 },
  planter: { leaves: 14, spread: 0.24, length: 0.8, width: 0.26, stemRadius: 0.014, soilHeight: 0.85,
    rimHeight: 0.06, rimOverhang: 1.035 },
  tree: { leaves: 32, spread: 0.1, length: 0.13, width: 0.065, trunkHeight: 0.48, branchRadius: 0.018 },
  plantBranches: [
    ['upright', 0, 1.15, 0], ['front-left', -0.42, 0.63, 0.35], ['front-right', 0.4, 0.9, 0.35],
    ['rear-left', -0.35, 0.95, -0.37], ['rear-right', 0.38, 0.6, -0.3],
  ],
  treeBranches: [
    ['crown', 0, 0.87, 0], ['front-left', -0.24, 0.66, 0.18], ['front-right', 0.24, 0.61, 0.18],
    ['rear-left', -0.22, 0.7, -0.19], ['rear-right', 0.21, 0.76, -0.2], ['front', 0, 0.77, 0.29], ['rear', 0, 0.58, -0.25],
  ],
} as const;

function cluster(parts: ArchitectureParts, parent: THREE.Object3D, seedKey: string, recipe: Omit<ArchitectureFoliageRecipe, 'version' | 'seed'>): void {
  const input: ArchitectureFoliageRecipe = { version: 1, seed: foliageSeed(seedKey), ...recipe }, C = VEGETATION.leaf;
  const mesh = parts.bufferMesh(parent, 'leaves', architectureFoliageGeometry(input), input, [0, 0, 0], 'plastic',
    { params: { color: C.color, secondaryColor: C.secondary, contrast: C.contrast, normalStrength: C.normalStrength }, roughness: C.roughness, side: 'double', wear: 0.12 });
  mesh.userData['vibi3dFoliageRecipe'] = structuredClone(input); (mesh.material as THREE.MeshStandardMaterial).vertexColors = true;
}
function stem(parts: ArchitectureParts, parent: THREE.Object3D, start: Vibi3DVec3, end: Vibi3DVec3, radius: number): void {
  const direction = new THREE.Vector3(...end).sub(new THREE.Vector3(...start));
  const mesh = parts.cylinder(parent, 'stem', radius, direction.length(), start.map((value, axis) => (value + end[axis]!) / 2) as Vibi3DVec3, 'wood-planks', radius * 0.55);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

export function architecturalPlant(parts: ArchitectureParts, radius: number, potHeight: number): void {
  const C = VEGETATION.planter, plant = parts.group(parts.root, 'plant'), soil = potHeight * C.soilHeight;
  const rimHeight = Math.min(radius * C.rimHeight, potHeight * 0.08), outer = radius * C.rimOverhang;
  parts.mesh(parts.root, 'lip', { kind: 'lathe', points: [[radius * 0.89, 0, 0], [outer, 0, 0], [outer, rimHeight, 0], [radius * 0.89, rimHeight, 0], [radius * 0.89, 0, 0]] },
    [0, potHeight - rimHeight / 2, 0], 'plastic', { params: { color: D.colors.ceramic }, roughness: 0.9 });
  for (const [key, x, y, z] of VEGETATION.plantBranches) {
    const end: Vibi3DVec3 = [radius * x, potHeight + radius * y, radius * z], branch = parts.group(plant, key, end);
    stem(parts, branch, [-end[0], soil - end[1], -end[2]], [0, 0, 0], radius * C.stemRadius);
    cluster(parts, branch, `${parts.id}/plant/${key}`, { leaves: C.leaves, spread: radius * C.spread, length: radius * C.length, width: radius * C.width });
  }
}

export function architecturalTree(parts: ArchitectureParts, width: number, height: number, radius: number): void {
  const C = VEGETATION.tree, trunkHeight = height * C.trunkHeight;
  parts.cylinder(parts.root, 'trunk', radius, trunkHeight, [0, trunkHeight / 2, 0], 'wood-planks', radius * 0.6);
  for (const [key, x, y, z] of VEGETATION.treeBranches) {
    const end: Vibi3DVec3 = [width * x, height * y, width * z], branch = parts.group(parts.root, key, end);
    stem(parts, branch, [-end[0], trunkHeight * 0.65 - end[1], -end[2]], [0, 0, 0], Math.min(width * C.branchRadius, radius * 0.7));
    cluster(parts, branch, `${parts.id}/tree/${key}`, { leaves: C.leaves, spread: width * C.spread, length: width * C.length, width: width * C.width });
  }
}
