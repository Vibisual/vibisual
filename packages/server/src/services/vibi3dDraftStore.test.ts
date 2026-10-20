import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CREATION_LIMITS, VIBI3D_DRAFT_LIMITS, isVibi3DDraftKey, type Vibi3DDraftSaveInput } from '@vibisual/shared';
import { CreationStore, type CreationHost } from './creationStore.js';
import { Vibi3DDraftStore } from './vibi3dDraftStore.js';

let root: string; let host: CreationHost; let creation: CreationStore; let store: Vibi3DDraftStore; let clock: number;
const localKey = 'local:12345678-1234-4234-8234-123456789abc';
const input = (overrides: Partial<Vibi3DDraftSaveInput> = {}): Vibi3DDraftSaveInput => ({ projectId: 'project', key: localKey,
  actor: 'human', requestId: 'save-1', expectedVersion: 0, fileName: 'New model', payload: { model: { objects: [{ id: 'mesh', color: 'white' }] } }, ...overrides });
const save = (overrides: Partial<Vibi3DDraftSaveInput> = {}) => store.save('project', { ...input(overrides) });
beforeEach(() => {
  // Keep injected filesystem-read hooks on the same path as the stores (/var ≠ /private/var).
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibi3d-drafts-'))); clock = Date.now();
  host = { resolveProjectPath: value => value === 'project' ? root : null,
    atomicWriteFile: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, data); fs.renameSync(`${file}.tmp`, file); },
    warn: vi.fn() };
  creation = new CreationStore(host, () => clock); store = new Vibi3DDraftStore(host, creation, () => clock);
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

describe('Vibi3D durable actor drafts', () => {
  it('rediscovers source-less work after a restart and never commits either actor to a source', async () => {
    const human = await save();
    const agent = await save({ actor: 'agent', payload: { generated: true } });
    const reopened = new Vibi3DDraftStore(host, new CreationStore(host));
    expect(reopened.read('project', localKey, 'human')).toEqual({ draft: human.draft, version: 1 });
    expect(reopened.read('project', localKey, 'agent')).toEqual({ draft: agent.draft, version: 1 });
    expect(reopened.list('project')).toMatchObject({ drafts: [{ key: localKey }, { key: localKey }], failed: [] });
    expect(creation.list('project')).toEqual([]);
  });
  it('replays lost replies without overwriting later edits and rejects changed reuse of the request id', async () => {
    await save(); await save({ expectedVersion: 1, requestId: 'save-2', payload: { newer: true } });
    expect(await save()).toMatchObject({ version: 2, savedVersion: 1, replayed: true, draft: { payload: { newer: true } } });
    await expect(save({ payload: { other: true } })).rejects.toThrow('request-id-reused');
    await expect(save({ requestId: 'save-3' })).rejects.toMatchObject({ status: 409, message: 'draft-version-conflict', detail: { version: 2 } });
  });
  it('uses a durable tombstone so stale background saves cannot resurrect an explicitly discarded actor', async () => {
    await save(); await save({ actor: 'agent' });
    const discard = { key: localKey, actor: 'human', expectedVersion: 1, requestId: 'discard-1' };
    expect(store.discard('project', discard)).toMatchObject({ draft: null, version: 2, savedVersion: 2 });
    expect(new Vibi3DDraftStore(host, creation).read('project', localKey, 'human')).toEqual({ draft: null, version: 2 });
    expect(store.read('project', localKey, 'agent').draft).not.toBeNull();
    expect(store.history('project', localKey, 'human')).toEqual([]);
    await expect(save({ expectedVersion: 1, requestId: 'late-save' })).rejects.toThrow('draft-version-conflict');
    expect(await save()).toMatchObject({ draft: null, version: 2, savedVersion: 1, replayed: true });
    await save({ expectedVersion: 2, requestId: 'new-human-work', payload: { new: true } });
    expect(store.discard('project', discard)).toMatchObject({ version: 3, savedVersion: 2, draft: { payload: { new: true } } });
  });
  it('compares again after asynchronous binary upload, preserving the winning edit across store instances', async () => {
    let resume!: (value: unknown) => void; let entered!: () => void;
    const pending = new Promise<void>(resolve => { entered = resolve; });
    const normal = creation.externalize.bind(creation);
    vi.spyOn(creation, 'externalize').mockImplementationOnce(async (_project, value) => {
      entered(); return new Promise<unknown>(resolve => { resume = () => resolve(value); });
    });
    const first = save(); await pending;
    const second = new Vibi3DDraftStore(host, new CreationStore(host), () => clock);
    await second.save('project', { ...input({ requestId: 'winner', payload: { winning: true } }) });
    resume(undefined); await expect(first).rejects.toThrow('draft-version-conflict');
    expect(store.read('project', localKey, 'human').draft?.payload).toEqual({ winning: true });
    vi.spyOn(creation, 'externalize').mockImplementation(normal);
  });
  it('preserves last successful content when pointer publication fails and retries the unpublished write safely', async () => {
    await save();
    const failedHost = { ...host, atomicWriteFile: (file: string, data: string) => {
      if (file.includes('vibi3d-drafts') && file.endsWith('state.json')) throw new Error('disk-full'); host.atomicWriteFile(file, data);
    } };
    const fail = new Vibi3DDraftStore(failedHost, creation);
    const second = input({ expectedVersion: 1, requestId: 'save-2', payload: { after: true } });
    await expect(fail.save('project', { ...second })).rejects.toThrow('disk-full');
    expect(store.read('project', localKey, 'human')).toMatchObject({ version: 1, draft: { payload: input().payload } });
    expect(await store.save('project', { ...second })).toMatchObject({ version: 2, draft: { payload: { after: true } } });
  });
  it('bounds history, keeps latest durable, and makes prior snapshots readable while retained', async () => {
    for (let revision = 1; revision <= VIBI3D_DRAFT_LIMITS.history + 2; revision++) {
      await save({ requestId: `save-${revision}`, expectedVersion: revision - 1, payload: { revision } });
    }
    const history = store.history('project', localKey, 'human');
    expect(history).toHaveLength(VIBI3D_DRAFT_LIMITS.history);
    expect(history[0]?.version).toBe(VIBI3D_DRAFT_LIMITS.history + 2);
    expect(() => store.revision('project', localKey, 'human', 1)).toThrow('draft-version-not-found');
    expect(store.revision('project', localKey, 'human', 3).payload).toEqual({ revision: 3 });
    const folders = fs.readdirSync(path.join(root, '.vibisual', 'vibi3d-drafts'));
    expect(fs.readdirSync(path.join(root, '.vibisual', 'vibi3d-drafts', folders[0]!))).toHaveLength(VIBI3D_DRAFT_LIMITS.history + 1);
  });
  it('keeps every retained draft texture alive through creation cleanup, then releases it on explicit discard', async () => {
    const texture = await creation.putBlob('project', { bytes: new Uint8Array([1, 2, 3, 4]), ext: 'png' });
    await save({ payload: { texture } });
    await save({ expectedVersion: 1, requestId: 'save-2', payload: { texture: null } });
    clock += CREATION_LIMITS.blobGraceMs + 60_000;
    expect((await creation.prune('project')).blobs).toBe(0);
    expect(store.revision('project', localKey, 'human', 1).payload).toEqual({ texture });
    store.discard('project', { key: localKey, actor: 'human', expectedVersion: 2, requestId: 'discard' });
    expect((await creation.prune('project')).blobs).toBe(1);
  });
  it('externalizes inline binary arrays before writing snapshots and retains the referenced blob', async () => {
    const saved = await save({ payload: { positions: Array.from({ length: 150 }, (_, index) => index + 0.5) } });
    expect(JSON.stringify(saved.draft?.payload)).toContain('vibi-blob:');
    clock += CREATION_LIMITS.blobGraceMs + 60_000;
    expect((await creation.prune('project')).blobs).toBe(0);
  });
  it('fails cleanup closed when a durable draft pin is unreadable', async () => {
    const texture = await creation.putBlob('project', { bytes: new Uint8Array([4, 5, 6]), ext: 'png' });
    await save({ payload: { texture } });
    const folder = path.join(root, '.vibisual', 'creation', '.artifacts');
    fs.writeFileSync(path.join(folder, fs.readdirSync(folder)[0]!), '{broken');
    clock += CREATION_LIMITS.blobGraceMs + 60_000;
    expect((await creation.prune('project')).blobs).toBe(0);
    expect(store.read('project', localKey, 'human').draft?.payload).toEqual({ texture });
    expect(host.warn).toHaveBeenCalled();
  });
  it('invalidates an in-flight cleanup when a source-less draft pins a previously unreferenced old blob', async () => {
    const texture = await creation.putBlob('project', { bytes: new Uint8Array([7, 8, 9]), ext: 'png' });
    const doc = creation.create('project', { appId: 'vibi3d', payload: {} }, 'user');
    clock += CREATION_LIMITS.blobGraceMs + 60_000;
    const original = fsp.readFile; let saved = false;
    vi.spyOn(fsp, 'readFile').mockImplementation((async (target: Parameters<typeof fsp.readFile>[0], options: Parameters<typeof fsp.readFile>[1]) => {
      const result = await original(target, options);
      if (!saved && String(target) === path.join(root, '.vibisual', 'creation', doc.id, 'revisions', '1.json')) {
        saved = true;
        const other = new Vibi3DDraftStore(host, new CreationStore(host, () => clock), () => clock);
        await other.save('project', { ...input({ payload: { texture } }) });
      }
      return result;
    }) as typeof fsp.readFile);
    const removed = await creation.prune('project');
    expect(saved).toBe(true);
    expect(removed.blobs).toBe(0);
    expect(store.read('project', localKey, 'human').draft?.payload).toEqual({ texture });
  });
  it('pins the original document revision and linked revisions without applying the draft', async () => {
    const doc = creation.create('project', { appId: 'vibi3d', payload: { original: true } }, 'user');
    const ref = creation.create('project', { appId: 'vibi3d', payload: {} }, 'user');
    await save({ key: `doc:${doc.id}`, documentId: doc.id, baseRevision: 1,
      links: [{ id: 'link', sourceId: ref.id, sourceRevision: 1, role: 'material', targets: [] }], payload: { proposed: true } });
    for (let revision = 1; revision <= 60; revision++) for (const id of [doc.id, ref.id]) {
      creation.commit('project', id, { baseRevision: revision, requestId: `edit-${revision}`, payload: { revision } }, 'user');
    }
    await creation.prune('project');
    expect(creation.revision('project', doc.id, 1).payload).toEqual({ original: true });
    expect(creation.revision('project', ref.id, 1).payload).toEqual({});
    expect(creation.get('project', doc.id).payload).toEqual({ revision: 60 });
  });
  it('reports damaged ledgers without hiding other drafts and refuses to reset the damaged version', async () => {
    await save(); await save({ actor: 'agent' });
    const directory = path.join(root, '.vibisual', 'vibi3d-drafts');
    const folder = fs.readdirSync(directory).find(name => JSON.parse(fs.readFileSync(path.join(directory, name, 'state.json'), 'utf8')).actor === 'human')!;
    fs.writeFileSync(path.join(directory, folder, 'state.json'), '{broken');
    expect(store.list('project')).toMatchObject({ drafts: [{ actor: 'agent' }], failed: [folder] });
    await expect(save()).rejects.toThrow('draft-unreadable');
  });
});

describe('draft storage boundary', () => {
  it('requires scoped project, actor, document identity, and safe portable file identity', async () => {
    expect(isVibi3DDraftKey('file:assets/model.glb')).toBe(true);
    for (const key of ['file:/root.glb', 'file:../outside', 'file:a/../outside', 'file:C:/outside', 'file:a\\outside', 'file:CON', 'doc:../x', 'local:not-uuid']) {
      expect(isVibi3DDraftKey(key)).toBe(false); await expect(save({ key })).rejects.toThrow('invalid-draft-identity');
    }
    await expect(store.save('missing', { ...input() })).rejects.toThrow('project-not-found');
    await expect(save({ key: 'doc:missing' })).rejects.toThrow('draft-source-mismatch');
    await expect(save({ payload: { texture: `vibi-blob:${'a'.repeat(64)}.png` } })).rejects.toThrow('blob-not-found');
  });
  it('rejects storage junctions even when they point to another place inside the project', async () => {
    const actual = path.join(root, 'redirected'); fs.mkdirSync(actual);
    fs.mkdirSync(path.join(root, '.vibisual'));
    fs.symlinkSync(actual, path.join(root, '.vibisual', 'vibi3d-drafts'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(save()).rejects.toThrow('outside-project');
    expect(fs.readdirSync(actual)).toEqual([]);
  });
});
