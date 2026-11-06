import { describe, expect, it } from 'vitest';
import { VIBI3D_MATERIAL_PRESETS } from '@vibisual/shared';
import { generateMaterialMaps } from './proceduralMaterialPixels.js';
import { generateMaterialMaps as reference } from './proceduralMaterialPixels.reference.js';

describe('compiled material kernel', () => {
  for (const preset of VIBI3D_MATERIAL_PRESETS) it(`preserves ${preset} RGBA bytes`, () => {
    for (const options of [{ size: 32 }, { size: 64, seed: 0xffffffff, wear: 0.7, tileSize: [0.13, 7.25] as const,
      params: { scale: 2.3, contrast: 0.81, color: '#01fe17', secondaryColor: '#fc0580', accentColor: '#357abc', fakeInterior: true } },
    { size: 32, seed: 0x80000000, wear: 1, tileSize: [0.001, 10000] as const,
      params: { scale: 20, contrast: 1, normalStrength: 3, roughness: 0, groutWidth: 0.001, stripeWidth: 0.01 } },
    { size: 32, seed: 1, wear: 0, params: { scale: 0.05, contrast: 0, normalStrength: 0, roughness: 1, groutWidth: 0.2, stripeWidth: 2 } }]) {
      const expected = reference(preset, options), actual = generateMaterialMaps(preset, options);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap'] as const) expect(actual[key].data).toEqual(expected[key].data);
    }
  });
  it('preserves large wood trigonometry and paver joints', () => {
    for (const preset of ['wood-planks', 'pavers'] as const) {
      const options = { size: 512, seed: 412, wear: 0.38 };
      const expected = reference(preset, options), actual = generateMaterialMaps(preset, options);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap'] as const) expect(Buffer.from(actual[key].data).equals(Buffer.from(expected[key].data))).toBe(true);
    }
  });
});
