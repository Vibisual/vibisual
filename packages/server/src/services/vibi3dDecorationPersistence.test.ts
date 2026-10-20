import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creationValueAt, parseCreationBlobRef, validateVibi3DSignRecipe, validateVibi3DDecalRecipe, validateVibi3DMascotRecipe,
  type CreationValue, type Vibi3DSnapshot } from '@vibisual/shared';
import { CreationStore, type CreationHost } from './creationStore.js';
import { Vibi3DWorkflowStore } from './vibi3dWorkflowStore.js';

let root: string, host: CreationHost, creation: CreationStore, workflow: Vibi3DWorkflowStore;
const original = { format: 'vibi3d', version: 1, clips: [], scene: { object: { uuid: 'root', type: 'Group', children: [{ uuid: 'glass', type: 'Mesh' }] } } };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY2sAAAAASUVORK5CYII=';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibi3d-decoration-'));
  host = { resolveProjectPath: value => value === root ? root : null, atomicWriteFile: (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, value); fs.renameSync(`${file}.tmp`, file);
  } };
  creation = new CreationStore(host); workflow = new Vibi3DWorkflowStore(host, creation, process.platform);
});
afterEach(() => {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('vibi3d-decoration-')) throw new Error('unsafe-fixture-path');
  fs.rmSync(root, { recursive: true, force: true });
});

describe('native decoration persistence and source pins', () => {
  it('retains source-only blobs, baked artwork and recipes through intermediate reopen, candidate and acceptance', async () => {
    const image = creation.create(root, { appId: 'vibimage', payload: { name: 'fictional poster' } }, 'user');
    const doc = creation.create(root, { appId: 'vibi3d', payload: original }, 'user');
    const snapshot: Vibi3DSnapshot = { sessionId: 'scene', projectId: root, fileName: 'decorations', revision: 3,
      selectedId: null, nodes: [], document: { id: doc.id, revision: 1, dirty: false } };
    workflow.start(root, doc.id, snapshot, 'details');
    const ref = await creation.putBlob(root, { ext: 'svg', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0h1v1H0z"/></svg>') });
    const bakedRef = await creation.putBlob(root, { ext: 'png', bytes: new Uint8Array(Buffer.from(png.split(',')[1]!, 'base64')) });
    const sign = { kind: 'channel', text: '달빛 공방', font: 'serif', weight: 700, size: [3, 0.8, 0.12], lit: true, source: { kind: 'blob', ref } };
    const decal = { target: 'glass', position: [0, 1, 0], normal: [0, 0, 1], size: [0.4, 0.3], projection: 'surface', source: { kind: 'vibimage', docId: image.id } };
    const mascot = { style: 'standee', height: 1.6, source: { kind: 'blob', ref } };
    const children = [{ uuid: 'glass', type: 'Mesh', children: [{ uuid: 'sticker', type: 'Mesh', userData: { vibi3dDecalRecipe: decal } }] },
      { uuid: 'sign', type: 'Group', userData: { vibi3dSignRecipe: sign } }, { uuid: 'mascot', type: 'Group', userData: { vibi3dMascotRecipe: mascot } }];
    const payload = { ...original, scene: { object: { uuid: 'root', type: 'Group', children }, images: [{ uuid: 'baked-sign', url: bakedRef }] } };
    const links = [{ id: 'sticker-image', sourceId: image.id, sourceRevision: 1, role: 'model-texture', targets: ['sticker'] }];
    const checkpoint = await workflow.save(root, doc.id, 'details', 'stage', snapshot, { type: 'checkpoint', stage: 'signs', label: 'Fictional signs' }, payload, links);
    expect(checkpoint.stage.mode).toBe('intermediate'); expect(creation.get(root, doc.id).payload).toEqual(original);
    const reopened = new Vibi3DWorkflowStore(host, new CreationStore(host), process.platform);
    const resumed = reopened.resume(root, doc.id, 'details', snapshot);
    expect(resumed.links).toEqual(links);
    expect(validateVibi3DSignRecipe(creationValueAt(resumed.payload, '/scene/object/children/@sign/userData/vibi3dSignRecipe'))).toEqual(sign);
    expect(validateVibi3DDecalRecipe(creationValueAt(resumed.payload, '/scene/object/children/@glass/children/@sticker/userData/vibi3dDecalRecipe'))).toEqual(decal);
    expect(validateVibi3DMascotRecipe(creationValueAt(resumed.payload, '/scene/object/children/@mascot/userData/vibi3dMascotRecipe'))).toEqual(mascot);
    const baked = parseCreationBlobRef(creationValueAt(resumed.payload, '/scene/images/@baked-sign/url'))!;
    for (const name of [parseCreationBlobRef(ref)!.name, baked.name]) fs.utimesSync(creation.blobPath(root, name), new Date(0), new Date(0));
    await creation.prune(root);
    expect(fs.existsSync(creation.blobPath(root, parseCreationBlobRef(ref)!.name))).toBe(true);
    expect(fs.existsSync(creation.blobPath(root, baked.name))).toBe(true);
    creation.commit(root, image.id, { baseRevision: 1, requestId: 'new-art', payload: { name: 'human revision' } }, 'user');
    await expect(reopened.save(root, doc.id, 'details', 'advance-pin', snapshot, { type: 'checkpoint', stage: 'signs', label: 'Changed' }, resumed.payload,
      [{ ...links[0], id: 'renamed-link', sourceRevision: 2 }])).rejects.toThrow('user-decision-required');
    const candidate = await reopened.save(root, doc.id, 'details', 'candidate', snapshot, { type: 'propose', label: 'Final signs' }, resumed.payload, links);
    const accepted = creation.accept(root, doc.id, candidate.stage.candidateId!, { baseRevision: 1, requestId: 'accept' });
    expect(accepted.payload).toEqual(resumed.payload); expect(accepted.links).toEqual(links);
  });

  it('rejects missing decoration blob references without writing a revision or stage', async () => {
    const doc = creation.create(root, { appId: 'vibi3d', payload: original }, 'user');
    const snapshot: Vibi3DSnapshot = { sessionId: 'scene', projectId: root, fileName: 'scene', revision: 0, selectedId: null, nodes: [], document: { id: doc.id, revision: 1, dirty: false } };
    workflow.start(root, doc.id, snapshot, 'missing');
    const payload: CreationValue = { ...original, source: { kind: 'blob', ref: `vibi-blob:${'f'.repeat(64)}.png` } };
    await expect(workflow.save(root, doc.id, 'missing', 'save', snapshot, { type: 'checkpoint', stage: 'signs', label: 'Signs' }, payload)).rejects.toThrow('blob-not-found');
    expect(creation.get(root, doc.id).revision).toBe(1); expect(workflow.read(root, doc.id, 'missing')!.stages).toHaveLength(0);
  });
});
