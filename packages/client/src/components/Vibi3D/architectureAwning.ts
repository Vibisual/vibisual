import type * as THREE from 'three';
import type { Vibi3DVec3 } from '@vibisual/shared';
import { ArchitectureParts } from './architectureParts.js';
import { ARCHITECTURAL_DETAIL as A } from './architectureDetailConfig.js';

/** Closed curved cloth cross-section; thickness, seams and supporting arms are actual editable geometry. */
export function architecturalAwning(parts: ArchitectureParts, group: THREE.Group, width: number, out: number, drop: number, colors: [string, string]): void {
  const C = A.awning, settings = { params: { color: colors[0], secondaryColor: colors[1] } };
  const curve = Math.min(C.curve, out * C.curve), thickness = Math.min(C.thickness, out / 10);
  const roof = (t: number): number => -drop * t + curve * Math.sin(t * Math.PI);
  const top: Vibi3DVec3[] = Array.from({ length: C.curveSamples + 1 }, (_, index) => {
    const t = index / C.curveSamples; return [-out * t, roof(t), 0];
  });
  const underside = [...top].reverse().map(([z, y]): Vibi3DVec3 => [z, y - thickness, 0]);
  const canopy = parts.mesh(group, 'canopy', { kind: 'extrude', points: [...top, ...underside], depth: width, creaseAngle: 35 },
    [-width / 2, 0, 0], 'awning-fabric', settings); canopy.rotation.y = Math.PI / 2;
  // Extrusion Z becomes storefront X: stripe U must follow that width, including the same centre and metre scale as the valance.
  canopy.geometry.userData['vibi3dMetricUvProjection'] = { axes: [2, 0], offset: [-width / 2, 0] };
  const height = Math.max(C.valanceMin, drop), scallops = Math.max(1, Math.min(C.maxScallops, Math.ceil(width / C.scallopSpan)));
  const lower: Vibi3DVec3[] = [];
  for (let index = 0; index <= scallops * 2; index++) lower.push([width / 2 - width * index / (scallops * 2),
    -height - (index % 2 ? C.scallopDepth : 0), 0]);
  parts.mesh(group, 'valance', { kind: 'extrude', points: [[-width / 2, 0, 0], [width / 2, 0, 0], ...lower], depth: thickness },
    [0, -drop, out], 'awning-fabric', settings);
  const seams = Math.min(C.maxSeams, Math.max(1, Math.floor(width / C.seamSpacing)));
  for (let seam = 0; seam <= seams; seam++) {
    const x = -width / 2 + width * seam / seams;
    const seamMesh = parts.mesh(group, `seam-at-${x.toFixed(4)}`, { kind: 'extrude', points: [...top, ...underside], depth: C.seamRadius * 2 },
      [x - C.seamRadius, C.seamRadius, 0], 'awning-fabric', settings); seamMesh.rotation.y = Math.PI / 2;
    seamMesh.geometry.userData['vibi3dMetricUvProjection'] = { axes: [2, 0], offset: [x - C.seamRadius, 0] };
  }
  parts.pathMesh(group, 'front-rail', [[-width / 2, -drop - thickness, out], [width / 2, -drop - thickness, out]], C.railRadius);
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right', x = side * width * 0.45;
    parts.pathMesh(group, `${key}-arm`, [[x, -drop - C.bracketDrop, 0], [x, -drop - thickness, out]], C.armRadius);
    parts.roundedBox(group, `${key}-bracket`, [...C.bracketSize], [x, -drop - C.bracketDrop, 0]);
  }
}
