import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateVibi3DCommandRequest, validateVibi3DWorkflowCommand, validateVibi3DCaptureRaster, vibi3DCaptureSize, validateVibi3DMaterial, creationValueAt, parseCreationBlobRef, isEmptyVibi3DSource, type CreationValue, type Vibi3DSnapshot } from '@vibisual/shared';
import { CreationStore, type CreationHost } from './creationStore.js';
import { Vibi3DWorkflowStore } from './vibi3dWorkflowStore.js';
import { VIBI3D_NATIVE_HELPER } from './vibi3dNativeKit.js';

let root: string; let host: CreationHost; let creation: CreationStore; let workflow: Vibi3DWorkflowStore;
const empty: CreationValue = { format: 'vibi3d', version: 1, clips: [], scene: { object: { uuid: 'root', type: 'Group', children: [], userData: { vibi3dId: 'root' } } } };
const filled: CreationValue = { ...empty as object, scene: { object: { uuid: 'root', type: 'Group', children: [{ uuid: 'wall', type: 'Mesh' }] } } };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY2sAAAAASUVORK5CYII=';
function snapshot(id: string, revision = 1, dirty = false): Vibi3DSnapshot {
  return { sessionId: 'session', projectId: root, fileName: 'model', revision: 2, selectedId: null, nodes: [], document: { id, revision, dirty } };
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi3d-workflow-'));
  host = { resolveProjectPath: value => value === root ? root : null, atomicWriteFile: (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, value); fs.renameSync(`${file}.tmp`, file);
  } };
  creation = new CreationStore(host); workflow = new Vibi3DWorkflowStore(host, creation, process.platform);
});
afterEach(() => {
  vi.restoreAllMocks();
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('vibi3d-workflow-')) throw new Error('unsafe-fixture-path');
  fs.rmSync(root, { recursive: true, force: true });
});
describe('native workflow persistence', () => {
  it('defaults inspection captures to final while preserving explicitly requested low-cost drafts', () => {
    expect(vibi3DCaptureSize()).toEqual([1080, 1920]); expect(vibi3DCaptureSize('9:16', 'draft')).toEqual([720, 1280]);
    expect(validateVibi3DWorkflowCommand({ type: 'capture', size: [540, 960] })).toBeNull();
    expect(validateVibi3DWorkflowCommand({ type: 'capture', quality: 'draft', size: [540, 960] })).not.toBeNull();
    expect(validateVibi3DWorkflowCommand({ type: 'capture', size: [2048, 2048], views: Array.from({ length: 12 }, (_, n) => `view-${n}`) })).toBeNull();
    expect(validateVibi3DCaptureRaster({ width: 360, height: 640, samples: 0 })).toEqual({ width: 360, height: 640, samples: 0 });
    for (const raster of [{ width: 0, height: 640 }, { width: 4097, height: 640 }, { width: 360, height: 640, samples: 1.5 },
      { width: 360, height: 640, samples: -1 }, { width: 360, height: 640, scale: 2 }]) expect(validateVibi3DCaptureRaster(raster)).toBeNull();
  });
  it('keeps initially empty source untouched, persists the work stage/PNGs and replays across restarts', async () => {
    const doc = creation.create(root, { appId: 'vibi3d', payload: empty }, 'user');
    const view = snapshot(doc.id); const run = workflow.start(root, doc.id, view, 'run');
    expect(run.initialEmpty).toBe(true);
    const command = { type: 'checkpoint' as const, stage: 'blockout', label: 'Blockout' };
    const result = await workflow.save(root, doc.id, run.id, 'save', view, command, filled);
    expect(result.doc).toBeUndefined(); expect(result.stage.mode).toBe('intermediate');
    expect(creation.get(root, doc.id)).toMatchObject({ revision: 1, author: 'user', payload: empty });
    const captures = workflow.capture(root, doc.id, run.id, 'capture', snapshot(doc.id), [{ view: 'front', mode: 'lit', quality: 'draft', width: 1, height: 1, dataUrl: png }]);
    expect(captures[0]?.path).toMatch(/^\.vibisual\/creation\/[^/]+\/workflow\/runs\/[^/]+\/captures\/[^/]+\.png$/);
    expect(fs.readFileSync(path.join(root, captures[0]!.path)).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const reopened = new Vibi3DWorkflowStore(host, creation, process.platform);
    expect(reopened.read(root, doc.id)?.stages[0]?.captures).toHaveLength(1);
    expect((await reopened.save(root, doc.id, run.id, 'save', view, command, filled)).stage).toMatchObject({ revision: 1, mode: 'intermediate' });
    expect(reopened.resume(root, doc.id, run.id, view).payload).toEqual(filled);
    expect(creation.history(root, doc.id)).toHaveLength(1);
    const proposal = await reopened.save(root, doc.id, run.id, 'propose', view, { type: 'propose', label: 'Review' }, filled);
    expect(proposal.stage.mode).toBe('candidate');
    expect(creation.get(root, doc.id)).toMatchObject({ revision: 1, payload: empty });
    creation.accept(root, doc.id, proposal.stage.candidateId!, { baseRevision: 1, requestId: 'user-accept' });
    expect(creation.get(root, doc.id)).toMatchObject({ revision: 2, payload: filled });
    await expect(reopened.save(root, doc.id, run.id, 'save', view, command, filled, undefined, true)).rejects.toThrow('revision-conflict');
  });
  it('keeps populated intermediate scenes outside the source and makes one final candidate', async () => {
    const doc = creation.create(root, { appId: 'vibi3d', payload: filled }, 'user');
    const view = snapshot(doc.id); const run = workflow.start(root, doc.id, view, 'run');
    const changed = { ...filled as object, generatorCode: 'saved as data only' };
    const result = await workflow.save(root, doc.id, run.id, 'save', view, { type: 'checkpoint', stage: 'detail', label: 'Details' }, changed);
    expect(result.stage.mode).toBe('intermediate'); expect(creation.get(root, doc.id).payload).toEqual(filled);
    expect(creation.candidates(root, doc.id)).toHaveLength(0);
    const proposed = await workflow.save(root, doc.id, run.id, 'propose', view, { type: 'propose', label: 'Final' }, changed);
    expect(proposed.stage.mode).toBe('candidate'); expect(creation.candidates(root, doc.id)).toHaveLength(1);
    expect(creation.get(root, doc.id).revision).toBe(1);
    await expect(workflow.save(root, doc.id, run.id, 'again', view, { type: 'propose', label: 'Again' }, changed)).rejects.toThrow();
  });
  it('rejects unsaved starts, intervening revisions, locked values and fabricated capture evidence', async () => {
    const doc = creation.create(root, { appId: 'vibi3d', payload: { ...filled as object, fixed: 1 }, lockedPaths: ['/fixed'] }, 'user');
    expect(() => workflow.start(root, doc.id, snapshot(doc.id, 1, true), 'dirty')).toThrow('unsaved-user-edits');
    workflow.start(root, doc.id, snapshot(doc.id), 'run');
    await expect(workflow.save(root, doc.id, 'run', 'lock', snapshot(doc.id), { type: 'checkpoint', stage: 'locked', label: 'Locked' }, filled)).rejects.toThrow('locked-element-changed');
    await expect(workflow.save(root, doc.id, 'run', 'fake', snapshot(doc.id), { type: 'checkpoint', stage: 'fake', label: 'Fake',
      checks: [{ id: 'viewed', status: 'passed', evidencePath: '.vibisual/fake.png' }] }, doc.payload)).rejects.toThrow('capture-evidence-not-found');
    creation.commit(root, doc.id, { requestId: 'human', baseRevision: 1, payload: { ...doc.payload as object, other: true } }, 'user');
    await expect(workflow.save(root, doc.id, 'run', 'stale', snapshot(doc.id), { type: 'checkpoint', stage: 'stale', label: 'Stale' }, doc.payload)).rejects.toThrow('revision-conflict');
  });
  it('pins intermediate texture blobs and preserves raw material source references across reopen/resume', async () => {
    const doc = creation.create(root, { appId: 'vibi3d', payload: filled }, 'user');
    workflow.start(root, doc.id, snapshot(doc.id), 'run');
    const ref = await creation.putBlob(root, { ext: 'png', bytes: new Uint8Array(Buffer.from(png.split(',')[1]!, 'base64')) });
    const file = creation.blobPath(root, ref.slice('vibi-blob:'.length));
    const recipe = { preset: 'painted-concrete', seed: 42, maps: { normalMap: { source: { kind: 'blob', ref } } } };
    const payload = { ...filled as object, scene: { materials: [{ uuid: 'material', userData: { vibi3dMaterial: recipe } }], images: [{ uuid: 'image', url: ref }] } };
    await workflow.save(root, doc.id, 'run', 'save', snapshot(doc.id), { type: 'checkpoint', stage: 'maps', label: 'Maps' }, payload);
    expect(creation.get(root, doc.id).payload).toEqual(filled);
    fs.utimesSync(file, new Date(0), new Date(0));
    await creation.prune(root);
    expect(fs.existsSync(file)).toBe(true);
    const reopened = new Vibi3DWorkflowStore(host, new CreationStore(host), process.platform);
    const resumed = reopened.resume(root, doc.id, 'run', snapshot(doc.id));
    expect(resumed.payload).toEqual(payload);
    const restoredRecipe = creationValueAt(resumed.payload, '/scene/materials/@material/userData/vibi3dMaterial');
    expect(validateVibi3DMaterial(restoredRecipe)).toEqual(recipe);
    expect(creationValueAt(resumed.payload, '/scene/images/@image/url')).toBe(ref);
  });
  it('rejects invalid PNG bytes, false dimensions and symlink escape', async () => {
    const doc = creation.create(root, { appId: 'vibi3d', payload: filled }, 'user');
    workflow.start(root, doc.id, snapshot(doc.id), 'run');
    await workflow.save(root, doc.id, 'run', 'save', snapshot(doc.id), { type: 'checkpoint', stage: 'detail', label: 'Detail' }, filled);
    expect(() => workflow.capture(root, doc.id, 'run', 'capture', snapshot(doc.id), [{ view: 'front', mode: 'lit', quality: 'draft', width: 2, height: 1, dataUrl: png }])).toThrow('invalid-capture');
    expect(() => workflow.read(root, '../escape')).toThrow('invalid-id');
  });
  it('pins instance matrix blobs and keeps module identities through stages, candidates and acceptance', async () => {
    const doc = creation.create(root, { appId: 'vibi3d', payload: filled }, 'user');
    const view = snapshot(doc.id); workflow.start(root, doc.id, view, 'kit-run');
    const modules = [{ id: 'window', name: 'Window', revision: 2, prototypeId: 'prototype', builtin: 'korean-retail/window' }];
    const placement = { moduleId: 'window', moduleRevision: 2, placementId: 'window-west', arrayId: 'facade-grid', cell: [0, 1, 0] };
    const payload = { format: 'vibi3d', version: 1, clips: [], scene: { object: { uuid: 'root', type: 'Group', userData: { vibi3dKitModules: modules }, children: [
      { uuid: 'library', type: 'Group', visible: false, userData: { vibi3dKitLibrary: true }, children: [{ uuid: 'prototype', type: 'Group' }] },
      { uuid: 'window-west', type: 'Group', userData: { vibi3dInstance: placement } },
      { uuid: 'bucket', type: 'InstancedMesh', count: 20, userData: { vibi3dInstances: ['window-west'] },
        instanceMatrix: { itemSize: 16, type: 'Float32Array', array: Array.from({ length: 320 }, (_, index) => index / 8) } },
    ] } } };
    await workflow.save(root, doc.id, 'kit-run', 'stage', view, { type: 'checkpoint', stage: 'kit', label: 'Kit' }, payload);
    const reopened = new Vibi3DWorkflowStore(host, new CreationStore(host), process.platform);
    const resumed = reopened.resume(root, doc.id, 'kit-run', view);
    const matrix = creationValueAt(resumed.payload, '/scene/object/children/@bucket/instanceMatrix/array');
    const blob = parseCreationBlobRef(matrix)!; expect(blob.ext).toBe('f32');
    const file = creation.blobPath(root, blob.name); fs.utimesSync(file, new Date(0), new Date(0)); await creation.prune(root);
    expect(fs.existsSync(file)).toBe(true);
    expect(creationValueAt(resumed.payload, '/scene/object/userData/vibi3dKitModules')).toEqual(modules);
    expect(creationValueAt(resumed.payload, '/scene/object/children/@window-west/userData/vibi3dInstance')).toEqual(placement);
    const proposed = await reopened.save(root, doc.id, 'kit-run', 'finish', view, { type: 'propose', label: 'Kit result' }, resumed.payload);
    const accepted = creation.accept(root, doc.id, proposed.stage.candidateId!, { baseRevision: 1, requestId: 'user-accept-kit' });
    expect(accepted.payload).toEqual(resumed.payload);
  });
  it('appends immutable correction attempts and resumes the latest matching stage without accepting candidates', async () => {
    const doc = creation.create(root, { appId: 'vibi3d', payload: filled }, 'user');
    const view = snapshot(doc.id); workflow.start(root, doc.id, view, 'run');
    const first = await workflow.save(root, doc.id, 'run', 'first', view, { type: 'checkpoint', stage: 'details', label: 'First' }, filled);
    const improved = { ...filled as object, note: 'corrected' };
    const second = await workflow.save(root, doc.id, 'run', 'second', view, { type: 'checkpoint', stage: 'details', label: 'Corrected' }, improved);
    expect(first.stage.sourcePath).not.toBe(second.stage.sourcePath);
    expect(workflow.resume(root, doc.id, 'run', view, 'details').payload).toEqual(improved);
    expect(workflow.read(root, doc.id)?.stages).toHaveLength(2);
    expect(() => workflow.resume(root, doc.id, 'run', snapshot(doc.id, 1, true))).toThrow('unsaved-user-edits');
    const agentDirty = { ...view, document: { id: doc.id, revision: 1, dirty: true, humanDirty: false } };
    expect(workflow.start(root, doc.id, agentDirty, 'continued').id).toBe('continued');
    expect(workflow.read(root, doc.id)?.id).toBe('run');
    expect(workflow.resume(root, doc.id, 'run', agentDirty).payload).toEqual(improved);
    await expect(workflow.save(root, doc.id, 'run', 'human', { ...agentDirty, document: { ...agentDirty.document, humanDirty: true } },
      { type: 'checkpoint', stage: 'human', label: 'Human' }, improved)).rejects.toThrow('unsaved-user-edits');
    await workflow.save(root, doc.id, 'run', 'propose', view, { type: 'propose', label: 'Final' }, improved);
    expect(() => workflow.resume(root, doc.id, 'run', view)).toThrow('run-already-proposed');
  });
});
describe('workflow input and helper contracts', () => {
  it('rejects unknown fields, mixed persistence operations and excessive total capture pixels', () => {
    const request = (commands: unknown[]) => ({ commandId: 'command', expectedRevision: 0, commands });
    expect(validateVibi3DCommandRequest(request([{ type: 'checkpoint', stage: 'blockout', label: 'Blockout' }]))).not.toBeNull();
    expect(validateVibi3DCommandRequest(request([{ type: 'checkpoint', stage: '../bad', label: 'Bad' }]))).toBeNull();
    expect(validateVibi3DCommandRequest(request([{ type: 'propose', label: 'Final' }, { type: 'capture' }]))).toBeNull();
    expect(validateVibi3DCommandRequest(request([{ type: 'capture', size: [4096, 4096], views: ['a', 'b', 'c', 'd'] }]))).toBeNull();
    expect(validateVibi3DCommandRequest(request([{ type: 'capture', size: [1080, 1920], views: ['a', 'b', 'c'], mode: 'clay', quality: 'final' }]))).not.toBeNull();
    expect(isEmptyVibi3DSource({ ...empty as object, authoring: {} })).toBe(false);
    expect(isEmptyVibi3DSource(filled)).toBe(false);
  });
  it('uses environment-first loopback credentials and platform-injected discovery without leaking secrets', async () => {
    const file = path.join(root, 'helper.mjs'); fs.writeFileSync(file, VIBI3D_NATIVE_HELPER);
    const helper = await import(/* @vite-ignore */ pathToFileURL(file).href) as {
      listenerPath(platform: string, home: string, env: Record<string, string>): string;
      connection(env: Record<string, string>, platform: string, home: string): Promise<{ base: string; token: string }>;
      commandWaitMs(result: { expiresAt?: number }, now: number): number;
    };
    expect(helper.listenerPath('win32', 'C:\\Fixture', { APPDATA: 'C:\\My Data' })).toBe('C:\\My Data\\@vibisual\\desktop\\hook-listener.json');
    expect(helper.listenerPath('darwin', '/fixture', {})).toBe('/fixture/Library/Application Support/@vibisual/desktop/hook-listener.json');
    expect(helper.listenerPath('linux', '/home/test', { XDG_CONFIG_HOME: '/custom' })).toBe('/custom/@vibisual/desktop/hook-listener.json');
    expect(helper.commandWaitMs({ expiresAt: 301000 }, 1000)).toBe(315000);
    expect(helper.commandWaitMs({ expiresAt: 31000 }, 1000)).toBe(45000);
    expect(helper.commandWaitMs({ expiresAt: 9e12 }, 1000)).toBe(315000);
    expect(helper.commandWaitMs({}, 1000)).toBe(315000);
    await expect(helper.connection({ VIBISUAL_BASE: 'http://127.0.0.1:1234', VIBISUAL_TOKEN: 'private' }, 'linux', root)).resolves.toEqual({ base: 'http://127.0.0.1:1234', token: 'private' });
    await expect(helper.connection({ VIBISUAL_BASE: 'https://example.com', VIBISUAL_TOKEN: 'private' }, 'linux', root)).rejects.toThrow('authenticated-loopback-required');
  });
  it('sends Unicode JSON files without shell quoting and identifies uncertain requests without exposing the token', async () => {
    const file = path.join(root, 'helper-send.mjs'); fs.writeFileSync(file, VIBI3D_NATIVE_HELPER);
    const helper = await import(/* @vite-ignore */ pathToFileURL(file).href) as {
      sendFile(auth: { base: string; token: string }, sessionId: string, file: string): Promise<unknown>;
    };
    const commandFile = path.join(root, '공백 명령.json');
    fs.writeFileSync(commandFile, '\uFEFF' + JSON.stringify({ commandId: 'stable-command', commands: [{ type: 'checkpoint', stage: 'first', label: '한글 간판' }] }));
    const fetch = vi.spyOn(globalThis, 'fetch');
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, snapshot: { revision: 7 } })))
      .mockImplementationOnce(async (_url, options) => {
        expect(JSON.parse(String(options?.body))).toMatchObject({ commandId: 'stable-command', expectedRevision: 7, commands: [{ label: '한글 간판' }] });
        throw new Error('lost-response');
      });
    const result = await helper.sendFile({ base: 'http://127.0.0.1:1234', token: 'secret-never-print' }, 'scene', commandFile).catch(error => String(error));
    expect(result).toContain('commandId=stable-command'); expect(result).toContain('sessionId=scene'); expect(result).not.toContain('secret-never-print');
  });
});
