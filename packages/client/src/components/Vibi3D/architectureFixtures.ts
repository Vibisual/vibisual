import type * as THREE from 'three';
import type { Vibi3DVec3 } from '@vibisual/shared';
import { ArchitectureParts, ARCHITECTURE_DETAILS as D } from './architectureParts.js';
import { ARCHITECTURAL_DETAIL as A } from './architectureDetailConfig.js';
import { rectangleProfile } from './architectureFrames.js';

export function architecturalAirConditioner(parts: ArchitectureParts, parent: THREE.Object3D, x: number, y: number): void {
  const C = A.ac, group = parts.group(parent, 'air-conditioner', [x, y, 0.4]);
  parts.roundedBox(group, 'housing', [C.width, C.height, C.depth], [0, 0, 0], 'aluminium', undefined, C.radius);
  const fan = parts.group(group, 'fan', [C.fanX, 0, C.fanZ]);
  parts.mesh(fan, 'rim', { kind: 'torus', radius: C.fanRadius, tube: C.faceDepth / 2 }, [0, 0, 0], 'aluminium');
  const hub = parts.cylinder(fan, 'hub', C.hubRadius, C.faceDepth, [0, 0, 0], 'rubber'); hub.rotation.x = Math.PI / 2;
  const blade: Vibi3DVec3[] = [[-C.bladeWidth / 2, C.hubRadius / 2, 0], [C.bladeWidth / 2, C.hubRadius / 2, 0],
    [C.bladeWidth, C.fanRadius * 0.85, 0], [-C.bladeWidth / 2, C.fanRadius * 0.9, 0]];
  for (let angle = 0; angle < 360; angle += 360 / C.bladeCount) {
    const mesh = parts.mesh(fan, `blade-angle-${angle}`, { kind: 'extrude', points: blade, depth: C.faceDepth / 2,
      bevel: { enabled: true, size: C.faceDepth / 8, thickness: C.faceDepth / 8, segments: A.edge.segments } }, [0, 0, 0], 'plastic', { params: { color: A.colors.fan } });
    mesh.rotation.z = angle * Math.PI / 180;
  }
  const grillWidth = C.fanRadius * 2 + C.grillInset, grillHeight = C.height - C.grillInset * 2;
  const holes = Array.from({ length: C.slots }, (_, slot) => rectangleProfile(C.slotWidth, C.slotHeight)
    .map(([px, py, pz]): Vibi3DVec3 => [px - grillWidth / 2 + C.grillInset + slot * (grillWidth - C.grillInset * 2) / (C.slots - 1), py, pz]));
  parts.mesh(group, 'grille', { kind: 'extrude', points: rectangleProfile(grillWidth, grillHeight), holes, depth: C.faceDepth / 2 },
    [C.fanX, 0, C.fanZ + C.faceDepth], 'aluminium', { params: { color: A.colors.grille } });
  for (const side of [-1, 1]) {
    const bracket = parts.group(group, side < 0 ? 'left-bracket' : 'right-bracket', [side * C.bracketX, -C.height / 2, 0]);
    parts.box(bracket, 'shelf', [C.bracketWidth, C.bracketWidth, C.bracketReach], [0, 0, 0], 'aluminium');
    parts.box(bracket, 'wall-mount', [C.bracketWidth, C.bracketHeight, C.bracketWidth], [0, C.bracketHeight / 2, -C.bracketReach / 2], 'aluminium');
  }
  parts.pathMesh(group, 'drain', [[0.3, 0, 0], [0.45, -0.2, -0.2], [0.45, -0.9, -0.2]], D.pipe);
}
