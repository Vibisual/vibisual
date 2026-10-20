import type * as THREE from 'three';
import type { Vibi3DVec3 } from '@vibisual/shared';
import { ArchitectureParts } from './architectureParts.js';
import { ARCHITECTURAL_DETAIL as A } from './architectureDetailConfig.js';
import { rectangleProfile } from './architectureFrames.js';

/** Real joints and bevelled kerbstones: identities are anchored to metre coordinates, not child indexes. */
export function architecturalKerb(parts: ArchitectureParts, side: THREE.Object3D, length: number, height: number, road: number, direction: number): void {
  const C = A.kerb, group = parts.group(side, 'kerb'), z = direction * (road / 2 + C.width / 2);
  const span = Math.max(C.segmentLength, length / C.maxSegments), half = length / 2;
  parts.box(group, 'joint-backing', [length, height * 0.75, C.width * 0.8], [0, height * 0.375, z], 'kerb', { params: { color: A.colors.joint } });
  for (let coordinate = Math.floor(-half / span); coordinate < Math.ceil(half / span); coordinate++) {
    const start = Math.max(-half, coordinate * span), end = Math.min(half, (coordinate + 1) * span), width = end - start;
    if (width <= C.joint) continue;
    parts.roundedBox(group, `stone-at-${(coordinate * span).toFixed(4)}`, [width - C.joint, height, C.width],
      [(start + end) / 2, height / 2, z], 'kerb', undefined, C.bevel);
  }
  // A perforated cover is one mesh; repeating tiny bars would needlessly multiply draw calls.
  for (let x = -Math.floor(half / C.drainEvery) * C.drainEvery; x < half; x += C.drainEvery) {
    const drain = parts.group(side, `drain-at-${x}`, [x, 0, direction * (road / 2 - C.drainDepth / 2)]);
    parts.box(drain, 'recess', [C.drainWidth, C.joint, C.drainDepth], [0, -C.joint * 1.5, 0], 'rubber');
    const holes = Array.from({ length: 6 }, (_, slot) => rectangleProfile(C.joint, C.drainDepth * 0.7)
      .map(([px, py, pz]): Vibi3DVec3 => [px + (slot - 2.5) * C.drainWidth / 7, py, pz]));
    const cover = parts.mesh(drain, 'grate', { kind: 'extrude', points: rectangleProfile(C.drainWidth, C.drainDepth), holes, depth: C.joint }, [0, -C.joint, 0], 'rust');
    cover.rotation.x = -Math.PI / 2;
  }
}
