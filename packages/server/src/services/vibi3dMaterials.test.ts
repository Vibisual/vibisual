import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { VIBI3D_MATERIAL_MAP_SLOTS, VIBI3D_MATERIAL_PRESETS, validateVibi3DMaterial, validateVibi3DMaterialParams,
  validateVibi3DMaterialMapSource, validateVibi3DCommand, validateVibi3DSnapshot } from '@vibisual/shared';
import { resolveBinary } from './binLocator.js';
import { VIBI3D_SOURCE_MATERIAL_PY } from './vibi3dAuthoringMaterial.js';

const ref = `vibi-blob:${'a'.repeat(64)}.png`;
const python = [resolveBinary('python'), resolveBinary('python3')].find(candidate => candidate
  && spawnSync(candidate, ['-c', 'import sys; print(sys.version_info.major)'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout?.trim() === '3');

describe('bounded native material commands', () => {
  it('keeps legacy materials and normalizes the shorthand without accepting mixed authority', () => {
    expect(validateVibi3DCommand({ type: 'material', id: 'wall', material: { color: '#AaBbCc', roughness: 0.8 } }))
      .toEqual({ type: 'material', id: 'wall', material: { color: '#aabbcc', roughness: 0.8 } });
    expect(validateVibi3DCommand({ type: 'material', id: 'wall', preset: 'brick', seed: 3, wear: 0.4 }))
      .toEqual({ type: 'material', id: 'wall', material: { preset: 'brick', seed: 3, wear: 0.4 } });
    expect(validateVibi3DCommand({ type: 'material', id: 'wall', material: { color: '#ffffff' }, preset: 'brick' })).toBeNull();
    expect(validateVibi3DCommand({ type: 'create', name: 'Wall', recipe: { kind: 'box' }, material: { emissive: '#AAbb00', physical: { clearcoat: 0.4 } } }))
      .toMatchObject({ material: { emissive: '#aabb00', physical: { clearcoat: 0.4 } } });
  });

  it('accepts all 16 deterministic recipe names and all seven bounded source slots', () => {
    expect(VIBI3D_MATERIAL_PRESETS).toHaveLength(16);
    for (const preset of VIBI3D_MATERIAL_PRESETS) {
      const source = { kind: 'procedural', preset, seed: 0xffffffff, wear: 1, params: { color: '#AA9933', normalStrength: 2 } };
      expect(validateVibi3DMaterialMapSource(source)).toEqual({ ...source, params: { color: '#aa9933', normalStrength: 2 } });
      const input = { preset, maps: Object.fromEntries(VIBI3D_MATERIAL_MAP_SLOTS.map(slot => [slot, { source }])) };
      expect(Object.keys(validateVibi3DMaterial(input)!.maps!)).toEqual([...VIBI3D_MATERIAL_MAP_SLOTS]);
    }
    expect(validateVibi3DMaterialMapSource({ kind: 'blob', ref })).toEqual({ kind: 'blob', ref });
    expect(validateVibi3DMaterialMapSource({ kind: 'vibimage', docId: 'sign-sheet' })).toEqual({ kind: 'vibimage', docId: 'sign-sheet' });
  });

  it('bounds physical/UV/effect parameters and returns independent canonical copies', () => {
    const input = { color: '#FFFFFF', emissive: '#AA1100', emissiveIntensity: 2, tileSize: [0.5, 2], offset: [0.1, -0.2], rotation: 90,
      alphaTest: 0.1, transparent: true, side: 'double', physical: { transmission: 0.9, ior: 1.5, thickness: 0.01, clearcoat: 1 },
      envMapIntensity: 1.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      maps: { map: { source: { kind: 'blob', ref } } } };
    const result = validateVibi3DMaterial(input)!;
    expect(result).toMatchObject({ color: '#ffffff', emissive: '#aa1100' });
    result.tileSize![0] = 9; result.physical!.ior = 2; result.maps!.map!.source = { kind: 'vibimage', docId: 'other' };
    expect(input.tileSize).toEqual([0.5, 2]); expect(input.physical.ior).toBe(1.5);
    expect(input.maps.map.source).toEqual({ kind: 'blob', ref });
    expect(validateVibi3DMaterialParams({})).toEqual({});
  });

  it('rejects URL/executable sources, invalid doc/blob identities, unknown fields and unbounded values', () => {
    for (const source of [{ kind: 'url', url: 'https://example.com/a.png' }, { kind: 'blob', ref: 'data:image/png;base64,AA==' },
      { kind: 'blob', ref: ref.replace('.png', '.f32') }, { kind: 'vibimage', docId: '../private' }, { kind: 'vibimage', docId: 'con' },
      { kind: 'procedural', preset: 'brick', seed: -1 }, { kind: 'procedural', preset: 'brick', seed: 1.5 },
      { kind: 'procedural', preset: 'brick', seed: 0x100000000 }, { kind: 'procedural', preset: 'brick', params: { code: 'eval()' } }]) {
      expect(validateVibi3DMaterialMapSource(source)).toBeNull();
    }
    for (const material of [{}, { preset: 'external' }, { maps: {} }, { maps: { envMap: { source: { kind: 'blob', ref } } } },
      { normalMap: ref }, { physical: { ior: 0.5 } }, { physical: { clearcoat: 2 } }, { physical: { thickness: Infinity } },
      { tileSize: [0, 1] }, { offset: [NaN, 1] }, { rotation: 361 }, { transparent: 1 }, { side: {} },
      { emissiveIntensity: 101 }, { params: { contrast: 2 } }, { params: { color: () => 'red' } }, { shader: 'code' }]) {
      expect(validateVibi3DMaterial(material)).toBeNull();
    }
  });

  it('publishes material recipes in snapshots without copying binary textures', () => {
    const material = { preset: 'wall-tile', maps: { normalMap: { source: { kind: 'blob', ref } } } };
    const parsed = validateVibi3DSnapshot({ sessionId: 'materials', projectId: 'fixture', fileName: 'building', revision: 1, selectedId: null,
      nodes: [{ id: 'wall', name: 'Wall', type: 'Mesh', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], material }] });
    expect(parsed!.nodes[0]!.material).toEqual(material);
    expect(JSON.stringify(parsed)).not.toContain('data:image');
  });
});

describe('precise native material export limits', () => {
  it.skipIf(!python)('permits legacy constants/maps and inactive physical defaults, reports exactly unsupported fields', () => {
    const script = VIBI3D_SOURCE_MATERIAL_PY + String.raw`
check_source_material({'color': 0xffffff, 'roughness': .8, 'opacity': .5}, {})
check_source_material({'transmission': 0, 'clearcoat': 0, 'thickness': 5, 'ior': 1.5}, {})
check_source_material({'map': 'base'}, {'base': {'repeat': [1, 1], 'offset': [0, 0], 'rotation': 0}})
cases = [({'normalMap': 'n'}, {}, 'unsupported-source-material-map: normalMap'),
         ({'roughnessMap': 'r', 'alphaMap': 'a'}, {}, 'unsupported-source-material-map: alphaMap,roughnessMap'),
         ({'transmission': .9}, {}, 'unsupported-source-material-physical: transmission'),
         ({'ior': 2}, {}, 'unsupported-source-material-physical: ior'),
         ({'clearcoat': 1}, {}, 'unsupported-source-material-physical: clearcoat'),
         ({'emissive': 0x111111}, {}, 'unsupported-source-material-property: emissive'),
         ({'alphaTest': .5}, {}, 'unsupported-source-material-property: alphaTest'),
         ({'side': 2}, {}, 'unsupported-source-material-property: side'),
         ({'polygonOffset': True, 'polygonOffsetFactor': -1}, {}, 'unsupported-source-material-property: polygonOffset'),
         ({'map': 'base'}, {'base': {'repeat': [2, 1]}}, 'unsupported-source-texture-transform: repeat')]
for material, textures, reason in cases:
    try:
        check_source_material(material, textures)
        raise AssertionError('material silently changed')
    except ValueError as error:
        assert str(error).startswith(reason), str(error)
print('material limits passed')
`;
    expect(execFileSync(python!, ['-'], { input: script, encoding: 'utf8', windowsHide: true })).toContain('material limits passed');
  });
});
