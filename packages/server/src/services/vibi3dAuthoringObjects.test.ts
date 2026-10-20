import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolveBinary } from './binLocator.js';
import { VIBI3D_SOURCE_OBJECTS_PY } from './vibi3dAuthoringObjects.js';
import { VIBI3D_MERGE_PY } from './vibi3dAuthoringMerge.js';
import { VIBI3D_SCENE_PY } from './vibi3dAuthoringScene.js';

const python = [resolveBinary('python'), resolveBinary('python3')].find(candidate => candidate
  && spawnSync(candidate, ['-c', 'import sys; print(sys.version_info.major)'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout?.trim() === '3');

describe('native geometry Blender interoperability', () => {
  it('preflights unsupported scene objects before allocating an export scene', () => {
    expect(VIBI3D_SCENE_PY.indexOf('    check_source_objects(source)')).toBeLessThan(VIBI3D_SCENE_PY.indexOf("    scene = bpy.data.scenes.new('Vibi3D checkpoint')"));
  });

  it.skipIf(!python)('keeps editable native geometry/architecture metadata and rejects incompatible objects explicitly', () => {
    const script = VIBI3D_SOURCE_OBJECTS_PY + VIBI3D_MERGE_PY + String.raw`
source = {'format': 'vibi3d', 'version': 1, 'scene': {
    'object': {'uuid': 'root', 'type': 'Group', 'userData': {'vibi3dArchitectureRecipe': {'kind': 'building', 'floors': 4}},
        'children': [{'uuid': 'wall', 'type': 'Mesh', 'geometry': 'g', 'userData': {'vibi3dRecipe': {'kind': 'wall', 'width': 4, 'height': 3}}}]},
    'geometries': [{'uuid': 'g', 'type': 'BufferGeometry', 'data': {'attributes': {'position': {'array': [0,0,0, 1,0,0, 0,1,0]}}}}]}}
original = copy.deepcopy(source)
source['scene']['object']['children'][0]['userData']['vibi3dSignRecipe'] = {'kind': 'channel', 'text': 'fictional sign', 'font': 'sans'}
source['scene']['object']['children'][0]['userData']['vibi3dDecalRecipe'] = {'target': 'wall', 'projection': 'surface'}
source['scene']['object']['children'][0]['userData']['vibi3dMascotRecipe'] = {'style': 'round', 'height': 1.6}
original = copy.deepcopy(source)
check_source_objects(source)
assert source_checks(source, 10)['triangles'] == 1
assert source == original
current = copy.deepcopy(source)
current['scene']['object']['userData']['note'] = 'human text'
generated = copy.deepcopy(source)
generated['scene']['object']['children'][0]['userData']['vibi3dRecipe']['width'] = 5
merged = merge_payload(source, current, generated, [])
assert merged['scene']['object']['userData']['note'] == 'human text'
assert merged['scene']['object']['userData']['vibi3dArchitectureRecipe'] == {'kind': 'building', 'floors': 4}
assert merged['scene']['object']['children'][0]['userData']['vibi3dRecipe']['width'] == 5
for recipe in ['vibi3dSignRecipe', 'vibi3dDecalRecipe', 'vibi3dMascotRecipe']:
    assert merged['scene']['object']['children'][0]['userData'][recipe] == original['scene']['object']['children'][0]['userData'][recipe]
for kind in ['InstancedMesh', 'SkinnedMesh', 'Line', 'PerspectiveCamera']:
    source['scene']['object']['children'][0]['type'] = kind
    try:
        check_source_objects(source)
        raise AssertionError('unsupported object silently exported')
    except ValueError as error:
        assert str(error) == 'unsupported-source-object: ' + kind
source['scene']['object']['children'][0]['type'] = 'Mesh'
source['scene']['geometries'][0]['type'] = 'ExtrudeGeometry'
try:
    source_checks(source, 10)
    raise AssertionError('parametric geometry silently flattened')
except ValueError as error:
    assert str(error).startswith('unsupported-source-geometry')
print('native export boundary passed')
`;
    expect(execFileSync(python!, ['-'], { input: script, encoding: 'utf8', windowsHide: true })).toContain('native export boundary passed');
  });
});
