import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIBI3D_LOOK_PRESETS, resolveVibi3DLook, validateVibi3DLook, validateVibi3DCommand,
  validateVibi3DCommandRequest, validateVibi3DSnapshot, creationValueAt, parseCreationBlobRef, type Vibi3DSnapshot } from '@vibisual/shared';
import { Vibi3DBroker } from './vibi3dBroker.js';
import { VIBI3D_SOURCE_LOOK_PY } from './vibi3dAuthoringLook.js';
import { resolveBinary } from './binLocator.js';
import { CreationStore, type CreationHost } from './creationStore.js';

const snapshot = (): Vibi3DSnapshot => ({ sessionId: 'look-test', projectId: 'fixture', fileName: 'scene', revision: 0,
  selectedId: null, nodes: [{ id: 'mesh', name: 'mesh', type: 'Mesh', parentId: null, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] });
const python = [resolveBinary('python'), resolveBinary('python3')].find(candidate => candidate
  && spawnSync(candidate, ['-c', 'import sys; print(sys.version_info.major)'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout?.trim() === '3');

describe('shared native scene look', () => {
  it('preserves the legacy studio and its intensity when no valid optional look exists', () => {
    const studio = resolveVibi3DLook();
    expect(studio).toMatchObject({ preset: 'studio', intensity: 1, exposure: 1, toneMapping: 'none',
      sun: { intensity: 1.4, color: '#ffffff' }, shadows: { enabled: false }, ao: { enabled: false },
      bloom: { enabled: false }, fog: { enabled: false } });
    expect(resolveVibi3DLook(undefined, 0.7).intensity).toBe(0.7);
    expect(resolveVibi3DLook({ invalid: true }, 0.7)).toEqual({ ...studio, intensity: 0.7 });
    for (const invalid of [NaN, Infinity, -1, 11]) expect(resolveVibi3DLook(undefined, invalid).intensity).toBe(1);
    expect(resolveVibi3DLook({ intensity: 0 }, 0.7).intensity).toBe(0);
  });

  it('resolves all presets deterministically and isolates every returned nested value', () => {
    expect(Object.keys(VIBI3D_LOOK_PRESETS)).toEqual(['studio', 'daylight', 'sunset', 'overcast', 'night-street']);
    for (const preset of Object.keys(VIBI3D_LOOK_PRESETS)) {
      const first = resolveVibi3DLook({ preset });
      expect(validateVibi3DLook(first)).toEqual(first);
      expect(resolveVibi3DLook(JSON.parse(JSON.stringify({ preset })))).toEqual(first);
      first.sun.intensity = 90; first.shadows.enabled = !first.shadows.enabled;
      expect(resolveVibi3DLook({ preset }).sun.intensity).not.toBe(90);
      expect(resolveVibi3DLook({ preset })).toEqual(VIBI3D_LOOK_PRESETS[preset as keyof typeof VIBI3D_LOOK_PRESETS]);
    }
    expect(resolveVibi3DLook({ preset: 'daylight' })).toMatchObject({ toneMapping: 'aces', shadows: { enabled: true }, ao: { enabled: true } });
  });

  it('normalizes partial colors/effects without mutating input and varies only quality for quality settings', () => {
    const input = { preset: 'daylight', sun: { color: '#AaBbCc' }, ao: false, shadows: { mapSize: 1024 } };
    expect(validateVibi3DLook(input)).toEqual({ ...input, sun: { color: '#aabbcc' } });
    const resolved = resolveVibi3DLook(input);
    expect(resolved.sun.color).toBe('#aabbcc'); expect(input.sun.color).toBe('#AaBbCc');
    expect(resolved.ao.enabled).toBe(false); expect(resolved.shadows).toMatchObject({ enabled: true, mapSize: 1024 });
    const draft = resolveVibi3DLook({ preset: 'daylight', quality: 'draft' });
    expect({ ...draft, quality: 'final' }).toEqual(resolveVibi3DLook({ preset: 'daylight', quality: 'final' }));
  });

  it('rejects unknown fields, executable inputs and unsafe numeric/texture allocations', () => {
    for (const value of [null, [], { preset: 'other' }, { sun: true }, { sun: { position: [1, 2, 3] } },
      { exposure: Infinity }, { exposure: -1 }, { sun: { azimuth: 361 } }, { sun: { color: 'red' } },
      { shadows: { mapSize: 8192 } }, { shadows: { enabled: 1 } }, { ao: { radius: 0 } },
      { bloom: { strength: NaN } }, { fog: { density: 1 } }, { script: 'alert(1)' }, JSON.parse('{"__proto__": {}}')]) {
      expect(validateVibi3DLook(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('accepts one canonical look command and independently editable node shadow overrides', () => {
    expect(validateVibi3DCommand({ type: 'look', preset: 'daylight', ao: false })).toEqual({ type: 'look', preset: 'daylight', ao: false });
    expect(validateVibi3DCommand({ type: 'look' })).toBeNull();
    expect(validateVibi3DCommand({ type: 'look', sun: { color: '#FFAA00' } })).toEqual({ type: 'look', sun: { color: '#ffaa00' } });
    expect(validateVibi3DCommand({ type: 'lighting', intensity: 0.5 })).toEqual({ type: 'lighting', intensity: 0.5 });
    expect(validateVibi3DCommand({ type: 'update', id: 'mesh', shadows: { cast: false } })).toEqual({ type: 'update', id: 'mesh', shadows: { cast: false } });
    for (const shadows of [{}, { cast: 1 }, { receive: null }, { script: true }]) {
      expect(validateVibi3DCommand({ type: 'update', id: 'mesh', shadows })).toBeNull();
    }
  });

  it('round trips optional look and shadow snapshots without changing old documents', () => {
    expect(validateVibi3DSnapshot(snapshot())).toEqual(snapshot());
    const source = snapshot(); source.look = { preset: 'daylight', exposure: 0.9 };
    source.nodes[0]!.shadows = { cast: false, receive: true };
    const parsed = validateVibi3DSnapshot(JSON.parse(JSON.stringify(source)))!;
    expect(parsed).toEqual(source); parsed.nodes[0]!.shadows!.cast = true;
    expect(source.nodes[0]!.shadows!.cast).toBe(false);
    expect(validateVibi3DSnapshot({ ...source, look: { fog: { density: Infinity } } })).toBeNull();
    expect(validateVibi3DSnapshot({ ...source, nodes: [{ ...source.nodes[0], shadows: { cast: false } }] })).toBeNull();
  });

  it('keeps the look through broker publication and revision guarding', () => {
    const broker = new Vibi3DBroker(); const scene = snapshot();
    const { rendererToken } = broker.create(scene);
    const request = validateVibi3DCommandRequest({ commandId: 'daylight', expectedRevision: 0,
      commands: [{ type: 'look', preset: 'daylight' }, { type: 'update', id: 'mesh', shadows: { cast: false } }] })!;
    expect(broker.enqueue(scene.sessionId, request).status).toBe('pending');
    const next = { ...scene, revision: 1, look: { preset: 'daylight' as const } };
    broker.publish(scene.sessionId, rendererToken, next);
    expect(broker.read(scene.sessionId).snapshot).toEqual(next);
    expect(() => broker.publish(scene.sessionId, rendererToken, scene)).toThrow('stale-snapshot');
  });

  it('preserves look/shadows across source revisions, candidate rebase and blob externalization', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi3d-look-'));
    const host: CreationHost = { resolveProjectPath: id => id === 'fixture' ? root : null,
      atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); } };
    try {
      const store = new CreationStore(host);
      const scene = (exposure: number, title: string) => ({ format: 'vibi3d', version: 1, title,
        scene: { object: { uuid: 'root', userData: { vibi3dLook: { preset: 'daylight', exposure } },
          children: [{ uuid: 'mesh', userData: { vibi3dShadows: { cast: false, receive: true } } }] },
          images: [{ uuid: 'image', url: `data:image/png;base64,${Buffer.alloc(3000, 7).toString('base64')}` }] } });
      const first = store.create('fixture', { appId: 'vibi3d', payload: await store.externalize('fixture', scene(1, 'old')) }, 'user');
      store.propose('fixture', first.id, { baseRevision: 1, requestId: 'look', payload: await store.externalize('fixture', scene(0.8, 'old')) });
      store.commit('fixture', first.id, { baseRevision: 1, requestId: 'human', payload: await store.externalize('fixture', scene(1, 'human')) }, 'user');
      store.rebase('fixture', first.id, 'look', { requestId: 'rebased' });
      const accepted = store.accept('fixture', first.id, 'rebased', { baseRevision: 2, requestId: 'accept' });
      const reopened = new CreationStore(host).get('fixture', first.id);
      expect(reopened.payload).toEqual(accepted.payload);
      expect(creationValueAt(reopened.payload, '/scene/object/userData/vibi3dLook')).toEqual({ preset: 'daylight', exposure: 0.8 });
      expect(creationValueAt(reopened.payload, '/scene/object/children/@mesh/userData/vibi3dShadows')).toEqual({ cast: false, receive: true });
      expect(creationValueAt(reopened.payload, '/title')).toBe('human');
      expect(parseCreationBlobRef(creationValueAt(reopened.payload, '/scene/images/@image/url'))?.ext).toBe('png');
      expect(creationValueAt(store.revision('fixture', first.id, 1).payload, '/scene/object/userData/vibi3dLook')).toEqual({ preset: 'daylight', exposure: 1 });
    } finally {
      if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('vibi3d-look-')) throw new Error('unsafe-fixture-path');
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Blender look compatibility', () => {
  it.skipIf(!python)('permits legacy/default studio metadata and explicitly rejects a substituted native look', () => {
    const script = VIBI3D_SOURCE_LOOK_PY + String.raw`
def source(look=None, level=1):
    data = {'vibi3dLighting': level}
    if look is not None: data['vibi3dLook'] = look
    return {'scene': {'object': {'userData': data}}}
for look in [None, {}, {'preset': 'studio'}, {'quality': 'final'}, {'ao': False}, {'ao': {'enabled': False, 'intensity': 2}}]:
    check_source_look(source(look))
check_source_look(source({'intensity': 0.5}, 0.5))
for look in [{'preset': 'daylight'}, {'exposure': 2}, {'shadows': True}, {'sun': {'elevation': 10}}, {'bloom': True}]:
    try:
        check_source_look(source(look))
        raise AssertionError('native look silently substituted')
    except ValueError as error:
        assert 'unsupported-source-look-requires-native-render' in str(error)
print('native look guard passed')
`;
    expect(execFileSync(python!, ['-'], { input: script, encoding: 'utf8', windowsHide: true })).toContain('native look guard passed');
  });
});
