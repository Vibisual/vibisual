import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { resolveBinary } from './binLocator.js';
import { VIBI3D_IO_PY } from './vibi3dAuthoringIo.js';
import { VIBI3D_WORKER_PY } from './vibi3dAuthoringWorker.js';
import { VIBI3D_MERGE_PY } from './vibi3dAuthoringMerge.js';
import { VIBI3D_EXPORT_PY } from './vibi3dAuthoringExport.js';

const python = [resolveBinary('python'), resolveBinary('python3')].find(candidate => candidate
  && spawnSync(candidate, ['-c', 'import sys; print(sys.version_info.major)'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout?.trim() === '3');

describe('local Blender worker source lifecycle', () => {
  it.skipIf(!python)('preserves named empty-root identity in every exported checkpoint', () => {
    // Execute the actual pure helper from the shipped module without loading Blender in a unit test.
    const script = `import ast, json\nmodule=ast.parse(json.loads(${JSON.stringify(JSON.stringify(VIBI3D_EXPORT_PY))}))\n`
      + String.raw`
helper = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == 'root_identity')
exec(compile(ast.Module(body=[helper], type_ignores=[]), 'exporter', 'exec'))
for name in ['Vibi3D', 'My toolbox']:
    root = {'uuid': 'uuid', 'name': 'Model', 'userData': {'vibi3dId': 'root', 'vibi3dLighting': 1}}
    previous = {'name': name, 'userData': {'vibi3dId': 'custom-root-id'}}
    result = root_identity(root, previous)
    assert result['name'] == name and result['userData']['vibi3dId'] == 'custom-root-id'
assert 'name' not in root_identity({'name': 'Model', 'userData': {}}, {})
print('identity passed')
`;
    expect(execFileSync(python!, ['-'], { input: script, encoding: 'utf8', windowsHide: true })).toContain('identity passed');
  });

  it.skipIf(!python)('does not access network offline, honors review mode and stops on user revisions before writing checkpoints', () => {
    const stub = String.raw`
import types, tempfile
sys.modules['bpy'] = types.ModuleType('bpy')
recipes = types.ModuleType('vibi3d_recipes')
recipes.part = lambda *args: None
sys.modules['vibi3d_recipes'] = recipes
export = types.ModuleType('vibi3d_export')
for name in ['three_snapshot', 'merge_payload', 'source_checks', 'uid', 'assembled_scene', 'dispose_scene', 'render_views']:
    setattr(export, name, lambda *args: 'fixture-root')
sys.modules['vibi3d_export'] = export
__file__ = str(Path.cwd() / 'worker.py')
__name__ = 'worker_test'
`;
    const assertions = String.raw`
with tempfile.TemporaryDirectory(prefix='vibi3d-worker-test-') as temp:
    root = Path(temp).resolve()
    (root / 'model.py').write_text('def build(ctx): pass', encoding='utf-8-sig')
    file = root / 'manifest.json'
    manifest = {'projectRoot': str(root), 'projectId': 'fixture', 'docId': 'fixture', 'script': 'model.py',
                'outputDir': 'artifacts', 'runId': 'auto', 'publish': False}
    file.write_text(json.dumps(manifest), encoding='utf-8-sig')
    # Offline execution must not instantiate even the authenticated-loopback client.
    class ForbiddenApi:
        def __init__(self, *args): raise AssertionError('offline network access')
    CreationApi = ForbiddenApi
    ctx = Context(manifest, file)
    assert ctx.api is None and ctx.commit is True and not ctx.program.startswith('\ufeff')
    candidate = Context({**manifest, 'runId': 'review', 'mode': 'candidate'}, file)
    assert candidate.commit is False
    for number, name in enumerate(['Vibi3D', 'My toolbox']):
        fresh = {'appId': 'vibi3d', 'revision': 1, 'lockedPaths': [], 'payload': empty_source('root-uuid')}
        fresh['payload']['scene']['object'].update(name=name, userData={'vibi3dId': 'editor-root-uuid', 'vibi3dLighting': 1})
        (root / 'fresh.json').write_text(json.dumps(fresh), encoding='utf-8-sig')
        named = Context({**manifest, 'runId': 'named-' + str(number), 'sourceDocument': 'fresh.json'}, file)
        assert named.commit is True
        assert named.baseline['scene']['object']['name'] == name
        assert named.baseline['scene']['object']['userData']['vibi3dId'] == 'editor-root-uuid'
    for mutate in [lambda p: p['scene']['object'].update(children=[{'uuid': 'light', 'type': 'PointLight'}]),
                   lambda p: p['scene']['object']['matrix'].__setitem__(12, 1),
                   lambda p: p['scene']['object'].update(userData={'custom': 'keep'}),
                   lambda p: p['scene']['object'].update(userData={'vibi3dId': 'uuid', 'vibi3dLighting': 0.5}),
                   lambda p: p['scene']['object'].update(userData={'vibi3dId': 'uuid', 'camera': {'position': [1, 2, 3]}}),
                   lambda p: p.update(clips=[{'name': 'motion'}]),
                   lambda p: p.update(generatorCode='retain this source')]:
        payload = empty_source('root')
        mutate(payload)
        assert not is_empty_source(payload)
    source = {'appId': 'vibi3d', 'revision': 1, 'lockedPaths': [], 'payload': empty_source('root')}
    source['payload']['scene']['geometries'] = [{'uuid': 'existing'}]
    (root / 'source.json').write_text(json.dumps(source), encoding='utf-8-sig')
    existing = Context({**manifest, 'runId': 'existing', 'sourceDocument': 'source.json'}, file)
    assert existing.commit is False
    class ChangedApi:
        def doc(self, *args): return {'revision': 2}
    ctx.api = ChangedApi()
    try:
        ctx.checkpoint('first', 'First stage')
        raise AssertionError('overwrote an intervening user revision')
    except ValueError as error:
        assert 'revision-conflict' in str(error)
    assert list(ctx.directory.iterdir()) == []
print('lifecycle passed')
`;
    const result = execFileSync(python!, ['-'], { input: VIBI3D_IO_PY + stub + VIBI3D_WORKER_PY + assertions, encoding: 'utf8', windowsHide: true });
    expect(result).toContain('lifecycle passed');
  });

  it.skipIf(!python)('checks the merged mesh including retained human parts and never marks visual review passed', () => {
    const assertions = String.raw`
source = {'scene': {'object': {'uuid': 'root', 'children': [{'uuid': 'mesh', 'geometry': 'geom'}]},
                   'geometries': [{'uuid': 'geom', 'type': 'BufferGeometry', 'data': {
                       'attributes': {'position': {'array': [0,0,0, 1,0,0, 0,1,0]}}}}]}}
assert source_checks(source, 10) == {'finite': True, 'triangles': 1, 'objects': 1, 'triangleBudget': 10, 'visualReview': 'pending'}
assert native_geometry_equal({'uv': [0.612576425075531]}, {'uv': [0.6125764846801758]})
assert not native_geometry_equal({'position': [0.5]}, {'position': [0.501]})
try:
    source_checks(source, 0)
    raise AssertionError('triangle budget ignored')
except ValueError as error:
    assert 'budget' in str(error)
source['scene']['geometries'][0]['data']['attributes']['position']['array'][0] = float('nan')
try:
    source_checks(source, 10)
    raise AssertionError('non-finite source accepted')
except ValueError as error:
    assert 'non-finite' in str(error)
print('checks passed')
`;
    expect(execFileSync(python!, ['-'], { input: VIBI3D_MERGE_PY + assertions, encoding: 'utf8', windowsHide: true })).toContain('checks passed');
  });
});
