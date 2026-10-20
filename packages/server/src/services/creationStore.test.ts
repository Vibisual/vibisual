import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CREATION_LIMITS, checkCreationRequirements, creationValueAt, parseCreationBlobRef, type CreationValue } from '@vibisual/shared';
import { CreationStore, type CreationHost } from './creationStore.js';

let root: string;
let host: CreationHost;
let store: CreationStore;
let clock: number;
const writes: string[] = [];
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'creation-source-'));
  clock = Date.now();
  writes.length = 0;
  host = {
    resolveProjectPath: value => value === 'project' ? root : value === 'gone' ? path.join(root, 'missing-folder') : null,
    atomicWriteFile: (file, data) => {
      writes.push(file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, data); fs.renameSync(`${file}.tmp`, file);
    },
    warn: vi.fn(),
  };
  store = new CreationStore(host, () => clock);
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
const source = () => store.create('project', { appId: 'model', title: 'Product', payload: { parts: [{ id: 'bottle', color: 'white' }, { id: 'cap', color: 'silver' }] } }, 'user');
const commit = (id: string, baseRevision: number, payload: CreationValue, requestId = 'request-1') => store.commit('project', id, { baseRevision, requestId, payload }, 'agent');
const docDir = (id: string) => path.join(root, '.vibisual/creation', id);
const link = (sourceId: string, sourceRevision: number, id = 'product') => ({ id, sourceId, sourceRevision, role: 'product', targets: ['layer-product'] });

describe('editable creation source — kept skeleton', () => {
  it('retries a lost initial response without duplicating the source or moving it back after later edits', () => {
    const input = { requestId: 'create-1', appId: 'vibimage', title: 'Poster', payload: { text: 'Original' } };
    const first = store.create('project', input, 'user');
    expect(store.create('project', input, 'user').id).toBe(first.id);
    commit(first.id, 1, { text: 'Edited' });
    expect(new CreationStore(host).create('project', input, 'user').revision).toBe(2);
    expect(store.list('project')).toHaveLength(1);
    expect(() => store.create('project', { ...input, title: 'Other' }, 'user')).toThrow('request-id-reused');
    expect(store.create('project', { ...input, requestId: 'copy-1' }, 'user').id).not.toBe(first.id);
  });
  it('saves, reopens, and atomically rejects a stale AI result after a human edit', () => {
    const first = source();
    const edited = store.commit('project', first.id, { baseRevision: 1, requestId: 'human', payload: { parts: [{ id: 'bottle', color: 'blue' }] } }, 'user');
    expect(() => commit(first.id, 1, { parts: [{ id: 'bottle', color: 'white' }] })).toThrow('revision-conflict');
    const reopened = new CreationStore(host).get('project', first.id);
    expect(reopened.payload).toEqual(edited.payload);
    expect(reopened.revision).toBe(2);
    expect(store.revision('project', first.id, 1).payload).toEqual(first.payload);
  });
  it('deduplicates retries, refuses a reused key with different input, and keeps the current state on old retry', () => {
    const first = source();
    commit(first.id, 1, { value: 2 });
    expect(commit(first.id, 1, { value: 2 }).revision).toBe(2);
    commit(first.id, 2, { value: 3 }, 'request-2');
    expect(commit(first.id, 1, { value: 2 }).revision).toBe(3);
    expect(() => commit(first.id, 1, { value: 999 })).toThrow('request-id-reused');
    expect(store.history('project', first.id)).toHaveLength(3);
  });
  it('publishes the pointer last: a failed state write keeps the last good source and never reuses the orphan revision', () => {
    const first = source();
    const failing = new CreationStore({ ...host, atomicWriteFile: (file, data) => { if (file.endsWith('state.json')) throw new Error('disk full'); host.atomicWriteFile(file, data); } });
    expect(() => failing.commit('project', first.id, { baseRevision: 1, requestId: 'attempt', payload: { failed: true } }, 'user')).toThrow('disk full');
    expect(store.get('project', first.id).revision).toBe(1);
    expect(commit(first.id, 1, { resumed: true }).revision).toBe(3);
    expect(store.history('project', first.id).map(doc => doc.revision)).toEqual([3, 1]);
    expect(() => store.revision('project', first.id, 2)).toThrow('revision-not-found');
    expect(JSON.parse(fs.readFileSync(path.join(docDir(first.id), 'revisions/2.json'), 'utf8')).payload).toEqual({ failed: true });
  });
  it('keeps state.json small: the payload lives only in the immutable revision', () => {
    const first = source();
    commit(first.id, 1, { big: 'x'.repeat(50_000) });
    expect(fs.statSync(path.join(docDir(first.id), 'state.json')).size).toBeLessThan(5_000);
    expect(fs.statSync(path.join(docDir(first.id), 'previous.json')).size).toBeLessThan(5_000);
    expect(store.head('project', first.id)).toMatchObject({ revision: 2, pendingCandidates: 0 });
  });
});

describe('history labels are codes, not English text', () => {
  it('records the operation and the restored revision; the caller label stays free text', () => {
    const first = source();
    expect(first).toMatchObject({ operation: 'create', label: '' });
    commit(first.id, 1, { value: 2 });
    const undo = store.restore('project', first.id, { baseRevision: 2, requestId: 'undo-1' }, 'undo', 'user');
    expect(undo).toMatchObject({ payload: first.payload, revision: 3, canRedo: true, operation: 'undo', restoredFrom: 1, label: '' });
    const redo = new CreationStore(host).restore('project', first.id, { baseRevision: 3, requestId: 'redo-1' }, 'redo', 'user');
    expect(redo).toMatchObject({ payload: { value: 2 }, revision: 4, operation: 'redo', restoredFrom: 2 });
    expect(JSON.stringify(store.history('project', first.id))).not.toMatch(/Created|Edited|undo: /);
  });
});

describe('locks and user decisions', () => {
  it('preserves locked objects across reorder, allows explicit user unlock, and refuses AI unlock', () => {
    const first = source();
    const locked = store.commit('project', first.id, { baseRevision: 1, requestId: 'lock', lockedPaths: ['/parts/@bottle'] }, 'user');
    expect(() => store.commit('project', first.id, { baseRevision: 2, requestId: 'unlock', lockedPaths: [] }, 'agent')).toThrow('user-locks-only');
    const next = commit(first.id, locked.revision, { parts: [{ id: 'cap', color: 'gold' }, { id: 'bottle', color: 'white' }] });
    expect(() => commit(first.id, next.revision, { parts: [{ id: 'bottle', color: 'black' }] }, 'damage')).toThrow('locked-element-changed');
    expect(store.commit('project', first.id, { baseRevision: next.revision, requestId: 'user-unlock', lockedPaths: [], payload: { parts: [] } }, 'user').lockedPaths).toEqual([]);
  });
  it('locks Three JSON nodes by uuid as well as id', () => {
    const doc = store.create('project', { appId: 'model', payload: { scene: { object: { uuid: 'root', children: [{ uuid: 'body', color: 1 }, { uuid: 'cap', color: 2 }] } } },
      lockedPaths: ['/scene/object/children/@body'] }, 'user');
    expect(creationValueAt(doc.payload, '/scene/object/children/@body/color')).toBe(1);
    const moved = { scene: { object: { uuid: 'root', children: [{ uuid: 'cap', color: 9 }, { uuid: 'body', color: 1 }] } } };
    expect(commit(doc.id, 1, moved).revision).toBe(2);
    expect(() => commit(doc.id, 2, { scene: { object: { uuid: 'root', children: [{ uuid: 'body', color: 5 }] } } }, 'r2')).toThrow('locked-element-changed');
  });
  it('lets the agent add references but not move an existing reference to another revision', () => {
    const model = source();
    commit(model.id, 1, { cap: 'gold' });
    const image = store.create('project', { appId: 'image', payload: {}, links: [link(model.id, 1)] }, 'user');
    expect(() => store.commit('project', image.id, { baseRevision: 1, requestId: 'agent-advance', links: [link(model.id, 2)] }, 'agent'))
      .toThrow('user-decision-required');
    const added = store.commit('project', image.id, { baseRevision: 1, requestId: 'agent-add', links: [link(model.id, 1), link(model.id, 2, 'second')] }, 'agent');
    expect(added.links.map(l => l.id)).toEqual(['product', 'second']);
    expect(store.commit('project', image.id, { baseRevision: 2, requestId: 'user-advance', links: [link(model.id, 2), link(model.id, 2, 'second')] }, 'user').links[0]?.sourceRevision).toBe(2);
  });
});

describe('keep current version (decision in the ledger, no new revision)', () => {
  it('records, shows, notifies again after a newer source revision, and can be undone', () => {
    const model = source();
    const image = store.create('project', { appId: 'image', payload: { caption: 'x' }, links: [link(model.id, 1)] }, 'user');
    commit(model.id, 1, { cap: 'gold' });
    const kept = store.decide('project', image.id, 'product', 2);
    expect(kept.revision).toBe(1);
    expect(kept.links[0]).toMatchObject({ sourceRevision: 1, keptRevision: 2 });
    expect(store.impacts('project', model.id)[0]).toMatchObject({ docId: image.id, keptRevision: 2, latestRevision: 2 });
    commit(model.id, 2, { cap: 'rose' }, 'request-2');
    const reread = store.get('project', image.id);
    expect(reread.links[0]?.keptRevision).toBe(2);
    expect(store.impacts('project', model.id)[0]).toMatchObject({ latestRevision: 3, keptRevision: 2 });
    expect(() => store.decide('project', image.id, 'product', 9)).toThrow('invalid-revision');
    expect(store.decide('project', image.id, 'product', null).links[0]?.keptRevision).toBeUndefined();
    expect(store.get('project', image.id).revision).toBe(1);
  });
  it('drops the decision when the reference itself moves', () => {
    const model = source();
    const image = store.create('project', { appId: 'image', payload: {}, links: [link(model.id, 1)] }, 'user');
    commit(model.id, 1, { cap: 'gold' });
    store.decide('project', image.id, 'product', 2);
    const updated = store.commit('project', image.id, { baseRevision: 1, requestId: 'update', links: [link(model.id, 2)] }, 'user');
    expect(updated.links[0]).toEqual(link(model.id, 2));
  });
  it('ignores the retired policy field and never stores keptRevision from a commit', () => {
    const model = source();
    const image = store.create('project', { appId: 'image', payload: {}, links: [{ ...link(model.id, 1), policy: 'update-available', keptRevision: 1 }] }, 'agent');
    expect(image.links[0]).toEqual(link(model.id, 1));
    const stored = JSON.parse(fs.readFileSync(path.join(docDir(image.id), 'revisions/1.json'), 'utf8'));
    expect(stored.links[0]).not.toHaveProperty('policy');
  });
});

describe('candidates', () => {
  it('keeps a candidate after conflict and cannot accept it over newer human work', () => {
    const first = source();
    const candidate = store.propose('project', first.id, { baseRevision: 1, requestId: 'proposal', payload: { draft: 'gold cap' }, input: 'change only the cap' });
    expect(new CreationStore(host).candidates('project', first.id)[0]?.input).toBe('change only the cap');
    commit(first.id, 1, { human: 'bottle changed' });
    expect(() => store.accept('project', first.id, candidate.id, { baseRevision: 2, requestId: 'accept' })).toThrow('candidate-conflict');
    expect(store.get('project', first.id).payload).toEqual({ human: 'bottle changed' });
    expect(store.candidates('project', first.id)[0]?.status).toBe('pending');
  });
  it('refuses a proposal built on an older revision, but replays the same request id', () => {
    const first = source();
    const proposal = { baseRevision: 1, requestId: 'proposal', payload: { cap: 'gold' } };
    store.propose('project', first.id, proposal);
    commit(first.id, 1, { human: true });
    expect(store.propose('project', first.id, proposal).id).toBe('proposal');
    let error: unknown;
    try { store.propose('project', first.id, { ...proposal, requestId: 'late' }); } catch (failure) { error = failure; }
    expect(error).toMatchObject({ status: 409, message: 'stale-base', detail: { currentRevision: 2 } });
  });
  it('refuses a proposal that changes a locked part when it is proposed (not only at acceptance), and says which', () => {
    const first = source();
    store.commit('project', first.id, { baseRevision: 1, requestId: 'lock', lockedPaths: ['/parts/@bottle'] }, 'user');
    let error: unknown;
    try {
      store.propose('project', first.id, { baseRevision: 2, requestId: 'touch-bottle', payload: { parts: [{ id: 'bottle', color: 'gold' }, { id: 'cap', color: 'silver' }] } });
    } catch (failure) { error = failure; }
    expect(error).toMatchObject({ status: 409, message: 'locked-element-changed', detail: { pointer: '/parts/@bottle' } });
    expect(store.candidates('project', first.id)).toEqual([]);
    // The cap is free; reordering does not count as touching the locked bottle.
    const ok = store.propose('project', first.id, { baseRevision: 2, requestId: 'cap-only', payload: { parts: [{ id: 'cap', color: 'gold' }, { id: 'bottle', color: 'white' }] } });
    expect(ok.status).toBe('pending');
  });
  it('accepts a current candidate once, survives reopen and permits safe network retry', () => {
    const first = source();
    store.propose('project', first.id, { baseRevision: 1, requestId: 'proposal', payload: { cap: 'gold' } });
    expect(store.accept('project', first.id, 'proposal', { baseRevision: 1, requestId: 'accept' })).toMatchObject({ revision: 2, operation: 'accept' });
    const reopened = new CreationStore(host);
    expect(reopened.candidates('project', first.id)[0]?.status).toBe('accepted');
    expect(reopened.accept('project', first.id, 'proposal', { baseRevision: 1, requestId: 'accept' }).revision).toBe(2);
  });
  it('lists summaries without payload and reads the body only on request', () => {
    const first = source();
    store.propose('project', first.id, { baseRevision: 1, requestId: 'p1', payload: { cap: 'gold' }, label: 'Gold' });
    const [summary] = store.candidates('project', first.id);
    expect(summary).not.toHaveProperty('payload');
    expect(store.candidate('project', first.id, 'p1').payload).toEqual({ cap: 'gold' });
    expect(store.head('project', first.id)).toMatchObject({ pendingCandidates: 1, candidateStamp: 1 });
  });
  it('tells the agent why at the pending limit', () => {
    const first = source();
    for (let i = 0; i < CREATION_LIMITS.candidates; i += 1) store.propose('project', first.id, { baseRevision: 1, requestId: `p${i}`, payload: { n: i } });
    let error: unknown;
    try { store.propose('project', first.id, { baseRevision: 1, requestId: 'one-more', payload: { n: -1 } }); } catch (failure) { error = failure; }
    expect(error).toMatchObject({ status: 409, message: 'candidate-limit', detail: { limit: 100, pending: 100 } });
    expect(String((error as { detail: { reason: string } }).detail.reason)).toMatch(/discard|clean up/);
    expect(store.discardPending('project', first.id, 'all')).toBe(100);
    expect(store.propose('project', first.id, { baseRevision: 1, requestId: 'one-more', payload: { n: -1 } }).status).toBe('pending');
  });
  it('discards one, or every stale candidate at once', () => {
    const first = source();
    store.propose('project', first.id, { baseRevision: 1, requestId: 'old', payload: { a: 1 } });
    commit(first.id, 1, { b: 1 });
    store.propose('project', first.id, { baseRevision: 2, requestId: 'fresh', payload: { c: 1 } });
    expect(store.discardPending('project', first.id, 'stale')).toBe(1);
    expect(store.candidates('project', first.id).find(c => c.id === 'old')?.status).toBe('discarded');
    expect(store.discard('project', first.id, 'fresh').status).toBe('discarded');
    expect(() => store.accept('project', first.id, 'fresh', { baseRevision: 2, requestId: 'a' })).toThrow('candidate-discarded');
  });
  it('moves a stale candidate onto the new revision when changes do not overlap, and refuses overlap', () => {
    const base = store.create('project', { appId: 'image', payload: { layers: [{ id: 'title', text: 'Hi' }, { id: 'logo', fill: '#000' }] } }, 'user');
    store.propose('project', base.id, { baseRevision: 1, requestId: 'ai', payload: { layers: [{ id: 'title', text: 'Hello' }, { id: 'logo', fill: '#000' }] } });
    store.commit('project', base.id, { baseRevision: 1, requestId: 'human', payload: { layers: [{ id: 'title', text: 'Hi' }, { id: 'logo', fill: '#f00' }] } }, 'user');
    const moved = store.rebase('project', base.id, 'ai', { requestId: 'ai-on-2' });
    expect(moved).toMatchObject({ baseRevision: 2, rebasedFrom: 'ai', status: 'pending' });
    expect(store.candidate('project', base.id, 'ai-on-2').payload).toEqual({ layers: [{ id: 'title', text: 'Hello' }, { id: 'logo', fill: '#f00' }] });
    expect(store.candidates('project', base.id).find(c => c.id === 'ai')?.status).toBe('discarded');
    expect(store.accept('project', base.id, 'ai-on-2', { baseRevision: 2, requestId: 'take' }).revision).toBe(3);
    store.propose('project', base.id, { baseRevision: 3, requestId: 'clash', payload: { layers: [{ id: 'title', text: 'AI' }, { id: 'logo', fill: '#f00' }] } });
    store.commit('project', base.id, { baseRevision: 3, requestId: 'human-2', payload: { layers: [{ id: 'title', text: 'Human' }, { id: 'logo', fill: '#f00' }] } }, 'user');
    let error: unknown;
    try { store.rebase('project', base.id, 'clash', { requestId: 'clash-2' }); } catch (failure) { error = failure; }
    expect(error).toMatchObject({ message: 'candidate-overlap', detail: { conflicts: ['/layers/@title/text'] } });
  });
  it('names candidate files by hash: case-only differences and Windows device names stay distinct', () => {
    const first = source();
    for (const requestId of ['Abc', 'abc', 'CON', 'nul']) store.propose('project', first.id, { baseRevision: 1, requestId, payload: { id: requestId } });
    for (const requestId of ['Abc', 'abc', 'CON', 'nul']) expect(store.candidate('project', first.id, requestId).payload).toEqual({ id: requestId });
    expect(fs.readdirSync(path.join(docDir(first.id), 'candidates')).every(name => /^[0-9a-f]{40}\.json$/.test(name))).toBe(true);
  });
});

describe('document ids and robustness', () => {
  it('rejects ids that are unsafe as directory names on any OS', () => {
    for (const id of ['../escape', 'CON', 'nul', 'Source-ABC', 'com1.txt']) expect(() => store.get('project', id)).toThrow('invalid-id');
  });
  it('recovers the prior pointer after corruption without discarding source snapshots', () => {
    const first = source(); commit(first.id, 1, { value: 2 });
    fs.writeFileSync(path.join(docDir(first.id), 'state.json'), '{broken');
    expect(store.get('project', first.id).payload).toEqual(first.payload);
    expect(commit(first.id, 1, { value: 3 }, 'recovered').revision).toBe(3);
  });
  it('retries a busy state file instead of falling back to the older pointer', () => {
    const first = source(); commit(first.id, 1, { value: 2 });
    const real = fs.readFileSync;
    let busy = 2;
    vi.spyOn(fs, 'readFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
      if (String(file).endsWith('state.json') && busy > 0) { busy -= 1; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); }
      return (real as (f: fs.PathOrFileDescriptor, o?: unknown) => string | Buffer)(file, options);
    }) as typeof fs.readFileSync);
    expect(store.get('project', first.id).revision).toBe(2);
    busy = 99;
    expect(() => store.get('project', first.id)).toThrow('source-busy');
  });
  it('reports unreadable documents instead of hiding them', () => {
    const good = source();
    const bad = store.create('project', { appId: 'image', payload: {} }, 'user');
    fs.writeFileSync(path.join(docDir(bad.id), 'state.json'), '{broken');
    const listed = store.listWithFailures('project');
    expect(listed.docs.map(d => d.id)).toEqual([good.id]);
    expect(listed.failed).toEqual([{ id: bad.id, error: 'source-unreadable' }]);
    expect(listed.docs[0]).not.toHaveProperty('payload');
  });
  it('answers 404 when the registered project folder disappeared', () => {
    expect(() => store.list('gone')).toThrow('project-not-found');
    expect(() => store.get('other-project', 'abc')).toThrow('project-not-found');
  });
  it('requires existing in-project outputs, keeps their original source version, and records a repeat once', () => {
    const first = source();
    fs.writeFileSync(path.join(root, 'poster.png'), 'fixture');
    expect(store.output('project', first.id, { sourceRevision: 1, requestId: 'png', path: 'poster.png', mediaType: 'image/png' }).sourceRevision).toBe(1);
    expect(store.output('project', first.id, { sourceRevision: 1, requestId: 'png-again', path: 'poster.png', mediaType: 'image/png' }).id).toBe('png');
    commit(first.id, 1, { cap: 'gold' });
    expect(store.outputs('project', first.id)).toHaveLength(1);
    expect(() => store.output('project', first.id, { sourceRevision: 2, requestId: 'escape', path: '../secret.png' })).toThrow('invalid-output-path');
  });
  it('blocks symlink escapes before reading or writing an editable source', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'creation-outside-'));
    try {
      fs.mkdirSync(path.join(root, '.vibisual'));
      fs.symlinkSync(outside, path.join(root, '.vibisual/creation'), 'junction');
      expect(() => source()).toThrow('outside-project');
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });
});

describe('impacts', () => {
  it('shows direct/transitive impact with outputs, without advancing pinned references', () => {
    const model = source();
    const image = store.create('project', { appId: 'image', title: 'Poster', payload: { caption: 'Custom caption' }, links: [link(model.id, 1)] }, 'user');
    const movie = store.create('project', { appId: 'movie', title: 'Promotion', payload: { audio: 'original.wav' },
      links: [{ id: 'poster', sourceId: image.id, sourceRevision: 1, role: 'scene', targets: ['scene-2'] }] }, 'user');
    fs.writeFileSync(path.join(root, 'poster.png'), 'x');
    store.output('project', image.id, { sourceRevision: 1, requestId: 'out', path: 'poster.png', mediaType: 'image/png' });
    commit(model.id, 1, { cap: 'gold' });
    const impacts = store.impacts('project', model.id);
    expect(impacts.map(i => [i.docId, i.depth, i.targets])).toEqual([[image.id, 1, ['layer-product']], [movie.id, 2, ['scene-2']]]);
    expect(impacts[0]?.outputs).toEqual([{ id: 'out', path: 'poster.png', sourceRevision: 1, mediaType: 'image/png' }]);
    expect(store.get('project', image.id).links[0]?.sourceRevision).toBe(1);
  });
  it('follows distinct revisions of the same source and reports the shortest active dependency path', () => {
    const model = source();
    const image = store.create('project', { appId: 'image', payload: {}, links: [link(model.id, 1)] }, 'user');
    const intermediate = store.create('project', { appId: 'image', payload: {}, links: [{ id: 'old-image', sourceId: image.id, sourceRevision: 1, role: 'image', targets: ['layer'] }] }, 'user');
    const revisedImage = store.commit('project', image.id, { baseRevision: 1, requestId: 'use-intermediate',
      links: [{ id: 'intermediate', sourceId: intermediate.id, sourceRevision: 1, role: 'image', targets: ['revised-layer'] }] }, 'user');
    const movie = store.create('project', { appId: 'movie', payload: {}, links: [{ id: 'poster', sourceId: image.id, sourceRevision: revisedImage.revision, role: 'scene', targets: ['scene'] }] }, 'user');
    expect(store.impacts('project', model.id).find(impact => impact.docId === movie.id)).toMatchObject({ depth: 4, sourceId: image.id, sourceRevision: 2 });
  });
  it('marks a broken chain and still reports the other documents', () => {
    const model = source();
    const image = store.create('project', { appId: 'image', payload: {}, links: [link(model.id, 1)] }, 'user');
    const second = store.create('project', { appId: 'image', payload: {}, links: [{ id: 'mid', sourceId: image.id, sourceRevision: 1, role: 'x', targets: [] }] }, 'user');
    const third = store.create('project', { appId: 'movie', payload: {}, links: [{ id: 'end', sourceId: second.id, sourceRevision: 1, role: 'x', targets: [] }] }, 'user');
    fs.rmSync(path.join(docDir(second.id), 'revisions/1.json'));
    const impacts = store.impacts('project', model.id);
    expect(impacts.find(i => i.docId === image.id)?.depth).toBe(1);
    expect(impacts.find(i => i.docId === third.id)).toBeUndefined();
    expect(() => store.impacts('project', model.id)).not.toThrow();
  });
});

describe('mirrors of app-native documents', () => {
  it('writes nothing without links, indexes links only, and skips unchanged syncs', () => {
    const first = source();
    expect(store.sync('project', { key: 'video-0', appId: 'movie', title: 'Empty', links: [] })).toBeNull();
    const before = writes.length;
    const input = { key: 'video-1', appId: 'movie', title: 'Movie', payload: { huge: 'x'.repeat(10_000) }, links: [link(first.id, 1, 'model')] };
    const mirror = store.sync('project', input)!;
    expect(store.get('project', mirror.id).payload).toEqual({});
    const afterCreate = writes.length;
    expect(afterCreate).toBeGreaterThan(before);
    expect(store.sync('project', { ...input, payload: { scene: 2 } })).toEqual(mirror);
    expect(writes.length).toBe(afterCreate);
    expect(store.sync('project', { ...input, links: [] })?.revision).toBe(2);
    expect(store.impacts('project', first.id)).toEqual([]);
  });
  it('is read-only for payload writes but records keep decisions', () => {
    const model = source();
    const mirror = store.sync('project', { key: 'video-1', appId: 'movie', title: 'Movie', links: [link(model.id, 1, 'asset')] })!;
    expect(() => store.commit('project', mirror.id, { baseRevision: 1, requestId: 'x', payload: { hacked: true } }, 'user')).toThrow('mirror-read-only');
    expect(() => store.propose('project', mirror.id, { baseRevision: 1, requestId: 'x', payload: {} })).toThrow('mirror-read-only');
    commit(model.id, 1, { cap: 'gold' });
    expect(store.decide('project', mirror.id, 'asset', 2).links[0]?.keptRevision).toBe(2);
    expect(store.mirror('project', 'movie', 'video-1')?.links[0]?.keptRevision).toBe(2);
  });
});

describe('large binaries outside the payload', () => {
  const png = `data:image/png;base64,${Buffer.alloc(3000, 7).toString('base64')}`;
  it('stores a data URL and a long number array once across revisions', async () => {
    const vertices = Array.from({ length: 300 }, (_, i) => i / 8);
    const payload = await store.externalize('project', { image: png, geometry: { array: vertices }, short: [1, 2, 3] }) as Record<string, CreationValue>;
    expect(parseCreationBlobRef(payload.image)?.ext).toBe('png');
    expect(parseCreationBlobRef((payload.geometry as Record<string, CreationValue>).array)?.ext).toBe('f32');
    expect(payload.short).toEqual([1, 2, 3]);
    const doc = store.create('project', { appId: 'model', payload }, 'user');
    const again = await store.externalize('project', { image: png, geometry: { array: vertices }, short: [1, 2, 3], title: 'v2' });
    store.commit('project', doc.id, { baseRevision: 1, requestId: 'v2', payload: again }, 'user');
    expect(fs.readdirSync(path.join(root, '.vibisual/creation/blobs'))).toHaveLength(2);
  });
  it('refuses a reference to a blob that does not exist', () => {
    expect(() => store.create('project', { appId: 'model', payload: { image: `vibi-blob:${'a'.repeat(64)}.png` } }, 'user')).toThrow('blob-not-found');
  });
  it('refuses an oversized payload with a code the screen can translate', () => {
    expect(() => store.create('project', { appId: 'model', payload: { text: 'x'.repeat(CREATION_LIMITS.payloadBytes + 10) } }, 'user')).toThrow('source-too-large');
  });
});

describe('cleanup', () => {
  it('keeps the pointer, undo range, recent revisions, outputs and referenced revisions; removes the rest and orphan blobs', async () => {
    const model = source();
    const image = store.create('project', { appId: 'image', payload: {}, links: [link(model.id, 1)] }, 'user');
    fs.writeFileSync(path.join(root, 'out.png'), 'x');
    let revision = 1;
    for (let i = 0; i < 90; i += 1) revision = store.commit('project', model.id, { baseRevision: revision, requestId: `c${i}`, payload: { n: i } }, 'user').revision;
    store.output('project', model.id, { sourceRevision: 5, requestId: 'out', path: 'out.png', mediaType: 'image/png' });
    const orphan = await store.putBlob('project', { bytes: new Uint8Array([1, 2, 3]), ext: 'bin' });
    clock = Date.now() + CREATION_LIMITS.blobGraceMs + 60_000;
    const result = await store.prune('project');
    const files = fs.readdirSync(path.join(docDir(model.id), 'revisions')).map(name => Number(name.slice(0, -5)));
    expect(files).toContain(1); // referenced by the image
    expect(files).toContain(5); // has an output
    expect(files).toContain(revision); // the pointer
    expect(files).toContain(revision - 49); // inside the undo range
    expect(files).not.toContain(10);
    expect(result.revisions).toBeGreaterThan(0);
    expect(result.blobs).toBe(1);
    expect(fs.existsSync(path.join(root, '.vibisual/creation/blobs', orphan.slice('vibi-blob:'.length)))).toBe(false);
    expect(store.history('project', model.id).every(entry => files.includes(entry.revision))).toBe(true);
    expect(store.get('project', image.id).links[0]?.sourceRevision).toBe(1);
  });
  it('drops decided candidates after retention and keeps pending ones', async () => {
    const first = source();
    store.propose('project', first.id, { baseRevision: 1, requestId: 'keep-me', payload: { a: 1 } });
    store.propose('project', first.id, { baseRevision: 1, requestId: 'old', payload: { b: 1 } });
    store.discard('project', first.id, 'old');
    clock += CREATION_LIMITS.candidateRetentionMs + 1;
    expect((await store.prune('project')).candidates).toBe(1);
    expect(store.candidates('project', first.id).map(c => c.id)).toEqual(['keep-me']);
  });
});

describe('requirements', () => {
  it('distinguishes computable constraints from visual judgment and retains frame evidence', () => {
    const before: CreationValue = { layers: [{ id: 'title', text: 'Before' }, { id: 'logo', hash: 'fixed' }] };
    const after: CreationValue = { layers: [{ id: 'logo', hash: 'fixed' }, { id: 'title', text: 'After' }] };
    expect(creationValueAt(after, '/layers/@title/text')).toBe('After');
    const checks = checkCreationRequirements(before, after, [
      { id: 'logo', kind: 'unchanged', pointer: '/layers/@logo', description: 'Keep logo data' },
      { id: 'title', kind: 'equals', pointer: '/layers/@title/text', expected: 'After', description: 'Requested title' },
      { id: 'shape', kind: 'visual', description: 'Product silhouette', evidence: { path: 'frame.png', time: 2, note: 'Inspect rendered frame' } },
    ]);
    expect(checks.map(c => c.status)).toEqual(['passed', 'passed', 'needs-review']);
    expect(checks[2]?.evidence?.path).toBe('frame.png');
  });
});
