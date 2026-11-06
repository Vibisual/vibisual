import type { SurfaceWearInput } from '@vibisual/compute';
import { materialNoise, clamp01 } from './proceduralMaterialNoise.js';

function sample(data: Uint8Array, width: number, height: number, u: number, v: number, channel: number): number {
  const x = ((u % 1 + 1) % 1) * width - 0.5, y = ((v % 1 + 1) % 1) * height - 0.5;
  const left = Math.floor(x), bottom = Math.floor(y), tx = x - left, ty = y - bottom;
  const at = (a: number, b: number): number => data[(((b + height) % height) * width + (a + width) % width) * 4 + channel]!;
  return (at(left, bottom) * (1 - tx) + at(left + 1, bottom) * tx) * (1 - ty)
    + (at(left, bottom + 1) * (1 - tx) + at(left + 1, bottom + 1) * tx) * ty;
}

/** Frozen reference for the architectural wall atlas; never imported by production rendering. */
export function surfaceWearReference(input: SurfaceWearInput): [Uint8Array, Uint8Array] {
  const { bases, baseWidth, baseHeight, pixelsX, pixelsY, width, height, tile, angle, offset, wear, seed, openings, scale } = input;
  const masks = new Float32Array(pixelsX * pixelsY);
  for (let y = 0; y < pixelsY; y++) for (let x = 0; x < pixelsX; x++) {
    const px = (x + 0.5) / pixelsX * width, py = (y + 0.5) / pixelsY * height;
    const irregular = 0.45 + materialNoise(seed, px / width, py / height, 23, 4, 401) * 0.55;
    let dirt = clamp01(1 - py / 0.38) * 0.42;
    dirt += clamp01(1 - Math.min(px, width - px, height - py) / 0.06) * 0.12;
    for (const opening of openings) {
      const bottom = opening.y * scale[1], left = opening.x * scale[0], right = (opening.x + opening.w) * scale[0];
      const below = bottom - py;
      if (below < 0 || below > 1.2) continue;
      const corner = Math.min(Math.abs(px - left), Math.abs(px - right));
      const drip = Math.exp(-((corner / 0.065) ** 2)) * 0.9;
      const wash = px >= left && px <= right ? 0.12 : 0;
      dirt += (drip + wash) * (1 - below / 1.2) * irregular;
    }
    masks[y * pixelsX + x] = clamp01(dirt * wear);
  }
  const result: [Uint8Array, Uint8Array] = [new Uint8Array(pixelsX * pixelsY * 4), new Uint8Array(pixelsX * pixelsY * 4)];
  for (let slot = 0; slot < 2; slot++) {
    const data = result[slot]!;
    for (let y = 0; y < pixelsY; y++) for (let x = 0; x < pixelsX; x++) {
      const u = ((x + 0.5) / pixelsX * width - width / 2) / tile[0], v = (y + 0.5) / pixelsY * height / tile[1];
      const tu = Math.cos(angle) * u + Math.sin(angle) * v + offset[0], tv = -Math.sin(angle) * u + Math.cos(angle) * v + offset[1];
      const index = y * pixelsX + x, shade = 1 - masks[index]! * (slot === 0 ? 0.5 : 0.28);
      for (let channel = 0; channel < 3; channel++) data[index * 4 + channel] = Math.round(sample(bases[slot]!, baseWidth, baseHeight, tu, tv, channel) * shade);
      data[index * 4 + 3] = 255;
    }
  }
  return result;
}
