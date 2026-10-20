import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CREATION_LIMITS, type CreationValue } from '@vibisual/shared';
import { CreationStore, type CreationHost } from './creationStore.js';

let root: string;
let host: CreationHost;
let store: CreationStore;
let clock: number;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'creation-cleanup-'));
  clock = Date.now();
  host = {
    resolveProjectPath: value => value === 'project' ? root : null,
    atomicWriteFile: (file, data) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, data); fs.renameSync(`${file}.tmp`, file);
    },
    warn: vi.fn(),
  };
  store = new CreationStore(host, () => clock);
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

const docDir = (id: string): string => path.join(root, '.vibisual', 'creation', id);
const blobName = (ref: string): string => ref.slice('vibi-blob:'.length);
const create = (payload: CreationValue = {}) => store.create('project', { appId: 'image', payload }, 'user');
const link = (id: string) => ({ id: 'model-ref', sourceId: id, sourceRevision: 1, role: 'product', targets: [] });

/** Control a real asynchronous read boundary, without replacing any store behavior. */
function duringRead(file: string, action: () => void): () => boolean {
  const original = fsp.readFile;
  let ran = false;
  vi.spyOn(fsp, 'readFile').mockImplementation((async (
    target: Parameters<typeof fsp.readFile>[0], options: Parameters<typeof fsp.readFile>[1],
  ) => {
    const data = await original(target, options);
    if (!ran && String(target) === file) { ran = true; action(); }
    return data;
  }) as typeof fsp.readFile);
  return () => ran;
}

describe('creation cleanup preserves references when its read is incomplete', () => {
  it.each(['ledger', 'revision', 'candidate'] as const)('keeps shared binaries when a %s is unreadable', async (kind) => {
    const ref = await store.putBlob('project', { bytes: new Uint8Array([1, 2, 3]), ext: 'png' });
    const doc = create(kind === 'candidate' ? {} : { image: ref });
    let damaged: string;
    if (kind === 'ledger') {
      store.commit('project', doc.id, { baseRevision: 1, requestId: 'second', title: 'Second' }, 'user');
      damaged = path.join(docDir(doc.id), 'state.json');
    } else if (kind === 'revision') {
      damaged = path.join(docDir(doc.id), 'revisions', '1.json');
    } else {
      store.propose('project', doc.id, { baseRevision: 1, requestId: 'proposal', payload: { image: ref } });
      damaged = path.join(docDir(doc.id), 'candidates', fs.readdirSync(path.join(docDir(doc.id), 'candidates'))[0]!);
    }
    fs.writeFileSync(damaged, '{broken');
    if (kind === 'ledger') expect(store.get('project', doc.id).revision).toBe(1); // previous.json recovery
    clock += CREATION_LIMITS.blobGraceMs + 60_000;
    expect(await store.prune('project')).toEqual({ revisions: 0, candidates: 0, blobs: 0 });
    expect(fs.existsSync(store.blobPath('project', blobName(ref)))).toBe(true);
    expect(host.warn).toHaveBeenCalled();
    if (kind === 'ledger') expect(store.get('project', doc.id).payload).toEqual({ image: ref });
  });

  it('does not remove another document revision when an unreadable ledger may reference it', async () => {
    const source = create();
    const consumer = store.create('project', { appId: 'image', payload: {}, links: [link(source.id)] }, 'user');
    for (let revision = 1; revision <= 60; revision++) {
      store.commit('project', source.id, { baseRevision: revision, requestId: `edit-${revision}`, payload: { revision } }, 'user');
    }
    fs.writeFileSync(path.join(docDir(consumer.id), 'state.json'), '{broken');
    expect((await store.prune('project')).revisions).toBe(0);
    expect(store.revision('project', source.id, 1).revision).toBe(1);
  });
});

describe('creation cleanup and concurrent saves', () => {
  it('preserves the recovery revision left by a failed pointer publication', async () => {
    const doc = create({ original: true });
    const failing = new CreationStore({ ...host, atomicWriteFile: (file, data) => {
      if (file.endsWith('state.json')) throw new Error('disk full');
      host.atomicWriteFile(file, data);
    } });
    expect(() => failing.commit('project', doc.id, { baseRevision: 1, requestId: 'failed', payload: { recovery: true } }, 'user')).toThrow('disk full');
    expect((await store.prune('project')).revisions).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(docDir(doc.id), 'revisions', '2.json'), 'utf8')).payload).toEqual({ recovery: true });
    expect(store.get('project', doc.id).payload).toEqual({ original: true });
  });

  it.each([false, true])('keeps an old revision linked during collection (second store: %s)', async (secondStore) => {
    const source = create();
    for (let revision = 1; revision <= 60; revision++) {
      store.commit('project', source.id, { baseRevision: revision, requestId: `edit-${revision}`, payload: { revision } }, 'user');
    }
    const consumer = create();
    const writer = secondStore ? new CreationStore(host, () => clock) : store;
    const ran = duringRead(path.join(docDir(source.id), 'revisions', '61.json'), () => {
      writer.commit('project', consumer.id, { baseRevision: 1, requestId: 'link', links: [link(source.id)] }, 'user');
    });
    expect((await store.prune('project')).revisions).toBe(0);
    expect(ran()).toBe(true);
    expect(store.get('project', consumer.id).links[0]?.sourceRevision).toBe(1);
    expect(store.revision('project', source.id, 1).revision).toBe(1);
    // An aborted pass must not poison later cleanup or leave an active observer behind.
    expect((await store.prune('project')).revisions).toBeGreaterThan(0);
    expect(store.revision('project', source.id, 1).revision).toBe(1);
  });

  it('stops between deletions when a new document takes ownership of a remaining blob', async () => {
    const refs = await Promise.all([1, 2].map(value => store.putBlob('project', { bytes: new Uint8Array([value]), ext: 'png' })));
    const originals = refs.map(blobName);
    clock += CREATION_LIMITS.blobGraceMs + 60_000;
    const unlink = fs.unlinkSync;
    let savedRef: string | undefined;
    let savedId: string | undefined;
    vi.spyOn(fs, 'unlinkSync').mockImplementation(file => {
      unlink(file);
      if (savedRef || !originals.includes(path.basename(String(file)))) return;
      savedRef = refs.find(ref => blobName(ref) !== path.basename(String(file)))!;
      queueMicrotask(() => { savedId = create({ image: savedRef! }).id; });
    });
    expect((await store.prune('project')).blobs).toBe(1);
    expect(savedId).toBeDefined();
    expect(store.get('project', savedId!).payload).toEqual({ image: savedRef });
    expect(fs.existsSync(store.blobPath('project', blobName(savedRef!)))).toBe(true);
  });

  it('does not delete an old blob reused while its age check is in flight', async () => {
    const ref = await store.putBlob('project', { bytes: new Uint8Array([4]), ext: 'png' });
    const file = store.blobPath('project', blobName(ref));
    clock += CREATION_LIMITS.blobGraceMs + 60_000;
    const stat = fsp.stat;
    let reused = false;
    vi.spyOn(fsp, 'stat').mockImplementation((async (...args: Parameters<typeof fsp.stat>) => {
      const result = await stat(...args);
      if (!reused && String(args[0]) === file) {
        reused = true;
        expect(store.missingBlobs('project', [blobName(ref)])).toEqual([]);
      }
      return result;
    }) as typeof fsp.stat);
    expect((await store.prune('project')).blobs).toBe(0);
    expect(reused).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  });

  it('keeps a new proposal reusing an expired request id before the old file is unlinked', async () => {
    const doc = create();
    store.propose('project', doc.id, { baseRevision: 1, requestId: 'reused', payload: { old: true } });
    store.discard('project', doc.id, 'reused');
    clock += CREATION_LIMITS.candidateRetentionMs + 1;
    const write = host.atomicWriteFile;
    let replaced = false;
    host.atomicWriteFile = (file, data) => {
      write(file, data);
      if (replaced || file !== path.join(docDir(doc.id), 'state.json')) return;
      replaced = true;
      queueMicrotask(() => { store.propose('project', doc.id, { baseRevision: 1, requestId: 'reused', payload: { new: true } }); });
    };
    expect((await store.prune('project')).candidates).toBe(0);
    expect(replaced).toBe(true);
    expect(store.candidate('project', doc.id, 'reused').payload).toEqual({ new: true });
  });
});
