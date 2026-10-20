import { clamp01, mixMaterialRGB, unitHash, type MaterialRGB } from './proceduralMaterialNoise.js';

/** Own analytic room projection: immutable CPU color pixels, with no assets, shaders or runtime scene generation. */
export function sampleGlassInterior(seed: number, u: number, v: number, tint: MaterialRGB): MaterialRGB {
  const centerX = 0.46 + unitHash(seed, 0, 0, 80) * 0.08, centerY = 0.53;
  const halfWidth = 0.2, halfHeight = 0.25, left = centerX - halfWidth, right = centerX + halfWidth;
  const bottom = centerY - halfHeight, top = centerY + halfHeight;
  const dx = (u - centerX) / halfWidth, dy = (v - centerY) / halfHeight;
  const rear = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
  // UV +V is up. The four outer wedges meet at the rear wall's corners, giving one consistent vanishing point.
  const face = rear ? 'rear' : Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'floor' : 'ceiling';
  const warm = unitHash(seed, 1, 0, 81) * 13;
  const palette: Record<typeof face, MaterialRGB> = {
    rear: [65 + warm, 61 + warm, 54 + warm], left: [43 + warm, 42 + warm, 38 + warm],
    right: [54 + warm, 53 + warm, 48 + warm], ceiling: [86 + warm, 84 + warm, 76 + warm], floor: [35 + warm, 34 + warm, 31 + warm],
  };
  let color = palette[face];
  if (rear) {
    const edge = clamp01(Math.min(u - left, right - u, v - bottom, top - v) * 22);
    color = mixMaterialRGB([25, 27, 27], color, 0.55 + edge * 0.45);
    // Back-wall shelf rails, cabinet doors and a seeded wall panel stay visibly behind the glass.
    const shelfLeft = centerX + 0.025, shelfRight = right - 0.035;
    if (u > shelfLeft && u < shelfRight && v > bottom + 0.035 && v < top - 0.09) {
      const rail = Math.abs(((v - bottom) * 12) % 1 - 0.5) > 0.4;
      color = rail || u < shelfLeft + 0.014 || u > shelfRight - 0.014 ? [13, 17, 19] : [28 + warm, 31 + warm, 32 + warm];
    }
    if (u > left + 0.035 && u < centerX - 0.025 && v > centerY + 0.04 && v < top - 0.035) color = [32, 40, 43];
  }
  if (face === 'floor') {
    const depth = (centerY - v) / halfHeight;
    const row = Math.abs((1 / depth * 8) % 1 - 0.5), column = Math.abs(((u - centerX) / depth * 16) % 1);
    if (row > 0.46 || column < 0.035) color = mixMaterialRGB(color, [12, 16, 18], 0.4);
  }
  // A low counter and two legs silhouette cross the floor/rear join; the offset changes only with the seed.
  const deskX = left + 0.015 + unitHash(seed, 2, 0, 82) * 0.025, deskWidth = 0.18;
  if (u > deskX && u < deskX + deskWidth && v > bottom - 0.018 && v < bottom + 0.055) color = [15, 20, 22];
  if (v > bottom - 0.12 && v < bottom && ((u > deskX + 0.015 && u < deskX + 0.03)
    || (u > deskX + deskWidth - 0.03 && u < deskX + deskWidth - 0.015))) color = [12, 17, 19];
  return mixMaterialRGB(color, tint, 0.08);
}
