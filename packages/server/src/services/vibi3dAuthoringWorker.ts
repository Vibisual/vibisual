/** Appended after stdlib IO; Blender is only imported by the CLI-launched process. */
export const VIBI3D_WORKER_PY = String.raw`

import argparse, runpy, copy
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bpy
import vibi3d_recipes as recipes
from vibi3d_export import three_snapshot, merge_payload, source_checks, uid, assembled_scene, dispose_scene, render_views

def parameters(value):
    if not isinstance(value, dict) or len(value) > 100:
        raise ValueError('invalid-parameters')
    for key, item in value.items():
        valid_key(key)
        if not isinstance(item, dict) or not isinstance(item.get('label'), str) or len(item['label']) > 200:
            raise ValueError('invalid-parameter-label')
        kind, v = item.get('type'), item.get('value')
        if kind == 'number':
            if type(v) not in (float, int) or not math.isfinite(v):
                raise ValueError('invalid-number-parameter')
            for field in ('min', 'max', 'step'):
                if field in item and (type(item[field]) not in (float, int) or not math.isfinite(item[field])):
                    raise ValueError('invalid-parameter-bound')
            if v < item.get('min', -math.inf) or v > item.get('max', math.inf) or item.get('step', 1) <= 0:
                raise ValueError('parameter-outside-range')
        elif kind == 'color':
            if not isinstance(v, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', v):
                raise ValueError('invalid-color-parameter')
        elif kind != 'boolean' or type(v) is not bool:
            raise ValueError('invalid-parameter-type')
        if 'partIds' in item and (not isinstance(item['partIds'], list) or any(not isinstance(x, str) for x in item['partIds'])):
            raise ValueError('invalid-parameter-parts')
    return value

def empty_source(identifier):
    return {'format': 'vibi3d', 'version': 1, 'clips': [], 'scene': {
        'metadata': {'version': 4.6, 'type': 'Object', 'generator': 'Vibi3D.BlenderWorker'},
        'object': {'uuid': identifier, 'type': 'Group', 'name': 'Model', 'children': [],
                   'matrix': [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
                   'up': [0, 1, 0], 'layers': 1, 'userData': {'vibi3dId': 'root', 'vibi3dLighting': 1}}}}

def is_empty_source(payload):
    if set(payload) - {'format', 'version', 'scene', 'clips', 'generatorCode'} or payload.get('clips') or payload.get('generatorCode'):
        return False
    scene, identity = payload.get('scene', {}), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    if any(scene.get(key) for key in ('geometries', 'materials', 'textures', 'images', 'skeletons', 'animations')):
        return False
    node = scene.get('object', {})
    if set(node) - {'uuid', 'type', 'name', 'children', 'matrix', 'up', 'layers', 'userData'}:
        return False
    data = node.get('userData', {})
    if not isinstance(data, dict) or set(data) - {'vibi3dId', 'vibi3dLighting'}:
        return False
    if 'vibi3dId' in data and (not isinstance(data['vibi3dId'], str) or not data['vibi3dId']):
        return False
    return node.get('type') in ('Group', 'Object3D') and not node.get('children') and isinstance(node.get('name', ''), str) \
        and node.get('matrix', identity) == identity and node.get('up', [0, 1, 0]) == [0, 1, 0] and node.get('layers', 1) == 1 \
        and data.get('vibi3dLighting', 1) == 1

class Context:
    def __init__(self, manifest, manifest_path):
        self.manifest = manifest
        self.root = Path(manifest['projectRoot']).resolve(strict=True)
        if not self.root.is_dir() or not manifest_path.resolve().is_relative_to(self.root):
            raise ValueError('manifest-must-be-inside-project')
        self.doc_id, self.run_id = valid_key(manifest['docId']), valid_key(manifest['runId'])
        self.script = inside(self.root, manifest['script'])
        self.program = self.script.read_text(encoding='utf-8-sig')
        if len(self.program) > 200000:
            raise ValueError('generator-code-too-large')
        self.directory = inside(self.root, manifest['outputDir']) / self.run_id
        self.directory.mkdir(parents=True, exist_ok=False)
        self.api = CreationApi(manifest['projectId']) if manifest.get('publish', True) else None
        self.doc = self.api.doc(self.doc_id) if self.api else {'appId': 'vibi3d', 'revision': 1, 'lockedPaths': [], 'payload': empty_source(uid('root:' + self.doc_id))}
        if not self.api and manifest.get('sourceDocument'):
            self.doc = json.loads(inside(self.root, manifest['sourceDocument']).read_text(encoding='utf-8-sig'))
        if self.doc.get('appId') != 'vibi3d' or self.doc.get('payload', {}).get('format') != 'vibi3d':
            raise ValueError('vibi3d-source-required')
        self.current = self.api.resolve(self.doc['payload']) if self.api else self.doc['payload']
        self.root_uuid = self.current['scene']['object']['uuid']
        self.baseline = empty_source(self.root_uuid)
        authoring = self.current.get('authoring', {})
        if authoring.get('engine') == 'blender':
            baseline = inside(self.root, authoring['source']['baseline'])
            self.baseline = json.loads(baseline.read_text(encoding='utf-8-sig'))
        elif is_empty_source(self.current):
            self.baseline = copy.deepcopy(self.current)
        self.schema = parameters({**authoring.get('parameters', {}), **manifest.get('parameters', {})})
        self.params = {key: item['value'] for key, item in self.schema.items()}
        self.recipes, self.part = recipes, recipes.part
        self.budget = manifest.get('triangleBudget', 200000)
        if type(self.budget) is not int or not 1 <= self.budget <= 1000000:
            raise ValueError('invalid-triangle-budget')
        if manifest.get('mode', 'auto') not in ('auto', 'candidate'):
            raise ValueError('invalid-publish-mode')
        self.commit = is_empty_source(self.current) and manifest.get('mode', 'auto') != 'candidate'
        self.revision, self.stages = self.doc['revision'], []

    def relative(self, file):
        return file.relative_to(self.root).as_posix()

    def checkpoint(self, identifier, label, render=False):
        valid_key(identifier)
        if not isinstance(label, str) or not 1 <= len(label) <= 200 or len(self.stages) >= 32:
            raise ValueError('invalid-checkpoint')
        if any(stage['id'] == identifier for stage in self.stages):
            raise ValueError('duplicate-checkpoint-id')
        if self.api:
            latest = self.api.doc(self.doc_id)
            if latest['revision'] != self.revision:
                raise ValueError('revision-conflict: user source changed; start a new candidate from the current source')
            self.current = self.api.resolve(latest['payload'])
        directory = self.directory / (str(len(self.stages) + 1).zfill(2) + '-' + identifier)
        directory.mkdir()
        generated, checks = three_snapshot(self.root_uuid, self.budget, directory, self.current['scene']['object'])
        # An unfinished rebuild has not made all existing parts yet; it is not a proposal to delete them.
        intermediate_candidate = not self.commit and identifier != 'complete'
        payload = generated if intermediate_candidate else merge_payload(self.baseline, self.current, generated, self.doc.get('lockedPaths', []))
        checks = source_checks(payload, self.budget)
        original_scene = bpy.context.window.scene
        assembled = assembled_scene(payload, generated, directory)
        rendered = []
        try:
            bpy.context.window.scene = assembled
            bpy.context.view_layer.update()
            glb = directory / 'model.glb'
            temporary = directory / 'model.pending.glb'
            bpy.ops.export_scene.gltf(filepath=str(temporary), export_format='GLB', use_active_scene=True, use_renderable=True, export_extras=True, export_animations=False)
            os.replace(temporary, glb)
            if render and self.manifest.get('render', True):
                rendered = render_views(assembled, directory)
            blend = directory / 'model.blend'
            temporary = directory / 'model.pending.blend'
            bpy.ops.file.pack_all()
            bpy.ops.wm.save_as_mainfile(filepath=str(temporary), copy=True)
            os.replace(temporary, blend)
        finally:
            bpy.context.window.scene = original_scene
            dispose_scene(assembled)
        script, manifest_file, baseline_file = directory / 'model.py', directory / 'manifest.json', directory / 'baseline.json'
        atomic_bytes(script, self.program.encode('utf-8'))
        saved_manifest = {**self.manifest, 'script': self.relative(script), 'parameters': self.schema}
        atomic_json(manifest_file, saved_manifest)
        atomic_json(baseline_file, generated)
        stage = {'id': identifier, 'label': label, 'completedAt': int(time.time() * 1000)}
        payload.update(generatorCode=self.program, authoring={
            'engine': 'blender', 'version': 1, 'runId': self.run_id, 'stage': stage, 'parameters': self.schema,
            'source': {key: self.relative(file) for key, file in {'script': script, 'blend': blend, 'glb': glb, 'manifest': manifest_file, 'baseline': baseline_file}.items()},
            'renderPaths': [self.relative(file) for file in rendered], 'checks': checks})
        atomic_json(directory / 'source.json', payload)
        published = bool(self.api) and not intermediate_candidate
        if published:
            body = {'projectId': self.manifest['projectId'], 'baseRevision': self.revision,
                    'requestId': 'v3d-' + hashlib.sha256((self.run_id + ':' + identifier).encode('utf-8')).hexdigest(), 'payload': self.api.externalize(payload), 'label': label}
            if not self.commit:
                body['input'] = self.manifest.get('input', '')
            result = self.api.request('POST', '/docs/' + self.doc_id + ('/commit' if self.commit else '/candidates'), body)
            if self.commit:
                self.revision = result['doc']['revision']
                self.baseline = generated
        self.stages.append({**stage, 'source': self.relative(directory / 'source.json'), 'published': published, 'mode': 'commit' if self.commit else 'candidate'})
        atomic_json(self.directory / 'result.json', {'docId': self.doc_id, 'revision': self.revision, 'stages': self.stages})
        print('VIBI3D_CHECKPOINT ' + json.dumps(self.stages[-1], ensure_ascii=False), flush=True)

def main():
    parser = argparse.ArgumentParser(description='Vibi3D local Blender authoring worker')
    parser.add_argument('--manifest', required=True)
    arguments = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    file = Path(arguments.manifest)
    manifest = json.loads(file.read_text(encoding='utf-8-sig'))
    ctx = Context(manifest, file)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    sys.path.insert(0, str(ctx.script.parent))
    module = runpy.run_path(str(ctx.script))
    build = module.get('build')
    if not callable(build):
        raise ValueError('script-must-define-build-ctx')
    build(ctx)
    ctx.checkpoint('complete', 'Ready for visual review', render=True)

if __name__ == '__main__':
    main()
`;
