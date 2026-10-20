import type { Vibi3DMaterialParams, Vibi3DMaterialPreset } from '@vibisual/shared';
import type { ProceduralMaterialDefaults } from './proceduralMaterialDefaults.js';
import { clamp01, fract, mixMaterialRGB, unitHash, type MaterialRGB, type materialNoiseSampler } from './proceduralMaterialNoise.js';
import { sampleGlassInterior } from './proceduralGlassInterior.js';
import { refineMaterialSurface } from './proceduralSurfaceDetails.js';
import { interlockingJointDistance, masonryJointMasks } from './proceduralMasonry.js';

export interface MaterialPatternContext {
  preset: Vibi3DMaterialPreset; seed: number; params: Vibi3DMaterialParams; defaults: ProceduralMaterialDefaults;
  primary: MaterialRGB; secondary: MaterialRGB; accent: MaterialRGB;
  tileSize: readonly [number, number]; resolution: number;
  noise: ReturnType<typeof materialNoiseSampler>;
}
export interface MaterialPatternSample { color: MaterialRGB; height: number; cavity: number; edge: number; roughness: number }

/** Analytic shapes plus seeded periodic noise; no images, fonts or device-dependent canvas rasterization. */
export function sampleMaterialPattern(context: MaterialPatternContext, u: number, v: number): MaterialPatternSample {
  const { preset, seed, params, defaults, primary, secondary, accent } = context;
  const scale = params.scale ?? 1, contrast = params.contrast ?? 0.55;
  const repeats = (count: number) => Math.max(1, Math.min(Math.floor(context.resolution / 3), Math.round(count * scale)));
  const noise = (columns: number, rows = columns, salt = 0) => context.noise(u, v, repeats(columns), repeats(rows), salt);
  const grain = noise(128, 128, 1), cloud = noise(7, 7, 2), broad = noise(3, 3, 3);
  let color = mixMaterialRGB(primary, secondary, clamp01((grain * 0.14 + cloud * 0.14) * contrast));
  let height = 0.5 + (grain - 0.5) * 0.065;
  let cavity = 0, edge = 0, roughness = (grain - 0.5) * 0.08;
  const masonry = (columns: number, rows: number, stagger: boolean, interlock = false) => {
    const rowCount = stagger ? Math.max(2, Math.round(repeats(rows) / 2) * 2) : repeats(rows), columnCount = repeats(columns);
    const row = Math.floor(v * rowCount), fy = fract(v * rowCount);
    const offset = interlock && fy > 0.25 && fy < 0.75 ? 0.13 : 0;
    const shifted = u * columnCount + (stagger ? (row % 2) * 0.5 : 0) + offset;
    const column = Math.floor(shifted), fx = fract(shifted);
    const dx = Math.min(fx, 1 - fx) * context.tileSize[0] / columnCount;
    const dy = Math.min(fy, 1 - fy) * context.tileSize[1] / rowCount;
    const grout = params.groutWidth ?? (preset === 'pavers' ? 0.003 : preset === 'wall-tile' ? 0.008 : 0.012);
    const distance = interlock ? interlockingJointDistance(fract(shifted - offset), fy,
      context.tileSize[0] / columnCount, context.tileSize[1] / rowCount) : Math.min(dx, dy);
    const texel = (interlock ? Math.max(...context.tileSize) : context.tileSize[dx < dy ? 0 : 1]) / context.resolution;
    const masks = masonryJointMasks(distance, grout, preset === 'pavers' ? 0.003 : preset === 'wall-tile' ? 0.0008 : 0.0015, texel);
    cavity = masks.bevel;
    edge = clamp01(1 - distance / (grout * 3));
    const variation = unitHash(seed, (column + columnCount) % columnCount, row, 10);
    const mixColor = preset === 'pavers' ? (column + row) % 2 === 0 ? 0 : 1 : variation * contrast;
    color = mixMaterialRGB(mixMaterialRGB(primary, secondary, mixColor), accent, masks.grout);
    height = 0.62 - cavity * (preset === 'pavers' ? 0.14 : 0.36) + (grain - 0.5) * (preset === 'wall-tile' ? 0.025 : preset === 'pavers' ? 0.03 : 0.065);
    roughness += cavity * 0.16 + (variation - 0.5) * 0.1;
  };
  switch (preset) {
    case 'wall-tile': masonry(4, 4, false); break;
    case 'brick': masonry(4, 6, true); break;
    case 'pavers': masonry(6, 6, true, true); break;
    case 'painted-concrete': {
      const pores = clamp01((0.38 - grain) * 4);
      cavity = pores * 0.22; height += (cloud - 0.5) * 0.12 - pores * 0.035;
      color = mixMaterialRGB(color, secondary, (broad * 0.22 + pores * 0.16) * contrast);
      break;
    }
    case 'granite': {
      const chips = unitHash(seed, Math.floor(u * repeats(128)), Math.floor(v * repeats(128)), 14);
      color = mixMaterialRGB(primary, chips > 0.6 ? accent : secondary, Math.abs(chips - 0.5) * 1.7 * contrast);
      height += (chips - 0.5) * 0.12; cavity = clamp01(0.25 - chips) * 0.4;
      break;
    }
    case 'asphalt': {
      const aggregate = unitHash(seed, Math.floor(u * repeats(192)), Math.floor(v * repeats(192)), 15);
      const stone = clamp01((aggregate - 0.6) * 2.5);
      color = mixMaterialRGB(primary, secondary, stone * contrast);
      height += stone * 0.18 + (cloud - 0.5) * 0.05; cavity = (1 - stone) * 0.24;
      break;
    }
    case 'kerb': {
      const seam = Math.min(u, 1 - u) * context.tileSize[0];
      cavity = clamp01(1 - seam / (params.groutWidth ?? 0.008));
      edge = clamp01(1 - Math.min(v, 1 - v) * 16);
      height += (cloud - 0.5) * 0.08 - cavity * 0.2 - edge * 0.06;
      color = mixMaterialRGB(color, accent, cavity * 0.65);
      break;
    }
    case 'wood-planks': {
      const plank = fract(u * repeats(6));
      const fibers = context.noise(u + noise(4, 2, 20) * 0.04, v, repeats(96), repeats(3), 21);
      cavity = clamp01(1 - Math.min(plank, 1 - plank) / 0.035);
      edge = clamp01(1 - Math.min(plank, 1 - plank) / 0.1);
      color = mixMaterialRGB(mixMaterialRGB(primary, secondary, fibers * contrast), accent, cavity);
      height += (fibers - 0.5) * 0.15 - cavity * 0.25;
      break;
    }
    case 'corrugated-metal': {
      const wave = Math.abs(fract(u * repeats(10)) * 2 - 1);
      const ridge = wave * wave * (3 - 2 * wave);
      height = 0.25 + ridge * 0.5 + (grain - 0.5) * 0.02;
      cavity = (1 - ridge) * 0.28; edge = cavity;
      color = mixMaterialRGB(primary, secondary, (1 - ridge) * 0.18 * contrast + broad * 0.12);
      break;
    }
    case 'aluminium': {
      const brush = noise(256, 4, 25);
      height += (brush - 0.5) * 0.1;
      color = mixMaterialRGB(primary, secondary, brush * contrast * 0.3); roughness += (brush - 0.5) * 0.1;
      break;
    }
    case 'glass':
      height = 0.5 + (grain - 0.5) * 0.07; roughness *= 0.1;
      if (params.fakeInterior === true) color = sampleGlassInterior(seed, u, v, primary);
      break;
    case 'awning-fabric': {
      const stripeWidth = params.stripeWidth ?? 0.2;
      const stripes = Math.max(2, Math.round(context.tileSize[0] / stripeWidth / 2 * scale) * 2);
      const stripe = Math.floor(u * stripes) % 2;
      const weave = (Math.floor(u * repeats(192)) + Math.floor(v * repeats(192))) % 2;
      color = mixMaterialRGB(stripe === 0 ? primary : secondary, accent, weave * 0.025);
      height += (weave - 0.5) * 0.035 + (noise(3, 12, 26) - 0.5) * 0.04;
      break;
    }
    case 'emissive-acrylic': height += (cloud - 0.5) * 0.025; roughness *= 0.4; break;
    case 'plastic': height += (cloud - 0.5) * 0.035; roughness *= 0.5; break;
    case 'rubber': cavity = clamp01(0.35 - grain) * 0.2; height += (cloud - 0.5) * 0.04; break;
    case 'rust': {
      const oxide = clamp01((cloud - 0.35) * 2.2);
      color = mixMaterialRGB(mixMaterialRGB(secondary, primary, oxide), accent, broad * contrast * oxide);
      height += oxide * 0.26 + (grain - 0.5) * 0.1; cavity = (1 - oxide) * 0.3;
      roughness += oxide * 0.06;
      break;
    }
  }
  return refineMaterialSurface(context, u, v, { color, height, cavity, edge, roughness });
}
