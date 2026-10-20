import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creationValueAt, validateVibi3DCameraView, validateVibi3DShots, type CreationValue, type Vibi3DSnapshot } from '@vibisual/shared';
import { CreationStore, type CreationHost } from './creationStore.js';
import { Vibi3DWorkflowStore } from './vibi3dWorkflowStore.js';

let root: string, host: CreationHost, store: CreationStore, workflow: Vibi3DWorkflowStore;
const legacy = { position: [3, 1.6, 8], target: [0, 2, 0] };
const base: CreationValue = { format: 'vibi3d', version: 1, clips: [], scene: { object: { uuid: 'root', type: 'Group',
  userData: { vibi3dCamera: legacy }, children: [{ uuid: 'building', type: 'Mesh' }] } } };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi3d-camera-'));
  host = { resolveProjectPath: value => value === root ? root : null, atomicWriteFile: (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, value); fs.renameSync(`${file}.tmp`, file);
  } };
  store = new CreationStore(host); workflow = new Vibi3DWorkflowStore(host, store, process.platform);
});
afterEach(() => {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('vibi3d-camera-')) throw new Error('unsafe-fixture-path');
  fs.rmSync(root, { recursive: true, force: true });
});
function snapshot(id: string): Vibi3DSnapshot {
  return { sessionId: 'scene', projectId: root, fileName: 'shots', revision: 4, selectedId: null, nodes: [], document: { id, revision: 1, dirty: false } };
}

describe('saved camera and named-shot source fidelity', () => {
  it('round-trips legacy optics, three portrait shots, active shot and camera motion through workflow and candidate acceptance', async () => {
    const doc = store.create(root, { appId: 'vibi3d', payload: base }, 'user');
    expect(creationValueAt(new CreationStore(host).get(root, doc.id).payload, '/scene/object/userData/vibi3dCamera')).toEqual(legacy);
    const view = snapshot(doc.id); workflow.start(root, doc.id, view, 'shoot');
    const shots = ['whole', 'shop', 'corner'].map((id, index) => ({ id, name: `${id} portrait`, position: [index + 1, 1.6, 8], target: [0, 2, 0], lens: 24 + index * 4, aspect: '9:16' }));
    const camera = { position: [3, 1.6, 8], target: [0, 2, 0], lens: 32, aspect: '9:16' };
    const look = { preset: 'daylight', exposure: 1.1 };
    const clips = [{ name: 'walk-by', tracks: [{ name: 'camera.position', times: [0, 2], values: [3, 1.6, 8, 4, 1.6, 7] }] }];
    const payload = { format: 'vibi3d', version: 1, clips, scene: { object: { uuid: 'root', type: 'Group', userData: {
      vibi3dCamera: camera, vibi3dShots: shots, vibi3dActiveShotId: 'corner', vibi3dLook: look,
    }, children: [{ uuid: 'building', type: 'Mesh' }, { uuid: 'camera', type: 'PerspectiveCamera', fov: 35, userData: { vibi3dViewCamera: true } }] } } };
    await workflow.save(root, doc.id, 'shoot', 'stage', view, { type: 'checkpoint', stage: 'look-shots', label: 'Three portrait shots' }, payload);
    const reopened = new Vibi3DWorkflowStore(host, new CreationStore(host), process.platform), resumed = reopened.resume(root, doc.id, 'shoot', view);
    expect(validateVibi3DCameraView(creationValueAt(resumed.payload, '/scene/object/userData/vibi3dCamera'))).toEqual(camera);
    expect(validateVibi3DShots(creationValueAt(resumed.payload, '/scene/object/userData/vibi3dShots'))).toEqual(shots);
    expect(creationValueAt(resumed.payload, '/scene/object/userData/vibi3dActiveShotId')).toBe('corner');
    expect(creationValueAt(resumed.payload, '/scene/object/userData/vibi3dLook')).toEqual(look);
    expect(creationValueAt(resumed.payload, '/clips')).toEqual(clips);
    const candidate = await reopened.save(root, doc.id, 'shoot', 'candidate', view, { type: 'propose', label: 'Portrait shots' }, resumed.payload);
    expect(store.get(root, doc.id).payload).toEqual(base);
    const accepted = store.accept(root, doc.id, candidate.stage.candidateId!, { baseRevision: 1, requestId: 'accept' });
    expect(accepted.payload).toEqual(payload);
  });

  it('preserves locked saved views and rejects stale shot writes after a human revision', async () => {
    const pointer = '/scene/object/userData/vibi3dCamera';
    const doc = store.create(root, { appId: 'vibi3d', payload: base, lockedPaths: [pointer] }, 'user');
    const view = snapshot(doc.id); workflow.start(root, doc.id, view, 'locked');
    const changed = { format: 'vibi3d', version: 1, clips: [], scene: { object: { uuid: 'root', type: 'Group', userData: { vibi3dCamera: { ...legacy, lens: 24 } } } } };
    await expect(workflow.save(root, doc.id, 'locked', 'save', view, { type: 'checkpoint', stage: 'shots', label: 'Shots' }, changed)).rejects.toThrow('locked-element-changed');
    store.commit(root, doc.id, { baseRevision: 1, requestId: 'human', payload: { ...base as object, note: 'human change' } }, 'user');
    await expect(workflow.save(root, doc.id, 'locked', 'stale', view, { type: 'checkpoint', stage: 'shots', label: 'Shots' }, base)).rejects.toThrow('revision-conflict');
  });
});
