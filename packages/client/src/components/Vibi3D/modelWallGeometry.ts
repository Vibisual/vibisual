import * as THREE from 'three';
import type { Vibi3DRecipe } from '@vibisual/shared';
import { metricUvGeometry } from './modelMetricUvs.js';
import { bakedGeometry } from './modelAdvancedGeometry.js';

type Point = [number, number, number];
interface Aperture { left: number; right: number; bottom: number; top: number; reveal: number }

/** Rectangular partitions and jamb quads leave true openings without CSG or coincident internal box faces. */
export function wallGeometry(recipe: Vibi3DRecipe): THREE.BufferGeometry {
  const width = recipe.width ?? 1, height = recipe.height ?? 1, thickness = recipe.thickness ?? 0.2;
  const left = -width / 2, right = width / 2, front = thickness / 2, back = -front;
  const holes: Aperture[] = (recipe.openings ?? []).map(opening => ({ left: left + opening.x, right: left + opening.x + opening.w,
    bottom: opening.y, top: opening.y + opening.h, reveal: opening.reveal ?? 0 }));
  const positions: number[] = [];
  const quad = (a: Point, b: Point, c: Point, d: Point) => positions.push(...a, ...b, ...d, ...b, ...c, ...d);
  const inner = (hole: Aperture): Aperture => ({ left: hole.left + hole.reveal, right: hole.right - hole.reveal,
    bottom: hole.bottom + hole.reveal, top: hole.top - hole.reveal, reveal: 0 });
  const ordered = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  const face = (apertures: Aperture[], z: number, reverse: boolean) => {
    const xs = ordered([left, right, ...apertures.flatMap(hole => [hole.left, hole.right])]);
    const ys = ordered([0, height, ...apertures.flatMap(hole => [hole.bottom, hole.top])]);
    for (let xi = 0; xi < xs.length - 1; xi++) for (let yi = 0; yi < ys.length - 1; yi++) {
      const x0 = xs[xi]!, x1 = xs[xi + 1]!, y0 = ys[yi]!, y1 = ys[yi + 1]!;
      const x = (x0 + x1) / 2, y = (y0 + y1) / 2;
      if (apertures.some(hole => x > hole.left && x < hole.right && y > hole.bottom && y < hole.top)) continue;
      if (reverse) quad([x0, y0, z], [x0, y1, z], [x1, y1, z], [x1, y0, z]);
      else quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
    }
  };
  face(holes, front, false); face(holes.map(inner), back, true);
  // Skip an outer boundary strip when a through-door or edge opening reaches it.
  for (const side of ['left', 'right', 'bottom', 'top'] as const) {
    const horizontal = side === 'bottom' || side === 'top', boundary = side === 'left' ? left : side === 'right' ? right : side === 'bottom' ? 0 : height;
    const touching = holes.filter(hole => !hole.reveal && Math.abs(hole[side] - boundary) < 1e-8);
    const cuts = ordered([horizontal ? left : 0, horizontal ? right : height,
      ...touching.flatMap(hole => horizontal ? [hole.left, hole.right] : [hole.bottom, hole.top])]);
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i]!, b = cuts[i + 1]!, middle = (a + b) / 2;
      if (touching.some(hole => horizontal ? middle > hole.left && middle < hole.right : middle > hole.bottom && middle < hole.top)) continue;
      if (side === 'left') quad([left, a, back], [left, a, front], [left, b, front], [left, b, back]);
      if (side === 'right') quad([right, a, front], [right, a, back], [right, b, back], [right, b, front]);
      if (side === 'bottom') quad([a, 0, back], [b, 0, back], [b, 0, front], [a, 0, front]);
      if (side === 'top') quad([a, height, front], [b, height, front], [b, height, back], [a, height, back]);
    }
  }
  const jamb = (outer: Aperture, inside: Aperture, z0: number, z1: number) => {
    if (outer.left > left || inside.left > left) quad([outer.left, outer.bottom, z0], [inside.left, inside.bottom, z1], [inside.left, inside.top, z1], [outer.left, outer.top, z0]);
    if (outer.right < right || inside.right < right) quad([outer.right, outer.top, z0], [inside.right, inside.top, z1], [inside.right, inside.bottom, z1], [outer.right, outer.bottom, z0]);
    if (outer.bottom > 0 || inside.bottom > 0) quad([outer.right, outer.bottom, z0], [inside.right, inside.bottom, z1], [inside.left, inside.bottom, z1], [outer.left, outer.bottom, z0]);
    if (outer.top < height || inside.top < height) quad([outer.left, outer.top, z0], [inside.left, inside.top, z1], [inside.right, inside.top, z1], [outer.right, outer.top, z0]);
  };
  for (const hole of holes) {
    const throat = inner(hole), join = front - hole.reveal;
    if (hole.reveal) jamb(hole, throat, front, join);
    if (join > back) jamb(throat, throat, join, back);
  }
  const raw = new THREE.BufferGeometry(); raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); raw.computeVertexNormals();
  const geometry = metricUvGeometry(raw, new THREE.Vector3(1, 1, 1)); raw.dispose(); return bakedGeometry(geometry);
}
