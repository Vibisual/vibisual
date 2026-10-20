import type * as THREE from 'three';
import type { Vibi3DMaterialPreset, Vibi3DVec3 } from '@vibisual/shared';
import { ArchitectureParts, ARCHITECTURE_DETAILS as D } from './architectureParts.js';
import { ARCHITECTURAL_DETAIL as A } from './architectureDetailConfig.js';

export function rectangleProfile(width: number, height: number): Vibi3DVec3[] {
  return [[-width / 2, -height / 2, 0], [width / 2, -height / 2, 0], [width / 2, height / 2, 0], [-width / 2, height / 2, 0]];
}
/** One editable ring, with actual glazing aperture and bevel, rather than four overlapping bars. */
export function architecturalFrame(parts: ArchitectureParts, parent: THREE.Object3D, key: string, width: number, height: number,
  border: number, depth: number, position: Vibi3DVec3, preset: Vibi3DMaterialPreset = 'aluminium'): THREE.Mesh {
  const inset = Math.min(border, width * A.frame.narrowFraction, height * A.frame.narrowFraction);
  const bevel = Math.min(A.edge.radius, inset * A.edge.maximumFraction, depth * A.edge.maximumFraction);
  return parts.mesh(parent, key, { kind: 'extrude', depth, points: rectangleProfile(width, height),
    holes: [rectangleProfile(width - inset * 2, height - inset * 2)],
    bevel: { enabled: true, thickness: bevel, size: bevel, segments: A.edge.segments } }, position, preset,
  preset === 'rubber' ? { params: { color: A.colors.gasket }, wear: 0.15 } : undefined);
}

export function architecturalWindow(parts: ArchitectureParts, group: THREE.Group, width: number, height: number, depth: number, balcony: boolean): void {
  const openingWidth = width * D.facade.windowRatio, sillY = Math.min(D.facade.sillHeight, height * 0.25);
  const openingHeight = height - sillY - Math.min(D.facade.headHeight, height * 0.15), center = sillY + openingHeight / 2;
  const border = Math.min(A.frame.width, openingWidth * A.frame.narrowFraction, openingHeight * A.frame.narrowFraction);
  const reveal = Math.min(A.frame.reveal, border);
  parts.mesh(group, 'wall', { kind: 'wall', width, height, thickness: D.wall,
    openings: [{ x: (width - openingWidth) / 2, y: sillY, w: openingWidth, h: openingHeight, reveal }] }, [0, 0, 0], 'painted-concrete');
  architecturalFrame(parts, group, 'frame', openingWidth, openingHeight, border, Math.max(D.wall, depth + D.wall / 2), [0, center, -depth]);
  const sashWidth = openingWidth - border * 2, sashHeight = openingHeight - border * 2;
  architecturalFrame(parts, group, 'inner-frame', sashWidth, sashHeight, border, A.frame.depth, [0, center, -depth - A.frame.sashSetback]);
  const glassWidth = sashWidth - border * 2, glassHeight = sashHeight - border * 2;
  architecturalFrame(parts, group, 'gasket', glassWidth + A.frame.gasket, glassHeight + A.frame.gasket,
    A.frame.gasket, A.frame.gasketDepth, [0, center, -depth + D.glass / 2], 'rubber');
  parts.box(group, 'glass', [glassWidth, glassHeight, D.glass], [0, center, -depth], 'glass', { wear: 0.15 });
  if (openingWidth >= A.frame.mullionMinimum) parts.roundedBox(group, 'mullion', [border, glassHeight, A.frame.depth], [0, center, -depth + A.frame.depth / 2]);
  const sillDepth = Math.max(D.wall, depth + D.wall / 2) + A.frame.sillProjection;
  const sill = parts.roundedBox(group, 'sill', [openingWidth + D.sill, D.sill, sillDepth], [0, sillY, -depth / 2], 'granite');
  sill.rotation.x = A.frame.sillSlope;
  parts.box(group, 'drip-edge', [openingWidth, A.frame.dripHeight, A.frame.dripHeight],
    [0, sillY - D.sill / 2, -depth / 2 + sillDepth / 2 - A.frame.dripSetback], 'aluminium');
  for (const side of [-1, 1]) parts.box(group, side < 0 ? 'left-drain' : 'right-drain',
    [Math.min(A.frame.drainWidth, glassWidth / 4), A.frame.drainHeight, A.frame.gasketDepth],
    [side * glassWidth * A.frame.drainInset, center - sashHeight / 2 + border / 2, -depth + A.frame.depth], 'rubber');
  parts.box(group, 'interior-back', [openingWidth, openingHeight, D.wall], [0, center, -depth - 0.75], 'painted-concrete', { params: { color: D.colors.interior } });
  if (balcony) {
    parts.roundedBox(group, 'balcony-slab', [width, D.slab, 0.9], [0, sillY - D.slab, 0.35], 'painted-concrete');
    architecturalFrame(parts, group, 'balcony-rail', width, 0.9, D.rail, D.rail, [0, sillY + 0.4, 0.8]);
  }
}
