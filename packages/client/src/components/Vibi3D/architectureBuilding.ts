import * as THREE from 'three';
import type { Vibi3DArchitectureRecipe, Vibi3DVec3 } from '@vibisual/shared';
import { ArchitectureParts, ARCHITECTURE_DETAILS as D } from './architectureParts.js';

type Building = Extract<Vibi3DArchitectureRecipe, { kind: 'building' }>;
type Rooftop = Extract<Vibi3DArchitectureRecipe, { kind: 'rooftop' }>;

export function buildingFootprint(recipe: Building): [number, number][] {
  const footprint = recipe.footprint ?? { kind: 'rect', width: 12, depth: 9 };
  if (footprint.kind === 'polygon') return footprint.points.map(point => [...point]);
  const x = footprint.width / 2, z = footprint.depth / 2;
  if (footprint.kind === 'l') return [[-x, -z], [x, -z], [x, -z + footprint.wingDepth], [-x + footprint.wingWidth, -z + footprint.wingDepth], [-x + footprint.wingWidth, z], [-x, z]];
  return [[-x, -z], [x, -z], [x, z], [-x, z]];
}

function floorPlate(parts: ArchitectureParts, parent: THREE.Object3D, polygon: [number, number][], key: string, y: number): void {
  const points: Vibi3DVec3[] = polygon.map(([x, z]) => [x, -z, 0]);
  const slab = parts.mesh(parent, key, { kind: 'extrude', points, depth: D.slab }, [0, y, 0], 'painted-concrete');
  slab.rotation.x = -Math.PI / 2;
}

export function buildBuilding(parts: ArchitectureParts, recipe: Building): void {
  const polygon = buildingFootprint(recipe), floors = recipe.floors ?? D.facade.floors;
  const cornerKeys = recipe.footprint?.kind === 'polygon' ? polygon.map(([x, z]) => `at-${x}-${z}`)
    : recipe.footprint?.kind === 'l' ? ['back-left', 'back-right', 'recess-right', 'inner-corner', 'recess-front', 'front-left'] : ['back-left', 'back-right', 'front-right', 'front-left'];
  const ground = recipe.groundFloorHeight ?? D.facade.ground, upper = recipe.upperFloorHeight ?? D.facade.upper;
  let elevation = 0;
  for (let level = 0; level < floors; level++) {
    const height = level === 0 ? ground : upper;
    const floor = parts.group(parts.root, level === 0 ? 'ground-floor' : `upper-floor-${level}`, [0, elevation, 0]);
    floorPlate(parts, floor, polygon, 'slab', 0);
    polygon.forEach(([x, z], corner) => parts.box(floor, `column-${cornerKeys[corner]}`, [D.wall * 2, height, D.wall * 2], [x, height / 2, z]));
    // All elevations stay open. A separate facade supplies windows or solid modules without hidden walls blocking glazing.
    elevation += height;
  }
  floorPlate(parts, parts.root, polygon, 'roof-slab', elevation);
  const minX = Math.min(...polygon.map(point => point[0])), minZ = Math.min(...polygon.map(point => point[1]));
  const maxX = Math.max(...polygon.map(point => point[0])), maxZ = Math.max(...polygon.map(point => point[1]));
  const core = parts.group(parts.root, 'stair-core', [minX + 1, 0, minZ + 1]);
  parts.box(core, 'rear-wall', [1.8, elevation + 1, D.wall], [0, (elevation + 1) / 2, -0.8]);
  parts.box(core, 'side-wall', [D.wall, elevation + 1, 1.8], [-0.8, (elevation + 1) / 2, 0]);
  for (let level = 0; level < floors; level++) {
    const y = level ? ground + (level - 1) * upper : 0, rise = (level ? upper : ground) / 2;
    parts.box(core, `landing-${level}`, [1.6, D.slab, 1.6], [0, y, 0]);
    parts.mesh(core, `stair-${level}-outbound`, { kind: 'stairs', width: 0.75, height: rise, depth: 1.6, steps: 10 }, [-0.4, y + D.slab, 0], 'painted-concrete');
    const returning = parts.mesh(core, `stair-${level}-return`, { kind: 'stairs', width: 0.75, height: rise, depth: 1.6, steps: 10 }, [0.4, y + rise, 0], 'painted-concrete');
    returning.rotation.y = Math.PI;
  }
  if (recipe.roof === 'pitched') {
    const width = maxX - minX, depth = maxZ - minZ, rise = Math.min(2, width / 5);
    const points: Vibi3DVec3[] = [[-width / 2, 0, 0], [width / 2, 0, 0], [0, rise, 0]];
    parts.mesh(parts.root, 'pitched-roof', { kind: 'extrude', points, depth }, [(minX + maxX) / 2, elevation + D.slab, minZ], 'corrugated-metal');
  }
}

export function buildRooftop(parts: ArchitectureParts, recipe: Rooftop): void {
  const width = recipe.width ?? D.roof.width, depth = recipe.depth ?? D.roof.depth, height = recipe.railingHeight ?? D.roof.railingHeight;
  const sides: [string, Vibi3DVec3, Vibi3DVec3][] = [
    ['front', [width, D.rail, D.rail], [0, height, depth / 2]], ['back', [width, D.rail, D.rail], [0, height, -depth / 2]],
    ['left', [D.rail, D.rail, depth], [-width / 2, height, 0]], ['right', [D.rail, D.rail, depth], [width / 2, height, 0]],
  ];
  for (const [name, size, position] of height > 0 ? sides : []) {
    parts.box(parts.root, `${name}-top-rail`, size, position, 'aluminium');
    parts.box(parts.root, `${name}-parapet`, [size[0], height * 0.4, size[2]], [position[0], height * 0.2, position[2]], 'painted-concrete');
  }
  for (const [name, x, z] of [['front-left', -width / 2, depth / 2], ['front-right', width / 2, depth / 2], ['back-left', -width / 2, -depth / 2], ['back-right', width / 2, -depth / 2]] as const) {
    if (height > 0) parts.box(parts.root, `${name}-post`, [D.rail, height, D.rail], [x, height / 2, z], 'aluminium');
  }
  if (recipe.waterTank !== false) {
    const tank = typeof recipe.waterTank === 'object' ? recipe.waterTank : {};
    const radius = tank.radius ?? D.roof.tankRadius, tankHeight = tank.height ?? D.roof.tankHeight;
    const group = parts.group(parts.root, 'water-tank', [width * 0.22, 0, -depth * 0.2]);
    parts.cylinder(group, 'body', radius, tankHeight, [0, tankHeight / 2 + 0.35, 0], 'aluminium');
    parts.cylinder(group, 'lid', radius * 1.03, 0.12, [0, tankHeight + 0.41, 0], 'aluminium');
    parts.box(group, 'plinth', [radius * 1.8, 0.35, radius * 1.8], [0, 0.175, 0]);
    parts.pathMesh(group, 'feed-pipe', [[radius, tankHeight * 0.8, 0], [radius + 0.2, tankHeight * 0.8, 0], [radius + 0.2, 0, 0]], D.pipe);
  }
  if (recipe.antenna !== false) {
    const group = parts.group(parts.root, 'antenna', [-width * 0.25, 0, -depth * 0.25]);
    parts.cylinder(group, 'mast', D.pipe, 2.5, [0, 1.25, 0]);
    for (const [name, y, span] of [['upper', 2.25, 1.2], ['middle', 2, 0.9], ['lower', 1.75, 0.6]] as const) parts.box(group, name, [span, D.pipe, D.pipe], [0, y, 0], 'aluminium');
  }
}
