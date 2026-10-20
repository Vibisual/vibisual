import { describe, expect, it } from 'vitest';
import { VIBI3D_MATERIAL_PRESETS, type Vibi3DMaterialPreset } from '@vibisual/shared';
import { generateMaterialMaps, materialPresetDefaults, materialPresetProperties, MATERIAL_MAP_SIZES } from './proceduralMaterialPixels.js';

const meanChannel = (data: Uint8Array, channel = 0): number => {
  let total = 0; for (let i = channel; i < data.length; i += 4) total += data[i]!;
  return total / (data.length / 4);
};
const redChannel = (data: Uint8Array): number[] => Array.from(data).filter((_, index) => index % 4 === 0);

describe('deterministic procedural material pixels', () => {
  it.each(VIBI3D_MATERIAL_PRESETS)('%s generates reproducible, varied diffuse and normal maps with bounded channels', (preset) => {
    const options = { size: 32, seed: 125, wear: 0.35 };
    const first = generateMaterialMaps(preset, options), second = generateMaterialMaps(preset, options);
    for (const [key, image] of Object.entries(first)) {
      expect(image.width).toBe(32); expect(image.height).toBe(32); expect(image.data.length).toBe(32 * 32 * 4);
      expect(image.data).toEqual(second[key as keyof typeof second].data);
      for (let index = 3; index < image.data.length; index += 4) expect(image.data[index]).toBe(255);
    }
    expect(first.map.data).not.toEqual(generateMaterialMaps(preset, { ...options, seed: 126 }).map.data);
    expect(new Set(redChannel(first.map.data)).size).toBeGreaterThan(1);
    expect(new Set(redChannel(first.normalMap.data)).size).toBeGreaterThan(1);
    for (const image of [first.roughnessMap, first.aoMap]) for (let index = 0; index < image.data.length; index += 4) {
      expect(image.data[index]).toBe(image.data[index + 1]); expect(image.data[index]).toBe(image.data[index + 2]);
    }
  });

  it.each(VIBI3D_MATERIAL_PRESETS)('%s adds visible dirt and ambient darkening as wear increases', (preset) => {
    const clean = generateMaterialMaps(preset, { size: 32, seed: 53, wear: 0 });
    const worn = generateMaterialMaps(preset, { size: 32, seed: 53, wear: 1 });
    expect(meanChannel(worn.map.data)).toBeLessThan(meanChannel(clean.map.data));
    expect(meanChannel(worn.aoMap.data)).toBeLessThan(meanChannel(clean.aoMap.data));
    expect(meanChannel(worn.roughnessMap.data)).toBeGreaterThanOrEqual(meanChannel(clean.roughnessMap.data));
    expect(worn.normalMap.data).not.toEqual(clean.normalMap.data);
  });

  it('keeps both awning stripe colors and changes the physical stripe width', () => {
    const options = { size: 64, seed: 9, params: { color: '#ff0000', secondaryColor: '#0000ff', stripeWidth: 0.2 } };
    const narrow = generateMaterialMaps('awning-fabric', options).map.data;
    let red = 0, blue = 0;
    for (let i = 0; i < narrow.length; i += 4) {
      if (narrow[i]! > narrow[i + 2]! * 5) red++;
      if (narrow[i + 2]! > narrow[i]! * 5) blue++;
    }
    expect(red).toBeGreaterThan(1000); expect(blue).toBeGreaterThan(1000);
    const wide = generateMaterialMaps('awning-fabric', { ...options, params: { ...options.params, stripeWidth: 0.6 } }).map.data;
    expect(wide).not.toEqual(narrow);
  });

  it('pavers retain two distinct block colors with recessed, darker joints', () => {
    const maps = generateMaterialMaps('pavers', { size: 512, params: { color: '#ffffff', secondaryColor: '#555555', accentColor: '#222222' } });
    const values = redChannel(maps.map.data);
    expect(values.some(value => value > 225)).toBe(true);
    expect(values.some(value => value > 65 && value < 100)).toBe(true);
    expect(values.some(value => value < 60)).toBe(true);
    expect(redChannel(maps.aoMap.data).reduce((minimum, value) => Math.min(minimum, value), 255)).toBeLessThan(230);
  });

  it('supports color, roughness, pattern scale, grout and normal-strength controls', () => {
    const base = generateMaterialMaps('brick', { size: 32, seed: 17 });
    for (const params of [{ color: '#1122ee' }, { secondaryColor: '#11ee22' }, { accentColor: '#ee1122' }, { scale: 1.5 }, { groutWidth: 0.04 }]) {
      expect(generateMaterialMaps('brick', { size: 32, seed: 17, params }).map.data).not.toEqual(base.map.data);
    }
    const smooth = generateMaterialMaps('brick', { size: 32, params: { roughness: 0, normalStrength: 0 } });
    const rough = generateMaterialMaps('brick', { size: 32, params: { roughness: 1 } });
    expect(meanChannel(smooth.roughnessMap.data)).toBeLessThan(60);
    expect(meanChannel(rough.roughnessMap.data)).toBeGreaterThan(230);
    for (let i = 0; i < smooth.normalMap.data.length; i += 4) expect(Array.from(smooth.normalMap.data.slice(i, i + 4))).toEqual([128, 128, 255, 255]);
  });

  it('encodes approximately unit-length tangent-space normals', () => {
    const data = generateMaterialMaps('corrugated-metal', { size: 64 }).normalMap.data;
    for (let i = 0; i < data.length; i += 4) {
      const xyz = [data[i]!, data[i + 1]!, data[i + 2]!].map(value => value / 127.5 - 1);
      // Three independently rounded 8-bit channels have at most sqrt(3) / 255 length error.
      expect(Math.abs(Math.sqrt(xyz.reduce((sum, value) => sum + value * value, 0)) - 1)).toBeLessThan(0.007);
    }
  });

  it.each(MATERIAL_MAP_SIZES)('supports bounded power-of-two resolution %i', (size) => {
    const result = generateMaterialMaps('painted-concrete', { size });
    for (const map of Object.values(result)) expect([map.width, map.height, map.data.byteLength]).toEqual([size, size, size * size * 4]);
  });
  it.each([0, 16, 31, 33, 100, 2048, NaN, Infinity])('rejects unsafe or unsupported map size %s before allocation', (size) => {
    expect(() => generateMaterialMaps('plastic', { size })).toThrow('material-map-size-invalid');
  });
  it.each([-1, 0.5, 4294967296, NaN, Infinity])('rejects invalid seeds %s', (seed) => {
    expect(() => generateMaterialMaps('plastic', { seed })).toThrow('material-source-invalid');
  });
  it('validates shared parameter bounds, colors and wear while accepting uint32 endpoints', () => {
    for (const wear of [-0.01, 1.01, NaN]) expect(() => generateMaterialMaps('plastic', { wear })).toThrow();
    for (const params of [{ color: 'red' }, { scale: 0 }, { normalStrength: 4 }, { stripeWidth: 0 }]) {
      expect(() => generateMaterialMaps('plastic', { params })).toThrow('material-source-invalid');
    }
    expect(() => generateMaterialMaps('missing' as Vibi3DMaterialPreset)).toThrow();
    expect(generateMaterialMaps('plastic', { seed: 0, size: 32 }).map.data)
      .not.toEqual(generateMaterialMaps('plastic', { seed: 4294967295, size: 32 }).map.data);
  });
  it('returns independent buffers and immutable-by-copy defaults with physically scaled tiles', () => {
    const first = generateMaterialMaps('glass', { size: 32 }), second = generateMaterialMaps('glass', { size: 32 });
    first.map.data.fill(0); expect(second.map.data.some(value => value !== 0)).toBe(true);
    const defaults = materialPresetDefaults('glass'); defaults.tileSize[0] = 99; defaults.physical!.ior = 2;
    expect(materialPresetDefaults('glass').tileSize).toEqual([2, 2]);
    expect(materialPresetDefaults('glass').physical!.ior).toBe(1.5);
    for (const preset of VIBI3D_MATERIAL_PRESETS) {
      const properties = materialPresetProperties(preset);
      expect(properties.color).toBe('#ffffff'); expect(properties.roughness).toBe(1);
      expect(properties.tileSize!.every(value => value > 0)).toBe(true);
    }
    expect(materialPresetProperties('emissive-acrylic').emissiveIntensity).toBeGreaterThan(0);
  });
});
