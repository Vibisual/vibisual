import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creationValueAt, parseCreationBlobRef, type CreationLink, type Vibi3DSnapshot } from '@vibisual/shared';
import { CreationStore, type CreationHost } from './creationStore.js';
import { Vibi3DWorkflowStore } from './vibi3dWorkflowStore.js';

let root: string; let host: CreationHost; let store: CreationStore; let workflow: Vibi3DWorkflowStore;
const filled = { format: 'vibi3d', version: 1, scene: { object: { uuid: 'root', type: 'Group', children: [{ uuid: 'wall', type: 'Mesh' }] } } };
const link = (sourceId: string, sourceRevision = 1, id = 'surface', targets = ['wall']): CreationLink => ({ id, sourceId, sourceRevision, role: 'model-texture', targets });
const scene = (id: string): Vibi3DSnapshot => ({ sessionId: 'session', projectId: root, fileName: 'model', revision: 1, selectedId: null,
  nodes: [], document: { id, revision: 1, dirty: false } });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'creation-candidate-links-'));
  host = { resolveProjectPath: id => id === root ? root : null, atomicWriteFile: (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, data); fs.renameSync(`${file}.tmp`, file);
  } };
  store = new CreationStore(host); workflow = new Vibi3DWorkflowStore(host, store, process.platform);
});
afterEach(() => {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(root).startsWith('creation-candidate-links-')) throw new Error('unsafe-fixture-path');
  fs.rmSync(root, { recursive: true, force: true });
});

describe('candidate reference transactions', () => {
  it('preserves blob material recipes and candidate links until the user accepts both', async () => {
    const image = store.create(root, { appId: 'vibimage', payload: { text: 'Fictional shop' } }, 'user');
    const base = store.create(root, { appId: 'vibi3d', payload: filled }, 'user');
    const ref = await store.putBlob(root, { bytes: new Uint8Array(3000).fill(7), ext: 'png' });
    const material = { preset: 'painted-concrete', maps: { map: { source: { kind: 'blob', ref } }, emissiveMap: { source: { kind: 'vibimage', docId: image.id } } } };
    const payload = await store.externalize(root, { ...filled, material, images: [{ uuid: 'image', url: ref }] });
    const input = { baseRevision: 1, requestId: 'materials', payload, links: [link(image.id)] };
    store.propose(root, base.id, input);
    expect(store.get(root, base.id).links).toEqual([]);
    expect(store.propose(root, base.id, input).id).toBe('materials');
    const reopened = new CreationStore(host);
    const candidate = reopened.candidate(root, base.id, 'materials');
    expect(candidate.links).toEqual(input.links);
    expect(creationValueAt(candidate.payload, '/material')).toEqual(material);
    expect(parseCreationBlobRef(creationValueAt(candidate.payload, '/images/@image/url'))?.ext).toBe('png');
    const accepted = reopened.accept(root, base.id, 'materials', { baseRevision: 1, requestId: 'take' });
    expect(accepted.links).toEqual(input.links); expect(accepted.payload).toEqual(candidate.payload);
    reopened.propose(root, base.id, { baseRevision: 2, requestId: 'legacy', payload: filled });
    expect(reopened.candidate(root, base.id, 'legacy').links).toBeUndefined();
    expect(reopened.accept(root, base.id, 'legacy', { baseRevision: 2, requestId: 'take-legacy' }).links).toEqual(input.links);
  });

  it('rejects automatic existing-reference advancement, missing revisions and changed retry bodies', () => {
    const image = store.create(root, { appId: 'vibimage', payload: {} }, 'user');
    store.commit(root, image.id, { baseRevision: 1, requestId: 'image-2', payload: { revision: 2 } }, 'user');
    const base = store.create(root, { appId: 'vibi3d', payload: filled, links: [link(image.id)] }, 'user');
    expect(() => store.propose(root, base.id, { baseRevision: 1, requestId: 'advance', payload: filled, links: [link(image.id, 2)] })).toThrow('user-decision-required');
    expect(() => store.propose(root, base.id, { baseRevision: 1, requestId: 'missing', payload: filled, links: [link(image.id, 99, 'new')] })).toThrow('invalid-link');
    store.propose(root, base.id, { baseRevision: 1, requestId: 'move', payload: filled, links: [link(image.id, 1, 'surface', ['other'])] });
    expect(() => store.propose(root, base.id, { baseRevision: 1, requestId: 'move', payload: filled, links: [link(image.id)] })).toThrow('request-id-reused');
  });

  it('rebases independent new links over a user reference update and rejects overlapping target edits', () => {
    const image = store.create(root, { appId: 'vibimage', payload: {} }, 'user');
    const second = store.create(root, { appId: 'vibimage', payload: { name: 'second' } }, 'user');
    store.commit(root, image.id, { baseRevision: 1, requestId: 'image-2', payload: { revision: 2 } }, 'user');
    const base = store.create(root, { appId: 'vibi3d', payload: { ...filled, note: 'old' }, links: [link(image.id)] }, 'user');
    store.propose(root, base.id, { baseRevision: 1, requestId: 'new-link', payload: { ...filled, note: 'old', ai: true }, links: [link(image.id), link(second.id, 1, 'second', ['other'])] });
    store.commit(root, base.id, { baseRevision: 1, requestId: 'user', payload: { ...filled, note: 'human' }, links: [link(image.id, 2)] }, 'user');
    store.rebase(root, base.id, 'new-link', { requestId: 'moved' });
    const candidate = store.candidate(root, base.id, 'moved');
    expect(candidate.links).toEqual([link(image.id, 2), link(second.id, 1, 'second', ['other'])]);
    expect(creationValueAt(candidate.payload, '/note')).toBe('human');
    store.accept(root, base.id, 'moved', { baseRevision: 2, requestId: 'take' });
    store.propose(root, base.id, { baseRevision: 3, requestId: 'target-ai', payload: candidate.payload, links: [link(image.id, 2, 'surface', ['ai'])] });
    store.commit(root, base.id, { baseRevision: 3, requestId: 'target-user', links: [link(image.id, 2, 'surface', ['human'])] }, 'user');
    expect(() => store.rebase(root, base.id, 'target-ai', { requestId: 'target-rebase' })).toThrow('candidate-overlap');
  });

  it('protects revisions referenced only by pending candidates or intermediate app artifacts from cleanup', async () => {
    const image = store.create(root, { appId: 'vibimage', payload: {} }, 'user');
    const artifactImage = store.create(root, { appId: 'vibimage', payload: { artifact: true } }, 'user');
    const model = store.create(root, { appId: 'vibi3d', payload: filled }, 'user');
    store.propose(root, model.id, { baseRevision: 1, requestId: 'pin', payload: filled, links: [link(image.id)] });
    store.retainArtifactBlobs(root, model.id, 'artifact', filled, [link(artifactImage.id, 1, 'artifact-link')]);
    for (const document of [image, artifactImage]) for (let index = 1; index <= 45; index++) {
      store.commit(root, document.id, { baseRevision: index, requestId: `r-${index}`, payload: { index } }, 'user');
    }
    await store.prune(root);
    expect(store.revision(root, image.id, 1).revision).toBe(1);
    expect(store.revision(root, artifactImage.id, 1).revision).toBe(1);
    expect(store.candidate(root, model.id, 'pin').links).toEqual([link(image.id)]);
  });
});

describe('native workflow link ownership', () => {
  it('guards group source revisions through save and resume even when a draft ungroups its children', async () => {
    const image = store.create(root, { appId: 'vibimage', payload: {} }, 'user');
    store.commit(root, image.id, { baseRevision: 1, requestId: 'image-2', payload: { revision: 2 } }, 'user');
    const wall = { uuid: 'uuid-wall', userData: { vibi3dId: 'wall' }, type: 'Mesh' };
    const group = { uuid: 'uuid-group', userData: { vibi3dId: 'group' }, type: 'Group', children: [wall] };
    const grouped = { ...filled, scene: { object: { uuid: 'root', type: 'Group', children: [group] } } };
    const base = store.create(root, { appId: 'vibi3d', payload: grouped }, 'user');
    const view = scene(base.id); workflow.start(root, base.id, view, 'run');
    const command = { type: 'checkpoint' as const, stage: 'group', label: 'Group' };
    await workflow.save(root, base.id, 'run', 'group-map', view, command, grouped, [link(image.id, 1, 'group-map', ['group'])]);
    const ungrouped = { ...filled, scene: { object: { uuid: 'root', type: 'Group', children: [wall] } } };
    await expect(workflow.save(root, base.id, 'run', 'child-map', view, command, ungrouped, [link(image.id, 2, 'new-id')])).rejects.toThrow('user-decision-required');
    expect(workflow.resume(root, base.id, 'run', view).links).toEqual([link(image.id, 1, 'group-map', ['group'])]);
  });

  it('resumes draft links, blocks revision advancement under new IDs, and proposes linked payload atomically', async () => {
    const image = store.create(root, { appId: 'vibimage', payload: {} }, 'user');
    store.commit(root, image.id, { baseRevision: 1, requestId: 'image-2', payload: { revision: 2 } }, 'user');
    const base = store.create(root, { appId: 'vibi3d', payload: filled }, 'user');
    const view = scene(base.id); workflow.start(root, base.id, view, 'run');
    const command = { type: 'checkpoint' as const, stage: 'sign', label: 'Sign' };
    await workflow.save(root, base.id, 'run', 'draft', view, command, filled, [link(image.id)]);
    expect(store.get(root, base.id).links).toEqual([]);
    expect(workflow.resume(root, base.id, 'run', view).links).toEqual([link(image.id)]);
    await expect(workflow.save(root, base.id, 'run', 'advance', view, command, filled, [link(image.id, 2, 'new-id')])).rejects.toThrow('user-decision-required');
    const proposed = await workflow.save(root, base.id, 'run', 'final', view, { type: 'propose', label: 'Final' }, filled, [link(image.id)]);
    expect(store.candidate(root, base.id, proposed.candidate!.id).links).toEqual([link(image.id)]);
    expect(store.get(root, base.id).links).toEqual([]);
  });

  it('loads old raw-payload stage files with the document reference set and guards existing source links', async () => {
    const image = store.create(root, { appId: 'vibimage', payload: {} }, 'user');
    store.commit(root, image.id, { baseRevision: 1, requestId: 'image-2', payload: { revision: 2 } }, 'user');
    const base = store.create(root, { appId: 'vibi3d', payload: filled, links: [link(image.id)] }, 'user');
    const view = scene(base.id); workflow.start(root, base.id, view, 'run');
    const command = { type: 'checkpoint' as const, stage: 'legacy', label: 'Legacy' };
    await expect(workflow.save(root, base.id, 'run', 'advance', view, command, filled, [link(image.id, 2, 'new-id')])).rejects.toThrow('user-decision-required');
    const result = await workflow.save(root, base.id, 'run', 'saved', view, command, filled);
    fs.writeFileSync(path.join(root, result.stage.sourcePath), JSON.stringify(filled));
    expect(workflow.resume(root, base.id, 'run', view)).toMatchObject({ payload: filled, links: [link(image.id)] });
  });
});
