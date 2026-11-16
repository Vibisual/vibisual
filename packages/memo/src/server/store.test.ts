import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoStore } from './store.js';
import { testHost } from './testHost.js';
const clean: (() => void)[] = [];
afterEach(() => { for (const fn of clean.splice(0)) fn(); });
function setup() { const env = testHost(); clean.push(env.dispose); return { ...env, store: new MemoStore(env.host) }; }
const req = (): string => `req-${randomUUID()}`;

describe('note persistence and recovery', () => {
  it('applies the host-wide AI switch to every project store while keeping ordinary capture available', async () => {
    const { root, host, store } = setup();
    await store.setSettings(root, { aiEnabled: false });
    expect(new MemoStore(host).settings('another-registered-project').aiEnabled).toBe(false);
    expect(store.create(root, { requestId: req(), body: 'AI 없이 기록' }).body).toBe('AI 없이 기록');
    await store.setSettings(root, { aiEnabled: true }); expect(new MemoStore(host).settings(root).aiEnabled).toBe(true);
  });
  it('restores Korean text and checklist states through a new store and version rollback', () => {
    const { root, host, store } = setup();
    const note = store.create(root, { requestId: req(), body: '한영 혼용 AI 메모\n담당자는 미정입니다.', tasks: [{ id: `task-${randomUUID()}`, text: '시안 만들기', checked: true }] });
    expect(note.title).toBe('');
    const updated = store.save(root, note.id, { requestId: req(), baseVersion: 1, body: '다음 결정' });
    const reopened = new MemoStore(host);
    expect(reopened.get(root, note.id).body).toBe('다음 결정');
    const restored = reopened.save(root, note.id, { requestId: req(), baseVersion: updated.version, action: 'revert', version: 1 });
    expect(restored.body).toBe(note.body); expect(restored.tasks[0]?.checked).toBe(true); expect(restored.version).toBe(3);
    expect(reopened.history(root, note.id).versions).toHaveLength(3);
  });
  it('retains both edits by rejecting a stale writer', () => {
    const { root, store } = setup(); const note = store.create(root, { requestId: req(), body: 'original' });
    store.save(root, note.id, { requestId: req(), baseVersion: note.version, body: 'newer' });
    expect(() => store.save(root, note.id, { requestId: req(), baseVersion: note.version, body: 'stale' })).toThrow('version-conflict');
    expect(store.get(root, note.id).body).toBe('newer'); expect(store.version(root, note.id, 1).body).toBe('original');
  });
  it('replays a creation without duplicate notes and an acknowledged save without a new version', () => {
    const { root, store } = setup(); const requestId = req();
    const note = store.create(root, { requestId, body: 'one note' });
    expect(store.create(root, { requestId, body: 'one note' }).id).toBe(note.id); expect(store.list(root, {})).toHaveLength(1);
    const saveId = req(); const saved = store.save(root, note.id, { requestId: saveId, baseVersion: 1, body: 'next' });
    expect(store.save(root, note.id, { requestId: saveId, baseVersion: 1, body: 'next' }).version).toBe(saved.version);
  });
  it('keeps excluded notes in keyword search, moves deletion to trash, and restores them', () => {
    const { root, store } = setup(); const note = store.create(root, { requestId: req(), body: '출시 메모', aiExcluded: true, pinned: true });
    expect(store.list(root, { q: '출시', view: 'pinned' })).toHaveLength(1);
    const deleted = store.save(root, note.id, { requestId: req(), baseVersion: 1, action: 'trash' });
    expect(store.list(root, {})).toHaveLength(0); expect(store.list(root, { view: 'trash' })).toHaveLength(1);
    store.save(root, note.id, { requestId: req(), baseVersion: deleted.version, action: 'restore' });
    expect(store.get(root, note.id).aiExcluded).toBe(true);
  });
  it('preserves immutable versions even after pointer corruption and backup recovery', () => {
    const { root, store } = setup(); const note = store.create(root, { requestId: req(), body: 'old' });
    store.save(root, note.id, { requestId: req(), baseVersion: 1, body: 'saved before corruption' });
    fs.writeFileSync(path.join(root, '.vibisual/memo/notes', `${note.id}.json`), '{broken');
    const recovered = store.get(root, note.id);
    const saved = store.save(root, note.id, { requestId: req(), baseVersion: recovered.version, body: 'recovered edit' });
    expect(saved.version).toBe(3); expect(store.version(root, note.id, 2).body).toBe('saved before corruption');
  });
  it('does not overwrite corrupt files when neither current data nor backup is readable', () => {
    const { root, store } = setup(); const note = store.create(root, { requestId: req(), body: 'text' });
    const file = path.join(root, '.vibisual/memo/notes', `${note.id}.json`); fs.writeFileSync(file, '{broken');
    expect(() => store.save(root, note.id, { requestId: req(), baseVersion: 1, body: 'replacement' })).toThrow('storage-corrupt');
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });
  it('rejects traversal identifiers and arbitrary cross-project contexts', () => {
    const { root, store } = setup();
    expect(() => store.get(root, '../../outside')).toThrow('invalid-id');
    expect(store.create(root, { requestId: req(), body: 'note', context: { id: 'another-project', excerpt: 'secret' } }).context).toBeNull();
    const note = store.create(root, { requestId: req(), body: 'note' });
    expect(() => store.save(root, note.id, { requestId: req(), baseVersion: 1, context: { id: 'another-project', excerpt: 'secret' } })).toThrow('context-unavailable');
  });
  it('keeps a vanished link when saving other edits and lets the user clear it', () => {
    const { root, store } = setup(); const note = store.create(root, { requestId: req(), body: 'a' });
    const linked = store.commit(root, { ...note, context: { ...note.context!, id: 'removed-bubble' } });
    const saved = store.save(root, note.id, { requestId: req(), baseVersion: linked.version, body: 'b', context: { id: 'removed-bubble', excerpt: 'new' } });
    expect(saved.context).toMatchObject({ id: 'removed-bubble', excerpt: 'new' });
    expect(store.save(root, note.id, { requestId: req(), baseVersion: saved.version, context: null }).context).toBeNull();
  });
});
