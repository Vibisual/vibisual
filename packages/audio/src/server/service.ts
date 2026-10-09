import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  applyAudioPatch, audioDocDuration, createEmptyAudioDoc, validateAudioDoc,
} from '../index.js';
import type { AudioDoc, AudioDocOp } from '../types.js';
import type { AudioServerHost } from '../host.js';
import { AudioAssets } from './assets.js';
import { AudioServiceError, badRequest, object, safeId } from './errors.js';
import { AudioStorage } from './storage.js';
import { validateSettings, type AudioSettings } from './settings.js';

const UNDO_LIMIT = 50;
const RECEIPT_LIMIT = 512;
const HISTORY_LIMIT = 200;

export interface AudioHistoryEntry {
  requestId: string;
  action: 'patch' | 'undo' | 'redo';
  version: number;
  at: number;
  actor?: string;
}

interface Receipt { requestId: string; fingerprint: string; version: number }
interface StoredAudioDocument {
  formatVersion: 1;
  doc: AudioDoc;
  undo: AudioDoc[];
  redo: AudioDoc[];
  receipts: Receipt[];
  history: AudioHistoryEntry[];
}

export interface AudioDocumentResponse {
  ok: true;
  doc: AudioDoc;
  canUndo: boolean;
  canRedo: boolean;
  history: readonly AudioHistoryEntry[];
  replayed?: true;
  appliedVersion?: number;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function storedDocument(raw: unknown): StoredAudioDocument {
  if (!object(raw) || raw.formatVersion !== 1 || !Array.isArray(raw.undo) || !Array.isArray(raw.redo)
    || !Array.isArray(raw.receipts) || !Array.isArray(raw.history)) throw new Error('Invalid stored audio document.');
  const doc = validateAudioDoc(raw.doc);
  if (!doc.ok || raw.undo.length > UNDO_LIMIT || raw.redo.length > UNDO_LIMIT || raw.receipts.length > RECEIPT_LIMIT || raw.history.length > HISTORY_LIMIT) {
    throw new Error('Invalid stored audio document or history.');
  }
  const snapshots = (values: unknown[]): AudioDoc[] => values.map((item) => {
    const result = validateAudioDoc(item);
    if (!result.ok || result.doc.id !== doc.doc.id) throw new Error('Invalid undo snapshot.');
    return result.doc;
  });
  for (const receipt of raw.receipts) {
    if (!object(receipt) || typeof receipt.requestId !== 'string' || typeof receipt.fingerprint !== 'string'
      || !Number.isInteger(receipt.version) || Number(receipt.version) > doc.doc.version) throw new Error('Invalid request receipt.');
  }
  for (const entry of raw.history) {
    if (!object(entry) || typeof entry.requestId !== 'string' || !['patch', 'undo', 'redo'].includes(String(entry.action))
      || !Number.isInteger(entry.version) || typeof entry.at !== 'number') throw new Error('Invalid edit history.');
  }
  return {
    formatVersion: 1, doc: doc.doc, undo: snapshots(raw.undo), redo: snapshots(raw.redo),
    receipts: raw.receipts as unknown as Receipt[], history: raw.history as unknown as AudioHistoryEntry[],
  };
}

function response(stored: StoredAudioDocument): AudioDocumentResponse {
  return { ok: true, doc: stored.doc, canUndo: stored.undo.length > 0, canRedo: stored.redo.length > 0, history: stored.history };
}

export class AudioService {
  readonly storage: AudioStorage;
  readonly assets: AudioAssets;

  constructor(private readonly host: AudioServerHost) {
    this.storage = new AudioStorage(host);
    this.assets = new AudioAssets(this.storage);
  }

  project(raw: unknown): string {
    const root = this.host.resolveProjectPath(raw);
    if (!root) throw new AudioServiceError(404, 'unknown-project', 'The project is not open or registered.');
    return root;
  }

  private docPath(id: unknown): string {
    if (!safeId(id)) badRequest('Invalid audio document id.');
    return `docs/${id}.json`;
  }

  private read(root: string, id: unknown): StoredAudioDocument {
    const found = this.storage.read(root, this.docPath(id), storedDocument);
    if (!found) throw new AudioServiceError(404, 'unknown-doc', 'The audio project does not exist.');
    if (found.doc.id !== id) throw new AudioServiceError(500, 'storage-corrupt', 'The saved audio project id does not match.');
    return found;
  }

  list(root: string): Array<{ id: string; title: string; version: number; updatedAt: number; duration: number }> {
    const dir = this.storage.path(root, 'docs');
    if (!fs.existsSync(dir)) return [];
    const docs: Array<{ id: string; title: string; version: number; updatedAt: number; duration: number }> = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.slice(0, -5);
      try {
        const { doc } = this.read(root, id);
        docs.push({ id, title: doc.title, version: doc.version, updatedAt: doc.updatedAt, duration: audioDocDuration(doc) });
      } catch (error) {
        this.host.warn(`[audio] Skipped unreadable document ${id}: ${error instanceof Error ? error.message : 'invalid data'}`);
      }
    }
    return docs.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  create(root: string, raw: unknown): AudioDocumentResponse {
    if (!object(raw)) badRequest('A document title or id is required.');
    const id = raw.id === undefined ? `sound-${randomUUID()}` : raw.id;
    const relative = this.docPath(id);
    const existing = this.storage.read(root, relative, storedDocument);
    if (existing) {
      if (existing.doc.id !== id) throw new AudioServiceError(500, 'storage-corrupt', 'The saved audio project id does not match.');
      return response(existing);
    }
    const title = raw.title === undefined ? 'Untitled audio' : raw.title;
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 200) badRequest('Invalid audio project title.');
    const doc = createEmptyAudioDoc(id as string, title.trim());
    if (!validateAudioDoc(doc).ok) badRequest('Invalid audio project metadata.');
    const stored: StoredAudioDocument = { formatVersion: 1, doc, undo: [], redo: [], receipts: [], history: [] };
    this.storage.write(root, relative, stored, storedDocument);
    return response(stored);
  }

  get(root: string, id: unknown): AudioDocumentResponse {
    return response(this.read(root, id));
  }

  edit(root: string, id: unknown, action: 'patch' | 'undo' | 'redo', raw: unknown): AudioDocumentResponse {
    if (!object(raw) || !Number.isInteger(raw.baseVersion) || Number(raw.baseVersion) < 0
      || typeof raw.requestId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,120}$/.test(raw.requestId)) {
      badRequest('baseVersion and a unique requestId are required.');
    }
    const actor = raw.actor;
    if (actor !== undefined && (typeof actor !== 'string' || actor.length > 120 || /[\u0000-\u001f]/.test(actor))) badRequest('Invalid edit actor.');
    if (action === 'patch' && (!Array.isArray(raw.ops) || raw.ops.length === 0 || raw.ops.length > 128)) badRequest('A patch needs between 1 and 128 operations.');
    const stored = this.read(root, id);
    const fingerprint = createHash('sha256').update(canonical({ action, baseVersion: raw.baseVersion, actor, ops: action === 'patch' ? raw.ops : null })).digest('hex');
    const prior = stored.receipts.find((receipt) => receipt.requestId === raw.requestId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new AudioServiceError(409, 'request-id-conflict', 'This requestId was already used for another edit.', stored.doc.version);
      return { ...response(stored), replayed: true, appliedVersion: prior.version };
    }
    if (stored.doc.version !== raw.baseVersion) {
      throw new AudioServiceError(409, 'version-conflict', 'Read the latest audio project before editing.', stored.doc.version);
    }
    let next: AudioDoc;
    const undo = [...stored.undo];
    const redo = [...stored.redo];
    if (action === 'patch') {
      const result = applyAudioPatch(stored.doc, { baseVersion: raw.baseVersion as number, ops: raw.ops as AudioDocOp[] });
      if (!result.ok) throw new AudioServiceError(400, 'invalid-operation', result.message, stored.doc.version);
      next = result.doc;
      undo.push(stored.doc);
      redo.length = 0;
    } else {
      const from = action === 'undo' ? undo : redo;
      const to = action === 'undo' ? redo : undo;
      const previous = from.pop();
      if (!previous) throw new AudioServiceError(409, 'empty-history', `There is no ${action} step.`, stored.doc.version);
      next = { ...previous, version: stored.doc.version + 1, updatedAt: Date.now() };
      to.push(stored.doc);
    }
    if (!validateAudioDoc(next).ok) throw new AudioServiceError(400, 'invalid-operation', 'The edit produces invalid audio project metadata.', stored.doc.version);
    this.assets.validate(root, next.assets);
    const entry: AudioHistoryEntry = { requestId: raw.requestId, action, version: next.version, at: next.updatedAt,
      ...(actor === undefined ? {} : { actor: actor as string }) };
    const updated: StoredAudioDocument = {
      formatVersion: 1, doc: next, undo: undo.slice(-UNDO_LIMIT), redo: redo.slice(-UNDO_LIMIT),
      receipts: [...stored.receipts, { requestId: raw.requestId, fingerprint, version: next.version }].slice(-RECEIPT_LIMIT),
      history: [...stored.history, entry].slice(-HISTORY_LIMIT),
    };
    this.storage.write(root, this.docPath(id), updated, storedDocument);
    return response(updated);
  }

  getSettings(root: string): AudioSettings {
    return this.storage.read(root, 'settings.json', validateSettings) ?? { providers: [] };
  }

  putSettings(root: string, raw: unknown): AudioSettings {
    const settings = validateSettings(raw);
    this.storage.write(root, 'settings.json', settings, validateSettings);
    return settings;
  }
}
