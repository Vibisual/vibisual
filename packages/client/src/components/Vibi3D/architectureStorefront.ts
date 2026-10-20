import * as THREE from 'three';
import type { Vibi3DArchitectureRecipe } from '@vibisual/shared';
import { ArchitectureParts, ARCHITECTURE_DETAILS as D } from './architectureParts.js';
import { architecturalAwning } from './architectureAwning.js';
import { shopDoorDetails, shopWindowFrame, woodPanels } from './architectureShopDetails.js';
type Storefront = Extract<Vibi3DArchitectureRecipe, { kind: 'storefront' }>;

function door(parts: ArchitectureParts, parent: THREE.Object3D, width: number, height: number, x: number, depth: number): void {
  const group = parts.group(parent, 'entrance', [x, 0, 0]);
  parts.box(group, 'glass-door', [width - D.frame * 2, height - D.frame, D.glass], [0, height / 2, -depth], 'glass');
  for (const side of [-1, 1]) parts.box(group, side < 0 ? 'left-jamb' : 'right-jamb', [D.frame, height, depth + D.frame], [side * width / 2, height / 2, -depth / 2], 'aluminium');
  parts.box(group, 'lintel', [width, D.frame, depth + D.frame], [0, height, -depth / 2], 'aluminium');
  parts.pathMesh(group, 'handle', [[width * 0.3, 0.9, 0.02], [width * 0.3, 1.15, 0.08], [width * 0.3, 1.4, 0.02]], D.pipe / 2);
  if (parts.detailed) shopDoorDetails(parts, group, width, height, depth);
}

export function buildStorefront(parts: ArchitectureParts, recipe: Storefront): void {
  const width = recipe.width ?? D.storefront.width, height = recipe.height ?? D.storefront.height, depth = recipe.depth ?? D.storefront.depth;
  const band = recipe.signBandHeight ?? D.storefront.signBand, opening = height - band, style = recipe.style ?? 'glass';
  const wall = parts.group(parts.root, 'shop');
  if (band > 0) parts.box(wall, 'sign-band', [width, band, depth], [0, height - band / 2, -depth / 2], 'emissive-acrylic', { emissiveIntensity: 0.15 });
  for (const side of [-1, 1]) parts.box(wall, side < 0 ? 'left-column' : 'right-column', [D.wall, opening, depth], [side * (width - D.wall) / 2, opening / 2, -depth / 2], style === 'wood' ? 'wood-planks' : 'painted-concrete');
  parts.box(wall, 'threshold', [width, D.sill, depth + D.sill], [0, D.sill / 2, -depth / 2], 'granite');
  if (style === 'shutter') {
    parts.box(wall, 'roller-shutter', [width - D.wall * 2, opening - D.sill, D.frame], [0, (opening + D.sill) / 2, -depth], 'corrugated-metal', { rotation: 90 });
    parts.box(wall, 'shutter-box', [width, 0.3, depth + 0.1], [0, opening - 0.15, -depth / 2], 'aluminium');
  } else {
    const doorWidth = Math.min(D.storefront.doorWidth, width * 0.3), location = recipe.door ?? 'right';
    const doorX = location === 'left' ? -width / 2 + D.wall + doorWidth / 2 : location === 'right' ? width / 2 - D.wall - doorWidth / 2 : 0;
    const segments = location === 'none' ? [[-width / 2 + D.wall, width / 2 - D.wall]]
      : [[-width / 2 + D.wall, doorX - doorWidth / 2], [doorX + doorWidth / 2, width / 2 - D.wall]];
    segments.forEach(([left, right], side) => {
      const span = right! - left!; if (span <= D.frame) return;
      const center = (left! + right!) / 2, base = style === 'wood' ? opening * 0.28 : D.sill;
      const group = parts.group(wall, side === 0 ? 'left-display' : 'right-display', [center, 0, 0]);
      if (style === 'wood') {
        if (parts.detailed) woodPanels(parts, group, span, base, depth);
        else parts.box(group, 'wood-cladding', [span, base, depth], [0, base / 2, -depth / 2], 'wood-planks');
      }
      parts.box(group, 'glass', [span, opening - base - D.frame, D.glass], [0, (opening + base) / 2, -depth], 'glass', { wear: 0.15 });
      parts.box(group, 'sill', [span, D.frame, depth], [0, base, -depth / 2], 'aluminium');
      parts.box(group, 'interior-back', [span, opening, D.wall], [0, opening / 2, -depth - 1], 'painted-concrete', { params: { color: D.colors.interior } });
      if (parts.detailed) shopWindowFrame(parts, group, span, opening, base, depth);
    });
    if (location !== 'none') door(parts, wall, doorWidth, opening - D.frame, doorX, depth);
  }
  if (recipe.awning !== false) {
    const awning = typeof recipe.awning === 'object' ? recipe.awning : {};
    const out = awning.depth ?? D.storefront.awningDepth, drop = awning.drop ?? D.storefront.awningDrop, elevation = awning.height ?? Math.min(D.storefront.awningHeight, opening);
    const colors = awning.colors ?? D.storefront.colors;
    const group = parts.group(wall, 'awning', [0, elevation, 0]);
    const settings = { params: { color: colors[0], secondaryColor: colors[1] } };
    if (parts.detailed) architecturalAwning(parts, group, width, out, drop, colors);
    else {
    const top = parts.box(group, 'canopy', [width, D.glass, Math.hypot(out, drop)], [0, -drop / 2, out / 2], 'awning-fabric', settings); top.rotation.x = Math.atan2(drop, out);
    parts.box(group, 'valance', [width, Math.max(D.frame, drop), D.glass], [0, -drop * 1.5, out], 'awning-fabric', settings);
    for (const side of [-1, 1]) parts.pathMesh(group, side < 0 ? 'left-arm' : 'right-arm', [[side * width * 0.45, -drop - 0.4, 0], [side * width * 0.45, -drop, out]], D.pipe / 2);
    }
  }
  if (recipe.projectingSign !== false) {
    const group = parts.group(wall, 'projecting-sign', [width / 2 - D.wall, height - band, 0.6]);
    parts.box(group, 'panel', [0.12, 1.2, 0.75], [0, 0, 0], 'emissive-acrylic', { emissiveIntensity: 0.2, side: 'double' });
    parts.box(group, 'bracket', [D.frame, D.frame, 0.6], [0, 0.4, -0.6], 'aluminium');
  }
}
