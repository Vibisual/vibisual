import { expect, it, vi } from 'vitest';
import { cachedMaterialTexture } from './modelProceduralTextures.js';
import { generateMaterialMaps } from './proceduralMaterialPixels.js';

vi.mock('./proceduralMaterialPixels.js', () => ({
  materialPresetProperties: () => ({ tileSize: [1, 1] }),
  generateMaterialMaps: vi.fn(() => Object.fromEntries(['map', 'normalMap', 'roughnessMap', 'aoMap'].map(slot =>
    [slot, { width: 512, height: 512, data: new Uint8Array(512 * 512 * 4) }]))),
}));

it('shares a live scene Source even after its bake leaves the bounded 64 MiB idle cache', () => {
  const first = cachedMaterialTexture(new Map(), 'map', { kind: 'procedural', preset: 'plastic', seed: 0 }, {});
  for (let seed = 1; seed <= 17; seed++) cachedMaterialTexture(new Map(), 'map', { kind: 'procedural', preset: 'plastic', seed }, {});
  const replay = cachedMaterialTexture(new Map(), 'map', { kind: 'procedural', preset: 'plastic', seed: 0 }, {});
  expect(replay.source).toBe(first.source); expect(generateMaterialMaps).toHaveBeenCalledTimes(18);
  replay.offset.x = 0.5; expect(first.offset.x).toBe(0);
});
