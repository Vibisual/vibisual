import type { MaterialPatternContext, MaterialPatternSample } from './proceduralMaterialPatterns.js';
import { clamp01, fract, mixMaterialRGB, unitHash } from './proceduralMaterialNoise.js';

/** Authored analytic surface details; no downloaded textures or platform-dependent rasterizers. */
export function refineMaterialSurface(context: MaterialPatternContext, u: number, v: number, sample: MaterialPatternSample): MaterialPatternSample {
  const { preset, seed, primary, secondary, accent, params, resolution } = context;
  if (!['painted-concrete', 'wood-planks', 'aluminium', 'corrugated-metal', 'wall-tile', 'brick', 'pavers', 'asphalt'].includes(preset)) return sample;
  const contrast = params.contrast ?? 0.55, limit = Math.max(4, Math.floor(resolution / 3));
  const fbm = (x: number, y = x, salt = 60, atU = u): number => {
    let sum = 0, total = 0, amplitude = 1;
    for (let octave = 0; octave < 4; octave++) {
      sum += context.noise(atU, v, Math.min(limit, x * 2 ** octave), Math.min(limit, y * 2 ** octave), salt + octave) * amplitude;
      total += amplitude; amplitude *= 0.48;
    }
    return sum / total;
  };
  if (preset === 'painted-concrete') {
    const macro = fbm(3, 3, 61), meso = fbm(15, 15, 66), micro = fbm(52, 52, 71);
    const pore = clamp01((0.3 - micro) * 6), trowel = fbm(9, 3, 76);
    sample.color = mixMaterialRGB(primary, secondary, clamp01((macro * 0.2 + meso * 0.12 + pore * 0.14) * contrast));
    sample.height = 0.5 + (trowel - 0.5) * 0.17 + (micro - 0.5) * 0.045 - pore * 0.045;
    sample.cavity = pore * 0.24; sample.roughness = (meso - 0.5) * 0.11 + pore * 0.06;
  } else if (preset === 'wood-planks') {
    const count = Math.max(1, Math.round(6 * (params.scale ?? 1))), plank = Math.floor(u * count), across = fract(u * count);
    const knotX = 0.2 + unitHash(seed, plank, 0, 81) * 0.6, knotY = 0.15 + unitHash(seed, plank, 0, 82) * 0.7;
    const dx = across - knotX, dy = (v - knotY) * 4;
    const knot = Math.exp(-(dx * dx * 17 + dy * dy * 7));
    const warp = fbm(4, 2, 83) * 0.018 + knot * Math.sin(dy * 4) * 0.022;
    const grain = fbm(48, 2, 87, u + warp);
    const rings = Math.sin((u + warp) * Math.min(limit, 110) * Math.PI * 2) * 0.5 + 0.5;
    const plankTint = unitHash(seed, plank, 0, 91) * 0.2;
    sample.color = mixMaterialRGB(primary, secondary, clamp01((grain * 0.62 + rings * 0.18 + knot * 0.35 + plankTint) * contrast));
    sample.color = mixMaterialRGB(sample.color, accent, sample.cavity * 0.75);
    sample.height = 0.5 + (grain - 0.5) * 0.09 + (rings - 0.5) * 0.012 - sample.cavity * 0.3 - knot * 0.025;
    sample.roughness = (grain - 0.5) * 0.12 + knot * 0.04 + sample.cavity * 0.12;
  } else if (preset === 'aluminium' || preset === 'corrugated-metal') {
    const macro = fbm(3, 3, 61);
    const brush = fbm(Math.min(limit, 100), 3, 93);
    const scuff = clamp01((fbm(24, 2, 97) - 0.62) * 3);
    sample.color = mixMaterialRGB(primary, secondary, (macro * 0.08 + brush * 0.13 + scuff * 0.2) * contrast);
    sample.height += (brush - 0.5) * 0.012 - scuff * 0.015;
    sample.roughness += (brush - 0.5) * 0.055 + scuff * 0.12;
  } else if (preset === 'wall-tile' || preset === 'brick' || preset === 'pavers') {
    const meso = fbm(15, 15, 66), micro = fbm(52, 52, 71);
    sample.color = mixMaterialRGB(sample.color, secondary, meso * contrast * (preset === 'wall-tile' ? 0.035 : 0.09));
    sample.height += (micro - 0.5) * (preset === 'wall-tile' ? 0.006 : 0.028);
    sample.roughness += (meso - 0.5) * (preset === 'wall-tile' ? 0.025 : 0.07);
  } else if (preset === 'asphalt') {
    const aggregate = fbm(42, 42, 101), fine = fbm(100, 100, 106), stone = clamp01((fine - 0.58) * 2.5);
    sample.color = mixMaterialRGB(primary, secondary, (aggregate * 0.13 + stone * 0.32) * contrast);
    sample.height = 0.5 + (aggregate - 0.5) * 0.05 + stone * 0.08;
    sample.cavity = (1 - aggregate) * 0.12; sample.roughness = (aggregate - 0.5) * 0.045;
  }
  return sample;
}
