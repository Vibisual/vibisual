import type * as THREE from 'three';
import { ArchitectureParts, ARCHITECTURE_DETAILS as D } from './architectureParts.js';
import { ARCHITECTURAL_DETAIL as A } from './architectureDetailConfig.js';
import { architecturalFrame } from './architectureFrames.js';

export function woodPanels(parts: ArchitectureParts, parent: THREE.Object3D, width: number, height: number, depth: number): void {
  const C = A.wood, count = Math.max(1, Math.min(C.maxPlanks, Math.ceil(width / C.plankWidth)));
  const group = parts.group(parent, 'wood-cladding'), span = width / count, gap = Math.min(C.gap, span / 10);
  parts.box(group, 'joint-backing', [width, height, depth], [0, height / 2, -depth / 2], 'wood-planks', { params: { color: A.colors.joint } });
  for (let panel = 0; panel < count; panel++) {
    const x = -width / 2 + (panel + 0.5) * span;
    parts.roundedBox(group, `board-at-${x.toFixed(4)}`, [span - gap, height, Math.min(depth, C.thickness)],
      [x, height / 2, C.thickness / 2], 'wood-planks', { offset: [x, 0], rotation: C.grainRotation,
        params: { color: A.colors.wood, secondaryColor: A.colors.woodSecondary } });
  }
}

export function shopWindowFrame(parts: ArchitectureParts, group: THREE.Object3D, width: number, opening: number, base: number, depth: number): void {
  const height = opening - base - D.frame, border = Math.min(A.frame.width, width * A.frame.narrowFraction, height * A.frame.narrowFraction);
  architecturalFrame(parts, group, 'display-frame', width, height, border, A.frame.depth, [0, (opening + base) / 2, -depth]);
  architecturalFrame(parts, group, 'display-gasket', width - border, height - border, A.frame.gasket,
    A.frame.gasketDepth, [0, (opening + base) / 2, -depth + D.glass], 'rubber');
  if (width >= A.frame.mullionMinimum * 2) parts.roundedBox(group, 'display-mullion', [border, height, A.frame.depth],
    [0, (opening + base) / 2, -depth + A.frame.depth / 2]);
}

export function shopDoorDetails(parts: ArchitectureParts, group: THREE.Object3D, width: number, height: number, depth: number): void {
  const glassWidth = width - D.frame * 2, glassHeight = height - D.frame;
  architecturalFrame(parts, group, 'door-gasket', glassWidth, glassHeight, A.frame.gasket, A.frame.gasketDepth,
    [0, height / 2, -depth + D.glass], 'rubber');
  const hingeHeight = Math.min(A.door.hingeHeight, height / 8);
  for (const [key, ratio] of [['lower', 0.2], ['upper', 0.8]] as const) parts.cylinder(group, `${key}-hinge`, A.door.hingeRadius,
    hingeHeight, [-width / 2, height * ratio, -depth + A.frame.depth]);
  parts.roundedBox(group, 'closer', [Math.min(A.door.closerWidth, width / 2), Math.min(A.door.closerHeight, height / 8), A.door.closerDepth],
    [0, height - D.frame, -depth + A.door.closerDepth]);
}
