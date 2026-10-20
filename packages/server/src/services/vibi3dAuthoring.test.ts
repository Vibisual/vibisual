import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process';
import { authoringKit, mountVibi3DAuthoringRoutes } from './vibi3dAuthoring.js';
import { blenderCandidates } from './vibi3dAuthoringBlender.js';
import { VIBI3D_MERGE_PY } from './vibi3dAuthoringMerge.js';
import { VIBI3D_IO_PY } from './vibi3dAuthoringIo.js';
import { resolveBinary } from './binLocator.js';

// Windows may expose a non-installed Store alias named python3. A short probe never starts long-lived work.
const python = [resolveBinary('python'), resolveBinary('python3')].find(candidate => candidate
  && spawnSync(candidate, ['-c', 'import sys; print(sys.version_info.major)'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout?.trim() === '3');
function runPython(script: string): string {
  return execFileSync(python!, ['-'], { input: script, encoding: 'utf8', windowsHide: true });
}
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())))); });

describe('local authoring kit', () => {
  it('finds installed candidates across Windows, macOS and Linux without relying on a shell', () => {
    const base = { home: 'C:\\Fixture', env: { ProgramFiles: 'D:\\Programs', LOCALAPPDATA: 'D:\\Local' }, directories: () => ['Blender 4.5', 'other', 'Blender 5.1', 'Blender 4.10'] };
    expect(blenderCandidates({ ...base, platform: 'win32' }).slice(0, 3)).toEqual([
      'D:\\Programs\\Blender Foundation\\Blender 5.1\\blender.exe',
      'D:\\Programs\\Blender Foundation\\Blender 4.10\\blender.exe',
      'D:\\Programs\\Blender Foundation\\Blender 4.5\\blender.exe',
    ]);
    expect(blenderCandidates({ ...base, home: '/fixture', platform: 'darwin' })).toEqual([
      '/Applications/Blender.app/Contents/MacOS/Blender', '/fixture/Applications/Blender.app/Contents/MacOS/Blender',
    ]);
    expect(blenderCandidates({ ...base, home: '/home/fixture', platform: 'linux' })).toContain('/snap/bin/blender');
  });

  it('serves a read-only kit only for a registered project and makes missing Blender explicit', async () => {
    const app = express();
    let discoveries = 0;
    mountVibi3DAuthoringRoutes(app, { resolveProjectPath: id => id === 'fixture' ? '/fixture' : null }, () => { discoveries++; return null; });
    const server = await new Promise<Server>(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test address');
    const url = `http://127.0.0.1:${address.port}/authoring/kit`;
    expect((await fetch(url + '?projectId=unknown')).status).toBe(404);
    expect(discoveries).toBe(0);
    const response = await fetch(url + '?projectId=fixture');
    const kit = await response.json();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(kit).toMatchObject({ ok: true, projectRoot: '/fixture', blenderPath: null });
    expect(Object.keys(kit.files)).toEqual(['vibi3d_worker.py', 'vibi3d_export.py', 'vibi3d_recipes.py', 'model.py']);
    expect(kit.protocol.join(' ')).toContain('--python-exit-code 1');
    expect((await fetch(url + '?projectId=fixture', { method: 'POST' })).status).toBe(404);
  });

  it.skipIf(!python)('all shipped Python modules compile without executing generated code', () => {
    const files = authoringKit('fixture', '/fixture', null).files;
    const script = `import json\nfiles=json.loads(${JSON.stringify(JSON.stringify(files))})\nfor name, source in files.items(): compile(source, name, 'exec')\nprint('compiled')`;
    expect(runPython(script)).toContain('compiled');
  });

  it.skipIf(!python)('preserves independent human edits, locks and reorders, and refuses overlapping edits', () => {
    const script = VIBI3D_MERGE_PY + String.raw`
base = {'children': [{'uuid': 'a', 'matrix': [0], 'value': 1}, {'uuid': 'b', 'matrix': [0], 'value': 2}]}
current = copy.deepcopy(base)
current['children'][0]['matrix'] = [3]
generated = copy.deepcopy(base)
generated['children'][1]['value'] = 4
merged = merge_source(base, current, generated)
assert merged['children'][0]['matrix'] == [3]
assert merged['children'][1]['value'] == 4
assert base['children'][0]['matrix'] == [0]
generated['children'][0]['matrix'] = [5]
try:
    merge_source(base, current, generated)
    raise AssertionError('overlapping edits accepted')
except ValueError as error:
    assert '/children/@a/matrix' in str(error)
held = merge_source(base, current, generated, ['/children/@a'])
assert held['children'][0] == current['children'][0]
deleted = {'children': [generated['children'][1]]}
assert merge_source(base, base, deleted, ['/children/@a'])['children'][1]['uuid'] == 'a'
current = {'children': list(reversed(base['children']))}
generated = copy.deepcopy(base)
generated['children'][0]['value'] = 10
assert merge_source(base, current, generated)['children'][0]['uuid'] == 'b'
print('merge passed')
`;
    expect(runPython(script)).toContain('merge passed');
  });

  it.skipIf(!python)('refuses non-local credential transport and preserves numeric blob precision', () => {
    const script = VIBI3D_IO_PY + String.raw`
os.environ['VIBISUAL_BASE'] = 'https://example.com'
os.environ['VIBISUAL_TOKEN'] = 'fixture-token'
try:
    CreationApi('fixture')
    raise AssertionError('external credential transport allowed')
except ValueError as error:
    assert str(error) == 'loopback-base-required'
os.environ.pop('VIBISUAL_BASE')
try:
    CreationApi('fixture')
    raise AssertionError('missing base accepted')
except ValueError as error:
    assert str(error) == 'missing-vibisual-base'
root = Path.cwd().resolve()
for value in ['../outside', '/absolute', 'C:/outside', 'nested/../../outside']:
    try:
        inside(root, value)
        raise AssertionError('escaped project')
    except ValueError:
        pass
api = object.__new__(CreationApi)
captured = []
api.upload = lambda data, ext: captured.append((data, ext)) or 'vibi-blob:fixture.f64'
values = [1 / 3] * 64
assert api.externalize({'array': values}) == {'array': 'vibi-blob:fixture.f64'}
assert captured[0][1] == 'f64'
assert list(struct.unpack('<64d', captured[0][0])) == values
name = '0' * 64 + '.f64'
api.blobs = {name: [0.5] * 64}
raw = {'items': [{'uuid': 'locked', 'array': 'vibi-blob:' + name}]}
resolved = api.resolve(raw)
resolved['items'].insert(0, {'uuid': 'other', 'value': 1})
assert api.externalize(resolved)['items'][1]['array'] == 'vibi-blob:' + name
api.externalize([0.5] * 64)
assert captured[-1][1] == 'f32'
api.externalize([2] * 64)
assert captured[-1][1] == 'u32'
print('io passed')
`;
    expect(runPython(script)).toContain('io passed');
  });
});
