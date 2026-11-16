import { randomUUID } from 'node:crypto';
import { MEMO } from '../config.js';
import type { MemoServerHost } from '../host.js';
import type { MemoNote, MemoSettings } from '../types.js';
import { identifier, MemoError, object, text } from './errors.js';
import { MemoStorage } from './storage.js';
import { contextPatch, noteData, restoreFields, tags, tasks } from './validation.js';

export class MemoStore {
  readonly disk: MemoStorage;
  constructor(readonly host: MemoServerHost) { this.disk = new MemoStorage(host); }
  project(raw: unknown): string {
    const root = this.host.resolveProjectPath(raw);
    if (!root) throw new MemoError('project-unavailable', 404);
    return root;
  }
  settings(root: string): MemoSettings {
    if (this.host.getAppAIEnabled) return { aiEnabled: this.host.getAppAIEnabled() };
    return this.disk.read(root, 'settings.json', value => {
      const row = object(value);
      if (typeof row['aiEnabled'] !== 'boolean') throw new MemoError('storage-corrupt', 500);
      return { aiEnabled: row['aiEnabled'] };
    }) ?? { aiEnabled: true };
  }
  async setSettings(root: string, raw: unknown): Promise<MemoSettings> {
    const value = object(raw);
    if (typeof value['aiEnabled'] !== 'boolean') throw new MemoError('invalid-request');
    const settings = { aiEnabled: value['aiEnabled'] };
    if (this.host.setAppAIEnabled) await this.host.setAppAIEnabled(settings.aiEnabled);
    else this.disk.write(root, 'settings.json', settings);
    return this.settings(root);
  }
  get(root: string, id: unknown): MemoNote {
    const key = identifier(id, 'memo');
    const note = this.disk.read(root, `notes/${key}.json`, noteData);
    if (!note) throw new MemoError('note-unavailable', 404);
    return { ...note, project: root };
  }
  list(root: string, query: Record<string, unknown>): MemoNote[] {
    const search = typeof query['q'] === 'string' ? query['q'].normalize('NFC').toLocaleLowerCase() : '';
    const from = typeof query['from'] === 'string' && query['from'] ? Date.parse(query['from']) : -Infinity;
    const until = typeof query['until'] === 'string' && query['until'] ? Date.parse(query['until']) : Infinity;
    if (Number.isNaN(from) || Number.isNaN(until) || from > until) throw new MemoError('invalid-date');
    return this.disk.names(root, 'notes').filter(name => /^memo-[a-zA-Z0-9-]{8,80}\.json$/.test(name))
      .map(name => this.get(root, name.slice(0, -5)))
      .filter(note => query['view'] === 'trash' ? note.deletedAt !== null : note.deletedAt === null)
      .filter(note => query['view'] !== 'pinned' || note.pinned)
      .filter(note => query['view'] !== 'today' || new Date(note.createdAt).toDateString() === new Date().toDateString())
      .filter(note => note.updatedAt >= from && note.updatedAt <= until)
      .filter(note => !search || `${note.title}\n${note.body}\n${note.tags.join(' ')}`.normalize('NFC').toLocaleLowerCase().includes(search))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }
  create(root: string, raw: unknown): MemoNote {
    const input = object(raw);
    const requestId = identifier(input['requestId'], 'req');
    const id = `memo-${requestId.slice(4)}`;
    const existing = this.disk.read(root, `notes/${id}.json`, noteData);
    if (existing) return { ...existing, project: root };
    const now = Date.now();
    const note: MemoNote = { id, project: root, owner: 'local', title: '', body: '', version: 1,
      createdAt: now, updatedAt: now, pinned: false, aiExcluded: false, tags: [], tasks: [],
      context: this.host.resolveAppContext(root, root), attachments: [], deletedAt: null, requestId, author: 'user' };
    return this.commit(root, this.patchFields(root, note, input, true), requestId);
  }
  save(root: string, id: unknown, raw: unknown): MemoNote {
    const input = object(raw);
    const note = this.get(root, id);
    const requestId = identifier(input['requestId'], 'req');
    if (note.requestId === requestId) return note;
    if (input['baseVersion'] !== note.version) throw new MemoError('version-conflict', 409);
    if (note.deletedAt !== null && input['action'] !== 'restore') throw new MemoError('note-in-trash', 409);
    let updated = this.patchFields(root, note, input);
    if (input['action'] === 'trash') updated = { ...note, deletedAt: Date.now() };
    if (input['action'] === 'restore') updated = { ...note, deletedAt: null };
    if (input['action'] === 'revert') {
      const previous = this.version(root, note.id, input['version']);
      updated = { ...note, ...restoreFields(previous) };
    }
    return this.commit(root, { ...updated, version: note.version + 1, updatedAt: Date.now(), author: 'user' }, requestId);
  }
  patchFields(root: string, note: MemoNote, input: Record<string, unknown>, fresh = false): MemoNote {
    const updated = { ...note };
    if ('title' in input) updated.title = text(input['title'], MEMO.titleMax);
    if ('body' in input) updated.body = text(input['body'], MEMO.bodyMax);
    if ('tags' in input) updated.tags = tags(input['tags']);
    if ('tasks' in input) updated.tasks = tasks(input['tasks']);
    for (const key of ['pinned', 'aiExcluded'] as const) {
      if (key in input) { if (typeof input[key] !== 'boolean') throw new MemoError('invalid-request'); updated[key] = input[key]; }
    }
    if ('detach' in input) { const detached = identifier(input['detach'], 'asset'); updated.attachments = note.attachments.filter(asset => asset.id !== detached); }
    if ('context' in input) {
      const context = contextPatch(input['context']);
      const source = context ? this.host.resolveAppContext(root, context.id) : null;
      // 지워진 앱 버블 링크는 보존한다: 저장된 같은 링크는 발췌만 갱신하고, 새 메모(복제)는 링크 없이 만든다.
      const kept = context && context.id === note.context?.id ? note.context : null;
      if (context && !source && !kept && !fresh) throw new MemoError('context-unavailable', 404);
      const base = source ?? kept;
      updated.context = base && context ? { ...base, excerpt: context.excerpt } : null;
    }
    return updated;
  }
  commit(root: string, note: MemoNote, requestId = `req-${randomUUID()}`): MemoNote {
    const versions = this.disk.names(root, `versions/${note.id}`).filter(name => /^\d+\.json$/.test(name)).map(name => Number(name.slice(0, -5)));
    const version = Math.max(note.version, versions.reduce((max, value) => Math.max(max, value), 0) + 1);
    const value = { ...note, version, requestId };
    // Publish the current pointer only after its immutable source version exists.
    this.disk.write(root, `versions/${note.id}/${version}.json`, value);
    this.disk.write(root, `notes/${note.id}.json`, value);
    return value;
  }
  version(root: string, id: unknown, version: unknown): MemoNote {
    const key = identifier(id, 'memo');
    if (!Number.isSafeInteger(version) || Number(version) < 1 || Number(version) > this.get(root, key).version) throw new MemoError('invalid-version');
    const value = this.disk.read(root, `versions/${key}/${String(version)}.json`, noteData);
    if (!value) throw new MemoError('version-unavailable', 404);
    return { ...value, project: root };
  }
  history(root: string, id: unknown, before?: unknown): { versions: MemoNote[]; before: number | null } {
    const current = this.get(root, id);
    const end = Math.min(current.version, typeof before === 'number' && Number.isSafeInteger(before) ? before - 1 : current.version);
    const first = Math.max(1, end - MEMO.historyPage + 1);
    const versions: MemoNote[] = [];
    for (let n = end; n >= first; n--) versions.push(this.version(root, current.id, n));
    return { versions, before: first > 1 ? first : null };
  }
}
