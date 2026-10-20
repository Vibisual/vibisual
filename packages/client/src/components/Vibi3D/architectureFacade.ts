import * as THREE from 'three';
import { resolveVibi3DFacadeLayout, type Vibi3DArchitectureRecipe, type Vibi3DRecipe, type Vibi3DVec3 } from '@vibisual/shared';
import { ArchitectureParts, ARCHITECTURE_DETAILS as D } from './architectureParts.js';
import { architecturalWindow } from './architectureFrames.js';
import { architecturalAirConditioner } from './architectureFixtures.js';

type Facade = Extract<Vibi3DArchitectureRecipe, { kind: 'facade' }>;
export function facadeFloorHeights(recipe: Facade): number[] {
  return resolveVibi3DFacadeLayout(recipe).floorHeights;
}

function windowBay(parts: ArchitectureParts, group: THREE.Group, width: number, height: number, depth: number, balcony: boolean): void {
  if (parts.detailed) { architecturalWindow(parts, group, width, height, depth, balcony); return; }
  const openingWidth = width * D.facade.windowRatio, sillY = Math.min(D.facade.sillHeight, height * 0.25);
  const openingHeight = height - sillY - Math.min(D.facade.headHeight, height * 0.15), border = (width - openingWidth) / 2;
  const center = sillY + openingHeight / 2;
  const wall: Vibi3DRecipe = { kind: 'wall', width, height, thickness: D.wall, openings: [{ x: border, y: sillY, w: openingWidth, h: openingHeight, reveal: 0 }] };
  parts.mesh(group, 'wall', wall, [0, 0, 0], 'painted-concrete');
  const frameDepth = Math.max(D.wall, depth + D.wall / 2), frameZ = -depth / 2;
  const rectangle = (x: number, y: number, w: number, h: number): Vibi3DVec3[] => [[x, y, 0], [x + w, y, 0], [x + w, y + h, 0], [x, y + h, 0]];
  const frame: Vibi3DRecipe = { kind: 'extrude', depth: frameDepth, points: rectangle(0, 0, openingWidth, openingHeight), holes: [rectangle(D.frame, D.frame, openingWidth - D.frame * 2, openingHeight - D.frame * 2)] };
  parts.mesh(group, 'frame', frame, [-openingWidth / 2, sillY, -depth], 'aluminium');
  parts.box(group, 'sill', [openingWidth + D.sill, D.sill, frameDepth + D.sill], [0, sillY, frameZ], 'granite');
  parts.box(group, 'glass', [openingWidth - D.frame * 2, openingHeight - D.frame, D.glass], [0, center, -depth], 'glass', { wear: 0.15 });
  parts.box(group, 'interior-back', [openingWidth, openingHeight, D.wall], [0, center, -depth - 0.75], 'painted-concrete', { params: { color: D.colors.interior } });
  if (balcony) {
    parts.box(group, 'balcony-slab', [width, D.slab, 0.9], [0, sillY - D.slab, 0.35]);
    parts.box(group, 'balcony-rail', [width, 0.9, D.rail], [0, sillY + 0.4, 0.8], 'aluminium');
  }
}

function airConditioner(parts: ArchitectureParts, parent: THREE.Object3D, x: number, y: number): void {
  if (parts.detailed) { architecturalAirConditioner(parts, parent, x, y); return; }
  const group = parts.group(parent, 'air-conditioner', [x, y, 0.4]);
  parts.box(group, 'housing', [0.75, 0.5, 0.3], [0, 0, 0], 'aluminium');
  const fan = parts.cylinder(group, 'fan', 0.18, 0.025, [-0.1, 0, 0.16], 'rubber'); fan.rotation.x = Math.PI / 2;
  parts.pathMesh(group, 'drain', [[0.3, 0, 0], [0.45, -0.2, -0.2], [0.45, -0.9, -0.2]], D.pipe);
}

/** Origin lies on the wall face; position the command on the chosen building side. Ground floor defaults open for shops. */
export function buildFacade(parts: ArchitectureParts, recipe: Facade): void {
  const { width, bays, bayWidth, floorHeights: heights, bandHeight: band } = resolveVibi3DFacadeLayout(recipe);
  const depth = recipe.windowDepth ?? D.facade.windowDepth, eaves = recipe.eavesDepth ?? D.facade.eaves;
  const wall = parts.group(parts.root, 'face');
  wall.rotation.y = ({ front: 0, back: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 } as const)[recipe.side ?? 'front'];
  let y = 0;
  heights.forEach((height, level) => {
    const floor = parts.group(wall, level === 0 ? 'ground-floor' : `upper-floor-${level}`, [0, y, 0]);
    if (band > 0) parts.box(floor, 'floor-band', [width, band, D.wall + eaves], [0, height - band / 2, eaves / 2], 'wall-tile');
    // An omitted ground pattern reserves clear shop openings instead of hiding future storefronts behind a wall.
    if (level !== 0 || recipe.floorModules?.[0]) for (let bay = 0; bay < bays; bay++) {
      const style = recipe.floorModules?.[level]?.[bay] ?? 'window';
      if (style === 'open') continue;
      const group = parts.group(floor, `bay-${bay}`, [-width / 2 + (bay + 0.5) * bayWidth, 0, 0]);
      if (style === 'solid') parts.box(group, 'wall', [bayWidth, height - band, D.wall], [0, (height - band) / 2, 0]);
      else windowBay(parts, group, bayWidth, height - band, depth, style === 'balcony');
      if ((level * 7 + bay * 13) % 17 / 17 < (recipe.acDensity ?? D.facade.acDensity)) airConditioner(parts, group, bayWidth * 0.25, height * 0.3);
    }
    y += height;
  });
  parts.pathMesh(wall, 'rainwater-pipe', [[width / 2 - D.wall, y, 0.3], [width / 2 - D.wall, 0.4, 0.3], [width / 2 - D.wall + 0.3, 0.1, 0.6]], D.pipe);
}
